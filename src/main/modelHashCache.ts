/**
 * Local model AutoV2 resolution — persisted on each file as NTFS ADS `AUTOV2`
 * (not in models.json). Session map + ADS reads for the browse hot path;
 * worker SHA-256 only when ADS / sidecar are missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeAutoV2,
  parseAutoV2FromHashSidecarText,
} from '../domain/modelHash.js';
import type { LoraFileEntry, LoraIndex } from '../domain/lora.js';
import {
  copyAutoV2Ads,
  deleteAutoV2Ads,
  getSessionAutoV2,
  moveSessionAutoV2,
  readAutoV2Ads,
  sessionAutoV2Count,
  writeAutoV2Ads,
} from './modelAutoV2Ads.js';
import { computeFileAutoV2InWorker } from './modelHashWorkerClient.js';

function cacheKey(absolutePath: string): string {
  return path.resolve(absolutePath).toLowerCase();
}

/** No-op: hashes live on the file (ADS), not a JSON catalog. */
export function flushHashCachePersist(): void {
  /* intentionally empty */
}

/**
 * Read AutoV2 from a same-stem `.txt` hash sidecar (`ModelName.txt` next to
 * `ModelName.safetensors` — not `ModelName.safetensors.txt`).
 */
export function readAutoV2FromSiblingHashTxt(
  modelAbsolutePath: string,
): string | null {
  const dir = path.dirname(modelAbsolutePath);
  const stem = path.basename(modelAbsolutePath, path.extname(modelAbsolutePath));
  const abs = path.join(dir, `${stem}.txt`);
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    const st = fs.statSync(abs);
    if (st.size <= 0 || st.size > 256 * 1024) return null;
    const text = fs.readFileSync(abs, 'utf8');
    return parseAutoV2FromHashSidecarText(text);
  } catch {
    return null;
  }
}

/**
 * After an app rename/move: ADS usually follows on the same NTFS volume;
 * copy stream + session key when needed.
 */
export function moveCachedFileEntry(
  oldAbsolutePath: string,
  newAbsolutePath: string,
): boolean {
  moveSessionAutoV2(oldAbsolutePath, newAbsolutePath);
  if (readAutoV2Ads(newAbsolutePath)) return true;
  return copyAutoV2Ads(oldAbsolutePath, newAbsolutePath);
}

/** Drop AUTOV2 ADS when a model file is deleted from disk. */
export function removeCachedFileEntry(absolutePath: string): boolean {
  return deleteAutoV2Ads(absolutePath);
}

/**
 * Store a known AutoV2 on the file (Civitai download metadata) — writes ADS,
 * no content hashing.
 */
export function seedCachedFileAutoV2(
  absolutePath: string,
  autoV2Raw: string | null | undefined,
): boolean {
  const autoV2 = normalizeAutoV2(autoV2Raw);
  if (!autoV2) return false;
  try {
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      return false;
    }
  } catch {
    return false;
  }
  return writeAutoV2Ads(absolutePath, autoV2);
}

/**
 * Hash the whole file and return Civitai AutoV2 (SHA-256 prefix).
 * Runs on a worker; result is also written to AUTOV2 ADS by the worker.
 */
export async function computeFileAutoV2(
  absolutePath: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const result = await computeFileAutoV2InWorker(absolutePath, signal);
    const autoV2 = normalizeAutoV2(result.autoV2);
    if (autoV2) writeAutoV2Ads(absolutePath, autoV2);
    return autoV2;
  } catch {
    return null;
  }
}

/**
 * Resolve AutoV2 for a local model file. Prefer AUTOV2 ADS (and session);
 * only hash when missing. Worker also stamps ADS.
 */
export async function getCachedFileAutoV2(
  absolutePath: string,
  _cache?: unknown,
  signal?: AbortSignal,
): Promise<string | null> {
  const existing = readAutoV2Ads(absolutePath);
  if (existing) return existing;

  const fromSidecar = readAutoV2FromSiblingHashTxt(absolutePath);
  if (fromSidecar) {
    writeAutoV2Ads(absolutePath, fromSidecar);
    return fromSidecar;
  }

  const result = await computeFileAutoV2InWorker(absolutePath, signal);
  const autoV2 = normalizeAutoV2(result.autoV2);
  if (!autoV2) return null;
  writeAutoV2Ads(absolutePath, autoV2);
  return autoV2;
}

/**
 * Attach AutoV2 already on the index row or in the process session map.
 * Does not open AUTOV2 ADS — that froze the UI on thousands of weights.
 */
export function attachCachedAutoV2Hashes(index: LoraIndex): LoraIndex {
  const byAutoV2 = new Map<string, string>();
  for (const file of index.files) {
    let autoV2 = normalizeAutoV2(file.autoV2);
    if (!autoV2) autoV2 = getSessionAutoV2(file.absolutePath);
    if (!autoV2) continue;
    file.autoV2 = autoV2;
    if (!byAutoV2.has(autoV2)) byAutoV2.set(autoV2, file.absolutePath);
  }
  index.byAutoV2 = byAutoV2;
  return index;
}

