import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  CATALOG_CACHE_LEGACY_VERSIONS,
  CATALOG_CACHE_VERSION,
  CATALOG_PAGE_SIZE,
  catalogOriginHost,
  catalogSliceDirName,
  chunkModelIds,
  idChunkFileName,
  modelPageIndex,
  prependIdsIntoChunks,
} from '../domain/civitaiCatalogLayout.js';
import { civitaiCatalogDir } from '../domain/librarySidecarPaths.js';
import {
  appendCatalogSearchHays,
  appendCatalogSearchMem,
  clearAllCatalogSearchMem,
  invalidateCatalogSearchIndex,
} from './civitaiCatalogSearchIndex.js';
import { maybeUnarchiveForNewVersion } from './civitaiArchivePolicy.js';
import {
  isEarlyAccessActive,
  mergeEarlyAccessFlag,
} from '../domain/civitaiEarlyAccess.js';
import type {
  CivitaiArchitectureIdDto,
  CivitaiModelCategoryIdDto,
  CivitaiModelTypeDto,
  CivitaiOriginDto,
} from '../shared/contracts.js';
import { getActiveLibrary } from './settingsStore.js';

export type CachedCivitaiModel = {
  id: number;
  origin: string;
  name: string;
  type: string;
  nsfw: boolean;
  creator?: string;
  tags: string[];
  baseModel?: string;
  versionId?: number;
  versionName?: string;
  fileName?: string;
  /** Civitai AutoV2 of the primary (latest) file — used for browser cards. */
  autoV2?: string;
  /**
   * AutoV2 hashes for every known version/file of this model (includes
   * `autoV2` when set). Used so older local downloads still match the card.
   */
  autoV2Hashes?: string[];
  /**
   * Per-version AutoV2 snapshots (newest first when from the API). Enables
   * version-aware install / Browse hideInstalled.
   */
  versions?: Array<{
    id: number;
    name: string;
    baseModel?: string;
    fileName?: string;
    autoV2?: string;
    autoV2Hashes: string[];
    earlyAccess?: boolean;
    earlyAccessEndsAt?: string;
    downloadPrice?: number;
    files?: Array<{
      id?: number;
      name: string;
      autoV2?: string;
      primary: boolean;
      variantLabel?: string;
    }>;
  }>;
  /**
   * Set after a detail fetch expanded all version hashes (or confirmed there
   * is only one). Skips further version-hash enrichment for this card.
   */
  autoV2HashesExpandedAt?: string;
  /**
   * Set when a detail API fetch found no AutoV2 (deleted file, odd payload, …).
   * Skips further backfill retries for this model.
   */
  autoV2CheckedAt?: string;
  fileSizeKB?: number;
  trainedWords: string[];
  previewUrl?: string;
  /**
   * True when this model has no usable preview (empty URL, or CDN fetch
   * permanently failed). Counts as “done” for catalog preview coverage.
   */
  previewMissing?: boolean;
  pageUrl: string;
  earlyAccess: boolean;
  earlyAccessEndsAt?: string;
  /**
   * Latest version publish time from Civitai (`modelVersions[0].publishedAt`).
   * Used on cards for Newest-progress orientation.
   */
  publishedAt?: string;
  firstSeenAt: string;
  updatedAt: string;
};

export type CatalogSliceState = {
  modelIds: number[];
  exhausted: boolean;
  /** Resume cursor while still filling this slice. */
  nextCursor?: string | null;
  lastSyncedAt?: string;
};

export type CatalogSliceKeyParts = {
  origin: string;
  type: CivitaiModelTypeDto;
  category: CivitaiModelCategoryIdDto | null;
  architectures: CivitaiArchitectureIdDto[];
  query: string;
};

type SliceDiskMeta = {
  sliceKey: string;
  exhausted: boolean;
  nextCursor: string | null;
  lastSyncedAt?: string;
  idCount: number;
  idChunkCount: number;
};

type CatalogRootMeta = {
  version: typeof CATALOG_CACHE_VERSION;
  /** sliceKey → dir name under slices/ */
  slices: Record<string, string>;
};

type ModelPage = Record<string, CachedCivitaiModel>;

type LruEntry = {
  pageKey: string;
  models: ModelPage;
  dirty: boolean;
};

const MODEL_PAGE_LRU_MAX = 32;
const FLUSH_DEBOUNCE_MS = 500;
/** Dirty pages evicted from the LRU. Written on the flush timer, not inside getCachedModel. */
const pendingEvictedPages: LruEntry[] = [];

/** Test / alternate root (skips Electron userData). */
let rootOverride: string | null = null;
let rootMeta: CatalogRootMeta | null = null;
const modelPageLru: LruEntry[] = [];
const sliceIdCache = new Map<
  string,
  { ids: number[]; known: Set<number>; meta: SliceDiskMeta }
>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let catalogReady = false;

export function configureCatalogCacheRoot(dir: string | null): void {
  flushDirtyModelPagesSync();
  rootOverride = dir;
  rootMeta = null;
  modelPageLru.length = 0;
  sliceIdCache.clear();
  catalogReady = false;
  autoV2CatalogIndex = null;
  autoV2IndexDirty = false;
  if (autoV2IndexSaveTimer) {
    clearTimeout(autoV2IndexSaveTimer);
    autoV2IndexSaveTimer = null;
  }
  clearAllCatalogSearchMem();
}

function catalogRoot(): string {
  if (rootOverride) return rootOverride;
  const wildcards = getActiveLibrary().wildcardsRoot;
  if (wildcards?.trim()) return civitaiCatalogDir(wildcards);
  // No library wildcards root yet — avoid writing into a shared AppData catalog.
  return path.join(app.getPath('userData'), 'civitai-catalog-unbound');
}

/** Catalog sidecar root (paged models, AutoV2 index, shelf summaries). */
export function getCatalogCacheRootDir(): string {
  ensureCatalogReady();
  return catalogRoot();
}

