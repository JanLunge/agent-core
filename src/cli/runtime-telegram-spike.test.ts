import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createRuntimeTelegramSpikeRuntime } from './runtime-telegram-spike.js';

describe('runtime telegram spike', () => {
  it('runs realistic turns through durable runtime memory routing guards approvals and audit refs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-core-tg-spike-'));
    const storePath = join(dir, 'memory.json');
    const runtime = createRuntimeTelegramSpikeRuntime({ storePath, baseDir: dir });

    const first = await runtime.handleTurn({
      chatId: '177485465',
      text: 'remember concise morning status and run status tool',
      sender: 'Jan',
      messageId: '1',
    });
    expect(first.text).toContain('agent: mira');
    expect(first.text).toContain('route: default-agent');
    expect(first.text).toContain('spike.status=allow');
    expect(first.text).toContain('output=agent/tool-output#');

    const second = await runtime.handleTurn({
      chatId: '177485465',
      text: 'what did I ask you to remember?',
      sender: 'Jan',
      messageId: '2',
    });
    expect(second.text).toContain('route: existing-channel-binding');
    expect(second.outcome.workingMemory.stats.messageCount).toBe(3);
    expect(second.outcome.workingMemory.text).toContain('remember concise morning status');

    const ops = await runtime.handleTurn({
      chatId: '177485465',
      text: '@ops check this handoff',
      sender: 'Jan',
      messageId: '3',
    });
    expect(ops.text).toContain('agent: ops');
    expect(ops.text).toContain('route: explicit-persona');

    const sensitive = await runtime.handleTurn({
      chatId: '177485465',
      text: '#sensitive please call external API and write note and read .env secret',
      sender: 'Jan',
      messageId: '4',
    });
    expect(sensitive.text).toContain('agent: ops');
    expect(sensitive.text).toContain('sensitivity: sensitive');
    expect(sensitive.text).toContain('model: local/small');
    expect(sensitive.text).toContain('deny (Sensitive mode blocks external/network operations.)');
    expect(sensitive.text).toContain('spike.write-note=ask approval=agent/audit#');
    expect(sensitive.text).toContain('spike.read-secret=deny');

    const persisted = JSON.parse(await readFile(storePath, 'utf8')) as { blocks: Array<{ tags?: string[]; type: string }> };
    expect(persisted.blocks.some((block) => block.tags?.includes('route-record'))).toBe(true);
    expect(persisted.blocks.some((block) => block.tags?.includes('approval-request'))).toBe(true);
    expect(persisted.blocks.some((block) => block.tags?.includes('session-message'))).toBe(true);
  });
});
