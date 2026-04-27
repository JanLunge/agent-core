import type { BlockRef, HeapName, HeaperBlock, HeaperMemory } from '../heaper/types.js';
import type { Message } from '../llm/types.js';

export interface HeaperSessionData extends Record<string, unknown> {
  sessionId: string;
  agentName: string;
  channelId: string;
  status: 'active' | 'paused' | 'ended';
}

export interface HeaperSessionMessageData extends Record<string, unknown> {
  sessionId: string;
  role: Message['role'];
  content: string;
  timestamp?: string;
  name?: string;
  toolCallId?: string;
}

export interface HeaperSessionSummaryData extends Record<string, unknown> {
  sessionId: string;
  messageCount: number;
  summary: string;
  lastMessagePreview?: string;
}

export interface HeaperSessionStoreOptions {
  memory: HeaperMemory;
  sessionHeap: HeapName;
}

export class HeaperSessionStore {
  constructor(private readonly options: HeaperSessionStoreOptions) {}

  async createOrResume(input: { sessionId: string; agentName: string; channelId: string }): Promise<HeaperBlock<HeaperSessionData>> {
    const existing = await this.getSession(input.sessionId);
    if (existing) return existing;

    return (await this.options.memory.createBlock({
      heap: this.options.sessionHeap,
      type: 'session',
      data: {
        sessionId: input.sessionId,
        agentName: input.agentName,
        channelId: input.channelId,
        status: 'active',
      },
      tags: ['session', `session:${input.sessionId}`, `agent:${input.agentName}`, `channel:${input.channelId}`],
    })) as HeaperBlock<HeaperSessionData>;
  }

  async getSession(sessionId: string): Promise<HeaperBlock<HeaperSessionData> | undefined> {
    const hits = await this.options.memory.search(`\"${sessionId}\"`, {
      heaps: [this.options.sessionHeap],
      types: ['session'],
      tags: [`session:${sessionId}`],
      limit: 1,
    });
    return hits[0] as HeaperBlock<HeaperSessionData> | undefined;
  }

  async appendMessage(sessionId: string, message: Message): Promise<HeaperBlock<HeaperSessionMessageData>> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    return (await this.options.memory.createBlock({
      heap: this.options.sessionHeap,
      type: 'text',
      data: {
        sessionId,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        name: message.name,
        toolCallId: message.tool_call_id,
      },
      tags: ['session-message', `session:${sessionId}`, `role:${message.role}`],
      links: [refFor(session)],
    })) as HeaperBlock<HeaperSessionMessageData>;
  }

  async getRecentMessages(sessionId: string, limit = 12): Promise<Message[]> {
    const blocks = await this.messageBlocks(sessionId);
    return blocks.slice(-limit).map((block) => ({
      role: block.data.role,
      content: block.data.content,
      timestamp: block.data.timestamp,
      name: block.data.name,
      tool_call_id: block.data.toolCallId,
    }));
  }

  async summarize(sessionId: string, summary?: string): Promise<HeaperBlock<HeaperSessionSummaryData>> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const messages = await this.messageBlocks(sessionId);
    const lastMessage = messages.at(-1);
    const finalSummary = summary ?? defaultSummary(session.data.agentName, messages);

    return (await this.options.memory.createBlock({
      heap: this.options.sessionHeap,
      type: 'session',
      data: {
        sessionId,
        messageCount: messages.length,
        summary: finalSummary,
        lastMessagePreview: lastMessage ? preview(lastMessage.data.content) : undefined,
      },
      tags: ['session-summary', `session:${sessionId}`, `agent:${session.data.agentName}`],
      links: [refFor(session), ...messages.map(refFor)],
      metadata: { source: 'heaper-session-store' },
    })) as HeaperBlock<HeaperSessionSummaryData>;
  }

  async searchSessions(query: string, limit = 10): Promise<HeaperBlock[]> {
    return this.options.memory.search(query, {
      heaps: [this.options.sessionHeap],
      tags: ['session'],
      types: ['session'],
      limit,
    });
  }

  private async messageBlocks(sessionId: string): Promise<Array<HeaperBlock<HeaperSessionMessageData>>> {
    const blocks = await this.options.memory.search('', {
      heaps: [this.options.sessionHeap],
      types: ['text'],
      tags: [`session:${sessionId}`, 'session-message'],
    });
    return (blocks as Array<HeaperBlock<HeaperSessionMessageData>>).sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  }
}

function defaultSummary(agentName: string, messages: Array<HeaperBlock<HeaperSessionMessageData>>): string {
  const last = messages.at(-1);
  if (!last) return `${agentName} session with no messages yet.`;
  return `${agentName} session with ${messages.length} messages; last ${last.data.role}: ${preview(last.data.content)}`;
}

function preview(content: string, maxLength = 160): string {
  const singleLine = content.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 1)}…`;
}

function refFor(block: HeaperBlock): BlockRef {
  return { heap: block.heap, id: block.id };
}
