import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOV2_ADS_NAME, buildStreamPath } from '../shared/ads/paths.js';
import {
  deleteAutoV2Ads,
  readAutoV2Ads,
  writeAutoV2Ads,
} from '../main/modelAutoV2Ads.js';
import { migrateModelHashesToAds } from '../main/modelHashAdsMigration.js';
import {
  invalidateModelsStoreMemory,
  loadModelsStore,
  saveModelsStore,
} from '../main/modelRootStore.js';
import * as settingsStore from '../main/settingsStore.js';

describe('buildStreamPath', () => {
  it('builds path:AUTOV2:$DATA', () => {
    expect(buildStreamPath('C:\\models\\a.safetensors', AUTOV2_ADS_NAME)).toBe(
      'C:\\models\\a.safetensors:AUTOV2:$DATA',
    );
  });
});

describe('AUTOV2 ADS read/write (NTFS)', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-autov2-'));
    file = path.join(dir, 'demo.safetensors');
    fs.writeFileSync(file, 'fake-weights');
  });

  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('writes and reads AutoV2 via ADS when the volume supports it', () => {
    const ok = writeAutoV2Ads(file, 'aabbccddee');
    if (!ok) {
      expect(readAutoV2Ads(file)).toBeNull();
      return;
    }
    expect(readAutoV2Ads(file)).toBe('AABBCCDDEE');
    expect(deleteAutoV2Ads(file)).toBe(true);
  });

  it('leaves host atime/mtime unchanged after ADS write and delete', () => {
    const past = new Date('2019-03-01T08:00:00.000Z');
    fs.utimesSync(file, past, past);
    const before = fs.statSync(file);
    const ok = writeAutoV2Ads(file, 'aabbccddee');
    if (!ok) return;
    const afterWrite = fs.statSync(file);
    expect(afterWrite.mtimeMs).toBe(before.mtimeMs);
    expect(afterWrite.atimeMs).toBe(before.atimeMs);
    expect(deleteAutoV2Ads(file)).toBe(true);
    const afterDelete = fs.statSync(file);
    expect(afterDelete.mtimeMs).toBe(before.mtimeMs);
    expect(afterDelete.atimeMs).toBe(before.atimeMs);
  });
});

describe('migrateModelHashesToAds basename rematch', () => {
  let dir: string;
  let loraRoot: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-ads-mig-'));
    loraRoot = path.join(dir, 'loras');
    fs.mkdirSync(path.join(loraRoot, 'new-folder'), { recursive: true });
    fs.writeFileSync(
      path.join(loraRoot, 'new-folder', 'demo.safetensors'),
      'fake',
    );
    invalidateModelsStoreMemory(loraRoot);
    // Stale relative key — file lives under new-folder now.
    saveModelsStore(loraRoot, {
      version: 1,
      hashes: {
        'old-folder/demo.safetensors': {
          size: 4,
          mtimeMs: 1,
          autoV2: '1122334455',
        },
      },
      ratings: { byAutoV2: {}, byPath: {} },
      links: { byAutoV2: {}, byPath: {} },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    invalidateModelsStoreMemory();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('stamps ADS on the moved file via basename and clears JSON (no re-hash)', () => {
    vi.spyOn(settingsStore, 'listLibraryConfigs').mockReturnValue([
      {
        id: 't',
        name: 't',
        wildcardsRoot: dir,
        loraFolder: loraRoot,
        checkpointFolder: '',
        imagesFolder: null,
        videosFolder: null,
        mastersFolder: null,
        trainingLibraryFolder: null,
        promptsFolder: null,
        generationOutputRealistic: null,
        generationOutputHentai: null,
        generationOutput3d: null,
        benchmarkOutputFolder: null,
        enabledArchitectures: [],
        enabledSdxlFamilies: [],
        enabledCivitaiCategories: [],
        validationPlatform: 'comfyui',
        civitaiOrigin: 'https://civitai.com',
      },
    ]);

    const result = migrateModelHashesToAds();
    expect(result.clearedEntries).toBe(1);

    invalidateModelsStoreMemory(loraRoot);
    expect(Object.keys(loadModelsStore(loraRoot).hashes)).toHaveLength(0);

    const moved = path.join(loraRoot, 'new-folder', 'demo.safetensors');
    const ads = readAutoV2Ads(moved);
    if (result.written > 0) {
      expect(result.rematchedByBasename).toBe(1);
      expect(ads).toBe('1122334455');
    }
    // Non-NTFS temp: write may fail; still must not leave JSON hashes.
  });
});
