import { describe, expect, it } from 'vitest';
import {
  hashNeedsCatalogMatch,
  listHashesNeedingCatalogMatch,
} from './civitaiPopulateSkip.js';

describe('hashNeedsCatalogMatch', () => {
  const index = new Map([['AAA', { id: 1 }]]);
  const misses = new Set(['BBB']);
  const isMiss = (h: string) => misses.has(h);

  it('skips hashes already in the catalog index', () => {
    expect(hashNeedsCatalogMatch('aaa', index, isMiss)).toBe(false);
  });

  it('skips persistent Civitai misses', () => {
    expect(hashNeedsCatalogMatch('BBB', index, isMiss)).toBe(false);
  });

  it('requires a match only for unknown hashes', () => {
    expect(hashNeedsCatalogMatch('CCC', index, isMiss)).toBe(true);
  });

  it('ignores blank hashes (hash warm, not populate)', () => {
    expect(hashNeedsCatalogMatch('', index, isMiss)).toBe(false);
    expect(hashNeedsCatalogMatch(undefined, index, isMiss)).toBe(false);
  });
});

describe('listHashesNeedingCatalogMatch', () => {
  it('dedupes and keeps only unresolved hashes', () => {
    const index = new Map([['AAA', {}]]);
    expect(
      listHashesNeedingCatalogMatch(
        ['aaa', 'BBB', 'bbb', ''],
        index,
        (h) => h === 'ZZZ',
      ),
    ).toEqual(['BBB']);
  });
});