function atomicWrite(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, data, 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.renameSync(temp, file);
  }
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Load or create the v1 catalog root (paged models + slice id indexes). */
function ensureCatalogReady(): void {
  if (catalogReady) return;
  catalogReady = true;
  fs.mkdirSync(catalogRoot(), { recursive: true });
  if (rootMeta) return;
  const metaPath = path.join(catalogRoot(), 'meta.json');
  const raw = readJsonFile<CatalogRootMeta & { version?: number }>(metaPath);
  const versionOk =
    raw?.version === CATALOG_CACHE_VERSION ||
    (typeof raw?.version === 'number' &&
      (CATALOG_CACHE_LEGACY_VERSIONS as readonly number[]).includes(
        raw.version,
      ));
  if (versionOk && raw?.slices) {
    rootMeta = {
      version: CATALOG_CACHE_VERSION,
      slices: raw.slices,
    };
    // Normalize stamped "2" from earlier builds to v1.
    if (raw.version !== CATALOG_CACHE_VERSION) {
      persistRootMeta();
    }
  } else {
    rootMeta = {
      version: CATALOG_CACHE_VERSION,
      slices: {},
    };
    persistRootMeta();
  }
}

function ensureRootMeta(): CatalogRootMeta {
  ensureCatalogReady();
  return rootMeta!;
}

function persistRootMeta(): void {
  if (!rootMeta) return;
  atomicWrite(
    path.join(catalogRoot(), 'meta.json'),
    `${JSON.stringify(rootMeta)}\n`,
  );
}

function sliceDir(sliceKey: string): string {
  const meta = ensureRootMeta();
  let dir = meta.slices[sliceKey];
  if (!dir) {
    dir = catalogSliceDirName(sliceKey);
    meta.slices[sliceKey] = dir;
    persistRootMeta();
  }
  return path.join(catalogRoot(), 'slices', dir);
}

function sliceMetaPath(sliceKey: string): string {
  return path.join(sliceDir(sliceKey), 'meta.json');
}

function emptySliceMeta(sliceKey: string): SliceDiskMeta {
  return {
    sliceKey,
    exhausted: false,
    nextCursor: null,
    idCount: 0,
    idChunkCount: 0,
  };
}

function readSliceMeta(sliceKey: string): SliceDiskMeta {
  const raw = readJsonFile<SliceDiskMeta>(sliceMetaPath(sliceKey));
  if (!raw || raw.sliceKey !== sliceKey) return emptySliceMeta(sliceKey);
  return {
    sliceKey,
    exhausted: Boolean(raw.exhausted),
    nextCursor: typeof raw.nextCursor === 'string' ? raw.nextCursor : null,
    lastSyncedAt:
      typeof raw.lastSyncedAt === 'string' ? raw.lastSyncedAt : undefined,
    idCount: Math.max(0, Number(raw.idCount) || 0),
    idChunkCount: Math.max(0, Number(raw.idChunkCount) || 0),
  };
}

function writeSliceMeta(meta: SliceDiskMeta): void {
  atomicWrite(sliceMetaPath(meta.sliceKey), `${JSON.stringify(meta)}\n`);
}

function readIdChunk(sliceKey: string, chunkIndex: number): number[] {
  const file = path.join(sliceDir(sliceKey), idChunkFileName(chunkIndex));
  const raw = readJsonFile<number[]>(file);
  if (!Array.isArray(raw)) return [];
  return raw.filter((id) => typeof id === 'number' && Number.isFinite(id));
}

function writeIdChunk(
  sliceKey: string,
  chunkIndex: number,
  ids: number[],
): void {
  const file = path.join(sliceDir(sliceKey), idChunkFileName(chunkIndex));
  if (ids.length === 0) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // ignore
    }
    return;
  }
  atomicWrite(file, `${JSON.stringify(ids)}\n`);
}

function loadAllSliceIds(sliceKey: string): number[] {
  const cached = sliceIdCache.get(sliceKey);
  if (cached) return cached.ids;

  const meta = readSliceMeta(sliceKey);
  const ids: number[] = [];
  for (let i = 0; i < meta.idChunkCount; i += 1) {
    ids.push(...readIdChunk(sliceKey, i));
  }
  // Repair count drift.
  if (ids.length !== meta.idCount) {
    meta.idCount = ids.length;
    meta.idChunkCount = Math.ceil(ids.length / CATALOG_PAGE_SIZE) || 0;
    writeSliceMeta(meta);
  }
  sliceIdCache.set(sliceKey, {
    ids,
    known: new Set(ids),
    meta,
  });
  return ids;
}

function getSliceIdCache(sliceKey: string) {
  loadAllSliceIds(sliceKey);
  return sliceIdCache.get(sliceKey)!;
}

/** Known-id set for sync — loads id index only, never card JSON pages. */
export function getSliceIdKnownSet(sliceKey: string): Set<number> {
  ensureCatalogReady();
  return getSliceIdCache(sliceKey).known;
}

function persistSliceIds(sliceKey: string): void {
  const entry = sliceIdCache.get(sliceKey);
  if (!entry) return;
  const chunks = chunkModelIds(entry.ids);
  const dir = sliceDir(sliceKey);
  fs.mkdirSync(dir, { recursive: true });
  const prevCount = entry.meta.idChunkCount;
  for (let i = 0; i < chunks.length; i += 1) {
    writeIdChunk(sliceKey, i, chunks[i]!);
  }
  for (let i = chunks.length; i < prevCount; i += 1) {
    writeIdChunk(sliceKey, i, []);
  }
  entry.meta.idCount = entry.ids.length;
  entry.meta.idChunkCount = chunks.length;
  writeSliceMeta(entry.meta);
}

/** Append-only: rewrite only the affected trailing id chunk files. */
function persistSliceIdsAppend(
  sliceKey: string,
  appended: number[],
): void {
  const entry = sliceIdCache.get(sliceKey);
  if (!entry || appended.length === 0) return;
  fs.mkdirSync(sliceDir(sliceKey), { recursive: true });

  const without = entry.ids.length - appended.length;
  const startChunk = Math.floor(Math.max(0, without) / CATALOG_PAGE_SIZE);
  const tail = entry.ids.slice(startChunk * CATALOG_PAGE_SIZE);
  const chunks = chunkModelIds(tail);
  for (let i = 0; i < chunks.length; i += 1) {
    writeIdChunk(sliceKey, startChunk + i, chunks[i]!);
  }
  entry.meta.idCount = entry.ids.length;
  entry.meta.idChunkCount = startChunk + chunks.length;
  writeSliceMeta(entry.meta);
}

function modelPageKey(origin: string, modelId: number): string {
  return `${catalogOriginHost(origin)}/${modelPageIndex(modelId)}`;
}

