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
  let identity = loadIdentityFiles(agent.personality, agent.knowsAbout, baseDir);
  let systemPrompt = agent.systemPrompt;

  const brain: Brain = {
    agentName: agent.name,
    identity,
    memoryStore,

    reload(updated: ResolvedAgent, updatedBaseDir: string) {
      identity = loadIdentityFiles(updated.personality, updated.knowsAbout, updatedBaseDir);
      systemPrompt = updated.systemPrompt;
      brain.identity = identity;
    },

    getSystemPromptSections(): string[] {
      const sections: string[] = [];
      if (identity.personality) sections.push(identity.personality);
      for (const content of identity.knowsAbout) sections.push(content);
      if (systemPrompt) sections.push(systemPrompt);
      return sections;
    },

    search(query: string, limit = 10): MemoryEntry[] {
      if (!memoryStore) return [];
      if (embedder) {
        // Fire-and-forget async with sync fallback
        // For sync interface, use FTS as baseline — caller can use searchAsync for hybrid
        return memoryStore.search(agent.name, query, limit);
      }
      return memoryStore.search(agent.name, query, limit);
    },

    async searchAsync(query: string, limit = 10): Promise<MemoryEntry[]> {
      if (!memoryStore) return [];
      if (embedder) {
        try {
          const queryEmbedding = await embedder.embed(query);
          return memoryStore.hybridSearch(agent.name, query, queryEmbedding, limit);
        } catch {
          // Fall back to FTS-only if embedding fails
          return memoryStore.search(agent.name, query, limit);
        }
      }
      return memoryStore.search(agent.name, query, limit);
    },

    remember(key: string, content: string): void {
      if (!memoryStore) return;
      if (embedder) {
        // Embed in background, write immediately with FTS
        embedder.embed(content).then((embedding) => {
          memoryStore.writeWithEmbedding(agent.name, key, content, embedding);
        }).catch(() => {
          // Embedding failed, but text is already written via writeWithEmbedding's call to write()
          memoryStore.write(agent.name, key, content);
        });
        return;
      }
      memoryStore.write(agent.name, key, content);
    },
  };

  return brain;
}
