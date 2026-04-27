import { describe, expect, it } from 'vitest';
import { createChatEvent } from '../events/index.js';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import type { RoutingDecision } from './router.js';
import { explainRouteHistory, queryRouteHistory, storeRouteDecision } from './route-history.js';

function decision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    eventId: 'evt-1',
    agentName: 'mira',
    persona: undefined,
    channelId: 'signal:jan',
    sessionId: 'session-1',
    mode: 'live',
    sensitivity: 'normal',
    modelPolicyHint: 'default',
    respondLive: true,
    reason: 'default-agent',
    ...overrides,
  };
}

describe('route history', () => {
  it('stores each route decision with event and session refs without copying event content', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block', now: () => '2026-04-27T20:00:00.000Z' });
    const event = createChatEvent({ id: 'evt-1', channelType: 'signal', chatId: 'jan', text: 'private content should not be copied' });
    const eventRef = { heap: 'agent/audit' as const, id: 'event-1' };
    const sessionRef = { heap: 'agent/sessions' as const, id: 'session-block-1' };

    const record = await storeRouteDecision({
      memory,
      heap: 'agent/routes',
      event,
      decision: decision(),
      eventRef,
      sessionRef,
    });

    expect(record).toMatchObject({
      heap: 'agent/routes',
      type: 'metadata',
      tags: [
        'route-record',
        'event:evt-1',
        'agent:mira',
        'channel:signal:jan',
        'session:session-1',
        'mode:live',
        'sensitivity:normal',
        'reason:default-agent',
      ],
      data: {
        eventId: 'evt-1',
        agentName: 'mira',
        channelId: 'signal:jan',
        sessionId: 'session-1',
        mode: 'live',
        sensitivity: 'normal',
        reason: 'default-agent',
        eventSource: 'chat',
        eventSurface: 'signal',
      },
      links: [eventRef, sessionRef],
      metadata: { source: 'router', bounded: true, excludesEventContent: true },
    });
    expect(JSON.stringify(record.data)).not.toContain('private content should not be copied');
  });

  it('explains repeated channel routing from history', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block', now: () => '2026-04-27T20:00:00.000Z' });
    const eventRef = { heap: 'agent/audit' as const, id: 'event-1' };
    const sessionRef = { heap: 'agent/sessions' as const, id: 'session-block-1' };

    await storeRouteDecision({
      memory,
      heap: 'agent/routes',
      event: createChatEvent({ id: 'evt-1', channelType: 'signal', chatId: 'jan', text: 'first' }),
      decision: decision({ eventId: 'evt-1', reason: 'default-agent' }),
      eventRef,
      sessionRef,
    });
    await storeRouteDecision({
      memory,
      heap: 'agent/routes',
      event: createChatEvent({ id: 'evt-2', channelType: 'signal', chatId: 'jan', text: 'second' }),
      decision: decision({ eventId: 'evt-2', reason: 'existing-channel-binding' }),
      eventRef: { heap: 'agent/audit', id: 'event-2' },
      sessionRef,
    });

    await expect(explainRouteHistory({ memory, heap: 'agent/routes', channelId: 'signal:jan' })).resolves.toBe([
      '2026-04-27T20:00:00.000Z: signal:jan -> mira session=session-1 mode=live sensitivity=normal reason=default-agent',
      '2026-04-27T20:00:00.000Z: signal:jan -> mira session=session-1 mode=live sensitivity=normal reason=existing-channel-binding',
    ].join('\n'));
  });

  it('makes sensitive model and persona decisions queryable', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const event = createChatEvent({ id: 'evt-sensitive', channelType: 'signal', chatId: 'jan', text: '[sensitive] @mira local only' });

    await storeRouteDecision({
      memory,
      heap: 'agent/routes',
      event,
      decision: decision({
        eventId: 'evt-sensitive',
        persona: 'mira',
        sensitivity: 'sensitive',
        modelPolicyHint: 'local-required',
        reason: 'explicit-persona',
      }),
      eventRef: { heap: 'agent/audit', id: 'event-3' },
      sessionRef: { heap: 'persona/mira/sessions', id: 'session-3' },
    });

    const hits = await queryRouteHistory({ memory, heap: 'agent/routes', persona: 'mira', sensitivity: 'sensitive' });

    expect(hits).toHaveLength(1);
    expect(hits[0].data).toMatchObject({
      persona: 'mira',
      sensitivity: 'sensitive',
      modelPolicyHint: 'local-required',
      reason: 'explicit-persona',
    });
    expect(hits[0].tags).toEqual(expect.arrayContaining(['persona:mira', 'sensitivity:sensitive']));
  });
});
