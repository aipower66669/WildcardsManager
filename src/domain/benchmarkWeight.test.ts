import { describe, expect, it } from 'vitest';
import { benchmarkWeightByKey } from './benchmarkWeight.js';

describe('benchmarkWeightByKey', () => {
  it('gives 100 to the checkpoint that is both fastest and top rated', () => {
    const weights = benchmarkWeightByKey([
      { key: 'best', avgDurationMs: 10_000, rating: 10 },
      { key: 'slow-top', avgDurationMs: 40_000, rating: 10 },
      { key: 'fast-mid', avgDurationMs: 10_000, rating: 5 },
      { key: 'unrated', avgDurationMs: 5_000, rating: null },
    ]);
    expect(weights.get('best')).toBe(100);
    expect(weights.get('slow-top')).toBe(50);
    expect(weights.get('fast-mid')).toBe(71);
    expect(weights.has('unrated')).toBe(false);
  });

  it('ranks a balanced checkpoint above a fast weak one and a slow excellent one', () => {
    const weights = benchmarkWeightByKey([
      { key: 'fast-weak', avgDurationMs: 10_000, rating: 4 },
      { key: 'balanced', avgDurationMs: 15_000, rating: 9 },
      { key: 'slow-best', avgDurationMs: 40_000, rating: 10 },
    ]);
    const balanced = weights.get('balanced') ?? 0;
    expect(balanced).toBeGreaterThan(weights.get('fast-weak') ?? 100);
    expect(balanced).toBeGreaterThan(weights.get('slow-best') ?? 100);
  });
});
