export interface CommandContext {
  agentName: string;
  model: string;
  conversationId: string;
  status: string;
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
