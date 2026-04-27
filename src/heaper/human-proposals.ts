import { decideHeapPermission, type HeapActor } from './permissions.js';
import type { BlockRef, BlockType, CreateBlockInput, HeapName, HeaperBlock, HeaperMemory, UpdateBlockInput } from './types.js';

export type HumanMutationKind = 'create' | 'update';

export interface HumanHeapMutationInput {
  memory: HeaperMemory;
  actor: HeapActor;
  mutation: HumanMutationKind;
  targetHeap: HeapName;
  targetRef?: BlockRef;
  blockType?: BlockType;
  create?: Omit<CreateBlockInput, 'heap' | 'type'>;
  update?: UpdateBlockInput;
  originRef?: BlockRef;
  proposalHeap?: HeapName;
  explicitApproval?: boolean;
  tags?: string[];
}

export interface HumanProposalData extends Record<string, unknown> {
  status: 'pending';
  actor: HeapActor;
  mutation: HumanMutationKind;
  targetHeap: HeapName;
  targetRef?: BlockRef;
  blockType?: BlockType;
  create?: Omit<CreateBlockInput, 'heap' | 'type'>;
  update?: UpdateBlockInput;
  originRef?: BlockRef;
  reason: string;
}

export type HumanHeapMutationResult =
  | { action: 'applied'; block: HeaperBlock; proposal?: undefined }
  | { action: 'proposed'; proposal: HeaperBlock<HumanProposalData>; block?: undefined };

const DEFAULT_PROPOSAL_HEAP: HeapName = 'agent/proposals';

/**
 * Applies or proposes a human-heap mutation according to heap permissions.
 *
 * Agents can read human heaps but unapproved mutations become proposal blocks.
 * Approved or pre-approved (`bot-editable`) mutations are applied directly.
 */
export async function mutateHumanHeap(input: HumanHeapMutationInput): Promise<HumanHeapMutationResult> {
  const permission = decideHeapPermission({
    actor: input.actor,
    heap: input.targetHeap,
    action: input.mutation === 'create' ? 'write' : 'update',
    tags: input.tags,
    explicitApproval: input.explicitApproval,
  });

  if (permission === 'allow') {
    return { action: 'applied', block: await applyMutation(input) };
  }

  if (permission === 'ask') {
    return { action: 'proposed', proposal: await createProposal(input, 'human-heap-mutation-requires-approval') };
  }

  throw new Error(`Human heap mutation denied for ${input.targetHeap}`);
}

async function applyMutation(input: HumanHeapMutationInput): Promise<HeaperBlock> {
  if (input.mutation === 'create') {
    if (!input.blockType) throw new Error('blockType is required for human heap create');
    return input.memory.createBlock({
      heap: input.targetHeap,
      type: input.blockType,
      data: input.create?.data ?? {},
      tags: mergeTags(input.create?.tags, input.tags),
      links: mergeRefs(input.create?.links, input.originRef ? [input.originRef] : undefined),
      metadata: input.create?.metadata,
    });
  }

  if (!input.targetRef) throw new Error('targetRef is required for human heap update');
  return input.memory.updateBlock(input.targetRef, {
    data: input.update?.data,
    tags: input.update?.tags ?? input.tags,
    links: mergeRefs(input.update?.links, input.originRef ? [input.originRef] : undefined),
    metadata: input.update?.metadata,
  });
}

async function createProposal(input: HumanHeapMutationInput, reason: string): Promise<HeaperBlock<HumanProposalData>> {
  const links = [input.targetRef, input.originRef].filter((ref): ref is BlockRef => Boolean(ref));
  const proposal = await input.memory.createBlock({
    heap: input.proposalHeap ?? DEFAULT_PROPOSAL_HEAP,
    type: 'proposal',
    data: {
      status: 'pending',
      actor: input.actor,
      mutation: input.mutation,
      targetHeap: input.targetHeap,
      targetRef: input.targetRef,
      blockType: input.blockType,
      create: input.create,
      update: input.update,
      originRef: input.originRef,
      reason,
    },
    tags: ['proposal', 'human-heap-write', `actor:${input.actor.kind}:${input.actor.name}`, `target:${input.targetHeap}`],
    links: links.length > 0 ? links : undefined,
    metadata: { source: 'human-heap-proposal-flow' },
  });

  return proposal as HeaperBlock<HumanProposalData>;
}

function mergeTags(a?: string[], b?: string[]): string[] | undefined {
  const merged = [...(a ?? []), ...(b ?? [])];
  return merged.length > 0 ? Array.from(new Set(merged)) : undefined;
}

function mergeRefs(a?: BlockRef[], b?: BlockRef[]): BlockRef[] | undefined {
  const refs = [...(a ?? []), ...(b ?? [])];
  if (refs.length === 0) return undefined;
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.heap}#${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
