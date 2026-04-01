import type { TraceStore } from './trace.js';
import { createTraceQuery, getToolStats, getUserCorrections } from './query.js';

export interface ReviewFinding {
  type: 'tool_failure' | 'user_correction' | 'slow_turn' | 'repeated_error';
  description: string;
  traceIds: number[];
  suggestion: string;
}

const SLOW_TURN_THRESHOLD_MS = 30_000;
const REPEATED_ERROR_THRESHOLD = 3;
const TOOL_FAILURE_RATE_THRESHOLD = 0.3;
const RECENT_TRACE_LIMIT = 100;

export function reviewTraces(store: TraceStore): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  const recentTraces = createTraceQuery(store)
    .limit(RECENT_TRACE_LIMIT)
    .execute();

  // --- Tool failures: tools with >30% error rate ---
  const stats = getToolStats(store);
  for (const tool of stats) {
    if (tool.count > 0 && tool.errorCount / tool.count > TOOL_FAILURE_RATE_THRESHOLD) {
      const rate = Math.round((tool.errorCount / tool.count) * 100);
      const traceIds = recentTraces
        .filter(t => t.toolCalls.some(tc => tc.name === tool.name && tc.error))
        .map(t => t.id);

      findings.push({
        type: 'tool_failure',
        description: `Tool "${tool.name}" has a ${rate}% error rate (${tool.errorCount}/${tool.count} calls).`,
        traceIds,
        suggestion: `Review the "${tool.name}" tool implementation or the arguments being passed to it.`,
      });
    }
  }

  // --- User corrections ---
  const corrections = getUserCorrections(store, 20);
  if (corrections.length > 0) {
    findings.push({
      type: 'user_correction',
      description: `Found ${corrections.length} turn(s) where the user likely corrected the agent.`,
      traceIds: corrections.map(t => t.id),
      suggestion: 'Review these conversations to identify misunderstandings and improve prompt handling.',
    });
  }

  // --- Slow turns: >30s ---
  const slowTurns = recentTraces.filter(t => t.durationMs > SLOW_TURN_THRESHOLD_MS);
  if (slowTurns.length > 0) {
    const worst = Math.max(...slowTurns.map(t => t.durationMs));
    findings.push({
      type: 'slow_turn',
      description: `${slowTurns.length} turn(s) exceeded ${SLOW_TURN_THRESHOLD_MS / 1000}s (worst: ${(worst / 1000).toFixed(1)}s).`,
      traceIds: slowTurns.map(t => t.id),
      suggestion: 'Check for slow tool calls or overly large prompts in these turns.',
    });
  }

  // --- Repeated errors: same tool+error combo 3+ times ---
  const errorCombos = new Map<string, number[]>();
  for (const trace of recentTraces) {
    for (const tc of trace.toolCalls) {
      if (tc.error) {
        const key = `${tc.name}::${tc.error}`;
        let ids = errorCombos.get(key);
        if (!ids) {
          ids = [];
          errorCombos.set(key, ids);
        }
        ids.push(trace.id);
      }
    }
  }

  for (const [key, traceIds] of errorCombos) {
    if (traceIds.length >= REPEATED_ERROR_THRESHOLD) {
      const [toolName, errorMsg] = key.split('::');
      findings.push({
        type: 'repeated_error',
        description: `Tool "${toolName}" produced the same error ${traceIds.length} times: "${errorMsg}".`,
        traceIds,
        suggestion: `This recurring error likely indicates a systematic issue with "${toolName}". Fix the root cause rather than retrying.`,
      });
    }
  }

  return findings;
}
