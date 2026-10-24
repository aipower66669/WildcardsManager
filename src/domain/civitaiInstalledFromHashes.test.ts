import { describe, expect, it } from 'vitest';
import {
  collectInstalledModelIdsFromHashes,
  keepLongerRows,
  mergeDownloadedIds,
  mergePersistedInstalledIds,
} from './civitaiInstalledFromHashes.js';

describe('collectInstalledModelIdsFromHashes', () => {
  it('resolves unique catalog ids from local hashes', () => {
    const catalogIndex = new Map([
      ['AAA', { origin: 'https://civitai.com', id: 10 }],
      ['BBB', { origin: 'https://civitai.com', id: 10 }],
      ['CCC', { origin: 'https://civitai.com', id: 20 }],
    ]);
    expect(
      collectInstalledModelIdsFromHashes({
        hashes: ['aaa', 'BBB', 'missing'],
        catalogIndex,
      }).sort((a, b) => a - b),
    ).toEqual([10]);
  });

  it('ignores blank and unknown hashes', () => {
    expect(
      collectInstalledModelIdsFromHashes({
        hashes: ['', '  ', 'nope'],
        catalogIndex: new Map(),
      }),
    ).toEqual([]);
  });
});

describe('mergePersistedInstalledIds', () => {
  it('grows persist with a partial live scan', () => {
    expect(
      mergePersistedInstalledIds([1, 2, 3], [2, 9], false).sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 9]);
  });

  it('replaces persist when the live scan is complete', () => {
    expect(
      mergePersistedInstalledIds([1, 2, 3], [2, 9], true).sort((a, b) => a - b),
    ).toEqual([2, 9]);
  });

  it('keeps persist when a complete flag is set but live is empty', () => {
    expect(mergePersistedInstalledIds([1, 2], [], true)).toEqual([1, 2]);
  });
});

describe('keepLongerRows', () => {
  it('keeps the saved downloaded rows when a later scan is empty', () => {
    expect(
      keepLongerRows(
        [
          { id: 1, type: 'LORA' },
          { id: 2, type: 'LORA' },
        ],
        [],
      ).map((row) => row.id),
    ).toEqual([1, 2]);
  });
});

describe('mergeDownloadedIds', () => {
  it('keeps the saved list when a rebuilt catalog matches fewer files', () => {
    expect(
      mergeDownloadedIds([1, 2, 3, 4], [2, 9], true).sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 9]);
  });
});
