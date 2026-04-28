import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  BlockRef,
  CreateBlockInput,
  HeapName,
  HeaperBlock,
  HeaperMemory,
  SearchFilters,
  SemanticSliceOptions,
  UpdateBlockInput,
} from './types.js';

export interface LocalHeaperMemoryOptions {
  filePath: string;
  now?: () => string;
  idPrefix?: string;
}

interface LocalHeaperSnapshot {
  version: 1;
  nextId: number;
  blocks: HeaperBlock[];
}

/**
 * Small durable scaffold for HeaperMemory semantics.
 *
 * This persists a whole JSON snapshot atomically after each write. It is meant
 * for local development/tests until the real Heaper adapter exists, not as the
 * final long-term source of truth.
 */
export class LocalHeaperMemory implements HeaperMemory {
  private readonly filePath: string;
  private readonly now: () => string;
  private readonly idPrefix: string;
  private readonly blocks = new Map<string, HeaperBlock>();
  private nextId = 1;
  private loaded = false;

  constructor(options: LocalHeaperMemoryOptions) {
    this.filePath = options.filePath;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idPrefix = options.idPrefix ?? 'local';
  }

  async search(query: string, filters: SearchFilters = {}): Promise<HeaperBlock[]> {
    await this.load();
    const normalizedQuery = query.trim().toLowerCase();

    return Array.from(this.blocks.values())
      .filter((block) => matchesFilters(block, filters))
      .filter((block) => !normalizedQuery || searchText(block).includes(normalizedQuery))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, filters.limit ?? Number.POSITIVE_INFINITY)
      .map(cloneBlock);
  }

  async getBlock(ref: BlockRef): Promise<HeaperBlock | undefined> {
    await this.load();
    const block = this.blocks.get(keyFor(ref));
    return block ? cloneBlock(block) : undefined;
  }

  async createBlock(input: CreateBlockInput): Promise<HeaperBlock> {
    await this.load();
    const timestamp = this.now();
    const block: HeaperBlock = {
      id: `${this.idPrefix}-${this.nextId++}`,
      heap: input.heap,
      type: input.type,
      data: cloneRecord(input.data),
      tags: [...(input.tags ?? [])],
      links: input.links ? input.links.map(cloneRef) : undefined,
      metadata: input.metadata ? cloneRecord(input.metadata) : undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.blocks.set(keyFor(block), cloneBlock(block));
    await this.persist();
    return cloneBlock(block);
  }

  async updateBlock(ref: BlockRef, changes: UpdateBlockInput): Promise<HeaperBlock> {
    await this.load();
    const existing = this.requireBlock(ref);
    const updated: HeaperBlock = {
      ...existing,
      data: changes.data ? { ...existing.data, ...cloneRecord(changes.data) } : existing.data,
      tags: changes.tags ? [...changes.tags] : existing.tags,
      links: changes.links ? changes.links.map(cloneRef) : existing.links,
      metadata: changes.metadata ? { ...(existing.metadata ?? {}), ...cloneRecord(changes.metadata) } : existing.metadata,
      updatedAt: this.now(),
    };
    this.blocks.set(keyFor(updated), cloneBlock(updated));
    await this.persist();
    return cloneBlock(updated);
  }

  async linkBlocks(a: BlockRef, b: BlockRef): Promise<void> {
    await this.load();
    this.requireBlock(a);
    this.requireBlock(b);
    this.addLink(a, b);
    this.addLink(b, a);
    await this.persist();
  }

  async getDailyEntry(date: string, heap: HeapName): Promise<HeaperBlock | undefined> {
    await this.load();
    const block = Array.from(this.blocks.values()).find(
      (candidate) => candidate.heap === heap && candidate.type === 'daily-entry' && candidate.data.date === date,
    );
    return block ? cloneBlock(block) : undefined;
  }

  async appendToDailyEntry(content: string, heap: HeapName, date = today(this.now())): Promise<HeaperBlock> {
    await this.load();
    const existing = await this.getDailyEntry(date, heap);
    if (!existing) {
      return this.createBlock({ heap, type: 'daily-entry', data: { date, content }, tags: ['daily-entry'] });
    }

    const previousContent = typeof existing.data.content === 'string' ? existing.data.content : '';
    const separator = previousContent ? '\n' : '';
    return this.updateBlock(existing, { data: { content: `${previousContent}${separator}${content}` } });
  }

  async getRelatedBlocks(ref: BlockRef): Promise<HeaperBlock[]> {
    await this.load();
    this.requireBlock(ref);
    return Array.from(this.blocks.values())
      .filter((block) => block.links?.some((link) => sameRef(link, ref)))
      .map(cloneBlock);
  }

  async semanticSlice(options: SemanticSliceOptions): Promise<HeaperBlock[]> {
    const { query, timeRangeLabel: _timeRangeLabel, ...filters } = options;
    return this.search(query, filters);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const snapshot = JSON.parse(raw) as LocalHeaperSnapshot;
      this.nextId = snapshot.nextId;
      this.blocks.clear();
      for (const block of snapshot.blocks) this.blocks.set(keyFor(block), cloneBlock(block));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      await mkdir(dirname(this.filePath), { recursive: true });
      await this.persistLoadedEmpty();
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const snapshot: LocalHeaperSnapshot = {
      version: 1,
      nextId: this.nextId,
      blocks: Array.from(this.blocks.values()).sort((a, b) => keyFor(a).localeCompare(keyFor(b))).map(cloneBlock),
    };
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await rename(tmpPath, this.filePath);
  }

  private async persistLoadedEmpty(): Promise<void> {
    this.loaded = true;
    await this.persist();
    this.loaded = false;
  }

  private requireBlock(ref: BlockRef): HeaperBlock {
    const block = this.blocks.get(keyFor(ref));
    if (!block) throw new Error(`Block not found: ${ref.heap}#${ref.id}`);
    return block;
  }

  private addLink(from: BlockRef, to: BlockRef): void {
    const block = this.requireBlock(from);
    const links = block.links ?? [];
    if (links.some((link) => sameRef(link, to))) return;
    const updated = { ...block, links: [...links, cloneRef(to)], updatedAt: this.now() };
    this.blocks.set(keyFor(updated), cloneBlock(updated));
  }
}

