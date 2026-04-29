import { describe, expect, it, vi } from 'vitest';
import { OPENAI_CODEX_API, OPENAI_CODEX_BASE_URL, createOpenAICodexProvider } from './openai-codex-provider.js';

describe('openai-codex provider', () => {
  it('documents the ChatGPT/Codex subscription route separately from the CLI harness', () => {
    expect(OPENAI_CODEX_API).toBe('openai-codex-responses');
    expect(OPENAI_CODEX_BASE_URL).toBe('https://chatgpt.com/backend-api/codex');
  });

  it('uses the Codex Responses transport instead of chat completions', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      model: 'gpt-5.5',
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'ok' }],
      }],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const provider = createOpenAICodexProvider('codex-subscription', {
      accessToken: 'test-token',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await provider.complete({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(result.content).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith('https://chatgpt.com/backend-api/codex/responses', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer test-token',
        Accept: 'application/json',
      }),
    }));
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'gpt-5.5',
      input: [{ role: 'user', content: 'ping' }],
      stream: false,
    });
  });

  it('returns function calls from the Responses output for the agent-core harness', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      model: 'gpt-5.5',
      output: [{
        type: 'function_call',
        call_id: 'call_1',
        name: 'exec',
        arguments: '{"command":"pwd"}',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const provider = createOpenAICodexProvider('codex-subscription', {
      accessToken: 'test-token',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await provider.complete({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'run pwd' }],
      tools: [{ name: 'exec', description: 'execute', parameters: { type: 'object' } }],
    });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toEqual([{ id: 'call_1', type: 'function', function: { name: 'exec', arguments: '{"command":"pwd"}' } }]);
  });
});
