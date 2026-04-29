import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { LocalHeaperMemory } from '../heaper/local-storage.js';
import { createTaskBlock, transitionTaskBlock } from '../heaper/task-blocks.js';
import { decideGuard } from '../tools/guard.js';
import { createApprovalRequestBlock } from '../tools/approval-requests.js';
import { createRuntimeBlockerBlock } from '../runtime/blockers.js';
import { decideNotification } from '../notifications/policy.js';
import { createNotificationOutboxBlock } from '../notifications/outbox.js';
import { renderRuntimeStatusJson, runRuntimeStatus, type RuntimeStatusSummary } from './runtime-status.js';

describe('runtime status command', () => {
  it('summarizes active runtime artifacts from a LocalHeaperMemory store with audit drill-down refs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-core-runtime-status-'));
    const storePath = join(dir, 'memory.json');
    const memory = new LocalHeaperMemory({ filePath: storePath, idPrefix: 'status', now: () => '2026-04-29T00:00:00.000Z' });
    const session = await memory.createBlock({ heap: 'agent/sessions', type: 'session', data: { sessionId: 'mira-1' }, tags: ['session'] });
    const pending = await createTaskBlock({ memory, heap: 'agent/tasks', title: 'pending', description: 'p', taskType: 'work', owner: { kind: 'agent', name: 'mira' } });
    const running = await createTaskBlock({ memory, heap: 'agent/tasks', title: 'running', description: 'r', taskType: 'work', owner: { kind: 'agent', name: 'mira' } });
    await transitionTaskBlock({ memory, task: running, status: 'running' });
    const blocked = await createTaskBlock({ memory, heap: 'agent/tasks', title: 'blocked', description: 'b', taskType: 'work', owner: { kind: 'agent', name: 'mira' } });
    await transitionTaskBlock({ memory, task: blocked, status: 'blocked' });
    const blocker = await createRuntimeBlockerBlock({
      memory,
      heap: 'agent/blockers',
      error: 'need credentials',
      operation: 'status test',
      taskRef: { heap: blocked.heap, id: blocked.id },
    });
    const approval = await createApprovalRequestBlock({
      memory,
      heap: 'agent/approvals',
      guardDecision: decideGuard({ surface: 'api', action: 'write', target: 'https://api.example.test/issues' }),
      requester: 'mira',
      sessionRef: { heap: session.heap, id: session.id },
    });
    const queued = await createNotificationOutboxBlock({
      memory,
      heap: 'agent/notifications',
      source: 'worker',
      intent: decideNotification({ mode: 'background', trigger: 'completed-milestone', summary: 'done', refs: [{ heap: pending.heap, id: pending.id }] }),
    });
    const summarized = await createNotificationOutboxBlock({
      memory,
      heap: 'agent/notifications',
      source: 'worker',
      intent: decideNotification({ mode: 'background', trigger: 'background-progress', summary: 'quiet', refs: [{ heap: running.heap, id: running.id }] }),
    });
    await memory.appendToDailyEntry('yesterday', 'agent/daily', '2026-04-28');
    const daily = await memory.appendToDailyEntry('today', 'agent/daily', '2026-04-29');

    const status = await runRuntimeStatus({ storePath, now: '2026-04-29T00:01:00.000Z', auditDepth: 4 });

    expect(status.counts).toMatchObject({
      sessions: 1,
      tasks: 3,
      pendingTasks: 1,
      runningTasks: 1,
      blockedTasks: 1,
      activeBlockers: 1,
      pendingApprovals: 1,
      queuedNotifications: 1,
      summarizedNotifications: 1,
      recentDailyEntries: 2,
    });
    expect(status.refs).toMatchObject({
      sessions: [{ heap: session.heap, id: session.id }],
      blockers: [{ heap: blocker.heap, id: blocker.id }],
      approvals: [{ heap: approval.heap, id: approval.id }],
      notifications: [{ heap: queued.heap, id: queued.id }, { heap: summarized.heap, id: summarized.id }],
    });
    expect(status.refs.dailyEntries).toContainEqual({ heap: daily.heap, id: daily.id });
    const json = JSON.parse(renderRuntimeStatusJson(status)) as RuntimeStatusSummary;
    expect(json).toEqual(status);
    expect(json.counts.queuedNotifications).toBe(1);
    expect(json.refs.notifications).toEqual([{ heap: queued.heap, id: queued.id }, { heap: summarized.heap, id: summarized.id }]);
    const text = status.lines.join('\n');
    expect(text).toContain(`Runtime status for ${storePath}`);
    expect(text).toContain('- tasks: 3 (pending=1, running=1, blocked=1)');
    expect(text).toContain(`agent-core audit-export agent/tasks#${pending.id} --store ${storePath} --depth 4`);
    expect(text).toContain(`agent-core audit-export agent/blockers#${blocker.id} --store ${storePath} --depth 4`);
    expect(text).toContain(`agent-core audit-export agent/approvals#${approval.id} --store ${storePath} --depth 4`);
    expect(text).toContain(`agent-core audit-export agent/notifications#${queued.id} --store ${storePath} --depth 4`);
    expect(text).toContain('agent/daily#');
  });

  it('renders empty groups when a fresh store has no runtime artifacts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-core-runtime-status-empty-'));
    const storePath = join(dir, 'memory.json');

    const status = await runRuntimeStatus({ storePath, now: '2026-04-29T00:02:00.000Z' });

    expect(status.counts).toMatchObject({ sessions: 0, tasks: 0, activeBlockers: 0, pendingApprovals: 0 });
    expect(status.lines).toContain('- sessions: none');
    expect(status.lines).toContain('- tasks: none');
    expect(status.lines).toContain('- blockers: none');
    expect(renderRuntimeStatusJson(status)).toContain('"refs"');
  });
});
