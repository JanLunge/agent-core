import { createTaskBlock, type TaskOwner } from '../heaper/task-blocks.js';
import type { BlockRef, HeapName, HeaperBlock, HeaperMemory } from '../heaper/types.js';
import type { GuardDecision, GuardRequest } from './guard.js';

export type ApprovalRequestStatus = 'pending' | 'approved' | 'denied' | 'applied' | 'cancelled';

export interface ProposedOperation extends Record<string, unknown> {
  surface: GuardRequest['surface'];
  action: GuardRequest['action'];
  target: string;
  command?: string;
  args?: Record<string, unknown>;
}

export interface ApprovalRequestData extends Record<string, unknown> {
  status: ApprovalRequestStatus;
  reason: string;
  proposedOperation: ProposedOperation;
  guardAudit: GuardDecision['audit'];
  exactRequest: GuardRequest;
  requester: string;
  createdForSession?: BlockRef;
  createdForTask?: BlockRef;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
  appliedAt?: string;
  resumeRef?: BlockRef;
  appliedResultRefs?: BlockRef[];
}

export interface CreateApprovalRequestBlockInput {
  memory: HeaperMemory;
  heap: HeapName;
  guardDecision: GuardDecision;
  requester: string;
  sessionRef?: BlockRef;
  taskRef?: BlockRef;
  originRefs?: BlockRef[];
  auditRefs?: BlockRef[];
  args?: Record<string, unknown>;
}

export interface DecideApprovalRequestInput {
  memory: HeaperMemory;
  approvalRef: BlockRef;
  decision: 'approved' | 'denied' | 'cancelled';
  decidedBy: string;
  reason?: string;
  now?: string;
}

export interface ApplyApprovalRequestInput {
  memory: HeaperMemory;
  approvalRef: BlockRef;
  resumeRef?: BlockRef;
  resultRefs?: BlockRef[];
  now?: string;
}

export interface CreateApprovalResumeTaskInput {
  memory: HeaperMemory;
  approvalRef: BlockRef;
  taskHeap: HeapName;
  owner: TaskOwner;
  now?: string;
}

export async function createApprovalRequestBlock(
  input: CreateApprovalRequestBlockInput,
): Promise<HeaperBlock<ApprovalRequestData>> {
  if (input.guardDecision.disposition !== 'ask') {
    throw new Error(`Approval request requires an ask guard decision, got ${input.guardDecision.disposition}`);
  }

  const data: ApprovalRequestData = {
    status: 'pending',
    reason: input.guardDecision.reason,
    proposedOperation: {
      surface: input.guardDecision.request.surface,
      action: input.guardDecision.request.action,
      target: input.guardDecision.request.target,
      command: input.guardDecision.request.command,
      args: input.args,
    },
    guardAudit: input.guardDecision.audit,
    exactRequest: input.guardDecision.request,
    requester: input.requester,
    createdForSession: input.sessionRef,
    createdForTask: input.taskRef,
  };

  return (await input.memory.createBlock({
    heap: input.heap,
    type: 'proposal',
    data,
    tags: [
      'approval-request',
      'status:pending',
      `surface:${input.guardDecision.request.surface}`,
      `action:${input.guardDecision.request.action}`,
      `requester:${input.requester}`,
      ...(input.sessionRef ? [`session:${input.sessionRef.id}`] : []),
      ...(input.taskRef ? [`task:${input.taskRef.id}`] : []),
    ],
    links: dedupeRefs([
      input.sessionRef,
      input.taskRef,
      ...(input.originRefs ?? []),
      ...(input.auditRefs ?? []),
    ].filter((ref): ref is BlockRef => Boolean(ref))),
    metadata: { source: 'approval-request-model', exactOperationCaptured: true },
  })) as HeaperBlock<ApprovalRequestData>;
}

