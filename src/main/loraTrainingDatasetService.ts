import fs from 'node:fs';
import path from 'node:path';
import {
  cachedSeriesDatasetLink,
  seriesDatasetHitEntry,
  seriesDatasetNotFoundEntry,
  type SeriesDatasetCacheEntry,
} from '../domain/loraSeriesDatasetCache.js';
import {
  isDatasetImageFileName,
  loraSeriesDatasetKey,
  orderOutputSetFolders,
  parseDatasetPreviewRelativePath,
  parseDatasetValidationSets,
  pickFirstDatasetImageFileName,
  safetensorsFileMatchesSeries,
  trainingLoraIsUnderDatasetOutput,
  validationSetLabel,
  type LoraSeriesDatasetKeyParts,
} from '../domain/loraTrainingDataset.js';
import {
  isLibraryUtilityDirName,
  isPathInsideRoot,
  WCM_DIR,
} from '../domain/librarySidecarPaths.js';
import type {
  LoraSeriesValidationSetDto,
} from '../shared/contracts.js';
import { atomicWriteFile, readJsonFile } from './librarySidecarIo.js';
import { getActiveLibrary } from './settingsStore.js';

const SKIP_DIR_NAMES = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  WCM_DIR,
  '!Cache',
  '!Thumbnails',
  '!Deleted',
]);

const MAX_WALK_DIRS = 8_000;
const MAX_DEPTH = 10;
const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;
const MAX_IMAGES_PER_VALIDATION_SET = 64;

export type LoraSeriesDatasetPreviewResult = {
  status: 'ok' | 'no_training_library' | 'no_lora_folder' | 'not_found';
  seriesKey: string;
  datasetAbsolutePath?: string;
  datasetRelativePath?: string;
  previewAbsolutePath?: string | null;
  previewDataUrl?: string | null;
  fromCache?: boolean;
  validationSets?: LoraSeriesValidationSetDto[];
};

type SeriesDatasetCacheFile = {
  /** v2: match via series `.safetensors` under dataset `output/`, not folder name. */
  version: 2;
  trainingLibraryRoot: string;
  bySeriesKey: Record<string, SeriesDatasetCacheEntry>;
};

type MemoryHit = {
  trainingRoot: string;
  datasetJsonMtimeMs: number;
  previewMtimeMs: number;
  setMtimes: string;
  result: LoraSeriesDatasetPreviewResult;
};

const memoryBySeriesKey = new Map<string, MemoryHit>();

/** Test hook — drop the process-lifetime resolve cache. */
export function resetLoraSeriesDatasetMemory(): void {
  memoryBySeriesKey.clear();
}

function cachePath(loraRoot: string): string {
  return path.join(path.resolve(loraRoot), WCM_DIR, 'series-datasets.json');
}

function loadCache(loraRoot: string): SeriesDatasetCacheFile {
  const raw = readJsonFile<SeriesDatasetCacheFile>(cachePath(loraRoot));
  if (!raw || raw.version !== 2 || typeof raw.bySeriesKey !== 'object') {
    return {
      version: 2,
      trainingLibraryRoot: '',
      bySeriesKey: {},
    };
  }
  return {
    version: 2,
    trainingLibraryRoot:
      typeof raw.trainingLibraryRoot === 'string' ? raw.trainingLibraryRoot : '',
    bySeriesKey: raw.bySeriesKey ?? {},
  };
}

