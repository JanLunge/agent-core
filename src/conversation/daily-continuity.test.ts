import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import { readDailyContinuity } from './daily-continuity.js';
import { createSessionSummaryBlock } from './session-summary.js';
import type { ConversationRow, MessageWithMeta } from './persistence.js';

function conversation(id: string): ConversationRow {
  return {
    id,
    agent_name: 'mira',
    channel_id: 'telegram:jan',
    status: 'active',
    focus: null,
    created_at: '2026-04-26T10:00:00.000Z',
    updated_at: '2026-04-26T10:05:00.000Z',
  };
}

function message(content: string): MessageWithMeta {
  return { id: 1, role: 'user', content, timestamp: '2026-04-26T10:00:00.000Z' };
}

describe('readDailyContinuity', () => {
  it('returns an empty context object for empty days', async () => {
    const memory = new InMemoryHeaperMemory();

    await expect(readDailyContinuity({ memory, heap: 'agent/daily', today: '2026-04-27' })).resolves.toEqual({
      heap: 'agent/daily',
      dates: ['2026-04-26', '2026-04-27'],
      entries: [],
      text: '',
    });
  });

  it('returns yesterday before today predictably', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'daily' });
    await memory.appendToDailyEntry('today note', 'agent/daily', '2026-04-27');
    await memory.appendToDailyEntry('yesterday note', 'agent/daily', '2026-04-26');

    const context = await readDailyContinuity({ memory, heap: 'agent/daily', today: '2026-04-27' });

    expect(context.entries.map((entry) => entry.date)).toEqual(['2026-04-26', '2026-04-27']);
    expect(context.text).toBe('## 2026-04-26\nyesterday note\n\n## 2026-04-27\ntoday note');
  });

  it('includes linked session summaries by reference', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block', now: () => '2026-04-27T05:00:00.000Z' });
    const result = await createSessionSummaryBlock({
      memory,
      heap: 'agent/sessions',
      dailyHeap: 'agent/daily',
      date: '2026-04-27',
      conversation: conversation('c-1'),
      messages: [message('continue the router work')],
      summary: 'Router work continued.',
    });

    const context = await readDailyContinuity({ memory, heap: 'agent/daily', today: '2026-04-27' });

    expect(context.entries).toHaveLength(1);
    expect(context.entries[0].linkedSessionSummaries).toEqual([
      { heap: result.summaryBlock.heap, id: result.summaryBlock.id },
    ]);
    expect(context.text).toContain(`Linked session summaries: ${result.summaryBlock.heap}#${result.summaryBlock.id}`);
  });

  it('bounds entry content and rendered startup text', async () => {
    const memory = new InMemoryHeaperMemory();
    await memory.appendToDailyEntry('a'.repeat(50), 'agent/daily', '2026-04-26');
    await memory.appendToDailyEntry('b'.repeat(50), 'agent/daily', '2026-04-27');

    const context = await readDailyContinuity({
      memory,
      heap: 'agent/daily',
      today: '2026-04-27',
      maxEntryChars: 10,
      maxTextChars: 35,
    });

    expect(context.entries.map((entry) => entry.content)).toEqual(['aaaaaaaaa…', 'bbbbbbbbb…']);
    expect(context.text).toHaveLength(35);
    expect(context.text.endsWith('…')).toBe(true);
  });
});
