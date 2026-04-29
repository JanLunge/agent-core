import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BlockRef } from '../heaper/types.js';
import type { RuntimeBlockerKind } from '../runtime/blockers.js';

export interface ProgressReporterOptions {
  cwd: string;
  roadmapPath?: string;
  exec?: (command: string, args: string[], cwd: string) => string;
  testStatus?: VerificationStatus;
  typecheckStatus?: VerificationStatus;
  activeBlockers?: ActiveBlockerSummary[];
}

export interface ActiveBlockerSummary {
  kind: RuntimeBlockerKind;
  title: string;
  nextAction: string;
  ref?: BlockRef;
}

export interface VerificationStatus {
  command: string;
  status: 'passed' | 'failed' | 'not-run';
  details?: string;
}

export interface ProgressReport {
  latestCommit: string;
  verification: {
    test: VerificationStatus;
    typecheck: VerificationStatus;
  };
  completedSlices: string[];
  activeSlice?: string;
  nextSlices: string[];
  blockers: string[];
  feedbackCheckpoints: string[];
  text: string;
}

const DEFAULT_TEST_STATUS: VerificationStatus = { command: 'pnpm test', status: 'not-run', details: 'not checked by reporter' };
const DEFAULT_TYPECHECK_STATUS: VerificationStatus = { command: 'pnpm typecheck', status: 'not-run', details: 'not checked by reporter' };

export function generateProgressReport(options: ProgressReporterOptions): ProgressReport {
  const roadmap = readFileSync(options.roadmapPath ?? join(options.cwd, 'docs/ROADMAP.md'), 'utf8');
  const latestCommit = latestCommitFor(options);
  const slices = parseSlices(roadmap);
  const activeIndex = slices.findIndex((slice) => !slice.completed);
  const completedSlices = (activeIndex >= 0 ? slices.slice(0, activeIndex) : slices)
    .filter((slice) => slice.completed)
    .map((slice) => slice.title);
  const activeSlice = activeIndex >= 0 ? slices[activeIndex].title : undefined;
  const nextSlices = activeIndex >= 0 ? slices.slice(activeIndex + 1, activeIndex + 4).map((slice) => slice.title) : [];
  const blockers = mergeActiveBlockers(parseBlockers(roadmap), options.activeBlockers);
  const feedbackCheckpoints = parseFeedbackCheckpoints(roadmap);

  const report: Omit<ProgressReport, 'text'> = {
    latestCommit,
    verification: {
      test: options.testStatus ?? DEFAULT_TEST_STATUS,
      typecheck: options.typecheckStatus ?? DEFAULT_TYPECHECK_STATUS,
    },
    completedSlices,
    activeSlice,
    nextSlices,
    blockers,
    feedbackCheckpoints,
  };

  return { ...report, text: renderProgressReport(report) };
}

function latestCommitFor(options: ProgressReporterOptions): string {
  const exec = options.exec ?? defaultExec;
  try {
    return exec('git', ['log', '-1', '--pretty=%h %s'], options.cwd).trim();
  } catch (err) {
    return `unknown (${(err as Error).message})`;
  }
}

function defaultExec(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8' });
}

function parseSlices(roadmap: string): Array<{ title: string; completed: boolean }> {
  return Array.from(roadmap.matchAll(/^###\s+((?:Beta\s+)?Slice\s+\d+\s+—\s+.+)$/gm), (match) => ({
    title: match[1].replace(/\s+✅\s*$/, '').trim(),
    completed: match[0].includes('✅'),
  }));
}

function parseBlockers(roadmap: string): string[] {
  const blockers = Array.from(roadmap.matchAll(/^[-*]\s+\[blocked\]\s+(.+)$/gim), (match) => match[1].trim());
  return blockers.length > 0 ? blockers : ['None recorded'];
}

function mergeActiveBlockers(roadmapBlockers: string[], activeBlockers?: ActiveBlockerSummary[]): string[] {
  const active = (activeBlockers ?? []).map((blocker) => {
    const ref = blocker.ref ? ` (${blocker.ref.heap}#${blocker.ref.id})` : '';
    return `${blocker.title} [${blocker.kind}] — ${blocker.nextAction}${ref}`;
  });
  if (active.length === 0) return roadmapBlockers;
  const staticBlockers = roadmapBlockers.filter((blocker) => blocker !== 'None recorded');
  return [...staticBlockers, ...active];
}

function parseFeedbackCheckpoints(roadmap: string): string[] {
  const section = roadmap.match(/## Feedback Checkpoints\n\n([\s\S]*?)(?:\n## |$)/)?.[1] ?? '';
  return Array.from(section.matchAll(/^\d+\.\s+\*\*(.*?)\*\*\s+—\s+(.+)$/gm), (match) => `${match[1]} — ${match[2]}`.trim());
}

function renderProgressReport(report: Omit<ProgressReport, 'text'>): string {
  const completed = report.completedSlices.at(-1) ?? 'None yet';
  const active = report.activeSlice ?? 'No active slice';
  const next = report.nextSlices.length > 0 ? report.nextSlices.map((slice) => `- ${slice}`).join('\n') : '- None queued';
  const blockers = report.blockers.map((blocker) => `- ${blocker}`).join('\n');
  const checkpoints = report.feedbackCheckpoints.slice(0, 6).map((checkpoint) => `- ${checkpoint}`).join('\n');

  return [
    `Latest commit: ${report.latestCommit}`,
    `Tests: ${formatVerification(report.verification.test)}`,
    `Typecheck: ${formatVerification(report.verification.typecheck)}`,
    `Completed slice: ${completed}`,
    `Active slice: ${active}`,
    'Next slices:',
    next,
    'Blockers:',
    blockers,
    'Feedback checkpoints:',
    checkpoints || '- None recorded',
  ].join('\n');
}

function formatVerification(status: VerificationStatus): string {
  return `${status.status} (${status.command}${status.details ? ` — ${status.details}` : ''})`;
}
