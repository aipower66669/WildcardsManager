import { app, BrowserWindow, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import {
  downloadedVideosJsonPath,
  isPathInsideRoot,
} from '../domain/librarySidecarPaths.js';
import {
  civitaiCommunityMediaKind,
  CivitaiMediaTypeMismatchError,
  isCivitaiImageContentType,
} from '../domain/civitaiMediaType.js';
import { isHtmlContentType } from '../domain/civitaiMediaOriginRetry.js';
import {
  safeBaseModelDirName,
  uniqueDestFileName,
} from '../domain/uniqueDestFileName.js';
import { IPC, type CivitaiOriginDto } from '../shared/contracts.js';
import {
  getActiveLibrary,
  getCivitaiApiKey,
  getCivitaiOrigin,
  listLibraryConfigs,
  loadSettings,
} from './settingsStore.js';
import {
  appendDownloadLog,
  formatErrorDetail,
  logDownloadError,
} from './downloadLog.js';
import { atomicWriteFile, readJsonFile } from './librarySidecarIo.js';
import { invalidateCivitaiMediaKnown } from './civitaiMediaKnownCache.js';
import { fetchCivitaiCommunityMedia } from './civitaiMediaDownloadFetch.js';

export type DownloadedCivitaiVideoRecord = {
  origin: CivitaiOriginDto;
  imageId: number;
  baseModel: string;
  relativePath: string;
  url: string;
  fileName: string;
  savedAt: string;
  username?: string | null;
  /** Absolute videos folder used when the file was saved (for open-after-move). */
  videosRoot?: string;
};

export type CivitaiVideoDownloadProgress = {
  imageId: number;
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
  error?: string;
  statusMessage?: string;
  fileName?: string;
  /** Jobs waiting behind the active download. */
  queuedCount?: number;
  phase?: 'queued' | 'active' | 'done';
};

export type CivitaiVideoDownloadRequest = {
  imageId: number;
  url: string;
  baseModel?: string | null;
  username?: string | null;
  fileName?: string;
  /** Civitai upload time — applied to the saved file’s mtime/atime. */
  createdAt?: string | null;
  /** Pixel width from the API hit — used if `original=true` 404s. */
  width?: number | null;
};

type QueueJob = {
  opts: CivitaiVideoDownloadRequest;
  resolve: (value: {
    saved: DownloadedCivitaiVideoRecord & { absolutePath: string };
    renamed: boolean;
  }) => void;
  reject: (error: Error) => void;
};

let activeJob: QueueJob | null = null;
let pendingJobs: QueueJob[] = [];
let pumping = false;

function queuedCount(): number {
  return pendingJobs.length;
}

function broadcastQueueIdle(): void {
  broadcastProgress({
    imageId: 0,
    receivedBytes: 0,
    totalBytes: null,
    done: true,
    queuedCount: 0,
    phase: 'done',
    statusMessage: 'Video queue idle',
  });
}

type RegistryFile = {
  /** v2/v3 = AppData registry (folder-agnostic). v1 = legacy in-folder format. */
  version: 1 | 2 | 3;
  items: DownloadedCivitaiVideoRecord[];
  /** Absolute legacy registry paths already merged into AppData. */
  migratedFrom?: string[];
};

/** In-memory index — O(1) downloaded checks; JSON is only for persistence. */
type RegistryState = {
  /** `origin\\0imageId` → record */
  byKey: Map<string, DownloadedCivitaiVideoRecord>;
  /** imageId → record (legacy / cross-origin fallback; first wins) */
  byId: Map<number, DownloadedCivitaiVideoRecord>;
  migratedFrom: string[];
  dirty: boolean;
};

let registryState: RegistryState | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 1500;

function authHeaders(): HeadersInit {
  const key = getCivitaiApiKey();
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

function requireVideosFolder(): string {
  const folder =
    getActiveLibrary().videosFolder?.trim() ||
    loadSettings().videosFolder?.trim();
  if (!folder) {
    throw new Error(
      'No videos folder configured — set one in Settings before downloading.',
    );
  }
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new Error('Configured videos folder is missing or not a directory');
  }
  return path.resolve(folder);
}

/** Canonical registry — lives in Electron userData, not under the images folder. */
function appDataRegistryPath(): string {
  return path.join(app.getPath('userData'), 'downloaded-civitai-videos.json');
}

function legacyRegistryPath(videosRoot: string): string {
  return downloadedVideosJsonPath(videosRoot);
}

function coerceImageId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function normalizeOrigin(value: unknown): CivitaiOriginDto | null {
  if (value === 'https://civitai.com' || value === 'https://civitai.red') {
    return value;
  }
  return null;
}

function recordKey(origin: string, imageId: number): string {
  return `${origin}\0${imageId}`;
}

function parseRegistryItems(
  rawItems: unknown,
  fallbackOrigin: CivitaiOriginDto,
  defaultImagesRoot?: string | null,
): DownloadedCivitaiVideoRecord[] {
  if (!Array.isArray(rawItems)) return [];
  const out: DownloadedCivitaiVideoRecord[] = [];
  for (const row of rawItems) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const imageId = coerceImageId(rec.imageId);
    if (imageId == null) continue;
    if (typeof rec.relativePath !== 'string' || !rec.relativePath.trim()) {
      continue;
    }
    if (typeof rec.fileName !== 'string' || !rec.fileName.trim()) continue;
    const origin = normalizeOrigin(rec.origin) ?? fallbackOrigin;
    const videosRoot =
      typeof rec.videosRoot === 'string' && rec.videosRoot.trim()
        ? path.resolve(rec.videosRoot.trim())
        : defaultImagesRoot?.trim()
          ? path.resolve(defaultImagesRoot.trim())
          : undefined;
    out.push({
      origin,
      imageId,
      baseModel:
        typeof rec.baseModel === 'string' && rec.baseModel.trim()
          ? rec.baseModel.trim()
          : '_unknown',
      relativePath: rec.relativePath.replaceAll('\\', '/'),
      url: typeof rec.url === 'string' ? rec.url : '',
      fileName: rec.fileName,
      savedAt:
        typeof rec.savedAt === 'string' && rec.savedAt.trim()
          ? rec.savedAt
          : new Date(0).toISOString(),
      username:
        typeof rec.username === 'string' || rec.username === null
          ? (rec.username as string | null)
          : null,
      ...(videosRoot ? { videosRoot } : {}),
    });
  }
  return out;
}

