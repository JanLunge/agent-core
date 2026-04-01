import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ToolCallEntry {
  name: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
  error?: string;
}

export interface TraceEntry {
  id: number;
  conversationId: string;
  turnIndex: number;
  timestamp: string;
  input: { role: string; content: string };
  promptTokens: number;
  completionTokens: number;
  model: string;
  toolCalls: ToolCallEntry[];
  reply: string;
  durationMs: number;
}

export class TraceStore {
  private db: Database.Database;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, 'journal.db'));
    this.db.pragma('journal_mode = WAL');
    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS traces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        input TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        model TEXT NOT NULL,
        tool_calls TEXT NOT NULL,
        reply TEXT NOT NULL,
        duration_ms INTEGER NOT NULL
      );
    `);
  }

  record(entry: Omit<TraceEntry, 'id'>): void {
    this.db.prepare(
      `INSERT INTO traces (
        conversation_id, turn_index, timestamp, input,
        prompt_tokens, completion_tokens, model,
        tool_calls, reply, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.conversationId,
      entry.turnIndex,
      entry.timestamp,
      JSON.stringify(entry.input),
      entry.promptTokens,
      entry.completionTokens,
      entry.model,
      JSON.stringify(entry.toolCalls),
      entry.reply,
      entry.durationMs,
    );
  }

  getTraces(conversationId: string, limit?: number): TraceEntry[] {
    const sql = limit
      ? `SELECT * FROM traces WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`
      : `SELECT * FROM traces WHERE conversation_id = ? ORDER BY id ASC`;

    const params = limit ? [conversationId, limit] : [conversationId];
    const rows = this.db.prepare(sql).all(...params) as TraceRow[];

    return rows.map(rowToTrace);
  }

  getDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

export interface TraceRow {
  id: number;
  conversation_id: string;
  turn_index: number;
  timestamp: string;
  input: string;
  prompt_tokens: number;
  completion_tokens: number;
  model: string;
  tool_calls: string;
  reply: string;
  duration_ms: number;
}

export function rowToTrace(row: TraceRow): TraceEntry {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    turnIndex: row.turn_index,
    timestamp: row.timestamp,
    input: JSON.parse(row.input),
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    model: row.model,
    toolCalls: JSON.parse(row.tool_calls),
    reply: row.reply,
    durationMs: row.duration_ms,
  };
}
