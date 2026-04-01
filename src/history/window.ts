import type { Message, LLMProvider } from '../llm/types.js';
import type { ArchiveStore } from './archive.js';
import { detectEpisodes } from './episodes.js';
import { compactEpisode } from './compactor.js';

export interface WindowOptions {
  /** Number of recent episodes to keep in full (default 3) */
  keepFullEpisodes?: number;
}

export class WindowManager {
  /**
   * Manage conversation history by compacting older episodes and keeping
   * recent ones in full. Returns a trimmed message list ready for prompt
   * assembly.
   *
   * Older episodes are summarized via LLM and archived to disk. Their
   * summaries are injected as system messages at the start of the returned
   * list, followed by the full messages of the most recent episodes.
   */
  async manageHistory(
    conversationId: string,
    messages: Message[],
    provider: LLMProvider,
    model: string,
    archiveStore: ArchiveStore,
    opts?: WindowOptions,
  ): Promise<Message[]> {
    const keep = opts?.keepFullEpisodes ?? 3;
    const episodes = detectEpisodes(messages);

    // If we have fewer episodes than the keep threshold, nothing to compact
    if (episodes.length <= keep) {
      return messages;
    }

    const toCompact = episodes.slice(0, episodes.length - keep);
    const toKeep = episodes.slice(episodes.length - keep);

    // Compact and archive older episodes
    const summaryMessages: Message[] = [];

    for (const episode of toCompact) {
      // Check if already archived
      const existing = archiveStore.retrieveEpisode(conversationId, episode.id);
      let summaryText: string;

      if (existing) {
        summaryText = existing.summary.summary;
      } else {
        const summary = await compactEpisode(episode, provider, model);
        archiveStore.archiveEpisode(conversationId, episode, summary);
        summaryText = summary.summary;
      }

      summaryMessages.push({
        role: 'system',
        content: `[Previous conversation summary]: ${summaryText}`,
      });
    }

    // Combine: summary messages first, then full recent messages
    const recentMessages = toKeep.flatMap((ep) => ep.messages);
    return [...summaryMessages, ...recentMessages];
  }
}
