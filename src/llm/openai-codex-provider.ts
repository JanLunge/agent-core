import type { LLMProvider, LLMRequest, LLMResponse, Message, StreamChunk, ToolCall, ToolDefinition, Usage } from './types.js';

export const OPENAI_CODEX_PROVIDER_NAME = 'openai-codex';
export const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
export const OPENAI_CODEX_API = 'openai-codex-responses';

type FetchLike = typeof fetch;

export interface OpenAICodexProviderOptions {
  accessToken?: string;
  baseURL?: string;
  fetch?: FetchLike;
}

function toResponsesInstructions(messages: Message[]): string {
  return messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');
}

function splitToolCallId(id: string | undefined): { callId: string; itemId?: string } {
  const [callId = '', itemId] = (id ?? '').split('|');
  return { callId, itemId };
}

function toResponsesInput(messages: Message[]): unknown[] {
  const input: unknown[] = [];
  const toolOutputCallIds = new Set(messages
    .filter((message) => message.role === 'tool')
    .map((message) => splitToolCallId(message.tool_call_id).callId)
    .filter(Boolean));
  const assistantCallIds = new Set(messages
    .flatMap((message) => message.role === 'assistant' ? message.tool_calls ?? [] : [])
    .map((toolCall) => splitToolCallId(toolCall.id).callId)
    .filter(Boolean));

  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      const { callId } = splitToolCallId(message.tool_call_id);
      if (callId && assistantCallIds.has(callId)) {
        input.push({ type: 'function_call_output', call_id: callId, output: message.content });
      }
      continue;
    }
    if (message.role === 'assistant' && message.tool_calls?.length) {
      for (const toolCall of message.tool_calls) {
        const { callId, itemId } = splitToolCallId(toolCall.id);
        // Codex Responses rejects replayed function calls that do not have a
        // matching function_call_output in the same input. This can happen if a
        // previous process crashed, approval was never completed, or older buggy
        // code stored a call without a result. Drop those orphaned calls so one
        // bad historical turn does not poison the whole active conversation.
        if (!callId || !toolOutputCallIds.has(callId)) continue;
        input.push({
          type: 'function_call',
          id: itemId,
          call_id: callId,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        });
      }
      if (!message.content) continue;
    }
    input.push({
      role: message.role,
      content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }],
    });
  }
  return input;
}

function toResponsesTools(tools: ToolDefinition[] | undefined): unknown[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function buildResponsesPayload(req: LLMRequest): Record<string, unknown> {
  return {
    model: req.model,
    instructions: toResponsesInstructions(req.messages) || 'You are an assistant running inside agent-core. Answer clearly and use provided tools by returning function calls when needed; agent-core will execute tools after policy checks and approvals.',
    input: toResponsesInput(req.messages),
    tools: toResponsesTools(req.tools),
    temperature: req.temperature,
    max_output_tokens: req.max_tokens,
    stream: true,
    store: false,
  };
}

function extractToolCallFromItem(item: any, index: number): ToolCall | undefined {
  if (item?.type !== 'function_call') return undefined;
  const callId = String(item.call_id ?? `call_${index}`);
  const itemId = typeof item.id === 'string' && item.id ? item.id : `fc_${index}`;
  return {
    id: `${callId}|${itemId}`,
    type: 'function',
    function: {
      name: String(item.name ?? ''),
      arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
    },
  };
}

function extractUsage(response: any): Usage {
  const usage = response?.usage ?? {};
  const promptTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const completionTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage.total_tokens ?? promptTokens + completionTokens,
  };
}

async function readErrorBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.slice(0, 500);
}

function parseSseData(block: string): any | undefined {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n')
    .trim();
  if (!data || data === '[DONE]') return undefined;
  return JSON.parse(data);
}

async function* parseResponseEvents(response: Response): AsyncIterable<any> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const event = parseSseData(block);
      if (event) yield event;
    }
  }
  buffer += decoder.decode();
  const finalEvent = parseSseData(buffer);
  if (finalEvent) yield finalEvent;
}

