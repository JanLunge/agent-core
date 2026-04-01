import type { TraceStore, ToolCallEntry } from '../journal/trace.js';

export interface CommandContext {
  agentName: string;
  model: string;
  conversationId: string;
  status: string;
  traceStore?: TraceStore;
}

export interface CommandResult {
  text: string;
}

const BUILTINS: Record<string, (args: string, ctx: CommandContext) => CommandResult> = {
  help: () => ({
    text: [
      'Available commands:',
      '  /help       — show this list',
      '  /status     — show agent name, model, conversation ID, status',
      '  /model      — show current model',
      '  /reset      — reset the conversation',
      '  /history    — show message count for this conversation',
      '  /debug      — show last turn trace (tokens, tools, duration)',
    ].join('\n'),
  }),

  status: (_args, ctx) => ({
    text: [
      `Agent:          ${ctx.agentName}`,
      `Model:          ${ctx.model}`,
      `Conversation:   ${ctx.conversationId}`,
      `Status:         ${ctx.status}`,
    ].join('\n'),
  }),

  model: (args, ctx) => {
    if (args) {
      return {
        text: `Current model: ${ctx.model}\nTo switch models, use the --model flag or update your agent config.`,
      };
    }
    return { text: `Current model: ${ctx.model}` };
  },

  reset: () => ({
    text: 'To reset, use /quit and start a new session. (Conversation wipe coming soon.)',
  }),

  history: (_args, ctx) => ({
    text: `Conversation ${ctx.conversationId} — use getHistory() for message details.`,
  }),

  debug: (_args, ctx) => {
    if (!ctx.traceStore) {
      return { text: 'Trace store not available.' };
    }

    const traces = ctx.traceStore.getTraces(ctx.conversationId, 1);
    if (traces.length === 0) {
      return { text: 'No traces recorded yet.' };
    }

    const t = traces[0];
    const toolLines = t.toolCalls.length === 0
      ? '  (none)'
      : t.toolCalls.map((tc: ToolCallEntry) => {
          const status = tc.error ? `error: ${tc.error}` : 'ok';
          return `  - ${tc.name} (${tc.durationMs}ms, ${status})`;
        }).join('\n');

    const replyPreview = t.reply.length > 200
      ? t.reply.slice(0, 200) + '...'
      : t.reply;

    return {
      text: [
        `--- Last Turn (turn ${t.turnIndex}) ---`,
        `Input:        ${t.input.role}: ${t.input.content}`,
        `Model:        ${t.model}`,
        `Tokens:       ${t.promptTokens} prompt / ${t.completionTokens} completion`,
        `Tool calls (${t.toolCalls.length}):`,
        toolLines,
        `Reply:        ${replyPreview}`,
        `Duration:     ${t.durationMs}ms`,
      ].join('\n'),
    };
  },
};

/**
 * Handles a built-in slash command.
 * Returns null if the command name is not a known builtin (pass through to LLM).
 */
export function handleBuiltin(
  name: string,
  args: string,
  context: CommandContext,
): CommandResult | null {
  const handler = BUILTINS[name];
  if (!handler) return null;
  return handler(args, context);
}
