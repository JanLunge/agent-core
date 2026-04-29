import type { HeaperBlock, HeaperMemory, SearchFilters } from './types.js';

export interface MemoryScanOptions {
  memory: HeaperMemory;
  query?: string;
  filters?: SearchFilters;
  /**
   * Temporary safety bound while HeaperMemory has no cursor API.
   * Future Heaper adapter should replace this with cursor/page iteration.
   */
  maxResults?: number;
}

export interface MemoryScanResult {
  blocks: HeaperBlock[];
  exhausted: boolean;
  limit: number;
  nextCursor?: string;
}

export const DEFAULT_MEMORY_SCAN_LIMIT = 10_000;

/**
 * Bounded scan wrapper for command/reporting code that needs broad local reads.
 *
 * This intentionally avoids `search('', { limit: Infinity })` in production-facing
 * callers. The current HeaperMemory interface has no cursor yet, so `exhausted`
 * is conservative: exactly hitting the limit means more results may exist.
 */
export async function scanMemory(options: MemoryScanOptions): Promise<MemoryScanResult> {
  const limit = options.maxResults ?? options.filters?.limit ?? DEFAULT_MEMORY_SCAN_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) throw new Error(`Invalid memory scan limit: ${limit}`);

  const blocks = await options.memory.search(options.query ?? '', {
    ...(options.filters ?? {}),
    limit,
  });

  return {
    blocks,
    limit,
    exhausted: blocks.length < limit,
    nextCursor: blocks.length >= limit ? 'cursor-unavailable' : undefined,
  };
}
