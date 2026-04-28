import type { AgentRuntime } from '../agent/agent.js';
import type { StreamChunk } from '../llm/types.js';
import type { TurnResult } from '../conversation/loop.js';
import type { ApprovalCallback } from '../tools/approval.js';
import { createChatEvent, type EventModeHint, type EventSensitivity, type NormalizedEvent } from '../events/index.js';

export interface IncomingMessage {
  channelType: string;
  chatId: string;
  text: string;
  sender?: string;
}

export type ModelPolicyHint = 'default' | 'local-required';

export interface RouteCandidateScore {
  agentName: string;
  score: number;
  reasons: string[];
}

export interface RoutingDecision {
  eventId: string;
  agentName: string;
  persona?: string;
  channelId: string;
  sessionId: string;
  mode: EventModeHint;
  sensitivity: EventSensitivity;
  modelPolicyHint: ModelPolicyHint;
  respondLive: boolean;
  reason: string;
  candidateScores: RouteCandidateScore[];
}

export interface Router {
  registerAgent(name: string, agent: AgentRuntime): void;
  getAgent(name: string): AgentRuntime | undefined;
  listAgents(): Map<string, AgentRuntime>;
  plan(message: IncomingMessage): RoutingDecision;
  planEvent(event: NormalizedEvent): RoutingDecision;
  route(
    message: IncomingMessage,
    onStream?: (chunk: StreamChunk) => void,
    onApproval?: ApprovalCallback,
  ): Promise<TurnResult>;
  routeEvent(
    event: NormalizedEvent,
    onStream?: (chunk: StreamChunk) => void,
    onApproval?: ApprovalCallback,
  ): Promise<TurnResult>;
  resetChannel(channelType: string, chatId: string): void;
  setDefaultAgent(name: string): void;
}

/**
 * Creates a Router that dispatches incoming channel messages to the
 * appropriate agent. Supports explicit channel bindings and a default agent
 * fallback.
 */
export function createRouter(): Router {
  const agents = new Map<string, AgentRuntime>();
  const bindings = new Map<string, string>(); // "channelType:chatId" → agent name
  let defaultAgentName: string | undefined;

  function normalizeAgentName(name: string): string {
    return name.trim().toLowerCase();
  }

  function scoreCandidates(event: NormalizedEvent): RouteCandidateScore[] {
    const explicitPersona = event.personaHint ? normalizeAgentName(event.personaHint) : undefined;
    const bindingKey = event.conversationKey ?? event.routing.channelId;
    const boundAgent = bindingKey ? bindings.get(bindingKey) : undefined;

    return Array.from(agents.keys()).sort().map((agentName) => {
      const reasons: string[] = [];
      let score = 0;
      if (explicitPersona === agentName) {
        score += 1000;
        reasons.push('explicit-persona-match');
      }
      if (boundAgent === agentName) {
        score += 100;
        reasons.push('existing-channel-binding-match');
      }
      if (defaultAgentName === agentName) {
        score += 10;
        reasons.push('default-agent-match');
      }
      if (event.routing.taskType && agentName === normalizeAgentName(event.routing.taskType)) {
        score += 25;
        reasons.push('task-type-name-match');
      }
      if (reasons.length === 0) reasons.push('fallback-candidate');
      return { agentName, score, reasons };
    }).sort((a, b) => b.score - a.score || a.agentName.localeCompare(b.agentName));
  }

  function resolveAgentName(event: NormalizedEvent): { agentName: string; reason: string; candidateScores: RouteCandidateScore[] } {
    const candidateScores = scoreCandidates(event);
    const explicitPersona = event.personaHint ? normalizeAgentName(event.personaHint) : undefined;
    if (explicitPersona) {
      const explicit = candidateScores.find((candidate) => candidate.agentName === explicitPersona);
      if (explicit) return { agentName: explicit.agentName, reason: 'explicit-persona', candidateScores };
    }

    const bindingKey = event.conversationKey ?? event.routing.channelId;
    const boundAgent = bindingKey ? bindings.get(bindingKey) : undefined;
    if (boundAgent) return { agentName: boundAgent, reason: 'existing-channel-binding', candidateScores };

    const topCandidate = candidateScores[0];
    if (topCandidate) {
      const reason = topCandidate.reasons.includes('default-agent-match') ? 'default-agent' : 'scored-fallback';
      return { agentName: topCandidate.agentName, reason, candidateScores };
    }

    throw new Error('No agent registered to handle this event');
  }

  function planForEvent(event: NormalizedEvent): RoutingDecision {
    const { agentName, reason, candidateScores } = resolveAgentName(event);
    const agent = agents.get(agentName);
    if (!agent) {
      throw new Error(`Agent "${agentName}" not found`);
    }

    const channelId = event.conversationKey ?? event.routing.channelId ?? `${event.source}:${event.id}`;
    const conversation = agent.getOrCreateConversation(channelId);
    const modelPolicyHint: ModelPolicyHint = event.sensitivity === 'sensitive' ? 'local-required' : 'default';

    if (event.source === 'chat' && event.modeHint === 'live') {
      bindings.set(channelId, agentName);
    }

    return {
      eventId: event.id,
      agentName,
      persona: event.personaHint,
      channelId,
      sessionId: conversation.id,
      mode: event.modeHint,
      sensitivity: event.sensitivity,
      modelPolicyHint,
      respondLive: event.modeHint === 'live',
      reason,
      candidateScores,
    };
  }

  return {
    registerAgent(name: string, agent: AgentRuntime): void {
      const normalizedName = normalizeAgentName(name);
      agents.set(normalizedName, agent);
      // First registered agent becomes the default if none is set
      if (!defaultAgentName) {
        defaultAgentName = normalizedName;
      }
    },

    getAgent(name: string): AgentRuntime | undefined {
      return agents.get(normalizeAgentName(name));
    },

    listAgents(): Map<string, AgentRuntime> {
      return new Map(agents);
    },

    plan(message: IncomingMessage): RoutingDecision {
      return planForEvent(createChatEvent({
        channelType: message.channelType,
        chatId: message.chatId,
        text: message.text,
        sender: message.sender,
      }));
    },

    planEvent(event: NormalizedEvent): RoutingDecision {
      return planForEvent(event);
    },

    async route(
      message: IncomingMessage,
      onStream?: (chunk: StreamChunk) => void,
      onApproval?: ApprovalCallback,
    ): Promise<TurnResult> {
      return this.routeEvent(createChatEvent({
        channelType: message.channelType,
        chatId: message.chatId,
        text: message.text,
        sender: message.sender,
      }), onStream, onApproval);
    },

    async routeEvent(
      event: NormalizedEvent,
      onStream?: (chunk: StreamChunk) => void,
      onApproval?: ApprovalCallback,
    ): Promise<TurnResult> {
      const decision = planForEvent(event);
      const agent = agents.get(decision.agentName);
      if (!agent) {
        throw new Error(`Agent "${decision.agentName}" not found`);
      }
      return agent.processMessage(decision.channelId, event.content, onStream, onApproval);
    },

    resetChannel(channelType: string, chatId: string): void {
      const bindingKey = `${channelType}:${chatId}`;
      const agentName = bindings.get(bindingKey) ?? defaultAgentName;
      if (agentName) {
        const agent = agents.get(agentName);
        if (agent) agent.resetConversation(bindingKey);
      }
      bindings.delete(bindingKey);
    },

    setDefaultAgent(name: string): void {
      const normalizedName = normalizeAgentName(name);
      if (!agents.has(normalizedName)) {
        throw new Error(`Cannot set default: agent "${name}" is not registered`);
      }
      defaultAgentName = normalizedName;
    },
  };
}
