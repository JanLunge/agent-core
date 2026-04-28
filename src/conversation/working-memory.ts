import type { BlockRef, HeapName, HeaperBlock, HeaperMemory, SearchFilters } from '../heaper/types.js';
import type { Message } from '../llm/types.js';

export interface WorkingMemoryBlock {
  ref: BlockRef;
  type: HeaperBlock['type'];
  tags: string[];
  preview: string;
  updatedAt: string;
}

export interface WorkingMemoryBundle {
  recentMessages: Message[];
  retrievedBlocks: WorkingMemoryBlock[];
  text: string;
  stats: {
    messageCount: number;
    retrievedCount: number;
    truncated: boolean;
    chars: number;
  };
}

export interface WorkingMemoryContinuityContext {
  text: string;
}

export interface SelectWorkingMemoryOptions {
  memory: HeaperMemory;
  history: Message[];
  query?: string;
  heaps?: HeapName[];
  filters?: Omit<SearchFilters, 'heaps' | 'limit'>;
  continuity?: WorkingMemoryContinuityContext;
  recentMessageLimit?: number;
  retrievalLimit?: number;
  maxChars?: number;
  maxMessageChars?: number;
  maxBlockPreviewChars?: number;
}

const DEFAULT_RECENT_MESSAGE_LIMIT = 12;
const DEFAULT_RETRIEVAL_LIMIT = 8;
const DEFAULT_MAX_CHARS = 6000;
const DEFAULT_MAX_MESSAGE_CHARS = 1000;
const DEFAULT_MAX_BLOCK_PREVIEW_CHARS = 700;

/**
 * Builds a bounded working-memory bundle from recent session messages plus
 * relevant Heaper retrieval. The bundle passes references, not hidden copied
 * full blocks, so callers can fetch complete context explicitly if needed.
 */
export async function selectWorkingMemory(options: SelectWorkingMemoryOptions): Promise<WorkingMemoryBundle> {
  const recentMessages = options.history.slice(-(options.recentMessageLimit ?? DEFAULT_RECENT_MESSAGE_LIMIT));
  const query = options.query ?? queryFromMessages(recentMessages);
  const maxBlockPreviewChars = options.maxBlockPreviewChars ?? DEFAULT_MAX_BLOCK_PREVIEW_CHARS;

  const blocks = query
    ? await options.memory.semanticSlice({
        query,
        heaps: options.heaps,
        limit: options.retrievalLimit ?? DEFAULT_RETRIEVAL_LIMIT,
        ...(options.filters ?? {}),
      })
    : [];

  const retrievedBlocks = dedupeBlocks(blocks).map((block) => ({
    ref: refFor(block),
    type: block.type,
    tags: [...block.tags],
    preview: truncate(blockPreview(block), maxBlockPreviewChars),
    updatedAt: block.updatedAt,
  }));

  const { text, truncated } = renderBundle({
    continuity: options.continuity,
    recentMessages,
    retrievedBlocks,
    maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
    maxMessageChars: options.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS,
  });

  return {
    recentMessages: recentMessages.map((message) => ({ ...message })),
    retrievedBlocks,
    text,
    stats: {
      messageCount: recentMessages.length,
      retrievedCount: retrievedBlocks.length,
      truncated,
      chars: text.length,
    },
  };
}

function queryFromMessages(messages: Message[]): string {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-4)
    .map((message) => message.content)
    .join(' ')
    .trim();
}

function dedupeBlocks(blocks: HeaperBlock[]): HeaperBlock[] {
  const seen = new Set<string>();
  const deduped: HeaperBlock[] = [];
  for (const block of blocks) {
    const key = `${block.heap}#${block.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(block);
  }
  return deduped;
}

function renderBundle(options: {
  continuity?: WorkingMemoryContinuityContext;
  recentMessages: Message[];
  retrievedBlocks: WorkingMemoryBlock[];
  maxChars: number;
  maxMessageChars: number;
}): { text: string; truncated: boolean } {
  const sections: string[] = [];

  if (options.continuity?.text) {
    sections.push(['## Daily continuity', options.continuity.text].join('\n'));
  }

  if (options.recentMessages.length > 0) {
    sections.push([
      '## Recent session messages',
      ...options.recentMessages.map((message) => {
        const timestamp = message.timestamp ? ` ${message.timestamp}` : '';
        return `- ${message.role}${timestamp}: ${truncate(message.content, options.maxMessageChars)}`;
      }),
    ].join('\n'));
  }

  if (options.retrievedBlocks.length > 0) {
    sections.push([
      '## Retrieved memory blocks',
      ...options.retrievedBlocks.map((block) => (
        `- ${block.ref.heap}#${block.ref.id} (${block.type}; ${block.updatedAt}): ${block.preview}`
      )),
    ].join('\n'));
  }

  return truncateWithFlag(sections.join('\n\n'), options.maxChars);
}

function blockPreview(block: HeaperBlock): string {
  const content = block.data.content;
  if (typeof content === 'string') return content;
  const summary = block.data.summary;
  if (typeof summary === 'string') return summary;
  const output = block.data.output;
  if (typeof output === 'string') return output;
  return JSON.stringify(block.data);
}

function refFor(block: HeaperBlock): BlockRef {
  return { heap: block.heap, id: block.id };
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function truncateWithFlag(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: truncate(text, maxChars), truncated: true };
}
