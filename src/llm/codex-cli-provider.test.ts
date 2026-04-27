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
});
