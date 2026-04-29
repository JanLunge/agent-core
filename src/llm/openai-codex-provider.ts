import { createOpenAIProvider } from './openai-provider.js';
import type { LLMProvider } from './types.js';

export const OPENAI_CODEX_PROVIDER_NAME = 'openai-codex';
export const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
export const OPENAI_CODEX_API = 'openai-codex-responses';

export interface OpenAICodexProviderOptions {
  accessToken?: string;
  baseURL?: string;
}

/**
 * API-style provider for the ChatGPT/Codex subscription route.
 *
 * This is intentionally distinct from `codex-cli`: the CLI is a harness that
 * owns its internal tool/sandbox loop, while this provider is meant to behave
 * like a normal model transport so agent-core can own tools, approvals, and
 * execution.
 */
export function createOpenAICodexProvider(
  name: string,
  options: OpenAICodexProviderOptions = {},
): LLMProvider {
  return createOpenAIProvider(name, {
    apiKey: options.accessToken,
    baseURL: options.baseURL ?? OPENAI_CODEX_BASE_URL,
  });
}
