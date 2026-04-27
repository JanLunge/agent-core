import { describe, expect, it } from 'vitest';
import { createChatEvent } from '../events/index.js';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import { createRouter } from '../router/router.js';
import { createFakeAgentHarness, type FakeAgentScriptStep } from './fake-agent.js';
import { runRuntimeEvent } from './orchestrator.js';

const modelPolicy = {
  defaultModel: 'remote/default',
  localModel: 'local/small',
};

const availableModels = [
  { id: 'local/small', capabilities: ['local' as const] },
  { id: 'remote/default', capabilities: ['remote' as const] },
];

function setup(script: FakeAgentScriptStep[] = [{ kind: 'echo' }]) {
  const memory = new InMemoryHeaperMemory({ idPrefix: 'block', now: () => '2026-04-27T17:00:00.000Z' });
  const router = createRouter();
  const harness = createFakeAgentHarness('mira', script);
  router.registerAgent('mira', harness.agent);
  return { memory, router, harness };
}

describe('fake agent harness', () => {
  it('receives runtime context and returns a scripted plain reply', async () => {
    const { memory, router, harness } = setup([{ kind: 'reply', text: 'scripted hello' }]);

    const outcome = await runRuntimeEvent({
      event: createChatEvent({ channelType: 'telegram', chatId: 'jan', text: '@mira hello' }),
      router,
      memory,
      sessionHeap: 'agent/sessions',
      auditHeap: 'agent/audit',
      modelPolicy,
      availableModels,
      responder: harness.responder,
    });

    expect(outcome.reply).toBe('scripted hello');
    expect(harness.receivedContexts).toHaveLength(1);
    expect(harness.receivedContexts[0]).toMatchObject({
      route: { agentName: 'mira', sessionId: 'mira-1' },
      model: { model: 'remote/default' },
    });
    await expect(memory.getBlock(outcome.assistantMessageRef)).resolves.toMatchObject({
      data: { role: 'assistant', content: 'scripted hello' },
    });
  });

  it('can echo event content deterministically without credentials', async () => {
    const { memory, router, harness } = setup([{ kind: 'echo', prefix: 'fake' }]);

    const outcome = await runRuntimeEvent({
      event: createChatEvent({ channelType: 'tui', chatId: 'jan', text: 'repeat me' }),
      router,
      memory,
      sessionHeap: 'agent/sessions',
      auditHeap: 'agent/audit',
      modelPolicy,
      availableModels,
      responder: harness.responder,
    });

    expect(outcome.reply).toBe('fake:repeat me');
    expect(harness.calls).toEqual([]);
  });

  it('handles a guarded tool denial through scripted tool intent response', async () => {
    const { memory, router, harness } = setup([
      { kind: 'tool-intent', toolName: 'api.fetch', successText: 'tool succeeded', deniedText: 'tool was blocked safely' },
    ]);

    const outcome = await runRuntimeEvent({
      event: createChatEvent({ channelType: 'signal', chatId: 'jan', text: '[sensitive] fetch private status' }),
      router,
      memory,
      sessionHeap: 'agent/sessions',
      auditHeap: 'agent/audit',
      modelPolicy,
      availableModels,
      guardRequests: [
        { surface: 'api', action: 'network', target: 'https://api.example.test/private' },
      ],
      responder: harness.responder,
    });

    expect(outcome.reply).toBe('tool was blocked safely');
    expect(outcome.model).toMatchObject({ model: 'local/small', requirement: 'local-required' });
    expect(outcome.guardDecisions).toHaveLength(1);
    expect(outcome.guardDecisions[0]).toMatchObject({
      disposition: 'deny',
      reason: 'Sensitive mode blocks external/network operations.',
    });
    expect(harness.receivedContexts[0].guardDecisions[0].disposition).toBe('deny');
  });
});
