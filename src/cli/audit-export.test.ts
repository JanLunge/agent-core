import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import { LocalHeaperMemory } from '../heaper/local-storage.js';
import { exportAuditTrail, parseBlockRef, runAuditExport } from './audit-export.js';

describe('audit export', () => {
  it('exports a deterministic linked runtime trail from a session ref', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'block', now: () => '2026-04-28T15:00:00.000Z' });
    const session = await memory.createBlock({ heap: 'agent/sessions', type: 'session', data: { sessionId: 'mira-1' }, tags: ['session'] });
    const event = await memory.createBlock({ heap: 'agent/audit', type: 'metadata', data: { event: { id: 'evt-1', content: 'hello' } }, tags: ['runtime-event'], links: [{ heap: session.heap, id: session.id }] });
    const route = await memory.createBlock({ heap: 'agent/audit', type: 'metadata', data: { route: { reason: 'explicit-persona' } }, tags: ['route-record'], links: [{ heap: event.heap, id: event.id }, { heap: session.heap, id: session.id }] });
    const model = await memory.createBlock({ heap: 'agent/audit', type: 'metadata', data: { model: { model: 'remote/default' } }, tags: ['model-decision'], links: [{ heap: route.heap, id: route.id }] });
    const guard = await memory.createBlock({ heap: 'agent/audit', type: 'metadata', data: { guard: { disposition: 'ask' } }, tags: ['guard-decision'], links: [{ heap: route.heap, id: route.id }] });
    const approval = await memory.createBlock({ heap: 'agent/approvals', type: 'proposal', data: { status: 'pending', proposedOperation: { target: '/workspace/out.txt' } }, tags: ['approval-request'], links: [{ heap: guard.heap, id: guard.id }, { heap: session.heap, id: session.id }] });
    const tool = await memory.createBlock({ heap: 'agent/audit', type: 'metadata', data: { tool: { name: 'file.write' } }, tags: ['tool-intent'], links: [{ heap: approval.heap, id: approval.id }] });
    const output = await memory.createBlock({ heap: 'agent/tool-output', type: 'tool-output', data: { name: 'file.write', output: 'ok' }, tags: ['tool-output'], links: [{ heap: tool.heap, id: tool.id }] });
    const blocker = await memory.createBlock({ heap: 'agent/blockers', type: 'metadata', data: { details: 'Error: token=supersecret', title: 'Missing credentials' }, tags: ['runtime-blocker'], links: [{ heap: session.heap, id: session.id }] });
    const result = await memory.createBlock({ heap: 'agent/results', type: 'text', data: { summary: 'done' }, tags: ['task-result'], links: [{ heap: session.heap, id: session.id }] });

    const text = await exportAuditTrail({ memory, startRef: { heap: session.heap, id: session.id }, maxDepth: 5 });

    expect(text).toContain(`Audit trail from agent/sessions#${session.id}`);
    for (const block of [event, route, model, guard, approval, tool, output, blocker, result]) {
      expect(text).toContain(`${block.heap}#${block.id}`);
    }
    expect(text).toContain('[event]');
    expect(text).toContain('[route]');
    expect(text).toContain('[model]');
    expect(text).toContain('[guard]');
    expect(text).toContain('[approval]');
    expect(text).toContain('[tool]');
    expect(text).toContain('[tool-output]');
    expect(text).toContain('[blocker]');
    expect(text).toContain('[result]');
    expect(text).toContain('token=[REDACTED]');
    expect(text).not.toContain('supersecret');
  });

  it('redacts secret-like fields across nested metadata tool and proposal blocks while preserving context', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'secret', now: () => '2026-04-28T15:02:00.000Z' });
    const session = await memory.createBlock({ heap: 'agent/sessions', type: 'session', data: { sessionId: 'mira-secret' }, tags: ['session'] });
    await memory.createBlock({
      heap: 'agent/audit',
      type: 'metadata',
      tags: ['runtime-event'],
      links: [{ heap: session.heap, id: session.id }],
      data: {
        event: {
          id: 'evt-secret',
          content: 'call API',
          headers: {
            Authorization: 'Bearer bearer-token-value',
            'x-api-key': 'header-api-key-value',
            Accept: 'application/json',
          },
          nested: [{ token: 'nested-token-value', safe: 'keep-me' }],
        },
      },
    });
    await memory.createBlock({
      heap: 'agent/audit',
      type: 'metadata',
      tags: ['tool-intent'],
      links: [{ heap: session.heap, id: session.id }],
      data: {
        tool: {
          name: 'api.call',
          args: {
            api_key: 'tool-api-key-value',
            payload: ['Bearer array-bearer-value', { password: 'array-password-value', label: 'visible-label' }],
          },
        },
      },
    });
    await memory.createBlock({
      heap: 'agent/approvals',
      type: 'proposal',
      tags: ['approval-request'],
      links: [{ heap: session.heap, id: session.id }],
      data: {
        status: 'pending',
        proposedOperation: {
          target: 'https://example.test',
          clientSecret: 'proposal-secret-value',
          reason: 'visible approval context',
        },
      },
    });

    const text = await exportAuditTrail({ memory, startRef: { heap: session.heap, id: session.id }, maxDepth: 2 });

    expect(text).toContain('"Accept":"application/json"');
    expect(text).toContain('"safe":"keep-me"');
    expect(text).toContain('"name":"api.call"');
    expect(text).toContain('"label":"visible-label"');
    expect(text).toContain('"reason":"visible approval context"');
    expect(text).toContain('"Authorization":"[REDACTED]"');
    expect(text).toContain('"x-api-key":"[REDACTED]"');
    expect(text).toContain('"token":"[REDACTED]"');
    expect(text).toContain('"api_key":"[REDACTED]"');
    expect(text).toContain('"password":"[REDACTED]"');
    expect(text).toContain('"clientSecret":"[REDACTED]"');
    expect(text).toContain('Bearer [REDACTED]');
    for (const secret of ['bearer-token-value', 'header-api-key-value', 'nested-token-value', 'tool-api-key-value', 'array-bearer-value', 'array-password-value', 'proposal-secret-value']) {
      expect(text).not.toContain(secret);
    }
  });

  it('runs against LocalHeaperMemory stores and parses refs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-core-audit-export-'));
    const storePath = join(dir, 'memory.json');
    const memory = new LocalHeaperMemory({ filePath: storePath, idPrefix: 'local', now: () => '2026-04-28T15:01:00.000Z' });
    const task = await memory.createBlock({ heap: 'agent/tasks', type: 'task', data: { status: 'done', title: 'inspect' }, tags: ['task'] });
    await memory.createBlock({ heap: 'agent/results', type: 'text', data: { summary: 'result' }, tags: ['task-result'], links: [{ heap: task.heap, id: task.id }] });

    expect(parseBlockRef('agent/tasks#local-1')).toEqual({ heap: 'agent/tasks', id: 'local-1' });
    const text = await runAuditExport({ storePath, ref: 'agent/tasks#local-1' });

    expect(text).toContain('agent/tasks#local-1 [task]');
    expect(text).toContain('agent/results#local-2 [result]');
  });

  it('rejects invalid refs and missing start blocks', async () => {
    expect(() => parseBlockRef('not-a-ref')).toThrow('Expected heap#id');
    const memory = new InMemoryHeaperMemory();
    await expect(exportAuditTrail({ memory, startRef: { heap: 'agent/tasks', id: 'missing' } })).rejects.toThrow('Audit start block not found');
  });
});
