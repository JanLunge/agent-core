import type { BlockRef, HeaperBlock, HeaperMemory, HeapName } from '../heaper/types.js';
import { LocalHeaperMemory } from '../heaper/local-storage.js';
import { redactSensitiveDetails } from '../runtime/blockers.js';

export interface ExportAuditTrailOptions {
  memory: HeaperMemory;
  startRef: BlockRef;
  maxDepth?: number;
}

export interface RunAuditExportOptions {
  storePath: string;
  ref: string;
  maxDepth?: number;
}

export interface AuditTrailBlock {
  block: HeaperBlock;
  depth: number;
}

export interface CreateAuditSnapshotOptions extends ExportAuditTrailOptions {
  snapshotHeap: HeapName;
  maxChars?: number;
}

export interface RunAuditSnapshotOptions {
  storePath: string;
  ref: string;
  snapshotHeap: HeapName;
  maxDepth?: number;
  maxChars?: number;
}

const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_SNAPSHOT_MAX_CHARS = 4000;

const TYPE_LABELS: Record<string, string> = {
  'runtime-event': 'event',
  'route-record': 'route',
  'model-decision': 'model',
  'guard-decision': 'guard',
  'approval-request': 'approval',
  'tool-intent': 'tool',
  'tool-output': 'tool-output',
  'runtime-blocker': 'blocker',
  'task-result': 'result',
  'session-message': 'message',
  'session': 'session',
  'task': 'task',
  'daily-entry': 'daily',
  'audit-snapshot': 'snapshot',
};

/**
 * Export a deterministic readable audit trail from a starting block ref.
 *
 * Traversal follows both direct block links and reverse links (`getRelatedBlocks`),
 * so callers can start from a session/task and still see event, route, model,
 * guard, approval, tool, blocker, and result blocks when they are linked.
 */
export async function exportAuditTrail(options: ExportAuditTrailOptions): Promise<string> {
  return renderTrail(options.startRef, await collectAuditTrailBlocks(options));
}

export async function collectAuditTrailBlocks(options: ExportAuditTrailOptions): Promise<AuditTrailBlock[]> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const start = await options.memory.getBlock(options.startRef);
  if (!start) throw new Error(`Audit start block not found: ${formatRef(options.startRef)}`);

  const visited = new Set<string>();
  const blocks: AuditTrailBlock[] = [];
  const queue: Array<{ ref: BlockRef; depth: number }> = [{ ref: options.startRef, depth: 0 }];

  while (queue.length > 0) {
    const { ref, depth } = queue.shift()!;
    const key = keyFor(ref);
    if (visited.has(key) || depth > maxDepth) continue;
    visited.add(key);

    const block = await options.memory.getBlock(ref);
    if (!block) continue;
    blocks.push({ block, depth });

    const neighbors = await neighborsFor(options.memory, block);
    for (const neighbor of neighbors) {
      if (!visited.has(keyFor(neighbor))) queue.push({ ref: neighbor, depth: depth + 1 });
    }
  }

  return blocks.sort((a, b) => a.depth - b.depth || a.block.createdAt.localeCompare(b.block.createdAt) || a.block.id.localeCompare(b.block.id));
}

export async function createAuditSnapshot(options: CreateAuditSnapshotOptions): Promise<HeaperBlock> {
  const blocks = await collectAuditTrailBlocks(options);
  const maxChars = options.maxChars ?? DEFAULT_SNAPSHOT_MAX_CHARS;
  const fullText = renderTrail(options.startRef, blocks);
  const content = truncate(fullText, maxChars);
  const sourceRefs = blocks.map(({ block }) => refFor(block));
  return options.memory.createBlock({
    heap: options.snapshotHeap,
    type: 'metadata',
    data: {
      startRef: options.startRef,
      sourceRefs,
      blockCount: blocks.length,
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
      truncated: content.length < fullText.length,
      content,
    },
    tags: ['audit-snapshot', `start:${options.startRef.id}`, `blocks:${blocks.length}`],
    links: sourceRefs,
    metadata: { source: 'audit-snapshot', preservesRawBlocks: true },
  });
}

