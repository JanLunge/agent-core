import type { BlockRef, HeapName, HeaperBlock, HeaperMemory } from '../heaper/types.js';
import type { NotificationIntent } from './policy.js';

export type NotificationOutboxStatus = 'queued' | 'summarized' | 'delivered' | 'cancelled' | 'failed';

export interface NotificationOutboxData extends Record<string, unknown> {
  status: NotificationOutboxStatus;
  intent: NotificationIntent;
  source: 'runtime' | 'worker' | 'system';
  deliveryTarget?: string;
  createdAt: string;
  deliveredAt?: string;
  cancelledAt?: string;
  failedAt?: string;
  deliveryReceipt?: string;
  failureReason?: string;
}

export interface CreateNotificationOutboxBlockInput {
  memory: HeaperMemory;
  heap: HeapName;
  intent: NotificationIntent;
  source: NotificationOutboxData['source'];
  deliveryTarget?: string;
  now?: string;
  refs?: BlockRef[];
}

export interface TransitionNotificationOutboxInput {
  memory: HeaperMemory;
  notificationRef: BlockRef;
  now?: string;
}

export interface MarkNotificationDeliveredInput extends TransitionNotificationOutboxInput {
  receipt?: string;
}

export interface MarkNotificationFailedInput extends TransitionNotificationOutboxInput {
  reason: string;
}

/**
 * Persist a notification decision before any delivery attempt.
 *
 * Silent intents are still auditable, but they are stored as `summarized` rather
 * than `queued` so a delivery worker can skip them without losing the trace.
 */
export async function createNotificationOutboxBlock(
  input: CreateNotificationOutboxBlockInput,
): Promise<HeaperBlock<NotificationOutboxData>> {
  const status: NotificationOutboxStatus = input.intent.action === 'silent' ? 'summarized' : 'queued';
  const now = input.now ?? new Date().toISOString();
  const refs = dedupeRefs([...(input.intent.refs ?? []), ...(input.refs ?? [])]);

  return (await input.memory.createBlock({
    heap: input.heap,
    type: 'metadata',
    data: {
      status,
      intent: input.intent,
      source: input.source,
      deliveryTarget: input.deliveryTarget,
      createdAt: now,
    },
    tags: [
      'notification-outbox',
      `status:${status}`,
      `action:${input.intent.action}`,
      `priority:${input.intent.priority}`,
      `audience:${input.intent.audience}`,
      `source:${input.source}`,
    ],
    links: refs,
    metadata: { source: 'notification-outbox', deliveryAttempted: false },
  })) as HeaperBlock<NotificationOutboxData>;
}

export async function markNotificationDelivered(
  input: MarkNotificationDeliveredInput,
): Promise<HeaperBlock<NotificationOutboxData>> {
  const existing = await requireNotificationOutbox(input.memory, input.notificationRef);
  if (existing.data.status !== 'queued') {
    throw new Error(`Only queued notifications can be delivered, got ${existing.data.status}`);
  }

  return (await input.memory.updateBlock(input.notificationRef, {
    data: {
      status: 'delivered',
      deliveredAt: input.now ?? new Date().toISOString(),
      deliveryReceipt: input.receipt,
    },
    tags: replaceStatusTag(existing.tags, 'delivered'),
    metadata: { deliveryAttempted: true },
  })) as HeaperBlock<NotificationOutboxData>;
}

export async function markNotificationFailed(
  input: MarkNotificationFailedInput,
): Promise<HeaperBlock<NotificationOutboxData>> {
  const existing = await requireNotificationOutbox(input.memory, input.notificationRef);
  if (existing.data.status !== 'queued') {
    throw new Error(`Only queued notifications can fail delivery, got ${existing.data.status}`);
  }

  return (await input.memory.updateBlock(input.notificationRef, {
    data: {
      status: 'failed',
      failedAt: input.now ?? new Date().toISOString(),
      failureReason: input.reason,
    },
    tags: replaceStatusTag(existing.tags, 'failed'),
    metadata: { deliveryAttempted: true },
  })) as HeaperBlock<NotificationOutboxData>;
}

export async function cancelNotificationOutboxBlock(
  input: TransitionNotificationOutboxInput,
): Promise<HeaperBlock<NotificationOutboxData>> {
  const existing = await requireNotificationOutbox(input.memory, input.notificationRef);
  if (existing.data.status === 'delivered') {
    throw new Error('Delivered notifications cannot be cancelled');
  }

  return (await input.memory.updateBlock(input.notificationRef, {
    data: {
      status: 'cancelled',
      cancelledAt: input.now ?? new Date().toISOString(),
    },
    tags: replaceStatusTag(existing.tags, 'cancelled'),
  })) as HeaperBlock<NotificationOutboxData>;
}

async function requireNotificationOutbox(memory: HeaperMemory, ref: BlockRef): Promise<HeaperBlock<NotificationOutboxData>> {
  const block = await memory.getBlock(ref);
  if (!block) throw new Error(`Notification outbox block not found: ${ref.heap}#${ref.id}`);
  if (block.type !== 'metadata' || !block.tags.includes('notification-outbox')) {
    throw new Error(`Block is not a notification outbox item: ${ref.heap}#${ref.id}`);
  }
  return block as HeaperBlock<NotificationOutboxData>;
}

function replaceStatusTag(tags: string[], status: NotificationOutboxStatus): string[] {
  return [...tags.filter((tag) => !tag.startsWith('status:')), `status:${status}`];
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
