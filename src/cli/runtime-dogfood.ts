import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { MasterConfig, ResolvedAgent } from '../config/schema.js';
import { loadConfig } from '../config/loader.js';
import { createChatEvent } from '../events/index.js';
import type { BlockRef, HeapName } from '../heaper/types.js';
import type { LLMProvider } from '../llm/types.js';
import { createProvider, resolveApiKey } from '../llm/client.js';
import { createRouter } from '../router/router.js';
import type { AgentRuntime } from '../agent/agent.js';
import type { Conversation } from '../conversation/conversation.js';
import { createRuntimeMemory } from '../runtime/memory-config.js';
import { runRuntimeEvent, RuntimeBlockedError } from '../runtime/orchestrator.js';
import { createProviderRuntimeResponder } from '../runtime/provider-responder.js';

export interface RuntimeDogfoodOptions {
  baseDir: string;
  message: string;
  agent?: string;
  storePath?: string;
  channel?: string;
  provider?: LLMProvider;
  now?: () => string;
}

export interface RuntimeDogfoodResult {
  reply?: string;
  blocked: boolean;
  blocker?: string;
  storePath: string;
  refs: {
    event?: BlockRef;
    route?: BlockRef;
    model?: BlockRef;
    userMessage?: BlockRef;
    assistantMessage?: BlockRef;
    blocker?: BlockRef;
    notificationOutbox?: BlockRef;
  };
  lines: string[];
}

export async function runRuntimeDogfood(options: RuntimeDogfoodOptions): Promise<RuntimeDogfoodResult> {
  const baseDir = resolve(options.baseDir);
  const loaded = loadConfig(baseDir);
  const agent = selectAgent(loaded.resolved, options.agent);
  const providerProfile = loaded.master.providers.find((profile) => profile.name === agent.provider);
  const explicitProvider = options.provider;

  if (!providerProfile && !explicitProvider) {
    return blockedResult({
      storePath: options.storePath ?? 'not-created',
      blocker: `No provider profile configured for agent ${agent.name} (provider: ${agent.provider})`,
    });
  }

  if (providerProfile && !explicitProvider) {
    const needsApiKey = providerProfile.type === 'openai-compatible' || providerProfile.type === 'anthropic' || providerProfile.type === 'openai-codex';
    if (needsApiKey && !resolveApiKey(providerProfile)) {
      return blockedResult({
        storePath: options.storePath ?? 'not-created',
        blocker: `Provider ${providerProfile.name} requires credentials; set ${providerProfile.api_key_env ?? `${providerProfile.name}_api_key`} or configure a vault secret`,
      });
    }
  }

  const storePath = options.storePath ?? join(await mkdtemp(join(tmpdir(), 'agent-core-runtime-dogfood-')), 'memory.json');
  const memoryConfig: MasterConfig['runtime_memory'] = { ...(loaded.master.runtime_memory ?? {}), kind: 'local', path: storePath, id_prefix: 'dogfood' };
  const memory = createRuntimeMemory({ baseDir, config: memoryConfig, now: options.now }).memory;
  const provider = explicitProvider ?? createProvider(providerProfile!);
  const router = createRouter();
  router.registerAgent(agent.name, createPlanningAgent(agent));
  router.setDefaultAgent(agent.name);

  const event = createChatEvent({
    id: 'runtime-dogfood-event',
    channelType: 'telegram-replay',
    chatId: options.channel ?? 'local-dogfood',
    text: mentionIfNeeded(agent.name, options.message),
  });

  try {
    const outcome = await runRuntimeEvent({
      event,
      router,
      memory,
      sessionHeap: `persona/${agent.name.toLowerCase()}/sessions` as HeapName,
      auditHeap: 'agent/audit',
      dailyHeap: `persona/${agent.name.toLowerCase()}/daily` as HeapName,
      notificationOutboxHeap: 'agent/notifications',
      modelPolicy: {
        defaultModel: agent.model,
        strongModel: agent.model,
        localModel: agent.model,
      },
      availableModels: [{ id: agent.model, capabilities: ['remote'] }],
      responder: createProviderRuntimeResponder({
        provider,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      }),
    });

    const refs = {
      event: outcome.eventRef,
      route: outcome.routeRef,
      model: outcome.modelDecisionRef,
      userMessage: outcome.userMessageRef,
      assistantMessage: outcome.assistantMessageRef,
      notificationOutbox: outcome.notificationOutboxRef,
    };

    return {
      reply: outcome.reply,
      blocked: false,
      storePath,
      refs,
      lines: renderLines({ storePath, reply: outcome.reply, refs, model: agent.model }),
    };
  } catch (err) {
    if (err instanceof RuntimeBlockedError) {
      return blockedResult({
        storePath,
        blocker: err.message,
        refs: { blocker: err.blockerRef, notificationOutbox: err.notificationOutboxRef },
      });
    }
    return blockedResult({ storePath, blocker: err instanceof Error ? err.message : String(err) });
  }
}

