/**
 * Migration: AppData library datasets → folder sidecars.
 * Idempotent — skips when no legacy AppData library blobs remain (no flag file).
 *
 * Does not read user library *content* beyond writing sidecars next to
 * configured roots. Agents must not invoke this against real user folders
 * during development — use sample_wildcards + in-repo temp roots in tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  civitaiCatalogDir,
  configureWildcardsSidecarAppDataDir,
  downloadQueueJsonPath,
  hashMissesPath,
  isPathInsideRoot,
  masterImagesJsonPath,
  modelsJsonPath,
  rootRelativePosixKey,
  thumbnailsDir,
  validationJsonPath,
  wildcardsBackupsDir,
} from '../domain/librarySidecarPaths.js';
import {
  copyDirRecursive,
  removePathRecursive,
  atomicWriteFile,
  readJsonFile,
} from './librarySidecarIo.js';
import {
  libraryConfigToPayload,
  writeLibraryLocalPayload,
} from './libraryLocalState.js';
import {
  flushSettingsSync,
  listLibraryConfigs,
  loadSettings,
  type LibraryConfig,
} from './settingsStore.js';
import {
  type ManualLinkEntry,
  type ModelHashEntry,
  type ModelsStoreFile,
  saveModelsStore,
  invalidateModelsStoreMemory,
} from './modelRootStore.js';
import { configureCatalogCacheRoot } from './civitaiCatalogCache.js';
import { configureModelHashMissCacheRoot } from './modelHashMissCache.js';
import { migrateAllLibrariesWildcardsSidecarsToSibling } from './wildcardsSidecarMigration.js';

const LEGACY_APP_DATA_NAMES = [
  'model-hash-cache.json',
  'model-ratings.json',
  'model-civitai-links.json',
  'model-master-images.json',
  'model-hash-misses.json',
  'model-hash-misses-unbound.json',
  'civitai-catalog',
  'civitai-catalog-unbound',
  'civitai-preview-cache',
  'civitai-preview-cache-unbound',
  'civitai-catalog-cache.json.bak',
  'wildcard-validation',
  'backups',
  'settings.pre-multi-library-backup.json',
  // Obsolete one-shot flag from the first migrator; safe to delete anytime.
  'library-data-migration.json',
] as const;

function userData(): string {
  return app.getPath('userData');
}

function ensureWildcardsSidecarAppDataConfigured(): void {
  configureWildcardsSidecarAppDataDir(path.join(userData(), 'libraries'));
}

/**
 * Move in-tree `!.wcm` / `!Cache` under each wildcards root to sibling
 * `<basename>.wcm/` (ComfyUI Dynamic Prompts must not see them).
 */
function runWildcardsSiblingSidecarMigration(): void {
  ensureWildcardsSidecarAppDataConfigured();
  const roots = listLibraryConfigs().map((lib) => lib.wildcardsRoot);
  migrateAllLibrariesWildcardsSidecarsToSibling(roots);
}

