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

function toResponsesInput(messages: Message[]): unknown[] {
  const input: unknown[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: message.content,
      });
      continue;
    }
    if (message.role === 'assistant' && message.tool_calls?.length) {
      for (const toolCall of message.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        });
      }
      if (!message.content) continue;
    }
    input.push({
      role: message.role,
      content: message.content,
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

function buildResponsesPayload(req: LLMRequest, stream = false): Record<string, unknown> {
  return {
    model: req.model,
    instructions: toResponsesInstructions(req.messages) || 'You are an assistant running inside agent-core. Answer clearly and use provided tools by returning function calls when needed; agent-core will execute tools after policy checks and approvals.',
    input: toResponsesInput(req.messages),
    tools: toResponsesTools(req.tools),
    temperature: req.temperature,
    max_output_tokens: req.max_tokens,
    stream,
  };
}

function extractText(response: any): string | null {
  if (typeof response.output_text === 'string') return response.output_text;
  const texts: string[] = [];
  for (const item of response.output ?? []) {
    if (item?.type === 'message') {
      for (const content of item.content ?? []) {
        if (content?.type === 'output_text' && typeof content.text === 'string') texts.push(content.text);
        if (content?.type === 'text' && typeof content.text === 'string') texts.push(content.text);
      }
    }
  }
  return texts.length ? texts.join('\n') : null;
}

function extractToolCalls(response: any): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const item of response.output ?? []) {
    if (item?.type !== 'function_call') continue;
    calls.push({
      id: String(item.call_id ?? item.id ?? `call_${calls.length}`),
      type: 'function',
      function: {
        name: String(item.name ?? ''),
        arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
      },
    });
  }
  return calls;
}

function extractUsage(response: any): Usage {
  const usage = response.usage ?? {};
  const promptTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const completionTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage.total_tokens ?? promptTokens + completionTokens,
  };
}

function mapFinishReason(response: any, toolCalls: ToolCall[]): LLMResponse['finishReason'] {
  if (toolCalls.length) return 'tool_calls';
  if (response.status === 'incomplete') return 'length';
  if (response.status === 'failed') return 'error';
  return 'stop';
}

async function readErrorBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.slice(0, 500);
}

/**
 * API-style provider for the ChatGPT/Codex subscription route.
 *
 * This must use the Responses transport (`/responses`), not Chat Completions.
 * Codex CLI remains a separate harness boundary; agent-core owns tools,
 * approvals, and execution for this provider.
 */
export function createOpenAICodexProvider(
  name: string,
  options: OpenAICodexProviderOptions = {},
): LLMProvider {
  const fetchImpl = options.fetch ?? fetch;
  const baseURL = (options.baseURL ?? OPENAI_CODEX_BASE_URL).replace(/\/$/, '');

  async function complete(req: LLMRequest): Promise<LLMResponse> {
    if (!options.accessToken) throw new Error('openai-codex provider needs an access token');
    const response = await fetchImpl(`${baseURL}/responses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${options.accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(buildResponsesPayload(req, false)),
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw new Error(`openai-codex responses request failed: HTTP ${response.status}${body ? ` ${body}` : ''}`);
    }

    const json = await response.json() as any;
    const toolCalls = extractToolCalls(json);
    return {
      content: extractText(json),
      toolCalls,
      usage: extractUsage(json),
      finishReason: mapFinishReason(json, toolCalls),
      model: json.model ?? req.model,
    };
  }

  return {
    name,
    complete,
    async *stream(req: LLMRequest): AsyncIterable<StreamChunk> {
      const response = await complete(req);
      if (response.content) yield { type: 'text', text: response.content };
      for (const toolCall of response.toolCalls) {
        yield { type: 'tool_call_start', toolCall };
      }
      yield { type: 'done', finishReason: response.finishReason, usage: response.usage };
    },
  };
}