/** Attach AutoV2 for one file without rebuilding the whole map. */
export function attachCachedAutoV2HashForFile(
  index: LoraIndex,
  file: { absolutePath: string; autoV2?: string },
): void {
  let autoV2 = normalizeAutoV2(file.autoV2);
  if (!autoV2) autoV2 = readAutoV2Ads(file.absolutePath);
  if (!autoV2) return;
  file.autoV2 = autoV2;
  if (!index.byAutoV2) index.byAutoV2 = new Map();
  if (!index.byAutoV2.has(autoV2)) {
    index.byAutoV2.set(autoV2, file.absolutePath);
  }
}

export function countCachedHashEntries(): number {
  return sessionAutoV2Count();
}

/** True when every index file already has an in-memory / session AutoV2. */
export function indexFullyHashCached(index: LoraIndex): boolean {
  if (index.files.length === 0) return true;
  for (const file of index.files) {
    if (normalizeAutoV2(file.autoV2)) continue;
    if (getSessionAutoV2(file.absolutePath)) continue;
    return false;
  }
  return true;
}

export type HashWarmProgress = {
  done: number;
  total: number;
  hashedThisRun: number;
  cachedTotal: number;
  /** Files still without a cache entry (includes the one currently hashing). */
  missing: number;
  currentStem?: string;
};

/**
 * Hash any index files missing AUTOV2 ADS. SHA-256 runs on a worker thread.
 */
export async function warmIndexAutoV2Hashes(
  index: LoraIndex,
  options?: {
    shouldCancel?: () => boolean;
    signal?: AbortSignal;
    onProgress?: (progress: HashWarmProgress) => void;
    saveEvery?: number;
  },
): Promise<HashWarmProgress & { failedThisRun: number; hashedAutoV2s: string[] }> {
  void options?.saveEvery;
  const total = index.files.length;
  let done = 0;
  let hashedThisRun = 0;
  const hashedAutoV2s: string[] = [];
  let failedThisRun = 0;
  let cachedTotal = 0;
  let lastReportAt = 0;
  let currentStem: string | undefined;
  const cancelled = () =>
    Boolean(options?.shouldCancel?.() || options?.signal?.aborted);

  const countMissing = () => {
    let n = 0;
    for (const file of index.files) {
      if (normalizeAutoV2(file.autoV2)) continue;
      if (getSessionAutoV2(file.absolutePath)) continue;
      n += 1;
    }
    return n;
  };

  // One ADS open per turn. A batch of opens on this thread freezes the
  // editor window, not only Civitai.
  for (const file of index.files) {
    if (normalizeAutoV2(file.autoV2)) {
      cachedTotal += 1;
      continue;
    }
    if (readAutoV2Ads(file.absolutePath)) {
      cachedTotal += 1;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  const report = (force = false) => {
    const now = Date.now();
    if (
      !force &&
      done !== total &&
      done % 25 !== 0 &&
      now - lastReportAt < 1500
    ) {
      return;
    }
    lastReportAt = now;
    options?.onProgress?.({
      done,
      total,
      hashedThisRun,
      cachedTotal,
      missing: countMissing(),
      currentStem,
    });
  };

  report(true);

  for (const file of index.files) {
    if (cancelled()) break;
    const already =
      normalizeAutoV2(file.autoV2) ?? readAutoV2Ads(file.absolutePath);
    if (already) {
      file.autoV2 = already;
      done += 1;
      report();
      await new Promise<void>((resolve) => setImmediate(resolve));
      continue;
    }

    currentStem = file.stem;
    report(true);

    const autoV2 = await getCachedFileAutoV2(
      file.absolutePath,
      undefined,
      options?.signal,
    );
    if (cancelled()) break;
    if (autoV2) {
      file.autoV2 = autoV2;
      hashedThisRun += 1;
      hashedAutoV2s.push(autoV2);
      cachedTotal += 1;
    } else {
      failedThisRun += 1;
      console.warn(`[hash] failed to compute AutoV2 for ${file.absolutePath}`);
    }
    done += 1;
    currentStem = undefined;
    report(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  attachCachedAutoV2Hashes(index);

  const result = {
    done,
    total,
    hashedThisRun,
    hashedAutoV2s,
    cachedTotal,
    missing: countMissing(),
    failedThisRun,
  };
  options?.onProgress?.(result);
  return result;
}

/** Attach AutoV2 hashes to every file in an index (cached where possible). */
export async function ensureIndexAutoV2Hashes(
  index: LoraIndex,
): Promise<LoraIndex> {
  await warmIndexAutoV2Hashes(index);
  return index;
}

export function indexHasAutoV2(
  index: LoraIndex | null,
  autoV2: string | null | undefined,
): boolean {
  const key = normalizeAutoV2(autoV2);
  if (!index?.byAutoV2 || !key) return false;
  return index.byAutoV2.has(key);
}

export type { LoraFileEntry };

/** @deprecated path helper kept for tests / tooling */
export function _cacheKeyForTests(absolutePath: string): string {
  return cacheKey(absolutePath);
}
