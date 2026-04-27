import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from './memory.js';
import { mutateHumanHeap } from './human-proposals.js';

describe('human heap proposal flow', () => {
  it('turns unapproved agent-created human heap writes into proposal blocks', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const originRef = { heap: 'agent/tasks' as const, id: 'task-1' };

    const result = await mutateHumanHeap({
      memory,
      actor: { kind: 'agent', name: 'mira' },
      mutation: 'create',
      targetHeap: 'human/jan',
      blockType: 'text',
      create: { data: { content: 'Add this to Jan archive' }, tags: ['note'] },
      originRef,
    });

    expect(result.action).toBe('proposed');
    if (result.action !== 'proposed') throw new Error('expected proposal');
    expect(result.proposal).toMatchObject({
      heap: 'agent/proposals',
      type: 'proposal',
      tags: ['proposal', 'human-heap-write', 'actor:agent:mira', 'target:human/jan'],
      data: {
        status: 'pending',
        actor: { kind: 'agent', name: 'mira' },
        mutation: 'create',
        targetHeap: 'human/jan',
        blockType: 'text',
        create: { data: { content: 'Add this to Jan archive' }, tags: ['note'] },
        originRef,
        reason: 'human-heap-mutation-requires-approval',
      },
      links: [originRef],
    });
    await expect(memory.search('Add this to Jan archive', { heaps: ['human/jan'] })).resolves.toEqual([]);
  });

  it('applies explicitly approved creates directly to human heap', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'human' });

    const result = await mutateHumanHeap({
      memory,
      actor: { kind: 'agent', name: 'mira' },
      mutation: 'create',
      targetHeap: 'human/jan',
      blockType: 'text',
      create: { data: { content: 'Approved note' }, tags: ['archive'] },
      explicitApproval: true,
    });

    expect(result.action).toBe('applied');
    if (result.action !== 'applied') throw new Error('expected applied');
    expect(result.block).toMatchObject({
      heap: 'human/jan',
      id: 'human-1',
      type: 'text',
      data: { content: 'Approved note' },
      tags: ['archive'],
    });
  });

  it('applies bot-editable updates and links the origin session', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const target = await memory.createBlock({
      heap: 'human/jan',
      type: 'text',
      data: { content: 'old' },
      tags: ['bot-editable'],
    });
    const originRef = { heap: 'agent/sessions' as const, id: 'session-1' };

    const result = await mutateHumanHeap({
      memory,
      actor: { kind: 'agent', name: 'mira' },
      mutation: 'update',
      targetHeap: 'human/jan',
      targetRef: target,
      update: { data: { content: 'new' } },
      tags: ['bot-editable'],
      originRef,
    });

    expect(result.action).toBe('applied');
    if (result.action !== 'applied') throw new Error('expected applied');
    expect(result.block).toMatchObject({
      data: { content: 'new' },
      links: [originRef],
    });
  });

  it('proposal links target block and origin task for unapproved updates', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const target = await memory.createBlock({
      heap: 'human/jan',
      type: 'metadata',
      data: { title: 'existing' },
      tags: ['profile'],
    });
    const originRef = { heap: 'agent/tasks' as const, id: 'task-7' };

    const result = await mutateHumanHeap({
      memory,
      actor: { kind: 'agent', name: 'mira' },
      mutation: 'update',
      targetHeap: 'human/jan',
      targetRef: target,
      update: { data: { title: 'changed' } },
      originRef,
    });

    expect(result.action).toBe('proposed');
    if (result.action !== 'proposed') throw new Error('expected proposal');
    expect(result.proposal.links).toEqual([
      { heap: 'human/jan', id: target.id },
      originRef,
    ]);
    expect(result.proposal.data.update).toEqual({ data: { title: 'changed' } });
    await expect(memory.getBlock(target)).resolves.toMatchObject({ data: { title: 'existing' } });
  });
});
