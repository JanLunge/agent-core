import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { LLMProvider, LLMRequest, LLMResponse, Message, StreamChunk } from './types.js';

export interface CodexCliProviderOptions {
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  sandbox?: 'read-only' | 'workspace-write';
}

export interface CodexCliRunRequest {
  command: string;
  args: string[];
  prompt: string;
  cwd?: string;
  timeoutMs: number;
  outputFile: string;
}

export type CodexCliRunner = (req: CodexCliRunRequest) => Promise<string>;

function renderMessages(messages: Message[]): string {
  return messages.map((message) => {
    const label = message.role.toUpperCase();
    return `${label}: ${message.content}`;
  }).join('\n\n');
}

function buildPrompt(req: LLMRequest): string {
  return renderMessages(req.messages);
}

async function defaultCodexCliRunner(req: CodexCliRunRequest): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(req.command, req.args, {
      cwd: req.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Codex CLI timed out after ${req.timeoutMs}ms`));
    }, req.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Codex CLI exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const final = await readFile(req.outputFile, 'utf8');
        resolve(final.trim() || stdout.trim());
      } catch {
        resolve(stdout.trim());
      }
    });

    child.stdin.end(req.prompt);
  });
}

export function createCodexCliProvider(
  name: string,
  opts: CodexCliProviderOptions = {},
  runner: CodexCliRunner = defaultCodexCliRunner,
): LLMProvider {
  return {
    name,

    async complete(req: LLMRequest): Promise<LLMResponse> {
      if (req.tools?.length) {
        throw new Error('Codex CLI provider cannot run tool-capable turns. Tool execution must stay inside the agent-core harness with approval/audit; configure a function-calling provider or use a non-tool request.');
      }

      const dir = await mkdtemp(join(tmpdir(), 'agent-core-codex-'));
      const outputFile = join(dir, 'last-message.txt');
      const command = opts.command ?? 'codex';
      const timeoutMs = opts.timeoutMs ?? 120_000;
      const args = [
        'exec',
        '--model', req.model,
        '--sandbox', opts.sandbox ?? 'read-only',
        '--ephemeral',
        '--output-last-message', outputFile,
        '-',
      ];

      try {
        const content = await runner({
          command,
          args,
          prompt: buildPrompt(req),
          cwd: opts.cwd,
          timeoutMs,
          outputFile,
        });

        return {
          content,
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
          model: req.model,
        };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },

    async *stream(req: LLMRequest): AsyncIterable<StreamChunk> {
      const response = await this.complete(req);
      if (response.content) yield { type: 'text', text: response.content };
      yield { type: 'done', finishReason: response.finishReason, usage: response.usage };
    },
  };
}
