import { describe, expect, it } from 'vitest';
import { createBackgroundEvent, createChatEvent, extractRoutingHints } from './normalized-event.js';

describe('normalized event factories', () => {
  it('normalizes chat input with deterministic channel and live defaults', () => {
    const event = createChatEvent({
      id: 'evt-1',
      channelType: 'telegram',
      chatId: 'jan',
      sender: 'jan',
      text: 'Please inspect the roadmap',
      receivedAt: '2026-04-27T01:00:00.000Z',
    });

    expect(event).toMatchObject({
      id: 'evt-1',
      source: 'chat',
      surface: 'telegram',
      conversationKey: 'telegram:jan',
      content: 'Please inspect the roadmap',
      modeHint: 'live',
      sensitivity: 'normal',
      actor: { kind: 'human', id: 'jan', displayName: 'jan' },
      routing: {
        channelId: 'telegram:jan',
        explicitPersona: false,
        explicitMode: false,
        explicitSensitivity: false,
        tags: [],
      },
    });
  });

  it('extracts persona, mode, sensitivity, and tags from chat text', () => {
    const event = createChatEvent({
      id: 'evt-2',
      channelType: 'signal',
      chatId: 'jan',
      text: '@Mira [mode:async] [sensitive] work on #agent-core #planning',
      receivedAt: '2026-04-27T01:01:00.000Z',
    });

    expect(event.personaHint).toBe('mira');
    expect(event.modeHint).toBe('async');
    expect(event.sensitivity).toBe('sensitive');
    expect(event.routing).toMatchObject({
      explicitPersona: true,
      explicitMode: true,
      explicitSensitivity: true,
      tags: ['agent-core', 'planning'],
    });
  });

  it('normalizes background input without requesting live response by default', () => {
    const event = createBackgroundEvent({
      id: 'evt-3',
      taskId: 'task-1',
      taskType: 'heartbeat',
      persona: 'mira',
      content: 'Continue Slice 2',
      receivedAt: '2026-04-27T01:02:00.000Z',
    });

    expect(event).toMatchObject({
      source: 'background',
      surface: 'background',
      conversationKey: 'background:task-1',
      modeHint: 'background',
      sensitivity: 'normal',
      personaHint: 'mira',
      actor: { kind: 'system', id: 'background-worker' },
      routing: {
        taskType: 'heartbeat',
        explicitPersona: true,
        explicitMode: false,
        explicitSensitivity: false,
      },
    });
  });

  it('uses explicit text hints over background defaults when present', () => {
    const event = createBackgroundEvent({
      id: 'evt-4',
      taskId: 'task-2',
      content: '[agent:Codex] [mode:async] sensitive: prepare local-only work',
      sensitive: false,
      receivedAt: '2026-04-27T01:03:00.000Z',
    });

    expect(event.personaHint).toBe('codex');
    expect(event.modeHint).toBe('async');
    expect(event.sensitivity).toBe('sensitive');
  });

  it('extracts routing hints deterministically from supported syntaxes', () => {
    expect(extractRoutingHints('/persona Mira #background #sensitive')).toEqual({
      persona: 'mira',
      modeHint: 'background',
      sensitive: true,
      tags: ['background', 'sensitive'],
    });
  });
});
