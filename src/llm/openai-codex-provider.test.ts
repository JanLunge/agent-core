import { describe, expect, it, vi } from 'vitest';
import { OPENAI_CODEX_API, OPENAI_CODEX_BASE_URL, createOpenAICodexProvider } from './openai-codex-provider.js';

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('openai-codex provider', () => {
  it('documents the ChatGPT/Codex subscription route separately from the CLI harness', () => {
    expect(OPENAI_CODEX_API).toBe('openai-codex-responses');
    expect(OPENAI_CODEX_BASE_URL).toBe('https://chatgpt.com/backend-api/codex');
  });

  it('uses required Codex Responses streaming transport instead of chat completions', async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      { type: 'response.output_text.delta', delta: 'ok' },
      { type: 'response.completed', response: { model: 'gpt-5.5', status: 'completed', usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } },
    ]));
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
    expect(result.usage).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
    expect(fetchMock).toHaveBeenCalledWith('https://chatgpt.com/backend-api/codex/responses', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer test-token',
        Accept: 'text/event-stream',
      }),
    }));
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'gpt-5.5',
      instructions: expect.any(String),
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'ping' }] }],
      stream: true,
      store: false,
    });
  });

  it('sends system messages as required Responses instructions', async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      { type: 'response.output_text.delta', delta: 'ok' },
      { type: 'response.completed', response: { model: 'gpt-5.5', status: 'completed' } },
    ]));
    const provider = createOpenAICodexProvider('codex-subscription', {
      accessToken: 'test-token',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await provider.complete({
      model: 'gpt-5.5',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'ping' },
      ],
    });

    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.instructions).toBe('Be concise.');
    expect(body.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'ping' }] }]);
  });

  it('returns function calls from streamed Responses output for the agent-core harness', async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      {
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call_1',
          name: 'exec',
          arguments: '{"command":"pwd"}',
        },
      },
      { type: 'response.completed', response: { model: 'gpt-5.5', status: 'completed' } },
    ]));
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

  it('streams text chunks and done events from Codex Responses SSE', async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      { type: 'response.output_text.delta', delta: 'he' },
      { type: 'response.output_text.delta', delta: 'llo' },
      { type: 'response.completed', response: { model: 'gpt-5.5', status: 'completed' } },
    ]));
    const provider = createOpenAICodexProvider('codex-subscription', {
      accessToken: 'test-token',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const chunks = [];
    for await (const chunk of provider.stream({ model: 'gpt-5.5', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'text', text: 'he' },
      { type: 'text', text: 'llo' },
      { type: 'done', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    ]);
  });
});
