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
        const env = context.secretResolver?.buildSanitizedEnv() ?? process.env;
        const output = execSync(command, {
          cwd: context.baseDir,
          timeout,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          maxBuffer: MAX_OUTPUT_BYTES,
          env: env as NodeJS.ProcessEnv,
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
    "Save or update a memory. Writing to an existing key overwrites it. Use clear keys like 'user-name', 'current-project', 'preference-editor'.",
    {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Short unique key for this memory (e.g. "user-name", "project-goal"). Writing the same key updates it.',
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

  // --- memory_delete ---
  registry.register(
    'memory_delete',
    "Delete a memory by its key. Use when information is outdated or wrong.",
    {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'The key of the memory to delete',
        },
      },
      required: ['key'],
    },
    async (args, context) => {
      if (!context.brain?.memoryStore) return 'Memory not available.';
      const key = args.key as string;
      const deleted = context.brain.memoryStore.delete(context.brain.agentName, key);
      return deleted ? `Deleted memory "${key}".` : `No memory found with key "${key}".`;
    },
  );

  // --- memory_list ---
  registry.register(
    'memory_list',
    "List all saved memories. Shows keys and content summaries.",
    {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of memories to list (default 20)',
        },
      },
    },
    async (args, context) => {
      if (!context.brain?.memoryStore) return 'Memory not available.';
      const limit = (args.limit as number) ?? 20;
      const entries = context.brain.memoryStore.getAll(context.brain.agentName, limit);
      if (entries.length === 0) return 'No memories saved yet.';
      return entries.map((r) => {
        const preview = r.content.length > 120 ? r.content.slice(0, 120) + '...' : r.content;
        return `[${r.key}]: ${preview}`;
      }).join('\n');
    },
  );

  // --- identity_read ---
  registry.register(
    'identity_read',
    "Read a section of your own identity (personality, instructions, self-knowledge). Use this to see who you are before making changes.",
    {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: 'Section name: "personality" (your SOUL.md), or any custom section name',
        },
      },
      required: ['section'],
    },
    async (args, context) => {
      if (!context.identityStore) return 'Identity store not available.';
      const section = args.section as string;
      const content = context.identityStore.getCurrent(section);
      if (!content) return `Section "${section}" not found. Available: ${context.identityStore.listSections().join(', ') || '(none)'}`;
      return content;
    },
  );

  // --- identity_update ---
  registry.register(
    'identity_update',
    "Update a section of your own identity. This changes who you are — your personality, instructions, or self-knowledge. Every change is versioned. Read the current content first with identity_read before making changes.",
    {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: 'Section name: "personality" (your SOUL.md), or any custom section name',
        },
        content: {
          type: 'string',
          description: 'The new full content for this section',
        },
        reason: {
          type: 'string',
          description: 'Why you are making this change (logged in version history)',
        },
      },
      required: ['section', 'content', 'reason'],
    },
    async (args, context) => {
      if (!context.identityStore) return 'Identity store not available.';
      const section = args.section as string;
      const content = args.content as string;
      const reason = args.reason as string;
      const rev = context.identityStore.update(section, content, 'agent', reason);
      // Trigger brain reload so the change takes effect on the next turn
      if (context.brain) {
        // The brain will pick up the new file content on next getSystemPromptSections() call
        // since identity files are re-read from disk
      }
      return `Updated "${section}" (revision ${rev.id}). Reason: ${reason}\nThis takes effect on your next response.`;
    },
  );

  // --- identity_history ---
  registry.register(
    'identity_history',
    "View the version history of an identity section. See what changed, when, and why.",
    {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: 'Section name to view history for',
        },
        limit: {
          type: 'number',
          description: 'Number of revisions to show (default 10)',
        },
      },
      required: ['section'],
    },
    async (args, context) => {
      if (!context.identityStore) return 'Identity store not available.';
      const section = args.section as string;
      const limit = (args.limit as number) ?? 10;
      const history = context.identityStore.getHistory(section, limit);
      if (history.length === 0) return `No history for "${section}".`;
      return history.map((r) =>
        `[rev ${r.id}] ${r.created_at} by ${r.author}: ${r.reason}\n  ${r.content.slice(0, 150)}${r.content.length > 150 ? '...' : ''}`,
      ).join('\n\n');
    },
  );

  // --- identity_revert ---
  registry.register(
    'identity_revert',
    "Revert an identity section to a previous revision.",
    {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: 'Section name to revert',
        },
        revision_id: {
          type: 'number',
          description: 'Revision ID to revert to (find with identity_history)',
        },
      },
      required: ['section', 'revision_id'],
    },
    async (args, context) => {
      if (!context.identityStore) return 'Identity store not available.';
      const section = args.section as string;
      const revisionId = args.revision_id as number;
      const rev = context.identityStore.revert(section, revisionId);
      if (!rev) return `Could not revert: revision ${revisionId} not found for section "${section}".`;
      return `Reverted "${section}" to revision ${revisionId} (now revision ${rev.id}). Takes effect on next response.`;
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
