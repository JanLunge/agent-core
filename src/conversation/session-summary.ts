import type { HeapName, HeaperBlock, HeaperMemory } from '../heaper/types.js';
import type { ConversationRow, MessageWithMeta } from './persistence.js';

export interface ConversationSummarySource {
  getConversation(id: string): ConversationRow | undefined;
  getMessagesWithMeta(conversationId: string): MessageWithMeta[];
}

export interface SessionSummaryInput {
  memory: HeaperMemory;
  heap: HeapName;
  dailyHeap?: HeapName;
  conversation: ConversationRow;
  messages: MessageWithMeta[];
  date?: string;
  summary?: string;
}

export interface StoredSessionSummaryInput {
  source: ConversationSummarySource;
  memory: HeaperMemory;
  conversationId: string;
  heap: HeapName;
  dailyHeap?: HeapName;
  date?: string;
  summary?: string;
}

export interface SessionSummaryResult {
  dailyEntry: HeaperBlock;
  summaryBlock: HeaperBlock<SessionSummaryData>;
}

export interface SessionSummaryData extends Record<string, unknown> {
  conversationId: string;
  agentName: string;
  channelId: string;
  status: string;
  focus?: string;
  messageCount: number;
  firstMessageAt?: string;
  lastMessageAt?: string;
  lastMessageRole?: string;
  lastMessagePreview?: string;
  summary: string;
}

/**
 * Writes a session summary as a Heaper-shaped block and links it to a daily entry.
 *
 * This is the first bridge from existing conversation persistence toward the
 * future memory layer: SQLite remains the message source, while durable session
 * summaries become heap-scoped blocks that can be retrieved through links.
 */
export async function createSessionSummaryBlock(input: SessionSummaryInput): Promise<SessionSummaryResult> {
  const dailyHeap = input.dailyHeap ?? input.heap;
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const summary = input.summary ?? defaultSummary(input.conversation, input.messages);

  const dailyEntry = await input.memory.appendToDailyEntry(
    `Session ${input.conversation.id}: ${summary}`,
    dailyHeap,
    date,
  );

  const summaryBlock = (await input.memory.createBlock({
    heap: input.heap,
    type: 'session',
    data: buildSessionSummaryData(input.conversation, input.messages, summary),
    tags: [
      'session-summary',
      `conversation:${input.conversation.id}`,
      `agent:${input.conversation.agent_name}`,
      `channel:${input.conversation.channel_id}`,
    ],
    links: [{ heap: dailyEntry.heap, id: dailyEntry.id }],
    metadata: { source: 'conversation-store', dailyEntryDate: date },
  })) as HeaperBlock<SessionSummaryData>;

  await input.memory.linkBlocks(summaryBlock, dailyEntry);

  return { dailyEntry, summaryBlock };
}

export async function summarizeStoredConversationToMemory(
  input: StoredSessionSummaryInput,
): Promise<SessionSummaryResult> {
  const conversation = input.source.getConversation(input.conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${input.conversationId}`);
  }

  return createSessionSummaryBlock({
    memory: input.memory,
    heap: input.heap,
    dailyHeap: input.dailyHeap,
    conversation,
    messages: input.source.getMessagesWithMeta(input.conversationId),
    date: input.date,
    summary: input.summary,
  });
}

function buildSessionSummaryData(
  conversation: ConversationRow,
  messages: MessageWithMeta[],
  summary: string,
): SessionSummaryData {
  const firstMessage = messages[0];
  const lastMessage = messages.at(-1);

  return {
    conversationId: conversation.id,
    agentName: conversation.agent_name,
    channelId: conversation.channel_id,
    status: conversation.status,
    focus: conversation.focus ?? undefined,
    messageCount: messages.length,
    firstMessageAt: firstMessage?.timestamp,
    lastMessageAt: lastMessage?.timestamp,
    lastMessageRole: lastMessage?.role,
    lastMessagePreview: lastMessage ? preview(lastMessage.content) : undefined,
    summary,
  };
}

function defaultSummary(conversation: ConversationRow, messages: MessageWithMeta[]): string {
  const lastMessage = messages.at(-1);
  if (!lastMessage) return `${conversation.agent_name} conversation with no recorded messages yet.`;
  return `${conversation.agent_name} conversation with ${messages.length} messages; last ${lastMessage.role}: ${preview(
    lastMessage.content,
  )}`;
}

function preview(content: string, maxLength = 160): string {
  const singleLine = content.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 1)}…`;
}
