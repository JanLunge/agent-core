import { describe, expect, it } from 'vitest';
import { InMemoryHeaperMemory } from '../heaper/memory.js';
import { getStoredToolOutput, storeToolOutput } from './output-blocks.js';
import type { ToolResult } from './executor.js';

function toolResult(result: string): ToolResult {
  return { toolCallId: 'call-1', name: 'shell.exec', result, durationMs: 25 };
}

describe('tool output blocks', () => {
  it('passes small output directly without storing a block', async () => {
    const memory = new InMemoryHeaperMemory();

    const stored = await storeToolOutput({
      memory,
      heap: 'agent/tool-output',
      directBytes: 100,
      result: toolResult('short result'),
    });

    expect(stored).toMatchObject({ stored: false, result: { result: 'short result' } });
    await expect(memory.search('short result', { types: ['tool-output'] })).resolves.toEqual([]);
  });

  it('stores large output and returns a bounded reference summary', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'tool', now: () => '2026-04-27T04:00:00.000Z' });
    const output = `alpha ${'x'.repeat(120)} omega`;

    const stored = await storeToolOutput({
      memory,
      heap: 'agent/tool-output',
      directBytes: 20,
      summaryBytes: 16,
      result: toolResult(output),
      tags: ['session:c-1'],
    });

    expect(stored.stored).toBe(true);
    if (!stored.stored) throw new Error('expected stored output');
    expect(stored.blockRef).toEqual({ heap: 'agent/tool-output', id: 'tool-1' });
    expect(stored.result.result).toContain('[full tool output stored: agent/tool-output#tool-1;');
    expect(stored.result.result.length).toBeLessThan(output.length);
    expect(stored.block).toMatchObject({
      type: 'tool-output',
      tags: ['tool-output', 'tool:shell.exec', 'session:c-1'],
      data: { toolCallId: 'call-1', name: 'shell.exec', output, durationMs: 25 },
    });
  });

  it('retrieves full stored output by reference', async () => {
    const memory = new InMemoryHeaperMemory({ idPrefix: 'tool' });
    const stored = await storeToolOutput({
      memory,
      heap: 'agent/tool-output',
      directBytes: 5,
      result: toolResult('full output body'),
    });

    if (!stored.stored) throw new Error('expected stored output');
    await expect(getStoredToolOutput(memory, stored.blockRef)).resolves.toMatchObject({
      toolCallId: 'call-1',
      name: 'shell.exec',
      output: 'full output body',
    });
  });

  it('keeps stored output searchable through the memory API', async () => {
    const memory = new InMemoryHeaperMemory();
    await storeToolOutput({
      memory,
      heap: 'agent/tool-output',
      directBytes: 5,
      result: toolResult('needle-in-long-output'),
    });

    const hits = await memory.search('needle-in-long-output', { types: ['tool-output'] });
    expect(hits).toHaveLength(1);
    expect(hits[0].data.output).toBe('needle-in-long-output');
  });
});
