import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  libraryJsonPath,
  libraryShelfFile,
  WCM_DIR,
  wildcardsBackupsDir,
} from '../domain/librarySidecarPaths.js';
import {
  LIBRARY_LOCAL_VERSION,
  protectLibraryListsFromEmptyClobber,
  readLibraryLocalPayload,
  type LibraryLocalPayload,
} from './libraryLocalState.js';
import {
  migrateLoraCategoryFiles,
  splitLibraryShelves,
  writeLibrarySlot,
} from './libraryLocalFile.js';
import { migratePerLibraryCatalogs } from './perLibraryCatalogMigration.js';

function basePayload(
  patch: Partial<LibraryLocalPayload> = {},
): LibraryLocalPayload {
  return {
    version: LIBRARY_LOCAL_VERSION,
    ignoredUnusedLoras: [],
    archivedCivitaiModels: [],
    maybeCivitaiModels: [],
    markedInstalledCivitaiModels: [],
    markedInstalledCivitaiVersions: [],
    civitaiWatchlist: [],
    enabledArchitectures: [],
    enabledSdxlFamilies: [],
    enabledCivitaiCategories: [],
    validationPlatform: 'comfyui',
    civitaiOrigin: 'https://civitai.com',
    ...patch,
  };
}

describe('protectLibraryListsFromEmptyClobber', () => {
  it('blocks catastrophic wipe when all incoming lists are empty', () => {
    const existing = basePayload({
      archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 1 }],
      maybeCivitaiModels: [{ origin: 'https://civitai.com', modelId: 2 }],
      civitaiWatchlist: [
        {
          origin: 'https://civitai.com',
          modelId: 3,
          modelName: 'x',
          type: 'LORA',
          available: false,
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const incoming = basePayload({ lastRootFile: 'keep-me.txt' });
    const next = protectLibraryListsFromEmptyClobber(incoming, existing);
    expect(next.lastRootFile).toBe('keep-me.txt');
    expect(next.archivedCivitaiModels).toEqual(existing.archivedCivitaiModels);
    expect(next.maybeCivitaiModels).toEqual(existing.maybeCivitaiModels);
    expect(next.civitaiWatchlist).toEqual(existing.civitaiWatchlist);
  });

  it('allows clearing the last item of a single list while others remain', () => {
    const existing = basePayload({
      archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 1 }],
      maybeCivitaiModels: [{ origin: 'https://civitai.com', modelId: 2 }],
    });
    const incoming = basePayload({
      archivedCivitaiModels: [],
      maybeCivitaiModels: [{ origin: 'https://civitai.com', modelId: 2 }],
    });
    const next = protectLibraryListsFromEmptyClobber(incoming, existing);
    expect(next.archivedCivitaiModels).toEqual([]);
    expect(next.maybeCivitaiModels).toEqual(existing.maybeCivitaiModels);
  });

  it('blocks wiping a multi-item list to empty while others remain', () => {
    const existing = basePayload({
      archivedCivitaiModels: [
        { origin: 'https://civitai.com', modelId: 1 },
        { origin: 'https://civitai.com', modelId: 3 },
      ],
      maybeCivitaiModels: [{ origin: 'https://civitai.com', modelId: 2 }],
      civitaiWatchlist: [
        {
          origin: 'https://civitai.com',
          modelId: 9,
          modelName: 'notify',
          type: 'LORA',
          available: false,
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const incoming = basePayload({
      archivedCivitaiModels: [],
      maybeCivitaiModels: [{ origin: 'https://civitai.com', modelId: 2 }],
      civitaiWatchlist: existing.civitaiWatchlist,
    });
    const next = protectLibraryListsFromEmptyClobber(incoming, existing);
    expect(next.archivedCivitaiModels).toEqual(existing.archivedCivitaiModels);
    expect(next.maybeCivitaiModels).toEqual(existing.maybeCivitaiModels);
    expect(next.civitaiWatchlist).toEqual(existing.civitaiWatchlist);
  });

  it('allows intentional empty via allowEmptyMembershipLists', () => {
    const existing = basePayload({
      archivedCivitaiModels: [
        { origin: 'https://civitai.com', modelId: 1 },
        { origin: 'https://civitai.com', modelId: 3 },
      ],
    });
    const incoming = basePayload({ archivedCivitaiModels: [] });
    const next = protectLibraryListsFromEmptyClobber(incoming, existing, {
      allowEmptyMembershipLists: true,
    });
    expect(next.archivedCivitaiModels).toEqual([]);
  });

  it('allows intentional non-empty updates', () => {
    const existing = basePayload({
      archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 1 }],
    });
    const incoming = basePayload({
      archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 9 }],
    });
    const next = protectLibraryListsFromEmptyClobber(incoming, existing);
    expect(next.archivedCivitaiModels).toEqual([
      { origin: 'https://civitai.com', modelId: 9 },
    ]);
  });

  it('blocks wiping categories even when membership lists remain', () => {
    const existing = basePayload({
      archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 1 }],
      loraDownloadCategories: [
        {
          id: 'c1',
          name: 'Style',
          folder: 'Style',
          wildcardRelativePath: 'styles.txt',
          defaultWeights: '{0.8|0.9|1|1}',
        },
      ],
    });
    const incoming = basePayload({
      archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 1 }],
      loraDownloadCategories: [],
    });
    const next = protectLibraryListsFromEmptyClobber(incoming, existing);
    expect(next.loraDownloadCategories).toEqual(existing.loraDownloadCategories);
  });
});

