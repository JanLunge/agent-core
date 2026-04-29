import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalHeaperMemory } from '../heaper/local-storage.js';
import type { LLMProvider, LLMRequest, LLMResponse, StreamChunk } from '../llm/types.js';
import { runRuntimeDogfood } from './runtime-dogfood.js';

async function writeProjectConfig(options: { provider?: string; apiKeyEnv?: string } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-core-dogfood-'));
  await mkdir(join(dir, 'roles'));
  await mkdir(join(dir, 'agents'));
  await writeFile(join(dir, 'config.yaml'), [
    'default_provider: dogfood-provider',
    'providers:',
    '  - name: dogfood-provider',
    `    type: ${options.provider ?? 'openai-compatible'}`,
    ...(options.apiKeyEnv ? [`    api_key_env: ${options.apiKeyEnv}`] : []),
    'runtime_memory:',
    '  kind: local',
  ].join('\n'));
  await writeFile(join(dir, 'roles', 'assistant.yaml'), [
    'name: assistant',
    'description: Dogfood role',
    'default_model: dogfood-model',
    'system_prompt: Be useful in the dogfood path.',
  ].join('\n'));
  await writeFile(join(dir, 'agents', 'mira.yaml'), [
    'name: mira',
    'role: assistant',
    'provider: dogfood-provider',
    'model: dogfood-model',
  ].join('\n'));
  return dir;
}

function provider(response = 'provider-backed dogfood reply'): LLMProvider & { requests: LLMRequest[] } {
  const requests: LLMRequest[] = [];
  return {
    name: 'test-provider',
    requests,
    async complete(req: LLMRequest): Promise<LLMResponse> {
      requests.push(req);
      return {
        content: response,
        toolCalls: [],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
        model: req.model,
      };
    },
    async *stream(): AsyncIterable<StreamChunk> {},
  };
}

describe('runRuntimeDogfood', () => {
  it('runs a Telegram-shaped local turn through durable runtime state and an explicit provider seam', async () => {
    const baseDir = await writeProjectConfig();
    const storePath = join(baseDir, 'data', 'dogfood-memory.json');
    const testProvider = provider();

    const result = await runRuntimeDogfood({
      baseDir,
      message: 'summarize the beta path',
      storePath,
      provider: testProvider,
      now: () => '2026-04-29T12:25:00.000Z',
    });

    expect(result.blocked).toBe(false);
    expect(result.reply).toBe('provider-backed dogfood reply');
    expect(result.storePath).toBe(storePath);
    expect(result.lines).toEqual([
      'Runtime dogfood completed',
      `Store: ${storePath}`,
      'Model: dogfood-model',
      'Reply: provider-backed dogfood reply',
      'Event: agent/audit#dogfood-1',
      'Route: agent/audit#dogfood-3',
      'Model decision: agent/audit#dogfood-4',
      'User message: persona/mira/sessions#dogfood-5',
      'Assistant message: persona/mira/sessions#dogfood-6',
      `Runtime status: pnpm --silent tsx src/cli/index.ts runtime-status --store ${storePath}`,
      `Audit export: pnpm --silent tsx src/cli/index.ts audit-export agent/audit#dogfood-1 --store ${storePath}`,
    ]);
    expect(testProvider.requests).toHaveLength(1);
    expect(testProvider.requests[0]).toMatchObject({ model: 'dogfood-model' });
    expect(testProvider.requests[0].messages.map((message) => message.role)).toEqual(['system', 'system', 'user']);

    const memory = new LocalHeaperMemory({ filePath: storePath });
    await expect(memory.getBlock(result.refs.event!)).resolves.toMatchObject({ tags: ['runtime-event', 'source:chat', 'mode:live'] });
    await expect(memory.getBlock(result.refs.assistantMessage!)).resolves.toMatchObject({
      data: { role: 'assistant', content: 'provider-backed dogfood reply', sessionId: 'mira-dogfood-1' },
    });
  });

  it('fails with a clear blocker when configured provider credentials are missing', async () => {
    const baseDir = await writeProjectConfig({ apiKeyEnv: 'DOGFOOD_PROVIDER_KEY_MISSING' });

    const result = await runRuntimeDogfood({ baseDir, message: 'hello' });

    expect(result.blocked).toBe(true);
    expect(result.lines).toEqual([
      'Runtime dogfood blocked',
      'Store: not-created',
      'Blocker: Provider dogfood-provider requires credentials; set DOGFOOD_PROVIDER_KEY_MISSING or configure a vault secret',
    ]);
  });
});
