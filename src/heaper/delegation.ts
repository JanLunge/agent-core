import type { BlockRef, HeapName, HeaperBlock, HeaperMemory } from './types.js';
import { canReadBlockForPersona, normalizePersonaName, resolvePersonaHeaps } from './persona-resolver.js';
import { createTaskBlock, linkTaskResult, type TaskBlockData } from './task-blocks.js';

export interface DelegationTaskData extends TaskBlockData {
  delegateTo: string;
  delegatedBy: string;
  originRefs: BlockRef[];
  permittedRefs: BlockRef[];
  withheldRefs: BlockRef[];
}

export interface CreateDelegationTaskInput {
  memory: HeaperMemory;
  title: string;
  description: string;
  delegatedBy: string;
  delegateTo: string;
  originSession?: BlockRef;
  originTask?: BlockRef;
  originRefs?: BlockRef[];
  heap?: HeapName;
}

export interface DelegatedWorkerContext {
  task: HeaperBlock<DelegationTaskData>;
  visibleRefs: BlockRef[];
  withheldRefs: BlockRef[];
  visibleBlocks: HeaperBlock[];
}

export interface LinkDelegationResultInput {
  memory: HeaperMemory;
  delegationTask: BlockRef;
  result: BlockRef;
}

export async function createDelegationTask(input: CreateDelegationTaskInput): Promise<HeaperBlock<DelegationTaskData>> {
  const delegateTo = normalizePersonaName(input.delegateTo);
  const delegatedBy = normalizePersonaName(input.delegatedBy);
  const heap = input.heap ?? resolvePersonaHeaps(delegateTo).tasks;
  const originRefs = dedupeRefs([input.originSession, input.originTask, ...(input.originRefs ?? [])].filter((ref): ref is BlockRef => Boolean(ref)));
  const { permittedRefs, withheldRefs } = await partitionRefsForDelegate(input.memory, delegateTo, originRefs);

  const task = await createTaskBlock({
    memory: input.memory,
    heap,
    title: input.title,
    description: input.description,
    taskType: 'delegation',
    owner: { kind: 'persona', name: delegateTo },
    originSession: input.originSession,
    tags: ['delegation', `delegated-to:${delegateTo}`, `delegated-by:${delegatedBy}`],
  });

  const links = dedupeRefs(permittedRefs);
  const updated = await input.memory.updateBlock(task, {
    data: {
      delegateTo,
      delegatedBy,
      originRefs,
      permittedRefs,
      withheldRefs,
    },
    links,
  });

  for (const ref of permittedRefs) await input.memory.linkBlocks(task, ref);
  return updated as HeaperBlock<DelegationTaskData>;
}

export async function getDelegatedWorkerContext(
  memory: HeaperMemory,
  taskRef: BlockRef,
): Promise<DelegatedWorkerContext> {
  const task = await requireDelegationTask(memory, taskRef);
  const visibleBlocks = (await Promise.all(task.data.permittedRefs.map((ref) => memory.getBlock(ref)))).filter(
    (block): block is HeaperBlock => Boolean(block),
  );

  return {
    task,
    visibleRefs: task.data.permittedRefs.map(cloneRef),
    withheldRefs: task.data.withheldRefs.map(cloneRef),
    visibleBlocks,
  };
}

export async function linkDelegationResult(input: LinkDelegationResultInput): Promise<HeaperBlock<DelegationTaskData>> {
  const task = await requireDelegationTask(input.memory, input.delegationTask);
  const updated = await linkTaskResult({ memory: input.memory, task: input.delegationTask, result: input.result });

  for (const ref of [task.data.originSession, ...task.data.originRefs].filter((ref): ref is BlockRef => Boolean(ref))) {
    await input.memory.linkBlocks(input.result, ref);
  }

  return updated as HeaperBlock<DelegationTaskData>;
}

async function partitionRefsForDelegate(
  memory: HeaperMemory,
  delegateTo: string,
  refs: BlockRef[],
): Promise<{ permittedRefs: BlockRef[]; withheldRefs: BlockRef[] }> {
  const permittedRefs: BlockRef[] = [];
  const withheldRefs: BlockRef[] = [];

  for (const ref of refs) {
    const block = await memory.getBlock(ref);
    if (!block) {
      withheldRefs.push(cloneRef(ref));
      continue;
    }
    if (canReadBlockForPersona({ persona: delegateTo, ref, tags: block.tags, linkedRefs: block.links })) {
      permittedRefs.push(cloneRef(ref));
    } else {
      withheldRefs.push(cloneRef(ref));
    }
  }

  return { permittedRefs: dedupeRefs(permittedRefs), withheldRefs: dedupeRefs(withheldRefs) };
}

async function requireDelegationTask(memory: HeaperMemory, ref: BlockRef): Promise<HeaperBlock<DelegationTaskData>> {
  const block = await memory.getBlock(ref);
  if (!block) throw new Error(`Delegation task not found: ${ref.heap}#${ref.id}`);
  if (block.type !== 'task' || block.data.taskType !== 'delegation') {
    throw new Error(`Block is not a delegation task: ${ref.heap}#${ref.id}`);
  }
  return block as HeaperBlock<DelegationTaskData>;
}

function dedupeRefs(refs: BlockRef[]): BlockRef[] {
  const seen = new Set<string>();
  const result: BlockRef[] = [];
  for (const ref of refs) {
    const key = `${ref.heap}#${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cloneRef(ref));
  }
  return result;
}

function cloneRef(ref: BlockRef): BlockRef {
  return { heap: ref.heap, id: ref.id };
}
