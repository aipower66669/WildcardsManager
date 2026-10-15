import fs from 'node:fs';
import path from 'node:path';
import { app, clipboard, protocol, net } from 'electron';
import { pathToFileURL } from 'node:url';
import {
  PREVIEW_FULL_TAG,
  PREVIEW_MAX_HEIGHT,
  PREVIEW_MAX_WIDTH,
  PREVIEW_PROTOCOL,
  PREVIEW_SIZE_TAG,
  civitaiPreviewFileName,
  civitaiPreviewFullFileName,
  civitaiSizedPreviewUrl,
  customCivitaiPreviewFileName,
  hashCivitaiPreviewUrl,
  localCivitaiPreviewUrl,
} from '../shared/civitaiPreviewUrl.js';
import { thumbnailsDir } from '../domain/librarySidecarPaths.js';
import { createIntervalPacer } from './asyncPace.js';
import { downscalePreviewCover } from './previewDownscaleCompute.js';
import { downscalePreviewOffMain } from './previewDownscaleClient.js';
import { getActiveLibrary, getCivitaiOrigin } from './settingsStore.js';

export { PREVIEW_PROTOCOL, localCivitaiPreviewUrl };

const JPEG_QUALITY = 82;
/**
 * CDN fetch width for thumb generation + archived `full-*.jpg`.
 * Catalog cards use the cover-cropped `w512-*.jpg` only — fetching 4K and
 * decoding it on main previously froze the UI during preview warm.
 */
const PREVIEW_FETCH_WIDTH = 1024;
/** Reject absurd CDN payloads before decoding. */
const PREVIEW_MAX_BYTES = 4 * 1024 * 1024;
/**
 * v5: keep untouched CDN bytes as `full-{hash}.jpg`; catalog serves existing
 * `w512-` cover thumbs (same 512×768 policy as before).
 */
const CACHE_VERSION = 5;

const inflight = new Map<string, Promise<string | null>>();
let migrationDone = false;

/**
 * Downloading + `nativeImage` resize is CPU-heavy and holds large bitmaps in
 * the main process. Cap concurrency hard — overnight warm previously OOMed
 * (~1GB V8 heap) when decoding big sources repeatedly.
 */
const MAX_CONCURRENT_DOWNLOADS = 1;
/** Minimum gap between starting preview CDN fetches. */
const PREVIEW_FETCH_GAP_MS = 500;
const PREVIEW_MAX_RETRIES = 5;
let activeDownloads = 0;
const downloadQueue: Array<() => void> = [];
const pacePreviewFetch = createIntervalPacer(PREVIEW_FETCH_GAP_MS);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function acquireDownloadSlot(): Promise<void> {
  if (activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
    activeDownloads += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    downloadQueue.push(() => {
      activeDownloads += 1;
      resolve();
    });
  });
}

function releaseDownloadSlot(): void {
  activeDownloads -= 1;
  const next = downloadQueue.shift();
  if (next) next();
}

function configuredThumbnailDirs(): string[] {
  const lib = getActiveLibrary();
  const dirs: string[] = [];
  if (lib.loraFolder?.trim()) dirs.push(thumbnailsDir(lib.loraFolder));
  if (lib.checkpointFolder?.trim()) {
    dirs.push(thumbnailsDir(lib.checkpointFolder));
  }
  return dirs;
}

/**
 * Primary write dir. Prefer LoRA thumbs (most browse traffic); fall back to
 * checkpoint; unbound AppData only when no model roots are configured.
 */
function cacheDir(
  type?: 'LORA' | 'Checkpoint' | null,
): string {
  const lib = getActiveLibrary();
  if (type === 'Checkpoint' && lib.checkpointFolder?.trim()) {
    return thumbnailsDir(lib.checkpointFolder);
  }
  if (lib.loraFolder?.trim()) return thumbnailsDir(lib.loraFolder);
  if (lib.checkpointFolder?.trim()) {
    return thumbnailsDir(lib.checkpointFolder);
  }
  return path.join(app.getPath('userData'), 'civitai-preview-cache-unbound');
}