function textDeltaFromEvent(event: any): string | undefined {
  if (event?.type === 'response.output_text.delta' && typeof event.delta === 'string') return event.delta;
  if (event?.type === 'response.message.delta' && typeof event.delta?.content === 'string') return event.delta.content;
  return undefined;
}

function textDoneFromItem(item: any): string | undefined {
  if (item?.type !== 'message') return undefined;
  const content = Array.isArray(item.content) ? item.content : [];
  const text = content
    .map((part: any) => part?.type === 'output_text' ? part.text ?? '' : part?.refusal ?? '')
    .join('');
  return text || undefined;
}

function completedResponseFromEvent(event: any): any | undefined {
  if (event?.type === 'response.completed') return event.response;
  if (event?.type === 'response.failed') return event.response ?? { status: 'failed' };
  return undefined;
}

/**
 * API-style provider for the ChatGPT/Codex subscription route.
 *
 * The ChatGPT Codex backend requires Responses streaming (`stream: true`) and
 * `store: false`. Codex CLI remains a separate harness boundary; agent-core
 * owns tools, approvals, and execution for this provider.
 */
export function createOpenAICodexProvider(
  name: string,
  options: OpenAICodexProviderOptions = {},
): LLMProvider {
  const fetchImpl = options.fetch ?? fetch;
  const baseURL = (options.baseURL ?? OPENAI_CODEX_BASE_URL).replace(/\/$/, '');

  async function request(req: LLMRequest): Promise<Response> {
    if (!options.accessToken) throw new Error('openai-codex provider needs an access token');
    const response = await fetchImpl(`${baseURL}/responses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${options.accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(buildResponsesPayload(req)),
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw new Error(`openai-codex responses request failed: HTTP ${response.status}${body ? ` ${body}` : ''}`);
    }
    return response;
  }

  async function complete(req: LLMRequest): Promise<LLMResponse> {
    let content = '';
    const toolCalls: ToolCall[] = [];
    let completed: any;
    for await (const event of parseResponseEvents(await request(req))) {
      const delta = textDeltaFromEvent(event);
      if (delta) content += delta;
      if (event?.type === 'response.output_item.done') {
        const finalText = textDoneFromItem(event.item);
        if (finalText !== undefined) content = finalText;
        const toolCall = extractToolCallFromItem(event.item, toolCalls.length);
        if (toolCall) toolCalls.push(toolCall);
      }
      completed = completedResponseFromEvent(event) ?? completed;
    }
    return {
      content: content || null,
      toolCalls,
      usage: extractUsage(completed),
      finishReason: toolCalls.length ? 'tool_calls' : completed?.status === 'incomplete' ? 'length' : completed?.status === 'failed' ? 'error' : 'stop',
      model: completed?.model ?? req.model,
    };
  }

  return {
    name,
    complete,
    async *stream(req: LLMRequest): AsyncIterable<StreamChunk> {
      const toolCalls: ToolCall[] = [];
      let completed: any;
      let streamedText = '';
      for await (const event of parseResponseEvents(await request(req))) {
        const delta = textDeltaFromEvent(event);
        if (delta) {
          streamedText += delta;
          yield { type: 'text', text: delta };
        }
        if (event?.type === 'response.output_item.done') {
          const finalText = textDoneFromItem(event.item);
          if (finalText !== undefined && !streamedText) yield { type: 'text', text: finalText };
          const toolCall = extractToolCallFromItem(event.item, toolCalls.length);
          if (toolCall) {
            toolCalls.push(toolCall);
            yield { type: 'tool_call_start', toolCall };
          }
        }
        completed = completedResponseFromEvent(event) ?? completed;
      }
      yield {
        type: 'done',
        finishReason: toolCalls.length ? 'tool_calls' : completed?.status === 'incomplete' ? 'length' : completed?.status === 'failed' ? 'error' : 'stop',
        usage: extractUsage(completed),
      };
    },
  };
}
