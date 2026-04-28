import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import { decideNotification } from './policy.js';
import {
  cancelNotificationOutboxBlock,
  createNotificationOutboxBlock,
  markNotificationDelivered,
  markNotificationFailed,
} from './outbox.js';

const taskRef = { heap: 'agent/tasks' as const, id: 'task-1' };
const resultRef = { heap: 'agent/results' as const, id: 'result-1' };

describe('notification outbox blocks', () => {
  it('stores runtime notification intents as queued auditable outbox blocks', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'notify', now: () => '2026-04-28T22:00:00.000Z' });
    const intent = decideNotification({
      mode: 'live',
      trigger: 'live-response',
      summary: 'Here is the live response.',
      refs: [taskRef, resultRef, taskRef],
    });

    const block = await createNotificationOutboxBlock({
      memory,
      heap: 'agent/notifications',
      intent,
      source: 'runtime',
      deliveryTarget: 'telegram:jan',
      now: '2026-04-28T22:00:01.000Z',
    });

    expect(block).toMatchObject({
      heap: 'agent/notifications',
      type: 'metadata',
      tags: [
        'notification-outbox',
        'status:queued',
        'action:direct-response',
        'priority:normal',
        'audience:human',
        'source:runtime',
      ],
      data: {
        status: 'queued',
        intent,
        source: 'runtime',
        deliveryTarget: 'telegram:jan',
        createdAt: '2026-04-28T22:00:01.000Z',
      },
      links: [taskRef, resultRef],
      metadata: { source: 'notification-outbox', deliveryAttempted: false },
    });
  });

  it('stores worker milestone notifications and records delivery state transitions', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'notify' });
    const intent = decideNotification({
      mode: 'background',
      trigger: 'completed-milestone',
      summary: 'Slice completed.',
      refs: [taskRef],
    });
    const block = await createNotificationOutboxBlock({ memory, heap: 'agent/notifications', intent, source: 'worker' });

    const delivered = await markNotificationDelivered({
      memory,
      notificationRef: { heap: block.heap, id: block.id },
      receipt: 'telegram-message-123',
      now: '2026-04-28T22:01:00.000Z',
    });

    expect(delivered.data).toMatchObject({
      status: 'delivered',
      deliveredAt: '2026-04-28T22:01:00.000Z',
      deliveryReceipt: 'telegram-message-123',
    });
    expect(delivered.tags).toEqual(expect.arrayContaining(['notification-outbox', 'status:delivered', 'source:worker']));
    expect(delivered.tags).not.toContain('status:queued');
    expect(delivered.metadata).toMatchObject({ deliveryAttempted: true });
  });

  it('summarizes silent intents without queueing them for delivery', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'notify' });
    const intent = decideNotification({
      mode: 'background',
      trigger: 'background-progress',
      summary: 'Quiet progress.',
      refs: [taskRef],
    });

    const block = await createNotificationOutboxBlock({ memory, heap: 'agent/notifications', intent, source: 'worker' });

    expect(block.data).toMatchObject({ status: 'summarized', intent });
    expect(block.tags).toEqual(expect.arrayContaining(['status:summarized', 'action:silent']));
    await expect(markNotificationDelivered({ memory, notificationRef: { heap: block.heap, id: block.id } })).rejects.toThrow(
      'Only queued notifications can be delivered',
    );
  });

  it('records failed delivery and allows cancelling non-delivered notifications', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'notify' });
    const intent = decideNotification({ mode: 'async', trigger: 'failed', summary: 'Delivery target unavailable.', refs: [taskRef] });
    const failedBlock = await createNotificationOutboxBlock({ memory, heap: 'agent/notifications', intent, source: 'system' });

    const failed = await markNotificationFailed({
      memory,
      notificationRef: { heap: failedBlock.heap, id: failedBlock.id },
      reason: 'provider timeout',
      now: '2026-04-28T22:02:00.000Z',
    });
    expect(failed.data).toMatchObject({ status: 'failed', failedAt: '2026-04-28T22:02:00.000Z', failureReason: 'provider timeout' });
    expect(failed.tags).toEqual(expect.arrayContaining(['status:failed']));

    const cancellable = await createNotificationOutboxBlock({ memory, heap: 'agent/notifications', intent, source: 'system' });
    const cancelled = await cancelNotificationOutboxBlock({
      memory,
      notificationRef: { heap: cancellable.heap, id: cancellable.id },
      now: '2026-04-28T22:03:00.000Z',
    });
    expect(cancelled.data).toMatchObject({ status: 'cancelled', cancelledAt: '2026-04-28T22:03:00.000Z' });

    await expect(cancelNotificationOutboxBlock({ memory, notificationRef: { heap: failed.heap, id: failed.id } })).resolves.toMatchObject({
      data: { status: 'cancelled' },
    });
  });
});
