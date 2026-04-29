import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from './memory.js';
import { scanMemory } from './scan.js';

describe('scanMemory', () => {
  it('wraps broad searches in a bounded scan result with future cursor placeholder', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'scan' });
    await memory.createBlock({ heap: 'agent/tasks', type: 'task', data: { title: 'one' }, tags: ['task'] });
    await memory.createBlock({ heap: 'agent/tasks', type: 'task', data: { title: 'two' }, tags: ['task'] });
    await memory.createBlock({ heap: 'agent/audit', type: 'metadata', data: { title: 'audit' }, tags: ['audit'] });

    const bounded = await scanMemory({ memory, filters: { types: ['task'] }, maxResults: 1 });

    expect(bounded).toMatchObject({ limit: 1, exhausted: false, nextCursor: 'cursor-unavailable' });
    expect(bounded.blocks).toHaveLength(1);

    const complete = await scanMemory({ memory, filters: { types: ['task'] }, maxResults: 10 });
    expect(complete).toMatchObject({ limit: 10, exhausted: true, nextCursor: undefined });
    expect(complete.blocks).toHaveLength(2);
  });

  it('rejects unsafe unbounded or invalid limits', async () => {
    const memory = new InMemoryHeaperMemory();
    await expect(scanMemory({ memory, maxResults: Number.POSITIVE_INFINITY })).rejects.toThrow('Invalid memory scan limit');
    await expect(scanMemory({ memory, maxResults: 0 })).rejects.toThrow('Invalid memory scan limit');
  });
});
