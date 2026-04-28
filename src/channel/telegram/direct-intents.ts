import { join } from 'node:path';
import { homedir } from 'node:os';

export interface DirectFileWriteIntent {
  kind: 'file-write';
  path: string;
  content: string;
  description: string;
}

/**
 * Tiny deterministic bridge for early production testing while the full runtime
 * tool planner is being wired into normal Telegram operation.
 */
export function parseDirectFileWriteIntent(text: string): DirectFileWriteIntent | undefined {
  const normalized = text.trim();
  const lower = normalized.toLowerCase();
  if (!/\b(create|write|make)\b/.test(lower)) return undefined;
  if (!/\b(note\b|file\b)/.test(lower)) return undefined;
  if (!/\bdesktop\b/.test(lower)) return undefined;

  const requestedName = lower.match(/\b([a-z0-9][a-z0-9_-]*)(?:\.md|\.txt)?\s+(?:note|file)\b/)?.[1]
    ?? lower.match(/\b(?:note|file)\s+(?:called|named)\s+([a-z0-9][a-z0-9_-]*)\b/)?.[1]
    ?? 'test-note';
  const safeBaseName = requestedName.replace(/[^a-z0-9_-]/gi, '-').replace(/^-+|-+$/g, '') || 'test-note';
  const extension = lower.includes('.txt') ? '.txt' : '.md';
  const fileName = safeBaseName.endsWith(extension) ? safeBaseName : `${safeBaseName}${extension}`;
  const path = join(homedir(), 'Desktop', fileName);

  return {
    kind: 'file-write',
    path,
    content: `# ${titleFromName(safeBaseName)}\n\nCreated by agent-core after Telegram approval.\n`,
    description: `Create ${fileName} on the Desktop`,
  };
}

function titleFromName(name: string): string {
  return name
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ') || 'Note';
}
