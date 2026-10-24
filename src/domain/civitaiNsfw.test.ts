import { describe, expect, it } from 'vitest';
import { civitaiRedKeepsModel } from './civitaiNsfw.js';

describe('civitaiRedKeepsModel', () => {
  it('keeps mature models and drops safe ones', () => {
    expect(civitaiRedKeepsModel(true)).toBe(true);
    expect(civitaiRedKeepsModel(false)).toBe(false);
  });
});
