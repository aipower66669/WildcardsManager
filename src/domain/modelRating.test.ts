import { describe, expect, it } from 'vitest';
import {
  UNRATED,
  isUnrated,
  normalizeModelRating,
} from './modelRating.js';

describe('normalizeModelRating', () => {
  it('keeps unrated sentinel', () => {
    expect(normalizeModelRating(-1)).toBe(UNRATED);
    expect(normalizeModelRating(-99)).toBe(UNRATED);
    expect(normalizeModelRating(0)).toBe(UNRATED);
  });

  it('snaps to half-star steps in range', () => {
    expect(normalizeModelRating(0.5)).toBe(0.5);
    expect(normalizeModelRating(1)).toBe(1);
    expect(normalizeModelRating(1.25)).toBe(1.5);
    expect(normalizeModelRating(1.74)).toBe(1.5);
    expect(normalizeModelRating(4.9)).toBe(5);
    expect(normalizeModelRating(6)).toBe(5);
  });

  it('treats invalid values as unrated', () => {
    expect(normalizeModelRating(undefined)).toBe(UNRATED);
    expect(normalizeModelRating(NaN)).toBe(UNRATED);
    expect(isUnrated(-1)).toBe(true);
    expect(isUnrated(2)).toBe(false);
  });
});
