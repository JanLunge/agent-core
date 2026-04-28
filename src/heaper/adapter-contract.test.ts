import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BlockRef, HeaperMemory } from './types.js';
import { InMemoryHeaperMemory } from './memory.js';
import { LocalHeaperMemory } from './local-storage.js';

interface HeaperMemoryContractAdapter {
  name: string;
  create(): Promise<HeaperMemory> | HeaperMemory;
  reopen?(memory: HeaperMemory): Promise<HeaperMemory> | HeaperMemory;
}

function clock(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)];
}

/**
 * Shared conformance suite for every HeaperMemory implementation.
 *
 * Future real-Heaper adapters should import this helper and pass an adapter
 * factory instead of copying individual fixture tests.
 */
export function describeHeaperMemoryContract(adapter: HeaperMemoryContractAdapter): void {
  describe(`${adapter.name} HeaperMemory contract`, () => {
    it('creates gets updates and defensively clones blocks', async () => {
      const memory = await adapter.create();
      const created = await memory.createBlock({
        heap: 'agent/core',
        type: 'text',
        data: { title: 'Router note', body: 'route live chat to Mira' },
        tags: ['router'],
        metadata: { source: 'contract' },
      });

      expect(created).toMatchObject({ heap: 'agent/core', type: 'text', tags: ['router'] });
      created.data.body = 'mutated outside store';
      expect((await memory.getBlock(created))?.data.body).toBe('route live chat to Mira');

      const updated = await memory.updateBlock(created, {
        data: { body: 'route live chat to existing session' },
        tags: ['router', 'updated'],
        metadata: { reviewer: 'contract' },
      });

      expect(updated.data).toEqual({ title: 'Router note', body: 'route live chat to existing session' });
      expect(updated.tags).toEqual(['router', 'updated']);
      expect(updated.metadata).toEqual({ source: 'contract', reviewer: 'contract' });
    });

    it('searches with query heap tag type time and limit filters', async () => {
      const memory = await adapter.create();
      await memory.createBlock({ heap: 'agent/core', type: 'text', data: { body: 'router decision' }, tags: ['router'] });
      await memory.createBlock({ heap: 'persona/mira/memory', type: 'text', data: { body: 'router feeling' }, tags: ['persona'] });
      await memory.createBlock({ heap: 'agent/core', type: 'task', data: { body: 'memory task router' }, tags: ['router'] });

      await expect(memory.search('router', {
        heaps: ['agent/core'],
        tags: ['router'],
        types: ['text'],
        timeRange: { from: '2026-04-28T00:00:30.000Z' },
        limit: 1,
      })).resolves.toHaveLength(0);

      const wider = await memory.search('router', { heaps: ['agent/core'], tags: ['router'], limit: 2 });
      expect(wider.map((block) => block.type)).toEqual(['task', 'text']);
    });

    it('links blocks bidirectionally and deduplicates related refs', async () => {
      const memory = await adapter.create();
      const origin = await memory.createBlock({ heap: 'agent/tasks', type: 'task', data: { title: 'Implement memory' } });
      const result = await memory.createBlock({ heap: 'agent/results', type: 'text', data: { title: 'Result note' } });

      await memory.linkBlocks(origin, result);
      await memory.linkBlocks(origin, result);

      expect((await memory.getBlock(origin))?.links).toEqual([{ heap: result.heap, id: result.id }]);
      expect((await memory.getRelatedBlocks(origin)).map(refOf)).toEqual([{ heap: result.heap, id: result.id }]);
      expect((await memory.getRelatedBlocks(result)).map(refOf)).toEqual([{ heap: origin.heap, id: origin.id }]);
    });

    it('round-trips daily entries and semantic slices', async () => {
      const memory = await adapter.create();
      const first = await memory.appendToDailyEntry('Started router work', 'persona/mira/daily', '2026-04-28');
      const second = await memory.appendToDailyEntry('Kept note file quiet', 'persona/mira/daily', '2026-04-28');
      await memory.createBlock({ heap: 'agent/core', type: 'text', data: { body: 'bounded tool output' }, tags: ['tools'] });

      expect(first.id).toBe(second.id);
      expect(second.data).toEqual({ date: '2026-04-28', content: 'Started router work\nKept note file quiet' });
      expect((await memory.getDailyEntry('2026-04-28', 'persona/mira/daily'))?.id).toBe(first.id);
      await expect(memory.semanticSlice({ query: 'tool', tags: ['tools'] })).resolves.toHaveLength(1);
    });

    it('preserves permission-facing heap scopes and tags without coercion', async () => {
      const memory = await adapter.create();
      await memory.createBlock({ heap: 'human/archive', type: 'proposal', data: { title: 'human write proposal' }, tags: ['proposal', 'requires-approval'] });
      await memory.createBlock({ heap: 'agent/shared', type: 'text', data: { title: 'shared agent note' }, tags: ['shared'] });
      await memory.createBlock({ heap: 'persona/mira/memory', type: 'text', data: { title: 'private persona note' }, tags: ['private'] });

      expect((await memory.search('', { heaps: ['human/archive'], tags: ['requires-approval'] })).map((block) => block.heap)).toEqual(['human/archive']);
      expect((await memory.search('', { heaps: ['persona/mira/memory'], tags: ['private'] })).map((block) => block.heap)).toEqual(['persona/mira/memory']);
    });

    const reopen = adapter.reopen;
    if (reopen) {
      it('survives adapter restart with blocks links and daily entries intact', async () => {
        const memory = await adapter.create();
        const origin = await memory.createBlock({ heap: 'agent/tasks', type: 'task', data: { title: 'persist origin' } });
        const result = await memory.createBlock({ heap: 'agent/results', type: 'text', data: { title: 'persist result' } });
        await memory.linkBlocks(origin, result);
        await memory.appendToDailyEntry('persistent line', 'agent/daily', '2026-04-28');

        const reopened = await reopen(memory);

        await expect(reopened.getBlock(origin)).resolves.toMatchObject({ id: origin.id, data: { title: 'persist origin' } });
        expect((await reopened.getRelatedBlocks(origin)).map(refOf)).toEqual([{ heap: result.heap, id: result.id }]);
        await expect(reopened.getDailyEntry('2026-04-28', 'agent/daily')).resolves.toMatchObject({ data: { content: 'persistent line' } });
      });
    }
  });
}

