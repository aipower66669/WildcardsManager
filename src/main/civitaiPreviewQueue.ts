import { BrowserWindow } from 'electron';
import type {
  CivitaiPreviewDownloadStripDto,
  CivitaiPreviewStripCardDto,
  CivitaiPreviewWarmProgressDto,
} from '../shared/contracts.js';
import { IPC } from '../shared/contracts.js';
import { localCivitaiPreviewUrl } from '../shared/civitaiPreviewUrl.js';
import {
  cacheCivitaiPreview,
  cachedPreviewFileNameForUrl,
  hasCachedCivitaiPreview,
} from './civitaiPreviewCache.js';
import {
  getCachedModel,
  patchCachedModel,
  type CachedCivitaiModel,
} from './civitaiCatalogCache.js';
import {
  modelCategoryIsEnabled,
  type CivitaiModelCategoryId,
} from '../domain/civitaiModelCategories.js';
import { getActiveLibrary, getCivitaiOrigin } from './settingsStore.js';

/**
 * Kept for call-site compatibility.
 * Drain order: Browse `priorityQueue` → active-library `libraryQueue` →
 * retry `normalQueue` (failed downloads only — not full-catalog warm).
 */
export const PREVIEW_PRIORITY = {
  visible: 0,
  prefetch: 1,
  /** Models in the active library (LoRA / checkpoint folders). */
  library: 2,
  /** @deprecated Full-catalog warm removed; treated like library. */
  catalog: 3,
} as const;

export type PreviewPriority =
  (typeof PREVIEW_PRIORITY)[keyof typeof PREVIEW_PRIORITY];

export type PreviewPriorityTarget = {
  url: string;
  modelId?: number;
};

type UrlMeta = {
  url: string;
  modelIds: Set<number>;
};

/**
 * Small ordered queue for cards the user is looking at (grid order, then
 * Show-more prefetch). Replaced wholesale on filter / browse changes — never
 * merged into or sorted with the catalog queue.
 */
let priorityQueue: UrlMeta[] = [];
const inPriority = new Set<string>();

/**
 * Missing covers for models in the **active library**. Runs after Browse
 * priority. Replaced on library open / list.
 */
let libraryQueue: UrlMeta[] = [];
const inLibrary = new Set<string>();

/**
 * Small FIFO for transient retries (and legacy callers). Not used to warm the
 * full Civitai catalog — that would download covers for every library’s models.
 */
const normalQueue: string[] = [];
const inNormal = new Set<string>();
let normalHead = 0;

/** Shared model-id bookkeeping for URLs in either queue. */
const urlMeta = new Map<string, UrlMeta>();

/** Coverage universe = active library’s linked Civitai models only. */
const resolvedModels = new Set<number>();
const knownModels = new Set<number>();
let workerRunning = false;
let coverageRunning = false;
let coverageGeneration = 0;
let catalogSeededThisSession = false;
let fetchedThisRun = 0;
let lastEmitAt = 0;
let lastEmittedKey = '';
let diskPreviewFiles: Set<string> | null = null;
const recentCompleted: CachedCivitaiModel[] = [];
const RECENT_CAP = 12;
let activeDownload: { url: string; model: CachedCivitaiModel } | null = null;
const waiters = new Map<string, Array<(local: string | null) => void>>();

function previewOnDisk(url: string): boolean {
  const fileName = cachedPreviewFileNameForUrl(url);
  if (diskPreviewFiles) return diskPreviewFiles.has(fileName);
  if (hasCachedCivitaiPreview(url)) {
    rememberDiskPreview(url);
    return true;
  }
  return false;
}

function rememberDiskPreview(url: string): void {
  if (!diskPreviewFiles) diskPreviewFiles = new Set();
  diskPreviewFiles.add(cachedPreviewFileNameForUrl(url));
}

function resolveWaiters(url: string, local: string | null): void {
  const list = waiters.get(url);
  if (!list) return;
  waiters.delete(url);
  for (const resolve of list) {
    try {
      resolve(local);
    } catch {
      // ignore
    }
  }
}