function selectAgent(agents: Map<string, ResolvedAgent>, requested?: string): ResolvedAgent {
  if (requested) {
    const agent = agents.get(requested) ?? agents.get(requested.toLowerCase());
    if (!agent) throw new Error(`Agent ${requested} not found. Available: ${[...agents.keys()].join(', ')}`);
    return agent;
  }
  const first = [...agents.values()][0];
  if (!first) throw new Error('No agents configured. Create an agent YAML file in the agents/ directory.');
  return first;
}

function createPlanningAgent(config: ResolvedAgent): AgentRuntime {
  const conversations = new Map<string, Conversation>();
  return {
    config,
    brain: undefined as never,
    registry: undefined as never,
    status: 'idle',
    getOrCreateConversation(channelId: string): Conversation {
      const existing = conversations.get(channelId);
      if (existing) return existing;
      const conversation = {
        id: `${config.name.toLowerCase()}-dogfood-${conversations.size + 1}`,
        agentName: config.name,
        channelId,
        status: 'active',
        focus: undefined,
        addMessage: () => undefined,
        getHistory: () => [],
        setFocus: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        end: () => undefined,
      } satisfies Conversation;
      conversations.set(channelId, conversation);
      return conversation;
    },
    resetConversation(channelId: string): void { conversations.delete(channelId); },
    async processMessage(): Promise<never> { throw new Error('Dogfood runtime uses runRuntimeEvent with a provider responder, not Router.route/processMessage'); },
    stop(): void { this.status = 'stopped'; },
  };
}

function mentionIfNeeded(agentName: string, message: string): string {
  const trimmed = message.trim();
  return trimmed.startsWith('@') ? trimmed : `@${agentName.toLowerCase()} ${trimmed}`;
}

function blockedResult(input: { storePath: string; blocker: string; refs?: RuntimeDogfoodResult['refs'] }): RuntimeDogfoodResult {
  const refs = input.refs ?? {};
  return {
    blocked: true,
    blocker: input.blocker,
    storePath: input.storePath,
    refs,
    lines: [
      'Runtime dogfood blocked',
      `Store: ${input.storePath}`,
      `Blocker: ${input.blocker}`,
      ...(refs.blocker ? [`Blocker ref: ${formatRef(refs.blocker)}`] : []),
      ...(refs.notificationOutbox ? [`Notification outbox: ${formatRef(refs.notificationOutbox)}`] : []),
    ],
  };
}

function renderLines(input: { storePath: string; reply: string; refs: RuntimeDogfoodResult['refs']; model: string }): string[] {
  return [
    'Runtime dogfood completed',
    `Store: ${input.storePath}`,
    `Model: ${input.model}`,
    `Reply: ${input.reply}`,
    `Event: ${input.refs.event ? formatRef(input.refs.event) : 'missing'}`,
    `Route: ${input.refs.route ? formatRef(input.refs.route) : 'missing'}`,
    `Model decision: ${input.refs.model ? formatRef(input.refs.model) : 'missing'}`,
    `User message: ${input.refs.userMessage ? formatRef(input.refs.userMessage) : 'missing'}`,
    `Assistant message: ${input.refs.assistantMessage ? formatRef(input.refs.assistantMessage) : 'missing'}`,
    `Runtime status: pnpm --silent tsx src/cli/index.ts runtime-status --store ${input.storePath}`,
    `Audit export: pnpm --silent tsx src/cli/index.ts audit-export ${input.refs.event ? formatRef(input.refs.event) : '<event-ref>'} --store ${input.storePath}`,
  ];
}

function formatRef(ref: BlockRef): string {
  return `${ref.heap}#${ref.id}`;
}
