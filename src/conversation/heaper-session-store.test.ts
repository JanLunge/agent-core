import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import { HeaperSessionStore } from './heaper-session-store.js';

describe('HeaperSessionStore', () => {
  it('creates and resumes sessions by routed session id', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const store = new HeaperSessionStore({ memory, sessionHeap: 'agent/sessions' });

    const created = await store.createOrResume({ sessionId: 'route-1', agentName: 'mira', channelId: 'signal:jan' });
    const resumed = await store.createOrResume({ sessionId: 'route-1', agentName: 'mira', channelId: 'signal:jan' });

    expect(resumed.id).toBe(created.id);
    expect(created).toMatchObject({
      type: 'session',
      tags: ['session', 'session:route-1', 'agent:mira', 'channel:signal:jan'],
      data: { sessionId: 'route-1', agentName: 'mira', channelId: 'signal:jan', status: 'active' },
    });
  });

  it('appends user assistant and tool messages linked to the session', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const store = new HeaperSessionStore({ memory, sessionHeap: 'agent/sessions' });
    const session = await store.createOrResume({ sessionId: 's-1', agentName: 'mira', channelId: 'api:req' });

    const user = await store.appendMessage('s-1', { role: 'user', content: 'hello', timestamp: '2026-04-27T19:00:00.000Z' });
    const assistant = await store.appendMessage('s-1', { role: 'assistant', content: 'hi' });
    const tool = await store.appendMessage('s-1', { role: 'tool', content: 'tool output', tool_call_id: 'call-1' });

    expect(user.links).toEqual([{ heap: session.heap, id: session.id }]);
    expect([user.data.role, assistant.data.role, tool.data.role]).toEqual(['user', 'assistant', 'tool']);
    expect(tool.data.toolCallId).toBe('call-1');
  });

  it('retrieves a recent slice in message order independent of input surface', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const store = new HeaperSessionStore({ memory, sessionHeap: 'persona/mira/sessions' });
    await store.createOrResume({ sessionId: 's-2', agentName: 'mira', channelId: 'telegram:jan' });

    await store.appendMessage('s-2', { role: 'user', content: 'one' });
    await store.appendMessage('s-2', { role: 'assistant', content: 'two' });
    await store.appendMessage('s-2', { role: 'user', content: 'three' });

    await expect(store.getRecentMessages('s-2', 2)).resolves.toEqual([
      { role: 'assistant', content: 'two', timestamp: undefined, name: undefined, tool_call_id: undefined },
      { role: 'user', content: 'three', timestamp: undefined, name: undefined, tool_call_id: undefined },
    ]);
  });

  it('produces summary blocks linked to session and messages', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const store = new HeaperSessionStore({ memory, sessionHeap: 'agent/sessions' });
    const session = await store.createOrResume({ sessionId: 's-3', agentName: 'mira', channelId: 'voice:call' });
    const first = await store.appendMessage('s-3', { role: 'user', content: 'summarize this' });
    const second = await store.appendMessage('s-3', { role: 'assistant', content: 'summary done' });

    const summary = await store.summarize('s-3');

    expect(summary).toMatchObject({
      type: 'session',
      tags: ['session-summary', 'session:s-3', 'agent:mira'],
      data: { sessionId: 's-3', messageCount: 2, lastMessagePreview: 'summary done' },
      metadata: { source: 'heaper-session-store' },
    });
    expect(summary.data.summary).toContain('mira session with 2 messages');
    expect(summary.links).toEqual([
      { heap: session.heap, id: session.id },
      { heap: first.heap, id: first.id },
      { heap: second.heap, id: second.id },
    ]);
  });

  it('searches sessions consistently through the memory API', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const store = new HeaperSessionStore({ memory, sessionHeap: 'agent/sessions' });
    await store.createOrResume({ sessionId: 'alpha', agentName: 'mira', channelId: 'signal:jan' });
    await store.createOrResume({ sessionId: 'beta', agentName: 'mira', channelId: 'telegram:jan' });

    const hits = await store.searchSessions('telegram');

    expect(hits).toHaveLength(1);
    expect(hits[0].data).toMatchObject({ sessionId: 'beta', channelId: 'telegram:jan' });
  });
});
