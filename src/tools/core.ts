import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { ToolRegistry } from './registry.js';

const MAX_OUTPUT_BYTES = 20 * 1024;

export function registerCoreTools(registry: ToolRegistry): void {
  // --- read_file ---
  registry.register(
    'read_file',
    'Read a file from disk.',
    {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path (absolute or relative to working directory)',
        },
      },
      required: ['path'],
    },
    async (args, context) => {
      const filePath = resolvePath(args.path as string, context.baseDir);
      try {
        return fs.readFileSync(filePath, 'utf-8');
      } catch (err: unknown) {
        return errorMessage(err);
      }
    },
  );

  // --- write_file ---
  registry.register(
    'write_file',
    'Write content to a file.',
    {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path (absolute or relative to working directory)',
        },
        content: {
          type: 'string',
          description: 'Content to write',
        },
      },
      required: ['path', 'content'],
    },
    async (args, context) => {
      const filePath = resolvePath(args.path as string, context.baseDir);
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, args.content as string, 'utf-8');
        return `Wrote ${filePath}`;
      } catch (err: unknown) {
        return errorMessage(err);
      }
    },
  );

  // --- exec ---
  registry.register(
    'exec',
    'Execute a shell command.',
    {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds, default 30000',
        },
      },
      required: ['command'],
    },
    async (args, context) => {
      const command = args.command as string;
      const timeout = (args.timeout as number) ?? 30_000;
      try {
        const output = execSync(command, {
          cwd: context.baseDir,
          timeout,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          maxBuffer: MAX_OUTPUT_BYTES,
        });
        return truncate(output);
      } catch (err: unknown) {
        if (isExecError(err)) {
          const combined =
            ((err.stdout as string) ?? '') + ((err.stderr as string) ?? '');
          return truncate(`Error: ${err.message}\n${combined}`);
        }
        return errorMessage(err);
      }
    },
  );

  // --- list_directory ---
  registry.register(
    'list_directory',
    'List files and directories.',
    {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path (absolute or relative to working directory)',
        },
      },
      required: ['path'],
    },
    async (args, context) => {
      const dirPath = resolvePath(args.path as string, context.baseDir);
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const lines = entries.map((entry) => {
          if (entry.isDirectory()) {
            return `[DIR]  ${entry.name}`;
          }
          const filePath = path.join(dirPath, entry.name);
          try {
            const stat = fs.statSync(filePath);
            return `[FILE] ${entry.name} (${formatSize(stat.size)})`;
          } catch {
            return `[FILE] ${entry.name}`;
          }
        });
        return lines.join('\n');
      } catch (err: unknown) {
        return errorMessage(err);
      }
    },
  );

  // --- memory_search ---
  registry.register(
    'memory_search',
    "Search the agent's memory.",
    {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
      },
      required: ['query'],
    },
    async (args, context) => {
      if (!context.brain) return 'Memory not available.';
      const query = args.query as string;
      const results = context.brain.search(query);
      if (results.length === 0) return `No memories found for "${query}".`;
      return results
        .map((r) => `[${r.key}] ${r.content}`)
        .join('\n\n');
    },
  );

  // --- schedule_task ---
  registry.register(
    'schedule_task',
    'Schedule a recurring task for the agent. The task will fire on the given schedule and send the prompt to the agent.',
    {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Human-readable description of what this task does',
        },
        schedule: {
          type: 'string',
          description: 'When to run: "every 5m", "every 2h", or "daily at 09:00"',
        },
        prompt: {
          type: 'string',
          description: 'The message to send to the agent when the task fires',
        },
      },
      required: ['description', 'schedule', 'prompt'],
    },
    async (args) => {
      const description = args.description as string;
      const schedule = args.schedule as string;
      return (
        `Task scheduling registered: ${description} (${schedule}). ` +
        'Note: task scheduler must be started via `agent-core start` for tasks to execute.'
      );
    },
  );

  // --- list_tasks ---
  registry.register(
    'list_tasks',
    'List all scheduled tasks for this agent.',
    {
      type: 'object',
      properties: {},
    },
    async () => {
      return 'Task listing not yet wired. Use /tasks command.';
    },
  );

  // --- memory_write ---
  registry.register(
    'memory_write',
    "Write something to the agent's memory. Persists across conversations and restarts.",
    {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Short label for this memory',
        },
        content: {
          type: 'string',
          description: 'What to remember',
        },
      },
      required: ['key', 'content'],
    },
    async (args, context) => {
      if (!context.brain) return 'Memory not available.';
      const key = args.key as string;
      const content = args.content as string;
      context.brain.remember(key, content);
      return `Remembered "${key}".`;
    },
  );
}

// --- helpers ---

function resolvePath(p: string, baseDir: string): string {
  return path.isAbsolute(p) ? p : path.resolve(baseDir, p);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function truncate(output: string): string {
  if (Buffer.byteLength(output, 'utf-8') > MAX_OUTPUT_BYTES) {
    const truncated = Buffer.from(output, 'utf-8')
      .subarray(0, MAX_OUTPUT_BYTES)
      .toString('utf-8');
    return truncated + '\n[output truncated at 20KB]';
  }
  return output;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function isExecError(
  err: unknown,
): err is Error & { stdout?: string; stderr?: string } {
  return err instanceof Error;
}
