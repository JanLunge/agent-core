import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import {
  classifyRuntimeBlocker,
  createRuntimeBlockerBlock,
  redactSensitiveDetails,
  resolveRuntimeBlocker,
  summarizeRuntimeBlocker,
} from './blockers.js';

describe('runtime blockers', () => {
  it('classifies missing credentials, denied permission, test failures, tool failures, and feedback checkpoints', () => {
    expect(classifyRuntimeBlocker({ error: '401 Missing Authentication header token=secret' })).toMatchObject({
      kind: 'missing-credentials',
      severity: 'high',
      nextAction: 'Ask Jan to restore or approve the required credential path.',
    });
    expect(classifyRuntimeBlocker({ error: 'Denied by guard: write target not allowed' })).toMatchObject({
      kind: 'denied-permission',
      severity: 'high',
    });
    expect(classifyRuntimeBlocker({ error: 'vitest failed with non-zero exit', operation: 'pnpm test' })).toMatchObject({
      kind: 'test-failure',
      severity: 'medium',
    });
    expect(classifyRuntimeBlocker({ error: 'tool crashed unexpectedly' })).toMatchObject({
      kind: 'tool-failure',
      severity: 'high',
    });
    expect(classifyRuntimeBlocker({ error: 'Feedback checkpoint: choose storage adapter' })).toMatchObject({
      kind: 'feedback-checkpoint',
      severity: 'medium',
    });
  });

  it('redacts sensitive details for stored blocker summaries', () => {
    const redacted = redactSensitiveDetails('Authorization: Bearer abc.def.ghi token=supersecret sk-1234567890abcdef ghp_abcdef1234567890');

    expect(redacted).toContain('Bearer [REDACTED]');
    expect(redacted).toContain('token=[REDACTED]');
    expect(redacted).not.toContain('supersecret');
    expect(redacted).not.toContain('sk-1234567890abcdef');
    expect(redacted).not.toContain('ghp_abcdef1234567890');
  });

  it('stores active blocker details and next action linked to task and session refs', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const sessionRef = { heap: 'agent/sessions' as const, id: 'session-1' };
    const taskRef = { heap: 'agent/tasks' as const, id: 'task-1' };

    const blocker = await createRuntimeBlockerBlock({
      memory,
      heap: 'agent/blockers',
      error: 'pnpm test failed with assertion mismatch',
      operation: 'pnpm test',
      sessionRef,
      taskRef,
    });

    expect(blocker).toMatchObject({
      type: 'metadata',
      tags: ['runtime-blocker', 'status:active', 'blocker-kind:test-failure', 'severity:medium', 'session:session-1', 'task:task-1'],
      data: {
        kind: 'test-failure',
        status: 'active',
        title: 'Verification failed',
        nextAction: 'Inspect failing output, fix the concrete failure, then rerun verification.',
        createdForSession: sessionRef,
        createdForTask: taskRef,
      },
      links: [sessionRef, taskRef],
      metadata: { source: 'runtime-blocker-taxonomy', redacted: true },
    });
    expect(blocker.data.details).toContain('pnpm test failed');
  });

  it('resolves blocker blocks audibly and summarizes active blockers for progress reports', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block' });
    const blocker = await createRuntimeBlockerBlock({
      memory,
      heap: 'agent/blockers',
      error: 'permission denied by guard',
      operation: 'write human heap',
      nextAction: 'Ask Jan to approve human heap mutation.',
    });

    expect(summarizeRuntimeBlocker(blocker.data, { heap: blocker.heap, id: blocker.id })).toEqual({
      kind: 'denied-permission',
      title: 'Permission denied',
      nextAction: 'Ask Jan to approve human heap mutation.',
      ref: { heap: blocker.heap, id: blocker.id },
    });

    const resolved = await resolveRuntimeBlocker({
      memory,
      blockerRef: { heap: blocker.heap, id: blocker.id },
      resolution: 'Approved with token=still-secret',
      now: '2026-04-27T23:05:00.000Z',
    });

    expect(resolved.data).toMatchObject({
      status: 'resolved',
      resolvedAt: '2026-04-27T23:05:00.000Z',
      resolution: 'Approved with token=[REDACTED]',
    });
    expect(resolved.tags).toEqual(expect.arrayContaining(['runtime-blocker', 'status:resolved']));
    expect(resolved.tags).not.toContain('status:active');
  });
});
