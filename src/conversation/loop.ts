import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  Message,
  StreamChunk,
  ToolCall,
} from '../llm/types.js';
import { parseToolCalls, type ParsedToolCall } from '../llm/function-calling.js';
import { assemblePrompt } from '../prompt/assembler.js';
import type { Brain } from '../memory/brain.js';
import type { Conversation } from './conversation.js';
import { ToolRegistry, type ToolContext } from '../tools/registry.js';
import { executeToolCalls, type ToolResult, type ExecuteOptions } from '../tools/executor.js';
import type { ToolPolicy } from '../tools/policy.js';
import type { ApprovalCallback } from '../tools/approval.js';
import { TraceStore, type ToolCallEntry } from '../journal/trace.js';

export interface TurnResult {
  reply: string;
  toolCalls: ParsedToolCall[];
  toolResults: ToolResult[];
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface LoopOptions {
  conversation: Conversation;
  brain: Brain;
  provider: LLMProvider;
  model: string;
  registry?: ToolRegistry;
  toolContext?: ToolContext;
  toolPolicy?: ToolPolicy;
  onApproval?: ApprovalCallback;
  traceStore?: TraceStore;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
  onStream?: (chunk: StreamChunk) => void;
}

export async function runTurn(
  userMessage: string,
  options: LoopOptions,
): Promise<TurnResult> {
  const {
    conversation,
    brain,
    provider,
    model,
    registry,
    toolContext,
    toolPolicy,
    onApproval,
    traceStore,
    maxIterations = 10,
    temperature,
    maxTokens,
    onStream,
  } = options;

  const turnStart = performance.now();

  // Record the user message
  conversation.addMessage({ role: 'user', content: userMessage, timestamp: new Date().toISOString() });

  const tools = registry?.getDefinitions() ?? [];
  const allToolCalls: ParsedToolCall[] = [];
  const allToolResults: ToolResult[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  for (let i = 0; i < maxIterations; i++) {
    const history = conversation.getHistory();
    const assembled = assemblePrompt({ brain, history, tools: tools.length > 0 ? tools : undefined });

    const messages: Message[] = [];
    if (assembled.systemMessage) {
      messages.push({ role: 'system', content: assembled.systemMessage });
    }
    messages.push(...assembled.messages);

    const request: LLMRequest = {
      model,
      messages,
      tools: assembled.tools.length > 0 ? assembled.tools : undefined,
      temperature,
      max_tokens: maxTokens,
      stream: !!onStream,
    };

    const response = onStream
      ? await streamAndCollect(provider, request, onStream)
      : await provider.complete(request);

    totalPromptTokens += response.usage.promptTokens;
    totalCompletionTokens += response.usage.completionTokens;

    // Tool calls
    if (response.toolCalls.length > 0) {
      const parsed = parseToolCalls(response.toolCalls);
      allToolCalls.push(...parsed);

      // Record assistant message with tool calls
      conversation.addMessage({
        role: 'assistant',
        content: response.content ?? '',
        tool_calls: response.toolCalls,
      });

      // Execute tools for real if we have a registry
      if (registry && toolContext) {
        const execOptions: ExecuteOptions = {
          registry,
          context: toolContext,
          policy: toolPolicy,
          onApproval,
        };
        const results = await executeToolCalls(parsed, execOptions);
        allToolResults.push(...results);

        for (const result of results) {
          const content = result.error
            ? `Error: ${result.error}`
            : result.result;
          conversation.addMessage({
            role: 'tool',
            content,
            tool_call_id: result.toolCallId,
          });
        }
      } else {
        // No registry — stub results
        for (const tc of response.toolCalls) {
          conversation.addMessage({
            role: 'tool',
            content: `Tool "${tc.function.name}" is not available.`,
            tool_call_id: tc.id,
          });
        }
      }

      continue;
    }

    // Text response — done
    const reply = response.content ?? '';
    conversation.addMessage({ role: 'assistant', content: reply });

    const durationMs = performance.now() - turnStart;

    // Record journal trace
    if (traceStore) {
      traceStore.record({
        conversationId: conversation.id,
        turnIndex: conversation.getHistory().filter((m) => m.role === 'user').length,
        timestamp: new Date().toISOString(),
        input: { role: 'user', content: userMessage },
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        model,
        toolCalls: allToolResults.map((r): ToolCallEntry => ({
          name: r.name,
          args: allToolCalls.find((tc) => tc.id === r.toolCallId)?.args ?? {},
          result: r.result,
          durationMs: r.durationMs,
          error: r.error,
        })),
        reply,
        durationMs,
      });
    }

    return {
      reply,
      toolCalls: allToolCalls,
      toolResults: allToolResults,
      usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
    };
  }

  // Exhausted iterations
  const fallback = 'Reached maximum tool-call iterations without a final response.';
  conversation.addMessage({ role: 'assistant', content: fallback });

  return {
    reply: fallback,
    toolCalls: allToolCalls,
    toolResults: allToolResults,
    usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
  };
}

async function streamAndCollect(
  provider: LLMProvider,
  request: LLMRequest,
  onStream: (chunk: StreamChunk) => void,
): Promise<LLMResponse> {
  let content = '';
  const toolCalls: ToolCall[] = [];
  const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let finishReason: LLMResponse['finishReason'] = 'stop';

  for await (const chunk of provider.stream(request)) {
    onStream(chunk);

    switch (chunk.type) {
      case 'text':
        content += chunk.text ?? '';
        break;
      case 'tool_call_start':
        if (chunk.toolCall) {
          const index = toolCalls.length;
          toolCallBuffers.set(index, {
            id: chunk.toolCall.id ?? '',
            name: chunk.toolCall.function?.name ?? '',
            args: chunk.toolCall.function?.arguments ?? '',
          });
        }
        break;
      case 'tool_call_delta': {
        const lastIndex = toolCallBuffers.size - 1;
        const buf = toolCallBuffers.get(lastIndex);
        if (buf && chunk.toolCall?.function?.arguments) {
          buf.args += chunk.toolCall.function.arguments;
        }
        break;
      }
      case 'done':
        if (chunk.usage) usage = chunk.usage;
        if (chunk.finishReason) finishReason = chunk.finishReason as LLMResponse['finishReason'];
        break;
    }
  }

  for (const [, buf] of toolCallBuffers) {
    toolCalls.push({
      id: buf.id,
      type: 'function',
      function: { name: buf.name, arguments: buf.args },
    });
  }

  return {
    content: content || null,
    toolCalls,
    usage,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : finishReason,
    model: request.model,
  };
}
