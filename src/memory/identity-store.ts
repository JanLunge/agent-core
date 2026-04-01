import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface IdentityRevision {
  id: number;
  section: string;
  content: string;
  author: 'agent' | 'user' | 'system';
  reason: string;
  created_at: string;
}

export class IdentityStore {
  private db: Database.Database;
  private baseDir: string;

  constructor(dataDir: string, baseDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, 'identity.db'));
    this.db.pragma('journal_mode = WAL');
    this.baseDir = baseDir;
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS identity_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section TEXT NOT NULL,
        content TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT 'system',
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_revisions_section
        ON identity_revisions(section, id DESC);
    `);
  }

  /** List all known sections. */
  listSections(): string[] {
    const rows = this.db.prepare(
      'SELECT DISTINCT section FROM identity_revisions ORDER BY section',
    ).all() as { section: string }[];
    return rows.map((r) => r.section);
  }

  /** Get the current (latest) content for a section. */
  getCurrent(section: string): string | undefined {
    // Try the database first (agent modifications)
    const row = this.db.prepare(
      'SELECT content FROM identity_revisions WHERE section = ? ORDER BY id DESC LIMIT 1',
    ).get(section) as { content: string } | undefined;
    if (row) return row.content;

    // Fall back to the file on disk (original)
    return this.readFile(section);
  }

  /** Get full revision history for a section. */
  getHistory(section: string, limit = 20): IdentityRevision[] {
    return this.db.prepare(
      'SELECT * FROM identity_revisions WHERE section = ? ORDER BY id DESC LIMIT ?',
    ).all(section, limit) as IdentityRevision[];
  }

  /** Get a specific revision. */
  getRevision(id: number): IdentityRevision | undefined {
    return this.db.prepare(
      'SELECT * FROM identity_revisions WHERE id = ?',
    ).get(id) as IdentityRevision | undefined;
  }

  /**
   * Update a section's content. Creates a new revision.
   * Also writes the file to disk so it takes effect on next brain reload.
   */
  update(section: string, content: string, author: 'agent' | 'user', reason: string): IdentityRevision {
    this.db.prepare(
      'INSERT INTO identity_revisions (section, content, author, reason) VALUES (?, ?, ?, ?)',
    ).run(section, content, author, reason);

    const rev = this.db.prepare(
      'SELECT * FROM identity_revisions WHERE section = ? ORDER BY id DESC LIMIT 1',
    ).get(section) as IdentityRevision;

    // Write to disk
    this.writeFile(section, content);

    return rev;
  }

  /** Revert a section to a specific revision. */
  revert(section: string, revisionId: number): IdentityRevision | undefined {
    const target = this.getRevision(revisionId);
    if (!target || target.section !== section) return undefined;

    return this.update(section, target.content, 'user', `Reverted to revision ${revisionId}`);
  }

  /**
   * Import the current file from disk as the initial revision.
   * Only imports if no revisions exist yet for this section.
   */
  importFromDisk(section: string, filePath: string): void {
    const existing = this.db.prepare(
      'SELECT COUNT(*) as count FROM identity_revisions WHERE section = ?',
    ).get(section) as { count: number };

    if (existing.count > 0) return;

    const absPath = resolve(this.baseDir, filePath);
    if (!existsSync(absPath)) return;

    const content = readFileSync(absPath, 'utf-8');
    this.db.prepare(
      'INSERT INTO identity_revisions (section, content, author, reason) VALUES (?, ?, ?, ?)',
    ).run(section, content, 'system', 'Imported from disk');
  }

  private readFile(section: string): string | undefined {
    // Map section names to file paths
    const filePath = this.sectionToPath(section);
    if (!filePath) return undefined;
    const absPath = resolve(this.baseDir, filePath);
    if (!existsSync(absPath)) return undefined;
    return readFileSync(absPath, 'utf-8');
  }

  private writeFile(section: string, content: string): void {
    const filePath = this.sectionToPath(section);
    if (!filePath) return;
    const absPath = resolve(this.baseDir, filePath);
    writeFileSync(absPath, content, 'utf-8');
  }

  private sectionToPath(section: string): string | undefined {
    // Known sections map to specific files
    const map: Record<string, string> = {
      personality: 'SOUL.md',
      soul: 'SOUL.md',
    };
    // If it's a known section, use the mapped path
    if (map[section]) return map[section];
    // Otherwise treat the section name as a relative path if it ends in .md
    if (section.endsWith('.md')) return section;
    // Or store in identity/ subdirectory
    return `identity/${section}.md`;
  }

  close(): void {
    this.db.close();
  }
}
