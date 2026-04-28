import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from './memory.js';
import { createDelegationTask, getDelegatedWorkerContext, linkDelegationResult } from './delegation.js';

describe('delegation workflow', () => {
  it('creates delegation tasks with origin refs and only permitted refs linked', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const originSession = await memory.createBlock({ heap: 'persona/mira/sessions', type: 'session', data: { title: 'origin' }, tags: ['session'] });
    const sharedRef = await memory.createBlock({ heap: 'agent/shared', type: 'text', data: { body: 'shared context' }, tags: ['shared'] });
    const privateRef = await memory.createBlock({ heap: 'persona/mira/memory', type: 'text', data: { body: 'mira private' }, tags: ['private'] });

    const task = await createDelegationTask({
      memory,
      title: 'Review shared context',
      description: 'Delegate review to ada using refs only.',
      delegatedBy: 'mira',
      delegateTo: 'ada',
      originSession: { heap: originSession.heap, id: originSession.id },
      originRefs: [
        { heap: sharedRef.heap, id: sharedRef.id },
        { heap: privateRef.heap, id: privateRef.id },
      ],
    });

    expect(task).toMatchObject({
      heap: 'persona/ada/tasks',
      type: 'task',
      tags: ['task', 'status:pending', 'task-type:delegation', 'owner:persona:ada', 'delegation', 'delegated-to:ada', 'delegated-by:mira'],
      data: {
        title: 'Review shared context',
        taskType: 'delegation',
        delegateTo: 'ada',
        delegatedBy: 'mira',
        originRefs: [
          { heap: originSession.heap, id: originSession.id },
          { heap: sharedRef.heap, id: sharedRef.id },
          { heap: privateRef.heap, id: privateRef.id },
        ],
        permittedRefs: [{ heap: sharedRef.heap, id: sharedRef.id }],
        withheldRefs: [
          { heap: originSession.heap, id: originSession.id },
          { heap: privateRef.heap, id: privateRef.id },
        ],
      },
      links: [{ heap: sharedRef.heap, id: sharedRef.id }],
    });
  });

  it('delegated worker context exposes visible blocks without copying private persona blocks', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const sharedRef = await memory.createBlock({ heap: 'agent/shared', type: 'text', data: { body: 'shared context' }, tags: ['shared'] });
    const privateRef = await memory.createBlock({ heap: 'persona/mira/memory', type: 'text', data: { body: 'do not copy' }, tags: ['private'] });

    const task = await createDelegationTask({
      memory,
      title: 'Use refs',
      description: 'Only permitted refs are visible.',
      delegatedBy: 'mira',
      delegateTo: 'ada',
      originRefs: [
        { heap: sharedRef.heap, id: sharedRef.id },
        { heap: privateRef.heap, id: privateRef.id },
      ],
    });

    const context = await getDelegatedWorkerContext(memory, { heap: task.heap, id: task.id });

    expect(context.visibleRefs).toEqual([{ heap: sharedRef.heap, id: sharedRef.id }]);
    expect(context.withheldRefs).toEqual([{ heap: privateRef.heap, id: privateRef.id }]);
    expect(context.visibleBlocks.map((block) => block.data.body)).toEqual(['shared context']);
    expect(JSON.stringify(context)).not.toContain('do not copy');
  });

  it('allows explicitly shared persona blocks and blocks unlinked private persona blocks', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const explicitShared = await memory.createBlock({
      heap: 'persona/mira/memory',
      type: 'text',
      data: { body: 'persona-approved context' },
      tags: ['persona-shared'],
    });
    const privateRef = await memory.createBlock({ heap: 'persona/mira/memory', type: 'text', data: { body: 'private context' }, tags: ['private'] });

    const task = await createDelegationTask({
      memory,
      title: 'Shared persona note',
      description: 'Persona-shared refs may cross boundary.',
      delegatedBy: 'mira',
      delegateTo: 'ada',
      originRefs: [
        { heap: explicitShared.heap, id: explicitShared.id },
        { heap: privateRef.heap, id: privateRef.id },
      ],
    });

    expect(task.data.permittedRefs).toEqual([{ heap: explicitShared.heap, id: explicitShared.id }]);
    expect(task.data.withheldRefs).toEqual([{ heap: privateRef.heap, id: privateRef.id }]);
  });

  it('links delegated results back to delegation task and origin refs', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const originSession = await memory.createBlock({ heap: 'persona/mira/sessions', type: 'session', data: { title: 'origin' }, tags: ['session', 'persona-shared'] });
    const sharedRef = await memory.createBlock({ heap: 'agent/shared', type: 'text', data: { body: 'shared context' }, tags: ['shared'] });
    const task = await createDelegationTask({
      memory,
      title: 'Review shared context',
      description: 'Delegate review to ada.',
      delegatedBy: 'mira',
      delegateTo: 'ada',
      originSession: { heap: originSession.heap, id: originSession.id },
      originRefs: [{ heap: sharedRef.heap, id: sharedRef.id }],
    });
    const result = await memory.createBlock({ heap: 'persona/ada/memory', type: 'text', data: { body: 'result' }, tags: ['delegation-result'] });

    const updated = await linkDelegationResult({
      memory,
      delegationTask: { heap: task.heap, id: task.id },
      result: { heap: result.heap, id: result.id },
    });

    expect(updated.data.resultRefs).toEqual([{ heap: result.heap, id: result.id }]);
    const relatedToResult = await memory.getRelatedBlocks({ heap: result.heap, id: result.id });
    expect(relatedToResult.map((block) => ({ heap: block.heap, id: block.id }))).toEqual(expect.arrayContaining([
      { heap: task.heap, id: task.id },
      { heap: originSession.heap, id: originSession.id },
      { heap: sharedRef.heap, id: sharedRef.id },
    ]));
  });
});