describe('readLibraryLocalPayload', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps sibling-only fields when the legacy file has more membership rows', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-lib-'));
    temps.push(parent);
    const root = path.join(parent, 'wildcards');
    fs.mkdirSync(root, { recursive: true });
    const rules = [
      { modelContains: 'Kroma', find: '__loraname__', replace: '__loraname-KromaVersion__' },
    ];
    fs.mkdirSync(path.join(parent, 'wildcards.wcm'), { recursive: true });
    fs.writeFileSync(
      path.join(parent, 'wildcards.wcm', 'library.json'),
      `${JSON.stringify({
        version: 1,
        promptSubstitutions: rules,
        archivedCivitaiModels: [],
      })}\n`,
    );
    fs.mkdirSync(path.join(root, WCM_DIR), { recursive: true });
    fs.writeFileSync(
      path.join(root, WCM_DIR, 'library.json'),
      `${JSON.stringify({
        version: 1,
        archivedCivitaiModels: [
          { origin: 'https://civitai.com', modelId: 1 },
          { origin: 'https://civitai.com', modelId: 2 },
        ],
        ignoredCheckpoints: ['old.safetensors'],
      })}\n`,
    );

    const payload = readLibraryLocalPayload(root, 'lib-a');
    expect(payload?.promptSubstitutions).toEqual(rules);
    expect(payload?.archivedCivitaiModels).toHaveLength(2);
    expect(payload?.ignoredCheckpoints).toEqual(['old.safetensors']);
  });

  it('keeps a separate archive list and catalog for each library', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-lib-'));
    temps.push(parent);
    const root = path.join(parent, 'wildcards');
    fs.mkdirSync(root, { recursive: true });
    const sharedCatalog = path.join(parent, 'wildcards.wcm', 'cache', 'civitai-catalog');
    fs.mkdirSync(path.join(sharedCatalog, 'models'), { recursive: true });
    fs.writeFileSync(path.join(sharedCatalog, 'models', 'page.json'), '{}\n');
    fs.writeFileSync(path.join(sharedCatalog, 'meta.json'), '{"shared":true}\n');
    fs.writeFileSync(
      path.join(parent, 'wildcards.wcm', 'library.json'),
      `${JSON.stringify({
        version: 1,
        archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 7 }],
        validationPlatform: 'comfyui',
        civitaiOrigin: 'https://civitai.com',
        enabledArchitectures: [],
        enabledSdxlFamilies: [],
        enabledCivitaiCategories: [],
      })}\n`,
    );

    migratePerLibraryCatalogs(root, ['lib-a', 'lib-b']);

    const backupRoot = path.join(parent, 'wildcards.wcm', 'backups');
    const stamps = fs.readdirSync(backupRoot).filter((name) =>
      name.startsWith('pre-migrate-'),
    );
    const libraryBackup = stamps
      .map((name) => path.join(backupRoot, name, 'library.json'))
      .find((file) => fs.existsSync(file));
    expect(libraryBackup).toBeTruthy();
    expect(fs.readFileSync(libraryBackup!, 'utf8')).toContain('"version":1');

    expect(readLibraryLocalPayload(root, 'lib-a')?.archivedCivitaiModels).toEqual([
      { origin: 'https://civitai.com', modelId: 7 },
    ]);
    expect(readLibraryLocalPayload(root, 'lib-b')?.archivedCivitaiModels).toEqual([
      { origin: 'https://civitai.com', modelId: 7 },
    ]);
    expect(fs.existsSync(path.join(sharedCatalog, 'meta.json'))).toBe(false);
    expect(
      fs.readFileSync(
        path.join(sharedCatalog, 'lib-a', 'meta.json'),
        'utf8',
      ),
    ).toContain('shared');
    expect(fs.existsSync(path.join(sharedCatalog, 'lib-b', 'models'))).toBe(true);

    writeLibrarySlot(root, 'lib-a', {
      ...basePayload(),
      archivedCivitaiModels: [
        { origin: 'https://civitai.com', modelId: 7 },
        { origin: 'https://civitai.com', modelId: 8 },
      ],
    });

    expect(readLibraryLocalPayload(root, 'lib-a')?.archivedCivitaiModels).toHaveLength(2);
    expect(readLibraryLocalPayload(root, 'lib-b')?.archivedCivitaiModels).toHaveLength(1);
    migratePerLibraryCatalogs(root, ['lib-a', 'lib-b']);
    expect(readLibraryLocalPayload(root, 'lib-b')?.archivedCivitaiModels).toHaveLength(1);
  });

  it('restores model shelves from an older library.json when the current lists are empty', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-lib-'));
    temps.push(parent);
    const root = path.join(parent, 'wildcards');
    fs.mkdirSync(path.join(root, '!.wcm'), { recursive: true });
    fs.mkdirSync(path.join(parent, 'wildcards.wcm'), { recursive: true });
    fs.writeFileSync(
      path.join(parent, 'wildcards.wcm', 'library.json'),
      `${JSON.stringify({
        version: 2,
        byLibrary: {
          'lib-a': {
            version: 1,
            archivedCivitaiModels: [],
            maybeCivitaiModels: [],
            civitaiWatchlist: [],
            ignoredUnusedLoras: ['keep-me.safetensors'],
          },
        },
      })}\n`,
    );
    fs.writeFileSync(
      path.join(root, '!.wcm', 'library.json'),
      `${JSON.stringify({
        version: 1,
        archivedCivitaiModels: [
          { origin: 'https://civitai.com', modelId: 4 },
          { origin: 'https://civitai.com', modelId: 5 },
        ],
        maybeCivitaiModels: [{ origin: 'https://civitai.com', modelId: 6 }],
        civitaiWatchlist: [
          {
            origin: 'https://civitai.com',
            modelId: 9,
            modelName: 'notify',
            type: 'LORA',
            available: false,
            addedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })}\n`,
    );

    migratePerLibraryCatalogs(root, ['lib-a']);
    const slot = readLibraryLocalPayload(root, 'lib-a');
    expect(slot?.archivedCivitaiModels).toHaveLength(2);
    expect(slot?.maybeCivitaiModels).toHaveLength(1);
    expect(slot?.civitaiWatchlist).toHaveLength(1);
    expect(slot?.ignoredUnusedLoras).toEqual(['keep-me.safetensors']);
  });

  it('copies a shared catalog over an empty per-library models folder', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-lib-'));
    temps.push(parent);
    const root = path.join(parent, 'wildcards');
    fs.mkdirSync(root, { recursive: true });
    const shared = path.join(parent, 'wildcards.wcm', 'cache', 'civitai-catalog');
    fs.mkdirSync(path.join(shared, 'lib-a', 'models'), { recursive: true });
    fs.mkdirSync(path.join(shared, 'models'), { recursive: true });
    fs.writeFileSync(path.join(shared, 'models', 'page.json'), '{"page":1}\n');
    fs.writeFileSync(path.join(shared, 'meta.json'), '{"shared":true}\n');
    fs.writeFileSync(
      path.join(parent, 'wildcards.wcm', 'library.json'),
      `${JSON.stringify({ version: 2, byLibrary: {} })}\n`,
    );

    migratePerLibraryCatalogs(root, ['lib-a']);

    expect(
      fs.readFileSync(path.join(shared, 'lib-a', 'models', 'page.json'), 'utf8'),
    ).toContain('page');
    expect(fs.existsSync(path.join(shared, 'models', 'page.json'))).toBe(false);
  });

  it('leaves Archive and Maybe alone when only a shelf-summaries backup has rows', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-lib-'));
    temps.push(parent);
    const root = path.join(parent, 'wildcards');
    fs.mkdirSync(root, { recursive: true });
    const saved = path.join(
      parent,
      'wildcards.wcm',
      'backups',
      'pre-migrate-test',
      'civitai-catalog',
    );
    fs.mkdirSync(saved, { recursive: true });
    fs.writeFileSync(
      path.join(saved, 'shelf-summaries.json'),
      `${JSON.stringify({
        version: 1,
        origin: 'https://civitai.com',
        archived: [{ id: 4 }, { id: 5 }],
        maybe: [{ id: 6 }],
        downloaded: [{ id: 1 }, { id: 2 }, { id: 3 }],
      })}\n`,
    );
    fs.writeFileSync(
      path.join(parent, 'wildcards.wcm', 'library.json'),
      `${JSON.stringify({
        version: 2,
        byLibrary: {
          'lib-a': {
            version: 1,
            archivedCivitaiModels: [],
            maybeCivitaiModels: [],
            civitaiWatchlist: [],
          },
        },
      })}\n`,
    );
    const liveShelf = path.join(
      parent,
      'wildcards.wcm',
      'cache',
      'civitai-catalog',
      'lib-a',
    );
    fs.mkdirSync(liveShelf, { recursive: true });
    fs.writeFileSync(
      path.join(liveShelf, 'shelf-summaries.json'),
      `${JSON.stringify({
        version: 1,
        origin: 'https://civitai.com',
        downloaded: [{ id: 1 }],
        archived: [],
        maybe: [],
      })}\n`,
    );

    migratePerLibraryCatalogs(root, ['lib-a']);

    const slot = readLibraryLocalPayload(root, 'lib-a');
    expect(slot?.archivedCivitaiModels).toHaveLength(0);
    expect(slot?.maybeCivitaiModels).toHaveLength(0);
    const restored = JSON.parse(
      fs.readFileSync(path.join(liveShelf, 'shelf-summaries.json'), 'utf8'),
    ) as { downloaded: unknown[] };
    expect(restored.downloaded).toHaveLength(1);
  });

  it('leaves a short Archive list alone when a backup is longer', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-lib-'));
    temps.push(parent);
    const root = path.join(parent, 'wildcards');
    fs.mkdirSync(root, { recursive: true });
    const archived = Array.from({ length: 400 }, (_, index) => ({
      origin: 'https://civitai.com',
      modelId: index + 1,
    }));
    fs.mkdirSync(
      path.join(parent, 'wildcards.wcm', 'backups', 'pre-migrate-full'),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(
        parent,
        'wildcards.wcm',
        'backups',
        'pre-migrate-full',
        'library.json',
      ),
      `${JSON.stringify({
        version: 1,
        archivedCivitaiModels: archived,
        civitaiWatchlist: [
          {
            origin: 'https://civitai.com',
            modelId: 9,
            modelName: 'notify',
            type: 'LORA',
            available: false,
            addedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })}\n`,
    );
    fs.writeFileSync(
      path.join(parent, 'wildcards.wcm', 'library.json'),
      `${JSON.stringify({
        version: 2,
        byLibrary: {
          'lib-a': {
            version: 1,
            archivedCivitaiModels: [
              { origin: 'https://civitai.com', modelId: 1 },
              { origin: 'https://civitai.com', modelId: 2 },
            ],
            maybeCivitaiModels: [],
            civitaiWatchlist: [],
          },
        },
      })}\n`,
    );

    migratePerLibraryCatalogs(root, ['lib-a']);
    const slot = readLibraryLocalPayload(root, 'lib-a');
    expect(slot?.archivedCivitaiModels).toHaveLength(2);
    expect(slot?.civitaiWatchlist ?? []).toHaveLength(0);
  });

  it('ignores a library.json nested under backups', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-lib-'));
    temps.push(parent);
    const root = path.join(parent, 'wildcards');
    fs.mkdirSync(root, { recursive: true });
    const archived = Array.from({ length: 400 }, (_, index) => ({
      origin: 'https://civitai.com',
      modelId: index + 1,
    }));
    const nested = path.join(
      parent,
      'wildcards.wcm',
      'backups',
      'older',
      'snap',
    );
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, 'library.json'),
      `${JSON.stringify({
        version: 1,
        archivedCivitaiModels: archived,
      })}\n`,
    );
    fs.writeFileSync(
      path.join(parent, 'wildcards.wcm', 'library.json'),
      `${JSON.stringify({
        version: 2,
        byLibrary: {
          'lib-a': {
            version: 1,
            archivedCivitaiModels: [
              { origin: 'https://civitai.com', modelId: 1 },
            ],
          },
        },
      })}\n`,
    );

    migratePerLibraryCatalogs(root, ['lib-a']);
    expect(readLibraryLocalPayload(root, 'lib-a')?.archivedCivitaiModels).toHaveLength(
      1,
    );
  });

  it('refuses to save a short Archive list over a much longer one', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-lib-'));
    temps.push(parent);
    const root = path.join(parent, 'wildcards');
    fs.mkdirSync(root, { recursive: true });
    const archived = Array.from({ length: 400 }, (_, index) => ({
      origin: 'https://civitai.com' as const,
      modelId: index + 1,
    }));
    writeLibrarySlot(root, 'lib-a', basePayload({ archivedCivitaiModels: archived }));
    writeLibrarySlot(
      root,
      'lib-a',
      basePayload({
        archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 1 }],
      }),
    );
    expect(readLibraryLocalPayload(root, 'lib-a')?.archivedCivitaiModels).toHaveLength(
      400,
    );
  });

  it('stores LoRA, checkpoint, image, and Hugging Face shelves in separate files', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-lib-'));
    temps.push(parent);
    const root = path.join(parent, 'wildcards');
    fs.mkdirSync(root, { recursive: true });
    writeLibrarySlot(
      root,
      'lib-a',
      basePayload({
        archivedCivitaiModels: [
          { origin: 'https://civitai.com', modelId: 1, modelType: 'LORA' },
          { origin: 'https://civitai.com', modelId: 2, modelType: 'Checkpoint' },
        ],
        archivedCivitaiImages: [{ origin: 'https://civitai.com', imageId: 9 }],
        archivedHfModels: [{ repoId: 'org/name' }],
        loraDownloadCategories: [
          {
            id: 'cat',
            name: 'People',
            folder: 'people',
            wildcardRelativePath: 'people.txt',
            defaultWeights: '0.8',
          },
        ],
      }),
    );
    const loraFile = libraryShelfFile(root, 'lib-a', 'civitai-loras.json');
    const imageFile = libraryShelfFile(root, 'lib-a', 'civitai-images.json');
    expect(fs.existsSync(loraFile)).toBe(true);
    expect(fs.existsSync(imageFile)).toBe(true);
    expect(fs.existsSync(libraryShelfFile(root, 'lib-a', 'huggingface.json'))).toBe(
      true,
    );
    fs.rmSync(imageFile);
    const slot = readLibraryLocalPayload(root, 'lib-a');
    expect(slot?.archivedCivitaiImages).toEqual([]);
    expect(slot?.archivedCivitaiModels).toHaveLength(2);
    expect(slot?.archivedHfModels).toEqual([{ repoId: 'org/name' }]);
    expect(slot?.loraDownloadCategories).toHaveLength(1);
    const categoryFile = JSON.parse(
      fs.readFileSync(libraryShelfFile(root, 'lib-a', 'categories.json'), 'utf8'),
    ) as { loraDownloadCategories: unknown[] };
    expect(categoryFile.loraDownloadCategories).toHaveLength(1);
    const prefsText = fs.readFileSync(
      libraryShelfFile(root, 'lib-a', 'library.json'),
      'utf8',
    );
    expect(prefsText.includes('loraDownloadCategories')).toBe(false);
    const checkpoints = JSON.parse(
      fs.readFileSync(
        libraryShelfFile(root, 'lib-a', 'civitai-checkpoints.json'),
        'utf8',
      ),
    ) as { archived: Array<{ modelId: number }> };
    expect(checkpoints.archived.map((row) => row.modelId)).toEqual([2]);
  });

  it('moves each library’s LoRA categories into its own categories.json', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-lib-'));
    temps.push(parent);
    const root = path.join(parent, 'wildcards');
    fs.mkdirSync(root, { recursive: true });
    const category = (id: string) => ({
      id,
      name: id,
      folder: id,
      wildcardRelativePath: `${id}.txt`,
      defaultWeights: '0.8',
    });
    writeLibrarySlot(root, 'lib-a', basePayload());
    writeLibrarySlot(root, 'lib-b', basePayload());
    for (const id of ['lib-a', 'lib-b']) {
      fs.rmSync(libraryShelfFile(root, id, 'categories.json'));
    }
    const prefsA = libraryShelfFile(root, 'lib-a', 'library.json');
    const prefsRaw = JSON.parse(fs.readFileSync(prefsA, 'utf8')) as Record<
      string,
      unknown
    >;
    prefsRaw.loraDownloadCategories = [category('one')];
    prefsRaw.lastLoraDownloadCategoryId = 'one';
    fs.writeFileSync(prefsA, JSON.stringify(prefsRaw));
    const backupDir = path.join(wildcardsBackupsDir(root), 'pre-migrate-old');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(
      path.join(backupDir, 'library.json'),
      JSON.stringify({
        version: 2,
        byLibrary: {
          'lib-a': basePayload({
            loraDownloadCategories: [category('one'), category('two'), category('three')],
            lastLoraDownloadCategoryId: 'three',
          }),
          'lib-b': basePayload(),
        },
      }),
    );
    migrateLoraCategoryFiles(root, ['lib-a', 'lib-b']);
    expect(readLibraryLocalPayload(root, 'lib-a')?.loraDownloadCategories).toHaveLength(
      1,
    );
    expect(readLibraryLocalPayload(root, 'lib-a')?.lastLoraDownloadCategoryId).toBe(
      'one',
    );
    expect(readLibraryLocalPayload(root, 'lib-b')?.loraDownloadCategories ?? []).toHaveLength(
      0,
    );
    expect(fs.readFileSync(prefsA, 'utf8').includes('loraDownloadCategories')).toBe(
      false,
    );
    const backupsAfter = fs
      .readdirSync(wildcardsBackupsDir(root))
      .filter((name) => name.startsWith('pre-migrate-'));
    fs.writeFileSync(
      path.join(backupDir, 'library.json'),
      JSON.stringify({
        version: 2,
        byLibrary: {
          'lib-a': basePayload({
            loraDownloadCategories: [
              category('one'),
              category('two'),
              category('three'),
              category('four'),
            ],
          }),
        },
      }),
    );
    migrateLoraCategoryFiles(root, ['lib-a', 'lib-b']);
    expect(readLibraryLocalPayload(root, 'lib-a')?.loraDownloadCategories).toHaveLength(
      1,
    );
    expect(
      fs
        .readdirSync(wildcardsBackupsDir(root))
        .filter((name) => name.startsWith('pre-migrate-')),
    ).toEqual(backupsAfter);
  });

  it('splits every library stored in the combined file', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-lib-'));
    temps.push(parent);
    const root = path.join(parent, 'wildcards');
    fs.mkdirSync(root, { recursive: true });
    const file = libraryJsonPath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        byLibrary: {
          'lib-a': basePayload({
            archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 1 }],
          }),
          'lib-b': basePayload({
            archivedCivitaiImages: [{ origin: 'https://civitai.com', imageId: 4 }],
          }),
        },
      }),
    );
    expect(splitLibraryShelves(root, ['lib-a'])).toBe(true);
    expect(readLibraryLocalPayload(root, 'lib-b')?.archivedCivitaiImages).toEqual([
      { origin: 'https://civitai.com', imageId: 4 },
    ]);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      version: 3,
      split: true,
    });
  });

  it('migrates a combined library.json once on upgrade', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-lib-'));
    temps.push(parent);
    const root = path.join(parent, 'wildcards');
    fs.mkdirSync(root, { recursive: true });
    const file = libraryJsonPath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const images = Array.from({ length: 10 }, (_, index) => ({
      origin: 'https://civitai.com' as const,
      imageId: index + 1,
    }));
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 2,
        byLibrary: {
          'lib-a': basePayload({
            archivedCivitaiModels: [
              { origin: 'https://civitai.com', modelId: 1, modelType: 'LORA' },
            ],
            archivedCivitaiImages: images,
            archivedHfModels: [{ repoId: 'org/name' }],
          }),
          'lib-b': {
            archivedCivitaiModels: [
              { origin: 'https://civitai.com', modelId: 2, modelType: 'Checkpoint' },
            ],
          },
        },
      }),
    );

    migratePerLibraryCatalogs(root, ['lib-a']);

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      version: 3,
      split: true,
    });
    expect(readLibraryLocalPayload(root, 'lib-a')?.archivedCivitaiImages).toHaveLength(10);
    expect(readLibraryLocalPayload(root, 'lib-a')?.archivedHfModels).toEqual([
      { repoId: 'org/name' },
    ]);
    expect(readLibraryLocalPayload(root, 'lib-b')?.archivedCivitaiModels).toEqual([
      { origin: 'https://civitai.com', modelId: 2, modelType: 'Checkpoint' },
    ]);
    expect(readLibraryLocalPayload(root, 'lib-b')?.archivedCivitaiImages ?? []).toHaveLength(0);
    const backupRoot = path.join(path.dirname(file), 'backups');
    const stamps = () =>
      fs.readdirSync(backupRoot).filter((name) => name.startsWith('pre-migrate-'));
    const before = stamps();
    expect(before.length).toBeGreaterThan(0);
    expect(
      fs.readFileSync(path.join(backupRoot, before[0]!, 'library.json'), 'utf8'),
    ).toContain('"version":2');

    const saved = readLibraryLocalPayload(root, 'lib-a');
    writeLibrarySlot(
      root,
      'lib-a',
      {
        ...saved!,
        archivedCivitaiImages: images.slice(0, 9),
      },
      { replaceManualShelves: true },
    );
    migratePerLibraryCatalogs(root, ['lib-a', 'lib-b']);
    expect(readLibraryLocalPayload(root, 'lib-a')?.archivedCivitaiImages).toHaveLength(9);
    expect(readLibraryLocalPayload(root, 'lib-b')?.archivedCivitaiModels).toHaveLength(1);
    expect(stamps()).toEqual(before);
  });
});
