import { describe, expect, it } from 'vitest';
import { decideNotification } from './policy.js';

const sessionRef = { heap: 'agent/sessions' as const, id: 'session-1' };
const taskRef = { heap: 'agent/tasks' as const, id: 'task-1' };

describe('notification policy', () => {
  it('returns a direct response intent for live chat', () => {
    const intent = decideNotification({
      mode: 'live',
      trigger: 'live-response',
      summary: 'Here is the answer Jan asked for.',
      refs: [sessionRef],
    });

    expect(intent).toEqual({
      action: 'direct-response',
      priority: 'normal',
      reason: 'Live chat expects an immediate direct response.',
      message: 'Here is the answer Jan asked for.',
      refs: [sessionRef],
      audience: 'human',
    });
  });

  it('keeps ordinary background progress silent', () => {
    const intent = decideNotification({
      mode: 'background',
      trigger: 'background-progress',
      summary: 'Processed one queued continuation step.',
      refs: [taskRef],
    });

    expect(intent).toMatchObject({
      action: 'silent',
      priority: 'low',
      reason: 'Ordinary background progress should not interrupt.',
      refs: [taskRef],
    });
  });

  it('notifies for blockers failures approvals and completed milestones', () => {
    expect(decideNotification({ mode: 'background', trigger: 'blocked', summary: 'Need credentials.', refs: [taskRef] })).toMatchObject({
      action: 'notify',
      priority: 'high',
      reason: 'A blocker needs human attention before work can continue.',
    });
    expect(decideNotification({ mode: 'async', trigger: 'failed', summary: 'Tests failed.', refs: [taskRef] })).toMatchObject({
      action: 'notify',
      priority: 'high',
      reason: 'A failure needs attention or triage.',
    });
    expect(decideNotification({ mode: 'background', trigger: 'approval-required', summary: 'Approve shell command.', refs: [taskRef] })).toMatchObject({
      action: 'notify',
      priority: 'high',
      reason: 'An explicit approval decision is required.',
    });
    expect(decideNotification({ mode: 'background', trigger: 'completed-milestone', summary: 'Slice completed.', refs: [taskRef] })).toMatchObject({
      action: 'notify',
      priority: 'normal',
      reason: 'A meaningful milestone completed.',
    });
  });

  it('includes concise messages and deduplicated linked refs', () => {
    const longSummary = `Completed ${'a '.repeat(200)}`;

    const intent = decideNotification({
      mode: 'async',
      trigger: 'completed-milestone',
      summary: longSummary,
      refs: [sessionRef, taskRef, sessionRef],
    });

    expect(intent.message.length).toBeLessThanOrEqual(240);
    expect(intent.message.endsWith('…')).toBe(true);
    expect(intent.refs).toEqual([sessionRef, taskRef]);
  });
});
