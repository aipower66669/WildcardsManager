import { describe, expect, it } from 'vitest';
import {
  buildPotentialMatchIndex,
  findPotentialLocalMatches,
  findPotentialLocalMatchesExact,
  normalizeModelStem,
} from './civitaiLocalMatch.js';
import type { LoraIndex } from './lora.js';

function makeIndex(files: Array<{ relativePath: string; stem: string }>): LoraIndex {
  return {
    root: '/loras',
    aliases: new Map(),
    files: files.map((file) => ({
      relativePath: file.relativePath,
      absolutePath: `/loras/${file.relativePath}`,
      stem: file.stem,
    })),
    fileCount: files.length,
  };
}

describe('normalizeModelStem', () => {
  it('strips extensions and normalizes punctuation', () => {
    expect(normalizeModelStem('Detail_Slider-v2.safetensors')).toBe(
      'detail slider v2',
    );
    expect(normalizeModelStem('detail slider v2 (1)')).toBe('detail slider v2');
  });
});

describe('findPotentialLocalMatches', () => {
  it('finds exact stem matches when not installed under Civitai filename', () => {
    const index = makeIndex([
      { relativePath: 'style/detail_slider_v2.safetensors', stem: 'style/detail_slider_v2' },
    ]);
    const matches = findPotentialLocalMatches(
      index,
      'detail_slider_v2.safetensors',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchKind).toBe('exact');
    expect(matches[0]?.relativePath).toBe('style/detail_slider_v2.safetensors');
  });

  it('finds matches when Civitai filename differs by separators', () => {
    const index = makeIndex([
      { relativePath: 'krea_style.safetensors', stem: 'krea_style' },
    ]);
    const matches = findPotentialLocalMatches(index, 'krea-style.safetensors', {
      modelName: 'Krea Style',
    });
    expect(matches.length).toBeGreaterThan(0);
  });

  it('returns empty when index is missing', () => {
    expect(findPotentialLocalMatches(null, 'foo.safetensors')).toEqual([]);
  });
});

describe('findPotentialLocalMatchesExact', () => {
  it('uses a stem dictionary for exact matches without scanning', () => {
    const index = makeIndex([
      {
        relativePath: 'style/detail_slider_v2.safetensors',
        stem: 'style/detail_slider_v2',
      },
      { relativePath: 'other/unrelated.safetensors', stem: 'other/unrelated' },
    ]);
    const matchIndex = buildPotentialMatchIndex(index);
    const matches = findPotentialLocalMatchesExact(
      matchIndex,
      'detail_slider_v2.safetensors',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchKind).toBe('exact');
    expect(matches[0]?.relativePath).toBe('style/detail_slider_v2.safetensors');
  });
});
