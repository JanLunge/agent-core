import { describe, expect, it } from 'vitest';
import type { AgentRuntime } from '../agent/agent.js';
import { createBackgroundEvent, createChatEvent } from '../events/index.js';
import { createRouter } from './router.js';

function fakeAgent(name: string): AgentRuntime {
  const sessions = new Map<string, { id: string }>();
  const calls: Array<{ channelId: string; message: string }> = [];

  return {
    config: { name } as AgentRuntime['config'],
    brain: {} as AgentRuntime['brain'],
    registry: {} as AgentRuntime['registry'],
    status: 'idle',
    getOrCreateConversation(channelId: string) {
      const existing = sessions.get(channelId);
      if (existing) return existing as ReturnType<AgentRuntime['getOrCreateConversation']>;
      const created = { id: `${name}-${sessions.size + 1}` };
      sessions.set(channelId, created);
      return created as ReturnType<AgentRuntime['getOrCreateConversation']>;
    },
    resetConversation(channelId: string) {
      sessions.delete(channelId);
    },
    async processMessage(channelId: string, message: string) {
      calls.push({ channelId, message });
      return { reply: `${name}:${message}`, toolCalls: [], toolResults: [], usage: { promptTokens: 0, completionTokens: 0 } };
    },
    stop() {},
    calls,
  } as AgentRuntime & { calls: Array<{ channelId: string; message: string }> };
}

describe('router planning decision', () => {
  it('plans a chat message before invoking the agent and resumes the same session', () => {
    const router = createRouter();
    router.registerAgent('mira', fakeAgent('mira'));

    const first = router.plan({ channelType: 'telegram', chatId: 'jan', text: 'hello' });
    const second = router.plan({ channelType: 'telegram', chatId: 'jan', text: 'continue' });

    expect(first).toMatchObject({
      agentName: 'mira',
      channelId: 'telegram:jan',
      sessionId: 'mira-1',
      mode: 'live',
      sensitivity: 'normal',
      modelPolicyHint: 'default',
      respondLive: true,
      reason: 'default-agent',
    });
    expect(second.sessionId).toBe(first.sessionId);
  });

  it('selects an addressed persona when the agent exists', () => {
    const router = createRouter();
    router.registerAgent('default', fakeAgent('default'));
    router.registerAgent('mira', fakeAgent('mira'));

    const event = createChatEvent({
      id: 'evt-persona',
      channelType: 'signal',
      chatId: 'jan',
      text: '@Mira please handle this',
    });

    expect(router.planEvent(event)).toMatchObject({
      eventId: 'evt-persona',
      agentName: 'mira',
      persona: 'mira',
      channelId: 'signal:jan',
      sessionId: 'mira-1',
      reason: 'explicit-persona',
    });
  });

  it('sets local-required model policy for sensitive input', () => {
    const router = createRouter();
    router.registerAgent('mira', fakeAgent('mira'));

    const decision = router.planEvent(createChatEvent({
      id: 'evt-sensitive',
      channelType: 'signal',
      chatId: 'jan',
      text: '[sensitive] read local private context',
    }));

    expect(decision).toMatchObject({
      sensitivity: 'sensitive',
      modelPolicyHint: 'local-required',
    });
  });

  it('does not request live response for background events', () => {
    const router = createRouter();
    router.registerAgent('mira', fakeAgent('mira'));

    const decision = router.planEvent(createBackgroundEvent({
      id: 'evt-background',
      taskId: 'heartbeat-1',
      taskType: 'heartbeat',
      content: 'continue safe slice',
    }));

    expect(decision).toMatchObject({
      channelId: 'background:heartbeat-1',
      mode: 'background',
      respondLive: false,
      sessionId: 'mira-1',
    });
  });

  it('routes through the explicit decision channel id', async () => {
    const router = createRouter();
    const agent = fakeAgent('mira') as AgentRuntime & { calls: Array<{ channelId: string; message: string }> };
    router.registerAgent('mira', agent);

    await expect(router.route({ channelType: 'telegram', chatId: 'jan', text: 'ping' })).resolves.toMatchObject({
      reply: 'mira:ping',
    });
    expect(agent.calls).toEqual([{ channelId: 'telegram:jan', message: 'ping' }]);
  });
});
