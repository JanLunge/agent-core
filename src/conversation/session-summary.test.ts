import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import { ConversationStore } from './persistence.js';
import { createSessionSummaryBlock, summarizeStoredConversationToMemory } from './session-summary.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('session summary Heaper bridge', () => {
  it('creates a session summary block linked to the daily entry', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'summary', now: () => '2026-04-27T00:00:00.000Z' });
    const result = await createSessionSummaryBlock({
      memory,
      heap: 'persona/mira/sessions',
      dailyHeap: 'persona/mira/daily',
      date: '2026-04-27',
      conversation: {
        id: 'c-1',
        agent_name: 'mira',
        channel_id: 'signal:jan',
        created_at: '2026-04-27T00:00:00.000Z',
        updated_at: '2026-04-27T00:02:00.000Z',
        status: 'active',
        focus: 'agent-core',
      },
      messages: [
        { id: 1, role: 'user', content: 'Please work on session summaries.', timestamp: '2026-04-27T00:01:00.000Z' },
        { id: 2, role: 'assistant', content: 'I will keep the slice small.', timestamp: '2026-04-27T00:02:00.000Z' },
      ],
    });

    expect(result.summaryBlock).toMatchObject({
      heap: 'persona/mira/sessions',
      type: 'session',
      tags: ['session-summary', 'conversation:c-1', 'agent:mira', 'channel:signal:jan'],
      data: {
        conversationId: 'c-1',
        agentName: 'mira',
        channelId: 'signal:jan',
        focus: 'agent-core',
        messageCount: 2,
        lastMessageRole: 'assistant',
        lastMessagePreview: 'I will keep the slice small.',
      },
    });

    expect(result.dailyEntry.data.content).toContain('Session c-1: mira conversation with 2 messages');
    await expect(memory.getRelatedBlocks(result.dailyEntry)).resolves.toMatchObject([
      { id: result.summaryBlock.id, heap: result.summaryBlock.heap },
    ]);
  });

  it('summarizes an existing ConversationStore conversation into memory', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agent-core-session-summary-'));
    tempDirs.push(dataDir);

    const store = new ConversationStore(dataDir);
    const memory = new InMemoryHeaperMemory({ idPrefix: 'stored', now: () => '2026-04-27T01:00:00.000Z' });

    store.createConversation('c-2', 'mira', 'telegram:jan');
    store.appendMessage('c-2', { role: 'user', content: 'Can you continue the agent-core roadmap?' });
    store.appendMessage('c-2', { role: 'assistant', content: 'Yes, I will start with Slice 1.' });

    const result = await summarizeStoredConversationToMemory({
      source: store,
      memory,
      conversationId: 'c-2',
      heap: 'agent/sessions',
      date: '2026-04-27',
      summary: 'Slice 1 session summary bridge implemented.',
    });

    expect(result.summaryBlock.data).toMatchObject({
      conversationId: 'c-2',
      agentName: 'mira',
      channelId: 'telegram:jan',
      messageCount: 2,
      summary: 'Slice 1 session summary bridge implemented.',
    });
    expect((await memory.getDailyEntry('2026-04-27', 'agent/sessions'))?.id).toBe(result.dailyEntry.id);
    expect((await memory.getRelatedBlocks(result.dailyEntry)).map((block) => block.id)).toEqual([result.summaryBlock.id]);

    store.close();
  });

  it('fails clearly if the stored conversation does not exist', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agent-core-session-summary-'));
    tempDirs.push(dataDir);

    const store = new ConversationStore(dataDir);
    const memory = new InMemoryHeaperMemory();

    await expect(
      summarizeStoredConversationToMemory({
        source: store,
        memory,
        conversationId: 'missing',
        heap: 'agent/sessions',
      }),
    ).rejects.toThrow('Conversation not found: missing');

    store.close();
  });
});
