import { createBackgroundEvent } from '../events/index.js';
import type { BlockRef, HeapName, HeaperBlock, HeaperMemory } from '../heaper/types.js';
import { createNotificationOutboxBlock } from '../notifications/outbox.js';
import { decideNotification, type NotificationIntent } from '../notifications/policy.js';
import { createRuntimeBlockerBlock } from '../runtime/blockers.js';
import { RuntimeBlockedError, runRuntimeEvent, type RunRuntimeEventInput } from '../runtime/orchestrator.js';
import {
  linkTaskBlocker,
  linkTaskResult,
  queryResumableTasks,
  transitionTaskBlock,
  type TaskBlockData,
} from '../heaper/task-blocks.js';

export type TaskHandlerOutcome =
  | { status: 'done'; summary: string; notify?: boolean; refs?: BlockRef[] }
  | { status: 'blocked'; summary: string; reason: string; notify?: boolean; refs?: BlockRef[]; blockerRef?: BlockRef }
  | { status: 'running'; summary: string; notify?: boolean; refs?: BlockRef[] };

export interface ContinuationHandlerContext {
  memory: HeaperMemory;
  task: HeaperBlock<TaskBlockData>;
}

export type ContinuationTaskHandler = (context: ContinuationHandlerContext) => Promise<TaskHandlerOutcome> | TaskHandlerOutcome;

export interface RuntimeContinuationHandlerInput extends Omit<RunRuntimeEventInput, 'event'> {
  notify?: boolean;
}

export interface RunContinuationWorkerInput {
  memory: HeaperMemory;
  taskHeaps?: HeapName[];
  resultHeap: HeapName;
  blockerHeap?: HeapName;
  notificationOutboxHeap?: HeapName;
  limit?: number;
  now?: string;
  handleTask: ContinuationTaskHandler;
}

export interface ContinuationWorkerResult {
  processed: Array<{
    taskRef: BlockRef;
    status: TaskHandlerOutcome['status'];
    resultRef: BlockRef;
    blockerRef?: BlockRef;
    notificationOutboxRef?: BlockRef;
  }>;
  skipped: Array<{ taskRef: BlockRef; reason: string }>;
  notifications: NotificationIntent[];
}

/**
 * Minimal background continuation worker skeleton.
 *
 * It selects resumable task blocks, marks them running, writes a progress/result
 * block, links that result back to the task, and only emits notification intents
 * for milestone/blocker outcomes. Delivery is intentionally left to callers.
 */
export async function runContinuationWorker(input: RunContinuationWorkerInput): Promise<ContinuationWorkerResult> {
  const now = input.now ?? new Date().toISOString();
  const result: ContinuationWorkerResult = { processed: [], skipped: [], notifications: [] };
  const tasks = await queryResumableTasks({ memory: input.memory, heaps: input.taskHeaps, limit: input.limit });

  for (const task of tasks) {
    if (task.data.status === 'blocked') {
      result.skipped.push({ taskRef: refFor(task), reason: 'blocked' });
      continue;
    }

    const running = task.data.status === 'running'
      ? task
      : await transitionTaskBlock({ memory: input.memory, task, status: 'running', reason: 'continuation worker picked task', now });

    const outcome = await input.handleTask({ memory: input.memory, task: running });
    const outcomeRefs = outcome.refs ?? [];
    const resultBlock = await input.memory.createBlock({
      heap: input.resultHeap,
      type: 'text',
      data: {
        taskRef: refFor(running),
        status: outcome.status,
        summary: outcome.summary,
        reason: outcome.status === 'blocked' ? outcome.reason : undefined,
        runtimeRefs: outcomeRefs,
      },
      tags: ['task-result', `status:${outcome.status}`, `task:${running.id}`],
      links: dedupeRefs([refFor(running), ...outcomeRefs]),
      metadata: { source: 'continuation-worker', createdAt: now },
    });

    await linkTaskResult({ memory: input.memory, task: running, result: resultBlock });

    let blockerRef: BlockRef | undefined;
    if (outcome.status === 'done') {
      await transitionTaskBlock({ memory: input.memory, task: running, status: 'done', reason: outcome.summary, now });
    } else if (outcome.status === 'blocked') {
      if (outcome.blockerRef) {
        blockerRef = outcome.blockerRef;
        await input.memory.linkBlocks(blockerRef, refFor(resultBlock));
      } else {
        const blocker = await createRuntimeBlockerBlock({
          memory: input.memory,
          heap: input.blockerHeap ?? input.resultHeap,
          error: outcome.reason,
          operation: `continue task ${running.id}`,
          taskRef: refFor(running),
          originRefs: [refFor(resultBlock), ...outcomeRefs],
          nextAction: outcome.reason,
        });
        blockerRef = refFor(blocker);
      }
      await linkTaskBlocker({ memory: input.memory, task: running, blocker: blockerRef });
      await transitionTaskBlock({ memory: input.memory, task: running, status: 'blocked', reason: outcome.reason, now });
    }

    const notification = notificationFor(outcome, refFor(running), [refFor(resultBlock), ...(blockerRef ? [blockerRef] : [])]);
    const notificationOutbox = input.notificationOutboxHeap
      ? await createNotificationOutboxBlock({
        memory: input.memory,
        heap: input.notificationOutboxHeap,
        intent: notification,
        source: 'worker',
        refs: [refFor(running), refFor(resultBlock), ...(blockerRef ? [blockerRef] : [])],
        now,
      })
      : undefined;

    result.processed.push({
      taskRef: refFor(running),
      status: outcome.status,
      resultRef: refFor(resultBlock),
      blockerRef,
      notificationOutboxRef: notificationOutbox ? refFor(notificationOutbox) : undefined,
    });

    if (notification.action !== 'silent') result.notifications.push(notification);
  }

  return result;
}

