import { describe, expect, it } from 'vitest';
import { createCodexCliProvider, type CodexCliRunRequest } from './codex-cli-provider.js';

describe('Codex CLI provider', () => {
  it('invokes codex exec with OAuth-backed CLI defaults without reading secrets itself', async () => {
    let captured: CodexCliRunRequest | undefined;
    const provider = createCodexCliProvider('codex', { command: 'codex', timeoutMs: 1_000 }, async (req) => {
      captured = req;
      return 'agent-core-live-ok';
    });

    const result = await provider.complete({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(result.content).toBe('agent-core-live-ok');
    expect(result.model).toBe('gpt-5.5');
    expect(result.toolCalls).toEqual([]);
    expect(captured?.command).toBe('codex');
    expect(captured?.args).toEqual(expect.arrayContaining([
      'exec',
      '--model', 'gpt-5.5',
      '--sandbox', 'read-only',
      '--ephemeral',
      '--output-last-message',
      '-',
    ]));
    expect(captured?.prompt).toContain('USER: ping');
  });

  it('refuses tool-capable turns before Codex can execute anything itself', async () => {
    let called = false;
    const provider = createCodexCliProvider('codex', { command: 'codex', timeoutMs: 1_000 }, async () => {
      called = true;
      return 'should-not-run';
    });

    await expect(provider.complete({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'delete /Users/ulflunge/Desktop/a.md' }],
      tools: [{
        name: 'exec',
        description: 'Execute a shell command through agent-core approval harness',
        parameters: { type: 'object' },
      }],
    })).rejects.toThrow('Tool execution must stay inside the agent-core harness');
    expect(called).toBe(false);
  });
});
