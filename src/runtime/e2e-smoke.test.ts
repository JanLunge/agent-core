import { describe, expect, it } from 'vitest';
import { createChatEvent } from '../events/index.js';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import { createRouter } from '../router/router.js';
import { executeBoundaryTool, createBoundaryToolRegistry } from '../tools/boundary.js';
import { getStoredToolOutput } from '../tools/output-blocks.js';
import { generateProgressReport } from '../reporting/progress.js';
import { createFakeAgentHarness } from './fake-agent.js';
import { runRuntimeEvent } from './orchestrator.js';

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

function setup() {
  const memory = new InMemoryHeaperMemory({ idPrefix: 'smoke', now: () => '2026-04-28T04:00:00.000Z' });
  const router = createRouter();
  const harness = createFakeAgentHarness('mira', [{ kind: 'echo', prefix: 'smoke' }]);
  router.registerAgent('mira', harness.agent);
  return { memory, router, harness };
}

describe('end-to-end runtime smoke scenario', () => {
  it('runs normal chat through route context fake agent guarded tool session memory and progress reporting', async () => {
    const { memory, router, harness } = setup();
    const event = createChatEvent({
      id: 'evt-smoke-normal',
      channelType: 'signal',
      chatId: 'jan',
      text: '@mira summarize local status',
      receivedAt: '2026-04-28T04:00:00.000Z',
    });

    const outcome = await runRuntimeEvent({
      event,
      router,
      memory,
      sessionHeap: 'persona/mira/sessions',
      auditHeap: 'agent/audit',
      modelPolicy,
      availableModels,
      responder: harness.responder,
    });

    const registry = createBoundaryToolRegistry();
    registry.register({
      name: 'local.status',
      description: 'Deterministic local status fixture',
      kind: 'file',
      sensitivity: 'sensitive-compatible',
      action: 'read',
      requiredPermissions: ['local-read'],
      target: () => '/workspace/status.txt',
      handler: async () => 'local status: all smoke checks are deterministic',
    });

    const tool = await executeBoundaryTool({
      registry,
      memory,
      auditHeap: 'agent/audit',
      outputHeap: 'persona/mira/tool-output',
      toolName: 'local.status',
      args: {},
      context: { agentName: 'mira', conversationId: outcome.route.sessionId, baseDir: '/workspace' },
      originRefs: [outcome.eventRef, outcome.routeRef, outcome.assistantMessageRef],
    });

    expect(outcome.reply).toBe('smoke:@mira summarize local status');
    expect(harness.receivedContexts).toHaveLength(1);
    expect(outcome.route).toMatchObject({ agentName: 'mira', sessionId: 'mira-1', sensitivity: 'normal' });
    expect(outcome.model).toMatchObject({ model: 'remote/default', requirement: 'default' });
    expect(tool.guardDecision.disposition).toBe('allow');
    expect(tool.resultRef).toEqual({ heap: 'persona/mira/tool-output', id: 'smoke-9' });

    await expect(memory.getBlock(outcome.eventRef)).resolves.toMatchObject({ tags: ['runtime-event', 'source:chat', 'mode:live'] });
    await expect(memory.getBlock(outcome.routeRef)).resolves.toMatchObject({
      tags: expect.arrayContaining(['route-record', 'agent:mira', 'mode:live', 'sensitivity:normal']),
      links: [outcome.eventRef, { heap: 'persona/mira/sessions', id: 'smoke-2' }],
    });
    await expect(memory.getBlock(outcome.userMessageRef)).resolves.toMatchObject({
      heap: 'persona/mira/sessions',
      data: { role: 'user', content: '@mira summarize local status', sessionId: 'mira-1' },
      links: [{ heap: 'persona/mira/sessions', id: 'smoke-2' }, outcome.eventRef, outcome.routeRef],
    });
    await expect(memory.getBlock(outcome.assistantMessageRef)).resolves.toMatchObject({
      data: { role: 'assistant', content: 'smoke:@mira summarize local status' },
      links: [{ heap: 'persona/mira/sessions', id: 'smoke-2' }, outcome.userMessageRef, outcome.routeRef, outcome.modelDecisionRef],
    });
    await expect(memory.getBlock(tool.toolIntentRef)).resolves.toMatchObject({ links: [outcome.eventRef, outcome.routeRef, outcome.assistantMessageRef] });
    await expect(getStoredToolOutput(memory, tool.resultRef!)).resolves.toMatchObject({
      name: 'local.status',
      output: 'local status: all smoke checks are deterministic',
    });

    const report = generateProgressReport({
      cwd: process.cwd(),
      exec: () => 'smoke123 Runtime smoke\n',
      testStatus: { command: 'pnpm test -- src/runtime/e2e-smoke.test.ts', status: 'passed', details: 'smoke scenario' },
      typecheckStatus: { command: 'pnpm typecheck', status: 'passed' },
    });

    expect(report.text).toContain('Latest commit: smoke123 Runtime smoke');
    expect(report.text).toContain('Tests: passed (pnpm test -- src/runtime/e2e-smoke.test.ts — smoke scenario)');
    expect(report.text).toContain('Completed slice: Slice 41 — Resumable approval application flow');
    expect(report.text).toContain('Active slice: Slice 42 — Task-to-runtime continuation bridge');
  });

  it('runs a sensitive variant with local model routing and denied external tool intent', async () => {
    const { memory, router, harness } = setup();

    const outcome = await runRuntimeEvent({
      event: createChatEvent({
        id: 'evt-smoke-sensitive',
        channelType: 'telegram',
        chatId: 'jan',
        text: '[sensitive] @mira check private remote status',
      }),
      router,
      memory,
      sessionHeap: 'persona/mira/sessions',
      auditHeap: 'agent/audit',
      modelPolicy,
      availableModels,
      guardRequests: [{ surface: 'api', action: 'network', target: 'https://api.example.test/private' }],
      responder: harness.responder,
    });

    expect(outcome.model).toMatchObject({ model: 'local/small', requirement: 'local-required' });
    expect(outcome.guardDecisions).toHaveLength(1);
    expect(outcome.guardDecisions[0]).toMatchObject({
      disposition: 'deny',
      reason: 'Sensitive mode blocks external/network operations.',
    });
    await expect(memory.getBlock(outcome.guardDecisionRefs[0])).resolves.toMatchObject({
      tags: ['guard-decision', 'disposition:deny', 'surface:api'],
      links: [outcome.eventRef, outcome.routeRef],
    });
    await expect(memory.getBlock(outcome.assistantMessageRef)).resolves.toMatchObject({
      links: [{ heap: 'persona/mira/sessions', id: 'smoke-2' }, outcome.userMessageRef, outcome.routeRef, outcome.modelDecisionRef, outcome.guardDecisionRefs[0], outcome.blockerRefs[0]],
    });
  });
});
