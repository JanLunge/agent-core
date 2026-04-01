import * as path from 'node:path';
import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import type { Router } from '../router/router.js';

export interface ScheduledTask {
  id: string;
  description: string;
  cron: string;
  agentName: string;
  channelId: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
}

export interface ParsedSchedule {
  intervalMs: number;
  description: string;
}

/**
 * Parse simplified schedule strings into an interval.
 *
 * Supported formats:
 * - "every 5m"       → 5 minutes
 * - "every 2h"       → 2 hours
 * - "daily at 09:00" → fires once per day at the given time (checked every 60s)
 */
export function parseSchedule(cron: string): ParsedSchedule {
  const trimmed = cron.trim().toLowerCase();

  // "every Xm"
  const minuteMatch = trimmed.match(/^every\s+(\d+)\s*m$/);
  if (minuteMatch) {
    const minutes = parseInt(minuteMatch[1], 10);
    return { intervalMs: minutes * 60_000, description: `every ${minutes} minute(s)` };
  }

  // "every Xh"
  const hourMatch = trimmed.match(/^every\s+(\d+)\s*h$/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1], 10);
    return { intervalMs: hours * 3_600_000, description: `every ${hours} hour(s)` };
  }

  // "daily at HH:MM"
  const dailyMatch = trimmed.match(/^daily\s+at\s+(\d{1,2}):(\d{2})$/);
  if (dailyMatch) {
    const hh = dailyMatch[1];
    const mm = dailyMatch[2];
    return { intervalMs: -1, description: `daily at ${hh}:${mm}` };
  }

  throw new Error(
    `Unsupported schedule format: "${cron}". ` +
    'Use "every Xm", "every Xh", or "daily at HH:MM".',
  );
}

export class TaskScheduler {
  private db: Database.Database;
  private router: Router;
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(opts: { dataDir: string; router: Router }) {
    this.router = opts.router;
    fs.mkdirSync(opts.dataDir, { recursive: true });
    this.db = new Database(path.join(opts.dataDir, 'tasks.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id          TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        cron        TEXT NOT NULL,
        agent_name  TEXT NOT NULL,
        channel_id  TEXT NOT NULL,
        prompt      TEXT NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL
      )
    `);
  }

  addTask(task: Omit<ScheduledTask, 'id' | 'createdAt'>): ScheduledTask {
    // Validate the schedule before persisting
    parseSchedule(task.cron);

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO tasks (id, description, cron, agent_name, channel_id, prompt, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, task.description, task.cron, task.agentName, task.channelId, task.prompt, task.enabled ? 1 : 0, createdAt);

    const created: ScheduledTask = { id, createdAt, ...task };

    // If scheduler is running and task is enabled, start it immediately
    if (task.enabled && this.timers.size > 0) {
      this.startTask(created);
    }

    return created;
  }

  removeTask(id: string): boolean {
    // Stop the timer if running
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }

    const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return result.changes > 0;
  }

  listTasks(): ScheduledTask[] {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as Array<{
      id: string;
      description: string;
      cron: string;
      agent_name: string;
      channel_id: string;
      prompt: string;
      enabled: number;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      description: row.description,
      cron: row.cron,
      agentName: row.agent_name,
      channelId: row.channel_id,
      prompt: row.prompt,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
    }));
  }

  start(): void {
    const tasks = this.listTasks().filter((t) => t.enabled);
    for (const task of tasks) {
      this.startTask(task);
    }
    console.log(`[tasks] started ${tasks.length} scheduled task(s)`);
  }

  stop(): void {
    for (const [id, timer] of this.timers) {
      clearInterval(timer);
      this.timers.delete(id);
    }
    console.log('[tasks] stopped all scheduled tasks');
  }

  private startTask(task: ScheduledTask): void {
    const schedule = parseSchedule(task.cron);

    if (schedule.intervalMs === -1) {
      // "daily at HH:MM" — check every 60 seconds
      const match = task.cron.trim().toLowerCase().match(/daily\s+at\s+(\d{1,2}):(\d{2})/);
      if (!match) return;
      const targetHour = parseInt(match[1], 10);
      const targetMinute = parseInt(match[2], 10);
      let firedToday = false;

      const timer = setInterval(() => {
        const now = new Date();
        const isTargetTime = now.getHours() === targetHour && now.getMinutes() === targetMinute;

        if (isTargetTime && !firedToday) {
          firedToday = true;
          void this.fireTask(task);
        }

        // Reset flag after the target minute passes
        if (!isTargetTime) {
          firedToday = false;
        }
      }, 60_000);

      this.timers.set(task.id, timer);
    } else {
      const timer = setInterval(() => {
        void this.fireTask(task);
      }, schedule.intervalMs);
      this.timers.set(task.id, timer);
    }

    console.log(`[tasks] scheduled "${task.description}" (${schedule.description})`);
  }

  private async fireTask(task: ScheduledTask): Promise<void> {
    try {
      const result = await this.router.route({
        channelType: 'scheduled-task',
        chatId: task.channelId,
        text: task.prompt,
        sender: `task:${task.id}`,
      });
      console.log(`[tasks] "${task.description}" → ${result.reply.slice(0, 120)}`);
    } catch (err) {
      console.error(`[tasks] "${task.description}" error:`, err);
    }
  }
}
