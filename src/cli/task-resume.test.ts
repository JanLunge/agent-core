import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { LocalHeaperMemory } from '../heaper/local-storage.js';
import { decideGuard } from '../tools/guard.js';
import { createApprovalRequestBlock, createApprovalResumeTask, decideApprovalRequest } from '../tools/approval-requests.js';
import { runTaskResume } from './task-resume.js';

describe('task resume command', () => {
  it('lists pending approval-resume tasks with approval refs and exact operations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-core-task-resume-'));
    const storePath = join(dir, 'memory.json');
    const memory = new LocalHeaperMemory({ filePath: storePath, idPrefix: 'resume', now: () => '2026-04-29T06:00:00.000Z' });
    const approval = await createApprovalRequestBlock({
      memory,
      heap: 'agent/approvals',
      guardDecision: decideGuard({ surface: 'shell', action: 'execute', target: '/workspace/app', command: 'rm -rf dist && pnpm build && pnpm test' }),
      requester: 'mira',
      args: { cwd: '/workspace/app' },
    });
    const approved = await decideApprovalRequest({
      memory,
      approvalRef: { heap: approval.heap, id: approval.id },
      decision: 'approved',
      decidedBy: 'jan',
      now: '2026-04-29T06:01:00.000Z',
    });
    const { task } = await createApprovalResumeTask({
      memory,
      approvalRef: { heap: approved.heap, id: approved.id },
      taskHeap: 'agent/tasks',
      owner: { kind: 'agent', name: 'mira' },
      now: '2026-04-29T06:02:00.000Z',
    });

    const summary = await runTaskResume({ storePath, now: '2026-04-29T06:03:00.000Z' });

    expect(summary.items).toEqual([
      {
        taskRef: { heap: task.heap, id: task.id },
        approvalRef: { heap: approved.heap, id: approved.id },
        status: 'pending',
        title: 'Resume approved shell execute',
        operation: {
          surface: 'shell',
          action: 'execute',
          target: '/workspace/app',
          command: 'rm -rf dist && pnpm build && pnpm test',
          args: { cwd: '/workspace/app' },
        },
        ready: false,
      },
    ]);
    const text = summary.lines.join('\n');
    expect(text).toContain(`task: agent/tasks#${task.id}`);
    expect(text).toContain(`approval: agent/approvals#${approved.id}`);
    expect(text).toContain('operation: shell execute /workspace/app');
    expect(text).toContain('command: rm -rf dist && pnpm build && pnpm test');
    expect(text).toContain('safe: inspection only; no approved operation was executed');
  });

  it('marks pending approval-resume tasks ready for continuation without executing the operation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-core-task-resume-ready-'));
    const storePath = join(dir, 'memory.json');
    const memory = new LocalHeaperMemory({ filePath: storePath, idPrefix: 'ready', now: () => '2026-04-29T06:04:00.000Z' });
    const approval = await createApprovalRequestBlock({
      memory,
      heap: 'agent/approvals',
      guardDecision: decideGuard({ surface: 'api', action: 'write', target: 'https://api.example.test/issues' }),
      requester: 'mira',
    });
    const approved = await decideApprovalRequest({ memory, approvalRef: { heap: approval.heap, id: approval.id }, decision: 'approved', decidedBy: 'jan' });
    const { task } = await createApprovalResumeTask({
      memory,
      approvalRef: { heap: approved.heap, id: approved.id },
      taskHeap: 'agent/tasks',
      owner: { kind: 'agent', name: 'mira' },
    });

    const summary = await runTaskResume({ storePath, markReady: true, now: '2026-04-29T06:05:00.000Z' });

    expect(summary.items[0]).toMatchObject({ ready: true, operation: { surface: 'api', action: 'write', target: 'https://api.example.test/issues' } });
    expect(summary.lines.join('\n')).toContain('task marked ready for continuation');
    await expect(new LocalHeaperMemory({ filePath: storePath }).getBlock({ heap: task.heap, id: task.id })).resolves.toMatchObject({
      data: { status: 'pending', statusReason: 'ready for continuation after approval' },
      tags: expect.arrayContaining(['task-type:approval-resume', 'approval-resume-ready']),
    });
  });
});
