import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import type { OperationIntent } from '../../operations/approval.js';

/**
 * Tiny deterministic bridge for early production testing while the full runtime
 * tool planner is being wired into normal Telegram operation.
 */
export function parseDirectOperationIntent(text: string): OperationIntent | undefined {
  return parseDirectFileDeleteIntent(text) ?? parseDirectFileWriteIntent(text);
}

export function parseDirectFileWriteIntent(text: string): OperationIntent | undefined {
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
    kind: 'file.write',
    target: path,
    risk: 'medium',
    args: {
      path,
      content: `# ${titleFromName(safeBaseName)}\n\nCreated by agent-core after Telegram approval.\n`,
    },
    description: `Create ${fileName} on the Desktop`,
  };
}

export function parseDirectFileDeleteIntent(text: string): OperationIntent | undefined {
  const lower = text.trim().toLowerCase();
  if (!/\b(remove|delete|trash)\b/.test(lower)) return undefined;

  const explicitDesktop = /\bdesktop\b/.test(lower);
  const fileName = extractFileName(lower);
  if (!fileName) return undefined;

  // For this early bridge, bare filenames are scoped to Desktop because the
  // Telegram test flow creates and removes Desktop notes. Avoid arbitrary paths.
  const path = join(homedir(), 'Desktop', fileName);
  const location = explicitDesktop ? 'from the Desktop' : 'from the Desktop';

  return {
    kind: 'file.delete',
    target: path,
    risk: 'high',
    args: { path, recoverable: true },
    description: `Move ${basename(path)} ${location} to Trash`,
  };
}

function extractFileName(lower: string): string | undefined {
  const explicit = lower.match(/\b([a-z0-9][a-z0-9_-]*\.(?:md|txt))\b/i)?.[1];
  if (explicit) return sanitizeFileName(explicit);

  const named = lower.match(/\b(?:remove|delete|trash)\s+(?:the\s+)?([a-z0-9][a-z0-9_-]*)\b/i)?.[1];
  if (!named || ['note', 'file'].includes(named)) return undefined;
  return sanitizeFileName(`${named}.md`);
}

function sanitizeFileName(fileName: string): string {
  const [rawBase, rawExt] = fileName.split(/\.(?=[^.]+$)/);
  const base = (rawBase ?? 'note').replace(/[^a-z0-9_-]/gi, '-').replace(/^-+|-+$/g, '') || 'note';
  const ext = rawExt === 'txt' ? 'txt' : 'md';
  return `${base}.${ext}`;
}

function titleFromName(name: string): string {
  return name
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ') || 'Note';
}
