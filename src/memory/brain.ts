import type { ResolvedAgent } from '../config/schema.js';
import type { EmbeddingProvider } from './embeddings.js';
import { loadIdentityFiles, type IdentityContent } from './identity.js';
import type { MemoryStore, MemoryEntry } from './store.js';

export interface Brain {
  agentName: string;
  identity: IdentityContent;
  memoryStore: MemoryStore | undefined;
  reload(agent: ResolvedAgent, baseDir: string): void;
  getSystemPromptSections(): string[];
  search(query: string, limit?: number): MemoryEntry[];
  searchAsync(query: string, limit?: number): Promise<MemoryEntry[]>;
  remember(key: string, content: string): void;
}

export function createBrain(
  agent: ResolvedAgent,
  baseDir: string,
  memoryStore?: MemoryStore,
  embedder?: EmbeddingProvider,
): Brain {
  // Store config so we can re-read from disk on each turn
  let personality = agent.personality;
  let knowsAbout = agent.knowsAbout;
  let systemPrompt = agent.systemPrompt;
  let identity = loadIdentityFiles(personality, knowsAbout, baseDir);

  const brain: Brain = {
    agentName: agent.name,
    identity,
    memoryStore,

    reload(updated: ResolvedAgent, updatedBaseDir: string) {
      personality = updated.personality;
      knowsAbout = updated.knowsAbout;
      systemPrompt = updated.systemPrompt;
      identity = loadIdentityFiles(personality, knowsAbout, updatedBaseDir);
      brain.identity = identity;
    },

    getSystemPromptSections(): string[] {
      // Re-read from disk each time so agent self-modifications take effect
      identity = loadIdentityFiles(personality, knowsAbout, baseDir);
      brain.identity = identity;

      const sections: string[] = [];
      if (identity.personality) sections.push(identity.personality);
      for (const content of identity.knowsAbout) sections.push(content);
      if (systemPrompt) sections.push(systemPrompt);
      return sections;
    },

    search(query: string, limit = 10): MemoryEntry[] {
      if (!memoryStore) return [];
      return memoryStore.search(agent.name, query, limit);
    },

    async searchAsync(query: string, limit = 10): Promise<MemoryEntry[]> {
      if (!memoryStore) return [];
      if (embedder) {
        try {
          const queryEmbedding = await embedder.embed(query);
          return memoryStore.hybridSearch(agent.name, query, queryEmbedding, limit);
        } catch {
          return memoryStore.search(agent.name, query, limit);
        }
      }
      return memoryStore.search(agent.name, query, limit);
    },

    remember(key: string, content: string): void {
      if (!memoryStore) return;
      if (embedder) {
        embedder.embed(content).then((embedding) => {
          memoryStore.writeWithEmbedding(agent.name, key, content, embedding);
        }).catch(() => {
          memoryStore.write(agent.name, key, content);
        });
        return;
      }
      memoryStore.write(agent.name, key, content);
    },
  };

  return brain;
}
