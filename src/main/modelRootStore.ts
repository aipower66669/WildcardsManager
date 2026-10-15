/**
 * Per model-root store: `<lora|checkpoint>/!.wcm/models.json`
 * Combines hash cache, ratings, and manual Civitai links for files under that root.
 */
import path from 'node:path';
import {
  isPathInsideRoot,
  modelsJsonPath,
  rootRelativePosixKey,
} from '../domain/librarySidecarPaths.js';
import { normalizeAutoV2 } from '../domain/modelHash.js';
import { atomicWriteFile, readJsonFile } from './librarySidecarIo.js';
import { getActiveLibrary } from './settingsStore.js';

export type ModelHashEntry = {
  size: number;
  mtimeMs: number;
  autoV2: string;
};

export type ManualLinkEntry = {
  modelId: number;
  origin: string;
  name: string;
  pageUrl: string;
  previewUrl?: string;
};

export type ModelsStoreFile = {
  version: 1;
  /** Root-relative posix path (lower) → hash entry. */
  hashes: Record<string, ModelHashEntry>;
  ratings: {
    byAutoV2: Record<string, number>;
    /** Root-relative posix path (lower) → rating. */
    byPath: Record<string, number>;
  };
  links: {
    byAutoV2: Record<string, ManualLinkEntry>;
    byPath: Record<string, ManualLinkEntry>;
  };
};

const STORE_VERSION = 1 as const;

function emptyStore(): ModelsStoreFile {
  return {
    version: STORE_VERSION,
    hashes: {},
    ratings: { byAutoV2: {}, byPath: {} },
    links: { byAutoV2: {}, byPath: {} },
  };
}

type MemEntry = { root: string; store: ModelsStoreFile };

const memoryByRoot = new Map<string, MemEntry>();

function rootKey(modelRoot: string): string {
  return path.resolve(modelRoot).toLowerCase();
}

export function invalidateModelsStoreMemory(modelRoot?: string): void {
  if (modelRoot) {
    memoryByRoot.delete(rootKey(modelRoot));
    return;
  }
  memoryByRoot.clear();
}

export function loadModelsStore(modelRoot: string): ModelsStoreFile {
  const key = rootKey(modelRoot);
  const cached = memoryByRoot.get(key);
  if (cached) return cached.store;
  const raw = readJsonFile<ModelsStoreFile>(modelsJsonPath(modelRoot));
  const store =
    raw?.version === STORE_VERSION
      ? {
          version: STORE_VERSION,
          hashes: raw.hashes && typeof raw.hashes === 'object' ? raw.hashes : {},
          ratings: {
            byAutoV2:
              raw.ratings?.byAutoV2 && typeof raw.ratings.byAutoV2 === 'object'
                ? raw.ratings.byAutoV2
                : {},
            byPath:
              raw.ratings?.byPath && typeof raw.ratings.byPath === 'object'
                ? raw.ratings.byPath
                : {},
          },
          links: {
            byAutoV2:
              raw.links?.byAutoV2 && typeof raw.links.byAutoV2 === 'object'
                ? raw.links.byAutoV2
                : {},
            byPath:
              raw.links?.byPath && typeof raw.links.byPath === 'object'
                ? raw.links.byPath
                : {},
          },
        }
      : emptyStore();
  memoryByRoot.set(key, { root: path.resolve(modelRoot), store });
  return store;
}

export function saveModelsStore(
  modelRoot: string,
  store: ModelsStoreFile,
): void {
  const resolved = path.resolve(modelRoot);
  memoryByRoot.set(rootKey(modelRoot), { root: resolved, store });
  // Sync write is unavoidable for atomic rename; keep payloads small via
  // per-root upserts instead of full-library merges during hash warm.
  atomicWriteFile(modelsJsonPath(resolved), `${JSON.stringify(store)}\n`);
}

/** Resolve which configured model root owns this absolute path (active library). */
export function resolveModelRootForPath(absolutePath: string): string | null {
  const lib = getActiveLibrary();
  if (isPathInsideRoot(absolutePath, lib.loraFolder)) return lib.loraFolder;
  if (isPathInsideRoot(absolutePath, lib.checkpointFolder)) {
    return lib.checkpointFolder;
  }
  return null;
}

export function modelsPathKey(absolutePath: string, modelRoot: string): string {
  return rootRelativePosixKey(absolutePath, modelRoot);
}

export function absolutePathKey(absolutePath: string): string {
  return path.resolve(absolutePath).toLowerCase();
}

/** Active library model roots that exist as configured paths. */
export function activeModelRoots(): string[] {
  const lib = getActiveLibrary();
  const roots: string[] = [];
  if (lib.loraFolder?.trim()) roots.push(path.resolve(lib.loraFolder));
  if (lib.checkpointFolder?.trim()) {
    roots.push(path.resolve(lib.checkpointFolder));
  }
  return roots;
}

