import { describe, expect, it } from 'vitest';
import { civitaiRedKeepsModel } from './civitaiNsfw.js';

describe('civitaiRedKeepsModel', () => {
  it('keeps mature models and drops safe ones when only the boolean is known', () => {
    expect(civitaiRedKeepsModel(true)).toBe(true);
    expect(civitaiRedKeepsModel(false)).toBe(false);
  });

  it('keeps R and above even when the nsfw flag is false', () => {
    expect(civitaiRedKeepsModel(false, 15)).toBe(true);
    expect(civitaiRedKeepsModel(false, 7)).toBe(true);
    expect(civitaiRedKeepsModel(true, 60)).toBe(true);
    expect(civitaiRedKeepsModel(false, 31)).toBe(true);
  });

  it('drops PG and PG-13', () => {
    expect(civitaiRedKeepsModel(false, 1)).toBe(false);
    expect(civitaiRedKeepsModel(false, 2)).toBe(false);
    expect(civitaiRedKeepsModel(false, 3)).toBe(false);
  });
});