function emptyRegistryState(migratedFrom: string[] = []): RegistryState {
  return {
    byKey: new Map(),
    byId: new Map(),
    migratedFrom,
    dirty: false,
  };
}

function indexRecord(state: RegistryState, row: DownloadedCivitaiVideoRecord): void {
  const key = recordKey(row.origin, row.imageId);
  state.byKey.set(key, row);
  if (!state.byId.has(row.imageId)) {
    state.byId.set(row.imageId, row);
  } else {
    // Prefer the row matching the active origin when colliding on id-only map.
    const existing = state.byId.get(row.imageId)!;
    if (existing.origin !== row.origin) {
      try {
        const active = getCivitaiOrigin() as CivitaiOriginDto;
        if (row.origin === active) state.byId.set(row.imageId, row);
      } catch {
        state.byId.set(row.imageId, row);
      }
    } else {
      state.byId.set(row.imageId, row);
    }
  }
}

function buildStateFromItems(
  items: DownloadedCivitaiVideoRecord[],
  migratedFrom: string[],
): RegistryState {
  const state = emptyRegistryState(migratedFrom);
  for (const row of items) indexRecord(state, row);
  return state;
}

function loadRegistryState(): RegistryState {
  if (registryState) return registryState;
  const raw = readJsonFile<RegistryFile>(appDataRegistryPath());
  const fallbackOrigin = getCivitaiOrigin() as CivitaiOriginDto;
  if (!raw || !Array.isArray(raw.items)) {
    registryState = emptyRegistryState();
    return registryState;
  }
  const migratedFrom = Array.isArray(raw.migratedFrom)
    ? raw.migratedFrom
        .filter((p): p is string => typeof p === 'string' && Boolean(p.trim()))
        .map((p) => path.resolve(p.trim()))
    : [];
  const items = parseRegistryItems(raw.items, fallbackOrigin);
  registryState = buildStateFromItems(items, migratedFrom);
  return registryState;
}

