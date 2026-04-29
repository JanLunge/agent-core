import type { LLMProvider, Message } from '../llm/types.js';
import type { RuntimeResponder } from './orchestrator.js';

export interface ProviderRuntimeResponderOptions {
  provider: LLMProvider;
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Real provider-backed responder for beta dogfood runtime paths.
 *
 * Unlike FakeAgent/test responders, this crosses the configured LLM provider
 * boundary. Missing providers or credentials should be handled before creating
 * this responder so dogfood commands fail with explicit blockers instead of
 * silently producing deterministic fake replies.
 */
export function createProviderRuntimeResponder(options: ProviderRuntimeResponderOptions): RuntimeResponder {
  return async (input) => {
    const messages: Message[] = [
      {
        role: 'system',
        content: [
          options.systemPrompt ?? 'You are the agent-core dogfood runtime responder. Answer Jan clearly and concisely.',
          'Use the supplied working memory as context. Do not claim access to tools unless tool results are present.',
        ].join('\n'),
      },
      {
        role: 'system',
        content: input.workingMemory.text || 'No prior working memory was retrieved for this turn.',
      },
      ...input.workingMemory.recentMessages.map((message) => ({ role: message.role, content: message.content }) satisfies Message),
    ];

    const response = await options.provider.complete({
      model: options.model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    });

    if (!response.content?.trim()) {
      throw new Error(`Provider ${options.provider.name} returned no assistant content (finishReason=${response.finishReason})`);
    }

    return response.content.trim();
  };
}
