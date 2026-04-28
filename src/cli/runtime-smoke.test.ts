import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalHeaperMemory } from '../heaper/local-storage.js';
import { getStoredToolOutput } from '../tools/output-blocks.js';
import { runRuntimeSmoke } from './runtime-smoke.js';

async function tempStorePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-core-cli-smoke-'));
  return join(dir, 'memory.json');
}

describe('runRuntimeSmoke', () => {
  it('accepts a message and persona hint, uses fake fixtures, and writes linked refs to local storage', async () => {
    const storePath = await tempStorePath();

    const result = await runRuntimeSmoke({
      message: 'check deterministic path',
      persona: 'Mira',
      storePath,
      channel: 'test-channel',
    });

    expect(result.reply).toBe('smoke:mira:@mira check deterministic path');
    expect(result.storePath).toBe(storePath);
    expect(result.lines).toEqual([
      'Runtime smoke completed',
      `Store: ${storePath}`,
      'Reply: smoke:mira:@mira check deterministic path',
      'Event: agent/audit#smoke-1',
      'Route: agent/audit#smoke-3',
      'Model: agent/audit#smoke-4 (remote/default)',
      'User message: persona/mira/sessions#smoke-5',
      'Assistant message: persona/mira/sessions#smoke-6',
      'Tool intent: agent/audit#smoke-7',
      'Guard decision: agent/audit#smoke-8 (allow)',
      'Tool output: persona/mira/tool-output#smoke-9',
    ]);

    const memory = new LocalHeaperMemory({ filePath: storePath, idPrefix: 'unused' });
    await expect(memory.getBlock(result.refs.event)).resolves.toMatchObject({
      tags: ['runtime-event', 'source:chat', 'mode:live'],
    });
    await expect(memory.getBlock(result.refs.route)).resolves.toMatchObject({
      tags: expect.arrayContaining(['route-record', 'agent:mira', 'mode:live', 'sensitivity:normal']),
      links: [result.refs.event, { heap: 'persona/mira/sessions', id: 'smoke-2' }],
    });
    await expect(memory.getBlock(result.refs.assistantMessage)).resolves.toMatchObject({
      data: { role: 'assistant', content: 'smoke:mira:@mira check deterministic path' },
      links: [{ heap: 'persona/mira/sessions', id: 'smoke-2' }, result.refs.userMessage, result.refs.route, result.refs.model],
    });
    await expect(memory.getBlock(result.refs.toolIntent)).resolves.toMatchObject({
      links: [result.refs.event, result.refs.route, result.refs.assistantMessage],
    });
    await expect(getStoredToolOutput(memory, result.refs.toolOutput!)).resolves.toMatchObject({
      name: 'local.status',
      output: 'runtime smoke ok for mira',
    });
  });

  it('can create a temporary local store when no store path is configured', async () => {
    const result = await runRuntimeSmoke({ message: 'hello' });

    expect(result.storePath).toContain('agent-core-runtime-smoke-');
    expect(result.lines[0]).toBe('Runtime smoke completed');
    expect(result.refs.event.heap).toBe('agent/audit');
  });

  it('can run twice against a configured local runtime store and see prior blocks', async () => {
    const storePath = await tempStorePath();
    const first = await runRuntimeSmoke({ message: 'first', memoryConfig: { kind: 'local', path: storePath, id_prefix: 'cfg' } });
    const second = await runRuntimeSmoke({ message: 'second', memoryConfig: { kind: 'local', path: storePath, id_prefix: 'cfg' } });

    expect(first.refs.event.id).toBe('cfg-1');
    expect(second.refs.event.id).toBe('cfg-10');
    const memory = new LocalHeaperMemory({ filePath: storePath, idPrefix: 'unused' });
    const messages = await memory.search('first', { heaps: ['persona/mira/sessions'], tags: ['session-message'] });
    expect(messages.map((block) => block.data.content)).toContain('@mira first');
  });
});