function scheduleRegistryPersist(): void {
  const state = registryState;
  if (!state) return;
  state.dirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushDownloadedVideosRegistrySync();
  }, PERSIST_DEBOUNCE_MS);
  // Don't keep the event loop alive solely for this timer.
  if (typeof persistTimer === 'object' && 'unref' in persistTimer) {
    persistTimer.unref();
  }
}

/** Flush pending registry writes (call on app quit). */
export function flushDownloadedVideosRegistrySync(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const state = registryState;
  if (!state?.dirty) return;
  const items = [...state.byKey.values()];
  const payload: RegistryFile = {
    version: 3,
    items,
    migratedFrom: [...new Set(state.migratedFrom.map((p) => path.resolve(p)))].sort(
      (a, b) => a.localeCompare(b),
    ),
  };
  // Compact JSON — pretty-print is untenable at 100k+ rows.
  atomicWriteFile(appDataRegistryPath(), `${JSON.stringify(payload)}\n`);
  state.dirty = false;
}

function upsertDownloadedRecord(row: DownloadedCivitaiVideoRecord): void {
  const state = loadRegistryState();
  indexRecord(state, row);
  invalidateCivitaiMediaKnown('video');
  scheduleRegistryPersist();
}

/** Snapshot of all records (for list UI / migration). */
function listRegistryRecords(): DownloadedCivitaiVideoRecord[] {
  return [...loadRegistryState().byKey.values()];
}

/**
 * O(1) — true when this origin+id (or legacy id-only) is in the download registry.
 */
export function isCivitaiVideoDownloaded(
  imageId: number,
  origin?: CivitaiOriginDto | null,
): boolean {
  return findDownloadedRecord(imageId, origin ?? null) != null;
}

/**
 * Registry is the source of truth (not a folder scan). Match by origin+id in
 * a HashMap; fall back to id-only map for legacy rows.
 */
function findDownloadedRecord(
  imageId: number,
  origin: CivitaiOriginDto | null,
): DownloadedCivitaiVideoRecord | null {
  const id = Math.round(imageId);
  const state = loadRegistryState();
  if (origin) {
    const hit = state.byKey.get(recordKey(origin, id));
    if (hit) return hit;
  }
  return state.byId.get(id) ?? null;
}

/**
 * One-shot / idempotent: merge any `!.wcm/downloaded-videos.json` under
 * configured videos folders into AppData, then leave a `.bak` beside the legacy
 * file so changing the download folder no longer wipes tracking.
 */
