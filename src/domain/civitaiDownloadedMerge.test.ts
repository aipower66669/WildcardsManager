import { describe, expect, it } from 'vitest';
import { mergeDownloadedCatalogCards } from './civitaiDownloadedMerge.js';

describe('mergeDownloadedCatalogCards', () => {
  it('keeps the existing list when a later scan returns a small subset', () => {
    const prev = [
      { id: 1, installed: true, name: 'a' },
      { id: 2, installed: true, name: 'b' },
      { id: 3, installed: true, name: 'c' },
    ];
    const scanned = [{ id: 2, installed: true, name: 'b-updated' }];
    const merged = mergeDownloadedCatalogCards(prev, scanned);
    expect(merged).toHaveLength(3);
    expect(merged.find((c) => c.id === 2)?.name).toBe('b-updated');
  });

  it('adds a newly installed card without dropping the rest', () => {
    const prev = [{ id: 1, installed: true, name: 'a' }];
    const scanned = [
      { id: 1, installed: true, name: 'a' },
      { id: 9, installed: true, name: 'new' },
    ];
    const merged = mergeDownloadedCatalogCards(prev, scanned);
    expect(merged.map((c) => c.id).sort()).toEqual([1, 9]);
  });

  it('keeps the real library size when a later scan returns leftovers', () => {
    const prev = Array.from({ length: 2316 }, (_, i) => ({
      id: i + 1,
      installed: true,
    }));
    const scanned = Array.from({ length: 61 }, (_, i) => ({
      id: i + 1,
      installed: true,
    }));
    expect(mergeDownloadedCatalogCards(prev, scanned)).toHaveLength(2316);
  });

  it('takes the scan as-is when the tab has never been loaded', () => {
    const scanned = [
      { id: 1, installed: true },
      { id: 2, markedInstalled: true },
      { id: 3, installed: false },
    ];
    const merged = mergeDownloadedCatalogCards([], scanned);
    expect(merged.map((c) => c.id)).toEqual([1, 2]);
  });
});
