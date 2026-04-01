import type { ResolvedAgent } from '../config/schema.js';
import type { LLMProvider, StreamChunk } from '../llm/types.js';
import { createBrain, type Brain } from '../memory/brain.js';
import type { MemoryStore } from '../memory/store.js';
import type { IdentityStore } from '../memory/identity-store.js';
import { ConversationStore } from '../conversation/persistence.js';
import { createConversation, type Conversation } from '../conversation/conversation.js';
import { runTurn, type TurnResult, type LoopOptions } from '../conversation/loop.js';
import { ToolRegistry, type ToolContext } from '../tools/registry.js';
import type { ToolPolicy } from '../tools/policy.js';
import type { ApprovalCallback } from '../tools/approval.js';
import type { TraceStore } from '../journal/trace.js';

export type AgentStatus = 'idle' | 'running' | 'stopped';

export interface AgentRuntime {
  readonly config: ResolvedAgent;
  readonly brain: Brain;
  readonly registry: ToolRegistry;
  status: AgentStatus;
  getOrCreateConversation(channelId: string): Conversation;
  resetConversation(channelId: string): void;
  processMessage(
    channelId: string,
    message: string,
    onStream?: (chunk: StreamChunk) => void,
    onApproval?: ApprovalCallback,
  ): Promise<TurnResult>;
  stop(): void;
}

export interface CreateAgentOptions {
  config: ResolvedAgent;
  provider: LLMProvider;
  store: ConversationStore;
  registry: ToolRegistry;
  memoryStore?: MemoryStore;
  identityStore?: IdentityStore;
  toolPolicy?: ToolPolicy;
  traceStore?: TraceStore;
  baseDir: string;
}

export function createAgent(options: CreateAgentOptions): AgentRuntime {
  const { config, provider, store, registry, memoryStore, identityStore, toolPolicy, traceStore, baseDir } = options;
  const brain = createBrain(config, baseDir, memoryStore);
  let status: AgentStatus = 'idle';

  const runtime: AgentRuntime = {
    get config() { return config; },
    get brain() { return brain; },
    get registry() { return registry; },
    get status() { return status; },
    set status(v) { status = v; },

    getOrCreateConversation(channelId: string): Conversation {
      return createConversation(config.name, channelId, store);
    },

    resetConversation(channelId: string): void {
      const existing = store.findActiveConversation(config.name, channelId);
      if (existing) {
        store.updateStatus(existing.id, 'ended');
      }
    },

    async processMessage(
      channelId: string,
      message: string,
      onStream?: (chunk: StreamChunk) => void,
      onApproval?: ApprovalCallback,
    ): Promise<TurnResult> {
      if (status === 'stopped') throw new Error(`Agent "${config.name}" is stopped`);
      status = 'running';
      try {
        const conversation = runtime.getOrCreateConversation(channelId);
        const toolContext: ToolContext = {
          agentName: config.name,
          conversationId: conversation.id,
          baseDir,
          brain,
          identityStore,
        };
        const loopOptions: LoopOptions = {
          conversation,
          brain,
          provider,
          model: config.model,
          registry,
          toolContext,
          toolPolicy,
          onApproval,
          traceStore,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          onStream,
        };
        return await runTurn(message, loopOptions);
      } finally {
        if ((status as AgentStatus) !== 'stopped') status = 'idle';
      }
    },

    stop() { status = 'stopped'; },
  };

  return runtime;
}