export function migrateDownloadedCivitaiVideosRegistry(
  extraLegacyRoots?: string[],
): {
  mergedLibraries: number;
  addedRecords: number;
} {
  const fallbackOrigin = getCivitaiOrigin() as CivitaiOriginDto;
  const state = loadRegistryState();
  const migratedSet = new Set(
    state.migratedFrom.map((p) => path.resolve(p).toLowerCase()),
  );
  let mergedLibraries = 0;
  let addedRecords = 0;
  let dirty = false;

  const roots = new Map<string, string>();
  for (const lib of listLibraryConfigs()) {
    const folder = lib.videosFolder?.trim();
    if (!folder) continue;
    try {
      const resolved = path.resolve(folder);
      roots.set(resolved.toLowerCase(), resolved);
    } catch {
      // skip
    }
  }
  for (const folder of extraLegacyRoots ?? []) {
    if (!folder?.trim()) continue;
    try {
      const resolved = path.resolve(folder.trim());
      roots.set(resolved.toLowerCase(), resolved);
    } catch {
      // skip
    }
  }

  for (const videosRoot of roots.values()) {
    const legacyPath = path.resolve(legacyRegistryPath(videosRoot));
    const legacyKey = legacyPath.toLowerCase();
    if (migratedSet.has(legacyKey)) continue;

    const candidates = [legacyPath, `${legacyPath}.bak`];
    let foundPath: string | null = null;
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        foundPath = candidate;
        break;
      }
    }

    if (!foundPath) {
      state.migratedFrom = [
        ...new Set([...state.migratedFrom, path.resolve(legacyPath)]),
      ];
      migratedSet.add(legacyKey);
      dirty = true;
      continue;
    }

    const legacyRaw = readJsonFile<RegistryFile>(foundPath);
    const legacyItems = parseRegistryItems(
      legacyRaw?.items,
      fallbackOrigin,
      videosRoot,
    );
    let added = 0;
    for (const row of legacyItems) {
      const key = recordKey(row.origin, row.imageId);
      const prev = state.byKey.get(key);
      if (!prev) {
        indexRecord(state, row);
        added += 1;
        continue;
      }
      const prevMs = Date.parse(prev.savedAt);
      const nextMs = Date.parse(row.savedAt);
      const preferIncoming =
        (Number.isFinite(nextMs) &&
          Number.isFinite(prevMs) &&
          nextMs > prevMs) ||
        (!prev.videosRoot && Boolean(row.videosRoot));
      if (preferIncoming) {
        indexRecord(state, {
          ...row,
          videosRoot: row.videosRoot ?? prev.videosRoot,
        });
      } else if (!prev.videosRoot && row.videosRoot) {
        indexRecord(state, { ...prev, videosRoot: row.videosRoot });
      }
    }
    addedRecords += added;
    mergedLibraries += 1;
    state.migratedFrom = [
      ...new Set([...state.migratedFrom, path.resolve(legacyPath)]),
    ];
    migratedSet.add(legacyKey);
    dirty = true;

    if (foundPath === legacyPath) {
      try {
        const bak = `${legacyPath}.bak`;
        if (fs.existsSync(bak)) fs.unlinkSync(bak);
        fs.renameSync(legacyPath, bak);
      } catch {
        // ignore rename failures
      }
    }
  }

  if (dirty) {
    state.dirty = true;
    flushDownloadedVideosRegistrySync();
    appendDownloadLog(
      'info',
      `Migrated Civitai image download registry to AppData` +
        (mergedLibraries
          ? ` (${mergedLibraries} folder registries, +${addedRecords} ids)`
          : ''),
      { source: 'download' },
    );
  }

  return { mergedLibraries, addedRecords };
}

function resolveRecordAbsolutePath(
  record: DownloadedCivitaiVideoRecord,
  currentVideosRoot?: string | null,
): string {
  const rel = record.relativePath;
  if (record.videosRoot) {
    const atSaved = path.join(record.videosRoot, rel);
    if (fs.existsSync(atSaved)) return atSaved;
  }
  if (currentVideosRoot?.trim()) {
    return path.join(path.resolve(currentVideosRoot.trim()), rel);
  }
  if (record.videosRoot) return path.join(record.videosRoot, rel);
  return rel;
}

function recordWithAbsolutePath(
  record: DownloadedCivitaiVideoRecord,
  currentVideosRoot?: string | null,
): DownloadedCivitaiVideoRecord & { absolutePath: string } {
  return {
    ...record,
    absolutePath: resolveRecordAbsolutePath(record, currentVideosRoot),
  };
}

function guessExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (/\.(mp4|webm|mov|m4v)$/i.test(ext)) return ext;
  } catch {
    // ignore
  }
  return '.mp4';
}

function assertVideoMediaUrl(imageId: number, url: string): void {
  if (civitaiCommunityMediaKind({ url }) === 'image') {
    throw new CivitaiMediaTypeMismatchError(
      'video',
      `Civitai item #${imageId} is an image — skipped by Videos download`,
    );
  }
}

/** Parse Civitai createdAt; returns null when missing/invalid. */
function parseUploadDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  // Reject absurd futures / pre-epoch noise.
  if (ms < Date.parse('2000-01-01T00:00:00Z') || ms > Date.now() + 86_400_000) {
    return null;
  }
  return new Date(ms);
}

/**
 * Stamp the file with the creator upload time so Explorer / local tools sort
 * by post date instead of download time (atime + mtime).
 */
function applyUploadTimestamp(absolutePath: string, createdAt?: string | null): void {
  const when = parseUploadDate(createdAt);
  if (!when) return;
  try {
    fs.utimesSync(absolutePath, when, when);
  } catch {
    // ignore — download still succeeded
  }
}

function broadcastProgress(payload: CivitaiVideoDownloadProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(IPC.civitaiVideoDownloadProgress, payload);
    } catch {
      // ignore
    }
  }
}

export function listDownloadedCivitaiVideos(): Array<
  DownloadedCivitaiVideoRecord & { absolutePath: string }
> {
  const currentRoot = loadSettings().videosFolder?.trim() ?? null;
  return listRegistryRecords().map((row) =>
    recordWithAbsolutePath(row, currentRoot),
  );
}

/** Image ids only — for O(1) browse skip Sets without shipping full records. */
export function listDownloadedCivitaiVideoIds(): number[] {
  return [...loadRegistryState().byId.keys()];
}

/** True when this image id is active or waiting in the serial queue. */
export function isCivitaiVideoDownloadQueued(imageId: number): boolean {
  const id = Math.round(imageId);
  if (activeJob && Math.round(activeJob.opts.imageId) === id) return true;
  return pendingJobs.some((job) => Math.round(job.opts.imageId) === id);
}

export function listQueuedCivitaiVideoIds(): number[] {
  const ids: number[] = [];
  if (activeJob) ids.push(Math.round(activeJob.opts.imageId));
  for (const job of pendingJobs) ids.push(Math.round(job.opts.imageId));
  return ids;
}

/**
 * Enqueue an image download. Only one transfer runs at a time; further clicks
 * wait in FIFO order. Already-registered imageIds resolve immediately (no
 * network) — tracking is the AppData registry, not a folder walk.
 */
export function downloadCivitaiVideo(
  opts: CivitaiVideoDownloadRequest,
): Promise<{
  saved: DownloadedCivitaiVideoRecord & { absolutePath: string };
  renamed: boolean;
}> {
  const imageId = Math.round(opts.imageId);
  if (!Number.isFinite(imageId)) {
    return Promise.reject(new Error('Invalid image id'));
  }
  let videosRoot: string;
  try {
    videosRoot = requireVideosFolder();
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
  if (isCivitaiVideoDownloadQueued(imageId)) {
    return Promise.reject(new Error(`Video #${imageId} is already queued`));
  }

  const origin = getCivitaiOrigin() as CivitaiOriginDto;
  const existing = findDownloadedRecord(imageId, origin);
  if (existing) {
    const saved = recordWithAbsolutePath(existing, videosRoot);
    broadcastProgress({
      imageId,
      receivedBytes: 0,
      totalBytes: null,
      done: true,
      phase: 'done',
      queuedCount: queuedCount(),
      fileName: existing.fileName,
      statusMessage: `Already downloaded ${existing.fileName}`,
    });
    return Promise.resolve({ saved, renamed: false });
  }

  return new Promise((resolve, reject) => {
    pendingJobs.push({ opts: { ...opts, imageId }, resolve, reject });
    broadcastProgress({
      imageId,
      receivedBytes: 0,
      totalBytes: null,
      done: false,
      phase: 'queued',
      queuedCount: queuedCount(),
      statusMessage:
        activeJob != null
          ? `Queued image #${imageId} (${queuedCount()} waiting)`
          : `Queued image #${imageId}`,
    });
    void pumpVideoQueue();
  });
}

async function pumpVideoQueue(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (pendingJobs.length > 0) {
      const job = pendingJobs.shift()!;
      activeJob = job;
      try {
        const result = await runCivitaiVideoDownload(job.opts);
        job.resolve(result);
      } catch (err) {
        job.reject(err instanceof Error ? err : new Error(String(err)));
      } finally {
        activeJob = null;
      }
    }
    broadcastQueueIdle();
  } finally {
    pumping = false;
    if (pendingJobs.length > 0) void pumpVideoQueue();
  }
}