export async function decideApprovalRequest(
  input: DecideApprovalRequestInput,
): Promise<HeaperBlock<ApprovalRequestData>> {
  const existing = await requireApproval(input.memory, input.approvalRef);
  if (existing.data.status !== 'pending') {
    throw new Error(`Approval request is not pending: ${existing.data.status}`);
  }

  const updated = await input.memory.updateBlock(input.approvalRef, {
    data: {
      status: input.decision,
      decidedAt: input.now ?? new Date().toISOString(),
      decidedBy: input.decidedBy,
      decisionReason: input.reason,
    },
    tags: replaceStatusTag(existing.tags, input.decision),
  });

  return updated as HeaperBlock<ApprovalRequestData>;
}

export async function markApprovalApplied(
  input: ApplyApprovalRequestInput,
): Promise<HeaperBlock<ApprovalRequestData>> {
  const existing = await requireApprovedApproval(input.memory, input.approvalRef);

  const resultRefs = input.resultRefs ?? [];
  const links = dedupeRefs([
    ...(existing.links ?? []),
    existing.data.createdForSession,
    input.resumeRef,
    ...resultRefs,
  ].filter((ref): ref is BlockRef => Boolean(ref)));
  const updated = await input.memory.updateBlock(input.approvalRef, {
    data: {
      status: 'applied',
      appliedAt: input.now ?? new Date().toISOString(),
      resumeRef: input.resumeRef,
      appliedResultRefs: resultRefs,
    },
    tags: replaceStatusTag(existing.tags, 'applied'),
    links,
  });

  for (const ref of [input.resumeRef, ...resultRefs].filter((ref): ref is BlockRef => Boolean(ref))) {
    await input.memory.linkBlocks(input.approvalRef, ref);
  }
  return updated as HeaperBlock<ApprovalRequestData>;
}

export async function createApprovalResumeTask(
  input: CreateApprovalResumeTaskInput,
): Promise<{ task: HeaperBlock; approval: HeaperBlock<ApprovalRequestData> }> {
  const approval = await requireApprovedApproval(input.memory, input.approvalRef);
  const operation = approval.data.proposedOperation;
  const task = await createTaskBlock({
    memory: input.memory,
    heap: input.taskHeap,
    title: `Resume approved ${operation.surface} ${operation.action}`,
    description: `Apply approved operation for ${operation.target}`,
    taskType: 'approval-resume',
    owner: input.owner,
    originSession: approval.data.createdForSession,
    tags: [`approval:${input.approvalRef.id}`, `surface:${operation.surface}`, `action:${operation.action}`],
  });
  await input.memory.linkBlocks(input.approvalRef, { heap: task.heap, id: task.id });
  const applied = await markApprovalApplied({
    memory: input.memory,
    approvalRef: input.approvalRef,
    resumeRef: { heap: task.heap, id: task.id },
    now: input.now,
  });
  return { task, approval: applied };
}

async function requireApproval(memory: HeaperMemory, ref: BlockRef): Promise<HeaperBlock<ApprovalRequestData>> {
  const block = await memory.getBlock(ref);
  if (!block) throw new Error(`Approval request not found: ${ref.heap}#${ref.id}`);
  if (block.type !== 'proposal' || !block.tags.includes('approval-request')) {
    throw new Error(`Block is not an approval request: ${ref.heap}#${ref.id}`);
  }
  return block as HeaperBlock<ApprovalRequestData>;
}

async function requireApprovedApproval(memory: HeaperMemory, ref: BlockRef): Promise<HeaperBlock<ApprovalRequestData>> {
  const existing = await requireApproval(memory, ref);
  if (existing.data.status !== 'approved') {
    throw new Error(`Only approved requests can be applied, got ${existing.data.status}`);
  }
  return existing;
}

function replaceStatusTag(tags: string[], status: ApprovalRequestStatus): string[] {
  return [...tags.filter((tag) => !tag.startsWith('status:')), `status:${status}`];
}

function dedupeRefs(refs: BlockRef[]): BlockRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.heap}#${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
