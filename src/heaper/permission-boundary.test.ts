import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from './memory.js';
import { decideHeapPermission } from './permissions.js';
import { mutateHumanHeap } from './human-proposals.js';

describe('permission policy adapter boundary', () => {
  const mira = { kind: 'agent' as const, name: 'mira', persona: 'mira' };

  it('documents that the local memory adapter is storage-only and does not enforce heap write policy', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'raw' });

    const rawWrite = await memory.createBlock({
      heap: 'human/jan',
      type: 'text',
      data: { content: 'adapter writes whatever the caller asks it to write' },
      tags: ['raw-adapter-write'],
    });

    expect(rawWrite).toMatchObject({ heap: 'human/jan', id: 'raw-1' });
    expect(decideHeapPermission({ actor: mira, heap: 'human/jan', action: 'write' })).toBe('ask');
  });

  it('keeps the human heap mutation policy above the adapter through the proposal flow', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'policy' });

    const result = await mutateHumanHeap({
      memory,
      actor: mira,
      mutation: 'create',
      targetHeap: 'human/jan',
      blockType: 'text',
      create: { data: { content: 'needs Jan approval before archive write' }, tags: ['archive'] },
      originRef: { heap: 'agent/tasks', id: 'task-approval' },
    });

    expect(result.action).toBe('proposed');
    if (result.action !== 'proposed') throw new Error('expected proposed');
    expect(result.proposal).toMatchObject({
      heap: 'agent/proposals',
      type: 'proposal',
      tags: expect.arrayContaining(['proposal', 'human-heap-write', 'target:human/jan']),
      data: { reason: 'human-heap-mutation-requires-approval', targetHeap: 'human/jan' },
    });
    await expect(memory.search('needs Jan approval before archive write', { heaps: ['human/jan'] })).resolves.toEqual([]);
  });

  it('allows agent and persona heap writes at the policy layer while human writes require approval or bot-editable', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'policy' });

    expect(decideHeapPermission({ actor: mira, heap: 'agent/tasks', action: 'write' })).toBe('allow');
    expect(decideHeapPermission({ actor: mira, heap: 'persona/mira/memory', action: 'write' })).toBe('allow');
    expect(decideHeapPermission({ actor: mira, heap: 'human/jan', action: 'write' })).toBe('ask');
    expect(decideHeapPermission({ actor: mira, heap: 'human/jan', action: 'write', explicitApproval: true })).toBe('allow');
    expect(decideHeapPermission({ actor: mira, heap: 'human/jan', action: 'update', tags: ['bot-editable'] })).toBe('allow');

    await expect(memory.createBlock({ heap: 'agent/tasks', type: 'task', data: { title: 'agent owned' }, tags: ['task'] })).resolves.toMatchObject({ heap: 'agent/tasks' });
    await expect(memory.createBlock({ heap: 'persona/mira/memory', type: 'text', data: { content: 'persona owned' }, tags: ['memory'] })).resolves.toMatchObject({ heap: 'persona/mira/memory' });
  });
});
