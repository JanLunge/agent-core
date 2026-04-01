import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionChunk,
} from 'openai/resources/chat/completions';
import type {
  Message,
  ToolCall,
  ToolDefinition,
  LLMRequest,
  LLMResponse,
  StreamChunk,
  Usage,
  LLMProvider,
} from './types.js';

// --- Internal converters ---

function toOpenAIMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return messages.map((m): ChatCompletionMessageParam => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        tool_call_id: m.tool_call_id!,
      };
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      };
    }
    if (m.role === 'system') {
      return { role: 'system', content: m.content };
    }
    if (m.role === 'user') {
      return { role: 'user', content: m.content };
    }
    // assistant without tool_calls
    return { role: 'assistant', content: m.content };
  });
}

function toOpenAITools(tools: ToolDefinition[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function extractToolCalls(
  choices: OpenAI.Chat.Completions.ChatCompletion.Choice[],
): ToolCall[] {
  const choice = choices[0];
  if (!choice?.message.tool_calls) return [];
  return choice.message.tool_calls.map((tc) => ({
    id: tc.id,
    type: 'function' as const,
    function: {
      name: tc.function.name,
      arguments: tc.function.arguments,
    },
  }));
}

function mapFinishReason(reason: string | null): LLMResponse['finishReason'] {
  switch (reason) {
    case 'stop': return 'stop';
    case 'tool_calls': return 'tool_calls';
    case 'length': return 'length';
    default: return 'stop';
  }
}

function extractUsage(usage: OpenAI.Completions.CompletionUsage | undefined): Usage {
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

// --- Provider implementation ---

export function createOpenAIProvider(
  name: string,
  opts: { apiKey?: string; baseURL?: string },
): LLMProvider {
  const client = new OpenAI({
    apiKey: opts.apiKey ?? 'not-set',
    baseURL: opts.baseURL,
  });

  return {
    name,

    async complete(req: LLMRequest): Promise<LLMResponse> {
      const response = await client.chat.completions.create({
        model: req.model,
        messages: toOpenAIMessages(req.messages),
        tools: req.tools?.length ? toOpenAITools(req.tools) : undefined,
        temperature: req.temperature,
        max_tokens: req.max_tokens,
      });

      const choice = response.choices[0];
      return {
        content: choice?.message.content ?? null,
        toolCalls: extractToolCalls(response.choices),
        usage: extractUsage(response.usage),
        finishReason: mapFinishReason(choice?.finish_reason ?? null),
        model: response.model,
      };
    },

    async *stream(req: LLMRequest): AsyncIterable<StreamChunk> {
      const stream = await client.chat.completions.create({
        model: req.model,
        messages: toOpenAIMessages(req.messages),
        tools: req.tools?.length ? toOpenAITools(req.tools) : undefined,
        temperature: req.temperature,
        max_tokens: req.max_tokens,
        stream: true,
      });

      // Buffer tool calls across deltas
      const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        const delta = (chunk as ChatCompletionChunk).choices[0]?.delta;
        const finishReason = (chunk as ChatCompletionChunk).choices[0]?.finish_reason;

        // Text content
        if (delta?.content) {
          yield { type: 'text', text: delta.content };
        }

        // Tool call deltas
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallBuffers.has(idx)) {
              // New tool call
              toolCallBuffers.set(idx, {
                id: tc.id ?? '',
                name: tc.function?.name ?? '',
                args: tc.function?.arguments ?? '',
              });
              yield {
                type: 'tool_call_start',
                toolCall: {
                  id: tc.id ?? '',
                  type: 'function',
                  function: { name: tc.function?.name ?? '', arguments: '' },
                },
              };
            } else {
              // Append to existing
              const buf = toolCallBuffers.get(idx)!;
              if (tc.function?.arguments) {
                buf.args += tc.function.arguments;
              }
              yield {
                type: 'tool_call_delta',
                toolCall: {
                  id: buf.id,
                  type: 'function',
                  function: { name: buf.name, arguments: tc.function?.arguments ?? '' },
                },
              };
            }
          }
        }

        // Done
        if (finishReason) {
          const usage = (chunk as ChatCompletionChunk).usage;
          yield {
            type: 'done',
            finishReason,
            usage: usage
              ? {
                  promptTokens: usage.prompt_tokens ?? 0,
                  completionTokens: usage.completion_tokens ?? 0,
                  totalTokens: usage.total_tokens ?? 0,
                }
              : undefined,
          };
        }
      }
    },
  };
}
