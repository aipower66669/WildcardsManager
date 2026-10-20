import { describe, expect, it } from 'vitest';
import {
  benchmarkRatingScore,
  benchmarkWeightByKey,
} from './benchmarkWeight.js';

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

describe('benchmarkRatingScore', () => {
  it('treats an ADS 10 and a 5-star catalog rating as the same top score', () => {
    expect(benchmarkRatingScore(10, 'ads')).toBe(1);
    expect(benchmarkRatingScore(5, 'catalog')).toBe(1);
    expect(benchmarkRatingScore(8, 'ads')).toBeCloseTo(0.8);
    expect(benchmarkRatingScore(4, 'catalog')).toBeCloseTo(0.8);
  });

  it('returns null when there is no rating', () => {
    expect(benchmarkRatingScore(null, 'ads')).toBeNull();
    expect(benchmarkRatingScore(0, 'catalog')).toBeNull();
    expect(benchmarkRatingScore(4, null)).toBeNull();
  });
});