function ensureCacheDir(type?: 'LORA' | 'Checkpoint' | null): string {
  const dir = cacheDir(type);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Positive + negative hits so `wcm-preview://` does not stat on every card. */
const previewFileAbsByName = new Map<string, string>();
const previewFileMissing = new Set<string>();
let previewFileLookupDirsKey = '';

function rememberCachedPreviewFile(fileName: string, abs: string): void {
  previewFileAbsByName.set(fileName, abs);
  previewFileMissing.delete(fileName);
}

function invalidatePreviewFileLookup(fileName?: string): void {
  if (fileName) {
    previewFileAbsByName.delete(fileName);
    previewFileMissing.delete(fileName);
    return;
  }
  previewFileAbsByName.clear();
  previewFileMissing.clear();
}

function findCachedFile(fileName: string): string | null {
  const dirsKey = configuredThumbnailDirs().join('|');
  if (dirsKey !== previewFileLookupDirsKey) {
    previewFileLookupDirsKey = dirsKey;
    invalidatePreviewFileLookup();
  }
  const cached = previewFileAbsByName.get(fileName);
  if (cached) return cached;
  if (previewFileMissing.has(fileName)) return null;

  for (const dir of configuredThumbnailDirs()) {
    const abs = path.join(dir, fileName);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        rememberCachedPreviewFile(fileName, abs);
        return abs;
      }
    } catch {
      // try next
    }
  }
  const unbound = path.join(
    app.getPath('userData'),
    'civitai-preview-cache-unbound',
    fileName,
  );
  try {
    if (fs.existsSync(unbound) && fs.statSync(unbound).isFile()) {
      rememberCachedPreviewFile(fileName, unbound);
      return unbound;
    }
  } catch {
    // ignore
  }
  previewFileMissing.add(fileName);
  return null;
}

function versionPath(): string {
  return path.join(ensureCacheDir(), '.cache-version');
}

function protocolUrlForFile(fileName: string): string {
  return `${PREVIEW_PROTOCOL}://local/${encodeURIComponent(fileName)}`;
}

/** Older size-tagged filenames we still accept as a catalog hit (never deleted). */
const LEGACY_SIZE_TAGS = ['w360', 'r360', 'w450', 'w480', 'w640'] as const;

async function writeThumbFromBuffer(
  buffer: Buffer,
  thumbAbs: string,
): Promise<boolean> {
  // Cover-crop on a dedicated Electron child — never decode 1K+ JPEGs on main.
  const thumb = await downscalePreviewOffMain(buffer);
  if (!thumb) return false;
  const temp = `${thumbAbs}.partial`;
  try {
    fs.writeFileSync(temp, thumb);
    try {
      if (fs.existsSync(thumbAbs)) fs.unlinkSync(thumbAbs);
    } catch {
      // ignore
    }
    fs.renameSync(temp, thumbAbs);
    rememberCachedPreviewFile(path.basename(thumbAbs), thumbAbs);
    return true;
  } catch {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // ignore
    }
    return false;
  }
}

/**
 * Cache policy bump only — **never deletes** existing preview files.
 * Older installs may only have cover-crops (`w512-` / `w360-`, …) with no
 * original; those stay put. New downloads write `full-*.jpg` + `w512-*.jpg`.
 */
export function migratePreviewCache(): { removed: number; converted: number } {
  let currentVersion = 0;
  try {
    currentVersion = Number(fs.readFileSync(versionPath(), 'utf8').trim());
  } catch {
    currentVersion = 0;
  }

  if (currentVersion >= CACHE_VERSION) {
    migrationDone = true;
    return { removed: 0, converted: 0 };
  }

  try {
    fs.writeFileSync(versionPath(), `${CACHE_VERSION}\n`, 'utf8');
  } catch {
    // ignore
  }
  migrationDone = true;
  return { removed: 0, converted: 0 };
}

function ensureMigrated(): void {
  if (migrationDone) return;
  try {
    const ver = Number(fs.readFileSync(versionPath(), 'utf8').trim());
    if (ver >= CACHE_VERSION) {
      migrationDone = true;
      return;
    }
  } catch {
    // migrate below
  }
  migratePreviewCache();
}

function findExistingByUrl(url: string): string | null {
  const fileName = civitaiPreviewFileName(url);
  if (findCachedFile(fileName)) return protocolUrlForFile(fileName);

  // Serve older size-tagged files so a policy bump never forces a mass re-fetch.
  const hash = hashCivitaiPreviewUrl(url);
  for (const tag of LEGACY_SIZE_TAGS) {
    const legacyName = `${tag}-${hash}.jpg`;
    if (findCachedFile(legacyName)) return protocolUrlForFile(legacyName);
  }
  return null;
}

/** True when a catalog thumb JPEG already exists on disk for this remote URL. */
export function hasCachedCivitaiPreview(url: string): boolean {
  ensureMigrated();
  return findExistingByUrl(url) !== null;
}

/**
 * One-shot directory index of cached catalog thumb filenames.
 * Includes current `w512-` names and synthesizes those keys for older size
 * tags so coverage does not re-download existing previews. Excludes `full-`.
 */
