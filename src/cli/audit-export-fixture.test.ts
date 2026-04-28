import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { renderTelegramAuditFixture, runTelegramAuditFixture } from './audit-export-fixture.js';

describe('audit export fixture', () => {
  it('creates a Telegram-spike-like store and exports a representative audit trail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-core-audit-fixture-test-'));
    const storePath = join(dir, 'memory.json');

    const result = await runTelegramAuditFixture({ storePath, baseDir: dir, maxDepth: 6 });
    const rendered = renderTelegramAuditFixture(result);

    expect(result.storePath).toBe(storePath);
    expect(result.startRef.heap).toBe('agent/sessions');
    expect(result.auditCommand).toBe(`agent-core audit-export ${result.startRef.heap}#${result.startRef.id} --store ${storePath} --depth 6`);
    expect(result.turns).toHaveLength(4);

    for (const expected of [
      '[session]',
      '[event]',
      '[route]',
      '[model]',
      '[guard]',
      '[approval]',
      '[tool]',
      '[tool-output]',
      '[blocker]',
      '[message]',
      '[daily]',
    ]) {
      expect(result.auditText).toContain(expected);
    }
    expect(result.auditText).toContain('agent/daily#');
    expect(result.auditText).toContain('agent/tool-output#');
    expect(result.auditText).toContain('Sensitive mode blocks external/network operations.');
    expect(rendered).toContain('Audit command: agent-core audit-export');
    expect(rendered).toContain('Turns:');
    expect(rendered).toContain('remember concise morning status and run status tool');
  });
});
