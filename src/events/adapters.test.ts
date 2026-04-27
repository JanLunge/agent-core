import { describe, expect, it } from 'vitest';
import {
  apiInputToEvent,
  backgroundInputToEvent,
  chatInputToEvent,
  tuiInputToEvent,
  voiceInputToEvent,
} from './adapters.js';

describe('interface event adapters', () => {
  it('normalizes chat and TUI inputs into equivalent core fields', () => {
    const chat = chatInputToEvent({
      id: 'chat-1',
      channelType: 'telegram',
      chatId: 'jan',
      sender: 'jan',
      text: '@mira [mode: async] #sensitive do the thing',
      receivedAt: '2026-04-27T14:00:00.000Z',
    });
    const tui = tuiInputToEvent({
      id: 'tui-1',
      sessionId: 'jan',
      user: 'jan',
      text: '@mira [mode: async] #sensitive do the thing',
      receivedAt: '2026-04-27T14:00:00.000Z',
    });

    expect(chat).toMatchObject({
      content: tui.content,
      modeHint: 'async',
      sensitivity: 'sensitive',
      personaHint: 'mira',
      routing: {
        explicitPersona: true,
        explicitMode: true,
        explicitSensitivity: true,
        tags: ['sensitive'],
      },
    });
    expect(tui).toMatchObject({
      source: 'chat',
      surface: 'tui',
      conversationKey: 'tui:jan',
      surfaceMetadata: { surface: 'tui', sessionId: 'jan' },
    });
  });

  it('preserves API surface metadata while keeping routing independent of surface', () => {
    const event = apiInputToEvent({
      id: 'api-1',
      requestId: 'req-7',
      route: '/v1/messages',
      actorId: 'jan',
      bodyText: '[agent: mira] #async summarize this',
      receivedAt: '2026-04-27T14:01:00.000Z',
      metadata: { ipHash: 'abc' },
    });

    expect(event).toMatchObject({
      id: 'api-1',
      source: 'api',
      surface: 'api',
      conversationKey: 'api:req-7',
      content: '[agent: mira] #async summarize this',
      modeHint: 'async',
      personaHint: 'mira',
      routing: {
        channelId: 'api:req-7',
        explicitPersona: true,
        explicitMode: true,
      },
      surfaceMetadata: { surface: 'api', requestId: 'req-7', route: '/v1/messages', ipHash: 'abc' },
    });
  });

  it('preserves voice metadata separately from core routing fields', () => {
    const event = voiceInputToEvent({
      id: 'voice-1',
      conversationId: 'call-1',
      speaker: 'jan',
      transcript: '#live @mira hello from audio',
      audioRef: 'file://clip.wav',
      metadata: { language: 'en' },
    });

    expect(event).toMatchObject({
      source: 'voice',
      surface: 'voice',
      conversationKey: 'voice:call-1',
      content: '#live @mira hello from audio',
      modeHint: 'live',
      personaHint: 'mira',
      surfaceMetadata: {
        surface: 'voice',
        conversationId: 'call-1',
        audioRef: 'file://clip.wav',
        language: 'en',
      },
    });
  });

  it('normalizes background input without live response defaults', () => {
    const event = backgroundInputToEvent({
      id: 'bg-1',
      taskId: 'task-1',
      taskType: 'heartbeat',
      persona: 'mira',
      content: 'continue work',
      sensitive: true,
      metadata: { cron: 'hourly' },
    });

    expect(event).toMatchObject({
      source: 'background',
      surface: 'background',
      conversationKey: 'background:task-1',
      modeHint: 'background',
      sensitivity: 'sensitive',
      personaHint: 'mira',
      routing: {
        taskType: 'heartbeat',
        explicitPersona: true,
        explicitMode: false,
        explicitSensitivity: true,
      },
      surfaceMetadata: { cron: 'hourly' },
    });
  });

  it('keeps equivalent content/persona/sensitivity regardless of adapter surface', () => {
    const text = '[persona: mira] [sensitive] check local context';
    const events = [
      chatInputToEvent({ channelType: 'signal', chatId: 'jan', text }),
      tuiInputToEvent({ sessionId: 'jan', text }),
      apiInputToEvent({ requestId: 'jan', route: '/message', bodyText: text }),
      voiceInputToEvent({ conversationId: 'jan', transcript: text }),
    ];

    expect(events.map((event) => [event.content, event.personaHint, event.sensitivity])).toEqual([
      [text, 'mira', 'sensitive'],
      [text, 'mira', 'sensitive'],
      [text, 'mira', 'sensitive'],
      [text, 'mira', 'sensitive'],
    ]);
  });
});
