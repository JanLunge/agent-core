import { Bot, InlineKeyboard, type Context } from 'grammy';
import type { Router, IncomingMessage } from '../../router/router.js';
import type { StreamChunk } from '../../llm/types.js';
import type { ApprovalRequest, ApprovalResult } from '../../tools/approval.js';
import { escapeMarkdownV2, splitMessage } from './format.js';
import { parseDirectOperationIntent } from './direct-intents.js';
import {
  executeApprovedOperation,
  humanOperationKind,
  OperationApprovalBroker,
  renderOperationApproval,
  type OperationIntent,
} from '../../operations/approval.js';

export interface TelegramConnectorOptions {
  token: string;
  router: Router;
  /** Whitelist of Telegram user IDs. If set, messages from other users are ignored. */
  allowedUsers?: number[];
  /** Whitelist of Telegram group chat IDs. If set, messages from other groups are ignored. */
  allowedGroups?: number[];
}

export class TelegramConnector {
  private bot: Bot;
  private router: Router;
  private allowedUsers: Set<number> | undefined;
  private allowedGroups: Set<number> | undefined;
  private operationApprovals = new OperationApprovalBroker();
  private pendingToolApprovalResolvers = new Map<string, (result: ApprovalResult) => void>();

  constructor(options: TelegramConnectorOptions) {
    this.bot = new Bot(options.token);
    this.router = options.router;
    this.allowedUsers = options.allowedUsers
      ? new Set(options.allowedUsers)
      : undefined;
    this.allowedGroups = options.allowedGroups
      ? new Set(options.allowedGroups)
      : undefined;

    this.setupHandlers();
    this.setupApprovalHandlers();
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  private isAuthorised(ctx: Context): boolean {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    if (chatId === undefined || userId === undefined) return false;

    const isGroup =
      ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';

    if (isGroup) {
      // In groups, check the group whitelist
      if (this.allowedGroups && !this.allowedGroups.has(chatId)) return false;
    } else {
      // In private chats, check the user whitelist
      if (this.allowedUsers && !this.allowedUsers.has(userId)) return false;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Group mention detection
  // ---------------------------------------------------------------------------

  private isAddressedToBot(ctx: Context): boolean {
    const chatType = ctx.chat?.type;
    if (chatType !== 'group' && chatType !== 'supergroup') {
      // Private chat — always addressed to the bot
      return true;
    }

    // Direct reply to the bot
    if (ctx.message?.reply_to_message?.from?.id === this.bot.botInfo.id) {
      return true;
    }

    // Mentioned by @username
    const botUsername = this.bot.botInfo.username;
    if (botUsername && ctx.message?.text?.includes(`@${botUsername}`)) {
      return true;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  private setupHandlers(): void {
    this.bot.on('message:text', async (ctx) => {
      if (!this.isAuthorised(ctx)) return;
      if (!this.isAddressedToBot(ctx)) return;

      const text = this.stripBotMention(ctx.message.text);
      if (!text.trim()) return;

      try {
        const operation = parseDirectOperationIntent(text);
        if (operation) {
          await this.requestOperationApproval(ctx, operation);
          return;
        }

        const incoming: IncomingMessage = {
          channelType: 'telegram',
          chatId: String(ctx.chat.id),
          text,
          sender: ctx.from?.username ?? ctx.from?.first_name,
        };

        await this.handleMessage(ctx, incoming);
      } catch (err) {
        console.error('[telegram] Error handling message:', err);
        await ctx.reply('Sorry, something went wrong.').catch(() => {});
      }
    });
  }

  private setupApprovalHandlers(): void {
    this.bot.callbackQuery(/^operation:(approve|deny):(.+)$/, async (ctx) => {
      if (!this.isAuthorised(ctx)) return;
      const action = ctx.match[1];
      const id = ctx.match[2];
      const operation = this.operationApprovals.take(id);
      if (!operation) {
        await ctx.answerCallbackQuery({ text: 'Approval request expired or already handled.' }).catch(() => {});
        return;
      }

      const resolveToolApproval = this.pendingToolApprovalResolvers.get(id);
      this.pendingToolApprovalResolvers.delete(id);

      if (action === 'deny') {
        resolveToolApproval?.({ action: 'deny', reason: 'User denied this operation.' });
        await ctx.answerCallbackQuery({ text: 'Denied.' }).catch(() => {});
        await ctx.editMessageText(`Denied: ${operation.description}\n${operation.target}`).catch(() => {});
        return;
      }

      await ctx.answerCallbackQuery({ text: 'Approved.' }).catch(() => {});
      if (resolveToolApproval) {
        resolveToolApproval({ action: 'approve' });
        await ctx.editMessageText(`Approved:\n${operation.description}\n${operation.target}`).catch(() => {});
        return;
      }

      try {
        const result = await executeApprovedOperation(operation);
        await ctx.editMessageText(result.message).catch(async () => {
          await ctx.reply(result.message);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.editMessageText(`Approved, but operation failed:\n${message}`).catch(async () => {
          await ctx.reply(`Approved, but operation failed:\n${message}`);
        });
      }
    });
  }

  private stripBotMention(text: string): string {
    const username = this.bot.botInfo?.username;
    if (!username) return text;
    return text.replace(new RegExp(`@${username}\\b`, 'g'), '').trim();
  }

  private async requestOperationApproval(ctx: Context, operation: OperationIntent): Promise<void> {
    const pending = this.operationApprovals.request(operation);
    const keyboard = new InlineKeyboard()
      .text('Approve', `operation:approve:${pending.id}`)
      .text('Deny', `operation:deny:${pending.id}`);

    await ctx.reply([
      renderOperationApproval(pending.operation),
      '',
      `Type: ${humanOperationKind(pending.operation.kind)}`,
      `Risk: ${pending.operation.risk}`,
    ].join('\n'), { reply_markup: keyboard });
  }

  private async requestToolCallApproval(ctx: Context, request: ApprovalRequest): Promise<ApprovalResult> {
    const pending = this.operationApprovals.request({
      kind: 'tool.call',
      target: request.toolName,
      risk: 'medium',
      args: { toolName: request.toolName, toolArgs: request.args },
      description: `Run tool ${request.toolName}`,
    });
    const keyboard = new InlineKeyboard()
      .text('Approve', `operation:approve:${pending.id}`)
      .text('Deny', `operation:deny:${pending.id}`);

    const approvalPromise = new Promise<ApprovalResult>((resolve) => {
      this.pendingToolApprovalResolvers.set(pending.id, resolve);
    });

    await ctx.reply([
      renderOperationApproval(pending.operation),
      '',
      `Type: ${humanOperationKind(pending.operation.kind)}`,
      `Risk: ${pending.operation.risk}`,
      '',
      'Arguments:',
      formatApprovalArgs(request.args),
    ].join('\n'), { reply_markup: keyboard });

    return withApprovalTimeout(approvalPromise, 10 * 60 * 1000, () => {
      this.operationApprovals.take(pending.id);
      this.pendingToolApprovalResolvers.delete(pending.id);
    });
  }

  // ---------------------------------------------------------------------------
  // Message handling with streaming edits
  // ---------------------------------------------------------------------------

  private async handleMessage(
    ctx: Context,
    message: IncomingMessage,
  ): Promise<void> {
    // Send a placeholder while the LLM processes
    const placeholder = await ctx.reply('…');

    let accumulated = '';
    let lastEditedText = '';
    let editTimer: ReturnType<typeof setInterval> | undefined;
    let typingTimer: ReturnType<typeof setInterval> | undefined;

    const chatId = ctx.chat?.id;
    const sendTyping = async () => {
      if (chatId === undefined) return;
      await ctx.api.sendChatAction(chatId, 'typing').catch(() => {});
    };

    const flushEdit = async () => {
      const snapshot = accumulated;
      if (snapshot && snapshot !== lastEditedText) {
        try {
          await ctx.api.editMessageText(
            placeholder.chat.id,
            placeholder.message_id,
            escapeMarkdownV2(snapshot),
            { parse_mode: 'MarkdownV2' },
          );
          lastEditedText = snapshot;
        } catch {
          // Edit may fail if content is unchanged or too fast — ignore
        }
      }
    };

    const onStream = (chunk: StreamChunk) => {
      if (chunk.type === 'text' && chunk.text) {
        accumulated += chunk.text;
      }
    };

    // Start timers to periodically edit streamed text and keep Telegram's
    // native "typing…" indicator alive while the agent is working.
    await sendTyping();
    typingTimer = setInterval(() => { void sendTyping(); }, 4_000);
    editTimer = setInterval(flushEdit, 500);

    const onApproval = (request: ApprovalRequest): Promise<ApprovalResult> => this.requestToolCallApproval(ctx, request);

    try {
      const result = await this.router.route(message, onStream, onApproval);

      // Stop progress indicators before sending the final response.
      clearInterval(editTimer);
      editTimer = undefined;
      if (typingTimer) {
        clearInterval(typingTimer);
        typingTimer = undefined;
      }

      const finalText = result.reply || '(no response)';

      // Replace the placeholder with the final response
      const chunks = splitMessage(finalText);

      // Edit the placeholder with the first chunk
      try {
        await ctx.api.editMessageText(
          placeholder.chat.id,
          placeholder.message_id,
          escapeMarkdownV2(chunks[0]!),
          { parse_mode: 'MarkdownV2' },
        );
      } catch {
        // If edit fails (e.g. identical content), try plain text
        await ctx.api
          .editMessageText(
            placeholder.chat.id,
            placeholder.message_id,
            chunks[0]!,
          )
          .catch(() => {});
      }

      // Send remaining chunks as new messages
      for (let i = 1; i < chunks.length; i++) {
        await ctx.reply(escapeMarkdownV2(chunks[i]!), {
          parse_mode: 'MarkdownV2',
        });
      }
    } finally {
      if (editTimer) clearInterval(editTimer);
      if (typingTimer) clearInterval(typingTimer);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    console.log('[telegram] Starting bot…');
    // bot.start() calls getMe() internally, which populates botInfo
    this.bot.start({
      onStart: (info) => {
        console.log(`[telegram] Bot @${info.username} is running`);
      },
    });
  }

  stop(): void {
    console.log('[telegram] Stopping bot…');
    this.bot.stop();
  }
}

function formatApprovalArgs(args: Record<string, unknown>): string {
  const json = JSON.stringify(args, null, 2) ?? '{}';
  return json.length > 1_500 ? `${json.slice(0, 1_500)}\n…[truncated]` : json;
}

async function withApprovalTimeout(
  promise: Promise<ApprovalResult>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<ApprovalResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<ApprovalResult>((resolve) => {
        timer = setTimeout(() => {
          onTimeout();
          resolve({ action: 'deny', reason: 'Approval request timed out.' });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
