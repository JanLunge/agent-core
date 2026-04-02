import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Message } from '../llm/types.js';

export class ConversationStore {
  private db: Database.Database;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, 'conversations.db'));
    this.db.pragma('journal_mode = WAL');
    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        agent_name TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL DEFAULT 'active',
        focus TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        name TEXT,
        tool_call_id TEXT,
        tool_calls TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  createConversation(id: string, agentName: string, channelId: string): void {
    this.db.prepare(
      `INSERT INTO conversations (id, agent_name, channel_id) VALUES (?, ?, ?)`,
    ).run(id, agentName, channelId);
  }

  getConversation(id: string): ConversationRow | undefined {
    return this.db.prepare(
      `SELECT * FROM conversations WHERE id = ?`,
    ).get(id) as ConversationRow | undefined;
  }

  findActiveConversation(agentName: string, channelId: string): ConversationRow | undefined {
    return this.db.prepare(
      `SELECT * FROM conversations WHERE agent_name = ? AND channel_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1`,
    ).get(agentName, channelId) as ConversationRow | undefined;
  }

  updateStatus(id: string, status: string): void {
    this.db.prepare(
      `UPDATE conversations SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(status, id);
  }

  updateFocus(id: string, focus: string): void {
    this.db.prepare(
      `UPDATE conversations SET focus = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(focus, id);
  }

  appendMessage(conversationId: string, message: Message): void {
    const toolCalls = message.tool_calls
      ? JSON.stringify(message.tool_calls)
      : null;

    this.db.prepare(
      `INSERT INTO messages (conversation_id, role, content, name, tool_call_id, tool_calls)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      conversationId,
      message.role,
      message.content,
      message.name ?? null,
      message.tool_call_id ?? null,
      toolCalls,
    );

    this.db.prepare(
      `UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`,
    ).run(conversationId);
  }

  getMessages(conversationId: string, limit?: number): Message[] {
    const sql = limit
      ? `SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC`
      : `SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC`;

    const params = limit ? [conversationId, limit] : [conversationId];
    const rows = this.db.prepare(sql).all(...params) as MessageRow[];

    return rows.map(rowToMessage);
  }

  listConversations(limit = 50): ConversationRow[] {
    return this.db.prepare(
      'SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?',
    ).all(limit) as ConversationRow[];
  }

  countMessages(conversationId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?',
    ).get(conversationId) as { count: number };
    return row.count;
  }

  getLastMessage(conversationId: string): { role: string; content: string; created_at: string } | undefined {
    return this.db.prepare(
      'SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1',
    ).get(conversationId) as { role: string; content: string; created_at: string } | undefined;
  }

  close(): void {
    this.db.close();
  }
}

export interface ConversationRow {
  id: string;
  agent_name: string;
  channel_id: string;
  created_at: string;
  updated_at: string;
  status: string;
  focus: string | null;
}

interface MessageRow {
  id: number;
  conversation_id: string;
  role: string;
  content: string;
  name: string | null;
  tool_call_id: string | null;
  tool_calls: string | null;
  created_at: string;
}

function rowToMessage(row: MessageRow): Message {
  const message: Message = {
    role: row.role as Message['role'],
    content: row.content,
  };
  if (row.name) message.name = row.name;
  if (row.tool_call_id) message.tool_call_id = row.tool_call_id;
  if (row.tool_calls) message.tool_calls = JSON.parse(row.tool_calls);
  if (row.created_at) message.timestamp = row.created_at;
  return message;
}
