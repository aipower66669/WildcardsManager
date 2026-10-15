import { describe, expect, it } from 'vitest';
import {
  assembleHfFamilyPage,
  buildHfModelSearchQuery,
  filterHfSearchItemsForModelType,
  hfFamilyQueryBranches,
  planHfFamilyFetches,
  parseHfBrowseFilters,
  parseHfNextCursor,
  DEFAULT_HF_BROWSE_FILTERS,
  type HfFamilyFetchedPage,
  type HfFamilyQueryBranch,
  type HfSortableHit,
} from './huggingfaceSearch.js';

describe('huggingfaceSearch', () => {
  it('builds query params for type, family, and free-form tags', () => {
    const params = buildHfModelSearchQuery({
      ...DEFAULT_HF_BROWSE_FILTERS,
      search: 'lighting',
      author: 'stabilityai',
      modelType: 'lora',
      modelFamily: 'sdxl',
      tags: 'anime,  detail',
      baseModel: 'stabilityai/stable-diffusion-xl-base-1.0',
      pipelineTag: 'text-to-image',
      library: 'diffusers',
      sort: 'likes',
      direction: -1,
      gated: 'false',
      limit: 25,
    });
    expect(params.get('search')).toBe('lighting');
    expect(params.get('author')).toBe('stabilityai');
    expect(params.get('pipeline_tag')).toBe('text-to-image');
    expect(params.get('library')).toBe('diffusers');
    expect(params.get('sort')).toBe('likes');
    expect(params.get('gated')).toBe('false');
    expect(params.getAll('filter')).toEqual(
      expect.arrayContaining([
        'lora',
        'stable-diffusion-xl',
        'base_model:stabilityai/stable-diffusion-xl-base-1.0',
        'anime',
        'detail',
      ]),
    );
  });

  it('filters adapter tags when model type is checkpoint', () => {
    const items = [
      { id: 'a/full', tags: ['diffusers', 'text-to-image'] },
      { id: 'b/lora', tags: ['diffusers', 'lora'] },
    ];
    expect(filterHfSearchItemsForModelType(items, 'checkpoint')).toEqual([
      items[0],
    ]);
    expect(filterHfSearchItemsForModelType(items, 'lora')).toEqual(items);
  });

  it('parses Link next cursor', () => {
    expect(
      parseHfNextCursor(
        '<https://huggingface.co/api/models?cursor=abc123&limit=2>; rel="next"',
      ),
    ).toBe('abc123');
    expect(parseHfNextCursor(null)).toBeNull();
  });

  it('normalizes persisted filters', () => {
    expect(parseHfBrowseFilters({ modelType: 'flux', limit: 999 }).modelType).toBe(
      'lora',
    );
    expect(parseHfBrowseFilters({ modelType: 'flux', limit: 999 }).limit).toBe(
      100,
    );
    expect(parseHfBrowseFilters({ modelFamily: 'krea2' }).modelFamily).toBe(
      'krea2',
    );
  });

  it('queries Krea 2 once per current Hub tag instead of ANDing them', () => {
    const branches = hfFamilyQueryBranches('krea2');
    expect(branches.map((branch) => branch.tag ?? branch.search)).toEqual([
      'krea',
      'krea-2',
      'krea2',
      'base_model:krea/Krea-2-Raw',
      'base_model:krea/Krea-2-Turbo',
      'base_model:Comfy-Org/Krea-2',
      'krea2',
      'krea-2',
    ]);

    const filters = {
      ...DEFAULT_HF_BROWSE_FILTERS,
      modelFamily: 'krea2' as const,
      pipelineTag: '',
      library: '',
      sort: 'createdAt' as const,
    };
    expect(() => buildHfModelSearchQuery(filters)).toThrow(/once per tag/);

    const tagged = buildHfModelSearchQuery(filters, null, branches[1]);
    expect(tagged.getAll('filter')).toEqual(['lora', 'krea-2']);
    expect(tagged.get('search')).toBeNull();

    const named = buildHfModelSearchQuery(
      { ...filters, search: 'portrait' },
      null,
      branches.find((branch) => branch.id === 'name-krea2'),
    );
    expect(named.get('search')).toBe('portrait krea2');
    expect(named.getAll('filter')).toEqual(['lora']);
  });

  it('merges Krea tag pages by newest and keeps the rest for the next page', () => {
    const branches: HfFamilyQueryBranch[] = [
      { id: 'krea-2', tag: 'krea-2' },
      { id: 'krea', tag: 'krea' },
    ];
    const hit = (id: string, createdAt: string): HfSortableHit => ({
      id,
      likes: 0,
      downloads: 0,
      createdAt,
      lastModified: createdAt,
      trendingScore: null,
    });
    const firstPages: Array<HfFamilyFetchedPage<HfSortableHit>> = [
      {
        plan: {
          branch: branches[0]!,
          cursor: null,
          onlyIds: null,
          after: null,
        },
        items: [hit('new/one', '2026-10-08T00:00:00.000Z'), hit('mid/two', '2026-10-01T00:00:00.000Z')],
        nextCursor: 'cursor-krea-2',
      },
      {
        plan: {
          branch: branches[1]!,
          cursor: null,
          onlyIds: null,
          after: null,
        },
        items: [hit('old/three', '2026-09-26T00:00:00.000Z')],
        nextCursor: null,
      },
    ];

    const first = assembleHfFamilyPage(firstPages, branches, {
      sort: 'createdAt',
      direction: -1,
      limit: 1,
    });
    expect(first.items.map((item) => item.id)).toEqual(['new/one']);

    const replay = planHfFamilyFetches(branches, first.nextCursor);
    expect(replay.map((plan) => plan.branch.id)).toEqual(['krea-2', 'krea']);
    expect(replay[0]).toMatchObject({
      cursor: null,
      onlyIds: ['mid/two'],
      after: 'cursor-krea-2',
    });
    expect(replay[1]).toMatchObject({
      cursor: null,
      onlyIds: ['old/three'],
      after: null,
    });

    const second = assembleHfFamilyPage(
      [
        {
          plan: replay[0]!,
          items: firstPages[0]!.items,
          nextCursor: 'ignored-while-replaying',
        },
        {
          plan: replay[1]!,
          items: firstPages[1]!.items,
          nextCursor: null,
        },
      ],
      branches,
      { sort: 'createdAt', direction: -1, limit: 1 },
    );
    expect(second.items.map((item) => item.id)).toEqual(['mid/two']);
    const thirdPlan = planHfFamilyFetches(branches, second.nextCursor);
    expect(thirdPlan.find((plan) => plan.branch.id === 'krea-2')).toMatchObject({
      cursor: 'cursor-krea-2',
      onlyIds: null,
    });
    expect(thirdPlan.find((plan) => plan.branch.id === 'krea')?.onlyIds).toEqual([
      'old/three',
    ]);
  });
});
