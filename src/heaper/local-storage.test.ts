import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalHeaperMemory } from './local-storage.js';

async function tempStorePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-core-local-heaper-'));
  return join(dir, 'memory.json');
}

describe('LocalHeaperMemory', () => {
  it('persists blocks across process-style adapter restarts', async () => {
    const filePath = await tempStorePath();
    const first = new LocalHeaperMemory({ filePath, idPrefix: 'disk', now: () => '2026-04-28T00:00:00.000Z' });

    const block = await first.createBlock({
      heap: 'agent/memory',
      type: 'text',
      data: { content: 'persistent hello' },
      tags: ['note'],
    });

    const second = new LocalHeaperMemory({ filePath, idPrefix: 'disk', now: () => '2026-04-28T00:01:00.000Z' });
    await expect(second.getBlock({ heap: block.heap, id: block.id })).resolves.toMatchObject({
      id: 'disk-1',
      heap: 'agent/memory',
      data: { content: 'persistent hello' },
      createdAt: '2026-04-28T00:00:00.000Z',
    });

    const next = await second.createBlock({ heap: 'agent/memory', type: 'metadata', data: { content: 'next' } });
    expect(next.id).toBe('disk-2');
  });

  it('round-trips links and daily entries after restart', async () => {
    const filePath = await tempStorePath();
    const first = new LocalHeaperMemory({ filePath, idPrefix: 'disk', now: () => '2026-04-28T00:02:00.000Z' });

    const a = await first.createBlock({ heap: 'agent/tasks', type: 'task', data: { title: 'origin' }, tags: ['task'] });
    const b = await first.createBlock({ heap: 'agent/results', type: 'text', data: { content: 'result' }, tags: ['result'] });
    await first.linkBlocks({ heap: a.heap, id: a.id }, { heap: b.heap, id: b.id });
    await first.appendToDailyEntry('first line', 'agent/daily', '2026-04-28');
    await first.appendToDailyEntry('second line', 'agent/daily', '2026-04-28');

    const second = new LocalHeaperMemory({ filePath, idPrefix: 'disk' });
    await expect(second.getRelatedBlocks({ heap: a.heap, id: a.id })).resolves.toEqual([
      expect.objectContaining({ id: b.id, heap: b.heap }),
    ]);
    await expect(second.getDailyEntry('2026-04-28', 'agent/daily')).resolves.toMatchObject({
      type: 'daily-entry',
      data: { date: '2026-04-28', content: 'first line\nsecond line' },
    });
  });

  it('matches in-memory search filter semantics for heap tags types limits and semantic slices', async () => {
    const filePath = await tempStorePath();
    const memory = new LocalHeaperMemory({ filePath, idPrefix: 'disk', now: () => '2026-04-28T00:03:00.000Z' });

    await memory.createBlock({ heap: 'agent/memory', type: 'text', data: { content: 'alpha beta' }, tags: ['keep', 'topic:a'] });
    await memory.createBlock({ heap: 'agent/memory', type: 'metadata', data: { content: 'alpha meta' }, tags: ['keep', 'topic:b'] });
    await memory.createBlock({ heap: 'persona/mira/memory', type: 'text', data: { content: 'alpha private' }, tags: ['keep', 'topic:a'] });

    const textHits = await memory.search('alpha', { heaps: ['agent/memory'], types: ['text'], tags: ['keep'], limit: 1 });
    expect(textHits).toHaveLength(1);
    expect(textHits[0]).toMatchObject({ heap: 'agent/memory', type: 'text', data: { content: 'alpha beta' } });

    const semanticHits = await memory.semanticSlice({ query: 'private', heaps: ['persona/mira/memory'], tags: ['topic:a'] });
    expect(semanticHits).toHaveLength(1);
    expect(semanticHits[0].data.content).toBe('alpha private');
  });

  it('creates storage files without destructive migration of existing data', async () => {
    const filePath = await tempStorePath();
    const first = new LocalHeaperMemory({ filePath, idPrefix: 'disk' });
    const block = await first.createBlock({ heap: 'agent/memory', type: 'text', data: { content: 'keep me' } });
    const rawBefore = await readFile(filePath, 'utf8');

    const second = new LocalHeaperMemory({ filePath, idPrefix: 'disk' });
    await second.search('', { heaps: ['agent/memory'] });
    const rawAfterReadOnlyLoad = await readFile(filePath, 'utf8');

    expect(rawAfterReadOnlyLoad).toBe(rawBefore);
    await expect(second.getBlock({ heap: block.heap, id: block.id })).resolves.toMatchObject({ data: { content: 'keep me' } });
  });
});