function refOf(block: { heap: BlockRef['heap']; id: string }): BlockRef {
  return { heap: block.heap, id: block.id };
}

describeHeaperMemoryContract({
  name: 'InMemoryHeaperMemory',
  create: () => new InMemoryHeaperMemory({
    idPrefix: 'contract',
    now: clock(
      '2026-04-28T00:00:00.000Z',
      '2026-04-28T00:01:00.000Z',
      '2026-04-28T00:02:00.000Z',
      '2026-04-28T00:03:00.000Z',
      '2026-04-28T00:04:00.000Z',
      '2026-04-28T00:05:00.000Z',
    ),
  }),
});

const localContractPaths = new WeakMap<HeaperMemory, string>();

describeHeaperMemoryContract({
  name: 'LocalHeaperMemory',
  async create() {
    const dir = await mkdtemp(join(tmpdir(), 'agent-core-heaper-contract-'));
    const filePath = join(dir, 'memory.json');
    const memory = new LocalHeaperMemory({
      filePath,
      idPrefix: 'contract',
      now: clock(
        '2026-04-28T00:00:00.000Z',
        '2026-04-28T00:01:00.000Z',
        '2026-04-28T00:02:00.000Z',
        '2026-04-28T00:03:00.000Z',
        '2026-04-28T00:04:00.000Z',
        '2026-04-28T00:05:00.000Z',
      ),
    });
    localContractPaths.set(memory, filePath);
    return memory;
  },
  reopen(memory) {
    const filePath = localContractPaths.get(memory);
    if (!filePath) throw new Error('LocalHeaperMemory filePath unavailable for contract reopen');
    return new LocalHeaperMemory({ filePath, idPrefix: 'contract' });
  },
});
