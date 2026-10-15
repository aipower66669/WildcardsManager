/**
 * Checkpoint “master” preview — now sourced from Checkpoint Benchmark output
 * (`{benchmarkRoot}/{stem}/WCG*`), not the legacy masters/collage folder.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  BENCHMARK_IMAGES_PER_CHECKPOINT,
  checkpointBenchmarkStem,
  isBenchmarkOutputImageName,
} from '../domain/checkpointBenchmark.js';
import { pickBenchmarkPreviewImages } from '../domain/checkpointBenchmarkPreview.js';
import { pickMasterAndGens } from '../domain/checkpointMasterPick.js';
import { masterImagesJsonPath } from '../domain/librarySidecarPaths.js';
import { normalizeAutoV2 } from '../domain/modelHash.js';
import { atomicWriteFile, readJsonFile } from './librarySidecarIo.js';
import { getActiveLibrary } from './settingsStore.js';

export { pickMasterAndGens, pickBenchmarkPreviewImages };

export type CheckpointMasterImages = {
  masterAbsolutePath: string;
  genAbsolutePaths: string[];
  /** Benchmark output root that produced these paths. */
  mastersFolder: string;
  resolvedAt: string;
};

type StoreFile = {
  version: 1;
  byPath: Record<string, CheckpointMasterImages>;
  byAutoV2: Record<string, CheckpointMasterImages>;
};

const STORE_VERSION = 1 as const;

function storePath(): string | null {
  const root = getActiveLibrary().checkpointFolder;
  if (!root?.trim()) return null;
  return masterImagesJsonPath(root);
}

function pathKey(absolutePath: string): string {
  return path.resolve(absolutePath).toLowerCase();
}

function emptyStore(): StoreFile {
  return { version: STORE_VERSION, byPath: {}, byAutoV2: {} };
}

function loadStore(): StoreFile {
  const file = storePath();
  if (!file) return emptyStore();
  const raw = readJsonFile<StoreFile>(file);
  if (!raw || raw.version !== STORE_VERSION) return emptyStore();
  return {
    version: STORE_VERSION,
    byPath: raw.byPath && typeof raw.byPath === 'object' ? raw.byPath : {},
    byAutoV2:
      raw.byAutoV2 && typeof raw.byAutoV2 === 'object' ? raw.byAutoV2 : {},
  };
}

function saveStore(store: StoreFile): void {
  const file = storePath();
  if (!file) return;
  atomicWriteFile(file, `${JSON.stringify(store)}\n`);
}

function isUnderRoot(absolutePath: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(absolutePath));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel)
    ? true
    : path.resolve(absolutePath) === path.resolve(root);
}

/** Quarantine folder under the benchmark root (checkpoint delete moves here). */
export const MASTERS_DELETED_FOLDER = '!Deleted';

function benchmarkRoot(): string | null {
  const root = getActiveLibrary().benchmarkOutputFolder?.trim();
  return root ? path.resolve(root) : null;
}

/** Stem folder name for a checkpoint file / relative stem. */
export function benchmarkStemForCheckpoint(stemOrPath: string): string {
  return checkpointBenchmarkStem(stemOrPath);
}

/**
 * WCG* images under `{benchmarkRoot}/{stem}/` (shallow — not a full tree walk).
 */
export function findBenchmarkImagesByStem(
  benchmarkFolder: string,
  stem: string,
): Array<{ absolutePath: string; size: number; mtimeMs: number }> {
  const folderStem = benchmarkStemForCheckpoint(stem);
  if (!folderStem || !benchmarkFolder) return [];
  const dir = path.join(path.resolve(benchmarkFolder), folderStem);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];

  const hits: Array<{ absolutePath: string; size: number; mtimeMs: number }> =
    [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    // Prefer WCG* Generation outputs; fall back to any image in the stem folder.
    if (
      !isBenchmarkOutputImageName(entry.name) &&
      !IMAGE_EXT.test(entry.name)
    ) {
      continue;
    }
    const abs = path.join(dir, entry.name);
    try {
      const st = fs.statSync(abs);
      if (st.isFile() && st.size > 0) {
        hits.push({
          absolutePath: abs,
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      }
    } catch {
      // ignore
    }
  }
  // If both WCG* and other images exist, keep WCG* only (cleaner gist).
  const wcgOnly = hits.filter((h) =>
    isBenchmarkOutputImageName(path.basename(h.absolutePath)),
  );
  return wcgOnly.length > 0 ? wcgOnly : hits;
}

/**
 * @deprecated Legacy masters-folder walk. Prefer findBenchmarkImagesByStem.
 * Kept for tests / one-off recovery of old collage JPGs.
 */
export function findJpgMatchesByStem(
  mastersFolder: string,
  stem: string,
): Array<{ absolutePath: string; size: number }> {
  const needle = stem.trim().toLowerCase();
  if (!needle || !mastersFolder) return [];
  const root = path.resolve(mastersFolder);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];

  const hits: Array<{ absolutePath: string; size: number }> = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === MASTERS_DELETED_FOLDER && path.resolve(dir) === root) {
          continue;
        }
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== '.jpg') continue;
      const base = path.basename(entry.name, path.extname(entry.name));
      if (base.toLowerCase() !== needle) continue;
      try {
        const st = fs.statSync(abs);
        if (st.isFile() && st.size > 0) {
          hits.push({ absolutePath: abs, size: st.size });
        }
      } catch {
        // ignore
      }
    }
  };
  walk(root);
  return hits;
}

