import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'wcm-catalog-unused'),
  },
}));

import {
  buildCatalogSliceKey,
  catalogSliceHasModel,
  configureCatalogCacheRoot,
  findCachedModelByAutoV2,
  flushDirtyModelPagesSync,
  getAutoV2CatalogIndex,
  getCachedModel,
  getCatalogSliceStats,
  insertCachedModelsIfAbsent,
  invalidateAutoV2CatalogIndex,
  listCachedModelsForSliceWindow,
  updateCatalogSlice,
  type CachedCivitaiModel,
} from './civitaiCatalogCache.js';

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-catalog-'));
}

function sampleModel(
  id: number,
  origin = 'https://civitai.com',
): CachedCivitaiModel {
  const now = new Date().toISOString();
  return {
    id,
    origin,
    name: `Model ${id}`,
    type: 'LORA',
    nsfw: false,
    tags: ['character'],
    trainedWords: [],
    pageUrl: `${origin}/models/${id}`,
    earlyAccess: false,
    firstSeenAt: now,
    updatedAt: now,
    autoV2: id % 2 === 0 ? `hash${id}` : undefined,
  };
}

describe('civitaiCatalogCache', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot();
    configureCatalogCacheRoot(root);
  });

  afterEach(() => {
    flushDirtyModelPagesSync();
    configureCatalogCacheRoot(null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('stores models on separate pages by id band', () => {
    const origin = 'https://civitai.com';
    insertCachedModelsIfAbsent([
      sampleModel(100),
      sampleModel(1500),
    ]);
    flushDirtyModelPagesSync();

    expect(getCachedModel(origin, 100)?.name).toBe('Model 100');
    expect(getCachedModel(origin, 1500)?.name).toBe('Model 1500');
    expect(
      fs.existsSync(path.join(root, 'models', 'civitai.com', '0.json')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, 'models', 'civitai.com', '1.json')),
    ).toBe(true);
  });

  it('chunks slice ids and supports windowed reads', () => {
    const origin = 'https://civitai.com';
    const sliceKey = buildCatalogSliceKey({
      origin,
      type: 'LORA',
      category: null,
      architectures: ['sdxl'],
      query: '',
    });
    const ids = Array.from({ length: 2500 }, (_, i) => i + 1);
    insertCachedModelsIfAbsent(ids.map((id) => sampleModel(id)));
    flushDirtyModelPagesSync();
    updateCatalogSlice(sliceKey, {
      appendIds: ids,
      exhausted: false,
      nextCursor: 'abc',
    });

    const stats = getCatalogSliceStats(sliceKey);
    expect(stats.idCount).toBe(2500);
    expect(stats.nextCursor).toBe('abc');
    expect(catalogSliceHasModel(sliceKey, 1)).toBe(true);
    expect(catalogSliceHasModel(sliceKey, 99999)).toBe(false);

    const window = listCachedModelsForSliceWindow(origin, sliceKey, 1000, 3);
    expect(window.map((m) => m.id)).toEqual([1001, 1002, 1003]);

    const sliceDir = fs.readdirSync(path.join(root, 'slices'));
    expect(sliceDir.length).toBe(1);
    const files = fs.readdirSync(path.join(root, 'slices', sliceDir[0]!));
    expect(files.filter((f) => f.startsWith('ids-')).length).toBe(3);
  });

  it('indexes every autoV2Hashes entry into the catalog Map', () => {
    const origin = 'https://civitai.com';
    const now = new Date().toISOString();
    insertCachedModelsIfAbsent([
      {
        id: 42,
        origin,
        name: 'Fillmore Style',
        type: 'LORA',
        nsfw: false,
        tags: [],
        trainedWords: [],
        pageUrl: `${origin}/models/42`,
        earlyAccess: false,
        firstSeenAt: now,
        updatedAt: now,
        autoV2: 'AAAAAAAAAA',
        autoV2Hashes: ['AAAAAAAAAA', '0806E91728'],
      },
    ]);
    flushDirtyModelPagesSync();
    invalidateAutoV2CatalogIndex();

    const map = getAutoV2CatalogIndex();
    expect(map.get('AAAAAAAAAA')?.id).toBe(42);
    expect(map.get('0806E91728')?.id).toBe(42);
    expect(findCachedModelByAutoV2('0806E91728')?.name).toBe('Fillmore Style');
  });

  it('unions newer version hashes onto an existing catalog card', () => {
    const origin = 'https://civitai.com';
    const now = new Date().toISOString();
    const base: CachedCivitaiModel = {
      id: 7,
      origin,
      name: 'Multi version',
      type: 'Checkpoint',
      nsfw: false,
      tags: [],
      trainedWords: [],
      pageUrl: `${origin}/models/7`,
      earlyAccess: false,
      firstSeenAt: now,
      updatedAt: now,
      autoV2: '1111111111',
      autoV2Hashes: ['1111111111'],
    };
    insertCachedModelsIfAbsent([base]);
    insertCachedModelsIfAbsent([
      {
        ...base,
        autoV2: '2222222222',
        autoV2Hashes: ['2222222222', '3333333333'],
      },
    ]);
    flushDirtyModelPagesSync();

    const row = getCachedModel(origin, 7);
    expect(row?.autoV2).toBe('1111111111');
    expect(row?.autoV2Hashes).toEqual([
      '1111111111',
      '2222222222',
      '3333333333',
    ]);
    expect(getAutoV2CatalogIndex().get('3333333333')?.id).toBe(7);
  });

  it('preserves version earlyAccessEndsAt when a thin feed omits it', () => {
    const origin = 'https://civitai.com';
    const now = new Date().toISOString();
    const endsAt = '2030-01-15T12:00:00.000Z';
    insertCachedModelsIfAbsent([
      {
        ...sampleModel(99, origin),
        earlyAccess: true,
        earlyAccessEndsAt: endsAt,
        versionId: 500,
        versions: [
          {
            id: 500,
            name: 'v1',
            autoV2Hashes: [],
            earlyAccess: true,
            earlyAccessEndsAt: endsAt,
          },
        ],
      },
    ]);
    // Simulate catalog sync from list API (EA flag, no end time).
    insertCachedModelsIfAbsent([
      {
        ...sampleModel(99, origin),
        earlyAccess: true,
        earlyAccessEndsAt: undefined,
        versionId: 500,
        versions: [
          {
            id: 500,
            name: 'v1',
            autoV2Hashes: [],
            earlyAccess: true,
            earlyAccessEndsAt: undefined,
          },
        ],
        updatedAt: now,
      },
    ]);
    flushDirtyModelPagesSync();

    const row = getCachedModel(origin, 99);
    expect(row?.earlyAccessEndsAt).toBe(endsAt);
    expect(row?.versions?.[0]?.earlyAccessEndsAt).toBe(endsAt);
  });
});
