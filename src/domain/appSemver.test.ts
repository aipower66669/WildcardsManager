import { describe, expect, it } from 'vitest';
import { compareSemver } from './appSemver.js';

describe('compareSemver', () => {
  it('orders patch / minor / major', () => {
    expect(compareSemver('0.4.1', '0.4.0')).toBeGreaterThan(0);
    expect(compareSemver('0.4.0', '0.4.1')).toBeLessThan(0);
    expect(compareSemver('0.5.0', '0.4.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareSemver('0.4.0', '0.4.0')).toBe(0);
  });

  it('accepts a leading v', () => {
    expect(compareSemver('v0.4.1', '0.4.0')).toBeGreaterThan(0);
  });

  it('treats a two-part version as patch 0', () => {
    expect(compareSemver('0.7', '0.7.0')).toBe(0);
    expect(compareSemver('v0.8', '0.7.15')).toBeGreaterThan(0);
  });
});
