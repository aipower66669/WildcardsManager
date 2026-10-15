import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { IPC } from '../shared/contracts.js';
import {
  LORA_EXTENSIONS,
  LORA_INDEX_STALE_ISSUE_MAX_AGE_MS,
  addLoraFile,
  reuseLoraFile,
  searchLoraIndex,
  type LoraFileEntry,
  type LoraIndex,
  type LoraSearchHit,
} from '../domain/lora.js';
import { applyLoraWildcardOpInMemory } from './wildcardMemoryEdit.js';
import {
  buildLocalLoraSeriesSnippet,
  buildLocalLoraSingleSnippet,
  parseLoraTrainingStep,
} from '../domain/loraSeries.js';
import { planExtendUnusedLoraSeriesSteps } from '../domain/loraSeriesExtend.js';
import { planRenameLora } from '../domain/renameLora.js';
import { resolveDownloadCategoryDir } from './civitaiCategoryService.js';
import {
  getLoraDownloadCategoryById,
  rememberLoraDownloadCategory,
} from './loraDownloadCategoryService.js';
import { libraryService } from './libraryService.js';
import { applyMutation } from './mutationService.js';
import {
  attachCachedAutoV2Hashes,
  attachCachedAutoV2HashForFile,
  ensureIndexAutoV2Hashes,
  moveCachedFileEntry,
} from './modelHashCache.js';
import { noteResolvedFileIngested } from './modelResolveState.js';
import {
  loadSettings,
  renameIgnoredUnusedLora,
} from './settingsStore.js';
import {
  walkModelFolderEntries,
  walkModelFolderEntriesAsync,
} from './modelFolderWalk.js';
import { walkModelFolderInWorker } from './modelFolderWalkWorkerClient.js';
import {
  hydrateModelIndex,
  modelIndexFilesEqual,
  persistModelIndex,
} from './modelFileIndexCache.js';
import { setMainActivityJob } from './mainActivity.js';
import { readPromptKeywordsFromSafetensors } from './safetensorsInspect.js';

let cached: { root: string; builtAt: number; index: LoraIndex } | null = null;

function addIfLora(
  index: LoraIndex,
  abs: string,
  relative: string,
  previousByRel?: Map<string, LoraFileEntry>,
): void {
  const ext = path.extname(abs).toLowerCase();
  if (!(LORA_EXTENSIONS as readonly string[]).includes(ext)) return;
  const rel = relative.replace(/\\/g, '/');
  const old = previousByRel?.get(rel.toLowerCase());
  if (old) {
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

function walkLoraFiles(
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
      addIfLora(index, abs, relative, prior);
    },
    undefined,
    { weightExtensions: new Set(LORA_EXTENSIONS) },
  );
}

export function buildLoraIndex(root: string, previous?: LoraIndex | null): LoraIndex {
  const resolvedRoot = path.resolve(root);
  const index = emptyIndex(resolvedRoot);

  try {
    if (
      fs.existsSync(resolvedRoot) &&
      fs.statSync(resolvedRoot).isDirectory()
    ) {
      walkLoraFiles(resolvedRoot, resolvedRoot, index, previous);
    }
  } catch {
    // Unreadable folder → empty index; callers still emit missing warnings.
  }

  return index;
}

