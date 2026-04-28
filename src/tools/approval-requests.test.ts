import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import { decideGuard } from './guard.js';
import { createApprovalRequestBlock, createApprovalResumeTask, decideApprovalRequest, markApprovalApplied } from './approval-requests.js';

describe('approval request blocks', () => {
  it('creates durable approval refs for risky shell decisions with the exact proposed operation', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const guardDecision = decideGuard({
      surface: 'shell',
      action: 'execute',
      target: '/Users/jan/project',
      command: 'rm -rf dist && pnpm build',
    });
    const sessionRef = { heap: 'agent/sessions' as const, id: 'session-1' };
    const taskRef = { heap: 'agent/tasks' as const, id: 'task-1' };

    const request = await createApprovalRequestBlock({
      memory,
      heap: 'agent/approvals',
      guardDecision,
      requester: 'mira',
      sessionRef,
      taskRef,
    });

    expect(request).toMatchObject({
      type: 'proposal',
      tags: [
        'approval-request',
        'status:pending',
        'surface:shell',
        'action:execute',
        'requester:mira',
        'session:session-1',
        'task:task-1',
      ],
      data: {
        status: 'pending',
        reason: 'Destructive operation requires explicit approval.',
        proposedOperation: {
          surface: 'shell',
          action: 'execute',
          target: '/Users/jan/project',
          command: 'rm -rf dist && pnpm build',
        },
        exactRequest: {
          surface: 'shell',
          action: 'execute',
          target: '/Users/jan/project',
          command: 'rm -rf dist && pnpm build',
        },
        requester: 'mira',
      },
      links: [sessionRef, taskRef],
      metadata: { source: 'approval-request-model', exactOperationCaptured: true },
    });
  });

  it('rejects creating approval requests from allow or deny guard decisions', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const allow = decideGuard({ surface: 'file', action: 'read', target: 'README.md' });
    const deny = decideGuard({ surface: 'api', action: 'network', target: 'https://example.com', sensitiveMode: true });

    await expect(createApprovalRequestBlock({ memory, heap: 'agent/approvals', guardDecision: allow, requester: 'mira' })).rejects.toThrow(
      'requires an ask guard decision',
    );
    await expect(createApprovalRequestBlock({ memory, heap: 'agent/approvals', guardDecision: deny, requester: 'mira' })).rejects.toThrow(
      'requires an ask guard decision',
    );
  });

  it('records approval and denial transitions as auditable block updates', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const guardDecision = decideGuard({ surface: 'api', action: 'write', target: 'https://api.github.com/repos/o/r/issues' });
    const created = await createApprovalRequestBlock({ memory, heap: 'agent/approvals', guardDecision, requester: 'mira' });

    const approved = await decideApprovalRequest({
      memory,
      approvalRef: { heap: created.heap, id: created.id },
      decision: 'approved',
      decidedBy: 'jan',
      reason: 'safe to post',
      now: '2026-04-27T21:05:00.000Z',
    });

    expect(approved.data).toMatchObject({
      status: 'approved',
      decidedBy: 'jan',
      decisionReason: 'safe to post',
      decidedAt: '2026-04-27T21:05:00.000Z',
    });
    expect(approved.tags).toEqual(expect.arrayContaining(['approval-request', 'status:approved']));
    expect(approved.tags).not.toContain('status:pending');

    const second = await createApprovalRequestBlock({ memory, heap: 'agent/approvals', guardDecision, requester: 'mira' });
    const denied = await decideApprovalRequest({
      memory,
      approvalRef: { heap: second.heap, id: second.id },
      decision: 'denied',
      decidedBy: 'jan',
      reason: 'not now',
      now: '2026-04-27T21:06:00.000Z',
    });
    expect(denied.data.status).toBe('denied');
    expect(denied.tags).toEqual(expect.arrayContaining(['status:denied']));
  });

  it('marks approved requests as applied and links the resume ref', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const guardDecision = decideGuard({ surface: 'file', action: 'write', target: 'src/index.ts' });
    const created = await createApprovalRequestBlock({ memory, heap: 'agent/approvals', guardDecision, requester: 'mira' });
    const approved = await decideApprovalRequest({
      memory,
      approvalRef: { heap: created.heap, id: created.id },
      decision: 'approved',
      decidedBy: 'jan',
    });
    const resumeTarget = await memory.createBlock({
      heap: 'agent/tasks',
      type: 'task',
      data: { status: 'blocked', title: 'continue after approval' },
      tags: ['task'],
    });
    const resumeRef = { heap: resumeTarget.heap, id: resumeTarget.id };

    const resultTarget = await memory.createBlock({
      heap: 'agent/results',
      type: 'text',
      data: { summary: 'approved operation applied' },
      tags: ['task-result'],
    });
    const resultRef = { heap: resultTarget.heap, id: resultTarget.id };

    const applied = await markApprovalApplied({
      memory,
      approvalRef: { heap: approved.heap, id: approved.id },
      resumeRef,
      resultRefs: [resultRef],
      now: '2026-04-27T21:07:00.000Z',
    });

    expect(applied.data).toMatchObject({ status: 'applied', appliedAt: '2026-04-27T21:07:00.000Z', resumeRef, appliedResultRefs: [resultRef] });
    expect(applied.tags).toEqual(expect.arrayContaining(['status:applied']));
    expect(applied.links).toEqual([resumeRef, resultRef]);
    await expect(memory.getRelatedBlocks({ heap: applied.heap, id: applied.id })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: resumeRef.id, heap: resumeRef.heap })]),
    );
  });

  it('creates a resumable task from an approved request and applies the approval', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block', now: () => '2026-04-27T21:08:00.000Z' });
    const sessionRef = { heap: 'agent/sessions' as const, id: 'session-approve' };
    const guardDecision = decideGuard({ surface: 'api', action: 'write', target: 'https://api.example.test/issues' });
    const created = await createApprovalRequestBlock({ memory, heap: 'agent/approvals', guardDecision, requester: 'mira', sessionRef });
    const approved = await decideApprovalRequest({
      memory,
      approvalRef: { heap: created.heap, id: created.id },
      decision: 'approved',
      decidedBy: 'jan',
      now: '2026-04-27T21:08:10.000Z',
    });

    const { task, approval } = await createApprovalResumeTask({
      memory,
      approvalRef: { heap: approved.heap, id: approved.id },
      taskHeap: 'agent/tasks',
      owner: { kind: 'agent', name: 'mira' },
      now: '2026-04-27T21:08:20.000Z',
    });

    expect(task).toMatchObject({
      type: 'task',
      data: {
        title: 'Resume approved api write',
        description: 'Apply approved operation for https://api.example.test/issues',
        taskType: 'approval-resume',
        status: 'pending',
        originSession: sessionRef,
      },
      tags: expect.arrayContaining(['task', 'status:pending', 'task-type:approval-resume', `approval:${approved.id}`, 'surface:api', 'action:write']),
      links: [sessionRef],
    });
    expect(approval.data).toMatchObject({
      status: 'applied',
      appliedAt: '2026-04-27T21:08:20.000Z',
      resumeRef: { heap: task.heap, id: task.id },
    });
    expect(approval.links).toEqual([sessionRef, { heap: task.heap, id: task.id }]);
    await expect(memory.getRelatedBlocks({ heap: approval.heap, id: approval.id })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: task.id, heap: task.heap })]),
    );
  });

  it('does not apply denied or cancelled requests', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const guardDecision = decideGuard({ surface: 'file', action: 'write', target: 'src/index.ts' });
    const created = await createApprovalRequestBlock({ memory, heap: 'agent/approvals', guardDecision, requester: 'mira' });
    const denied = await decideApprovalRequest({
      memory,
      approvalRef: { heap: created.heap, id: created.id },
      decision: 'denied',
      decidedBy: 'jan',
    });

    await expect(markApprovalApplied({ memory, approvalRef: { heap: denied.heap, id: denied.id } })).rejects.toThrow(
      'Only approved requests can be applied',
    );
    await expect(createApprovalResumeTask({
      memory,
      approvalRef: { heap: denied.heap, id: denied.id },
      taskHeap: 'agent/tasks',
      owner: { kind: 'agent', name: 'mira' },
    })).rejects.toThrow('Only approved requests can be applied');

    const second = await createApprovalRequestBlock({ memory, heap: 'agent/approvals', guardDecision, requester: 'mira' });
    const cancelled = await decideApprovalRequest({
      memory,
      approvalRef: { heap: second.heap, id: second.id },
      decision: 'cancelled',
      decidedBy: 'jan',
    });
    await expect(createApprovalResumeTask({
      memory,
      approvalRef: { heap: cancelled.heap, id: cancelled.id },
      taskHeap: 'agent/tasks',
      owner: { kind: 'agent', name: 'mira' },
    })).rejects.toThrow('Only approved requests can be applied');
  });
});
