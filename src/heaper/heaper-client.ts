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

export interface HeaperClientMemoryConfig {
  endpoint?: string;
  namespace?: string;
  apiKeyEnv?: string;
  enabled?: boolean;
}

/**
 * Non-functional skeleton for the future real Heaper-backed adapter.
 *
 * It documents the constructor/config shape and fails closed for every memory
 * operation until a real Heaper client, credentials, auth model, pagination, and
 * typed-link semantics are wired in deliberately.
 */
export class HeaperClientMemory implements HeaperMemory {
  readonly endpoint?: string;
  readonly namespace?: string;
  readonly apiKeyEnv?: string;
  readonly enabled: boolean;

  constructor(config: HeaperClientMemoryConfig = {}) {
    this.endpoint = config.endpoint;
    this.namespace = config.namespace;
    this.apiKeyEnv = config.apiKeyEnv;
    this.enabled = Boolean(config.enabled);
  }

  search(): Promise<HeaperBlock[]> {
    return this.notImplemented('search');
  }

  getBlock(): Promise<HeaperBlock | undefined> {
    return this.notImplemented('getBlock');
  }

  createBlock(_input: CreateBlockInput): Promise<HeaperBlock> {
    return this.notImplemented('createBlock');
  }

  updateBlock(_ref: BlockRef, _changes: UpdateBlockInput): Promise<HeaperBlock> {
    return this.notImplemented('updateBlock');
  }

  linkBlocks(_a: BlockRef, _b: BlockRef): Promise<void> {
    return this.notImplemented('linkBlocks');
  }

  getDailyEntry(_date: string, _heap: HeapName): Promise<HeaperBlock | undefined> {
    return this.notImplemented('getDailyEntry');
  }

  appendToDailyEntry(_content: string, _heap: HeapName, _date?: string): Promise<HeaperBlock> {
    return this.notImplemented('appendToDailyEntry');
  }

  getRelatedBlocks(_ref: BlockRef): Promise<HeaperBlock[]> {
    return this.notImplemented('getRelatedBlocks');
  }

  semanticSlice(_options: SemanticSliceOptions): Promise<HeaperBlock[]> {
    return this.notImplemented('semanticSlice');
  }

  private async notImplemented<T>(operation: string): Promise<T> {
    throw new Error(`HeaperClientMemory.${operation} is not implemented; use runtime_memory.kind=local until the Heaper adapter is wired`);
  }
}
