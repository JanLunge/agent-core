import { Bot } from 'grammy';
import type { MasterConfig } from '../config/schema.js';
import { createChatEvent } from '../events/index.js';
import type { BlockRef, HeapName, HeaperMemory } from '../heaper/types.js';
import { createRuntimeMemory } from '../runtime/memory-config.js';
import { createFakeAgentHarness } from '../runtime/fake-agent.js';
import { runRuntimeEvent, type RuntimeOutcome } from '../runtime/orchestrator.js';
import { createRouter, type Router } from '../router/router.js';
import { createBoundaryToolRegistry, executeBoundaryTool, type BoundaryToolExecution, type BoundaryToolRegistry } from '../tools/boundary.js';
import type { GuardRequest } from '../tools/guard.js';

export interface RuntimeTelegramSpikeOptions {
  token: string;
  storePath: string;
  allowedUsers?: number[];
  baseDir?: string;
  memoryConfig?: MasterConfig['runtime_memory'];
}

export interface RuntimeTelegramSpikeRuntime {
  storePath: string;
  handleTurn(input: { chatId: string; text: string; sender?: string; messageId?: string }): Promise<RuntimeTelegramSpikeTurn>;
}

export interface RuntimeTelegramSpikeTurn {
  text: string;
  outcome: RuntimeOutcome;
  boundaryExecutions: BoundaryToolExecution[];
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

const sessionHeap = 'agent/sessions' as HeapName;
const auditHeap = 'agent/audit' as HeapName;
const outputHeap = 'agent/tool-output' as HeapName;

export function createRuntimeTelegramSpikeRuntime(options: Omit<RuntimeTelegramSpikeOptions, 'token' | 'allowedUsers'>): RuntimeTelegramSpikeRuntime {
  const selection = createRuntimeMemory({
    baseDir: options.baseDir ?? process.cwd(),
    config: options.memoryConfig ?? { kind: 'local', path: options.storePath, id_prefix: 'tgspike' },
  });
  const memory = selection.memory;
  const router = createSpikeRouter();
  const registry = createSpikeToolRegistry();

  return {
    storePath: selection.path ?? options.storePath,
    async handleTurn(input) {
      const event = createChatEvent({
        id: input.messageId ? `telegram-${input.messageId}` : undefined,
        channelType: 'telegram',
        chatId: input.chatId,
        text: input.text,
        sender: input.sender,
      });

      const outcome = await runRuntimeEvent({
        event,
        router,
        memory,
        sessionHeap,
        auditHeap,
        modelPolicy,
        availableModels,
        guardRequests: guardRequestsFor(input.text),
        responder: ({ route, workingMemory, model, guardDecisions }) => [
          `Spike responder for ${route.agentName}.`,
          `route=${route.reason} session=${route.sessionId} mode=${route.mode} sensitivity=${route.sensitivity}`,
          `model=${model.model}`,
          `workingMemoryMessages=${workingMemory.stats.messageCount} retrieved=${workingMemory.stats.retrievedCount}`,
          guardDecisions.length > 0 ? `runtimeGuards=${guardDecisions.map((guard) => `${guard.disposition}:${guard.reason}`).join(' | ')}` : 'runtimeGuards=none',
        ].join('\n'),
      });

      const boundaryExecutions = await runRequestedBoundaryTools({
        text: input.text,
        registry,
        memory,
        routeSessionId: outcome.route.sessionId,
        originRefs: [outcome.eventRef, outcome.routeRef, outcome.assistantMessageRef],
      });

      return {
        outcome,
        boundaryExecutions,
        text: renderSpikeReply({ outcome, boundaryExecutions, storePath: selection.path ?? options.storePath }),
      };
    },
  };
}

export async function startRuntimeTelegramSpike(options: RuntimeTelegramSpikeOptions): Promise<{ stop(): void; runtime: RuntimeTelegramSpikeRuntime }> {
  const runtime = createRuntimeTelegramSpikeRuntime(options);
  const allowedUsers = options.allowedUsers ? new Set(options.allowedUsers) : undefined;
  const bot = new Bot(options.token);

  bot.on('message:text', async (ctx) => {
    const userId = ctx.from?.id;
    if (allowedUsers && (!userId || !allowedUsers.has(userId))) return;

    const placeholder = await ctx.reply('agent-core runtime spike is thinking…');
    try {
      const turn = await runtime.handleTurn({
        chatId: String(ctx.chat.id),
        text: ctx.message.text,
        sender: ctx.from?.username ?? ctx.from?.first_name,
        messageId: String(ctx.message.message_id),
      });
      await ctx.api.editMessageText(placeholder.chat.id, placeholder.message_id, turn.text).catch(async () => {
        await ctx.reply(turn.text);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.api.editMessageText(placeholder.chat.id, placeholder.message_id, `Runtime spike failed: ${message}`).catch(async () => {
        await ctx.reply(`Runtime spike failed: ${message}`);
      });
    }
  });

  await bot.start({
    onStart: (info) => {
      console.log(`[runtime-telegram-spike] Bot @${info.username} running`);
      console.log(`[runtime-telegram-spike] Store: ${runtime.storePath}`);
    },
  });

  return { stop: () => bot.stop(), runtime };
}

function createSpikeRouter(): Router {
  const router = createRouter();
  for (const name of ['mira', 'ops']) {
    const harness = createFakeAgentHarness(name, [{ kind: 'echo', prefix: `spike:${name}` }]);
    router.registerAgent(name, harness.agent);
  }
  router.setDefaultAgent('mira');
  return router;
}

function createSpikeToolRegistry(): BoundaryToolRegistry {
  const registry = createBoundaryToolRegistry();
  registry.register({
    name: 'spike.status',
    description: 'Deterministic local status fixture for production-spike testing.',
    kind: 'file',
    sensitivity: 'sensitive-compatible',
    action: 'read',
    requiredPermissions: ['local-read'],
    target: () => '/workspace/agent-core-spike-status.txt',
    handler: async () => 'agent-core runtime spike status: ok',
  });
  registry.register({
    name: 'spike.write-note',
    description: 'Write-note fixture that should ask before execution.',
    kind: 'file',
    sensitivity: 'normal',
    action: 'write',
    requiredPermissions: ['local-write'],
    target: () => '/tmp/agent-core-spike-note.txt',
    handler: async () => 'SHOULD_NOT_RUN_WITHOUT_APPROVAL',
  });
  registry.register({
    name: 'spike.read-secret',
    description: 'Secret-read fixture that should be denied.',
    kind: 'file',
    sensitivity: 'normal',
    action: 'read',
    requiredPermissions: ['local-read'],
    target: () => '/tmp/.env',
    handler: async () => 'SHOULD_NOT_READ_SECRET',
  });
  return registry;
}

function guardRequestsFor(text: string): GuardRequest[] {
  const lower = text.toLowerCase();
  const requests: GuardRequest[] = [];
  if (lower.includes('external') || lower.includes('api')) {
    requests.push({ surface: 'api', action: 'network', target: 'https://example.com/spike', external: true });
  }
  if (lower.includes('risky shell')) {
    requests.push({ surface: 'shell', action: 'execute', target: 'rm -rf /tmp/agent-core-spike', command: 'rm -rf /tmp/agent-core-spike' });
  }
  return requests;
}

async function runRequestedBoundaryTools(input: {
  text: string;
  registry: BoundaryToolRegistry;
  memory: HeaperMemory;
  routeSessionId: string;
  originRefs: BlockRef[];
}): Promise<BoundaryToolExecution[]> {
  const lower = input.text.toLowerCase();
  const requested: string[] = [];
  if (lower.includes('status tool') || lower.includes('local status')) requested.push('spike.status');
  if (lower.includes('write note') || lower.includes('write tool')) requested.push('spike.write-note');
  if (lower.includes('.env') || lower.includes('secret')) requested.push('spike.read-secret');

  const executions: BoundaryToolExecution[] = [];
  for (const toolName of requested) {
    executions.push(await executeBoundaryTool({
      registry: input.registry,
      memory: input.memory,
      auditHeap,
      outputHeap,
      toolName,
      args: {},
      context: { agentName: 'mira', conversationId: input.routeSessionId, baseDir: process.cwd() },
      originRefs: input.originRefs,
    }));
  }
  return executions;
}

function renderSpikeReply(input: { outcome: RuntimeOutcome; boundaryExecutions: BoundaryToolExecution[]; storePath: string }): string {
  const { outcome } = input;
  const lines = [
    'Agent-core runtime spike ✅',
    `agent: ${outcome.route.agentName}`,
    `route: ${outcome.route.reason}`,
    `session: ${outcome.route.sessionId}`,
    `mode: ${outcome.route.mode}`,
    `sensitivity: ${outcome.route.sensitivity}`,
    `model: ${outcome.model.model}`,
    `working memory: ${outcome.workingMemory.stats.messageCount} recent messages, ${outcome.workingMemory.stats.retrievedCount} retrieved blocks`,
    `runtime guards: ${outcome.guardDecisions.length ? outcome.guardDecisions.map((guard) => `${guard.disposition} (${guard.reason})`).join('; ') : 'none'}`,
    `boundary tools: ${input.boundaryExecutions.length ? input.boundaryExecutions.map((tool) => `${tool.result.name}=${tool.guardDecision.disposition}${tool.approvalRequestRef ? ` approval=${formatRef(tool.approvalRequestRef)}` : ''}${tool.resultRef ? ` output=${formatRef(tool.resultRef)}` : ''}`).join('; ') : 'none'}`,
    `refs: event=${formatRef(outcome.eventRef)} route=${formatRef(outcome.routeRef)} assistant=${formatRef(outcome.assistantMessageRef)}`,
    `store: ${input.storePath}`,
  ];
  return lines.join('\n');
}

function formatRef(ref: BlockRef): string {
  return `${ref.heap}#${ref.id}`;
}