function modelPagePath(origin: string, modelId: number): string {
  return path.join(
    catalogRoot(),
    'models',
    catalogOriginHost(origin),
    `${modelPageIndex(modelId)}.json`,
  );
}

function lruGet(pageKey: string): LruEntry | null {
  const idx = modelPageLru.findIndex((e) => e.pageKey === pageKey);
  if (idx < 0) return null;
  const [entry] = modelPageLru.splice(idx, 1);
  if (!entry) return null;
  modelPageLru.push(entry);
  return entry;
}

function lruPut(entry: LruEntry): void {
  const existing = modelPageLru.findIndex((e) => e.pageKey === entry.pageKey);
  if (existing >= 0) modelPageLru.splice(existing, 1);
  modelPageLru.push(entry);
  while (modelPageLru.length > MODEL_PAGE_LRU_MAX) {
    const evicted = modelPageLru.shift();
    if (!evicted?.dirty) continue;
    pendingEvictedPages.push(evicted);
    scheduleFlush();
  }
}

function writeModelPage(entry: LruEntry): void {
  const [host, page] = entry.pageKey.split('/');
  if (!host || page === undefined) return;
  const file = path.join(catalogRoot(), 'models', host, `${page}.json`);
  atomicWrite(file, `${JSON.stringify(entry.models)}\n`);
  entry.dirty = false;
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDirtyModelPagesYielding();
  }, FLUSH_DEBOUNCE_MS);
}