export async function runAuditExport(options: RunAuditExportOptions): Promise<string> {
  const memory = new LocalHeaperMemory({ filePath: options.storePath });
  return exportAuditTrail({ memory, startRef: parseBlockRef(options.ref), maxDepth: options.maxDepth });
}

export async function runAuditSnapshot(options: RunAuditSnapshotOptions): Promise<string> {
  const memory = new LocalHeaperMemory({ filePath: options.storePath });
  const snapshot = await createAuditSnapshot({
    memory,
    startRef: parseBlockRef(options.ref),
    snapshotHeap: options.snapshotHeap,
    maxDepth: options.maxDepth,
    maxChars: options.maxChars,
  });
  return [
    `Created audit snapshot ${formatRef(snapshot)}`,
    `Source: ${options.ref}`,
    `Blocks: ${snapshot.data.blockCount}`,
    `Truncated: ${snapshot.data.truncated}`,
    '',
    String(snapshot.data.content ?? ''),
  ].join('\n');
}

export function parseBlockRef(value: string): BlockRef {
  const [heap, id, extra] = value.split('#');
  if (!heap || !id || extra !== undefined) throw new Error(`Invalid block ref: ${value}. Expected heap#id`);
  return { heap: heap as HeapName, id };
}

async function neighborsFor(memory: HeaperMemory, block: HeaperBlock): Promise<BlockRef[]> {
  const direct = block.links ?? [];
  const reverse = await memory.getRelatedBlocks(refFor(block));
  return dedupeRefs([...direct, ...reverse.map(refFor)]).sort(compareRefs);
}

function renderTrail(startRef: BlockRef, blocks: AuditTrailBlock[]): string {
  return [
    `Audit trail from ${formatRef(startRef)}`,
    ...blocks.map(({ block, depth }) => renderBlock(block, depth)),
  ].join('\n\n');
}

function renderBlock(block: HeaperBlock, depth: number): string {
  const label = labelFor(block);
  const links = (block.links ?? []).map(formatRef).join(', ') || 'none';
  return [
    `${'  '.repeat(depth)}- ${formatRef(block)} [${label}] type=${block.type}`,
    `${'  '.repeat(depth)}  tags: ${block.tags.join(', ') || 'none'}`,
    `${'  '.repeat(depth)}  links: ${links}`,
    `${'  '.repeat(depth)}  data: ${renderData(block)}`,
  ].join('\n');
}

function labelFor(block: HeaperBlock): string {
  for (const tag of block.tags) {
    const exact = TYPE_LABELS[tag];
    if (exact) return exact;
  }
  if (block.type === 'proposal') return 'approval';
  return block.type;
}

function renderData(block: HeaperBlock): string {
  return stableJson(redactAuditData(block.data));
}

function redactAuditData(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitiveDetails(value);
  if (Array.isArray(value)) return value.map(redactAuditData);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : redactAuditData(item),
    ]));
  }
  return value;
}

function isSensitiveKey(key: string): boolean {
  return /^(authorization|api[_-]?key|token|password|secret)$/i.test(key) || /(api[_-]?key|token|password|secret)$/i.test(key);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}

function refFor(block: HeaperBlock): BlockRef {
  return { heap: block.heap, id: block.id };
}

function formatRef(ref: BlockRef): string {
  return `${ref.heap}#${ref.id}`;
}

function keyFor(ref: BlockRef): string {
  return formatRef(ref);
}

function compareRefs(a: BlockRef, b: BlockRef): number {
  return a.heap.localeCompare(b.heap) || a.id.localeCompare(b.id);
}

function dedupeRefs(refs: BlockRef[]): BlockRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = keyFor(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}
