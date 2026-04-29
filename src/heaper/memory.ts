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
import { semanticSliceFiltersWithTimeRange } from './time-range.js';

export interface InMemoryHeaperMemoryOptions {
  now?: () => string;
  idPrefix?: string;
}

/**
 * Local scaffold for the future Heaper-backed memory API.
 *
 * It intentionally implements only block-shaped behavior that should map cleanly
 * to Heaper later: heap-scoped blocks, simple search/filtering, daily entries,
 * and explicit block links. It is useful for tests and early adapters without
 * committing agent-core to a separate long-term memory database.
 */
export class InMemoryHeaperMemory implements HeaperMemory {
  private readonly blocks = new Map<string, HeaperBlock>();
  private readonly now: () => string;
  private readonly idPrefix: string;
  private nextId = 1;

  constructor(options: InMemoryHeaperMemoryOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idPrefix = options.idPrefix ?? 'local';
  }

  async search(query: string, filters: SearchFilters = {}): Promise<HeaperBlock[]> {
    const normalizedQuery = query.trim().toLowerCase();

    return Array.from(this.blocks.values())
      .filter((block) => this.matchesFilters(block, filters))
      .filter((block) => {
        if (!normalizedQuery) return true;
        return this.searchText(block).includes(normalizedQuery);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, filters.limit ?? Number.POSITIVE_INFINITY)
      .map((block) => cloneBlock(block));
  }

  async getBlock(ref: BlockRef): Promise<HeaperBlock | undefined> {
    const block = this.blocks.get(keyFor(ref));
    return block ? cloneBlock(block) : undefined;
  }

  async createBlock(input: CreateBlockInput): Promise<HeaperBlock> {
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
    return cloneBlock(block);
  }

  async updateBlock(ref: BlockRef, changes: UpdateBlockInput): Promise<HeaperBlock> {
    const existing = this.requireBlock(ref);
    const updated: HeaperBlock = {
      ...existing,
      data: changes.data ? { ...existing.data, ...cloneRecord(changes.data) } : existing.data,
      tags: changes.tags ? [...changes.tags] : existing.tags,
      links: changes.links ? changes.links.map(cloneRef) : existing.links,
      metadata: changes.metadata
        ? { ...(existing.metadata ?? {}), ...cloneRecord(changes.metadata) }
        : existing.metadata,
      updatedAt: this.now(),
    };

    this.blocks.set(keyFor(updated), cloneBlock(updated));
    return cloneBlock(updated);
  }

  async linkBlocks(a: BlockRef, b: BlockRef): Promise<void> {
    this.requireBlock(a);
    this.requireBlock(b);
    this.addLink(a, b);
    this.addLink(b, a);
  }

  async getDailyEntry(date: string, heap: HeapName): Promise<HeaperBlock | undefined> {
    const block = Array.from(this.blocks.values()).find(
      (candidate) => candidate.heap === heap && candidate.type === 'daily-entry' && candidate.data.date === date,
    );
    return block ? cloneBlock(block) : undefined;
  }

  async appendToDailyEntry(content: string, heap: HeapName, date = today(this.now())): Promise<HeaperBlock> {
    const existing = await this.getDailyEntry(date, heap);
    if (!existing) {
      return this.createBlock({
        heap,
        type: 'daily-entry',
        data: { date, content },
        tags: ['daily-entry'],
      });
    }

    const previousContent = typeof existing.data.content === 'string' ? existing.data.content : '';
    const separator = previousContent ? '\n' : '';
    return this.updateBlock(existing, {
      data: { content: `${previousContent}${separator}${content}` },
    });
  }

  async getRelatedBlocks(ref: BlockRef): Promise<HeaperBlock[]> {
    this.requireBlock(ref);
    return Array.from(this.blocks.values())
      .filter((block) => block.links?.some((link) => sameRef(link, ref)))
      .map((block) => cloneBlock(block));
  }

  async semanticSlice(options: SemanticSliceOptions): Promise<HeaperBlock[]> {
    const { query, ...filterOptions } = options;
    return this.search(query, semanticSliceFiltersWithTimeRange(filterOptions, this.now()));
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

  private matchesFilters(block: HeaperBlock, filters: SearchFilters): boolean {
    if (filters.heaps && !filters.heaps.includes(block.heap)) return false;
    if (filters.types && !filters.types.includes(block.type)) return false;
    if (filters.tags && !filters.tags.every((tag) => block.tags.includes(tag))) return false;
    if (filters.timeRange?.from && block.updatedAt < filters.timeRange.from) return false;
    if (filters.timeRange?.to && block.updatedAt > filters.timeRange.to) return false;
    return true;
  }

  private searchText(block: HeaperBlock): string {
    return [block.id, block.heap, block.type, block.tags.join(' '), JSON.stringify(block.data), JSON.stringify(block.metadata ?? {})]
      .join(' ')
      .toLowerCase();
  }
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
