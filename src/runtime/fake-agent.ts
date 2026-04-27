import type { AgentRuntime } from '../agent/agent.js';
import type { TurnResult } from '../conversation/loop.js';
import type { RuntimeResponder, RuntimeResponderInput } from './orchestrator.js';

export type FakeAgentScriptStep =
  | { kind: 'reply'; text: string }
  | { kind: 'echo'; prefix?: string }
  | { kind: 'tool-intent'; toolName: string; successText: string; deniedText?: string };

export interface FakeAgentHarness {
  agent: AgentRuntime;
  responder: RuntimeResponder;
  receivedContexts: RuntimeResponderInput[];
  calls: Array<{ channelId: string; message: string }>;
}

/**
 * Deterministic fake agent harness for runtime tests.
 *
 * The AgentRuntime side is only used by the router to create stable sessions.
 * The responder side receives the full runtime context and returns scripted
 * replies without calling external models or tools.
 */
export function createFakeAgentHarness(name: string, script: FakeAgentScriptStep[] = [{ kind: 'echo' }]): FakeAgentHarness {
  const sessions = new Map<string, { id: string }>();
  const receivedContexts: RuntimeResponderInput[] = [];
  const calls: Array<{ channelId: string; message: string }> = [];
  let nextStep = 0;

  const agent = {
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
    resetConversation(channelId: string) {
      sessions.delete(channelId);
    },
    async processMessage(channelId: string, message: string): Promise<TurnResult> {
      calls.push({ channelId, message });
      return { reply: `${name}:${message}`, toolCalls: [], toolResults: [], usage: { promptTokens: 0, completionTokens: 0 } };
    },
    stop() {},
  } as AgentRuntime;

  const responder: RuntimeResponder = (context) => {
    receivedContexts.push(context);
    const step = script[Math.min(nextStep, script.length - 1)] ?? { kind: 'echo' as const };
    nextStep += 1;

    if (step.kind === 'reply') return step.text;
    if (step.kind === 'echo') return `${step.prefix ?? 'echo'}:${context.event.content}`;

    const denied = context.guardDecisions.find((decision) => decision.disposition === 'deny');
    if (denied) {
      return step.deniedText ?? `tool denied:${step.toolName}:${denied.reason}`;
    }
    return step.successText;
  };

  return { agent, responder, receivedContexts, calls };
}
