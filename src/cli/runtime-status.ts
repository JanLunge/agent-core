import type { BlockRef, HeaperBlock } from '../heaper/types.js';
import { LocalHeaperMemory } from '../heaper/local-storage.js';
import { scanMemory } from '../heaper/scan.js';

export interface RuntimeStatusOptions {
  storePath: string;
  auditDepth?: number;
  now?: string;
  recentDailyLimit?: number;
  scanLimit?: number;
}

export interface RuntimeStatusSummary {
  storePath: string;
  generatedAt: string;
  counts: {
    sessions: number;
    tasks: number;
    pendingTasks: number;
    runningTasks: number;
    blockedTasks: number;
    activeBlockers: number;
    pendingApprovals: number;
    queuedNotifications: number;
    summarizedNotifications: number;
    recentDailyEntries: number;
  };
  refs: {
    sessions: BlockRef[];
    tasks: BlockRef[];
    blockers: BlockRef[];
    approvals: BlockRef[];
    notifications: BlockRef[];
    dailyEntries: BlockRef[];
  };
  lines: string[];
}

const DEFAULT_RECENT_DAILY_LIMIT = 3;

export async function runRuntimeStatus(options: RuntimeStatusOptions): Promise<RuntimeStatusSummary> {
  const memory = new LocalHeaperMemory({ filePath: options.storePath });
  const scan = await scanMemory({ memory, maxResults: options.scanLimit });
  const blocks = scan.blocks;
  const sessions = byCreated(blocks.filter((block) => block.type === 'session' && block.tags.includes('session')));
  const tasks = byCreated(blocks.filter((block) => block.type === 'task' && block.tags.includes('task')));
  const activeBlockers = byCreated(blocks.filter((block) => block.tags.includes('runtime-blocker') && statusFor(block) === 'active'));
  const pendingApprovals = byCreated(blocks.filter((block) => block.tags.includes('approval-request') && statusFor(block) === 'pending'));
  const queuedNotifications = byCreated(blocks.filter((block) => block.tags.includes('notification-outbox') && statusFor(block) === 'queued'));
  const summarizedNotifications = byCreated(blocks.filter((block) => block.tags.includes('notification-outbox') && statusFor(block) === 'summarized'));
  const dailyEntries = byUpdatedDesc(blocks.filter((block) => block.type === 'daily-entry' && block.tags.includes('daily-entry')))
    .slice(0, options.recentDailyLimit ?? DEFAULT_RECENT_DAILY_LIMIT);

  const summary: RuntimeStatusSummary = {
    storePath: options.storePath,
    generatedAt: options.now ?? new Date().toISOString(),
    counts: {
      sessions: sessions.length,
      tasks: tasks.length,
      pendingTasks: countStatus(tasks, 'pending'),
      runningTasks: countStatus(tasks, 'running'),
      blockedTasks: countStatus(tasks, 'blocked'),
      activeBlockers: activeBlockers.length,
      pendingApprovals: pendingApprovals.length,
      queuedNotifications: queuedNotifications.length,
      summarizedNotifications: summarizedNotifications.length,
      recentDailyEntries: dailyEntries.length,
    },
    refs: {
      sessions: sessions.map(refFor),
      tasks: tasks.map(refFor),
      blockers: activeBlockers.map(refFor),
      approvals: pendingApprovals.map(refFor),
      notifications: [...queuedNotifications, ...summarizedNotifications].map(refFor),
      dailyEntries: dailyEntries.map(refFor),
    },
    lines: [],
  };
  summary.lines = renderRuntimeStatus(summary, { auditDepth: options.auditDepth ?? 5 });
  return summary;
}

export function renderRuntimeStatusJson(summary: RuntimeStatusSummary): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}

export function renderRuntimeStatus(summary: RuntimeStatusSummary, options: { auditDepth?: number } = {}): string[] {
  const auditDepth = options.auditDepth ?? 5;
  return [
    `Runtime status for ${summary.storePath}`,
    `Generated: ${summary.generatedAt}`,
    '',
    'Counts:',
    `- sessions: ${summary.counts.sessions}`,
    `- tasks: ${summary.counts.tasks} (pending=${summary.counts.pendingTasks}, running=${summary.counts.runningTasks}, blocked=${summary.counts.blockedTasks})`,
    `- active blockers: ${summary.counts.activeBlockers}`,
    `- pending approvals: ${summary.counts.pendingApprovals}`,
    `- notifications: queued=${summary.counts.queuedNotifications}, summarized=${summary.counts.summarizedNotifications}`,
    `- recent daily entries: ${summary.counts.recentDailyEntries}`,
    '',
    'Refs for drill-down:',
    ...renderRefGroup('sessions', summary.refs.sessions, summary.storePath, auditDepth),
    ...renderRefGroup('tasks', summary.refs.tasks, summary.storePath, auditDepth),
    ...renderRefGroup('blockers', summary.refs.blockers, summary.storePath, auditDepth),
    ...renderRefGroup('approvals', summary.refs.approvals, summary.storePath, auditDepth),
    ...renderRefGroup('notifications', summary.refs.notifications, summary.storePath, auditDepth),
    ...renderRefGroup('daily', summary.refs.dailyEntries, summary.storePath, auditDepth),
  ];
}

function renderRefGroup(label: string, refs: BlockRef[], storePath: string, auditDepth: number): string[] {
  if (refs.length === 0) return [`- ${label}: none`];
  return [`- ${label}:`, ...refs.map((ref) => `  - ${formatRef(ref)} | audit: agent-core audit-export ${formatRef(ref)} --store ${storePath} --depth ${auditDepth}`)];
}

function statusFor(block: HeaperBlock): string | undefined {
  const status = block.data.status;
  if (typeof status === 'string') return status;
  return block.tags.find((tag) => tag.startsWith('status:'))?.slice('status:'.length);
}

function countStatus(blocks: HeaperBlock[], status: string): number {
  return blocks.filter((block) => statusFor(block) === status).length;
}

function byCreated(blocks: HeaperBlock[]): HeaperBlock[] {
  return [...blocks].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function byUpdatedDesc(blocks: HeaperBlock[]): HeaperBlock[] {
  return [...blocks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
}

function refFor(block: HeaperBlock): BlockRef {
  return { heap: block.heap, id: block.id };
}

function formatRef(ref: BlockRef): string {
  return `${ref.heap}#${ref.id}`;
}
