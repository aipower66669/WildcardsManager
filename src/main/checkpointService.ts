import fs from 'node:fs';
import path from 'node:path';
import {
  CHECKPOINT_EXTENSIONS,
  addLoraFile,
  reuseLoraFile,
  searchLoraIndex,
  type LoraFileEntry,
  type LoraIndex,
  type LoraSearchHit,
} from '../domain/lora.js';
import { pickCivitaiAutoV2, unionAutoV2Hashes } from '../domain/modelHash.js';
import { loadSettings } from './settingsStore.js';
import {
  attachCachedAutoV2Hashes,
  attachCachedAutoV2HashForFile,
  ensureIndexAutoV2Hashes,
} from './modelHashCache.js';
import { setMainActivityJob } from './mainActivity.js';
import { noteResolvedFileIngested } from './modelResolveState.js';
import {
  walkModelFolderEntries,
  walkModelFolderEntriesAsync,
} from './modelFolderWalk.js';
import { walkModelFolderInWorker } from './modelFolderWalkWorkerClient.js';
import {
  hydrateModelIndex,
  persistModelIndex,
} from './modelFileIndexCache.js';

let cached: { root: string; builtAt: number; index: LoraIndex } | null = null;

function addIfCheckpoint(
  index: LoraIndex,
  abs: string,
  relative: string,
  previousByRel?: Map<string, LoraFileEntry>,
): void {
  const ext = path.extname(abs).toLowerCase();
  if (!(CHECKPOINT_EXTENSIONS as readonly string[]).includes(ext)) return;
  const rel = relative.replace(/\\/g, '/');
  const old = previousByRel?.get(rel.toLowerCase());
  if (old) {
    // Keep the stored AutoV2 even when the walk reports a different absolute
    // path (junction / casing). Dropping it made owned checkpoints look new.
    const same =
      path.resolve(old.absolutePath).toLowerCase() ===
      path.resolve(abs).toLowerCase();
    reuseLoraFile(
      index,
      same ? old : { ...old, absolutePath: path.resolve(abs) },
    );
    return;
  }
  addLoraFile(index, rel, abs);
}

function previousByRel(index: LoraIndex | null | undefined): Map<string, LoraFileEntry> | undefined {
  if (!index || index.files.length === 0) return undefined;
  return new Map(
    index.files.map((file) => [file.relativePath.replace(/\\/g, '/').toLowerCase(), file]),
  );
}

