import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from './memory.js';
import {
  createTaskBlock,
  linkTaskResult,
  queryResumableTasks,
  transitionTaskBlock,
} from './task-blocks.js';

describe('task blocks', () => {
  it('creates a pending Heaper task block with owner and origin session', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'task', now: () => '2026-04-27T08:00:00.000Z' });
    const originSession = { heap: 'agent/sessions' as const, id: 'session-1' };

    const task = await createTaskBlock({
      memory,
      heap: 'agent/tasks',
      title: 'Continue heartbeat work',
      description: 'Advance the next safe agent-core slice.',
      taskType: 'heartbeat',
      owner: { kind: 'agent', name: 'mira' },
      originSession,
      tags: ['priority:normal'],
    });

    expect(task).toMatchObject({
      id: 'task-1',
      heap: 'agent/tasks',
      type: 'task',
      tags: ['task', 'status:pending', 'task-type:heartbeat', 'owner:agent:mira', 'priority:normal'],
      data: {
        title: 'Continue heartbeat work',
        description: 'Advance the next safe agent-core slice.',
        taskType: 'heartbeat',
        status: 'pending',
        owner: { kind: 'agent', name: 'mira' },
        originSession,
        resultRefs: [],
      },
      links: [originSession],
    });
  });

  it('transitions task status with auditable timing and status tags', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'task' });
    const task = await createTaskBlock({
      memory,
      heap: 'agent/tasks',
      title: 'Run checks',
      description: 'Run targeted tests.',
      taskType: 'validation',
      owner: { kind: 'agent', name: 'mira' },
    });

    const running = await transitionTaskBlock({
      memory,
      task,
      status: 'running',
      reason: 'worker picked it up',
      now: '2026-04-27T08:01:00.000Z',
    });
    const done = await transitionTaskBlock({
      memory,
      task: running,
      status: 'done',
      reason: 'tests passed',
      now: '2026-04-27T08:02:00.000Z',
    });

    expect(running.data).toMatchObject({ status: 'running', statusReason: 'worker picked it up', startedAt: '2026-04-27T08:01:00.000Z' });
    expect(running.tags).toContain('status:running');
    expect(running.tags).not.toContain('status:pending');
    expect(done.data).toMatchObject({ status: 'done', statusReason: 'tests passed', completedAt: '2026-04-27T08:02:00.000Z' });
    expect(done.tags).toContain('status:done');
  });

  it('links result blocks without duplicating result refs', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const task = await createTaskBlock({
      memory,
      heap: 'agent/tasks',
      title: 'Write summary',
      description: 'Produce a result block.',
      taskType: 'summary',
      owner: { kind: 'agent', name: 'mira' },
    });
    const result = await memory.createBlock({
      heap: 'agent/results',
      type: 'text',
      data: { content: 'done' },
      tags: ['result'],
    });

    await linkTaskResult({ memory, task, result });
    const updated = await linkTaskResult({ memory, task, result });
    const related = await memory.getRelatedBlocks(result);

    expect(updated.data.resultRefs).toEqual([{ heap: 'agent/results', id: 'block-2' }]);
    expect(updated.links).toEqual([{ heap: 'agent/results', id: 'block-2' }]);
    expect(related.map((block) => `${block.heap}#${block.id}`)).toContain('agent/tasks#block-1');
  });

  it('queries pending and running tasks as resumable while skipping blocked and done', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'task' });
    const pending = await createTaskBlock({ memory, heap: 'agent/tasks', title: 'pending', description: 'p', taskType: 'work', owner: { kind: 'agent', name: 'mira' } });
    const running = await createTaskBlock({ memory, heap: 'agent/tasks', title: 'running', description: 'r', taskType: 'work', owner: { kind: 'agent', name: 'mira' } });
    const blocked = await createTaskBlock({ memory, heap: 'agent/tasks', title: 'blocked', description: 'b', taskType: 'work', owner: { kind: 'agent', name: 'mira' } });
    const done = await createTaskBlock({ memory, heap: 'agent/tasks', title: 'done', description: 'd', taskType: 'work', owner: { kind: 'agent', name: 'mira' } });

    await transitionTaskBlock({ memory, task: running, status: 'running' });
    await transitionTaskBlock({ memory, task: blocked, status: 'blocked' });
    await transitionTaskBlock({ memory, task: done, status: 'done' });

    const resumable = await queryResumableTasks({ memory, heaps: ['agent/tasks'] });

    expect(resumable.map((task) => task.data.title)).toEqual(['pending', 'running']);
    expect(resumable.map((task) => task.data.status)).toEqual(['pending', 'running']);
  });
});
