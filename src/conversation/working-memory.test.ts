import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import type { HeaperBlock, SearchFilters, SemanticSliceOptions } from '../heaper/types.js';
import type { Message } from '../llm/types.js';
import { selectWorkingMemory } from './working-memory.js';

function msg(role: Message['role'], content: string, timestamp?: string): Message {
  return { role, content, timestamp };
}

describe('selectWorkingMemory', () => {
  it('preserves recent messages in chronological order', async () => {
    const memory = new InMemoryHeaperMemory();
    const history = [
      msg('user', 'one'),
      msg('assistant', 'two'),
      msg('user', 'three'),
      msg('assistant', 'four'),
    ];

    const bundle = await selectWorkingMemory({ memory, history, recentMessageLimit: 3 });

    expect(bundle.recentMessages.map((message) => message.content)).toEqual(['two', 'three', 'four']);
    expect(bundle.text).toContain('- assistant: two');
    expect(bundle.text).toContain('- user: three');
    expect(bundle.text).toContain('- assistant: four');
  });

  it('retrieves relevant blocks and deduplicates by block ref', async () => {
    const base = new InMemoryHeaperMemory({ idPrefix: 'mem', now: () => '2026-04-27T06:00:00.000Z' });
    const block = await base.createBlock({
      heap: 'agent/memory',
      type: 'text',
      data: { content: 'router planning decision details' },
      tags: ['router'],
    });
    const memory = {
      ...base,
      semanticSlice: async (_options: SemanticSliceOptions): Promise<HeaperBlock[]> => [block, block],
      search: (query: string, filters?: SearchFilters) => base.search(query, filters),
      getBlock: base.getBlock.bind(base),
      createBlock: base.createBlock.bind(base),
      updateBlock: base.updateBlock.bind(base),
      linkBlocks: base.linkBlocks.bind(base),
      getDailyEntry: base.getDailyEntry.bind(base),
      appendToDailyEntry: base.appendToDailyEntry.bind(base),
      getRelatedBlocks: base.getRelatedBlocks.bind(base),
    };

    const bundle = await selectWorkingMemory({
      memory,
      history: [msg('user', 'router planning')],
      heaps: ['agent/memory'],
    });

    expect(bundle.retrievedBlocks).toEqual([
      {
        ref: { heap: 'agent/memory', id: 'mem-1' },
        type: 'text',
        tags: ['router'],
        preview: 'router planning decision details',
        updatedAt: '2026-04-27T06:00:00.000Z',
      },
    ]);
    expect(bundle.text).toContain('agent/memory#mem-1');
  });

  it('applies deterministic message, block, and bundle size limits', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'mem' });
    await memory.createBlock({
      heap: 'agent/memory',
      type: 'text',
      data: { content: 'b'.repeat(80) },
      tags: ['long'],
    });

    const bundle = await selectWorkingMemory({
      memory,
      history: [msg('user', 'a'.repeat(80))],
      query: 'bbbb',
      maxMessageChars: 12,
      maxBlockPreviewChars: 10,
      maxChars: 120,
    });

    expect(bundle.text).toContain('aaaaaaaaaaa…');
    expect(bundle.retrievedBlocks[0].preview).toBe('bbbbbbbbb…');
    expect(bundle.text.length).toBeLessThanOrEqual(120);
    expect(bundle.stats.truncated).toBe(true);
    expect(bundle.stats.chars).toBe(bundle.text.length);
  });

  it('uses recent conversation text as the retrieval query when no query is provided', async () => {
    const memory = new InMemoryHeaperMemory();
    await memory.createBlock({
      heap: 'agent/memory',
      type: 'metadata',
      data: { content: 'continuity reader notes' },
      tags: ['continuity'],
    });

    const bundle = await selectWorkingMemory({
      memory,
      history: [msg('system', 'ignore me'), msg('user', 'continuity reader')],
    });

    expect(bundle.retrievedBlocks).toHaveLength(1);
    expect(bundle.retrievedBlocks[0].tags).toContain('continuity');
  });
});