export function listCachedPreviewFileNameSet(): Set<string> {
  ensureMigrated();
  const set = new Set<string>();
  const dirs = [
    ...configuredThumbnailDirs(),
    path.join(app.getPath('userData'), 'civitai-preview-cache-unbound'),
  ];
  const legacyTagRe = /^(?:w\d+|r\d+)-([a-f0-9]{40})\.jpe?g$/i;
  for (const dir of dirs) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.jpg') && !name.endsWith('.jpeg')) continue;
        if (name.startsWith('custom-')) continue;
        if (name.startsWith(`${PREVIEW_FULL_TAG}-`)) continue;
        if (name.endsWith('.partial')) continue;
        set.add(name);
        // Coverage checks the current w512 key — alias legacy size tags to it.
        const m = legacyTagRe.exec(name);
        if (m && !name.startsWith(`${PREVIEW_SIZE_TAG}-`)) {
          set.add(`${PREVIEW_SIZE_TAG}-${m[1]!.toLowerCase()}.jpg`);
        }
      }
    } catch {
      // empty / missing dir
    }
  }
  return set;
}

export function cachedPreviewFileNameForUrl(url: string): string {
  return civitaiPreviewFileName(url.trim());
}

async function downloadPreview(
  url: string,
  options?: { force?: boolean },
): Promise<string | null> {
  ensureMigrated();
  const thumbName = civitaiPreviewFileName(url);
  const fullName = civitaiPreviewFullFileName(url);
  if (!options?.force) {
    const existing = findExistingByUrl(url);
    if (existing) return existing;
  }

  try {
    const fetchUrl = civitaiSizedPreviewUrl(url, PREVIEW_FETCH_WIDTH);
    let response: Response | null = null;
    let backoffMs = 1000;
    for (let attempt = 0; attempt < PREVIEW_MAX_RETRIES; attempt += 1) {
      await pacePreviewFetch();
      response = await fetch(fetchUrl, {
        headers: { Accept: 'image/jpeg,image/png,image/*;q=0.5' },
        redirect: 'follow',
      });
      if (response.ok) break;
      if (response.status === 429 || response.status >= 500) {
        await sleep(backoffMs);
        backoffMs = Math.min(30_000, backoffMs * 2);
        response = null;
        continue;
      }
      return null;
    }
    if (!response?.ok) return null;

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > PREVIEW_MAX_BYTES) return null;

    const ab = await response.arrayBuffer();
    if (ab.byteLength === 0 || ab.byteLength > PREVIEW_MAX_BYTES) return null;

    let raw: Buffer | null = Buffer.from(ab);
    const dir = ensureCacheDir();

    // Keep the CDN bytes untouched for reuse / refresh; catalog never loads this.
    const fullDest = path.join(dir, fullName);
    const fullTemp = `${fullDest}.partial`;
    fs.writeFileSync(fullTemp, raw);
    try {
      if (fs.existsSync(fullDest)) fs.unlinkSync(fullDest);
    } catch {
      // ignore
    }
    fs.renameSync(fullTemp, fullDest);

    const thumbDest = path.join(dir, thumbName);
    if (!(await writeThumbFromBuffer(raw, thumbDest))) {
      raw = null;
      return null;
    }
    raw = null;
    return protocolUrlForFile(thumbName);
  } catch {
    try {
      const dir = ensureCacheDir();
      for (const name of [`${thumbName}.partial`, `${fullName}.partial`]) {
        const temp = path.join(dir, name);
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
      }
    } catch {
      // ignore
    }
    return null;
  }
}

/** Return a cached local preview URL (`wcm-preview://…`), downloading once if needed. */
export function cacheCivitaiPreview(url: string): Promise<string | null> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return Promise.resolve(null);

  const existing = findExistingByUrl(trimmed);
  if (existing) return Promise.resolve(existing);

  const pending = inflight.get(trimmed);
  if (pending) return pending;

  const job = (async () => {
    await acquireDownloadSlot();
    try {
      const cached = findExistingByUrl(trimmed);
      if (cached) return cached;
      return await downloadPreview(trimmed);
    } finally {
      releaseDownloadSlot();
    }
  })().finally(() => {
    inflight.delete(trimmed);
  });
  inflight.set(trimmed, job);
  return job;
}

/**
 * Delete any cached file for this preview URL and download again.
 * Use when a cached image is corrupt or blank.
 */
export function refreshCivitaiPreview(url: string): Promise<string | null> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return Promise.resolve(null);

  const key = `refresh:${trimmed}`;
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = downloadPreview(trimmed, { force: true }).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, job);
  return job;
}

let previewWarmGeneration = 0;

export type PreviewWarmProgress = {
  status: 'caching' | 'done' | 'cancelled' | 'error';
  done: number;
  total: number;
  fetchedThisRun: number;
  error?: string;
};

/**
 * Walk preview URLs, downloading cache misses. Skips files already on disk.
 * Cancels any previous warm when called again. Single-flight downloads to keep
 * main-process memory flat overnight.
 */
