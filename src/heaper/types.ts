/**
 * Heaper-compatible domain boundary.
 *
 * These types describe the memory API agent-core should depend on. The first
 * implementation may be local SQLite/files, but callers should treat it like
 * the future Heaper block API.
 */

export type HeapScope = 'human' | 'agent' | 'persona';
export type HeapName = `human/${string}` | `agent/${string}` | `persona/${string}/${string}`;
export type BlockType = 'text' | 'file' | 'metadata' | 'link' | 'session' | 'tool-output' | 'task' | 'daily-entry' | 'proposal';

export interface HeapRef {
  scope: HeapScope;
  /** For persona heaps, this is the persona name. For human/agent, it is the first path segment. */
  owner: string;
  path: string;
  name: HeapName;
}

export interface BlockRef {
  heap: HeapName;
  id: string;
}

export interface HeaperBlock<TData extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  heap: HeapName;
  type: BlockType;
  data: TData;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  links?: BlockRef[];
  metadata?: Record<string, unknown>;
}

export interface SearchFilters {
  heaps?: HeapName[];
  tags?: string[];
  types?: BlockType[];
  timeRange?: {
    from?: string;
    to?: string;
  };
  limit?: number;
}

export interface SemanticSliceOptions extends SearchFilters {
  query: string;
  /** Optional human-friendly range such as "today", "yesterday", or "last-7-days". */
  timeRangeLabel?: string;
}

export interface CreateBlockInput<TData extends Record<string, unknown> = Record<string, unknown>> {
  heap: HeapName;
  type: BlockType;
  data: TData;
  tags?: string[];
  links?: BlockRef[];
  metadata?: Record<string, unknown>;
}

export interface UpdateBlockInput<TData extends Record<string, unknown> = Record<string, unknown>> {
  data?: Partial<TData>;
  tags?: string[];
  links?: BlockRef[];
  metadata?: Record<string, unknown>;
}

export interface HeaperMemory {
  search(query: string, filters?: SearchFilters): Promise<HeaperBlock[]>;
  getBlock(ref: BlockRef): Promise<HeaperBlock | undefined>;
  createBlock(input: CreateBlockInput): Promise<HeaperBlock>;
  updateBlock(ref: BlockRef, changes: UpdateBlockInput): Promise<HeaperBlock>;
  linkBlocks(a: BlockRef, b: BlockRef): Promise<void>;
  getDailyEntry(date: string, heap: HeapName): Promise<HeaperBlock | undefined>;
  appendToDailyEntry(content: string, heap: HeapName, date?: string): Promise<HeaperBlock>;
  getRelatedBlocks(ref: BlockRef): Promise<HeaperBlock[]>;
  semanticSlice(options: SemanticSliceOptions): Promise<HeaperBlock[]>;
}

export function parseHeapName(name: HeapName): HeapRef {
  const parts = name.split('/');
  const scope = parts[0] as HeapScope;

  if (scope === 'human' || scope === 'agent') {
    if (parts.length < 2 || !parts[1]) {
      throw new Error(`Invalid heap name: ${name}`);
    }
    return { scope, owner: parts[1], path: parts.slice(1).join('/'), name };
  }

  if (scope === 'persona') {
    if (parts.length < 3 || !parts[1] || !parts[2]) {
      throw new Error(`Invalid persona heap name: ${name}`);
    }
    return { scope, owner: parts[1], path: parts.slice(2).join('/'), name };
  }

  throw new Error(`Unknown heap scope: ${parts[0]}`);
}
