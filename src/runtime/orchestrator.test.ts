import { describe, expect, it } from 'vitest';
import type { AgentRuntime } from '../agent/agent.js';
import { createBackgroundEvent, createChatEvent } from '../events/index.js';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import { createRouter } from '../router/router.js';
import { runRuntimeEvent } from './orchestrator.js';

function fakeAgent(name: string): AgentRuntime {
  const sessions = new Map<string, { id: string }>();
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
    resetConversation(channelId: string) { sessions.delete(channelId); },
    async processMessage() { throw new Error('runtime skeleton should not call real agent'); },
    stop() {},
  } as AgentRuntime;
}

const modelPolicy = {
  defaultModel: 'remote/default',
  strongModel: 'remote/strong',
  localModel: 'local/small',
};

const availableModels = [
  { id: 'local/small', capabilities: ['local' as const] },
  { id: 'remote/default', capabilities: ['remote' as const] },
  { id: 'remote/strong', capabilities: ['remote' as const, 'strong' as const] },
];

describe('runRuntimeEvent', () => {
  it('accepts a normalized event and returns a runtime outcome without real model calls', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block', now: () => '2026-04-27T16:00:00.000Z' });
    const router = createRouter();
    router.registerAgent('mira', fakeAgent('mira'));
    const event = createChatEvent({
      id: 'evt-1',
      channelType: 'telegram',
      chatId: 'jan',
      text: '@mira hello runtime',
      receivedAt: '2026-04-27T16:00:00.000Z',
    });

    const outcome = await runRuntimeEvent({
      event,
      router,
      memory,
      sessionHeap: 'agent/sessions',
      auditHeap: 'agent/audit',
      modelPolicy,
      availableModels,
      responder: ({ event, route, workingMemory }) => `reply:${route.sessionId}:${workingMemory.stats.messageCount}:${event.content}`,
    });

    expect(outcome.reply).toBe('reply:mira-1:1:@mira hello runtime');
    expect(outcome.route).toMatchObject({ agentName: 'mira', sessionId: 'mira-1', channelId: 'telegram:jan' });
    expect(outcome.model).toMatchObject({ model: 'remote/default', requirement: 'default' });
    expect(outcome.eventRef).toEqual({ heap: 'agent/audit', id: 'block-1' });
    expect(outcome.routeRef).toEqual({ heap: 'agent/audit', id: 'block-3' });
    expect(outcome.modelDecisionRef).toEqual({ heap: 'agent/audit', id: 'block-4' });
    expect(outcome.userMessageRef).toEqual({ heap: 'agent/sessions', id: 'block-5' });
    expect(outcome.assistantMessageRef).toEqual({ heap: 'agent/sessions', id: 'block-6' });
    expect(outcome.notificationIntent).toMatchObject({
      action: 'direct-response',
      reason: 'Live chat expects an immediate direct response.',
      refs: [
        outcome.eventRef,
        outcome.routeRef,
        outcome.modelDecisionRef,
        outcome.userMessageRef,
        outcome.assistantMessageRef,
      ],
    });
  });

  it('writes session messages and auditable decision blocks to the configured heaps', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const router = createRouter();
    router.registerAgent('mira', fakeAgent('mira'));

    const outcome = await runRuntimeEvent({
      event: createChatEvent({ id: 'evt-2', channelType: 'signal', chatId: 'jan', text: 'hello' }),
      router,
      memory,
      sessionHeap: 'persona/mira/sessions',
      auditHeap: 'agent/audit',
      modelPolicy,
      availableModels,
    });

    await expect(memory.getBlock(outcome.userMessageRef)).resolves.toMatchObject({
      heap: 'persona/mira/sessions',
      type: 'text',
      tags: ['session-message', 'session:mira-1', 'role:user'],
      data: { role: 'user', content: 'hello', sessionId: 'mira-1' },
      links: [{ heap: 'persona/mira/sessions', id: 'block-2' }, outcome.eventRef, outcome.routeRef],
    });
    await expect(memory.getBlock(outcome.assistantMessageRef)).resolves.toMatchObject({
      heap: 'persona/mira/sessions',
      tags: ['session-message', 'session:mira-1', 'role:assistant'],
      links: [{ heap: 'persona/mira/sessions', id: 'block-2' }, outcome.userMessageRef, outcome.routeRef, outcome.modelDecisionRef],
    });
    await expect(memory.getBlock(outcome.routeRef)).resolves.toMatchObject({
      heap: 'agent/audit',
      type: 'metadata',
      tags: expect.arrayContaining(['route-record', 'agent:mira', 'mode:live', 'sensitivity:normal']),
      links: [outcome.eventRef, { heap: 'persona/mira/sessions', id: 'block-2' }],
    });
  });

  it('includes bounded working memory in the prepared responder context', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const router = createRouter();
    router.registerAgent('mira', fakeAgent('mira'));
    await memory.createBlock({ heap: 'agent/sessions', type: 'text', data: { content: 'runtime context memory' }, tags: ['seed'] });

    let observedWorkingMemory = '';
    const outcome = await runRuntimeEvent({
      event: createChatEvent({ channelType: 'telegram', chatId: 'jan', text: 'runtime context' }),
      router,
      memory,
      sessionHeap: 'agent/sessions',
      auditHeap: 'agent/audit',
      modelPolicy,
      availableModels,
      history: [{ role: 'assistant', content: 'previous answer' }],
      responder: ({ workingMemory }) => {
        observedWorkingMemory = workingMemory.text;
        return 'ok';
      },
    });

    expect(outcome.workingMemory.stats.messageCount).toBe(2);
    expect(observedWorkingMemory).toContain('previous answer');
    expect(observedWorkingMemory).toContain('runtime context');
    expect(outcome.workingMemory.retrievedBlocks.map((block) => block.ref)).toContainEqual({ heap: 'agent/sessions', id: 'block-1' });
  });

  it('hydrates working memory from prior persisted session messages', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const router = createRouter();
    router.registerAgent('mira', fakeAgent('mira'));

    await runRuntimeEvent({
      event: createChatEvent({ id: 'evt-memory-1', channelType: 'telegram', chatId: 'jan', text: 'remember concise morning status' }),
      router,
      memory,
      sessionHeap: 'agent/sessions',
      auditHeap: 'agent/audit',
      modelPolicy,
      availableModels,
      responder: () => 'noted',
    });

    let observedWorkingMemory = '';
    const second = await runRuntimeEvent({
      event: createChatEvent({ id: 'evt-memory-2', channelType: 'telegram', chatId: 'jan', text: 'what did I ask you to remember?' }),
      router,
      memory,
      sessionHeap: 'agent/sessions',
      auditHeap: 'agent/audit',
      modelPolicy,
      availableModels,
      responder: ({ workingMemory }) => {
        observedWorkingMemory = workingMemory.text;
        return 'checking memory';
      },
    });

    expect(second.route).toMatchObject({ sessionId: 'mira-1', reason: 'existing-channel-binding' });
    expect(second.workingMemory.stats.messageCount).toBe(3);
    expect(observedWorkingMemory).toContain('remember concise morning status');
    expect(observedWorkingMemory).toContain('noted');
    expect(observedWorkingMemory).toContain('what did I ask you to remember?');
  });

  it('keeps ordinary background progress silent in the runtime notification intent', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const router = createRouter();
    router.registerAgent('mira', fakeAgent('mira'));

    const outcome = await runRuntimeEvent({
      event: createBackgroundEvent({ taskId: 'task-1', persona: 'mira', content: 'continue queued work' }),
      router,
      memory,
      sessionHeap: 'agent/sessions',
      auditHeap: 'agent/audit',
      modelPolicy,
      availableModels,
      responder: () => 'Processed one queued continuation step.',
    });

    expect(outcome.notificationIntent).toMatchObject({
      action: 'silent',
      priority: 'low',
      reason: 'Ordinary background progress should not interrupt.',
      message: 'Processed one queued continuation step.',
      refs: [outcome.eventRef, outcome.routeRef, outcome.modelDecisionRef, outcome.userMessageRef, outcome.assistantMessageRef],
    });
  });

  it('requests notification when background runtime guard decisions require approval', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const router = createRouter();
    router.registerAgent('mira', fakeAgent('mira'));

    const outcome = await runRuntimeEvent({
      event: createBackgroundEvent({ taskId: 'task-approval', persona: 'mira', content: 'write generated file' }),
      router,
      memory,
      sessionHeap: 'agent/sessions',
      auditHeap: 'agent/audit',
      modelPolicy,
      availableModels,
      guardRequests: [{ surface: 'file', action: 'write', target: '/workspace/out.txt' }],
      responder: () => 'Need approval before writing /workspace/out.txt.',
    });

    expect(outcome.guardDecisions.map((guard) => guard.disposition)).toEqual(['ask']);
    expect(outcome.notificationIntent).toMatchObject({
      action: 'notify',
      priority: 'high',
      reason: 'An explicit approval decision is required.',
      message: 'Need approval before writing /workspace/out.txt.',
      refs: [
        outcome.eventRef,
        outcome.routeRef,
        outcome.modelDecisionRef,
        outcome.userMessageRef,
        outcome.assistantMessageRef,
        outcome.guardDecisionRefs[0],
      ],
    });
  });

  it('records guard and sensitive local-model decisions as auditable refs', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const router = createRouter();
    router.registerAgent('mira', fakeAgent('mira'));

    const outcome = await runRuntimeEvent({
      event: createChatEvent({ channelType: 'signal', chatId: 'jan', text: '[sensitive] check local file' }),
      router,
      memory,
      sessionHeap: 'agent/sessions',
      auditHeap: 'agent/audit',
      modelPolicy,
      availableModels,
      guardRequests: [
        { surface: 'file', action: 'read', target: '/workspace/notes.md' },
        { surface: 'api', action: 'network', target: 'https://api.example.test/private' },
      ],
    });

    expect(outcome.model).toMatchObject({ model: 'local/small', requirement: 'local-required' });
    expect(outcome.guardDecisions.map((guard) => guard.disposition)).toEqual(['allow', 'deny']);
    expect(outcome.guardDecisionRefs).toEqual([
      { heap: 'agent/audit', id: 'block-5' },
      { heap: 'agent/audit', id: 'block-6' },
    ]);
    await expect(memory.getBlock(outcome.guardDecisionRefs[1])).resolves.toMatchObject({
      tags: ['guard-decision', 'disposition:deny', 'surface:api'],
      data: { guard: { reason: 'Sensitive mode blocks external/network operations.' } },
      links: [outcome.eventRef, outcome.routeRef],
    });
  });
});
