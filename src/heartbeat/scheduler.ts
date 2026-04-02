import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentRuntime } from '../agent/agent.js';

export interface HeartbeatConfig {
  intervalMinutes: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  /** Path to a file containing the heartbeat prompt. Re-read each tick. */
  promptFile?: string;
  /** Inline prompt (used if promptFile not set). */
  prompt?: string;
  /** Base directory for resolving relative promptFile paths. */
  baseDir?: string;
}

const DEFAULT_PROMPT =
  'This is a heartbeat check-in. Briefly note anything worth remembering or acting on. If nothing, just say HEARTBEAT_OK.';

export class HeartbeatScheduler {
  private config: HeartbeatConfig;
  private agent: AgentRuntime;
  private channelId: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: {
    config: HeartbeatConfig;
    agent: AgentRuntime;
    channelId: string;
  }) {
    this.config = opts.config;
    this.agent = opts.agent;
    this.channelId = opts.channelId;
  }

  start(): void {
    if (this.timer) return;
    const ms = this.config.intervalMinutes * 60_000;
    this.timer = setInterval(() => { void this.tick(); }, ms);

    const source = this.config.promptFile
      ? `from ${this.config.promptFile}`
      : this.config.prompt
        ? 'inline prompt'
        : 'default prompt';
    console.log(`[heartbeat] started — every ${this.config.intervalMinutes}m (${source})`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[heartbeat] stopped');
    }
  }

  private isQuietHour(): boolean {
    const { quietHoursStart, quietHoursEnd } = this.config;
    if (quietHoursStart == null || quietHoursEnd == null) return false;
    const hour = new Date().getHours();
    if (quietHoursStart <= quietHoursEnd) {
      return hour >= quietHoursStart && hour < quietHoursEnd;
    }
    return hour >= quietHoursStart || hour < quietHoursEnd;
  }

  private loadPrompt(): string {
    // Try file first (re-read each tick so edits take effect)
    if (this.config.promptFile) {
      const filePath = this.config.baseDir
        ? resolve(this.config.baseDir, this.config.promptFile)
        : this.config.promptFile;
      if (existsSync(filePath)) {
        return readFileSync(filePath, 'utf-8').trim();
      }
      console.warn(`[heartbeat] prompt file not found: ${filePath}, using fallback`);
    }
    return this.config.prompt ?? DEFAULT_PROMPT;
  }

  private async tick(): Promise<void> {
    if (this.isQuietHour()) {
      console.log('[heartbeat] skipped — quiet hours');
      return;
    }
    const prompt = this.loadPrompt();
    try {
      const result = await this.agent.processMessage(this.channelId, prompt);
      // Log a short summary
      const summary = result.reply.length > 150
        ? result.reply.slice(0, 150) + '...'
        : result.reply;
      console.log(`[heartbeat] ${summary}`);
    } catch (err) {
      console.error('[heartbeat] error:', err);
    }
  }
}
