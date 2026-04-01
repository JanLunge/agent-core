import { randomUUID } from 'node:crypto';
import type { Message } from '../llm/types.js';

export interface Episode {
  id: string;
  messages: Message[];
  startIndex: number;
  endIndex: number;
  timestamp?: string;
}

export interface DetectEpisodesOptions {
  timeGapMinutes?: number;
  maxEpisodeSize?: number;
}

/**
 * Split a message list into episodes using simple heuristics:
 * - A boundary after every `maxEpisodeSize` messages (default 10)
 * - A boundary when a tool_calls sequence ends (assistant with tool_calls
 *   followed by tool responses, then a non-tool message)
 */
export function detectEpisodes(
  messages: Message[],
  opts?: DetectEpisodesOptions,
): Episode[] {
  if (messages.length === 0) return [];

  const maxSize = opts?.maxEpisodeSize ?? 10;
  const episodes: Episode[] = [];
  let start = 0;

  for (let i = 0; i < messages.length; i++) {
    const len = i - start + 1;
    const atEnd = i === messages.length - 1;

    // Detect end of a tool_calls sequence: current message is role=tool
    // and the next message is NOT role=tool (or we're at the end).
    const toolSequenceEnded =
      messages[i].role === 'tool' &&
      (atEnd || messages[i + 1]?.role !== 'tool');

    const sizeLimit = len >= maxSize;

    if (atEnd || toolSequenceEnded || sizeLimit) {
      episodes.push({
        id: randomUUID(),
        messages: messages.slice(start, i + 1),
        startIndex: start,
        endIndex: i,
        timestamp: new Date().toISOString(),
      });
      start = i + 1;
    }
  }

  return episodes;
}
