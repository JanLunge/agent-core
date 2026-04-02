import fs from 'node:fs';
import path from 'node:path';

export interface AuditEntry {
  action: string;
  label: string;
  scope?: string;
  granted: boolean;
}

interface AuditRecord extends AuditEntry {
  timestamp: string;
}

/**
 * Append-only audit log for secret access events.
 * Writes JSONL to `secrets-audit.jsonl` inside the given data directory.
 */
export class AuditLog {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'secrets-audit.jsonl');
  }

  log(entry: AuditEntry): void {
    const record: AuditRecord = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    fs.appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf-8');
  }
}
