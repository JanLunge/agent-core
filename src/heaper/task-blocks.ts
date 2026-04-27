import type { BlockRef, HeapName, HeaperBlock, HeaperMemory } from './types.js';

export type TaskStatus = 'pending' | 'running' | 'done' | 'blocked' | 'cancelled';
export type TaskOwnerKind = 'agent' | 'persona' | 'human';

export interface TaskOwner extends Record<string, unknown> {
  kind: TaskOwnerKind;
  name: string;
}

export interface TaskBlockData extends Record<string, unknown> {
  title: string;
  description: string;
  taskType: string;
  status: TaskStatus;
  owner: TaskOwner;
  originSession?: BlockRef;
  resultRefs: BlockRef[];
  statusReason?: string;
  startedAt?: string;
  completedAt?: string;
  blockedAt?: string;
}

export interface CreateTaskBlockInput {
  memory: HeaperMemory;
  heap: HeapName;
  title: string;
  description: string;
  taskType: string;
  owner: TaskOwner;
  originSession?: BlockRef;
  tags?: string[];
}

export interface TransitionTaskInput {
  memory: HeaperMemory;
  task: BlockRef;
  status: TaskStatus;
  reason?: string;
  now?: string;
}

export interface LinkTaskResultInput {
  memory: HeaperMemory;
  task: BlockRef;
  result: BlockRef;
}

export interface QueryResumableTasksInput {
  memory: HeaperMemory;
  heaps?: HeapName[];
  limit?: number;
}

export async function createTaskBlock(input: CreateTaskBlockInput): Promise<HeaperBlock<TaskBlockData>> {
  const block = await input.memory.createBlock({
    heap: input.heap,
    type: 'task',
    data: {
      title: input.title,
      description: input.description,
      taskType: input.taskType,
      status: 'pending',
      owner: input.owner,
      originSession: input.originSession,
      resultRefs: [],
    },
    tags: ['task', 'status:pending', `task-type:${input.taskType}`, `owner:${input.owner.kind}:${input.owner.name}`, ...(input.tags ?? [])],
    links: input.originSession ? [input.originSession] : undefined,
  });

  return block as HeaperBlock<TaskBlockData>;
}

export async function transitionTaskBlock(input: TransitionTaskInput): Promise<HeaperBlock<TaskBlockData>> {
  const existing = await requireTask(input.memory, input.task);
  const now = input.now ?? new Date().toISOString();
  const timing = timingFor(input.status, now);

  const updated = await input.memory.updateBlock(input.task, {
    data: {
      status: input.status,
      statusReason: input.reason,
      ...timing,
    },
    tags: replaceStatusTag(existing.tags, input.status),
  });

  return updated as HeaperBlock<TaskBlockData>;
}

export async function linkTaskResult(input: LinkTaskResultInput): Promise<HeaperBlock<TaskBlockData>> {
  const existing = await requireTask(input.memory, input.task);
  const resultRefs = dedupeRefs([...(existing.data.resultRefs ?? []), input.result]);
  const updated = await input.memory.updateBlock(input.task, {
    data: { resultRefs },
    links: dedupeRefs([...(existing.links ?? []), input.result]),
  });
  await input.memory.linkBlocks(input.task, input.result);
  return updated as HeaperBlock<TaskBlockData>;
}

export async function queryResumableTasks(input: QueryResumableTasksInput): Promise<HeaperBlock<TaskBlockData>[]> {
  const tasks = await input.memory.search('', {
    heaps: input.heaps,
    types: ['task'],
    limit: input.limit,
  });

  return tasks
    .filter((task): task is HeaperBlock<TaskBlockData> => isTaskBlock(task))
    .filter((task) => task.data.status === 'pending' || task.data.status === 'running')
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
}

async function requireTask(memory: HeaperMemory, ref: BlockRef): Promise<HeaperBlock<TaskBlockData>> {
  const block = await memory.getBlock(ref);
  if (!block) throw new Error(`Task block not found: ${ref.heap}#${ref.id}`);
  if (!isTaskBlock(block)) throw new Error(`Block is not a task: ${ref.heap}#${ref.id}`);
  return block;
}

function isTaskBlock(block: HeaperBlock): block is HeaperBlock<TaskBlockData> {
  return block.type === 'task' && typeof block.data.status === 'string';
}

function replaceStatusTag(tags: string[], status: TaskStatus): string[] {
  return [...tags.filter((tag) => !tag.startsWith('status:')), `status:${status}`];
}

function timingFor(status: TaskStatus, now: string): Partial<TaskBlockData> {
  if (status === 'running') return { startedAt: now };
  if (status === 'done' || status === 'cancelled') return { completedAt: now };
  if (status === 'blocked') return { blockedAt: now };
  return {};
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
