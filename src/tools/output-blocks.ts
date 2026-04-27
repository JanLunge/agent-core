import type { BlockRef, HeapName, HeaperBlock, HeaperMemory } from '../heaper/types.js';
import type { ToolResult } from './executor.js';

const DEFAULT_DIRECT_BYTES = 2 * 1024;
const DEFAULT_SUMMARY_BYTES = 512;

export interface ToolOutputBlockData extends Record<string, unknown> {
  toolCallId: string;
  name: string;
  output: string;
  bytes: number;
  durationMs: number;
  error?: string;
  skipped?: boolean;
}

export interface StoreToolOutputOptions {
  memory: HeaperMemory;
  heap: HeapName;
  result: ToolResult;
  directBytes?: number;
  summaryBytes?: number;
  tags?: string[];
  links?: BlockRef[];
}

export type StoredToolOutput =
  | {
      stored: false;
      result: ToolResult;
      blockRef?: undefined;
      block?: undefined;
    }
  | {
      stored: true;
      result: ToolResult;
      blockRef: BlockRef;
      block: HeaperBlock<ToolOutputBlockData>;
    };

/**
 * Stores large tool output as a Heaper block while returning a bounded result
 * for the agent loop. Small outputs pass through unchanged.
 */
export async function storeToolOutput(options: StoreToolOutputOptions): Promise<StoredToolOutput> {
  const directBytes = options.directBytes ?? DEFAULT_DIRECT_BYTES;
  const output = outputText(options.result);
  const bytes = Buffer.byteLength(output, 'utf8');

  if (bytes <= directBytes) {
    return { stored: false, result: { ...options.result } };
  }

  const block = (await options.memory.createBlock({
    heap: options.heap,
    type: 'tool-output',
    data: {
      toolCallId: options.result.toolCallId,
      name: options.result.name,
      output,
      bytes,
      durationMs: options.result.durationMs,
      error: options.result.error,
      skipped: options.result.skipped,
    },
    tags: ['tool-output', `tool:${options.result.name}`, ...(options.tags ?? [])],
    links: options.links,
    metadata: { storedBecause: 'output-exceeded-direct-bytes', directBytes },
  })) as HeaperBlock<ToolOutputBlockData>;

  const blockRef: BlockRef = { heap: block.heap, id: block.id };
  return {
    stored: true,
    block,
    blockRef,
    result: {
      ...options.result,
      result: summarizeStoredOutput(output, blockRef, bytes, options.summaryBytes ?? DEFAULT_SUMMARY_BYTES),
    },
  };
}

export async function getStoredToolOutput(memory: HeaperMemory, ref: BlockRef): Promise<ToolOutputBlockData | undefined> {
  const block = await memory.getBlock(ref);
  if (!block || block.type !== 'tool-output') return undefined;
  return block.data as ToolOutputBlockData;
}

function outputText(result: ToolResult): string {
  if (result.result) return result.result;
  if (result.error) return result.error;
  return '';
}

function summarizeStoredOutput(output: string, ref: BlockRef, bytes: number, summaryBytes: number): string {
  const preview = Buffer.from(output, 'utf8').subarray(0, summaryBytes).toString('utf8');
  return `${preview}\n\n[full tool output stored: ${ref.heap}#${ref.id}; ${bytes} bytes]`;
}
