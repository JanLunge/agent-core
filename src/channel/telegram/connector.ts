import { Bot, type Context } from 'grammy';
import type { Router, IncomingMessage } from '../../router/router.js';
import type { StreamChunk } from '../../llm/types.js';
import type { ApprovalResult } from '../../tools/approval.js';
import { escapeMarkdownV2, splitMessage } from './format.js';

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

      const incoming: IncomingMessage = {
        channelType: 'telegram',
        chatId: String(ctx.chat.id),
        text,
        sender: ctx.from?.username ?? ctx.from?.first_name,
      };

      try {
        await this.handleMessage(ctx, incoming);
      } catch (err) {
        console.error('[telegram] Error handling message:', err);
        await ctx.reply('Sorry, something went wrong.').catch(() => {});
      }
    });
  }

  private stripBotMention(text: string): string {
    const username = this.bot.botInfo?.username;
    if (!username) return text;
    return text.replace(new RegExp(`@${username}\\b`, 'g'), '').trim();
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

    // TODO: Telegram approval flow with inline keyboards comes in Phase 3.
    // For now, auto-approve all tool calls from Telegram.
    const onApproval = async () => ({ action: 'approve' }) as ApprovalResult;

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