function rejectAllWaiters(): void {
  for (const [, list] of waiters) {
    for (const resolve of list) {
      try {
        resolve(null);
      } catch {
        // ignore
      }
    }
  }
  waiters.clear();
}

function normalizeUrl(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

function catalogTotal(): number {
  return Math.max(knownModels.size, resolvedModels.size);
}

function noteKnownModel(modelId: number): void {
  knownModels.add(modelId);
}

function resolveModel(modelId: number): void {
  if (resolvedModels.has(modelId)) return;
  resolvedModels.add(modelId);
}

function markModelsMissing(origin: string, modelIds: Iterable<number>): void {
  for (const id of modelIds) {
    patchCachedModel(origin, id, { previewMissing: true });
    resolveModel(id);
  }
}

function ensureMeta(url: string, modelId?: number): UrlMeta {
  let meta = urlMeta.get(url);
  if (!meta) {
    meta = { url, modelIds: new Set() };
    urlMeta.set(url, meta);
  }
  if (modelId !== undefined) meta.modelIds.add(modelId);
  return meta;
}

function modelForUrl(url: string): CachedCivitaiModel | null {
  const meta = urlMeta.get(url);
  if (!meta) return null;
  const origin = getCivitaiOrigin();
  for (const id of meta.modelIds) {
    const cached = getCachedModel(origin, id);
    if (cached) return cached;
  }
  return null;
}

function toStripCard(
  model: CachedCivitaiModel,
  role: CivitaiPreviewStripCardDto['role'],
): CivitaiPreviewStripCardDto {
  const showPreview = role === 'previous' && model.previewMissing !== true;
  return {
    id: model.id,
    name: model.name,
    creator: model.creator,
    type: model.type,
    previewUrl: showPreview ? model.previewUrl : undefined,
    pageUrl: model.pageUrl,
    baseModel: model.baseModel,
    tags: model.tags ?? [],
    previewMissing: model.previewMissing === true,
    role,
  };
}

function rememberCompleted(model: CachedCivitaiModel): void {
  const last = recentCompleted[recentCompleted.length - 1];
  if (last?.id === model.id) return;
  recentCompleted.push(model);
  while (recentCompleted.length > RECENT_CAP) recentCompleted.shift();
}

function isUrlFinished(url: string): boolean {
  return previewOnDisk(url);
}

/** Append to the small retry FIFO. No sorting. Idempotent. */
function enqueueNormal(url: string, modelId?: number): void {
  if (modelId !== undefined && resolvedModels.has(modelId)) return;
  if (isUrlFinished(url)) {
    if (modelId !== undefined) resolveModel(modelId);
    return;
  }
  ensureMeta(url, modelId);
  if (inNormal.has(url)) return;
  inNormal.add(url);
  normalQueue.push(url);
}

function clearNormalQueue(): void {
  normalQueue.length = 0;
  normalHead = 0;
  inNormal.clear();
}

/**
 * Replace the Browse priority queue (grid order, then prefetch).
 * URLs that scroll off are dropped — they re-queue when visible again.
 * We do not fall back onto a full-catalog warm FIFO.
 */
function replacePriorityQueue(targets: PreviewPriorityTarget[]): void {
  priorityQueue = [];
  inPriority.clear();
  for (const t of targets) {
    if (t.modelId !== undefined && resolvedModels.has(t.modelId)) continue;
    if (isUrlFinished(t.url)) {
      if (t.modelId !== undefined) resolveModel(t.modelId);
      continue;
    }
    if (inPriority.has(t.url)) {
      ensureMeta(t.url, t.modelId);
      continue;
    }
    const meta = ensureMeta(t.url, t.modelId);
    inPriority.add(t.url);
    priorityQueue.push(meta);
  }
  pruneUrlMeta();
}

/** Drop urlMeta entries that are no longer queued or downloading. */
function pruneUrlMeta(): void {
  if (urlMeta.size === 0) return;
  const keep = new Set<string>();
  for (const entry of priorityQueue) keep.add(entry.url);
  for (const entry of libraryQueue) keep.add(entry.url);
  for (let i = normalHead; i < normalQueue.length; i += 1) {
    const url = normalQueue[i];
    if (url) keep.add(url);
  }
  if (activeDownload) keep.add(activeDownload.url);
  for (const url of waiters.keys()) keep.add(url);
  for (const url of urlMeta.keys()) {
    if (!keep.has(url)) urlMeta.delete(url);
  }
}

/** Take the next priority URL, skipping anything already cached. */
function dequeuePriority(): UrlMeta | null {
  while (priorityQueue.length > 0) {
    const entry = priorityQueue.shift()!;
    inPriority.delete(entry.url);
    if (isUrlFinished(entry.url)) {
      for (const id of entry.modelIds) resolveModel(id);
      resolveWaiters(entry.url, localCivitaiPreviewUrl(entry.url));
      continue;
    }
    return entry;
  }
  return null;
}

/**
 * Take the next normal URL. Skip if priority already downloaded it (or any
 * other path finished it). Compacts the FIFO occasionally.
 */
function dequeueNormal(): UrlMeta | null {
  while (normalHead < normalQueue.length) {
    const url = normalQueue[normalHead]!;
    normalHead += 1;
    inNormal.delete(url);

    if (isUrlFinished(url)) {
      const meta = urlMeta.get(url);
      if (meta) for (const id of meta.modelIds) resolveModel(id);
      resolveWaiters(url, localCivitaiPreviewUrl(url));
      continue;
    }
    // Still waiting in Browse or active-library queues — leave it there.
    if (inPriority.has(url) || inLibrary.has(url)) {
      continue;
    }

    const meta = urlMeta.get(url) ?? ensureMeta(url);
    return meta;
  }

  if (normalHead > 0 && normalHead === normalQueue.length) {
    normalQueue.length = 0;
    normalHead = 0;
  } else if (normalHead > 4096 && normalHead * 2 > normalQueue.length) {
    normalQueue.splice(0, normalHead);
    normalHead = 0;
  }
  return null;
}

/**
 * Take the next library URL, skipping anything already cached.
 */
function dequeueLibrary(): UrlMeta | null {
  while (libraryQueue.length > 0) {
    const entry = libraryQueue.shift()!;
    inLibrary.delete(entry.url);
    if (isUrlFinished(entry.url)) {
      for (const id of entry.modelIds) resolveModel(id);
      resolveWaiters(entry.url, localCivitaiPreviewUrl(entry.url));
      continue;
    }
    return entry;
  }
  return null;
}

function pickNext(): UrlMeta | null {
  return dequeuePriority() ?? dequeueLibrary() ?? dequeueNormal();
}

function pendingCount(): number {
  return (
    priorityQueue.length +
    libraryQueue.length +
    Math.max(0, normalQueue.length - normalHead)
  );
}

function peekStripNext(limit: number): UrlMeta[] {
  const out: UrlMeta[] = [];
  const seen = new Set<string>();
  if (activeDownload) seen.add(activeDownload.url);

  for (const entry of priorityQueue) {
    if (out.length >= limit) return out;
    if (seen.has(entry.url) || isUrlFinished(entry.url)) continue;
    seen.add(entry.url);
    out.push(entry);
  }

  for (const entry of libraryQueue) {
    if (out.length >= limit) return out;
    if (seen.has(entry.url) || isUrlFinished(entry.url)) continue;
    seen.add(entry.url);
    out.push(entry);
  }

  for (let i = normalHead; i < normalQueue.length && out.length < limit; i++) {
    const url = normalQueue[i]!;
    if (
      seen.has(url) ||
      inPriority.has(url) ||
      inLibrary.has(url) ||
      isUrlFinished(url)
    ) {
      continue;
    }
    seen.add(url);
    const meta = urlMeta.get(url);
    if (meta) out.push(meta);
  }
  return out;
}

export function getPreviewDownloadStrip(): CivitaiPreviewDownloadStripDto {
  const previous = recentCompleted
    .slice(-3)
    .map((model) => toStripCard(model, 'previous'));
  const current = activeDownload
    ? toStripCard(activeDownload.model, 'current')
    : null;
  const next: CivitaiPreviewStripCardDto[] = [];
  const seenIds = new Set<number>([
    ...previous.map((c) => c.id),
    ...(current ? [current.id] : []),
  ]);

  for (const entry of peekStripNext(8)) {
    if (next.length >= 3) break;
    const model = modelForUrl(entry.url);
    if (!model || seenIds.has(model.id) || model.previewMissing) continue;
    seenIds.add(model.id);
    next.push(toStripCard(model, 'next'));
  }

  return {
    previous,
    current,
    next,
    done: resolvedModels.size,
    total: catalogTotal(),
  };
}

function emitProgress(
  status: CivitaiPreviewWarmProgressDto['status'],
  error?: string,
  force = false,
): void {
  const done = resolvedModels.size;
  const total = catalogTotal();
  // Counters only — strip cards are fetched when the downloader panel is open
  // so Browse does not re-render on every warm tick.
  const payload: CivitaiPreviewWarmProgressDto = {
    status,
    done,
    total,
    fetchedThisRun,
    error,
  };
  const key = `${status}|${done}|${total}|${fetchedThisRun}|${error ?? ''}`;
  const now = Date.now();
  if (
    !force &&
    key === lastEmittedKey &&
    status === 'caching' &&
    now - lastEmitAt < 500
  ) {
    return;
  }
  if (
    !force &&
    status === 'caching' &&
    key !== lastEmittedKey &&
    now - lastEmitAt < 300 &&
    done % 25 !== 0 &&
    done !== total
  ) {
    return;
  }
  lastEmittedKey = key;
  lastEmitAt = now;

  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(IPC.civitaiPreviewWarmProgress, payload);
    } catch {
      // Renderer disposed — ignore.
    }
  }
}

