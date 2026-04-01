import type { ResolvedAgent } from '../config/schema.js';
import { loadIdentityFiles, type IdentityContent } from './identity.js';
import type { MemoryStore, MemoryEntry } from './store.js';

export interface Brain {
  agentName: string;
  identity: IdentityContent;
  memoryStore: MemoryStore | undefined;
  reload(agent: ResolvedAgent, baseDir: string): void;
  getSystemPromptSections(): string[];
  search(query: string, limit?: number): MemoryEntry[];
  remember(key: string, content: string): void;
}

export function createBrain(
  agent: ResolvedAgent,
  baseDir: string,
  memoryStore?: MemoryStore,
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
      return memoryStore.search(agent.name, query, limit);
    },

    remember(key: string, content: string): void {
      if (!memoryStore) return;
      memoryStore.write(agent.name, key, content);
    },
  };

  return brain;
}
