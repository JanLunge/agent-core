import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from './memory.js';
import {
  canExposePersonaConfigToPersona,
  loadPersonaConfig,
  personaConfigToModelDefaults,
  readableHeapsForPersonaConfig,
} from './persona-config.js';

describe('persona config loader', () => {
  it('loads persona metadata from Heaper blocks with heaps and model preferences', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    await memory.createBlock({
      heap: 'agent/personas',
      type: 'metadata',
      data: {
        id: 'mira',
        name: 'Mira',
        description: 'Primary assistant persona',
        heaps: { memory: 'persona/mira/memory', shared: ['agent/shared', 'agent/workflows'] },
        modelDefaults: { defaultModel: 'gpt-5.5', strongModel: 'gpt-5.5', localModel: 'llama-local' },
        tags: ['Primary', 'Warm'],
      },
      tags: ['persona-config', 'persona:mira'],
    });

    const config = await loadPersonaConfig({ persona: 'Mira', memory, heap: 'agent/personas' });

    expect(config).toMatchObject({
      id: 'mira',
      name: 'Mira',
      description: 'Primary assistant persona',
      source: 'heaper',
      privateConfig: true,
      defaultHeaps: {
        memory: 'persona/mira/memory',
        sessions: 'persona/mira/sessions',
        daily: 'persona/mira/daily',
        toolOutput: 'persona/mira/tool-output',
        tasks: 'persona/mira/tasks',
        shared: ['agent/shared', 'agent/workflows'],
      },
      modelDefaults: { defaultModel: 'gpt-5.5', strongModel: 'gpt-5.5', localModel: 'llama-local' },
      tags: ['primary', 'warm'],
    });
    expect(personaConfigToModelDefaults(config)).toEqual({
      mira: { defaultModel: 'gpt-5.5', strongModel: 'gpt-5.5', localModel: 'llama-local' },
    });
  });

  it('loads YAML frontmatter local persona config files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-core-persona-config-'));
    const filePath = join(dir, 'agent.md');
    await writeFile(filePath, `---\nid: mira\nname: Mira\nprivateConfig: false\nheaps:\n  shared:\n    - agent/shared\nmodelDefaults:\n  defaultModel: gpt-5.5\n---\n# Mira\n`, 'utf8');

    const config = await loadPersonaConfig({ persona: 'mira', filePath });

    expect(config.source).toBe('file');
    expect(config.privateConfig).toBe(false);
    expect(config.defaultHeaps.memory).toBe('persona/mira/memory');
    expect(config.modelDefaults?.defaultModel).toBe('gpt-5.5');
  });

  it('fails closed with useful diagnostics for invalid config', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    await memory.createBlock({
      heap: 'agent/personas',
      type: 'metadata',
      data: { id: 'other', name: 'Other' },
      tags: ['persona-config', 'persona:mira'],
    });

    await expect(loadPersonaConfig({ persona: 'mira', memory, heap: 'agent/personas' })).rejects.toThrow(
      'Persona config id mismatch: expected mira, got other',
    );
  });

  it('does not expose private persona config to other personas by default', async () => {
    const privateConfig = await loadPersonaConfig({ persona: 'mira' });
    expect(canExposePersonaConfigToPersona(privateConfig, 'mira')).toBe(true);
    expect(canExposePersonaConfigToPersona(privateConfig, 'other')).toBe(false);

    const dir = await mkdtemp(join(tmpdir(), 'agent-core-persona-config-public-'));
    const filePath = join(dir, 'agent.md');
    await writeFile(filePath, 'id: mira\nname: Mira\nprivateConfig: false\n', 'utf8');
    const publicConfig = await loadPersonaConfig({ persona: 'mira', filePath });
    expect(canExposePersonaConfigToPersona(publicConfig, 'other')).toBe(true);
  });

  it('returns readable heaps for router/context use without leaking other persona heaps', async () => {
    const config = await loadPersonaConfig({ persona: 'Mira' });

    expect(readableHeapsForPersonaConfig(config)).toEqual([
      'persona/mira/memory',
      'persona/mira/sessions',
      'persona/mira/daily',
      'persona/mira/tool-output',
      'persona/mira/tasks',
      'agent/shared',
    ]);
  });
});
