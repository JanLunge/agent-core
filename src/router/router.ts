import type { AgentRuntime } from '../agent/agent.js';
import type { StreamChunk } from '../llm/types.js';
import type { TurnResult } from '../conversation/loop.js';
import type { ApprovalCallback } from '../tools/approval.js';

export interface IncomingMessage {
  channelType: string;
  chatId: string;
  text: string;
  sender?: string;
}

export interface Router {
  registerAgent(name: string, agent: AgentRuntime): void;
  getAgent(name: string): AgentRuntime | undefined;
  listAgents(): Map<string, AgentRuntime>;
  route(
    message: IncomingMessage,
    onStream?: (chunk: StreamChunk) => void,
    onApproval?: ApprovalCallback,
  ): Promise<TurnResult>;
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

  return {
    registerAgent(name: string, agent: AgentRuntime): void {
      agents.set(name, agent);
      // First registered agent becomes the default if none is set
      if (!defaultAgentName) {
        defaultAgentName = name;
      }
    },

    getAgent(name: string): AgentRuntime | undefined {
      return agents.get(name);
    },

    listAgents(): Map<string, AgentRuntime> {
      return new Map(agents);
    },

    async route(
      message: IncomingMessage,
      onStream?: (chunk: StreamChunk) => void,
      onApproval?: ApprovalCallback,
    ): Promise<TurnResult> {
      const bindingKey = `${message.channelType}:${message.chatId}`;
      const agentName = bindings.get(bindingKey) ?? defaultAgentName;

      if (!agentName) {
        throw new Error('No agent registered to handle this message');
      }

      const agent = agents.get(agentName);
      if (!agent) {
        throw new Error(`Agent "${agentName}" not found`);
      }

      const channelId = bindingKey;
      return agent.processMessage(channelId, message.text, onStream, onApproval);
    },

    setDefaultAgent(name: string): void {
      if (!agents.has(name)) {
        throw new Error(`Cannot set default: agent "${name}" is not registered`);
      }
      defaultAgentName = name;
    },
  };
}