export async function warmCivitaiPreviews(
  urls: string[],
  onProgress?: (progress: PreviewWarmProgress) => void,
): Promise<PreviewWarmProgress> {
  const generation = ++previewWarmGeneration;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    if (typeof raw !== 'string') continue;
    const url = raw.trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
  }

  const total = unique.length;
  let done = 0;
  let fetchedThisRun = 0;
  let lastReportAt = 0;

  const report = (status: PreviewWarmProgress['status'], error?: string) => {
    const payload: PreviewWarmProgress = {
      status,
      done,
      total,
      fetchedThisRun,
      error,
    };
    onProgress?.(payload);
    lastReportAt = Date.now();
    return payload;
  };

  const maybeReport = () => {
    if (
      done === total ||
      done % 25 === 0 ||
      Date.now() - lastReportAt > 2000
    ) {
      report('caching');
    }
  };

  if (total === 0) return report('done');
  report('caching');

  try {
    const misses: string[] = [];
    for (const url of unique) {
      if (generation !== previewWarmGeneration) {
        return report('cancelled');
      }
      if (findExistingByUrl(url)) {
        done += 1;
      } else {
        misses.push(url);
      }
      if (done % 200 === 0) {
        maybeReport();
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    maybeReport();

    for (let i = 0; i < misses.length; i += 1) {
      if (generation !== previewWarmGeneration) {
        return report('cancelled');
      }
      const url = misses[i]!;
      await cacheCivitaiPreview(url);
      if (findExistingByUrl(url)) fetchedThisRun += 1;
      done += 1;
      maybeReport();
      // Let V8 / Electron reclaim nativeImage bitmaps between files.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    if (generation !== previewWarmGeneration) {
      return report('cancelled');
    }
    return report('done');
  } catch (e) {
    return report('error', e instanceof Error ? e.message : String(e));
  }
}

export function cancelCivitaiPreviewWarm(): void {
  previewWarmGeneration += 1;
}

function customPreviewFileName(modelId: number): string {
  return customCivitaiPreviewFileName(getCivitaiOrigin(), modelId);
}

/**
 * In-memory set of existing custom-preview filenames. Custom previews are rare,
 * so instead of an `existsSync`+`statSync` per card on every slice load we read
 * the directory once and answer from memory. Invalidated when one is saved.
 */
let customPreviewNames: Set<string> | null = null;

function customPreviewNameSet(): Set<string> {
  if (customPreviewNames) return customPreviewNames;
  const set = new Set<string>();
  const dirs = [
    ...configuredThumbnailDirs(),
    path.join(app.getPath('userData'), 'civitai-preview-cache-unbound'),
  ];
  for (const dir of dirs) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('custom-')) set.add(name);
      }
    } catch {
      // no cache dir yet
    }
  }
  customPreviewNames = set;
  return set;
}

function invalidateCustomPreviewNames(): void {
  customPreviewNames = null;
}

/** Local override preview for a model (clipboard / user-provided). */
export function getCustomCivitaiPreview(modelId: number): string | null {
  ensureMigrated();
  const id = Math.round(modelId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const fileName = customPreviewFileName(id);
  return customPreviewNameSet().has(fileName)
    ? protocolUrlForFile(fileName)
    : null;
}

/**
 * Save the current clipboard image as this model's preview (downscaled JPEG).
 * Returns the local `wcm-preview://` URL, or null if the clipboard has no image.
 */
export function saveCustomCivitaiPreviewFromClipboard(
  modelId: number,
): string | null {
  ensureMigrated();
  const id = Math.round(modelId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const image = clipboard.readImage();
  if (image.isEmpty()) return null;

  const png = image.toPNG();
  // Rare user action — sync cover-crop on main is fine (clipboard is small).
  const resized = downscalePreviewCover(
    Buffer.from(png),
    PREVIEW_MAX_WIDTH,
    PREVIEW_MAX_HEIGHT,
    JPEG_QUALITY,
  );
  if (!resized) return null;

  const fileName = customPreviewFileName(id);
  const dest = path.join(ensureCacheDir(), fileName);
  const temp = `${dest}.partial`;
  fs.writeFileSync(temp, resized);
  try {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  } catch {
    // ignore
  }
  fs.renameSync(temp, dest);
  invalidateCustomPreviewNames();
  rememberCachedPreviewFile(fileName, dest);
  return protocolUrlForFile(fileName);
}

/** Must be called before app ready. */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PREVIEW_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/** Must be called after app ready. */
export function registerPreviewProtocolHandler(): void {
  migratePreviewCache();
  protocol.handle(PREVIEW_PROTOCOL, (request) => {
    try {
      const parsed = new URL(request.url);
      const fileName = decodeURIComponent(
        parsed.pathname.replace(/^\/+/, '') || parsed.hostname,
      );
      if (
        !fileName ||
        fileName.includes('..') ||
        fileName.includes('/') ||
        fileName.includes('\\')
      ) {
        return new Response('Not found', { status: 404 });
      }
      const abs = findCachedFile(fileName);
      if (!abs) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(abs).href);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
}
