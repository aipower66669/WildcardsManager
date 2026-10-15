import { describe, expect, it } from 'vitest';
import {
  catalogSearchHay,
  searchCatalogIndex,
} from './civitaiCatalogSearchIndex.js';

describe('catalogSearchHay', () => {
  it('joins name, creator, tags, file, base model lowercase', () => {
    expect(
      catalogSearchHay({
        name: 'Cool LoRA',
        creator: 'Alice',
        tags: ['portrait', 'SDXL'],
        fileName: 'cool.safetensors',
        baseModel: 'SDXL 1.0',
      }),
    ).toBe('cool lora alice cool.safetensors sdxl 1.0 portrait sdxl');
  });
});

describe('searchCatalogIndex', () => {
  const index = {
    ids: [10, 20, 30, 40, 50],
    hays: [
      'alpha wolf portrait',
      'beta cat landscape',
      'alpha cat portrait',
      'gamma wolf',
      'delta',
    ],
  };

  it('requires all tokens (AND)', () => {
    const hit = searchCatalogIndex(index, 'alpha portrait', 0, 10);
    expect(hit.matches.map((m) => m.id)).toEqual([10, 30]);
    expect(hit.hasMore).toBe(false);
  });

  it('resumes from hay index cursor', () => {
    const first = searchCatalogIndex(index, 'portrait', 0, 1);
    expect(first.matches).toEqual([{ id: 10, hayIndex: 0 }]);
    expect(first.nextIndex).toBe(1);
    // hasMore means remaining hay to scan (not a guaranteed next match).
    expect(first.hasMore).toBe(true);

    const second = searchCatalogIndex(index, 'portrait', first.nextIndex, 1);
    expect(second.matches).toEqual([{ id: 30, hayIndex: 2 }]);
    expect(second.nextIndex).toBe(3);
    expect(second.hasMore).toBe(true);

    const third = searchCatalogIndex(index, 'portrait', second.nextIndex, 1);
    expect(third.matches).toEqual([]);
    expect(third.nextIndex).toBe(index.hays.length);
    expect(third.hasMore).toBe(false);
  });

  it('empty query pages the full id list', () => {
    const hit = searchCatalogIndex(index, '  ', 1, 2);
    expect(hit.matches.map((m) => m.id)).toEqual([20, 30]);
    expect(hit.nextIndex).toBe(3);
    expect(hit.hasMore).toBe(true);
  });
});