/** One page per turn so a catalog write does not stall Browse. */
async function flushDirtyModelPagesYielding(): Promise<void> {
  const dirty: LruEntry[] = [];
  for (const entry of modelPageLru) {
    if (entry.dirty) dirty.push(entry);
  }
  while (pendingEvictedPages.length > 0) {
    const entry = pendingEvictedPages.shift();
    if (entry?.dirty) dirty.push(entry);
  }
  for (const entry of dirty) {
    if (!entry.dirty) continue;
    writeModelPage(entry);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export function flushDirtyModelPagesSync(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  for (const entry of modelPageLru) {
    if (entry.dirty) writeModelPage(entry);
  }
  while (pendingEvictedPages.length > 0) {
    const entry = pendingEvictedPages.shift();
    if (entry?.dirty) writeModelPage(entry);
  }
}

function takePendingEvictedPage(pageKey: string): LruEntry | null {
  const idx = pendingEvictedPages.findIndex((e) => e.pageKey === pageKey);
  if (idx < 0) return null;
  const [entry] = pendingEvictedPages.splice(idx, 1);
  return entry ?? null;
}

function loadModelPage(origin: string, modelId: number): LruEntry {
  const pageKey = modelPageKey(origin, modelId);
  const hit = lruGet(pageKey);
  if (hit) return hit;
  const pending = takePendingEvictedPage(pageKey);
  if (pending) {
    lruPut(pending);
    return pending;
  }
  const file = modelPagePath(origin, modelId);
  const raw = readJsonFile<ModelPage>(file);
  const entry: LruEntry = {
    pageKey,
    models: raw && typeof raw === 'object' ? raw : {},
    dirty: false,
  };
  lruPut(entry);
  return entry;
}

export function modelCacheKey(origin: string, modelId: number): string {
  return `${origin}:${modelId}`;
}

export function getCatalogSliceDir(sliceKey: string): string {
  ensureCatalogReady();
  return sliceDir(sliceKey);
}

/** Full ordered id list (id index only — not card payloads). */
export function getCatalogSliceIds(sliceKey: string): number[] {
  ensureCatalogReady();
  return loadAllSliceIds(sliceKey);
}

export function buildCatalogSliceKey(parts: CatalogSliceKeyParts): string {
  const arch = [...parts.architectures].sort().join(',');
  const category = parts.category ?? '';
  // Query is NOT part of the slice key — local search filters the full
  // type/category/arch catalog instead of syncing a separate API slice per query.
  return `${parts.origin}|${parts.type}|${category}|${arch}|`;
}

export function getCatalogSliceState(sliceKey: string): CatalogSliceState {
  ensureCatalogReady();
  const entry = getSliceIdCache(sliceKey);
  return {
    modelIds: [...entry.ids],
    exhausted: entry.meta.exhausted,
    nextCursor: entry.meta.nextCursor,
    lastSyncedAt: entry.meta.lastSyncedAt,
  };
}

/** Lightweight stats without copying the full id list. */
export function getCatalogSliceStats(sliceKey: string): {
  idCount: number;
  exhausted: boolean;
  nextCursor: string | null;
  lastSyncedAt?: string;
} {
  ensureCatalogReady();
  const cached = sliceIdCache.get(sliceKey);
  if (cached) {
    return {
      idCount: cached.meta.idCount,
      exhausted: cached.meta.exhausted,
      nextCursor: cached.meta.nextCursor,
      lastSyncedAt: cached.meta.lastSyncedAt,
    };
  }
  const meta = readSliceMeta(sliceKey);
  return {
    idCount: meta.idCount,
    exhausted: meta.exhausted,
    nextCursor: meta.nextCursor,
    lastSyncedAt: meta.lastSyncedAt,
  };
}

export function getCachedModel(
  origin: string,
  modelId: number,
): CachedCivitaiModel | null {
  ensureCatalogReady();
  const page = loadModelPage(origin, modelId);
  return page.models[modelCacheKey(origin, modelId)] ?? null;
}

/** First catalog model matching AutoV2 (case-insensitive). */
export function findCachedModelByAutoV2(
  autoV2: string,
): CachedCivitaiModel | null {
  const needle = autoV2.trim().toUpperCase();
  if (!needle) return null;
  const ref = getAutoV2CatalogIndex().get(needle);
  if (!ref) return null;
  return getCachedModel(ref.origin, ref.id);
}

/**
 * AutoV2 → { origin, modelId } for the current catalog.
 * Built once per process (or after invalidate); list/detail must not rescan
 * every page for every file.
 *
 * IMPORTANT: v1 persisted full catalog rows (~400MB+) and rewrote them on a
 * 1.5s debounce — that froze the UI. v2 stores only id refs (~few MB).
 */
export type AutoV2IndexRef = { origin: string; id: number };

let autoV2CatalogIndex: Map<string, AutoV2IndexRef> | null = null;
let autoV2IndexDirty = false;

export function invalidateAutoV2CatalogIndex(): void {
  autoV2CatalogIndex = null;
  autoV2IndexDirty = false;
  if (autoV2IndexSaveTimer) {
    clearTimeout(autoV2IndexSaveTimer);
    autoV2IndexSaveTimer = null;
  }
  try {
    fs.unlinkSync(autoV2IndexPath());
  } catch {
    // ignore missing
  }
}

type AutoV2IndexDiskV2 = {
  version: 2;
  builtAt: string;
  /** autoV2 → compact origin + model id (resolve via getCachedModel). */
  entries: Record<string, { o: string; i: number }>;
};

function autoV2IndexPath(): string {
  return path.join(catalogRoot(), 'autoV2-index.json');
}

function discardLegacyAutoV2IndexFile(): void {
  const file = autoV2IndexPath();
  try {
    if (!fs.existsSync(file)) return;
    // Peek without parsing hundreds of MB of v1 fat rows.
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(64);
      const n = fs.readSync(fd, buf, 0, 64, 0);
      const head = buf.toString('utf8', 0, n);
      if (/\"version\"\s*:\s*1\b/.test(head) || !/\"version\"\s*:\s*2\b/.test(head)) {
        fs.closeSync(fd);
        fs.unlinkSync(file);
        console.warn(
          '[civitaiCatalogCache] discarded legacy autoV2-index.json (v1 fat format)',
        );
        return;
      }
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

function tryLoadAutoV2IndexFromDisk(): Map<string, AutoV2IndexRef> | null {
  discardLegacyAutoV2IndexFile();
  try {
    const raw = JSON.parse(
      fs.readFileSync(autoV2IndexPath(), 'utf8'),
    ) as AutoV2IndexDiskV2;
    if (raw?.version !== 2 || !raw.entries || typeof raw.entries !== 'object') {
      return null;
    }
    const map = new Map<string, AutoV2IndexRef>();
    for (const [key, ref] of Object.entries(raw.entries)) {
      const k = key.trim().toUpperCase();
      const id = Number(ref?.i);
      const origin = typeof ref?.o === 'string' ? ref.o.trim() : '';
      if (!k || !origin || !Number.isFinite(id) || id <= 0) continue;
      map.set(k, { origin, id });
    }
    return map;
  } catch {
    return null;
  }
}

let autoV2IndexSaveTimer: ReturnType<typeof setTimeout> | null = null;
/** Coalesce bulk remembers — writing this index every 1.5s caused UI freezes. */
const AUTO_V2_INDEX_SAVE_DEBOUNCE_MS = 60_000;

function saveAutoV2IndexToDisk(map: Map<string, AutoV2IndexRef>): void {
  ensureCatalogReady();
  const entries: Record<string, { o: string; i: number }> = {};
  for (const [key, ref] of map) {
    entries[key] = { o: ref.origin, i: ref.id };
  }
  const payload: AutoV2IndexDiskV2 = {
    version: 2,
    builtAt: new Date().toISOString(),
    entries,
  };
  const file = autoV2IndexPath();
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(payload)}\n`, 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.renameSync(temp, file);
  }
  autoV2IndexDirty = false;
}

function scheduleSaveAutoV2Index(): void {
  if (!autoV2CatalogIndex) return;
  autoV2IndexDirty = true;
  if (autoV2IndexSaveTimer) return;
  autoV2IndexSaveTimer = setTimeout(() => {
    autoV2IndexSaveTimer = null;
    if (!autoV2CatalogIndex || !autoV2IndexDirty) return;
    const snapshot = autoV2CatalogIndex;
    // Don't block the IPC/event loop mid-interaction with a multi‑MB stringify.
    setImmediate(() => {
      try {
        if (snapshot === autoV2CatalogIndex) saveAutoV2IndexToDisk(snapshot);
      } catch (err) {
        console.warn('[civitaiCatalogCache] autoV2-index save failed', err);
      }
    });
  }, AUTO_V2_INDEX_SAVE_DEBOUNCE_MS);
}

/** Flush pending AutoV2 index write (call before quit / library switch). */
export function flushAutoV2IndexSync(): void {
  if (autoV2IndexSaveTimer) {
    clearTimeout(autoV2IndexSaveTimer);
    autoV2IndexSaveTimer = null;
  }
  if (!autoV2CatalogIndex || !autoV2IndexDirty) return;
  try {
    saveAutoV2IndexToDisk(autoV2CatalogIndex);
  } catch (err) {
    console.warn('[civitaiCatalogCache] autoV2-index flush failed', err);
  }
}

/**
 * Keep the in-memory AutoV2 map current after a disk write — do **not** wipe and
 * rescan the whole catalog (that made populate O(files × catalog pages)).
 */
export function rememberAutoV2InCatalogIndex(
  autoV2: string | undefined,
  model: CachedCivitaiModel,
): void {
  const key = autoV2?.trim().toUpperCase();
  if (!key || !autoV2CatalogIndex || !model?.id || !model.origin) return;
  autoV2CatalogIndex.set(key, { origin: model.origin, id: model.id });
  scheduleSaveAutoV2Index();
}

/** Index primary + every `autoV2Hashes` entry for a catalog card. */
export function rememberAllAutoV2InCatalogIndex(
  model: CachedCivitaiModel,
): void {
  // Ensure the Map is loaded so remembers are not no-ops.
  getAutoV2CatalogIndex();
  const hashes = unionAutoV2List(
    model.autoV2 ? [model.autoV2] : undefined,
    model.autoV2Hashes,
  );
  for (const h of hashes) {
    rememberAutoV2InCatalogIndex(h, model);
  }
}

function unionAutoV2List(
  ...lists: Array<Iterable<string> | null | undefined>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    if (!list) continue;
    for (const raw of list) {
      const h = raw?.trim().toUpperCase();
      if (!h || seen.has(h)) continue;
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}

function indexModelAutoV2Keys(
  map: Map<string, AutoV2IndexRef>,
  model: CachedCivitaiModel,
): void {
  if (!model?.id || !model.origin) return;
  const ref: AutoV2IndexRef = { origin: model.origin, id: model.id };
  for (const key of unionAutoV2List(
    model.autoV2 ? [model.autoV2] : undefined,
    model.autoV2Hashes,
  )) {
    if (!map.has(key)) map.set(key, ref);
  }
}

export function getAutoV2CatalogIndex(): Map<string, AutoV2IndexRef> {
  if (autoV2CatalogIndex) return autoV2CatalogIndex;
  ensureCatalogReady();

  const fromDisk = tryLoadAutoV2IndexFromDisk();
  if (fromDisk && fromDisk.size > 0) {
    autoV2CatalogIndex = fromDisk;
    return fromDisk;
  }

  // Empty now — rebuild off the event loop so UI stays responsive after a
  // legacy v1 (fat) index was discarded.
  const map = new Map<string, AutoV2IndexRef>();
  autoV2CatalogIndex = map;
  void rebuildAutoV2IndexInBackground(map);
  return map;
}

let autoV2RebuildGeneration = 0;

async function rebuildAutoV2IndexInBackground(
  map: Map<string, AutoV2IndexRef>,
): Promise<void> {
  const gen = ++autoV2RebuildGeneration;
  const hostDir = path.join(catalogRoot(), 'models');
  let hosts: string[] = [];
  try {
    hosts = fs.readdirSync(hostDir);
  } catch {
    return;
  }
  let pages = 0;
  for (const host of hosts) {
    if (gen !== autoV2RebuildGeneration || autoV2CatalogIndex !== map) return;
    const dir = path.join(hostDir, host);
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
    } catch {
      continue;
    }
    for (const name of names) {
      if (gen !== autoV2RebuildGeneration || autoV2CatalogIndex !== map) return;
      const raw = readJsonFile<ModelPage>(path.join(dir, name));
      if (!raw) continue;
      for (const model of Object.values(raw)) {
        if (!model?.id) continue;
        indexModelAutoV2Keys(map, model);
      }
      pages += 1;
      if (pages % 25 === 0) {
        await new Promise<void>((r) => setImmediate(r));
      }
    }
  }
  if (gen !== autoV2RebuildGeneration || autoV2CatalogIndex !== map) return;
  autoV2IndexDirty = true;
  try {
    saveAutoV2IndexToDisk(map);
    console.info(
      `[civitaiCatalogCache] rebuilt autoV2-index v2 (${map.size} hashes)`,
    );
  } catch (err) {
    console.warn('[civitaiCatalogCache] autoV2-index rebuild save failed', err);
  }
}

export function listCachedModelsForSlice(
  origin: string,
  sliceKey: string,
): CachedCivitaiModel[] {
  ensureCatalogReady();
  const ids = loadAllSliceIds(sliceKey);
  const out: CachedCivitaiModel[] = [];
  for (const id of ids) {
    const model = getCachedModel(origin, id);
    if (model) out.push(model);
  }
  return out;
}

/**
 * Read a window of slice ids without requiring the full id list in memory
 * (reads only the needed id-chunk files unless the slice is already cached).
 */
export function listSliceIdsWindow(
  sliceKey: string,
  offset: number,
  limit: number,
): { ids: number[]; total: number } {
  ensureCatalogReady();
  const start = Math.max(0, Math.floor(offset));
  const take = Math.max(0, Math.floor(limit));
  if (take === 0) {
    return { ids: [], total: getCatalogSliceStats(sliceKey).idCount };
  }

  const cached = sliceIdCache.get(sliceKey);
  if (cached) {
    return {
      ids: cached.ids.slice(start, start + take),
      total: cached.ids.length,
    };
  }

  const meta = readSliceMeta(sliceKey);
  if (meta.idCount === 0 || meta.idChunkCount === 0) {
    return { ids: [], total: 0 };
  }
  if (start >= meta.idCount) {
    return { ids: [], total: meta.idCount };
  }

  const firstChunk = Math.floor(start / CATALOG_PAGE_SIZE);
  const lastIndex = Math.min(meta.idCount, start + take) - 1;
  const lastChunk = Math.floor(lastIndex / CATALOG_PAGE_SIZE);
  const out: number[] = [];
  for (let c = firstChunk; c <= lastChunk; c += 1) {
    const chunk = readIdChunk(sliceKey, c);
    const chunkStart = c * CATALOG_PAGE_SIZE;
    for (let i = 0; i < chunk.length; i += 1) {
      const global = chunkStart + i;
      if (global < start) continue;
      if (global >= start + take) break;
      out.push(chunk[i]!);
    }
  }
  return { ids: out, total: meta.idCount };
}

/**
 * Resolve a window of models for a slice (offset/limit over the id index).
 * Does not materialize the full card list.
 */
export function listCachedModelsForSliceWindow(
  origin: string,
  sliceKey: string,
  offset: number,
  limit: number,
): CachedCivitaiModel[] {
  const { ids } = listSliceIdsWindow(sliceKey, offset, limit);
  const out: CachedCivitaiModel[] = [];
  for (const id of ids) {
    const model = getCachedModel(origin, id);
    if (model) out.push(model);
  }
  return out;
}

/**
 * True if any sampled catalog card in the slice is missing AutoV2.
 * Avoids loading every card for large slices.
 */
export function sliceLikelyNeedsAutoV2Backfill(
  origin: string,
  sliceKey: string,
  sampleBudget = 500,
): boolean {
  ensureCatalogReady();
  const ids = loadAllSliceIds(sliceKey);
  if (ids.length === 0) return false;
  const budget = Math.max(1, sampleBudget);
  const step = Math.max(1, Math.floor(ids.length / budget));
  for (let i = 0; i < ids.length; i += step) {
    const model = getCachedModel(origin, ids[i]!);
    if (model && !model.autoV2) return true;
  }
  return false;
}

/**
 * Insert models that are not yet cached. Existing entries keep firstSeenAt,
 * but refresh latest-version fields, union AutoV2 hashes, and merge version
 * snapshots so newer Civitai versions become visible.
 */
export function insertCachedModelsIfAbsent(
  models: CachedCivitaiModel[],
): number {
  if (models.length === 0) return 0;
  ensureCatalogReady();
  let added = 0;
  let patched = 0;
  const now = new Date().toISOString();
  const dirtyPages = new Set<string>();
  const toRemember: CachedCivitaiModel[] = [];

  for (const model of models) {
    const key = modelCacheKey(model.origin, model.id);
    const page = loadModelPage(model.origin, model.id);
    const existing = page.models[key];
    if (existing) {
      let next = existing;
      if (!existing.earlyAccessEndsAt && model.earlyAccessEndsAt) {
        next = {
          ...next,
          earlyAccess: model.earlyAccess || existing.earlyAccess,
          earlyAccessEndsAt: model.earlyAccessEndsAt,
        };
      }
      // Prefer newer “latest” version metadata from the API feed.
      if (
        model.versionId != null &&
        model.versionId !== existing.versionId
      ) {
        const previousVersionId = existing.versionId;
        next = {
          ...next,
          versionId: model.versionId,
          versionName: model.versionName ?? next.versionName,
          fileName: model.fileName ?? next.fileName,
          fileSizeKB: model.fileSizeKB ?? next.fileSizeKB,
          baseModel: model.baseModel ?? next.baseModel,
          trainedWords: model.trainedWords?.length
            ? model.trainedWords
            : next.trainedWords,
          autoV2: model.autoV2 ?? next.autoV2,
          earlyAccess: model.earlyAccess,
          earlyAccessEndsAt:
            model.earlyAccessEndsAt ?? next.earlyAccessEndsAt,
        };
        // Archive/Maybe + already downloaded → resurface when a newer version lands.
        maybeUnarchiveForNewVersion({
          modelId: existing.id,
          type: existing.type,
          previousVersionId,
          nextVersionId: model.versionId,
          autoV2: next.autoV2 ?? model.autoV2 ?? existing.autoV2,
          autoV2Hashes: unionAutoV2List(
            existing.autoV2 ? [existing.autoV2] : undefined,
            existing.autoV2Hashes,
            model.autoV2 ? [model.autoV2] : undefined,
            model.autoV2Hashes,
          ),
          versions: mergeCachedVersions(
            existing.versions,
            model.versions ?? [],
          ),
        });
      } else {
        if (!existing.autoV2 && model.autoV2) {
          next = { ...next, autoV2: model.autoV2 };
        }
        if (!existing.fileName && model.fileName) {
          next = { ...next, fileName: model.fileName };
        }
      }
      const mergedHashes = unionAutoV2List(
        existing.autoV2 ? [existing.autoV2] : undefined,
        existing.autoV2Hashes,
        model.autoV2 ? [model.autoV2] : undefined,
        model.autoV2Hashes,
      );
      const prevHashCount = unionAutoV2List(
        existing.autoV2 ? [existing.autoV2] : undefined,
        existing.autoV2Hashes,
      ).length;
      if (mergedHashes.length > prevHashCount) {
        next = { ...next, autoV2Hashes: mergedHashes };
      }
      if (model.versions?.length) {
        const mergedVersions = mergeCachedVersions(
          existing.versions,
          model.versions,
        );
        if (
          JSON.stringify(mergedVersions) !== JSON.stringify(existing.versions)
        ) {
          next = { ...next, versions: mergedVersions };
        }
        // Tip-check / re-sync can correct a false Early Access flag on the
        // same versionId (paid Buzz was previously misread as Public).
        const mergedEa = mergeEarlyAccessFlag({
          prev: existing.earlyAccess,
          next:
            model.earlyAccess ||
            mergedVersions.some(
              (v) =>
                v.earlyAccess ||
                (typeof v.downloadPrice === 'number' && v.downloadPrice > 0),
            ),
          prevEndsAt: existing.earlyAccessEndsAt,
          nextEndsAt: model.earlyAccessEndsAt ?? existing.earlyAccessEndsAt,
        });
        if (mergedEa !== existing.earlyAccess) {
          next = {
            ...next,
            earlyAccess: Boolean(mergedEa),
            earlyAccessEndsAt:
              model.earlyAccessEndsAt ?? next.earlyAccessEndsAt,
          };
        }
      }
      // Refresh cover URL when the API’s primary still changes.
      // New URL → new cache key → thumb re-downloads once.
      const incomingPreview =
        typeof model.previewUrl === 'string' ? model.previewUrl.trim() : '';
      if (incomingPreview && incomingPreview !== (existing.previewUrl ?? '')) {
        next = {
          ...next,
          previewUrl: incomingPreview,
          previewMissing: false,
        };
      }
      const incomingPublished =
        typeof model.publishedAt === 'string' ? model.publishedAt.trim() : '';
      if (incomingPublished && incomingPublished !== existing.publishedAt) {
        next = { ...next, publishedAt: incomingPublished };
      }
      if (next !== existing) {
        page.models[key] = { ...next, updatedAt: now };
        page.dirty = true;
        dirtyPages.add(page.pageKey);
        patched += 1;
        toRemember.push(page.models[key]!);
      } else if (mergedHashes.length > 0) {
        // Hashes already on card — still ensure Map keys exist.
        toRemember.push(existing);
      }
      continue;
    }
    const hashes = unionAutoV2List(
      model.autoV2 ? [model.autoV2] : undefined,
      model.autoV2Hashes,
    );
    page.models[key] = {
      ...model,
      autoV2Hashes: hashes.length > 0 ? hashes : model.autoV2Hashes,
      firstSeenAt: model.firstSeenAt || now,
      updatedAt: model.updatedAt || now,
    };
    page.dirty = true;
    dirtyPages.add(page.pageKey);
    added += 1;
    toRemember.push(page.models[key]!);
  }

  if (added > 0 || patched > 0) scheduleFlush();
  for (const row of toRemember) {
    rememberAllAutoV2InCatalogIndex(row);
  }
  return added;
}

function mergeCachedVersions(
  existing: CachedCivitaiModel['versions'],
  incoming: NonNullable<CachedCivitaiModel['versions']>,
): NonNullable<CachedCivitaiModel['versions']> {
  if (!existing?.length) return incoming;
  const byId = new Map(existing.map((v) => [v.id, v]));
  const out: NonNullable<CachedCivitaiModel['versions']> = [];
  const seen = new Set<number>();
  for (const next of incoming) {
    const prev = byId.get(next.id);
    out.push(
      prev
        ? {
            ...prev,
            ...next,
            autoV2Hashes: unionAutoV2List(prev.autoV2Hashes, next.autoV2Hashes),
            autoV2: next.autoV2 ?? prev.autoV2,
            fileName: next.fileName ?? prev.fileName,
            name: next.name || prev.name,
            baseModel: next.baseModel ?? prev.baseModel,
            // List/feed payloads often omit EA end times — never wipe a known value.
            earlyAccessEndsAt:
              next.earlyAccessEndsAt ?? prev.earlyAccessEndsAt,
            downloadPrice:
              typeof next.downloadPrice === 'number' && next.downloadPrice > 0
                ? next.downloadPrice
                : typeof prev.downloadPrice === 'number' &&
                    prev.downloadPrice > 0 &&
                  // Cleared EA with a past end should drop the price residue.
                  !(
                    next.earlyAccessEndsAt &&
                    !isEarlyAccessActive(true, next.earlyAccessEndsAt)
                  ) &&
                  !(
                    prev.earlyAccessEndsAt &&
                    !isEarlyAccessActive(true, prev.earlyAccessEndsAt)
                  )
                ? prev.downloadPrice
                : next.downloadPrice,
            earlyAccess: mergeEarlyAccessFlag({
              prev:
                prev.earlyAccess ||
                (typeof prev.downloadPrice === 'number' &&
                  prev.downloadPrice > 0),
              next:
                next.earlyAccess ||
                (typeof next.downloadPrice === 'number' &&
                  next.downloadPrice > 0),
              prevEndsAt: prev.earlyAccessEndsAt,
              nextEndsAt: next.earlyAccessEndsAt,
            }),
            files: mergeCachedVersionFiles(prev.files, next.files),
          }
        : next,
    );
    seen.add(next.id);
  }
  for (const prev of existing) {
    if (seen.has(prev.id)) continue;
    out.push(prev);
  }
  return out;
}

function mergeCachedVersionFiles(
  existing: NonNullable<CachedCivitaiModel['versions']>[number]['files'],
  incoming: NonNullable<CachedCivitaiModel['versions']>[number]['files'],
): NonNullable<CachedCivitaiModel['versions']>[number]['files'] {
  if (!incoming?.length) return existing;
  if (!existing?.length) return incoming;
  const byKey = new Map(
    existing.map((f) => [String(f.id ?? f.name.toLowerCase()), f]),
  );
  const out: NonNullable<
    NonNullable<CachedCivitaiModel['versions']>[number]['files']
  > = [];
  const seen = new Set<string>();
  for (const next of incoming) {
    const key = String(next.id ?? next.name.toLowerCase());
    const prev = byKey.get(key);
    out.push(
      prev
        ? {
            ...prev,
            ...next,
            autoV2: next.autoV2 ?? prev.autoV2,
            variantLabel: next.variantLabel ?? prev.variantLabel,
          }
        : next,
    );
    seen.add(key);
  }
  for (const prev of existing) {
    const key = String(prev.id ?? prev.name.toLowerCase());
    if (seen.has(key)) continue;
    out.push(prev);
  }
  return out;
}

/** Patch fields on an existing catalog entry (e.g. earlyAccessEndsAt). */
export function patchCachedModel(
  origin: string,
  modelId: number,
  patch: Partial<
    Pick<
      CachedCivitaiModel,
      | 'earlyAccess'
      | 'earlyAccessEndsAt'
      | 'previewUrl'
      | 'previewMissing'
      | 'autoV2'
      | 'autoV2Hashes'
      | 'autoV2HashesExpandedAt'
      | 'autoV2CheckedAt'
      | 'fileName'
      | 'versionId'
      | 'versionName'
      | 'baseModel'
      | 'fileSizeKB'
      | 'trainedWords'
      | 'versions'
      | 'earlyAccess'
      | 'earlyAccessEndsAt'
    >
  >,
): void {
  ensureCatalogReady();
  const key = modelCacheKey(origin, modelId);
  const page = loadModelPage(origin, modelId);
  const existing = page.models[key];
  if (!existing) return;
  const mergedHashes =
    patch.autoV2Hashes || patch.autoV2
      ? unionAutoV2List(
          existing.autoV2 ? [existing.autoV2] : undefined,
          existing.autoV2Hashes,
          patch.autoV2 ? [patch.autoV2] : undefined,
          patch.autoV2Hashes,
        )
      : undefined;
  const mergedVersions = patch.versions
    ? mergeCachedVersions(existing.versions, patch.versions)
    : undefined;
  if (
    patch.versionId != null &&
    patch.versionId !== existing.versionId
  ) {
    maybeUnarchiveForNewVersion({
      modelId: existing.id,
      type: existing.type,
      previousVersionId: existing.versionId,
      nextVersionId: patch.versionId,
      autoV2: patch.autoV2 ?? existing.autoV2,
      autoV2Hashes:
        mergedHashes ??
        unionAutoV2List(
          existing.autoV2 ? [existing.autoV2] : undefined,
          existing.autoV2Hashes,
        ),
      versions: mergedVersions ?? existing.versions,
    });
  }
  page.models[key] = {
    ...existing,
    ...patch,
    ...(mergedHashes ? { autoV2Hashes: mergedHashes } : {}),
    ...(mergedVersions ? { versions: mergedVersions } : {}),
    updatedAt: new Date().toISOString(),
  };
  page.dirty = true;
  scheduleFlush();
  const row = page.models[key]!;
  if (row.autoV2 || (row.autoV2Hashes && row.autoV2Hashes.length > 0)) {
    if (autoV2CatalogIndex) {
      rememberAllAutoV2InCatalogIndex(row);
    } else {
      // Stale persisted Map would omit new hashes — drop it so next load
      // rebuilds from model pages.
      try {
        fs.unlinkSync(autoV2IndexPath());
      } catch {
        // ignore
      }
    }
  }
}

export function updateCatalogSlice(
  sliceKey: string,
  update: {
    /** Prepend (newest first) for incremental sync. */
    prependIds?: number[];
    /** Append older pages while filling. */
    appendIds?: number[];
    /** Haystacks parallel to appendIds (for local search index). */
    appendHays?: string[];
    exhausted?: boolean;
    nextCursor?: string | null;
    lastSyncedAt?: string;
  },
): CatalogSliceState {
  ensureCatalogReady();
  const entry = getSliceIdCache(sliceKey);
  const known = entry.known;
  let idsChanged = false;

  if (update.prependIds?.length) {
    const fresh: number[] = [];
    for (const id of update.prependIds) {
      if (known.has(id)) continue;
      known.add(id);
      fresh.push(id);
    }
    if (fresh.length) {
      const chunks = chunkModelIds(entry.ids);
      const nextChunks = prependIdsIntoChunks(chunks, fresh);
      entry.ids = nextChunks.flat();
      invalidateCatalogSearchIndex(sliceKey);
      // Hay files are ordered with ids — rebuild on next search.
      clearSliceHayFiles(sliceDir(sliceKey));
      idsChanged = true;
    }
  }

  if (update.appendIds?.length) {
    const more: number[] = [];
    const moreHays: string[] = [];
    const incomingHays = update.appendHays ?? [];
    let hayI = 0;
    for (const id of update.appendIds) {
      const hay = incomingHays[hayI++] ?? '';
      if (known.has(id)) continue;
      known.add(id);
      more.push(id);
      moreHays.push(hay);
    }
    if (more.length) {
      const before = entry.ids.length;
      entry.ids.push(...more);
      idsChanged = true;
      if (typeof update.exhausted === 'boolean') {
        entry.meta.exhausted = update.exhausted;
      }
      if (update.nextCursor !== undefined) {
        entry.meta.nextCursor = update.nextCursor;
      }
      if (update.lastSyncedAt) {
        entry.meta.lastSyncedAt = update.lastSyncedAt;
      }
      entry.meta.idCount = entry.ids.length;
      persistSliceIdsAppend(sliceKey, more);
      appendCatalogSearchHays(sliceDir(sliceKey), before, moreHays);
      appendCatalogSearchMem(sliceKey, more, moreHays);
      // Never copy the full id list here — sync pages run this often with 100k+ ids.
      return {
        modelIds: more,
        exhausted: entry.meta.exhausted,
        nextCursor: entry.meta.nextCursor,
        lastSyncedAt: entry.meta.lastSyncedAt,
      };
    }
  }

  if (typeof update.exhausted === 'boolean') {
    entry.meta.exhausted = update.exhausted;
  }
  if (update.nextCursor !== undefined) {
    entry.meta.nextCursor = update.nextCursor;
  }
  if (update.lastSyncedAt) {
    entry.meta.lastSyncedAt = update.lastSyncedAt;
  }

  entry.meta.idCount = entry.ids.length;
  if (idsChanged) {
    persistSliceIds(sliceKey);
  } else {
    // Cursor / exhausted only — do not rewrite every id chunk file.
    writeSliceMeta(entry.meta);
  }

  return {
    modelIds: [],
    exhausted: entry.meta.exhausted,
    nextCursor: entry.meta.nextCursor,
    lastSyncedAt: entry.meta.lastSyncedAt,
  };
}

function clearSliceHayFiles(dir: string): void {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('hay-') && name.endsWith('.json')) {
        fs.unlinkSync(path.join(dir, name));
      }
    }
  } catch {
    // ignore
  }
}

export function listCachedModelsForOrigin(
  origin: string,
): CachedCivitaiModel[] {
  ensureCatalogReady();
  flushDirtyModelPagesSync();
  const host = catalogOriginHost(origin);
  const dir = path.join(catalogRoot(), 'models', host);
  const out: CachedCivitaiModel[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return out;
  }
  for (const name of names) {
    const raw = readJsonFile<ModelPage>(path.join(dir, name));
    if (!raw) continue;
    for (const model of Object.values(raw)) {
      if (model?.origin === origin) out.push(model);
    }
  }
  return out;
}

/**
 * Walk every cached model for an origin, yielding to the event loop between
 * page files so UI stays responsive during rematches.
 */
export async function forEachCachedModelOfOrigin(
  origin: string,
  visit: (model: CachedCivitaiModel) => void | Promise<void>,
  opts?: { pagesBetweenYield?: number },
): Promise<void> {
  ensureCatalogReady();
  const host = catalogOriginHost(origin);
  const dir = path.join(catalogRoot(), 'models', host);
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return;
  }
  const yieldEvery = Math.max(1, opts?.pagesBetweenYield ?? 25);
  for (let i = 0; i < names.length; i += 1) {
    const raw = readJsonFile<ModelPage>(path.join(dir, names[i]!));
    if (raw) {
      for (const model of Object.values(raw)) {
        if (model?.origin === origin) await visit(model);
      }
    }
    if ((i + 1) % yieldEvery === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}

/** Unique remote preview URLs stored on cached models for this origin. */
export async function listCachedPreviewUrlsForOrigin(
  origin: string,
): Promise<string[]> {
  ensureCatalogReady();
  flushDirtyModelPagesSync();
  const host = catalogOriginHost(origin);
  const dir = path.join(catalogRoot(), 'models', host);
  const seen = new Set<string>();
  const out: string[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return out;
  }
  let i = 0;
  for (const name of names) {
    const raw = readJsonFile<ModelPage>(path.join(dir, name));
    if (raw) {
      for (const model of Object.values(raw)) {
        if (!model || model.origin !== origin) continue;
        const url =
          typeof model.previewUrl === 'string' ? model.previewUrl.trim() : '';
        if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
        seen.add(url);
        out.push(url);
      }
    }
    i += 1;
    if (i % 25 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  return out;
}

/** Models missing AutoV2 — for API hash backfill (no preview I/O). */
export function listCachedModelsMissingAutoV2(
  origin: string,
  opts?: { types?: string[] },
): Array<{
  id: number;
  versionId?: number;
  type: string;
  name: string;
}> {
  ensureCatalogReady();
  flushDirtyModelPagesSync();
  const host = catalogOriginHost(origin);
  const dir = path.join(catalogRoot(), 'models', host);
  const typeFilter = opts?.types?.map((t) => t.toLowerCase()) ?? null;
  const out: Array<{
    id: number;
    versionId?: number;
    type: string;
    name: string;
  }> = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return out;
  }
  for (const name of names) {
    const raw = readJsonFile<ModelPage>(path.join(dir, name));
    if (!raw) continue;
    for (const model of Object.values(raw)) {
      if (!model || model.origin !== origin) continue;
      if (model.autoV2) continue;
      // Already probed the API and got no hash — don't hammer forever.
      if (model.autoV2CheckedAt) continue;
      const type = String(model.type ?? '');
      if (
        typeFilter &&
        !typeFilter.includes(type.toLowerCase())
      ) {
        continue;
      }
      out.push({
        id: model.id,
        versionId: model.versionId,
        type,
        name: model.name,
      });
    }
  }
  return out;
}

export function catalogSliceHasModel(
  sliceKey: string,
  modelId: number,
): boolean {
  ensureCatalogReady();
  return getSliceIdCache(sliceKey).known.has(modelId);
}

export function normalizeCatalogOrigin(origin: string): CivitaiOriginDto {
  return origin === 'https://civitai.red'
    ? 'https://civitai.red'
    : 'https://civitai.com';
}

/** Exported for tests — force migration check. */
export function ensureCatalogCacheReady(): void {
  ensureCatalogReady();
}