export async function buildLoraIndexAsync(
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
          addIfLora(index, abs, relative, prior);
        },
        {
          weightExtensions: new Set(LORA_EXTENSIONS),
          onProgress: (files) => {
            setMainActivityJob(
              'lora-index',
              `Scanning LoRA folder… ${files.toLocaleString()} files`,
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

/**
 * Cached index only — never walks the disk. A miss hydrates the last
 * `file-index.json` snapshot (instant) or starts a background scan.
 */
export function getConfiguredLoraIndex(): LoraIndex | null {
  const folder = loadSettings().loraFolder;
  if (!folder) return null;
  if (cacheMatches(folder)) return cached!.index;
  const resolved = path.resolve(folder);
  const persisted = hydrateModelIndex(resolved);
  if (persisted) {
    cached = { root: persisted.root, builtAt: Date.now(), index: persisted };
    void startLoraWalk(resolved, persisted, { quiet: true });
    return persisted;
  }
  void ensureLoraIndex();
  return null;
}

/** Wait for a usable index. Distinguishes “folder not set” from “cache not ready”. */
export async function requireConfiguredLoraIndex(opts?: {
  force?: boolean;
}): Promise<LoraIndex> {
  const folder = loadSettings().loraFolder;
  if (!folder) throw new Error('No LoRA folder configured');
  const index = await ensureLoraIndex(opts);
  if (!index) throw new Error('No LoRA folder configured');
  return index;
}

/**
 * Load or refresh the LoRA folder index without blocking the event loop.
 * `force` waits for a new walk (reuses unchanged path rows). Otherwise the
 * current cache is returned immediately.
 */
export async function ensureLoraIndex(opts?: {
  force?: boolean;
}): Promise<LoraIndex | null> {
  const folder = loadSettings().loraFolder;
  if (!folder) return null;
  const resolved = path.resolve(folder);
  const have = cacheMatches(folder);
  if (!opts?.force && have) return cached!.index;
  const persisted = have ? null : hydrateModelIndex(resolved);
  if (!opts?.force && persisted) {
    cached = { root: persisted.root, builtAt: Date.now(), index: persisted };
    void startLoraWalk(resolved, persisted, { quiet: true });
    return persisted;
  }
  return startLoraWalk(resolved, have ? cached!.index : persisted);
}

function startLoraWalk(
  resolved: string,
  previous: LoraIndex | null,
  opts?: { quiet?: boolean },
): Promise<LoraIndex | null> {
  if (walkInflight) return walkInflight;
  walkInflight = (async () => {
    if (!opts?.quiet) {
      setMainActivityJob('lora-index', 'Scanning LoRA folder…');
    }
    try {
      const index = await collectLoraIndex(resolved, previous, opts?.quiet);
      if (isReadableModelRoot(resolved)) persistModelIndex(index);
      const builtAt = Date.now();
      const changed = !cached || !modelIndexFilesEqual(cached.index, index);
      cached = { root: index.root, builtAt, index };
      if (!opts?.quiet || changed) notifyLoraIndexRefreshed(builtAt);
      return index;
    } finally {
      setMainActivityJob('lora-index', null);
      walkInflight = null;
    }
  })();
  return walkInflight;
}

async function collectLoraIndex(
  resolved: string,
  previous: LoraIndex | null,
  quiet?: boolean,
): Promise<LoraIndex> {
  try {
    const hits = await walkModelFolderInWorker(resolved, LORA_EXTENSIONS, {
      onProgress: (files) => {
        if (quiet) return;
        setMainActivityJob(
          'lora-index',
          `Scanning LoRA folder… ${files.toLocaleString()} files`,
        );
      },
    });
    const index = emptyIndex(resolved);
    const prior = previousByRel(previous);
    for (const hit of hits) addIfLora(index, hit.abs, hit.rel, prior);
    return index;
  } catch {
    return buildLoraIndexAsync(resolved, previous);
  }
}

/** LoRA index with AutoV2 hashes filled from the persistent cache. */
export async function getConfiguredLoraIndexHashed(): Promise<LoraIndex | null> {
  const index = getConfiguredLoraIndex();
  if (!index) return null;
  return ensureIndexAutoV2Hashes(index);
}

/**
 * LoRA index with AutoV2 hashes attached from the persistent cache only (no
 * file hashing). Fast enough for the browse hot path; missing hashes fill in via
 * a background warm.
 */
export function getConfiguredLoraIndexCachedHashes(): LoraIndex | null {
  const index = getConfiguredLoraIndex();
  if (!index) return null;
  return attachCachedAutoV2Hashes(index);
}

let deferredInvalidate = false;

export function invalidateLoraIndexCache(): void {
  cached = null;
  deferredInvalidate = false;
}

/**
 * Add one on-disk LoRA to the live index (no folder walk). Used after a
 * download so Downloaded / editor matching stay current without wiping
 * the library cache.
 */
export function ingestLoraFileAt(
  absolutePath: string,
  opts?: { notify?: boolean },
): boolean {
  const folder = loadSettings().loraFolder;
  if (!folder || !cached || !cacheMatches(folder)) return false;
  const resolved = path.resolve(absolutePath);
  const rel = path.relative(cached.index.root, resolved).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const ext = path.extname(resolved).toLowerCase();
  if (!(LORA_EXTENSIONS as readonly string[]).includes(ext)) return false;

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
  if (isNew) noteResolvedFileIngested('LORA');
  if (opts?.notify !== false) notifyLoraIndexRefreshed(cached.builtAt);
  return true;
}

export function getLoraIndexLastRefreshAt(): number | null {
  return cached?.builtAt ?? null;
}

export function isLoraIndexRefreshStale(
  maxAgeMs = LORA_INDEX_STALE_ISSUE_MAX_AGE_MS,
): boolean {
  const folder = loadSettings().loraFolder;
  if (!folder) return false;
  if (!cacheMatches(folder) || !cached) return true;
  return Date.now() - cached.builtAt >= maxAgeMs;
}

/** Force-walk the LoRA folder only when the last scan is older than `maxAgeMs`. */
export async function refreshLoraIndexIfStale(
  maxAgeMs = LORA_INDEX_STALE_ISSUE_MAX_AGE_MS,
): Promise<{ refreshed: boolean; lastRefreshAt: number | null }> {
  const folder = loadSettings().loraFolder;
  if (!folder) return { refreshed: false, lastRefreshAt: null };
  if (!isLoraIndexRefreshStale(maxAgeMs)) {
    return { refreshed: false, lastRefreshAt: getLoraIndexLastRefreshAt() };
  }
  await ensureLoraIndex({ force: true });
  return { refreshed: true, lastRefreshAt: getLoraIndexLastRefreshAt() };
}

function notifyLoraIndexRefreshed(lastRefreshAt: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(IPC.modelFilesLoraIndexRefreshed, { lastRefreshAt });
  }
}

/**
 * Invalidate now, or mark dirty if more downloads are still queued so we do not
 * sync-walk the LoRA tree between queue jobs (UI freeze at “Starting…”).
 */
export function scheduleLoraIndexInvalidation(defer: boolean): void {
  if (defer) {
    deferredInvalidate = true;
    return;
  }
  invalidateLoraIndexCache();
}

export function flushDeferredLoraIndexInvalidation(): void {
  if (!deferredInvalidate) return;
  invalidateLoraIndexCache();
}

/**
 * @deprecated Sync full-tree walks froze the UI. Prefer `ensureLoraIndex({ force: true })`.
 * Returns the current cache (possibly stale) and starts a yielding rescan.
 */
export function getConfiguredLoraIndexFresh(): LoraIndex | null {
  void ensureLoraIndex({ force: true });
  return getConfiguredLoraIndex();
}

/** Substring search by name against the cached LoRA index (walks only on miss). */
export async function searchConfiguredLoras(
  query: string,
  limit = 100,
): Promise<{ folder: string; fileCount: number; hits: LoraSearchHit[] }> {
  const folder = loadSettings().loraFolder;
  if (!folder) {
    throw new Error('No LoRA folder configured');
  }
  const index = await ensureLoraIndex();
  if (!index) {
    throw new Error('No LoRA folder configured');
  }
  return {
    folder: index.root,
    fileCount: index.fileCount,
    hits: searchLoraIndex(index, query, limit),
  };
}

export type RenameLoraPreview = {
  canRename: boolean;
  reason?: string;
  sourceName: string;
  oldRelativePath: string;
  oldAbsolutePath: string;
  newBasename: string;
  newRelativePath: string;
  newAbsolutePath: string;
  affectedFiles: Array<{
    key: string;
    relativePath: string;
    occurrences: number;
  }>;
  totalOccurrences: number;
  warnings: string[];
};

export type RenameLoraResult = {
  oldRelativePath: string;
  newRelativePath: string;
  newAbsolutePath: string;
  editedFiles: number;
  totalOccurrences: number;
  hashCacheMoved: boolean;
};

function toRenamePreview(
  plan: ReturnType<typeof planRenameLora>,
  newAbsolutePath: string,
): RenameLoraPreview {
  return {
    canRename: plan.canRename,
    reason: plan.reason,
    sourceName: plan.sourceName,
    oldRelativePath: plan.oldFile?.relativePath ?? '',
    oldAbsolutePath: plan.oldFile?.absolutePath ?? '',
    newBasename: plan.newBasename,
    newRelativePath: plan.newRelativePath,
    newAbsolutePath,
    affectedFiles: plan.edits.map((e) => ({
      key: e.key,
      relativePath: e.relativePath,
      occurrences: e.occurrences,
    })),
    totalOccurrences: plan.totalOccurrences,
    warnings: plan.warnings,
  };
}

/** Preview renaming a LoRA on disk and rewriting library `<lora:…>` tags. */
export async function previewRenameLora(
  sourceName: string,
  newBasename: string,
): Promise<RenameLoraPreview> {
  const index = await requireConfiguredLoraIndex();
  const plan = planRenameLora(
    index,
    loadLibraryFilesSafe(),
    sourceName,
    newBasename,
  );
  const newAbsolutePath =
    plan.canRename && index
      ? path.join(index.root, ...plan.newRelativePath.split('/'))
      : '';
  return toRenamePreview(plan, newAbsolutePath);
}

/**
 * Rename a LoRA file on disk, move the hash-cache entry, rewrite wildcard
 * references (undoable), and update ignored-unused paths.
 */
export async function renameLoraModel(
  sourceName: string,
  newBasename: string,
): Promise<RenameLoraResult> {
  const index = await requireConfiguredLoraIndex();
  const files = loadLibraryFilesSafe();
  const plan = planRenameLora(index, files, sourceName, newBasename);
  if (!plan.canRename || !plan.oldFile || !index) {
    throw new Error(plan.reason ?? 'Cannot rename this LoRA');
  }

  const oldAbsolutePath = plan.oldFile.absolutePath;
  const newAbsolutePath = path.join(
    index.root,
    ...plan.newRelativePath.split('/'),
  );

  if (fs.existsSync(newAbsolutePath)) {
    throw new Error(`A file already exists at ${plan.newRelativePath}`);
  }
  if (!fs.existsSync(oldAbsolutePath)) {
    throw new Error(`LoRA file no longer exists: ${plan.oldFile.relativePath}`);
  }

  fs.renameSync(oldAbsolutePath, newAbsolutePath);
  const hashCacheMoved = moveCachedFileEntry(oldAbsolutePath, newAbsolutePath);
  renameIgnoredUnusedLora(plan.oldFile.relativePath, plan.newRelativePath);
  invalidateLoraIndexCache();

  if (plan.edits.length > 0) {
    applyMutation(
      `Rename LoRA ${plan.oldFile.relativePath} → ${plan.newRelativePath}`,
      plan.edits.map((e) => ({
        relativePath: e.relativePath,
        text: e.newText,
      })),
    );
  }

  return {
    oldRelativePath: plan.oldFile.relativePath,
    newRelativePath: plan.newRelativePath,
    newAbsolutePath,
    editedFiles: plan.edits.length,
    totalOccurrences: plan.totalOccurrences,
    hashCacheMoved,
  };
}

function loadLibraryFilesSafe() {
  try {
    return libraryService.loadAllFiles();
  } catch {
    return [];
  }
}

function uniqueLoraTargetPath(dir: string, fileName: string): string {
  const base = path.basename(fileName);
  let candidate = path.join(dir, base);
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(base);
  const stem = path.basename(base, ext);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${i})${ext}`);
    i += 1;
  }
  return candidate;
}

export type CategorizeUnusedLoraResult = {
  moved: Array<{ from: string; to: string }>;
  wildcardRelativePath: string;
  appended: boolean;
  /** True when an existing series root in the target file was extended. */
  extended: boolean;
  extendSummary?: string;
  snippet: string;
  pickName: string;
};

/**
 * Move unused LoRA file(s) into a download-category folder and upsert a
 * `# LOCAL` wildcard reference: extend an existing series root in the target
 * file when present, otherwise append a new block.
 */
export async function categorizeUnusedLoraSeries(opts: {
  relativePaths: string[];
  loraCategoryId: string;
  /** Optional `#` comment between `# LOCAL` and `<lora:…>`. */
  extraComment?: string;
  /** Optional prompt text after triggers on the `<lora:…>` line. */
  extraPrompt?: string;
}): Promise<CategorizeUnusedLoraResult> {
  const paths = [
    ...new Set(
      opts.relativePaths
        .map((p) => p.trim().replaceAll('\\', '/'))
        .filter(Boolean),
    ),
  ];
  if (paths.length === 0) throw new Error('No LoRA paths provided');

  const cat = getLoraDownloadCategoryById(opts.loraCategoryId);
  if (!cat) throw new Error('LoRA download category not found');

  const index = await requireConfiguredLoraIndex();

  const byRel = new Map(
    index.files.map((f) => [f.relativePath.replaceAll('\\', '/').toLowerCase(), f]),
  );
  const files = paths.map((rel) => {
    const file = byRel.get(rel.toLowerCase());
    if (!file) throw new Error(`LoRA not found: ${rel}`);
    return file;
  });

  const destDir = resolveDownloadCategoryDir(index.root, cat.folder);
  fs.mkdirSync(destDir, { recursive: true });

  const moved: Array<{ from: string; to: string }> = [];
  const finalBasenames: string[] = [];
  const finalAbsolutePaths: string[] = [];

  for (const file of files) {
    const fileName = path.basename(file.absolutePath);
    const destAbs =
      path.resolve(path.dirname(file.absolutePath)) === path.resolve(destDir)
        ? file.absolutePath
        : uniqueLoraTargetPath(destDir, fileName);
    const newRelative = path
      .relative(index.root, destAbs)
      .replaceAll('\\', '/');

    if (path.resolve(file.absolutePath) !== path.resolve(destAbs)) {
      if (!fs.existsSync(file.absolutePath)) {
        throw new Error(`LoRA file no longer exists: ${file.relativePath}`);
      }
      fs.renameSync(file.absolutePath, destAbs);
      moveCachedFileEntry(file.absolutePath, destAbs);
      renameIgnoredUnusedLora(file.relativePath, newRelative);
      moved.push({ from: file.relativePath.replaceAll('\\', '/'), to: newRelative });
    } else {
      moved.push({
        from: file.relativePath.replaceAll('\\', '/'),
        to: newRelative,
      });
    }
    finalBasenames.push(path.basename(destAbs, path.extname(destAbs)));
    finalAbsolutePaths.push(destAbs);
  }

  invalidateLoraIndexCache();

  let seriesBase = '';
  let separator: '_' | '-' = '_';
  const stepDigitsList: string[] = [];
  let allSeries = finalBasenames.length > 0;
  for (const base of finalBasenames) {
    const parsed = parseLoraTrainingStep(base);
    if (!parsed) {
      allSeries = false;
      break;
    }
    if (!seriesBase) {
      seriesBase = parsed.seriesBase;
      separator = parsed.separator;
    } else if (
      seriesBase !== parsed.seriesBase ||
      separator !== parsed.separator
    ) {
      allSeries = false;
      break;
    }
    stepDigitsList.push(parsed.stepDigits);
  }

  const preferName =
    allSeries && seriesBase
      ? seriesBase
      : finalBasenames[0]?.replace(/[_-]\d{3,}$/, '') || undefined;
  let keywords: string[] = [];
  for (const abs of finalAbsolutePaths) {
    keywords = readPromptKeywordsFromSafetensors(abs, preferName);
    if (keywords.length > 0) break;
  }

  let pickName: string;
  let snippet: string;
  if (allSeries && finalBasenames.length >= 2) {
    snippet = buildLocalLoraSeriesSnippet({
      seriesBase,
      separator,
      stepDigitsList,
      weights: cat.defaultWeights,
      keywords,
      extraComment: opts.extraComment,
      extraPrompt: opts.extraPrompt,
    });
    const tag = snippet.match(/<lora:([^:>]+):/i)?.[1] ?? '';
    pickName = tag;
  } else if (finalBasenames.length === 1) {
    pickName = finalBasenames[0]!;
    snippet = buildLocalLoraSingleSnippet({
      fileStem: pickName,
      weights: cat.defaultWeights,
      keywords,
      extraComment: opts.extraComment,
      extraPrompt: opts.extraPrompt,
    });
  } else {
    throw new Error(
      'Selected files are not a single training-step LoRA series',
    );
  }

  let appended = false;
  let extended = false;
  let extendSummary: string | undefined;
  try {
    const seriesForUpsert =
      allSeries && seriesBase
        ? {
            seriesBase,
            separator,
            stepDigitsList,
          }
        : undefined;
    const result = await applyLoraWildcardOpInMemory(
      cat.wildcardRelativePath,
      {
        type: 'upsert',
        snippet,
        fileStem: pickName,
        series: seriesForUpsert,
      },
      `Update LoRA reference in ${cat.wildcardRelativePath}`,
    );
    if (result.error) {
      throw new Error(result.error);
    }
    if (result.upsertMode === 'extended') {
      extended = result.changed;
      extendSummary = result.upsertSummary;
    } else if (result.upsertMode === 'appended') {
      appended = result.changed;
    }
  } catch (e) {
    throw new Error(
      `Moved ${moved.length} file(s) but failed to update wildcard: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  rememberLoraDownloadCategory(cat.id);

  return {
    moved,
    wildcardRelativePath: cat.wildcardRelativePath,
    appended,
    extended,
    extendSummary,
    snippet,
    pickName,
  };
}

export type ExtendUnusedLoraSeriesResult = {
  editedFiles: number;
  summaries: string[];
};

/**
 * One-click fix for unused training-step LoRAs when the library already has a
 * matching `<lora:…>` series root — extend braces in place (no move / category).
 */
export async function extendUnusedLoraSeriesSteps(
  relativePaths: string[],
): Promise<ExtendUnusedLoraSeriesResult> {
  const paths = [
    ...new Set(
      relativePaths
        .map((p) => p.trim().replaceAll('\\', '/'))
        .filter(Boolean),
    ),
  ];
  if (paths.length === 0) throw new Error('No LoRA paths provided');

  const index = await requireConfiguredLoraIndex();

  const byRel = new Map(
    index.files.map((f) => [
      f.relativePath.replaceAll('\\', '/').toLowerCase(),
      f,
    ]),
  );
  const unusedFiles = paths.map((rel) => {
    const file = byRel.get(rel.toLowerCase());
    if (!file) throw new Error(`LoRA not found: ${rel}`);
    return file;
  });

  const libraryFiles = loadLibraryFilesSafe().map((f) => ({
    relativePath: f.relativePath.replaceAll('\\', '/'),
    text: f.text,
  }));
  const plans = planExtendUnusedLoraSeriesSteps({
    unusedFiles,
    libraryFiles,
  });
  if (plans.length === 0) {
    throw new Error(
      'No existing wildcard series reference found to extend. Use Categorize to add one.',
    );
  }

  applyMutation(
    `Extend LoRA series steps in ${plans.length} file${
      plans.length === 1 ? '' : 's'
    }`,
    plans.map((p) => ({
      relativePath: p.relativePath,
      text: p.text,
    })),
  );

  return {
    editedFiles: plans.length,
    summaries: plans.map((p) => p.summary).filter(Boolean),
  };
}