function isReadableModelRoot(root: string): boolean {
  try {
    return fs.existsSync(root) && fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

function emptyIndex(root: string): LoraIndex {
  return {
    root,
    aliases: new Map(),
    files: [],
    fileCount: 0,
  };
}

function walkModelFiles(
  root: string,
  dir: string,
  index: LoraIndex,
  previous?: LoraIndex | null,
): void {
  const prior = previousByRel(previous);
  walkModelFolderEntries(
    root,
    dir,
    (abs, relative) => {
      addIfCheckpoint(index, abs, relative, prior);
    },
    undefined,
    { weightExtensions: new Set(CHECKPOINT_EXTENSIONS) },
  );
}

export function buildCheckpointIndex(
  root: string,
  previous?: LoraIndex | null,
): LoraIndex {
  const resolvedRoot = path.resolve(root);
  const index = emptyIndex(resolvedRoot);

  try {
    if (
      fs.existsSync(resolvedRoot) &&
      fs.statSync(resolvedRoot).isDirectory()
    ) {
      walkModelFiles(resolvedRoot, resolvedRoot, index, previous);
    }
  } catch {
    // Unreadable folder → empty index.
  }

  return index;
}

export async function buildCheckpointIndexAsync(
  root: string,
  previous?: LoraIndex | null,
): Promise<LoraIndex> {
  const resolvedRoot = path.resolve(root);
  const index = emptyIndex(resolvedRoot);
  const prior = previousByRel(previous);
  try {
    if (
      fs.existsSync(resolvedRoot) &&
      fs.statSync(resolvedRoot).isDirectory()
    ) {
      await walkModelFolderEntriesAsync(
        resolvedRoot,
        resolvedRoot,
        (abs, relative) => {
          addIfCheckpoint(index, abs, relative, prior);
        },
        {
          weightExtensions: new Set(CHECKPOINT_EXTENSIONS),
          onProgress: (files) => {
            setMainActivityJob(
              'checkpoint-index',
              `Scanning checkpoint folder… ${files.toLocaleString()} files`,
            );
          },
        },
      );
    }
  } catch {
    // Unreadable folder → empty index.
  }
  return index;
}

let walkInflight: Promise<LoraIndex | null> | null = null;

function cacheMatches(folder: string): boolean {
  return Boolean(
    cached && cached.root.toLowerCase() === path.resolve(folder).toLowerCase(),
  );
}

/** Cached index only — never walks the disk. */
export function getConfiguredCheckpointIndex(): LoraIndex | null {
  const folder = loadSettings().checkpointFolder;
  if (!folder) return null;
  if (cacheMatches(folder)) return cached!.index;
  const resolved = path.resolve(folder);
  const persisted = hydrateModelIndex(resolved);
  if (persisted) {
    cached = { root: persisted.root, builtAt: Date.now(), index: persisted };
    void startCheckpointWalk(resolved, persisted, { quiet: true });
    return persisted;
  }
  void ensureCheckpointIndex();
  return null;
}

export async function requireConfiguredCheckpointIndex(opts?: {
  force?: boolean;
}): Promise<LoraIndex> {
  const folder = loadSettings().checkpointFolder;
  if (!folder) throw new Error('No checkpoint folder configured');
  const index = await ensureCheckpointIndex(opts);
  if (!index) throw new Error('No checkpoint folder configured');
  return index;
}

export async function ensureCheckpointIndex(opts?: {
  force?: boolean;
}): Promise<LoraIndex | null> {
  const folder = loadSettings().checkpointFolder;
  if (!folder) return null;
  const resolved = path.resolve(folder);
  const have = cacheMatches(folder);
  if (!opts?.force && have) return cached!.index;
  const persisted = have ? null : hydrateModelIndex(resolved);
  if (!opts?.force && persisted) {
    cached = { root: persisted.root, builtAt: Date.now(), index: persisted };
    void startCheckpointWalk(resolved, persisted, { quiet: true });
    return persisted;
  }
  return startCheckpointWalk(resolved, have ? cached!.index : persisted);
}

function startCheckpointWalk(
  resolved: string,
  previous: LoraIndex | null,
  opts?: { quiet?: boolean },
): Promise<LoraIndex | null> {
  if (walkInflight) return walkInflight;
  walkInflight = (async () => {
    if (!opts?.quiet) {
      setMainActivityJob('checkpoint-index', 'Scanning checkpoint folder…');
    }
    try {
      const index = await collectCheckpointIndex(
        resolved,
        previous,
        opts?.quiet,
      );
      if (isReadableModelRoot(resolved)) persistModelIndex(index);
      cached = { root: index.root, builtAt: Date.now(), index };
      return index;
    } finally {
      setMainActivityJob('checkpoint-index', null);
      walkInflight = null;
    }
  })();
  return walkInflight;
}

async function collectCheckpointIndex(
  resolved: string,
  previous: LoraIndex | null,
  quiet?: boolean,
): Promise<LoraIndex> {
  try {
    const hits = await walkModelFolderInWorker(
      resolved,
      CHECKPOINT_EXTENSIONS,
      {
        onProgress: (files) => {
          if (quiet) return;
          setMainActivityJob(
            'checkpoint-index',
            `Scanning checkpoint folder… ${files.toLocaleString()} files`,
          );
        },
      },
    );
    const index = emptyIndex(resolved);
    const prior = previousByRel(previous);
    for (const hit of hits) addIfCheckpoint(index, hit.abs, hit.rel, prior);
    return index;
  } catch {
    return buildCheckpointIndexAsync(resolved, previous);
  }
}

/** Checkpoint index with AutoV2 hashes filled from the persistent cache. */
export async function getConfiguredCheckpointIndexHashed(): Promise<LoraIndex | null> {
  const index = getConfiguredCheckpointIndex();
  if (!index) return null;
  return ensureIndexAutoV2Hashes(index);
}

/**
 * Checkpoint index with AutoV2 hashes attached from the persistent cache only
 * (no file hashing). Fast enough for the browse hot path.
 */
export function getConfiguredCheckpointIndexCachedHashes(): LoraIndex | null {
  const index = getConfiguredCheckpointIndex();
  if (!index) return null;
  return attachCachedAutoV2Hashes(index);
}

let deferredInvalidate = false;

export function invalidateCheckpointIndexCache(): void {
  cached = null;
  deferredInvalidate = false;
}

/**
 * Add one on-disk checkpoint to the live index (no folder walk). Used after
 * a download so matching stays current without wiping the library cache.
 */
export function ingestCheckpointFileAt(absolutePath: string): boolean {
  const folder = loadSettings().checkpointFolder;
  if (!folder || !cached || !cacheMatches(folder)) return false;
  const resolved = path.resolve(absolutePath);
  const rel = path.relative(cached.index.root, resolved).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const ext = path.extname(resolved).toLowerCase();
  if (!(CHECKPOINT_EXTENSIONS as readonly string[]).includes(ext)) return false;

  const already = cached.index.files.find(
    (file) =>
      file.absolutePath.replace(/\\/g, '/').toLowerCase() ===
        resolved.replace(/\\/g, '/').toLowerCase() ||
      file.relativePath.toLowerCase() === rel.toLowerCase(),
  );
  const isNew = !already;
  const file =
    already ??
    (() => {
      addLoraFile(cached!.index, rel, resolved);
      return cached!.index.files[cached!.index.files.length - 1]!;
    })();
  attachCachedAutoV2HashForFile(cached.index, file);
  cached.builtAt = Date.now();
  persistModelIndex(cached.index);
  if (isNew) noteResolvedFileIngested('Checkpoint');
  return true;
}

/**
 * Invalidate now, or mark dirty if more downloads are still queued so we do not
 * sync-walk the checkpoint tree between queue jobs.
 */
export function scheduleCheckpointIndexInvalidation(defer: boolean): void {
  if (defer) {
    deferredInvalidate = true;
    return;
  }
  invalidateCheckpointIndexCache();
}

export function flushDeferredCheckpointIndexInvalidation(): void {
  if (!deferredInvalidate) return;
  invalidateCheckpointIndexCache();
}

/**
 * @deprecated Sync full-tree walks froze the UI. Prefer `ensureCheckpointIndex({ force: true })`.
 */
export function getConfiguredCheckpointIndexFresh(): LoraIndex | null {
  void ensureCheckpointIndex({ force: true });
  return getConfiguredCheckpointIndex();
}

/** True when a local file shares an AutoV2 hash with the Civitai model. */
export function isModelInstalledInIndex(
  index: LoraIndex | null,
  _fileName: string,
  hashes?: Record<string, string> | null,
  /** Extra AutoV2 values (e.g. every version on a catalog card). */
  extraAutoV2?: Iterable<string> | null,
): boolean {
  return findLocalInstallMatches(index, _fileName, hashes, extraAutoV2).length > 0;
}

export type LocalInstallMatch = {
  relativePath: string;
  absolutePath: string;
  via: 'autoV2';
};

function relativePathForAbsolute(
  index: LoraIndex,
  absolutePath: string,
): string | null {
  const needle = absolutePath.replace(/\\/g, '/').toLowerCase();
  for (const file of index.files) {
    if (file.absolutePath.replace(/\\/g, '/').toLowerCase() === needle) {
      return file.relativePath;
    }
  }
  // Fallback when the index map has a path not yet in `files` (shouldn't happen).
  try {
    const rel = path.relative(index.root, absolutePath).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Local files that make a Civitai card count as installed — AutoV2 only.
 * Filename/stem matching is intentionally not used (too many collisions like "V1").
 * Fuzzy name hits stay on `potentialLocalMatches` for manual confirm.
 */
export function findLocalInstallMatches(
  index: LoraIndex | null,
  _fileName: string,
  hashes?: Record<string, string> | null,
  extraAutoV2?: Iterable<string> | null,
): LocalInstallMatch[] {
  if (!index?.byAutoV2) return [];
  const byAbs = new Map<string, LocalInstallMatch>();

  const primary = pickCivitaiAutoV2(hashes);
  const candidates = unionAutoV2Hashes(
    primary ? [primary] : undefined,
    extraAutoV2,
  );
  for (const autoV2 of candidates) {
    const absolutePath = index.byAutoV2.get(autoV2);
    if (!absolutePath || byAbs.has(absolutePath)) continue;
    const relativePath = relativePathForAbsolute(index, absolutePath);
    if (!relativePath) continue;
    byAbs.set(absolutePath, {
      relativePath,
      absolutePath,
      via: 'autoV2',
    });
  }

  return [...byAbs.values()];
}

/** @deprecated Stem-only installed checks were removed — use AutoV2 matching. */
export function isStemInstalledInIndex(
  index: LoraIndex | null,
  fileName: string,
): boolean {
  return isModelInstalledInIndex(index, fileName);
}

export async function searchConfiguredCheckpoints(
  query: string,
  limit = 100,
): Promise<{ folder: string; fileCount: number; hits: LoraSearchHit[] }> {
  const folder = loadSettings().checkpointFolder;
  if (!folder) {
    throw new Error('No checkpoint folder configured');
  }
  const index = await ensureCheckpointIndex();
  if (!index) {
    throw new Error('No checkpoint folder configured');
  }
  return {
    folder: index.root,
    fileCount: index.fileCount,
    hits: searchLoraIndex(index, query, limit),
  };
}