function matchesFilters(block: HeaperBlock, filters: SearchFilters): boolean {
  if (filters.heaps && !filters.heaps.includes(block.heap)) return false;
  if (filters.types && !filters.types.includes(block.type)) return false;
  if (filters.tags && !filters.tags.every((tag) => block.tags.includes(tag))) return false;
  if (filters.timeRange?.from && block.updatedAt < filters.timeRange.from) return false;
  if (filters.timeRange?.to && block.updatedAt > filters.timeRange.to) return false;
  return true;
}

function searchText(block: HeaperBlock): string {
  return [block.id, block.heap, block.type, block.tags.join(' '), JSON.stringify(block.data), JSON.stringify(block.metadata ?? {})]
    .join(' ')
    .toLowerCase();
}

function keyFor(ref: BlockRef): string {
  return `${ref.heap}#${ref.id}`;
}

function sameRef(a: BlockRef, b: BlockRef): boolean {
  return a.heap === b.heap && a.id === b.id;
}

function cloneRef(ref: BlockRef): BlockRef {
  return { heap: ref.heap, id: ref.id };
}

function cloneBlock(block: HeaperBlock): HeaperBlock {
  return {
    ...block,
    data: cloneRecord(block.data),
    tags: [...block.tags],
    links: block.links?.map(cloneRef),
    metadata: block.metadata ? cloneRecord(block.metadata) : undefined,
  };
}

function cloneRecord<T extends Record<string, unknown>>(record: T): T {
  return JSON.parse(JSON.stringify(record)) as T;
}

function today(timestamp: string): string {
  return timestamp.slice(0, 10);
}
