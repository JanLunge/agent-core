import type { BlockRef, HeapName, HeaperBlock } from '../heaper/types.js';
import { LocalHeaperMemory } from '../heaper/local-storage.js';
import type { TaskBlockData } from '../heaper/task-blocks.js';
import type { ApprovalRequestData, ProposedOperation } from '../tools/approval-requests.js';

export interface RunTaskResumeOptions {
  storePath: string;
  taskHeaps?: HeapName[];
  approvalHeaps?: HeapName[];
  markReady?: boolean;
  now?: string;
}

export interface ApprovalResumeItem {
  taskRef: BlockRef;
  approvalRef?: BlockRef;
  status: string;
  title: string;
  operation?: ProposedOperation;
  ready: boolean;
}

export interface TaskResumeSummary {
  storePath: string;
  generatedAt: string;
  items: ApprovalResumeItem[];
  lines: string[];
}

export async function runTaskResume(options: RunTaskResumeOptions): Promise<TaskResumeSummary> {
  const memory = new LocalHeaperMemory({ filePath: options.storePath });
  const tasks = (await memory.search('', { heaps: options.taskHeaps, types: ['task'], limit: Number.POSITIVE_INFINITY }))
    .filter(isApprovalResumeTask)
    .filter((task) => task.data.status === 'pending')
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));

  const items: ApprovalResumeItem[] = [];
  for (const task of tasks) {
    const approval = await findApprovalForTask(memory, task, options.approvalHeaps);
    const ready = task.tags.includes('approval-resume-ready');
    if (options.markReady && !ready) {
      await memory.updateBlock(refFor(task), {
        data: { status: 'pending', statusReason: 'ready for continuation after approval' },
        tags: [...task.tags, 'approval-resume-ready'],
      });
    }
    items.push({
      taskRef: refFor(task),
      approvalRef: approval ? refFor(approval) : undefined,
      status: task.data.status,
      title: task.data.title,
      operation: approval?.data.proposedOperation,
      ready: options.markReady ? true : ready,
    });
  }

  const summary: TaskResumeSummary = {
    storePath: options.storePath,
    generatedAt: options.now ?? new Date().toISOString(),
    items,
    lines: [],
  };
  summary.lines = renderTaskResumeSummary(summary, { markedReady: Boolean(options.markReady) });
  return summary;
}

export function renderTaskResumeSummary(summary: TaskResumeSummary, options: { markedReady?: boolean } = {}): string[] {
  return [
    `Approval-resume tasks for ${summary.storePath}`,
    `Generated: ${summary.generatedAt}`,
    `Pending approval-resume tasks: ${summary.items.length}`,
    ...(summary.items.length === 0 ? ['- none'] : summary.items.flatMap((item) => renderItem(item, options))),
  ];
}

function renderItem(item: ApprovalResumeItem, options: { markedReady?: boolean }): string[] {
  const op = item.operation;
  return [
    `- task: ${formatRef(item.taskRef)} (${item.title})`,
    `  status: ${item.status}${item.ready ? ' ready' : ''}`,
    `  approval: ${item.approvalRef ? formatRef(item.approvalRef) : 'missing'}`,
    `  operation: ${op ? `${op.surface} ${op.action} ${op.target}` : 'unknown'}`,
    ...(op?.command ? [`  command: ${op.command}`] : []),
    ...(op?.args ? [`  args: ${JSON.stringify(op.args)}`] : []),
    `  safe: inspection only; no approved operation was executed${options.markedReady ? ', task marked ready for continuation' : ''}`,
  ];
}

async function findApprovalForTask(
  memory: LocalHeaperMemory,
  task: HeaperBlock<TaskBlockData>,
  approvalHeaps?: HeapName[],
): Promise<HeaperBlock<ApprovalRequestData> | undefined> {
  const approvalId = task.tags.find((tag) => tag.startsWith('approval:'))?.slice('approval:'.length);
  const related = await memory.getRelatedBlocks(refFor(task));
  const candidates = [
    ...related,
    ...(approvalId ? await memory.search('', { heaps: approvalHeaps, types: ['proposal'], limit: Number.POSITIVE_INFINITY }) : []),
  ];
  return candidates.find((block): block is HeaperBlock<ApprovalRequestData> => (
    block.type === 'proposal'
    && block.tags.includes('approval-request')
    && (block.data.resumeRef as BlockRef | undefined)?.id === task.id
    && (!approvalId || block.id === approvalId)
  ));
}

function isApprovalResumeTask(block: HeaperBlock): block is HeaperBlock<TaskBlockData> {
  return block.type === 'task' && block.tags.includes('task-type:approval-resume') && block.tags.includes('task');
}

function refFor(block: HeaperBlock): BlockRef {
  return { heap: block.heap, id: block.id };
}

function formatRef(ref: BlockRef): string {
  return `${ref.heap}#${ref.id}`;
}
