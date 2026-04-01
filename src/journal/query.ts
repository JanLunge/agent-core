import { type TraceEntry, type TraceRow, type TraceStore, rowToTrace } from './trace.js';

export interface TraceQuery {
  forConversation(id: string): TraceQuery;
  withToolErrors(): TraceQuery;
  withTool(name: string): TraceQuery;
  slowestFirst(): TraceQuery;
  since(date: string): TraceQuery;
  limit(n: number): TraceQuery;
  execute(): TraceEntry[];
}

interface QueryState {
  conversationId?: string;
  toolErrorsOnly: boolean;
  toolName?: string;
  orderByDuration: boolean;
  sinceDate?: string;
  limitN?: number;
}

export function createTraceQuery(store: TraceStore): TraceQuery {
  const state: QueryState = {
    toolErrorsOnly: false,
    orderByDuration: false,
  };

  const query: TraceQuery = {
    forConversation(id: string) {
      state.conversationId = id;
      return query;
    },
    withToolErrors() {
      state.toolErrorsOnly = true;
      return query;
    },
    withTool(name: string) {
      state.toolName = name;
      return query;
    },
    slowestFirst() {
      state.orderByDuration = true;
      return query;
    },
    since(date: string) {
      state.sinceDate = date;
      return query;
    },
    limit(n: number) {
      state.limitN = n;
      return query;
    },
    execute(): TraceEntry[] {
      const clauses: string[] = [];
      const params: unknown[] = [];

      if (state.conversationId) {
        clauses.push('conversation_id = ?');
        params.push(state.conversationId);
      }
      if (state.sinceDate) {
        clauses.push('timestamp >= ?');
        params.push(state.sinceDate);
      }
      if (state.toolErrorsOnly) {
        clauses.push(`tool_calls LIKE '%"error":%'`);
      }
      if (state.toolName) {
        clauses.push(`tool_calls LIKE ?`);
        params.push(`%"name":"${state.toolName}"%`);
      }

      let sql = 'SELECT * FROM traces';
      if (clauses.length > 0) {
        sql += ' WHERE ' + clauses.join(' AND ');
      }
      sql += state.orderByDuration
        ? ' ORDER BY duration_ms DESC'
        : ' ORDER BY id ASC';
      if (state.limitN) {
        sql += ' LIMIT ?';
        params.push(state.limitN);
      }

      const db = store.getDb();
      const rows = db.prepare(sql).all(...params) as TraceRow[];
      let results = rows.map(rowToTrace);

      // Post-filter for precise tool error and tool name matching
      // (the SQL LIKE is a rough pre-filter; refine in JS)
      if (state.toolErrorsOnly) {
        results = results.filter(t =>
          t.toolCalls.some(tc => tc.error !== undefined),
        );
      }
      if (state.toolName) {
        results = results.filter(t =>
          t.toolCalls.some(tc => tc.name === state.toolName),
        );
      }

      return results;
    },
  };

  return query;
}

export interface ToolStats {
  name: string;
  count: number;
  avgDurationMs: number;
  errorCount: number;
}

export function getToolStats(store: TraceStore): ToolStats[] {
  const db = store.getDb();
  const rows = db.prepare('SELECT tool_calls FROM traces').all() as { tool_calls: string }[];

  const stats = new Map<string, { count: number; totalDuration: number; errorCount: number }>();

  for (const row of rows) {
    const calls = JSON.parse(row.tool_calls) as TraceEntry['toolCalls'];
    for (const tc of calls) {
      let entry = stats.get(tc.name);
      if (!entry) {
        entry = { count: 0, totalDuration: 0, errorCount: 0 };
        stats.set(tc.name, entry);
      }
      entry.count++;
      entry.totalDuration += tc.durationMs;
      if (tc.error) entry.errorCount++;
    }
  }

  return Array.from(stats.entries()).map(([name, s]) => ({
    name,
    count: s.count,
    avgDurationMs: Math.round(s.totalDuration / s.count),
    errorCount: s.errorCount,
  }));
}

const CORRECTION_PATTERNS = /\b(no|wrong|actually|instead|not that|fix)\b/i;

export function getUserCorrections(store: TraceStore, limit?: number): TraceEntry[] {
  const db = store.getDb();
  const rows = db.prepare(
    'SELECT * FROM traces ORDER BY id DESC',
  ).all() as TraceRow[];

  const matches: TraceEntry[] = [];
  for (const row of rows) {
    const input = JSON.parse(row.input) as TraceEntry['input'];
    if (input.role === 'user' && CORRECTION_PATTERNS.test(input.content)) {
      matches.push(rowToTrace(row));
      if (limit && matches.length >= limit) break;
    }
  }

  return matches;
}