function cacheStillValid(
  cached: CheckpointMasterImages,
  root: string,
  stem: string,
): boolean {
  if (path.resolve(cached.mastersFolder) !== path.resolve(root)) {
    return false;
  }
  if (!fs.existsSync(cached.masterAbsolutePath)) return false;
  for (const gen of cached.genAbsolutePaths) {
    if (!fs.existsSync(gen)) return false;
  }
  // Refresh when Benchmark adds/removes samples under the stem folder.
  const onDisk = findBenchmarkImagesByStem(root, stem).length;
  const shown = Math.min(onDisk, BENCHMARK_IMAGES_PER_CHECKPOINT);
  const cachedCount = 1 + cached.genAbsolutePaths.length;
  return shown === cachedCount;
}

export function clearCheckpointMasterCache(opts: {
  absolutePath: string;
  autoV2?: string | null;
}): void {
  const store = loadStore();
  delete store.byPath[pathKey(opts.absolutePath)];
  const hash = normalizeAutoV2(opts.autoV2 ?? undefined);
  if (hash) delete store.byAutoV2[hash];
  saveStore(store);
}

/**
 * Resolve (or reuse cached) benchmark sample images for a checkpoint stem.
 */
export function resolveCheckpointMasterImages(opts: {
  checkpointAbsolutePath: string;
  stem: string;
  autoV2?: string | null;
  /** Force a disk walk even if cache looks valid. */
  force?: boolean;
}): CheckpointMasterImages | null {
  const root = benchmarkRoot();
  if (!root) return null;

  const store = loadStore();
  const hash = normalizeAutoV2(opts.autoV2 ?? undefined);
  const key = pathKey(opts.checkpointAbsolutePath);
  const cached =
    (hash ? store.byAutoV2[hash] : undefined) ?? store.byPath[key] ?? null;

  if (!opts.force && cached && cacheStillValid(cached, root, opts.stem)) {
    return cached;
  }

  const hits = findBenchmarkImagesByStem(root, opts.stem);
  const picked = pickBenchmarkPreviewImages(
    hits,
    BENCHMARK_IMAGES_PER_CHECKPOINT,
  );
  if (!picked) {
    clearCheckpointMasterCache({
      absolutePath: opts.checkpointAbsolutePath,
      autoV2: opts.autoV2,
    });
    return null;
  }

  const entry: CheckpointMasterImages = {
    masterAbsolutePath: picked.masterAbsolutePath,
    genAbsolutePaths: picked.genAbsolutePaths,
    mastersFolder: root,
    resolvedAt: new Date().toISOString(),
  };
  store.byPath[key] = entry;
  if (hash) store.byAutoV2[hash] = entry;
  saveStore(store);
  return entry;
}

/** True when path is under the configured Checkpoint Benchmark folder. */
export function isMastersFolderPath(absolutePath: string): boolean {
  const root = benchmarkRoot();
  if (!root) return false;
  return isUnderRoot(absolutePath, root);
}

export function readMastersImageDataUrl(absolutePath: string): string | null {
  const resolved = path.resolve(absolutePath);
  if (!isMastersFolderPath(resolved)) return null;
  try {
    const st = fs.statSync(resolved);
    if (!st.isFile() || st.size <= 0 || st.size > 40 * 1024 * 1024) return null;
    const ext = path.extname(resolved).toLowerCase();
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : null;
    if (!mime) return null;
    const buf = fs.readFileSync(resolved);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
