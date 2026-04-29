import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MasterConfigSchema } from '../config/schema.js';
import { HeaperClientMemory } from '../heaper/heaper-client.js';
import { createRuntimeMemory } from './memory-config.js';

describe('createRuntimeMemory', () => {
  it('selects in-memory runtime storage by default', async () => {
    const selection = createRuntimeMemory({ baseDir: process.cwd(), now: () => '2026-04-28T07:00:00.000Z' });

    expect(selection.kind).toBe('memory');
    expect(selection.path).toBeUndefined();
    const block = await selection.memory.createBlock({ heap: 'agent/runtime', type: 'text', data: { body: 'ephemeral' } });
    expect(block.id).toBe('runtime-1');
  });

  it('selects local durable runtime storage from config and creates missing paths safely', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-core-runtime-memory-'));
    const config = MasterConfigSchema.parse({
      runtime_memory: { kind: 'local', path: 'runtime/heaper.json', id_prefix: 'cfg' },
    });

    const first = createRuntimeMemory({ baseDir: dir, config: config.runtime_memory, now: () => '2026-04-28T07:01:00.000Z' });
    const block = await first.memory.createBlock({ heap: 'agent/runtime', type: 'text', data: { body: 'durable' }, tags: ['runtime'] });
    expect(first).toMatchObject({ kind: 'local', path: join(dir, 'runtime/heaper.json') });

    const second = createRuntimeMemory({ baseDir: dir, config: config.runtime_memory });
    await expect(second.memory.getBlock({ heap: block.heap, id: block.id })).resolves.toMatchObject({ data: { body: 'durable' } });
    const raw = await readFile(first.path!, 'utf8');
    expect(raw).toContain('durable');
  });

  it('loads existing local storage without destructive migration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-core-runtime-memory-existing-'));
    const config = { kind: 'local' as const, path: 'runtime/heaper.json', id_prefix: 'cfg' };
    const first = createRuntimeMemory({ baseDir: dir, config });
    const block = await first.memory.createBlock({ heap: 'agent/runtime', type: 'metadata', data: { marker: 'keep' } });
    const before = await readFile(first.path!, 'utf8');

    const second = createRuntimeMemory({ baseDir: dir, config });
    await second.memory.search('', { heaps: ['agent/runtime'] });
    const afterReadOnlyLoad = await readFile(second.path!, 'utf8');

    expect(afterReadOnlyLoad).toBe(before);
    await expect(second.memory.getBlock({ heap: block.heap, id: block.id })).resolves.toMatchObject({ data: { marker: 'keep' } });
  });

  it('keeps the future Heaper adapter behind an explicit feature flag', () => {
    const config = MasterConfigSchema.parse({
      runtime_memory: { kind: 'heaper', heaper_endpoint: 'https://heaper.example.test' },
    });

    expect(() => createRuntimeMemory({ baseDir: process.cwd(), config: config.runtime_memory })).toThrow(
      'runtime_memory.kind=heaper requires heaper_enabled=true',
    );
  });

  it('can construct the Heaper adapter skeleton but operations fail closed', async () => {
    const config = MasterConfigSchema.parse({
      runtime_memory: {
        kind: 'heaper',
        heaper_enabled: true,
        heaper_endpoint: 'https://heaper.example.test',
        heaper_namespace: 'agent-core-dev',
        heaper_api_key_env: 'HEAPER_API_KEY',
      },
    });

    const selection = createRuntimeMemory({ baseDir: process.cwd(), config: config.runtime_memory });

    expect(selection.kind).toBe('heaper');
    expect(selection.path).toBeUndefined();
    expect(selection.memory).toBeInstanceOf(HeaperClientMemory);
    await expect(selection.memory.search('', { heaps: ['agent/runtime'] })).rejects.toThrow(
      'HeaperClientMemory.search is not implemented',
    );
  });
});
