import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface MemoryEntry {
  id: number;
  agent_name: string;
  key: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export class MemoryStore {
  private db: Database.Database;
  readonly vectorDimensions: number;

  constructor(dataDir: string, vectorDimensions = 768) {
    this.vectorDimensions = vectorDimensions;
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, 'memory.db'));
    this.db.pragma('journal_mode = WAL');
    sqliteVec.load(this.db);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_name TEXT NOT NULL,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        key, content, content=memories, content_rowid=id
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, key, content)
        VALUES (new.id, new.key, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, key, content)
        VALUES ('delete', old.id, old.key, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, key, content)
        VALUES ('delete', old.id, old.key, old.content);
        INSERT INTO memories_fts(rowid, key, content)
        VALUES (new.id, new.key, new.content);
      END;
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors USING vec0(
        memory_id INTEGER PRIMARY KEY,
        embedding float[${this.vectorDimensions}]
      );
    `);
  }

  write(agentName: string, key: string, content: string): void {
    // Upsert: if same agent+key exists, update it
    const existing = this.db.prepare(
      'SELECT id FROM memories WHERE agent_name = ? AND key = ?',
    ).get(agentName, key) as { id: number } | undefined;

    if (existing) {
      this.db.prepare(
        "UPDATE memories SET content = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(content, existing.id);
    } else {
      this.db.prepare(
        'INSERT INTO memories (agent_name, key, content) VALUES (?, ?, ?)',
      ).run(agentName, key, content);
    }
  }

  search(agentName: string, query: string, limit = 10): MemoryEntry[] {
    // FTS5 search with fallback to LIKE if FTS query fails
    try {
      return this.db.prepare(`
        SELECT m.* FROM memories m
        JOIN memories_fts f ON f.rowid = m.id
        WHERE m.agent_name = ? AND memories_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(agentName, query, limit) as MemoryEntry[];
    } catch {
      // Fallback to LIKE search if FTS query syntax is invalid
      return this.db.prepare(`
        SELECT * FROM memories
        WHERE agent_name = ? AND (key LIKE ? OR content LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(agentName, `%${query}%`, `%${query}%`, limit) as MemoryEntry[];
    }
  }

  getAll(agentName: string, limit = 50): MemoryEntry[] {
    return this.db.prepare(
      'SELECT * FROM memories WHERE agent_name = ? ORDER BY updated_at DESC LIMIT ?',
    ).all(agentName, limit) as MemoryEntry[];
  }

  delete(agentName: string, key: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM memories WHERE agent_name = ? AND key = ?',
    ).run(agentName, key);
    return result.changes > 0;
  }

  writeWithEmbedding(agentName: string, key: string, content: string, embedding: number[]): void {
    this.write(agentName, key, content);

    const row = this.db.prepare(
      'SELECT id FROM memories WHERE agent_name = ? AND key = ?',
    ).get(agentName, key) as { id: number };

    const embeddingBuf = Buffer.from(new Float32Array(embedding).buffer);

    // Upsert into vector table: delete existing then insert
    this.db.prepare('DELETE FROM memory_vectors WHERE memory_id = ?').run(row.id);
    this.db.prepare(
      'INSERT INTO memory_vectors (memory_id, embedding) VALUES (?, ?)',
    ).run(row.id, embeddingBuf);
  }

  semanticSearch(agentName: string, queryEmbedding: number[], limit = 10): MemoryEntry[] {
    const embeddingBuf = Buffer.from(new Float32Array(queryEmbedding).buffer);

    const rows = this.db.prepare(`
      SELECT m.* FROM memories m
      JOIN (
        SELECT memory_id, distance FROM memory_vectors
        WHERE embedding MATCH ? AND k = ?
        ORDER BY distance
      ) v ON v.memory_id = m.id
      WHERE m.agent_name = ?
    `).all(embeddingBuf, limit * 2, agentName) as MemoryEntry[];

    return rows.slice(0, limit);
  }

  hybridSearch(agentName: string, query: string, queryEmbedding: number[], limit = 10): MemoryEntry[] {
    const ftsResults = this.search(agentName, query, limit);
    const vecResults = this.semanticSearch(agentName, queryEmbedding, limit);

    // Merge and deduplicate by id, preserving order (FTS first, then vector)
    const seen = new Set<number>();
    const merged: MemoryEntry[] = [];

    for (const entry of [...ftsResults, ...vecResults]) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        merged.push(entry);
      }
    }

    return merged.slice(0, limit);
  }

  close(): void {
    this.db.close();
  }
}
