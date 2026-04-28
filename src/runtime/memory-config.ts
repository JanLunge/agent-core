import { resolve } from 'node:path';
import type { MasterConfig } from '../config/schema.js';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import { LocalHeaperMemory } from '../heaper/local-storage.js';
import type { HeaperMemory } from '../heaper/types.js';

export type RuntimeMemoryKind = 'memory' | 'local';

export interface RuntimeMemorySelection {
  kind: RuntimeMemoryKind;
  memory: HeaperMemory;
  path?: string;
}

export interface CreateRuntimeMemoryInput {
  baseDir: string;
  config?: MasterConfig['runtime_memory'];
  now?: () => string;
}

export function createRuntimeMemory(input: CreateRuntimeMemoryInput): RuntimeMemorySelection {
  const config = input.config ?? { kind: 'memory' as const };
  const idPrefix = config.id_prefix ?? 'runtime';

  if (config.kind === 'local') {
    const path = resolve(input.baseDir, config.path ?? './data/heaper-memory.json');
    return {
      kind: 'local',
      path,
      memory: new LocalHeaperMemory({ filePath: path, idPrefix, now: input.now }),
    };
  }

  return {
    kind: 'memory',
    memory: new InMemoryHeaperMemory({ idPrefix, now: input.now }),
  };
}
