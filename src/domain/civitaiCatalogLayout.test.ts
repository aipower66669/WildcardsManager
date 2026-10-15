import { describe, expect, it } from 'vitest';
import {
  CATALOG_PAGE_SIZE,
  appendIdsIntoChunks,
  catalogOriginHost,
  catalogSliceDirName,
  chunkModelIds,
  idChunkFileName,
  modelPageIndex,
  prependIdsIntoChunks,
} from './civitaiCatalogLayout.js';

describe('civitaiCatalogLayout', () => {
  it('pages model ids by thousands', () => {
    expect(modelPageIndex(0)).toBe(0);
    expect(modelPageIndex(999)).toBe(0);
    expect(modelPageIndex(1000)).toBe(1);
    expect(modelPageIndex(2500)).toBe(2);
  });

  it('chunks ids into pages of 1000', () => {
    const ids = Array.from({ length: 2505 }, (_, i) => i + 1);
    const chunks = chunkModelIds(ids);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(CATALOG_PAGE_SIZE);
    expect(chunks[1]).toHaveLength(CATALOG_PAGE_SIZE);
    expect(chunks[2]).toHaveLength(505);
    expect(chunks[0]![0]).toBe(1);
    expect(chunks[2]![504]).toBe(2505);
  });

  it('prepends across chunk boundaries', () => {
    const chunks = chunkModelIds(Array.from({ length: 1000 }, (_, i) => i + 100));
    const next = prependIdsIntoChunks(chunks, [1, 2, 3]);
    expect(next[0]!.slice(0, 3)).toEqual([1, 2, 3]);
    expect(next[0]).toHaveLength(1000);
    expect(next).toHaveLength(2);
    expect(next[1]![0]).toBe(1097);
  });

  it('appends and spills a new chunk', () => {
    const chunks = [Array.from({ length: 998 }, (_, i) => i + 1)];
    const next = appendIdsIntoChunks(chunks, [1000, 1001, 1002]);
    expect(next).toHaveLength(2);
    expect(next[0]).toHaveLength(1000);
    expect(next[0]!.slice(-2)).toEqual([1000, 1001]);
    expect(next[1]).toEqual([1002]);
  });

  it('builds stable slice dir names and origin hosts', () => {
    expect(catalogOriginHost('https://civitai.com')).toBe('civitai.com');
    expect(catalogSliceDirName('https://civitai.com|LORA||sdxl|')).toHaveLength(
      16,
    );
    expect(idChunkFileName(0)).toBe('ids-0000.json');
    expect(idChunkFileName(12)).toBe('ids-0012.json');
  });
});