export function createRuntimeContinuationHandler(input: RuntimeContinuationHandlerInput): ContinuationTaskHandler {
  return async ({ task }) => {
    const event = createBackgroundEvent({
      taskId: task.id,
      content: task.data.description || task.data.title,
      taskType: task.data.taskType,
      persona: task.data.owner.kind === 'persona' || task.data.owner.kind === 'agent' ? task.data.owner.name : undefined,
      sensitive: task.tags.includes('sensitive') || task.tags.includes('sensitivity:sensitive'),
      metadata: { taskRef: refFor(task) },
    });

    try {
      const outcome = await runRuntimeEvent({ ...input, event });
      const refs = runtimeRefs(outcome);
      return { status: 'done', summary: outcome.reply, notify: input.notify, refs };
    } catch (err) {
      if (err instanceof RuntimeBlockedError) {
        return {
          status: 'blocked',
          summary: err.message,
          reason: err.message,
          refs: err.notificationIntent.refs,
          blockerRef: err.blockerRef,
          notify: true,
        };
      }
      throw err;
    }
  };
}

function runtimeRefs(outcome: Awaited<ReturnType<typeof runRuntimeEvent>>): BlockRef[] {
  return dedupeRefs([
    outcome.eventRef,
    outcome.routeRef,
    outcome.modelDecisionRef,
    outcome.userMessageRef,
    outcome.assistantMessageRef,
    ...outcome.guardDecisionRefs,
    ...outcome.blockerRefs,
    ...(outcome.dailyContinuityRef ? [outcome.dailyContinuityRef] : []),
    ...(outcome.notificationOutboxRef ? [outcome.notificationOutboxRef] : []),
  ]);
}

function notificationFor(outcome: TaskHandlerOutcome, taskRef: BlockRef, refs: BlockRef[]): NotificationIntent {
  if (outcome.status === 'blocked') {
    return decideNotification({ mode: 'background', trigger: 'blocked', summary: outcome.reason, refs: [taskRef, ...refs] });
  }
  if (outcome.status === 'done' && outcome.notify) {
    return decideNotification({ mode: 'background', trigger: 'completed-milestone', summary: outcome.summary, refs: [taskRef, ...refs] });
  }
  return decideNotification({ mode: 'background', trigger: 'background-progress', summary: outcome.summary, refs: [taskRef, ...refs] });
}

function refFor(block: HeaperBlock): BlockRef {
  return { heap: block.heap, id: block.id };
}

function dedupeRefs(refs: BlockRef[]): BlockRef[] {
  const seen = new Set<string>();
  const result: BlockRef[] = [];
  for (const ref of refs) {
    const key = `${ref.heap}#${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ heap: ref.heap, id: ref.id });
  }
  return result;
}
