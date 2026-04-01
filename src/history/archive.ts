import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Episode } from './episodes.js';
import type { EpisodeSummary } from './compactor.js';

export interface ArchivedEpisode {
  episode: Episode;
  summary: EpisodeSummary;
}

export class ArchiveStore {
  private archiveDir: string;

  constructor(dataDir: string) {
    this.archiveDir = join(dataDir, 'archive');
    mkdirSync(this.archiveDir, { recursive: true });
  }

  /**
   * Write an episode and its summary to disk.
   */
  archiveEpisode(
    conversationId: string,
    episode: Episode,
    summary: EpisodeSummary,
  ): void {
    const dir = join(this.archiveDir, conversationId);
    mkdirSync(dir, { recursive: true });

    const data: ArchivedEpisode = { episode, summary };
    writeFileSync(
      join(dir, `${episode.id}.json`),
      JSON.stringify(data, null, 2),
      'utf-8',
    );
  }

  /**
   * Retrieve a single archived episode by ID.
   */
  retrieveEpisode(
    conversationId: string,
    episodeId: string,
  ): ArchivedEpisode | null {
    const filePath = join(this.archiveDir, conversationId, `${episodeId}.json`);
    if (!existsSync(filePath)) return null;

    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as ArchivedEpisode;
  }

  /**
   * List all archived episode IDs for a conversation.
   */
  listArchived(conversationId: string): string[] {
    const dir = join(this.archiveDir, conversationId);
    if (!existsSync(dir)) return [];

    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
  }
}