function maybeEmitIdleOrDone(): void {
  if (workerRunning || coverageRunning || pendingCount() > 0) {
    emitProgress('caching');
    return;
  }
  const done = resolvedModels.size;
  const total = catalogTotal();
  emitProgress(done >= total && total > 0 ? 'done' : 'caching', undefined, true);
}

async function pumpQueue(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  emitProgress('caching', undefined, true);
  const origin = getCivitaiOrigin();
  let skippedStreak = 0;
  try {
    while (true) {
      const next = pickNext();
      if (!next) break;

      if (isUrlFinished(next.url)) {
        const displayModel = modelForUrl(next.url);
        for (const id of next.modelIds) resolveModel(id);
        if (displayModel) rememberCompleted(displayModel);
        resolveWaiters(next.url, localCivitaiPreviewUrl(next.url));
        activeDownload = null;
        skippedStreak += 1;
        if (skippedStreak % 8 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        continue;
      }
      skippedStreak = 0;

      const displayModel = modelForUrl(next.url);

      if (displayModel) {
        activeDownload = { url: next.url, model: displayModel };
        emitProgress('caching', undefined, true);
      }

      try {
        const local = await cacheCivitaiPreview(next.url);
        if (
          local ||
          isUrlFinished(next.url) ||
          hasCachedCivitaiPreview(next.url)
        ) {
          rememberDiskPreview(next.url);
          fetchedThisRun += 1;
          for (const id of next.modelIds) resolveModel(id);
          if (displayModel) rememberCompleted(displayModel);
          resolveWaiters(
            next.url,
            local ?? localCivitaiPreviewUrl(next.url),
          );
        } else {
          markModelsMissing(origin, next.modelIds);
          if (displayModel) {
            rememberCompleted({ ...displayModel, previewMissing: true });
          }
          resolveWaiters(next.url, null);
        }
      } catch {
        // Transient — put back on normal FIFO for a later pass.
        resolveWaiters(next.url, null);
        enqueueNormal(next.url);
      }
      activeDownload = null;
      emitProgress('caching');
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally {
    activeDownload = null;
    workerRunning = false;
    if (pendingCount() > 0) {
      void pumpQueue();
    } else {
      maybeEmitIdleOrDone();
    }
  }
}

function ensureWorker(): void {
  emitProgress('caching');
  void pumpQueue();
}

/**
 * Drop pending preview jobs for categories the library has hidden, and remove
 * those models from coverage totals. Does not delete on-disk preview files.
 * Call when the category-visibility UI closes (not on every checkbox toggle).
 */
export function syncPreviewQueueWithEnabledCategories(opts?: {
  /** Re-walk the catalog so newly enabled categories can enqueue missing covers. */
  reseedEnabled?: boolean;
}): CivitaiPreviewWarmProgressDto {
  const enabled = getActiveLibrary()
    .enabledCivitaiCategories as CivitaiModelCategoryId[];
  const origin = getCivitaiOrigin();

  const modelIsHidden = (modelId: number): boolean => {
    const model = getCachedModel(origin, modelId);
    if (!model) return false;
    return !modelCategoryIsEnabled(model.tags, enabled);
  };

  const urlIsHidden = (url: string): boolean => {
    const meta = urlMeta.get(url);
    if (!meta || meta.modelIds.size === 0) return false;
    let saw = false;
    for (const id of meta.modelIds) {
      const model = getCachedModel(origin, id);
      if (!model) continue;
      saw = true;
      if (modelCategoryIsEnabled(model.tags, enabled)) return false;
    }
    return saw;
  };

  const dropUrl = (url: string): void => {
    inPriority.delete(url);
    inLibrary.delete(url);
    inNormal.delete(url);
    urlMeta.delete(url);
    resolveWaiters(url, null);
  };

  priorityQueue = priorityQueue.filter((entry) => {
    if (!urlIsHidden(entry.url)) return true;
    dropUrl(entry.url);
    return false;
  });

  libraryQueue = libraryQueue.filter((entry) => {
    if (!urlIsHidden(entry.url)) return true;
    dropUrl(entry.url);
    return false;
  });

  if (normalQueue.length > 0) {
    let write = 0;
    for (let i = normalHead; i < normalQueue.length; i++) {
      const url = normalQueue[i]!;
      if (urlIsHidden(url)) {
        dropUrl(url);
        continue;
      }
      normalQueue[write] = url;
      write += 1;
    }
    normalQueue.length = write;
    normalHead = 0;
    inNormal.clear();
    for (let i = 0; i < normalQueue.length; i++) {
      inNormal.add(normalQueue[i]!);
    }
  }

  // Do not spread knownModels — coverage sets can be hundreds of thousands deep
  // and `[...hugeSet]` / `push(...huge)` blow the call stack.
  const forgetIds: number[] = [];
  for (const id of knownModels) {
    if (modelIsHidden(id)) forgetIds.push(id);
  }
  for (const id of forgetIds) {
    knownModels.delete(id);
    resolvedModels.delete(id);
  }

  if (opts?.reseedEnabled) {
    // Full-catalog reseed removed — callers rebuild via active-library targets.
    catalogSeededThisSession = false;
  }

  const done = resolvedModels.size;
  const total = catalogTotal();
  const status: CivitaiPreviewWarmProgressDto['status'] =
    workerRunning || coverageRunning || pendingCount() > 0
      ? 'caching'
      : done >= total && total > 0
        ? 'done'
        : 'caching';
  emitProgress(status, undefined, true);
  return {
    status,
    done,
    total,
    fetchedThisRun,
    strip: getPreviewDownloadStrip(),
  };
}

/**
 * Catalog sync used to enqueue every new card’s cover. Previews are scoped to
 * the active library (+ on-screen Browse), so this is intentionally a no-op.
 */
export function noteCatalogModelsForPreviews(
  _models: CachedCivitaiModel[],
  _priority: PreviewPriority = PREVIEW_PRIORITY.catalog,
): void {
  // no-op
}

function normalizeTargets(
  raw: Array<string | PreviewPriorityTarget> | undefined,
): PreviewPriorityTarget[] {
  if (!raw?.length) return [];
  const out: PreviewPriorityTarget[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const url = normalizeUrl(typeof item === 'string' ? item : item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      modelId:
        typeof item === 'string'
          ? undefined
          : typeof item.modelId === 'number'
            ? item.modelId
            : undefined,
    });
  }
  return out;
}

/**
 * Rebuild the active-library preview queue (models in this library’s LoRA /
 * checkpoint folders). Browse priority still wins. Dropped library URLs are
 * not parked on a catalog FIFO — reopen that library to resume them.
 */
export function prioritizeLibraryPreviews(
  targets: Array<string | PreviewPriorityTarget>,
): void {
  const next = normalizeTargets(targets);

  libraryQueue = [];
  inLibrary.clear();
  for (const t of next) {
    if (t.modelId !== undefined && resolvedModels.has(t.modelId)) continue;
    if (isUrlFinished(t.url)) {
      if (t.modelId !== undefined) resolveModel(t.modelId);
      continue;
    }
    if (inLibrary.has(t.url)) {
      ensureMeta(t.url, t.modelId);
      continue;
    }
    const meta = ensureMeta(t.url, t.modelId);
    inLibrary.add(t.url);
    libraryQueue.push(meta);
  }

  if (next.length === 0) {
    emitProgress('caching', undefined, true);
    return;
  }
  ensureWorker();
  emitProgress('caching', undefined, true);
}

export function prioritizePreviewUrls(params: {
  visible: Array<string | PreviewPriorityTarget>;
  prefetch?: Array<string | PreviewPriorityTarget>;
}): void {
  const visible = normalizeTargets(params.visible);
  const prefetch = normalizeTargets(params.prefetch).filter(
    (t) => !visible.some((v) => v.url === t.url),
  );

  if (visible.length === 0 && prefetch.length === 0) return;

  replacePriorityQueue([...visible, ...prefetch]);
  ensureWorker();
  emitProgress('caching', undefined, true);
}

function enqueueLibrary(url: string, modelId?: number): void {
  if (modelId !== undefined && resolvedModels.has(modelId)) return;
  if (isUrlFinished(url)) {
    if (modelId !== undefined) resolveModel(modelId);
    return;
  }
  const meta = ensureMeta(url, modelId);
  if (!inLibrary.has(url)) {
    inLibrary.add(url);
    libraryQueue.push(meta);
  }
}

export function enqueuePreviewUrls(
  urls: string[],
  priority: PreviewPriority = PREVIEW_PRIORITY.catalog,
): void {
  const targets = normalizeTargets(urls);
  if (priority <= PREVIEW_PRIORITY.prefetch) {
    for (let i = targets.length - 1; i >= 0; i--) {
      const t = targets[i]!;
      if (t.modelId !== undefined && resolvedModels.has(t.modelId)) continue;
      if (isUrlFinished(t.url)) {
        if (t.modelId !== undefined) resolveModel(t.modelId);
        continue;
      }
      const meta = ensureMeta(t.url, t.modelId);
      if (!inPriority.has(t.url)) {
        inPriority.add(t.url);
        priorityQueue.unshift(meta);
      }
    }
  } else {
    for (const t of targets) enqueueLibrary(t.url, t.modelId);
  }
  ensureWorker();
}

/**
 * Join the single worker: Browse thumbs go on the priority queue; active
 * library models on the library queue. Full-catalog warm is not used.
 */
export function requestCachedPreview(
  url: string,
  priority: PreviewPriority = PREVIEW_PRIORITY.visible,
  modelId?: number,
): Promise<string | null> {
  const normalized = normalizeUrl(url);
  if (!normalized) return Promise.resolve(null);

  if (isUrlFinished(normalized)) {
    if (modelId !== undefined) resolveModel(modelId);
    return Promise.resolve(localCivitaiPreviewUrl(normalized));
  }

  return new Promise((resolve) => {
    const list = waiters.get(normalized) ?? [];
    list.push(resolve);
    waiters.set(normalized, list);

    if (priority <= PREVIEW_PRIORITY.prefetch) {
      const meta = ensureMeta(normalized, modelId);
      if (!inPriority.has(normalized)) {
        inPriority.add(normalized);
        priorityQueue.unshift(meta);
      }
    } else {
      enqueueLibrary(normalized, modelId);
    }
    ensureWorker();
  });
}

/**
 * Replace coverage totals with the active library’s linked models.
 * Call before `prioritizeLibraryPreviews` on library open / switch.
 */
export function setActiveLibraryPreviewCoverage(
  entries: Array<{ modelId: number; resolved: boolean }>,
): void {
  knownModels.clear();
  resolvedModels.clear();
  for (const entry of entries) {
    if (!Number.isFinite(entry.modelId)) continue;
    knownModels.add(entry.modelId);
    if (entry.resolved) resolvedModels.add(entry.modelId);
  }
  emitProgress('caching', undefined, true);
}

/** Drop catalog/retry backlog and in-flight waiters when switching libraries. */
export function resetPreviewQueuesForLibrarySwitch(): void {
  coverageGeneration += 1;
  coverageRunning = false;
  catalogSeededThisSession = false;
  priorityQueue = [];
  inPriority.clear();
  libraryQueue = [];
  inLibrary.clear();
  clearNormalQueue();
  knownModels.clear();
  resolvedModels.clear();
  urlMeta.clear();
  activeDownload = null;
  recentCompleted.length = 0;
  rejectAllWaiters();
  emitProgress('caching', undefined, true);
}

/**
 * Full-catalog preview coverage was removed. Active-library warm is driven by
 * `prioritizeActiveLibraryPreviews` / Browse priority instead.
 */
export function startCatalogPreviewCoverage(_opts?: { force?: boolean }): void {
  catalogSeededThisSession = true;
  coverageRunning = false;
  emitProgress(
    pendingCount() > 0 || workerRunning ? 'caching' : 'done',
    undefined,
    true,
  );
}

/** @deprecated Prefer startCatalogPreviewCoverage. */
export function seedCatalogPreviewQueue(opts?: { force?: boolean }): void {
  startCatalogPreviewCoverage(opts);
}

export function reseedCatalogPreviewQueue(): void {
  startCatalogPreviewCoverage({ force: false });
}

/** @deprecated Prefer prioritizePreviewUrls. */
export function startCivitaiPreviewWarm(urls: string[]): void {
  prioritizePreviewUrls({ visible: urls });
}

/**
 * Re-queue a model's cover after the catalog URL was corrected. Clears the
 * “already done” flag so coverage downloads the new file.
 */
export function requeueModelPreview(modelId: number, url: string): void {
  const normalized = normalizeUrl(url);
  if (!normalized) return;
  resolvedModels.delete(modelId);
  noteKnownModel(modelId);
  if (isUrlFinished(normalized)) {
    resolveModel(modelId);
    rememberDiskPreview(normalized);
    return;
  }
  enqueueLibrary(normalized, modelId);
  ensureWorker();
}

export function stopCivitaiPreviewWarm(): void {
  coverageGeneration += 1;
  coverageRunning = false;
  priorityQueue = [];
  inPriority.clear();
  libraryQueue = [];
  inLibrary.clear();
  clearNormalQueue();
  urlMeta.clear();
  activeDownload = null;
  rejectAllWaiters();
  emitProgress('cancelled', undefined, true);
}
