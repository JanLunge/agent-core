import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MasterConfig } from '../config/schema.js';
import { createChatEvent } from '../events/index.js';
import { createRuntimeMemory } from '../runtime/memory-config.js';
import type { BlockRef, HeapName } from '../heaper/types.js';
import { createRouter } from '../router/router.js';
import { createBoundaryToolRegistry, executeBoundaryTool } from '../tools/boundary.js';
import { createFakeAgentHarness } from '../runtime/fake-agent.js';
import { runRuntimeEvent } from '../runtime/orchestrator.js';

export interface RuntimeSmokeOptions {
  message: string;
  persona?: string;
  storePath?: string;
  channel?: string;
  baseDir?: string;
  memoryConfig?: MasterConfig['runtime_memory'];
}

export interface RuntimeSmokeResult {
  reply: string;
  storePath: string;
  refs: {
    event: BlockRef;
    route: BlockRef;
    model: BlockRef;
    userMessage: BlockRef;
    assistantMessage: BlockRef;
    toolIntent: BlockRef;
    guardDecision: BlockRef;
    toolOutput?: BlockRef;
  };
  lines: string[];
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

export async function runRuntimeSmoke(options: RuntimeSmokeOptions): Promise<RuntimeSmokeResult> {
  const persona = normalizePersona(options.persona ?? 'mira');
  const storePath = options.storePath ?? (options.memoryConfig?.kind === 'local' ? options.memoryConfig.path : undefined) ?? join(await mkdtemp(join(tmpdir(), 'agent-core-runtime-smoke-')), 'memory.json');
  const selection = createRuntimeMemory({
    baseDir: options.baseDir ?? process.cwd(),
    config: options.memoryConfig ?? { kind: 'local', path: storePath, id_prefix: 'smoke' },
  });
  const memory = selection.memory;
  const reportedStorePath = selection.path ?? 'in-memory';
  const router = createRouter();
  const harness = createFakeAgentHarness(persona, [{ kind: 'echo', prefix: `smoke:${persona}` }]);
  router.registerAgent(persona, harness.agent);
  router.setDefaultAgent(persona);

  const event = createChatEvent({
    id: 'runtime-smoke-event',
    channelType: 'cli-smoke',
    chatId: options.channel ?? 'local',
    text: `@${persona} ${options.message}`,
  });

  const sessionHeap = `persona/${persona}/sessions` as HeapName;
  const auditHeap = 'agent/audit' as HeapName;
  const outputHeap = `persona/${persona}/tool-output` as HeapName;

  const outcome = await runRuntimeEvent({
    event,
    router,
    memory,
    sessionHeap,
    auditHeap,
    modelPolicy,
    availableModels,
    responder: harness.responder,
  });

  const registry = createBoundaryToolRegistry();
  registry.register({
    name: 'local.status',
    description: 'Deterministic local smoke status fixture',
    kind: 'file',
    sensitivity: 'sensitive-compatible',
    action: 'read',
    requiredPermissions: ['local-read'],
    target: () => '/workspace/runtime-smoke-status.txt',
    handler: async () => `runtime smoke ok for ${persona}`,
  });

  const tool = await executeBoundaryTool({
    registry,
    memory,
    auditHeap,
    outputHeap,
    toolName: 'local.status',
    args: {},
    context: { agentName: persona, conversationId: outcome.route.sessionId, baseDir: process.cwd() },
    originRefs: [outcome.eventRef, outcome.routeRef, outcome.assistantMessageRef],
  });

  const refs = {
    event: outcome.eventRef,
    route: outcome.routeRef,
    model: outcome.modelDecisionRef,
    userMessage: outcome.userMessageRef,
    assistantMessage: outcome.assistantMessageRef,
    toolIntent: tool.toolIntentRef,
    guardDecision: tool.guardDecisionRef,
    toolOutput: tool.resultRef,
  };

  const lines = [
    'Runtime smoke completed',
    `Store: ${reportedStorePath}`,
    `Reply: ${outcome.reply}`,
    `Event: ${formatRef(refs.event)}`,
    `Route: ${formatRef(refs.route)}`,
    `Model: ${formatRef(refs.model)} (${outcome.model.model})`,
    `User message: ${formatRef(refs.userMessage)}`,
    `Assistant message: ${formatRef(refs.assistantMessage)}`,
    `Tool intent: ${formatRef(refs.toolIntent)}`,
    `Guard decision: ${formatRef(refs.guardDecision)} (${tool.guardDecision.disposition})`,
    `Tool output: ${refs.toolOutput ? formatRef(refs.toolOutput) : 'inline'}`,
  ];

  return { reply: outcome.reply, storePath: reportedStorePath, refs, lines };
}

function normalizePersona(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  if (!normalized) throw new Error('Persona cannot be empty');
  return normalized;
}

function formatRef(ref: BlockRef): string {
  return `${ref.heap}#${ref.id}`;
}
