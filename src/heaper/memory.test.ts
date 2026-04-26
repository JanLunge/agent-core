import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from './memory.js';

function clock(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)];
}

describe('InMemoryHeaperMemory', () => {
  it('creates, gets, updates, and clones blocks by heap-scoped ref', async () => {
    const memory = new InMemoryHeaperMemory({
      idPrefix: 'test',
      now: clock('2026-04-27T00:00:00.000Z', '2026-04-27T00:01:00.000Z'),
    });

    const created = await memory.createBlock({
      heap: 'agent/core',
      type: 'text',
      data: { title: 'Router note', body: 'route live chat to Mira' },
      tags: ['router'],
    });

    expect(created).toMatchObject({
      id: 'test-1',
      heap: 'agent/core',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
    });

    created.data.body = 'mutated outside store';
    expect((await memory.getBlock(created))?.data.body).toBe('route live chat to Mira');

    const updated = await memory.updateBlock(created, {
      data: { body: 'route live chat to existing session' },
      metadata: { source: 'test' },
    });

    expect(updated.data).toEqual({ title: 'Router note', body: 'route live chat to existing session' });
    expect(updated.metadata).toEqual({ source: 'test' });
    expect(updated.updatedAt).toBe('2026-04-27T00:01:00.000Z');
  });

  it('searches text with heap, tag, type, time, and limit filters', async () => {
    const memory = new InMemoryHeaperMemory({
      now: clock(
        '2026-04-27T00:00:00.000Z',
        '2026-04-27T00:01:00.000Z',
        '2026-04-27T00:02:00.000Z',
      ),
    });

    await memory.createBlock({ heap: 'agent/core', type: 'text', data: { body: 'router decision' }, tags: ['router'] });
    await memory.createBlock({ heap: 'persona/mira/memory', type: 'text', data: { body: 'router feeling' }, tags: ['persona'] });
    await memory.createBlock({ heap: 'agent/core', type: 'task', data: { body: 'memory task' }, tags: ['router'] });

    const results = await memory.search('router', {
      heaps: ['agent/core'],
      tags: ['router'],
      types: ['text'],
      timeRange: { from: '2026-04-27T00:00:30.000Z' },
      limit: 1,
    });

    expect(results).toHaveLength(0);

    const wider = await memory.search('router', { heaps: ['agent/core'], tags: ['router'], limit: 2 });
    expect(wider.map((block) => block.type)).toEqual(['task', 'text']);
  });

  it('links blocks bidirectionally and returns related blocks', async () => {
    const memory = new InMemoryHeaperMemory();
    const origin = await memory.createBlock({ heap: 'agent/core', type: 'task', data: { title: 'Implement memory' } });
    const result = await memory.createBlock({ heap: 'agent/core', type: 'text', data: { title: 'Result note' } });

    await memory.linkBlocks(origin, result);
    await memory.linkBlocks(origin, result);

    expect((await memory.getBlock(origin))?.links).toEqual([{ heap: result.heap, id: result.id }]);
    expect((await memory.getRelatedBlocks(origin)).map((block) => block.id)).toEqual([result.id]);
    expect((await memory.getRelatedBlocks(result)).map((block) => block.id)).toEqual([origin.id]);
  });

  it('creates and appends to daily entries in a heap', async () => {
    const memory = new InMemoryHeaperMemory({ now: () => '2026-04-27T12:00:00.000Z' });

    const first = await memory.appendToDailyEntry('Started router work', 'persona/mira/daily');
    const second = await memory.appendToDailyEntry('Kept note file quiet', 'persona/mira/daily');

    expect(first.id).toBe(second.id);
    expect(second.type).toBe('daily-entry');
    expect(second.data).toEqual({ date: '2026-04-27', content: 'Started router work\nKept note file quiet' });
    expect((await memory.getDailyEntry('2026-04-27', 'persona/mira/daily'))?.id).toBe(first.id);
  });

  it('uses semanticSlice as the Heaper-shaped search alias for now', async () => {
    const memory = new InMemoryHeaperMemory();
    await memory.createBlock({ heap: 'agent/core', type: 'text', data: { body: 'bounded tool output' }, tags: ['tools'] });

    await expect(memory.semanticSlice({ query: 'tool', tags: ['tools'] })).resolves.toHaveLength(1);
  });
});