function saveCache(loraRoot: string, cache: SeriesDatasetCacheFile): void {
  const file = cachePath(loraRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWriteFile(file, `${JSON.stringify(cache, null, 2)}\n`);
}

function readImageDataUrl(absolutePath: string): string | null {
  try {
    const st = fs.statSync(absolutePath);
    if (!st.isFile() || st.size <= 0 || st.size > MAX_PREVIEW_BYTES) return null;
    const ext = path.extname(absolutePath).toLowerCase();
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : ext === '.bmp'
              ? 'image/bmp'
              : 'image/jpeg';
    const buf = fs.readFileSync(absolutePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Data URL for an image under the configured training library root. */
export function readTrainingLibraryImageDataUrl(
  absolutePath: string,
): string | null {
  const trainingRoot = getActiveLibrary().trainingLibraryFolder?.trim();
  if (!trainingRoot) return null;
  const resolved = path.resolve(absolutePath);
  if (!isPathInsideRoot(resolved, path.resolve(trainingRoot))) return null;
  return readImageDataUrl(resolved);
}

/**
 * Collect image files under a validation set folder. Prefers files directly in
 * the set root, then walks nested folders (e.g. model / step subdirs).
 * Uses `statSync` because Windows Dirent `isFile()` can miss reparse/cloud
 * placeholder entries.
 */
function collectImagesUnderSetFolder(
  setRootAbs: string,
): Array<{ fileName: string; absolutePath: string }> {
  const out: Array<{ fileName: string; absolutePath: string }> = [];

  const walk = (dirAbs: string, depth: number) => {
    if (out.length >= MAX_IMAGES_PER_VALIDATION_SET || depth > 5) return;
    let names: string[];
    try {
      names = fs.readdirSync(dirAbs);
    } catch {
      return;
    }

    const files: string[] = [];
    const subdirs: string[] = [];
    for (const name of names) {
      if (!name || name.startsWith('.')) continue;
      if (SKIP_DIR_NAMES.has(name) || isLibraryUtilityDirName(name)) continue;
      const absolutePath = path.join(dirAbs, name);
      let st: fs.Stats | null = null;
      try {
        st = fs.statSync(absolutePath);
      } catch {
        st = null;
      }
      if (st?.isDirectory()) {
        subdirs.push(name);
        continue;
      }
      // Prefer isFile(), but still accept image-named entries when Windows
      // reports an odd mode (reparse / placeholder).
      if (isDatasetImageFileName(name) && (!st || st.isFile() || !st.isDirectory())) {
        files.push(name);
      }
    }

    files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const name of files) {
      if (out.length >= MAX_IMAGES_PER_VALIDATION_SET) break;
      const absolutePath = path.join(dirAbs, name);
      const rel = path
        .relative(setRootAbs, absolutePath)
        .replaceAll('\\', '/');
      out.push({ fileName: rel || name, absolutePath });
    }

    subdirs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const name of subdirs) {
      walk(path.join(dirAbs, name), depth + 1);
    }
  };

  walk(setRootAbs, 0);
  return out;
}

function statMtimeMs(abs: string): number {
  try {
    return fs.statSync(abs).mtimeMs;
  } catch {
    return 0;
  }
}

function listValidationSetsForDataset(
  datasetAbs: string,
  json: unknown,
  cachedSets?: SeriesDatasetCacheEntry['validationSets'],
): LoraSeriesValidationSetDto[] {
  const metas = parseDatasetValidationSets(json);
  if (metas.length === 0) return [];

  // Always `<dataset>/output/<Set N>` — never nest the dataset name under output.
  const outputAbs = path.join(datasetAbs, 'output');
  let folderNames: string[] = [];
  if (fs.existsSync(outputAbs) && fs.statSync(outputAbs).isDirectory()) {
    try {
      folderNames = fs
        .readdirSync(outputAbs, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name);
    } catch {
      folderNames = [];
    }
  }
  const ordered = orderOutputSetFolders(folderNames, metas.length);
  const sets: LoraSeriesValidationSetDto[] = [];

  for (let i = 0; i < metas.length; i++) {
    const folderName = path.basename(ordered[i] ?? `Set ${i + 1}`);
    const folderAbsolutePath = path.join(outputAbs, folderName);
    const folderMtimeMs = statMtimeMs(folderAbsolutePath);
    const cached = cachedSets?.find(
      (row) => row.folderName.toLowerCase() === folderName.toLowerCase(),
    );
    let images: LoraSeriesValidationSetDto['images'] = [];
    if (fs.existsSync(folderAbsolutePath)) {
      if (
        cached &&
        cached.folderMtimeMs === folderMtimeMs &&
        Array.isArray(cached.images)
      ) {
        images = cached.images.map((rel) => ({
          fileName: rel,
          absolutePath: path.join(folderAbsolutePath, ...rel.split('/')),
        }));
      } else {
        images = collectImagesUnderSetFolder(folderAbsolutePath);
      }
    }
    const meta = metas[i];
    sets.push({
      index: i,
      label: validationSetLabel(meta, folderName, i),
      prompt: meta?.prompt ?? '',
      folderName,
      folderAbsolutePath,
      images,
    });
  }
  return sets;
}

function resolvePreviewAbsolute(
  datasetAbs: string,
  previewRelativePath: string | null,
): { absolutePath: string; relativePath: string } | null {
  const tryRel = (rel: string | null) => {
    if (!rel) return null;
    const resolved = path.resolve(datasetAbs, rel);
    if (!isPathInsideRoot(resolved, datasetAbs)) return null;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
    return {
      absolutePath: resolved,
      relativePath: rel.replaceAll('\\', '/'),
    };
  };

  const fromJson = tryRel(previewRelativePath);
  if (fromJson) return fromJson;

  // No coverFileName (or missing file) — first image beside dataset.json.
  let names: string[];
  try {
    names = fs.readdirSync(datasetAbs);
  } catch {
    return null;
  }
  return tryRel(pickFirstDatasetImageFileName(names));
}

/**
 * Walk up from a training-library LoRA file to the nearest folder that contains
 * `dataset.json` (still under the training root).
 */
function walkUpToDatasetJson(
  loraFileAbs: string,
  trainingRootAbs: string,
): string | null {
  const root = path.resolve(trainingRootAbs);
  let dir = path.dirname(path.resolve(loraFileAbs));
  for (;;) {
    const resolved = path.resolve(dir);
    const atRoot =
      resolved.toLowerCase() === root.toLowerCase();
    if (!atRoot && !isPathInsideRoot(resolved, root)) return null;
    if (fs.existsSync(path.join(resolved, 'dataset.json'))) {
      return resolved;
    }
    if (atRoot) return null;
    const parent = path.dirname(resolved);
    if (parent === resolved) return null;
    dir = parent;
  }
}

/**
 * Find the dataset folder by locating any series `.safetensors` under the
 * training library (expected under `<dataset>/output/…`), then walking up to
 * `dataset.json`. Folder / dataset names are not compared to the LoRA name.
 */
function findDatasetBySeriesSafetensors(
  trainingRoot: string,
  seriesBase: string,
  separator: '_' | '-',
): { relativePath: string } | null {
  const root = path.resolve(trainingRoot);
  const state: {
    best: {
      relativePath: string;
      underOutput: boolean;
      pathLen: number;
    } | null;
  } = { best: null };
  let visited = 0;

  const considerFile = (fileAbs: string) => {
    const datasetAbs = walkUpToDatasetJson(fileAbs, root);
    if (!datasetAbs) return;
    const datasetRelativePath = path
      .relative(root, datasetAbs)
      .replaceAll('\\', '/')
      .replace(/^\/+|\/+$/g, '');
    const loraRelativePath = path
      .relative(root, fileAbs)
      .replaceAll('\\', '/');
    const underOutput = trainingLoraIsUnderDatasetOutput(
      datasetRelativePath,
      loraRelativePath,
    );
    const pathLen = datasetRelativePath.length;
    const best = state.best;
    if (
      !best ||
      (underOutput && !best.underOutput) ||
      (underOutput === best.underOutput && pathLen < best.pathLen)
    ) {
      state.best = { relativePath: datasetRelativePath, underOutput, pathLen };
    }
  };

  const walk = (dirAbs: string, depth: number) => {
    if (state.best?.underOutput) return;
    if (visited >= MAX_WALK_DIRS || depth > MAX_DEPTH) return;
    visited += 1;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isFile()) {
        if (!safetensorsFileMatchesSeries(entry.name, seriesBase, separator)) {
          continue;
        }
        considerFile(path.join(dirAbs, entry.name));
        if (state.best?.underOutput) return;
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (SKIP_DIR_NAMES.has(entry.name) || isLibraryUtilityDirName(entry.name)) {
        continue;
      }
      if (entry.name.startsWith('.')) continue;
      walk(path.join(dirAbs, entry.name), depth + 1);
      if (state.best?.underOutput) return;
    }
  };

  walk(root, 0);
  return state.best ? { relativePath: state.best.relativePath } : null;
}

function snapshotSetMtimes(sets: LoraSeriesValidationSetDto[]): string {
  return sets
    .map((set) => `${set.folderName}:${statMtimeMs(set.folderAbsolutePath)}`)
    .join('|');
}

function cacheEntryFromResult(
  result: LoraSeriesDatasetPreviewResult,
): SeriesDatasetCacheEntry | null {
  if (result.status !== 'ok' || !result.datasetRelativePath) return null;
  return seriesDatasetHitEntry(result.datasetRelativePath, {
    previewRelativePath: result.previewAbsolutePath
      ? path.basename(result.previewAbsolutePath)
      : null,
    previewMtimeMs: result.previewAbsolutePath
      ? statMtimeMs(result.previewAbsolutePath)
      : 0,
    validationSets: (result.validationSets ?? []).map((set) => ({
      folderName: set.folderName,
      folderMtimeMs: statMtimeMs(set.folderAbsolutePath),
      images: set.images.map((img) => img.fileName),
    })),
  });
}

function buildOkResult(opts: {
  seriesKey: string;
  trainingRoot: string;
  datasetRelativePath: string;
  previewRelativePath: string | null;
  fromCache: boolean;
  cachedEntry?: SeriesDatasetCacheEntry;
}): LoraSeriesDatasetPreviewResult | null {
  const datasetAbsolutePath = path.resolve(
    opts.trainingRoot,
    opts.datasetRelativePath,
  );
  if (
    !isPathInsideRoot(datasetAbsolutePath, opts.trainingRoot) ||
    !fs.existsSync(datasetAbsolutePath) ||
    !fs.statSync(datasetAbsolutePath).isDirectory()
  ) {
    return null;
  }
  let json: unknown = null;
  try {
    json = JSON.parse(
      fs.readFileSync(path.join(datasetAbsolutePath, 'dataset.json'), 'utf8'),
    ) as unknown;
  } catch {
    json = null;
  }
  const preview = resolvePreviewAbsolute(
    datasetAbsolutePath,
    opts.previewRelativePath ?? parseDatasetPreviewRelativePath(json),
  );
  const previewMtimeMs = preview ? statMtimeMs(preview.absolutePath) : 0;
  const reuseCover =
    Boolean(opts.cachedEntry?.previewRelativePath) &&
    opts.cachedEntry?.previewMtimeMs === previewMtimeMs &&
    preview &&
    path.basename(preview.absolutePath).toLowerCase() ===
      path.basename(opts.cachedEntry?.previewRelativePath ?? '').toLowerCase();
  const memory = memoryBySeriesKey.get(opts.seriesKey);
  const previewDataUrl =
    reuseCover &&
    memory?.result.previewAbsolutePath === preview?.absolutePath &&
    memory.result.previewDataUrl
      ? memory.result.previewDataUrl
      : preview
        ? readImageDataUrl(preview.absolutePath)
        : null;
  return {
    status: 'ok',
    seriesKey: opts.seriesKey,
    datasetAbsolutePath,
    datasetRelativePath: opts.datasetRelativePath.replaceAll('\\', '/'),
    previewAbsolutePath: preview?.absolutePath ?? null,
    previewDataUrl,
    fromCache: opts.fromCache,
    validationSets: listValidationSetsForDataset(
      datasetAbsolutePath,
      json,
      opts.cachedEntry?.validationSets,
    ),
  };
}

function rememberResult(
  seriesKey: string,
  trainingRoot: string,
  result: LoraSeriesDatasetPreviewResult,
): void {
  if (result.status !== 'ok' || !result.datasetAbsolutePath) {
    memoryBySeriesKey.set(seriesKey, {
      trainingRoot,
      datasetJsonMtimeMs: 0,
      previewMtimeMs: 0,
      setMtimes: '',
      result,
    });
    return;
  }
  memoryBySeriesKey.set(seriesKey, {
    trainingRoot,
    datasetJsonMtimeMs: statMtimeMs(
      path.join(result.datasetAbsolutePath, 'dataset.json'),
    ),
    previewMtimeMs: result.previewAbsolutePath
      ? statMtimeMs(result.previewAbsolutePath)
      : 0,
    setMtimes: snapshotSetMtimes(result.validationSets ?? []),
    result,
  });
}

function memoryStillFresh(
  seriesKey: string,
  trainingRoot: string,
): LoraSeriesDatasetPreviewResult | null {
  const mem = memoryBySeriesKey.get(seriesKey);
  if (!mem || mem.trainingRoot.toLowerCase() !== trainingRoot.toLowerCase()) {
    return null;
  }
  if (mem.result.status !== 'ok' || !mem.result.datasetAbsolutePath) {
    return mem.result;
  }
  const datasetJsonMtimeMs = statMtimeMs(
    path.join(mem.result.datasetAbsolutePath, 'dataset.json'),
  );
  const previewMtimeMs = mem.result.previewAbsolutePath
    ? statMtimeMs(mem.result.previewAbsolutePath)
    : 0;
  const setMtimes = snapshotSetMtimes(mem.result.validationSets ?? []);
  if (
    datasetJsonMtimeMs === mem.datasetJsonMtimeMs &&
    previewMtimeMs === mem.previewMtimeMs &&
    setMtimes === mem.setMtimes
  ) {
    return mem.result;
  }
  return null;
}

/**
 * Resolve a training-dataset folder for a multi-step LoRA series.
 * The dataset folder (and a not-found miss) are persisted. Validation image
 * lists reuse the last listing until that set folder's mtime changes.
 * The training-library search runs only on a cache miss or Rematch.
 */
export function resolveLoraSeriesDatasetPreview(
  parts: LoraSeriesDatasetKeyParts,
  opts?: { force?: boolean },
): LoraSeriesDatasetPreviewResult {
  const seriesKey = loraSeriesDatasetKey(parts);
  const lib = getActiveLibrary();
  const trainingRoot = lib.trainingLibraryFolder?.trim()
    ? path.resolve(lib.trainingLibraryFolder)
    : null;
  const loraRoot = lib.loraFolder?.trim()
    ? path.resolve(lib.loraFolder)
    : null;
  if (!trainingRoot || !fs.existsSync(trainingRoot)) {
    return { status: 'no_training_library', seriesKey };
  }
  if (!loraRoot) {
    return { status: 'no_lora_folder', seriesKey };
  }

  if (opts?.force) {
    memoryBySeriesKey.delete(seriesKey);
  } else {
    const fresh = memoryStillFresh(seriesKey, trainingRoot);
    if (fresh) return { ...fresh, fromCache: true };
  }

  const cache = loadCache(loraRoot);
  const rootChanged =
    cache.trainingLibraryRoot &&
    path.resolve(cache.trainingLibraryRoot).toLowerCase() !==
      trainingRoot.toLowerCase();
  if (rootChanged) {
    cache.bySeriesKey = {};
    cache.trainingLibraryRoot = trainingRoot;
  }

  const link = opts?.force
    ? { kind: 'miss' as const }
    : cachedSeriesDatasetLink(cache.bySeriesKey[seriesKey]);

  if (link.kind === 'not_found') {
    const miss: LoraSeriesDatasetPreviewResult = {
      status: 'not_found',
      seriesKey,
      fromCache: true,
    };
    rememberResult(seriesKey, trainingRoot, miss);
    return miss;
  }

  if (link.kind === 'hit') {
    const live = buildOkResult({
      seriesKey,
      trainingRoot,
      datasetRelativePath: link.relativePath,
      previewRelativePath:
        cache.bySeriesKey[seriesKey]?.previewRelativePath ?? null,
      fromCache: true,
      cachedEntry: cache.bySeriesKey[seriesKey],
    });
    if (live) {
      const next = cacheEntryFromResult(live);
      if (
        next &&
        JSON.stringify(cache.bySeriesKey[seriesKey]) !== JSON.stringify(next)
      ) {
        cache.trainingLibraryRoot = trainingRoot;
        cache.bySeriesKey[seriesKey] = next;
        saveCache(loraRoot, cache);
      }
      rememberResult(seriesKey, trainingRoot, live);
      return live;
    }
  }

  const match = findDatasetBySeriesSafetensors(
    trainingRoot,
    parts.seriesBase,
    parts.separator,
  );
  if (!match) {
    cache.trainingLibraryRoot = trainingRoot;
    cache.bySeriesKey[seriesKey] = seriesDatasetNotFoundEntry();
    saveCache(loraRoot, cache);
    const miss: LoraSeriesDatasetPreviewResult = {
      status: 'not_found',
      seriesKey,
      fromCache: false,
    };
    rememberResult(seriesKey, trainingRoot, miss);
    return miss;
  }

  const result = buildOkResult({
    seriesKey,
    trainingRoot,
    datasetRelativePath: match.relativePath,
    previewRelativePath: null,
    fromCache: false,
  });
  if (!result) {
    cache.trainingLibraryRoot = trainingRoot;
    cache.bySeriesKey[seriesKey] = seriesDatasetNotFoundEntry();
    saveCache(loraRoot, cache);
    const miss: LoraSeriesDatasetPreviewResult = {
      status: 'not_found',
      seriesKey,
      fromCache: false,
    };
    rememberResult(seriesKey, trainingRoot, miss);
    return miss;
  }

  cache.trainingLibraryRoot = trainingRoot;
  cache.bySeriesKey[seriesKey] = cacheEntryFromResult(result) ??
    seriesDatasetHitEntry(match.relativePath);
  saveCache(loraRoot, cache);
  rememberResult(seriesKey, trainingRoot, result);
  return result;
}
