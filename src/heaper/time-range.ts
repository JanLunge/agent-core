import type { SearchFilters, SemanticSliceOptions } from './types.js';

export type SemanticTimeRangeLabel = 'today' | 'yesterday' | 'last-7-days';

export interface TranslateTimeRangeOptions {
  label: string;
  now?: string;
}

export function translateSemanticTimeRangeLabel(options: TranslateTimeRangeOptions): NonNullable<SearchFilters['timeRange']> {
  const label = normalizeLabel(options.label);
  const anchor = parseAnchorDate(options.now ?? new Date().toISOString());

  if (label === 'today') {
    return rangeForDay(anchor);
  }
  if (label === 'yesterday') {
    return rangeForDay(addDays(anchor, -1));
  }
  if (label === 'last-7-days') {
    return {
      from: startOfUtcDay(addDays(anchor, -6)).toISOString(),
      to: endOfUtcDay(anchor).toISOString(),
    };
  }

  throw new Error(`Unsupported semantic time range label: ${options.label}`);
}

export function semanticSliceFiltersWithTimeRange(
  options: Omit<SemanticSliceOptions, 'query'>,
  now?: string,
): SearchFilters {
  const { timeRangeLabel, ...filters } = options;
  if (!timeRangeLabel || filters.timeRange) return filters;
  return { ...filters, timeRange: translateSemanticTimeRangeLabel({ label: timeRangeLabel, now }) };
}

function normalizeLabel(label: string): SemanticTimeRangeLabel | string {
  return label.trim().toLowerCase().replace(/_/g, '-');
}

function parseAnchorDate(now: string): Date {
  const parsed = new Date(now);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid semantic time range anchor: ${now}`);
  return parsed;
}

function rangeForDay(day: Date): NonNullable<SearchFilters['timeRange']> {
  return { from: startOfUtcDay(day).toISOString(), to: endOfUtcDay(day).toISOString() };
}

function startOfUtcDay(day: Date): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(day: Date): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59, 999));
}

function addDays(day: Date, delta: number): Date {
  const result = startOfUtcDay(day);
  result.setUTCDate(result.getUTCDate() + delta);
  return result;
}
