import type { AgentRuntime } from '../agent/agent.js';

export interface HeartbeatConfig {
  intervalMinutes: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  prompt?: string;
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
    console.log(`[heartbeat] started — every ${this.config.intervalMinutes}m`);
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

  private async tick(): Promise<void> {
    if (this.isQuietHour()) {
      console.log('[heartbeat] skipped — quiet hours');
      return;
    }
    const prompt = this.config.prompt ?? DEFAULT_PROMPT;
    try {
      const result = await this.agent.processMessage(this.channelId, prompt);
      console.log(`[heartbeat] ${result.reply}`);
    } catch (err) {
      console.error('[heartbeat] error:', err);
    }
  }
}
