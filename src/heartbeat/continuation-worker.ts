import type { BlockRef, HeapName, HeaperBlock, HeaperMemory } from '../heaper/types.js';
import { decideNotification, type NotificationIntent } from '../notifications/policy.js';
import { createRuntimeBlockerBlock } from '../runtime/blockers.js';
import {
  linkTaskBlocker,
  linkTaskResult,
  queryResumableTasks,
  transitionTaskBlock,
  type TaskBlockData,
} from '../heaper/task-blocks.js';

export type TaskHandlerOutcome =
  | { status: 'done'; summary: string; notify?: boolean }
  | { status: 'blocked'; summary: string; reason: string; notify?: boolean }
  | { status: 'running'; summary: string; notify?: boolean };

export interface ContinuationHandlerContext {
  memory: HeaperMemory;
  task: HeaperBlock<TaskBlockData>;
}

export type ContinuationTaskHandler = (context: ContinuationHandlerContext) => Promise<TaskHandlerOutcome> | TaskHandlerOutcome;

export interface RunContinuationWorkerInput {
  memory: HeaperMemory;
  taskHeaps?: HeapName[];
  resultHeap: HeapName;
  blockerHeap?: HeapName;
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
    const resultBlock = await input.memory.createBlock({
      heap: input.resultHeap,
      type: 'text',
      data: {
        taskRef: refFor(running),
        status: outcome.status,
        summary: outcome.summary,
        reason: outcome.status === 'blocked' ? outcome.reason : undefined,
      },
      tags: ['task-result', `status:${outcome.status}`, `task:${running.id}`],
      links: [refFor(running)],
      metadata: { source: 'continuation-worker', createdAt: now },
    });

    await linkTaskResult({ memory: input.memory, task: running, result: resultBlock });

    let blockerRef: BlockRef | undefined;
    if (outcome.status === 'done') {
      await transitionTaskBlock({ memory: input.memory, task: running, status: 'done', reason: outcome.summary, now });
    } else if (outcome.status === 'blocked') {
      const blocker = await createRuntimeBlockerBlock({
        memory: input.memory,
        heap: input.blockerHeap ?? input.resultHeap,
        error: outcome.reason,
        operation: `continue task ${running.id}`,
        taskRef: refFor(running),
        originRefs: [refFor(resultBlock)],
        nextAction: outcome.reason,
      });
      blockerRef = refFor(blocker);
      await linkTaskBlocker({ memory: input.memory, task: running, blocker: blockerRef });
      await transitionTaskBlock({ memory: input.memory, task: running, status: 'blocked', reason: outcome.reason, now });
    }

    result.processed.push({ taskRef: refFor(running), status: outcome.status, resultRef: refFor(resultBlock), blockerRef });

    const notification = notificationFor(outcome, refFor(running), [refFor(resultBlock), ...(blockerRef ? [blockerRef] : [])]);
    if (notification.action !== 'silent') result.notifications.push(notification);
  }

  return result;
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
