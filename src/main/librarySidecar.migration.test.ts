/**
 * Library sidecar migration tests — uses `sample_wildcards` + in-repo temp
 * model roots only. Never touches real user library folders.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  libraryJsonPath,
  modelsJsonPath,
  thumbnailsDir,
  civitaiCatalogDir,
  validationJsonPath,
  wildcardsSidecarRoot,
  WILDCARDS_SIDECAR_SUFFIX,
  WILDCARDS_CACHE_SUBDIR,
  WCM_DIR,
  CACHE_DIR,
  THUMBNAILS_DIR,
} from '../domain/librarySidecarPaths.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const sampleWildcards = path.join(repoRoot, 'sample_wildcards');

describe('library sidecar layout (sample_wildcards only)', () => {
  let tmpRoot: string;
  let wildcardsRoot: string;
  let loraRoot: string;
  let checkpointRoot: string;
  let userData: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-sidecar-'));
    // Keep synthetic model roots inside the temp dir (not user libraries).
    wildcardsRoot = path.join(tmpRoot, 'wildcards');
    loraRoot = path.join(tmpRoot, 'loras');
    checkpointRoot = path.join(tmpRoot, 'checkpoints');
    userData = path.join(tmpRoot, 'userData');
    fs.mkdirSync(wildcardsRoot, { recursive: true });
    fs.mkdirSync(loraRoot, { recursive: true });
    fs.mkdirSync(checkpointRoot, { recursive: true });
    fs.mkdirSync(userData, { recursive: true });
    // Seed a couple of wildcard files from the sample tree (copy, don't open
    // any configured user library).
    fs.copyFileSync(
      path.join(sampleWildcards, '0main.txt'),
      path.join(wildcardsRoot, '0main.txt'),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('exposes expected sidecar paths under each root', () => {
    const sibling = wildcardsSidecarRoot(wildcardsRoot);
    expect(sibling).toBe(
      path.join(tmpRoot, `wildcards${WILDCARDS_SIDECAR_SUFFIX}`),
    );
    expect(libraryJsonPath(wildcardsRoot)).toBe(
      path.join(sibling, 'library.json'),
    );
    expect(validationJsonPath(wildcardsRoot)).toBe(
      path.join(sibling, 'validation.json'),
    );
    expect(civitaiCatalogDir(wildcardsRoot)).toContain(WILDCARDS_CACHE_SUBDIR);
    expect(civitaiCatalogDir(wildcardsRoot).startsWith(sibling)).toBe(true);
    expect(modelsJsonPath(loraRoot)).toContain(WCM_DIR);
    expect(thumbnailsDir(loraRoot)).toContain(THUMBNAILS_DIR);
    expect(modelsJsonPath(checkpointRoot)).toContain(WCM_DIR);
    expect(thumbnailsDir(checkpointRoot)).toContain(THUMBNAILS_DIR);
  });

  it('writes library.json payload and models.json under synthetic roots', async () => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: {
        getPath: (name: string) =>
          name === 'userData' ? userData : path.join(tmpRoot, name),
      },
      BrowserWindow: {
        getAllWindows: () => [],
      },
    }));

    const { writeLibraryLocalPayload, readLibraryLocalPayload } =
      await import('./libraryLocalState.js');
    const { saveModelsStore, loadModelsStore } = await import(
      './modelRootStore.js'
    );

    writeLibraryLocalPayload(
      wildcardsRoot,
      {
        version: 1,
        lastRootFile: '0main.txt',
        ignoredUnusedLoras: ['foo.safetensors'],
        archivedCivitaiModels: [],
        validationPlatform: 'comfyui',
        enabledArchitectures: [],
        enabledSdxlFamilies: [],
        enabledCivitaiCategories: [],
      },
      'lib-a',
    );

    const payload = readLibraryLocalPayload(wildcardsRoot, 'lib-a');
    expect(payload?.lastRootFile).toBe('0main.txt');
    expect(fs.existsSync(libraryJsonPath(wildcardsRoot))).toBe(true);

    saveModelsStore(loraRoot, {
      version: 1,
      hashes: {
        'demo.safetensors': {
          size: 10,
          mtimeMs: 1,
          autoV2: 'AABBCCDDEE',
        },
      },
      ratings: { byAutoV2: {}, byPath: { 'demo.safetensors': 4 } },
      links: { byAutoV2: {}, byPath: {} },
      ignored: [],
    });
    const store = loadModelsStore(loraRoot);
    expect(store.hashes['demo.safetensors']?.autoV2).toBe('AABBCCDDEE');
    expect(store.ratings.byPath['demo.safetensors']).toBe(4);
    expect(fs.existsSync(modelsJsonPath(loraRoot))).toBe(true);
  });

  it('sample_wildcards remains readable as a normal library root', () => {
    expect(fs.existsSync(path.join(sampleWildcards, '0main.txt'))).toBe(true);
    const names = fs.readdirSync(sampleWildcards);
    expect(names.includes('0main.txt')).toBe(true);
    // Utility dirs must not appear in the shipped sample.
    expect(names.includes(WCM_DIR)).toBe(false);
    expect(names.includes(CACHE_DIR)).toBe(false);
  });
});
