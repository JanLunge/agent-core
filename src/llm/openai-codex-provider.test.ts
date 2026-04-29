import { describe, expect, it } from 'vitest';
import { OPENAI_CODEX_API, OPENAI_CODEX_BASE_URL, createOpenAICodexProvider } from './openai-codex-provider.js';

describe('openai-codex provider', () => {
  it('documents the ChatGPT/Codex subscription route separately from the CLI harness', () => {
    expect(OPENAI_CODEX_API).toBe('openai-codex-responses');
    expect(OPENAI_CODEX_BASE_URL).toBe('https://chatgpt.com/backend-api/codex');
  });

  it('creates an API-style provider shell', () => {
    const provider = createOpenAICodexProvider('codex-subscription', { accessToken: 'test-token' });
    expect(provider.name).toBe('codex-subscription');
    expect(provider.complete).toBeTypeOf('function');
    expect(provider.stream).toBeTypeOf('function');
  });
});