async function runCivitaiVideoDownload(
  opts: CivitaiVideoDownloadRequest,
): Promise<{
  saved: DownloadedCivitaiVideoRecord & { absolutePath: string };
  renamed: boolean;
}> {
  const imageId = Math.round(opts.imageId);
  if (!Number.isFinite(imageId)) throw new Error('Invalid video id');
  const url = opts.url?.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error('Invalid video URL');
  }
  assertVideoMediaUrl(imageId, url);

  const videosRoot = requireVideosFolder();
  const origin = getCivitaiOrigin() as CivitaiOriginDto;
  // Re-check at run time (registry may have been updated since enqueue).
  const existing = findDownloadedRecord(imageId, origin);
  if (existing) {
    return {
      saved: recordWithAbsolutePath(existing, videosRoot),
      renamed: false,
    };
  }

  const baseModel = (opts.baseModel ?? '').trim() || '_unknown';
  const baseDirName = safeBaseModelDirName(baseModel);
  const destDir = path.join(videosRoot, baseDirName);
  fs.mkdirSync(destDir, { recursive: true });

  const preferred =
    opts.fileName?.trim() ||
    `civitai-${imageId}${guessExtFromUrl(url)}`;
  const unique = uniqueDestFileName(destDir, preferred, (p) =>
    fs.existsSync(p),
  );
  const waiting = queuedCount();

  broadcastProgress({
    imageId,
    receivedBytes: 0,
    totalBytes: null,
    done: false,
    phase: 'active',
    queuedCount: waiting,
    statusMessage:
      waiting > 0
        ? `Downloading video… (${waiting} queued)`
        : 'Downloading video…',
    fileName: unique.fileName,
  });

  const temp = `${unique.absolutePath}.${process.pid}.tmp`;
  if (fs.existsSync(temp)) fs.unlinkSync(temp);

  try {
    const fetched = await fetchCivitaiCommunityMedia(
      url,
      {
        headers: {
          Accept: 'video/*,*/*',
          ...authHeaders(),
          'User-Agent': 'WildcardsManager/1.0 (Civitai video download)',
        },
      },
      () => {
        broadcastProgress({
          imageId,
          receivedBytes: 0,
          totalBytes: null,
          done: false,
          phase: 'active',
          queuedCount: queuedCount(),
          fileName: unique.fileName,
          statusMessage: 'Retrying file URL…',
        });
      },
      opts.width ?? undefined,
    );
    const response = fetched.response;
    const savedUrl = fetched.url;
    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Video download failed (${response.status}): ${body.slice(0, 160) || response.statusText}`,
      );
    }
    if (isHtmlContentType(response.headers.get('content-type'))) {
      throw new Error(
        'Video download failed: Civitai returned a web page instead of the file',
      );
    }
    if (
      isCivitaiImageContentType(response.headers.get('content-type')) &&
      civitaiCommunityMediaKind({ url }) !== 'video'
    ) {
      throw new CivitaiMediaTypeMismatchError(
        'video',
        `Civitai item #${imageId} is an image — skipped by Videos download`,
      );
    }

    const totalHeader = response.headers.get('content-length');
    const totalBytes =
      totalHeader && /^\d+$/.test(totalHeader) ? Number(totalHeader) : null;
    let receivedBytes = 0;
    let lastEmit = 0;

    const nodeStream = Readable.fromWeb(
      response.body as import('node:stream/web').ReadableStream,
    );
    nodeStream.on('data', (chunk: Buffer | string) => {
      receivedBytes +=
        typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      const now = Date.now();
      if (now - lastEmit >= 250) {
        lastEmit = now;
        broadcastProgress({
          imageId,
          receivedBytes,
          totalBytes,
          done: false,
          phase: 'active',
          queuedCount: queuedCount(),
          fileName: unique.fileName,
        });
      }
    });

    await pipeline(nodeStream, createWriteStream(temp));
    if (fs.existsSync(unique.absolutePath)) fs.unlinkSync(unique.absolutePath);
    fs.renameSync(temp, unique.absolutePath);
    applyUploadTimestamp(unique.absolutePath, opts.createdAt);

    const relativePath = path
      .relative(videosRoot, unique.absolutePath)
      .replaceAll('\\', '/');
    const record: DownloadedCivitaiVideoRecord = {
      origin,
      imageId,
      baseModel: baseDirName,
      relativePath,
      url: savedUrl,
      fileName: unique.fileName,
      savedAt: new Date().toISOString(),
      username: opts.username ?? null,
      videosRoot,
    };

    upsertDownloadedRecord(record);

    broadcastProgress({
      imageId,
      receivedBytes,
      totalBytes,
      done: true,
      phase: 'done',
      queuedCount: queuedCount(),
      fileName: unique.fileName,
      statusMessage: unique.renamed
        ? `Saved as ${unique.fileName}`
        : `Saved ${unique.fileName}`,
    });

    appendDownloadLog('info', `Saved Civitai video ${imageId} → ${relativePath}`, {
      source: 'download',
    });

    return {
      saved: { ...record, absolutePath: unique.absolutePath },
      renamed: unique.renamed,
    };
  } catch (err) {
    if (fs.existsSync(temp)) {
      try {
        fs.unlinkSync(temp);
      } catch {
        // ignore
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof CivitaiMediaTypeMismatchError) {
      broadcastProgress({
        imageId,
        receivedBytes: 0,
        totalBytes: null,
        done: true,
        phase: 'done',
        queuedCount: queuedCount(),
        error: message,
      });
      throw err;
    }
    logDownloadError('Civitai video download failed', err, {
      source: 'download',
    });
    broadcastProgress({
      imageId,
      receivedBytes: 0,
      totalBytes: null,
      done: true,
      phase: 'done',
      queuedCount: queuedCount(),
      error: message,
    });
    throw new Error(message || formatErrorDetail(err));
  }
}

export async function openDownloadedCivitaiVideo(
  absolutePath: string,
): Promise<void> {
  const resolved = path.resolve(absolutePath);
  const currentRoot = loadSettings().videosFolder?.trim();
  const allowedRoots = new Set<string>();
  if (currentRoot) allowedRoots.add(path.resolve(currentRoot));
  for (const row of listRegistryRecords()) {
    if (row.videosRoot?.trim()) {
      allowedRoots.add(path.resolve(row.videosRoot.trim()));
    }
  }

  const insideAllowed = [...allowedRoots].some((root) =>
    isPathInsideRoot(resolved, root),
  );
  if (!insideAllowed) {
    throw new Error('Path is outside known images folders');
  }
  if (!fs.existsSync(resolved)) {
    throw new Error('Video file no longer exists');
  }
  const error = await shell.openPath(resolved);
  if (error) throw new Error(`Could not open image: ${error}`);
}
