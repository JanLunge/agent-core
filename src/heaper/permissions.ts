import { parseHeapName, type HeapName } from './types.js';

export type ActorKind = 'human' | 'agent';
export type HeapAction = 'read' | 'write' | 'update' | 'link';
export type PermissionDecision = 'allow' | 'ask' | 'deny';

export interface HeapActor {
  kind: ActorKind;
  name: string;
  persona?: string;
}

export interface HeapPermissionContext {
  actor: HeapActor;
  heap: HeapName;
  action: HeapAction;
  tags?: string[];
  explicitApproval?: boolean;
}

/**
 * Enforces Jan's current boundary:
 * - humans are admins;
 * - agents can write agent/* and persona/*;
 * - agents can read human/*;
 * - agents can mutate human/* only with explicit approval or #bot-editable.
 */
export function decideHeapPermission(ctx: HeapPermissionContext): PermissionDecision {
  if (ctx.actor.kind === 'human') return 'allow';

  const heap = parseHeapName(ctx.heap);

  if (heap.scope === 'agent' || heap.scope === 'persona') {
    return 'allow';
  }

  if (heap.scope === 'human') {
    if (ctx.action === 'read') return 'allow';
    if (ctx.explicitApproval || ctx.tags?.includes('bot-editable')) return 'allow';
    return 'ask';
  }

  return 'deny';
}