export function loadModelsStoreForPath(absolutePath: string): {
  root: string;
  store: ModelsStoreFile;
  pathKey: string;
} | null {
  const root = resolveModelRootForPath(absolutePath);
  if (!root) return null;
  return {
    root,
    store: loadModelsStore(root),
    pathKey: modelsPathKey(absolutePath, root),
  };
}

/**
 * Merged hash view keyed by absolute path (lower) for warm/attach APIs.
 * Writes partition back via `saveMergedHashEntries`.
 */
export function loadMergedHashEntries(): Record<string, ModelHashEntry> {
  const out: Record<string, ModelHashEntry> = {};
  for (const root of activeModelRoots()) {
    const store = loadModelsStore(root);
    for (const [rel, entry] of Object.entries(store.hashes)) {
      const abs = path.resolve(root, rel).toLowerCase();
      out[abs] = entry;
    }
  }
  return out;
}

export function saveMergedHashEntries(
  entries: Record<string, ModelHashEntry>,
): void {
  const byRoot = new Map<string, ModelsStoreFile>();
  for (const root of activeModelRoots()) {
    byRoot.set(rootKey(root), {
      ...loadModelsStore(root),
      hashes: {},
    });
  }

  for (const [absKey, entry] of Object.entries(entries)) {
    const root = resolveModelRootForPath(absKey);
    if (!root) continue;
    const key = rootKey(root);
    let store = byRoot.get(key);
    if (!store) {
      store = { ...loadModelsStore(root), hashes: {} };
      byRoot.set(key, store);
    }
    store.hashes[modelsPathKey(absKey, root)] = entry;
  }

  for (const [key, store] of byRoot) {
    const mem = memoryByRoot.get(key);
    const root = mem?.root ?? activeModelRoots().find((r) => rootKey(r) === key);
    if (!root) continue;
    // Preserve ratings/links from current mem store.
    const current = loadModelsStore(root);
    saveModelsStore(root, {
      ...current,
      hashes: store.hashes,
    });
  }
}

/** Roots with in-memory hash edits waiting for a debounced disk write. */
const dirtyHashRoots = new Set<string>();
let dirtyHashSaveTimer: ReturnType<typeof setTimeout> | null = null;
const HASH_UPSERT_SAVE_DEBOUNCE_MS = 2500;

function scheduleDirtyHashRootSave(): void {
  if (dirtyHashSaveTimer) return;
  dirtyHashSaveTimer = setTimeout(() => {
    dirtyHashSaveTimer = null;
    flushDirtyModelHashSaves();
  }, HASH_UPSERT_SAVE_DEBOUNCE_MS);
}

/**
 * Update one hash entry in memory and debounce a per-root write.
 * Avoids rewriting every models.json from a full merged map on each warm tick
 * (JSON.stringify of large stores freezes Electron main / UI).
 */
export function upsertModelHashEntry(
  absolutePath: string,
  entry: ModelHashEntry,
): void {
  const root = resolveModelRootForPath(absolutePath);
  if (!root) return;
  const store = loadModelsStore(root);
  store.hashes[modelsPathKey(absolutePath, root)] = entry;
  dirtyHashRoots.add(rootKey(root));
  scheduleDirtyHashRootSave();
}

export function removeModelHashEntry(absolutePath: string): boolean {
  const root = resolveModelRootForPath(absolutePath);
  if (!root) return false;
  const store = loadModelsStore(root);
  const key = modelsPathKey(absolutePath, root);
  if (!(key in store.hashes)) return false;
  delete store.hashes[key];
  dirtyHashRoots.add(rootKey(root));
  scheduleDirtyHashRootSave();
  return true;
}

export function moveModelHashEntry(
  oldAbsolutePath: string,
  newAbsolutePath: string,
): boolean {
  const fromRoot = resolveModelRootForPath(oldAbsolutePath);
  const toRoot = resolveModelRootForPath(newAbsolutePath);
  if (!fromRoot || !toRoot) return false;
  const fromStore = loadModelsStore(fromRoot);
  const fromKey = modelsPathKey(oldAbsolutePath, fromRoot);
  const entry = fromStore.hashes[fromKey];
  if (!entry) return false;
  delete fromStore.hashes[fromKey];
  dirtyHashRoots.add(rootKey(fromRoot));
  const toStore = loadModelsStore(toRoot);
  toStore.hashes[modelsPathKey(newAbsolutePath, toRoot)] = { ...entry };
  dirtyHashRoots.add(rootKey(toRoot));
  scheduleDirtyHashRootSave();
  return true;
}

/** Flush debounced per-root hash writes (warm done / app quit). */
export function flushDirtyModelHashSaves(): void {
  if (dirtyHashSaveTimer) {
    clearTimeout(dirtyHashSaveTimer);
    dirtyHashSaveTimer = null;
  }
  const keys = [...dirtyHashRoots];
  dirtyHashRoots.clear();
  for (const key of keys) {
    const mem = memoryByRoot.get(key);
    if (!mem) continue;
    // Yield between roots so a multi‑MB stringify cannot monopolize the loop.
    saveModelsStore(mem.root, mem.store);
  }
}

export { normalizeAutoV2 };
