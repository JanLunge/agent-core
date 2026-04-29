import { describe, expect, it } from 'vitest';
import { semanticSliceFiltersWithTimeRange, translateSemanticTimeRangeLabel } from './time-range.js';

describe('semantic time range labels', () => {
  it('translates today yesterday and last-7-days under an injected clock', () => {
    const now = '2026-04-29T08:01:00.000Z';

    expect(translateSemanticTimeRangeLabel({ label: 'today', now })).toEqual({
      from: '2026-04-29T00:00:00.000Z',
      to: '2026-04-29T23:59:59.999Z',
    });
    expect(translateSemanticTimeRangeLabel({ label: 'yesterday', now })).toEqual({
      from: '2026-04-28T00:00:00.000Z',
      to: '2026-04-28T23:59:59.999Z',
    });
    expect(translateSemanticTimeRangeLabel({ label: 'last_7_days', now })).toEqual({
      from: '2026-04-23T00:00:00.000Z',
      to: '2026-04-29T23:59:59.999Z',
    });
  });

  it('preserves explicit time ranges over labels and rejects unknown labels', () => {
    expect(semanticSliceFiltersWithTimeRange({
      timeRangeLabel: 'today',
      timeRange: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' },
      tags: ['memory'],
    }, '2026-04-29T08:01:00.000Z')).toEqual({
      timeRange: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' },
      tags: ['memory'],
    });
    expect(() => translateSemanticTimeRangeLabel({ label: 'last-month', now: '2026-04-29T08:01:00.000Z' })).toThrow(
      'Unsupported semantic time range label',
    );
  });
});
