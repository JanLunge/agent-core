import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateProgressReport } from './progress.js';

const ROADMAP = `# Roadmap

## Feedback Checkpoints

1. **Heaper API shape conflict** — ask Jan if block operations stop fitting Heaper.
2. **External data movement** — ask Jan before sending sensitive data remotely.

## Current Progress

- [x] old item

## Active Slice Queue

### Slice 13 — Proposal flow ✅

Status: implemented.

### Slice 14 — Interface adapters ✅

Status: implemented.

### Slice 15 — Progress reporter

Goal: report status.

### Slice 16 — Runtime orchestration skeleton

Goal: runtime.

### Slice 17 — Fake agent harness

Goal: fake.

- [blocked] Waiting on Jan for a product call.
`;

function tempRoadmap(): { cwd: string; roadmapPath: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-core-progress-'));
  const roadmapPath = join(cwd, 'ROADMAP.md');
  writeFileSync(roadmapPath, ROADMAP);
  return { cwd, roadmapPath };
}

describe('generateProgressReport', () => {
  it('includes latest commit, verification status, completed/current/next slices, blockers, and checkpoints', () => {
    const { cwd, roadmapPath } = tempRoadmap();

    const report = generateProgressReport({
      cwd,
      roadmapPath,
      exec: () => 'abc1234 Add progress reporter\n',
      testStatus: { command: 'pnpm test -- src/reporting/progress.test.ts', status: 'passed', details: '5 tests' },
      typecheckStatus: { command: 'pnpm typecheck', status: 'passed' },
    });

    expect(report.latestCommit).toBe('abc1234 Add progress reporter');
    expect(report.verification.test.status).toBe('passed');
    expect(report.completedSlices).toEqual(['Slice 13 — Proposal flow', 'Slice 14 — Interface adapters']);
    expect(report.activeSlice).toBe('Slice 15 — Progress reporter');
    expect(report.nextSlices).toEqual(['Slice 16 — Runtime orchestration skeleton', 'Slice 17 — Fake agent harness']);
    expect(report.blockers).toEqual(['Waiting on Jan for a product call.']);
    expect(report.feedbackCheckpoints).toEqual([
      'Heaper API shape conflict — ask Jan if block operations stop fitting Heaper.',
      'External data movement — ask Jan before sending sensitive data remotely.',
    ]);
    expect(report.text).toContain('Latest commit: abc1234 Add progress reporter');
    expect(report.text).toContain('Tests: passed (pnpm test -- src/reporting/progress.test.ts — 5 tests)');
    expect(report.text).toContain('Active slice: Slice 15 — Progress reporter');
  });

  it('uses safe defaults when checks are not supplied and no blockers are recorded', () => {
    const { cwd, roadmapPath } = tempRoadmap();
    writeFileSync(roadmapPath, ROADMAP.replace('- [blocked] Waiting on Jan for a product call.\n', ''));

    const report = generateProgressReport({
      cwd,
      roadmapPath,
      exec: () => 'def5678 Another commit\n',
    });

    expect(report.verification).toEqual({
      test: { command: 'pnpm test', status: 'not-run', details: 'not checked by reporter' },
      typecheck: { command: 'pnpm typecheck', status: 'not-run', details: 'not checked by reporter' },
    });
    expect(report.blockers).toEqual(['None recorded']);
  });

  it('understands beta slice queues after the alpha roadmap closes', () => {
    const { cwd, roadmapPath } = tempRoadmap();
    writeFileSync(roadmapPath, `# Roadmap

## Beta Active Slice Queue

### Beta Slice 0 — Product-path audit ✅

Status: completed.

### Beta Slice 1 — Dogfood runtime command with real provider seam ✅

Status: completed.

### Beta Slice 2 — Replace fake agent on dogfood path

Status: active.
`);

    const report = generateProgressReport({ cwd, roadmapPath, exec: () => 'beef123 Beta progress\n' });

    expect(report.completedSlices).toEqual([
      'Beta Slice 0 — Product-path audit',
      'Beta Slice 1 — Dogfood runtime command with real provider seam',
    ]);
    expect(report.activeSlice).toBe('Beta Slice 2 — Replace fake agent on dogfood path');
    expect(report.text).toContain('Completed slice: Beta Slice 1 — Dogfood runtime command with real provider seam');
  });

  it('reports active runtime blockers alongside roadmap blockers', () => {
    const { cwd, roadmapPath } = tempRoadmap();

    const report = generateProgressReport({
      cwd,
      roadmapPath,
      exec: () => 'abc1234 Add blockers\n',
      activeBlockers: [
        {
          kind: 'missing-credentials',
          title: 'Missing credentials',
          nextAction: 'Ask Jan to rerun login.',
          ref: { heap: 'agent/blockers', id: 'blocker-1' },
        },
      ],
    });

    expect(report.blockers).toEqual([
      'Waiting on Jan for a product call.',
      'Missing credentials [missing-credentials] — Ask Jan to rerun login. (agent/blockers#blocker-1)',
    ]);
    expect(report.text).toContain('Missing credentials [missing-credentials]');
  });

  it('reports unknown commit instead of throwing when git lookup fails', () => {
    const { cwd, roadmapPath } = tempRoadmap();

    const report = generateProgressReport({
      cwd,
      roadmapPath,
      exec: () => { throw new Error('git unavailable'); },
    });

    expect(report.latestCommit).toBe('unknown (git unavailable)');
  });
});