/** True when no legacy library datasets remain under AppData. */
export function hasLegacyLibraryAppData(): boolean {
  const root = userData();
  try {
    for (const name of LEGACY_APP_DATA_NAMES) {
      if (fs.existsSync(path.join(root, name))) return true;
    }
    for (const name of fs.readdirSync(root)) {
      if (name.startsWith('civitai-model-download-queue-')) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Migration is “done” when legacy AppData library blobs are gone.
 * No permanent flag file is required (and any old flag is cleaned up).
 */
export function isLibraryDataMigrationDone(): boolean {
  return !hasLegacyLibraryAppData();
}

function partitionByRoot<T>(
  entries: Record<string, T>,
  roots: { lora: string | null; checkpoint: string | null },
): { lora: Record<string, T>; checkpoint: Record<string, T> } {
  const lora: Record<string, T> = {};
  const checkpoint: Record<string, T> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (roots.lora && isPathInsideRoot(key, roots.lora)) {
      lora[rootRelativePosixKey(key, roots.lora)] = value;
    } else if (roots.checkpoint && isPathInsideRoot(key, roots.checkpoint)) {
      checkpoint[rootRelativePosixKey(key, roots.checkpoint)] = value;
    }
  }
  return { lora, checkpoint };
}

function migrateModelsJson(lib: LibraryConfig): void {
  const hashFile = path.join(userData(), 'model-hash-cache.json');
  const ratingsFile = path.join(userData(), 'model-ratings.json');
  const linksFile = path.join(userData(), 'model-civitai-links.json');

  type HashFile = { version: 1; entries: Record<string, ModelHashEntry> };
  type RatingsFile = {
    version: 1;
    byAutoV2: Record<string, number>;
    byPath: Record<string, number>;
  };
  type LinksFile = {
    version: 1;
    byAutoV2: Record<string, ManualLinkEntry>;
    byPath: Record<string, ManualLinkEntry>;
  };

  const hashes = readJsonFile<HashFile>(hashFile)?.entries ?? {};
  const ratings = readJsonFile<RatingsFile>(ratingsFile);
  const links = readJsonFile<LinksFile>(linksFile);

  const roots = {
    lora: lib.loraFolder,
    checkpoint: lib.checkpointFolder,
  };

  const hashParts = partitionByRoot(hashes, roots);
  const ratingPathParts = partitionByRoot(ratings?.byPath ?? {}, roots);
  const linkPathParts = partitionByRoot(links?.byPath ?? {}, roots);

  const writeRoot = (
    root: string | null,
    part: {
      hashes: Record<string, ModelHashEntry>;
      ratingPaths: Record<string, number>;
      linkPaths: Record<string, ManualLinkEntry>;
    },
  ) => {
    if (!root?.trim()) return;
    const existing = readJsonFile<ModelsStoreFile>(modelsJsonPath(root));
    const store: ModelsStoreFile = {
      version: 1,
      hashes: { ...(existing?.hashes ?? {}), ...part.hashes },
      ratings: {
        byAutoV2: {
          ...(existing?.ratings?.byAutoV2 ?? {}),
          ...(ratings?.byAutoV2 ?? {}),
        },
        byPath: {
          ...(existing?.ratings?.byPath ?? {}),
          ...part.ratingPaths,
        },
      },
      links: {
        byAutoV2: {
          ...(existing?.links?.byAutoV2 ?? {}),
          ...(links?.byAutoV2 ?? {}),
        },
        byPath: {
          ...(existing?.links?.byPath ?? {}),
          ...part.linkPaths,
        },
      },
      ignored: Array.isArray(existing?.ignored) ? existing.ignored : [],
    };
    saveModelsStore(root, store);
  };

  writeRoot(lib.loraFolder, {
    hashes: hashParts.lora,
    ratingPaths: ratingPathParts.lora,
    linkPaths: linkPathParts.lora,
  });
  writeRoot(lib.checkpointFolder, {
    hashes: hashParts.checkpoint,
    ratingPaths: ratingPathParts.checkpoint,
    linkPaths: linkPathParts.checkpoint,
  });
}

function migrateLibraryPayload(lib: LibraryConfig): void {
  if (!lib.wildcardsRoot?.trim()) return;
  writeLibraryLocalPayload(
    lib.wildcardsRoot,
    libraryConfigToPayload(lib),
    lib.id,
  );
}

function migrateValidation(lib: LibraryConfig): void {
  if (!lib.wildcardsRoot?.trim()) return;
  const legacy = path.join(
    userData(),
    'wildcard-validation',
    `${lib.id.replace(/[^a-zA-Z0-9._-]+/g, '_')}.json`,
  );
  if (!fs.existsSync(legacy)) return;
  const dest = validationJsonPath(lib.wildcardsRoot);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(legacy, dest);
}

function migrateBackups(lib: LibraryConfig): void {
  if (!lib.wildcardsRoot?.trim()) return;
  const legacyBackups = path.join(userData(), 'backups');
  if (!fs.existsSync(legacyBackups)) return;
  const dest = wildcardsBackupsDir(lib.wildcardsRoot);
  // Copy all backup trees — historical roots may share the folder.
  copyDirRecursive(legacyBackups, dest);
}

function migrateCatalog(lib: LibraryConfig): void {
  if (!lib.wildcardsRoot?.trim()) return;
  const legacy = path.join(userData(), 'civitai-catalog');
  if (!fs.existsSync(legacy)) return;
  const dest = civitaiCatalogDir(lib.wildcardsRoot);
  if (fs.existsSync(dest)) return;
  copyDirRecursive(legacy, dest);
}

function migrateHashMisses(lib: LibraryConfig): void {
  if (!lib.wildcardsRoot?.trim()) return;
  const legacy = path.join(userData(), 'model-hash-misses.json');
  if (!fs.existsSync(legacy)) return;
  const dest = hashMissesPath(lib.wildcardsRoot);
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(legacy, dest);
}

function migratePreviews(lib: LibraryConfig): void {
  const legacy = path.join(userData(), 'civitai-preview-cache');
  if (!fs.existsSync(legacy)) return;
  const prefer =
    lib.loraFolder?.trim() || lib.checkpointFolder?.trim() || null;
  if (!prefer) return;
  const dest = thumbnailsDir(prefer);
  if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) return;
  copyDirRecursive(legacy, dest);
}

function migrateMasterImages(lib: LibraryConfig): void {
  if (!lib.checkpointFolder?.trim()) return;
  const legacy = path.join(userData(), 'model-master-images.json');
  if (!fs.existsSync(legacy)) return;
  const dest = masterImagesJsonPath(lib.checkpointFolder);
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(legacy, dest);
}

function migrateDownloadQueue(lib: LibraryConfig): void {
  const legacy = path.join(
    userData(),
    `civitai-model-download-queue-${lib.id}.json`,
  );
  if (!fs.existsSync(legacy)) return;
  type QueueFile = {
    version: 1;
    libraryId: string;
    jobs: Array<{ type: 'LORA' | 'Checkpoint'; [k: string]: unknown }>;
    paused?: boolean;
    pauseReason?: string;
  };
  const raw = readJsonFile<QueueFile>(legacy);
  if (!raw?.jobs?.length) return;
  const loraJobs = raw.jobs.filter((j) => j.type === 'LORA');
  const ckptJobs = raw.jobs.filter((j) => j.type === 'Checkpoint');
  if (lib.loraFolder?.trim() && loraJobs.length > 0) {
    atomicWriteFile(
      downloadQueueJsonPath(lib.loraFolder),
      `${JSON.stringify({ ...raw, jobs: loraJobs }, null, 2)}\n`,
    );
  }
  if (lib.checkpointFolder?.trim() && ckptJobs.length > 0) {
    atomicWriteFile(
      downloadQueueJsonPath(lib.checkpointFolder),
      `${JSON.stringify({ ...raw, jobs: ckptJobs }, null, 2)}\n`,
    );
  }
}

function cleanupLegacyAppData(): void {
  const root = userData();
  for (const name of LEGACY_APP_DATA_NAMES) {
    removePathRecursive(path.join(root, name));
  }
  try {
    for (const name of fs.readdirSync(root)) {
      if (name.startsWith('civitai-model-download-queue-')) {
        removePathRecursive(path.join(root, name));
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Bind in-memory cache roots to the active library folders.
 * Call on app ready and after library switch.
 */
export function bindActiveLibraryDataRoots(): void {
  ensureWildcardsSidecarAppDataConfigured();
  invalidateModelsStoreMemory();
  const lib = loadSettings().libraries?.find(
    (l) => l.id === loadSettings().activeLibraryId,
  ) ?? listLibraryConfigs()[0];
  // Catalog + hash-miss use getActiveLibrary() at read time; force catalog
  // remount when wildcards root changes.
  if (lib?.wildcardsRoot?.trim()) {
    configureCatalogCacheRoot(civitaiCatalogDir(lib.wildcardsRoot, lib.id));
    configureModelHashMissCacheRoot(path.dirname(hashMissesPath(lib.wildcardsRoot)));
  } else {
    configureCatalogCacheRoot(null);
    configureModelHashMissCacheRoot(null);
  }
}

/**
 * Relocate in-tree wildcards sidecars for every library. Safe to call before
 * hydrate/flush so ComfyUI DP folders are cleared early on startup.
 */
export function migrateWildcardsSidecarsForAllLibraries(): void {
  runWildcardsSiblingSidecarMigration();
}

/**
 * Migrates any remaining legacy AppData library blobs into folder sidecars,
 * then deletes leftovers. Idempotent: skips when AppData is already clean.
 * Always runs the wildcards in-tree → sibling `.wcm` relocation.
 */
export function runLibraryDataMigration(): {
  migrated: boolean;
  skipped: boolean;
} {
  ensureWildcardsSidecarAppDataConfigured();
  runWildcardsSiblingSidecarMigration();

  if (isLibraryDataMigrationDone()) {
    // Hydrate splits a shared catalog into one directory and one library.json
    // slot per library before the cache root is bound.
    loadSettings();
    bindActiveLibraryDataRoots();
    return { migrated: false, skipped: true };
  }

  loadSettings();
  const libraries = listLibraryConfigs();

  for (const lib of libraries) {
    migrateLibraryPayload(lib);
    migrateValidation(lib);
    migrateBackups(lib);
    migrateCatalog(lib);
    migrateHashMisses(lib);
    migratePreviews(lib);
    migrateModelsJson(lib);
    migrateMasterImages(lib);
    migrateDownloadQueue(lib);
  }

  // Persist pointer-only settings (writes library.json again for active libs).
  flushSettingsSync();
  cleanupLegacyAppData();
  bindActiveLibraryDataRoots();
  return { migrated: true, skipped: false };
}
