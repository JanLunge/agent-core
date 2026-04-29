import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTaskBlock, transitionTaskBlock } from '../heaper/task-blocks.js';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import { LocalHeaperMemory } from '../heaper/local-storage.js';
import { createRouter } from '../router/router.js';
import { createFakeAgentHarness } from '../runtime/fake-agent.js';
import { createRuntimeContinuationHandler, runContinuationWorker } from './continuation-worker.js';

const modelPolicy = {
  defaultModel: 'remote/default',
  strongModel: 'remote/strong',
  localModel: 'local/small',
};

const availableModels = [
  { id: 'local/small', capabilities: ['local' as const] },
  { id: 'remote/default', capabilities: ['remote' as const] },
  { id: 'remote/strong', capabilities: ['remote' as const, 'strong' as const] },
];

describe('runContinuationWorker', () => {
  it('selects pending tasks, writes result blocks, links them, and marks done', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block', now: () => '2026-04-27T09:00:00.000Z' });
    const task = await createTaskBlock({
      memory,
      heap: 'agent/tasks',
      title: 'Continue work',
      description: 'Advance one slice.',
      taskType: 'heartbeat',
      owner: { kind: 'agent', name: 'mira' },
    });

    const result = await runContinuationWorker({
      memory,
      taskHeaps: ['agent/tasks'],
      resultHeap: 'agent/results',
      notificationOutboxHeap: 'agent/notifications',
      now: '2026-04-27T09:01:00.000Z',
      handleTask: () => ({ status: 'done', summary: 'slice complete', notify: true }),
    });

    expect(result.processed).toEqual([
      { taskRef: { heap: 'agent/tasks', id: task.id }, status: 'done', resultRef: { heap: 'agent/results', id: 'block-2' }, blockerRef: undefined, notificationOutboxRef: { heap: 'agent/notifications', id: 'block-3' } },
    ]);
    expect(result.notifications).toMatchObject([
      {
        action: 'notify',
        priority: 'normal',
        reason: 'A meaningful milestone completed.',
        message: 'slice complete',
        refs: [{ heap: 'agent/tasks', id: task.id }, { heap: 'agent/results', id: 'block-2' }],
      },
    ]);

    const updatedTask = await memory.getBlock(task);
    expect(updatedTask?.data).toMatchObject({ status: 'done', statusReason: 'slice complete' });
    expect(updatedTask?.data.resultRefs).toEqual([{ heap: 'agent/results', id: 'block-2' }]);
    const resultBlock = await memory.getBlock({ heap: 'agent/results', id: 'block-2' });
    expect(resultBlock).toMatchObject({
      type: 'text',
      tags: ['task-result', 'status:done', `task:${task.id}`],
      data: { status: 'done', summary: 'slice complete' },
      links: [{ heap: 'agent/tasks', id: task.id }],
    });
    await expect(memory.getBlock({ heap: 'agent/notifications', id: 'block-3' })).resolves.toMatchObject({
      type: 'metadata',
      tags: expect.arrayContaining(['notification-outbox', 'status:queued', 'action:notify', 'source:worker']),
      data: { status: 'queued', source: 'worker' },
      links: [{ heap: 'agent/tasks', id: task.id }, { heap: 'agent/results', id: 'block-2' }],
    });
  });

  it('skips blocked and done tasks because resumable query excludes them', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'task' });
    const blocked = await createTaskBlock({ memory, heap: 'agent/tasks', title: 'blocked', description: 'b', taskType: 'work', owner: { kind: 'agent', name: 'mira' } });
    const done = await createTaskBlock({ memory, heap: 'agent/tasks', title: 'done', description: 'd', taskType: 'work', owner: { kind: 'agent', name: 'mira' } });
    await transitionTaskBlock({ memory, task: blocked, status: 'blocked' });
    await transitionTaskBlock({ memory, task: done, status: 'done' });

    const result = await runContinuationWorker({
      memory,
      taskHeaps: ['agent/tasks'],
      resultHeap: 'agent/results',
      handleTask: () => { throw new Error('should not run'); },
    });

    expect(result).toEqual({ processed: [], skipped: [], notifications: [] });
  });

  it('keeps running tasks resumable without milestone notifications', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const task = await createTaskBlock({ memory, heap: 'agent/tasks', title: 'long', description: 'still going', taskType: 'work', owner: { kind: 'agent', name: 'mira' } });

    const result = await runContinuationWorker({
      memory,
      taskHeaps: ['agent/tasks'],
      resultHeap: 'agent/results',
      notificationOutboxHeap: 'agent/notifications',
      handleTask: () => ({ status: 'running', summary: 'made progress', notify: true }),
    });

    expect(result.processed).toEqual([
      { taskRef: { heap: 'agent/tasks', id: task.id }, status: 'running', resultRef: { heap: 'agent/results', id: 'block-2' }, blockerRef: undefined, notificationOutboxRef: { heap: 'agent/notifications', id: 'block-3' } },
    ]);
    expect(result.notifications).toEqual([]);
    await expect(memory.getBlock({ heap: 'agent/notifications', id: 'block-3' })).resolves.toMatchObject({
      tags: expect.arrayContaining(['notification-outbox', 'status:summarized', 'action:silent', 'source:worker']),
      data: { status: 'summarized', source: 'worker' },
      links: [{ heap: 'agent/tasks', id: task.id }, { heap: 'agent/results', id: 'block-2' }],
    });
    const updatedTask = await memory.getBlock(task);
    expect(updatedTask?.data.status).toBe('running');
    expect(updatedTask?.data.resultRefs).toEqual([{ heap: 'agent/results', id: 'block-2' }]);
  });

  it('blocks tasks and emits blocker notification intent', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const task = await createTaskBlock({ memory, heap: 'agent/tasks', title: 'needs Jan', description: 'decision needed', taskType: 'feedback', owner: { kind: 'agent', name: 'mira' } });

    const result = await runContinuationWorker({
      memory,
      taskHeaps: ['agent/tasks'],
      resultHeap: 'agent/results',
      handleTask: () => ({ status: 'blocked', summary: 'cannot continue', reason: 'needs product decision' }),
    });

    expect(result.notifications).toMatchObject([
      {
        action: 'notify',
        priority: 'high',
        reason: 'A blocker needs human attention before work can continue.',
        message: 'needs product decision',
        refs: [{ heap: 'agent/tasks', id: task.id }, { heap: 'agent/results', id: 'block-2' }, { heap: 'agent/results', id: 'block-3' }],
      },
    ]);
    const updatedTask = await memory.getBlock(task);
    expect(updatedTask?.data).toMatchObject({
      status: 'blocked',
      statusReason: 'needs product decision',
      blockerRefs: [{ heap: 'agent/results', id: 'block-3' }],
    });
  });

  it('bridges a task into the runtime orchestrator and links runtime refs back to the task result', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'runtime', now: () => '2026-04-28T19:00:00.000Z' });
    const router = createRouter();
    const harness = createFakeAgentHarness('mira', [{ kind: 'echo', prefix: 'runtime-task' }]);
    router.registerAgent('mira', harness.agent);
    router.setDefaultAgent('mira');
    const task = await createTaskBlock({
      memory,
      heap: 'agent/tasks',
      title: 'Runtime task',
      description: 'summarize background work',
      taskType: 'heartbeat',
      owner: { kind: 'persona', name: 'mira' },
    });

    const result = await runContinuationWorker({
      memory,
      taskHeaps: ['agent/tasks'],
      resultHeap: 'agent/results',
      now: '2026-04-28T19:01:00.000Z',
      handleTask: createRuntimeContinuationHandler({
        memory,
        router,
        sessionHeap: 'agent/sessions',
        auditHeap: 'agent/audit',
        modelPolicy,
        availableModels,
        responder: harness.responder,
        notify: true,
      }),
    });

    expect(result.processed).toMatchObject([{ taskRef: { heap: 'agent/tasks', id: task.id }, status: 'done' }]);
    expect(result.notifications).toMatchObject([{ action: 'notify', message: 'runtime-task:summarize background work' }]);
    const resultRef = result.processed[0].resultRef;
    const resultBlock = await memory.getBlock(resultRef);
    expect(resultBlock).toMatchObject({
      data: {
        status: 'done',
        summary: 'runtime-task:summarize background work',
        runtimeRefs: expect.arrayContaining([
          expect.objectContaining({ heap: 'agent/audit' }),
          expect.objectContaining({ heap: 'agent/sessions' }),
        ]),
      },
      links: expect.arrayContaining([{ heap: 'agent/tasks', id: task.id }]),
    });
    const runtimeRefs = resultBlock?.data.runtimeRefs as Array<{ heap: string; id: string }>;
    expect(runtimeRefs.some((ref) => ref.heap === 'agent/audit')).toBe(true);
    expect(runtimeRefs.some((ref) => ref.heap === 'agent/sessions')).toBe(true);
    const updatedTask = await memory.getBlock(task);
    expect(updatedTask?.data).toMatchObject({ status: 'done', resultRefs: [resultRef] });
  });

  it('links runtime blockers back to the task when runtime orchestration blocks', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'blocked', now: () => '2026-04-28T19:02:00.000Z' });
    const router = createRouter();
    const harness = createFakeAgentHarness('mira', [{ kind: 'echo', prefix: 'runtime-task' }]);
    router.registerAgent('mira', harness.agent);
    router.setDefaultAgent('mira');
    const task = await createTaskBlock({
      memory,
      heap: 'agent/tasks',
      title: 'Blocked runtime task',
      description: 'blocked by missing model',
      taskType: 'heartbeat',
      owner: { kind: 'agent', name: 'mira' },
    });

    const result = await runContinuationWorker({
      memory,
      taskHeaps: ['agent/tasks'],
      resultHeap: 'agent/results',
      blockerHeap: 'agent/blockers',
      handleTask: createRuntimeContinuationHandler({
        memory,
        router,
        sessionHeap: 'agent/sessions',
        auditHeap: 'agent/audit',
        blockerHeap: 'agent/blockers',
        modelPolicy,
        availableModels: [],
        responder: harness.responder,
      }),
    });

    expect(result.processed).toMatchObject([{ taskRef: { heap: 'agent/tasks', id: task.id }, status: 'blocked', blockerRef: { heap: 'agent/blockers', id: expect.any(String) } }]);
    const blockerRef = result.processed[0].blockerRef!;
    const updatedTask = await memory.getBlock(task);
    expect(updatedTask?.data).toMatchObject({
      status: 'blocked',
      blockerRefs: [blockerRef],
    });
    await expect(memory.getBlock(blockerRef)).resolves.toMatchObject({
      tags: expect.arrayContaining(['runtime-blocker']),
      links: expect.arrayContaining([{ heap: 'agent/tasks', id: task.id }, result.processed[0].resultRef]),
    });
  });

  it('processes a pending task that survives a LocalHeaperMemory restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-core-continuation-worker-'));
    const filePath = join(dir, 'memory.json');
    const firstMemory = new LocalHeaperMemory({ filePath, idPrefix: 'local', now: () => '2026-04-28T13:00:00.000Z' });
    const task = await createTaskBlock({
      memory: firstMemory,
      heap: 'agent/tasks',
      title: 'Restart-safe task',
      description: 'Continue after process restart.',
      taskType: 'heartbeat',
      owner: { kind: 'agent', name: 'mira' },
    });

    const restartedMemory = new LocalHeaperMemory({ filePath, idPrefix: 'local', now: () => '2026-04-28T13:01:00.000Z' });
    const result = await runContinuationWorker({
      memory: restartedMemory,
      taskHeaps: ['agent/tasks'],
      resultHeap: 'agent/results',
      blockerHeap: 'agent/blockers',
      now: '2026-04-28T13:01:00.000Z',
      handleTask: ({ task }) => ({ status: 'done', summary: `resumed ${task.id}`, notify: false }),
    });

    expect(result.processed).toEqual([
      { taskRef: { heap: 'agent/tasks', id: task.id }, status: 'done', resultRef: { heap: 'agent/results', id: 'local-2' }, blockerRef: undefined },
    ]);
    expect(result.notifications).toEqual([]);

    const inspectionMemory = new LocalHeaperMemory({ filePath, idPrefix: 'unused' });
    await expect(inspectionMemory.getBlock(task)).resolves.toMatchObject({
      data: { status: 'done', resultRefs: [{ heap: 'agent/results', id: 'local-2' }] },
    });
    await expect(inspectionMemory.getBlock({ heap: 'agent/results', id: 'local-2' })).resolves.toMatchObject({
      data: { status: 'done', summary: `resumed ${task.id}` },
      links: [{ heap: 'agent/tasks', id: task.id }],
    });
  });
});
