import fs from 'node:fs';
import path from 'node:path';
import {
  cachedLoraRefs,
  libraryFilesFingerprint,
} from '../domain/fileArtifactCache.js';
import { findDefinedLoraReference } from '../domain/definedLoraReference.js';
import {
  collectReferencedLoraNames,
  filesMatchingLoraName,
  isLoraFileReferenced,
  loraFileNameIssues,
  loraIndexFingerprint,
  validateDuplicateLoraAutoV2,
  type LoraFileEntry,
  type LoraIndex,
} from '../domain/lora.js';
import { scanModelSidecars } from '../domain/modelSidecar.js';
import { civitaiModelPageUrl } from '../domain/civitaiSnippet.js';
import type {
  IssueDto,
  ModelFileManagerEntryDto,
  ModelManagerListDto,
  ModelSidecarDto,
  LoraManagerDetailDto,
  LoraReverseRefDto,
  DefinedLoraReferenceDto,
  CheckpointManagerDetailDto,
} from '../shared/contracts.js';
import {
  getAutoV2CatalogIndex,
  getCachedModel,
  type AutoV2IndexRef,
} from './civitaiCatalogCache.js';
import {
  lookupManualCivitaiLink,
  manualLinkToFields,
  setManualCivitaiLink,
  clearManualCivitaiLink,
} from './modelManualCivitaiLink.js';
import { getModelRating, setModelRating, clearModelRating } from './modelRatings.js';
import {
  checkpointEnabledForRelativePath,
  clearCheckpointIgnored,
  setCheckpointEnabled,
} from './checkpointEnabled.js';
import {
  clearCheckpointMasterCache,
  MASTERS_DELETED_FOLDER,
  resolveCheckpointMasterImages,
  readMastersImageDataUrl,
  type CheckpointMasterImages,
} from './checkpointMasterImages.js';
import {
  ensureLoraIndex,
  getConfiguredLoraIndexCachedHashes,
  getConfiguredLoraIndex,
  getLoraIndexLastRefreshAt,
  invalidateLoraIndexCache,
  requireConfiguredLoraIndex,
} from './loraService.js';
import {
  ensureCheckpointIndex,
  getConfiguredCheckpointIndexCachedHashes,
  getConfiguredCheckpointIndex,
  invalidateCheckpointIndexCache,
  requireConfiguredCheckpointIndex,
} from './checkpointService.js';
import { libraryService } from './libraryService.js';
import { setMainActivityJob } from './mainActivity.js';
import { listAllGenFileContents } from './promptsService.js';
import {
  archiveCivitaiModel,
  getActiveLibrary,
  getCivitaiOrigin,
  loadSettings,
  removeIgnoredUnusedLora,
  unmarkCivitaiModelInstalled,
} from './settingsStore.js';
import {
  attachCachedAutoV2Hashes,
  removeCachedFileEntry,
} from './modelHashCache.js';
import { removeLoraReferences } from '../domain/renameLora.js';
import { applyMutation } from './mutationService.js';
import type {
  DeleteCheckpointsResultDto,
  DeleteLorasResultDto,
} from '../shared/contracts.js';
import { localCivitaiPreviewUrl } from '../shared/civitaiPreviewUrl.js';
import { hasCachedCivitaiPreview } from './civitaiPreviewCache.js';
import {
  PREVIEW_PRIORITY,
  prioritizeLibraryPreviews,
  requestCachedPreview,
  setActiveLibraryPreviewCoverage,
  type PreviewPriorityTarget,
} from './civitaiPreviewQueue.js';
import { startModelHashWarm } from './modelHashWarm.js';

/** Existence-only sidecar probe for list rows (no JSON parse). */
function probeSidecars(
  modelAbsolutePath: string,
  modelRoot: string,
): ModelSidecarDto {
  const dir = path.dirname(modelAbsolutePath);
  const base = path.basename(modelAbsolutePath, path.extname(modelAbsolutePath));
  const out: ModelSidecarDto = {};
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.gif']) {
    const abs = path.join(dir, `${base}${ext}`);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        out.imageAbsolutePath = abs;
        out.imageRelativePath = path
          .relative(modelRoot, abs)
          .split(path.sep)
          .join('/');
        break;
      }
    } catch {
      // ignore
    }
  }
  const jsonAbs = path.join(dir, `${base}.json`);
  try {
    if (fs.existsSync(jsonAbs) && fs.statSync(jsonAbs).isFile()) {
      out.jsonAbsolutePath = jsonAbs;
      out.jsonRelativePath = path
        .relative(modelRoot, jsonAbs)
        .split(path.sep)
        .join('/');
    }
  } catch {
    // ignore
  }
  return out;
}

function toSidecarDto(
  scan: ReturnType<typeof scanModelSidecars>,
): ModelSidecarDto {
  return {
    imageRelativePath: scan.imageRelativePath,
    imageAbsolutePath: scan.imageAbsolutePath,
    jsonRelativePath: scan.jsonRelativePath,
    jsonAbsolutePath: scan.jsonAbsolutePath,
    json: scan.json,
    jsonParseError: scan.jsonParseError,
  };
}

function civitaiFieldsFromMap(
  autoV2: string | undefined,
  catalog: Map<string, AutoV2IndexRef>,
): {
  civitaiModelId?: number;
  civitaiName?: string;
  civitaiPageUrl?: string;
  civitaiTrainedWords?: string[];
  previewUrl?: string;
  previewLocalUrl?: string | null;
} {
  if (!autoV2) return {};
  const ref = catalog.get(autoV2.trim().toUpperCase()) ?? null;
  if (!ref) return {};
  const cached = getCachedModel(ref.origin, ref.id);
  if (!cached) return {};
  const origin = cached.origin || getCivitaiOrigin();
  const previewUrl = cached.previewUrl;
  const trained = Array.isArray(cached.trainedWords)
    ? cached.trainedWords.map((w) => w.trim()).filter(Boolean)
    : [];
  return {
    civitaiModelId: cached.id,
    civitaiName: cached.name,
    civitaiPageUrl: civitaiModelPageUrl(origin, cached.id, cached.name),
    ...(trained.length > 0 ? { civitaiTrainedWords: trained } : {}),
    previewUrl,
    previewLocalUrl:
      previewUrl && hasCachedCivitaiPreview(previewUrl)
        ? localCivitaiPreviewUrl(previewUrl)
        : null,
  };
}

function resolveCivitaiFields(
  absolutePath: string,
  autoV2: string | undefined,
  catalog: Map<string, AutoV2IndexRef>,
): {
  civitaiModelId?: number;
  civitaiName?: string;
  civitaiPageUrl?: string;
  civitaiTrainedWords?: string[];
  previewUrl?: string;
  previewLocalUrl?: string | null;
  civitaiLinkManual?: boolean;
} {
  const manual = lookupManualCivitaiLink(absolutePath, autoV2);
  if (manual) return manualLinkToFields(manual);
  return civitaiFieldsFromMap(autoV2, catalog);
}

function masterFields(
  masters: CheckpointMasterImages | null | undefined,
): Pick<
  ModelFileManagerEntryDto,
  'masterImageAbsolutePath' | 'masterGenImageAbsolutePaths'
> {
  if (!masters) return {};
  return {
    masterImageAbsolutePath: masters.masterAbsolutePath,
    masterGenImageAbsolutePaths: masters.genAbsolutePaths,
  };
}

/** Fast list row: cached hashes + sidecar existence + optional catalog map. */
function toListEntry(
  file: LoraFileEntry,
  root: string,
  catalog: Map<string, AutoV2IndexRef>,
  opts?: { referenceCount?: number; unused?: boolean },
): ModelFileManagerEntryDto {
  return {
    relativePath: file.relativePath,
    stem: file.stem,
    name: path.basename(file.relativePath),
    absolutePath: file.absolutePath,
    autoV2: file.autoV2,
    sidecar: probeSidecars(file.absolutePath, root),
    rating: getModelRating(file.absolutePath, file.autoV2),
    referenceCount: opts?.referenceCount,
    unused: opts?.unused,
    ...resolveCivitaiFields(file.absolutePath, file.autoV2, catalog),
  };
}

/** Detail row: parse JSON sidecar + size/mtime. */
function toDetailEntry(
  file: LoraFileEntry,
  root: string,
  opts?: {
    referenceCount?: number;
    unused?: boolean;
    resolveMasters?: boolean;
  },
): ModelFileManagerEntryDto {
  const sidecar = toSidecarDto(scanModelSidecars(file.absolutePath, root));
  let sizeBytes: number | undefined;
  let mtimeMs: number | undefined;
  try {
    const st = fs.statSync(file.absolutePath);
    sizeBytes = st.size;
    mtimeMs = st.mtimeMs;
  } catch {
    // ignore
  }
  const masters = opts?.resolveMasters
    ? resolveCheckpointMasterImages({
        checkpointAbsolutePath: file.absolutePath,
        // Benchmark folders use the file stem only (not parent dirs).
        stem:
          path.basename(file.stem) ||
          path.basename(file.relativePath, path.extname(file.relativePath)),
        autoV2: file.autoV2,
        force: true,
      })
    : null;
  return {
    relativePath: file.relativePath,
    stem: file.stem,
    name: path.basename(file.relativePath),
    absolutePath: file.absolutePath,
    autoV2: file.autoV2,
    sizeBytes,
    mtimeMs,
    sidecar,
    rating: getModelRating(file.absolutePath, file.autoV2),
    referenceCount: opts?.referenceCount,
    unused: opts?.unused,
    ...masterFields(masters),
    ...resolveCivitaiFields(
      file.absolutePath,
      file.autoV2,
      getAutoV2CatalogIndex(),
    ),
  };
}

export { setManualCivitaiLink, clearManualCivitaiLink, setModelRating };
export { setCheckpointEnabled };
export { resolveCheckpointMasterImages, readMastersImageDataUrl };

function readLibraryFiles() {
  try {
    return libraryService.loadAllFiles();
  } catch {
    return [];
  }
}

const PREVIEW_PRIORITIZE_MIN_MS = 30_000;
let libraryRefsCache: {
  libraryFp: string;
  loraFp: string;
  reverse: Map<string, LoraReverseRefDto[]>;
  unused: Set<string>;
} | null = null;
let lastPreviewPrioritizeAt = 0;

/** One library pass → reverse refs + unused absolute paths. */
function analyzeLibraryRefs(
  index: LoraIndex,
  files = readLibraryFiles(),
): {
  reverse: Map<string, LoraReverseRefDto[]>;
  unused: Set<string>;
} {
  const byAbs = new Map<string, LoraReverseRefDto[]>();
  const referenced = collectReferencedLoraNames([
    ...files.map((file) => file.text),
    ...listAllGenFileContents(),
  ]);
  const ignored = new Set(
    (loadSettings().ignoredUnusedLoras ?? []).map((p) =>
      p.trim().replaceAll('\\', '/').toLowerCase(),
    ),
  );

  for (const file of files) {
    const refs = cachedLoraRefs(file);
    if (refs.length === 0) continue;
    const key = file.key;
    const relativePath = file.relativePath;
    const grouped = new Map<
      string,
      Array<{ raw: string; line: number; column: number }>
    >();
    for (const ref of refs) {
      if (!ref.name) continue;
      for (const file of filesMatchingLoraName(ref.name, index)) {
        const list = grouped.get(file.absolutePath) ?? [];
        list.push({ raw: ref.raw, line: ref.line, column: ref.column });
        grouped.set(file.absolutePath, list);
      }
    }
    for (const [abs, occurrences] of grouped) {
      const list = byAbs.get(abs) ?? [];
      list.push({ relativePath, key, refs: occurrences });
      byAbs.set(abs, list);
    }
  }

  const unused = new Set<string>();
  for (const file of index.files) {
    if (isLoraFileReferenced(file, referenced)) continue;
    if (ignored.has(file.relativePath.toLowerCase())) continue;
    unused.add(file.absolutePath.toLowerCase());
  }

  return { reverse: byAbs, unused };
}

function getCachedLibraryRefs(index: LoraIndex): {
  reverse: Map<string, LoraReverseRefDto[]>;
  unused: Set<string>;
} {
  const files = readLibraryFiles();
  const libraryFp = libraryFilesFingerprint(files);
  const loraFp = loraIndexFingerprint(index);
  if (
    libraryRefsCache &&
    libraryRefsCache.libraryFp === libraryFp &&
    libraryRefsCache.loraFp === loraFp
  ) {
    return {
      reverse: libraryRefsCache.reverse,
      unused: libraryRefsCache.unused,
    };
  }
  const result = analyzeLibraryRefs(index, files);
  libraryRefsCache = {
    libraryFp,
    loraFp,
    reverse: result.reverse,
    unused: result.unused,
  };
  return result;
}

function maybePrioritizeActiveLibraryPreviews(): void {
  const now = Date.now();
  if (now - lastPreviewPrioritizeAt < PREVIEW_PRIORITIZE_MIN_MS) return;
  lastPreviewPrioritizeAt = now;
  prioritizeActiveLibraryPreviews();
}

/**
 * Queue missing Civitai covers for this library’s LoRA + checkpoint folders
 * only. Other libraries’ models are not warmed until they become active.
 * Browse on-screen thumbs still use the separate priority queue.
 */
export async function prioritizeActiveLibraryPreviews(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  const catalog = getAutoV2CatalogIndex();
  const origin = getCivitaiOrigin();
  const coverage: Array<{ modelId: number; resolved: boolean }> = [];
  const targets: PreviewPriorityTarget[] = [];
  const seenUrl = new Set<string>();
  const seenId = new Set<number>();

  const pushFile = (file: LoraFileEntry) => {
    const fields = resolveCivitaiFields(file.absolutePath, file.autoV2, catalog);
    const modelId = fields.civitaiModelId;
    const url = fields.previewUrl?.trim();
    const cached =
      typeof modelId === 'number' ? getCachedModel(origin, modelId) : null;
    const previewMissing = cached?.previewMissing === true;
    const onDisk = Boolean(fields.previewLocalUrl);

    if (typeof modelId === 'number' && !seenId.has(modelId)) {
      seenId.add(modelId);
      coverage.push({
        modelId,
        resolved: onDisk || previewMissing || !url,
      });
    }

    if (!url || onDisk || previewMissing) return;
    if (seenUrl.has(url)) return;
    seenUrl.add(url);
    targets.push({
      url,
      modelId: fields.civitaiModelId,
    });
  };

  const groups = [
    getConfiguredLoraIndexCachedHashes() ?? getConfiguredLoraIndex(),
    getConfiguredCheckpointIndexCachedHashes() ??
      getConfiguredCheckpointIndex(),
  ];
  let stepped = 0;
  for (const index of groups) {
    if (!index) continue;
    for (const file of index.files) {
      pushFile(file);
      stepped += 1;
      // Each file may JSON.parse a catalog page. Yield so Browse can paint.
      if (stepped % 24 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }

  setActiveLibraryPreviewCoverage(coverage);
  prioritizeLibraryPreviews(targets);
}

export async function listManagedLoras(opts?: {
  force?: boolean;
}): Promise<ModelManagerListDto> {
  // Folder walks yield to the event loop. `force` waits for a new walk;
  // otherwise a stale cache is used immediately.
  await ensureLoraIndex({ force: opts?.force === true });
  const hashed =
    getConfiguredLoraIndexCachedHashes() ?? getConfiguredLoraIndex();
  if (!hashed) {
    return {
      folder: null,
      files: [],
      fileCount: 0,
      lastRefreshAt: getLoraIndexLastRefreshAt(),
    };
  }

  setMainActivityJob('lora-refs', 'Matching LoRA references in wildcards…');
  await new Promise<void>((resolve) => setImmediate(resolve));
  let reverse: Map<string, LoraReverseRefDto[]>;
  let unused: Set<string>;
  try {
    ({ reverse, unused } = getCachedLibraryRefs(hashed));
  } finally {
    setMainActivityJob('lora-refs', null);
  }
  // One shared AutoV2 → catalog map (built once), not a scan per file.
  const catalog = getAutoV2CatalogIndex();

  const files = hashed.files
    .map((file) =>
      toListEntry(file, hashed.root, catalog, {
        referenceCount: reverse.get(file.absolutePath)?.length ?? 0,
        unused: unused.has(file.absolutePath.toLowerCase()),
      }),
    )
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  // Background: hash any LoRAs still missing AutoV2 (sidecars / cache first).
  startModelHashWarm('LORA', () => getConfiguredLoraIndex());
  maybePrioritizeActiveLibraryPreviews();

  return {
    folder: hashed.root,
    files,
    fileCount: files.length,
    lastRefreshAt: getLoraIndexLastRefreshAt(),
  };
}

export async function listManagedCheckpoints(opts?: {
  force?: boolean;
}): Promise<ModelManagerListDto> {
  await ensureCheckpointIndex({ force: opts?.force === true });
  const hashed =
    getConfiguredCheckpointIndexCachedHashes() ??
    getConfiguredCheckpointIndex();
  if (!hashed) {
    return { folder: null, files: [], fileCount: 0 };
  }
  const catalog = getAutoV2CatalogIndex();
  const files = hashed.files
    .map((file) => ({
      ...toListEntry(file, hashed.root, catalog),
      enabled: checkpointEnabledForRelativePath(file.relativePath),
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  // Background: hash checkpoints missing AutoV2 (sibling `.txt` sidecars first,
  // then full-file SHA for the rest). Persists to hash cache + rematches catalog.
  startModelHashWarm('Checkpoint', () => getConfiguredCheckpointIndex());
  maybePrioritizeActiveLibraryPreviews();

  return { folder: hashed.root, files, fileCount: files.length };
}

function issuesForLora(
  file: LoraFileEntry,
  unused: Set<string>,
  duplicateIssues: IssueDto[],
): IssueDto[] {
  const issues: IssueDto[] = [
    ...loraFileNameIssues(file.stem, file.relativePath),
  ];
  if (unused.has(file.absolutePath.toLowerCase())) {
    issues.push({
      severity: 'warning',
      code: 'unused_lora',
      message: `LoRA on disk is not referenced by any wildcard file: \`${file.stem}\``,
      snippet: file.relativePath,
    });
  }
  const pathNorm = file.relativePath.replace(/\\/g, '/');
  for (const issue of duplicateIssues) {
    if (issue.snippet?.replace(/\\/g, '/') === pathNorm) {
      issues.push(issue);
    }
  }
  return issues;
}

export async function getLoraManagerDetail(
  relativePath: string,
): Promise<LoraManagerDetailDto> {
  const index = await requireConfiguredLoraIndex();
  attachCachedAutoV2Hashes(index);
  const file = index.files.find(
    (f) =>
      f.relativePath.replace(/\\/g, '/') === relativePath.replace(/\\/g, '/'),
  );
  if (!file) throw new Error(`LoRA not found: ${relativePath}`);

  const { reverse, unused } = getCachedLibraryRefs(index);
  const reverseRefs = reverse.get(file.absolutePath) ?? [];
  const duplicateIssues = validateDuplicateLoraAutoV2(index);
  const entry = toDetailEntry(file, index.root, {
    referenceCount: reverseRefs.length,
    unused: unused.has(file.absolutePath.toLowerCase()),
  });

  if (entry.previewUrl && !entry.previewLocalUrl) {
    void requestCachedPreview(
      entry.previewUrl,
      PREVIEW_PRIORITY.library,
      entry.civitaiModelId,
    );
  }

  return {
    file: entry,
    reverseRefs,
    issues: issuesForLora(file, unused, duplicateIssues),
  };
}

/**
 * Best documented `<lora:…>` from the wildcards library for clipboard copy
 * (prefer `#` URL / range comments + richest weights).
 */
export async function getDefinedLoraReference(
  relativePath: string,
): Promise<DefinedLoraReferenceDto | null> {
  const index = await requireConfiguredLoraIndex();
  const file = index.files.find(
    (f) =>
      f.relativePath.replace(/\\/g, '/') === relativePath.replace(/\\/g, '/'),
  );
  if (!file) throw new Error(`LoRA not found: ${relativePath}`);

  const found = findDefinedLoraReference(
    readLibraryFiles().map((f) => ({
      relativePath: f.relativePath,
      text: f.text,
    })),
    index,
    file.absolutePath,
  );
  if (!found) return null;
  return {
    tag: found.tag,
    block: found.block,
    relativePath: found.relativePath,
    line: found.line,
    hasDocComments: found.hasDocComments,
  };
}

export async function getCheckpointManagerDetail(
  relativePath: string,
): Promise<CheckpointManagerDetailDto> {
  const index = await requireConfiguredCheckpointIndex();
  attachCachedAutoV2Hashes(index);
  const file = index.files.find(
    (f) =>
      f.relativePath.replace(/\\/g, '/') === relativePath.replace(/\\/g, '/'),
  );
  if (!file) throw new Error(`Checkpoint not found: ${relativePath}`);
  const entry = {
    ...toDetailEntry(file, index.root, { resolveMasters: true }),
    enabled: checkpointEnabledForRelativePath(file.relativePath),
  };
  if (entry.previewUrl && !entry.previewLocalUrl) {
    void requestCachedPreview(
      entry.previewUrl,
      PREVIEW_PRIORITY.library,
      entry.civitaiModelId,
    );
  }
  return { file: entry };
}

const MODEL_SIDECAR_EXTS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.json',
  '.txt',
];

function deleteSameStemSidecars(modelAbsolutePath: string): number {
  const dir = path.dirname(modelAbsolutePath);
  const base = path.basename(modelAbsolutePath, path.extname(modelAbsolutePath));
  let count = 0;
  for (const ext of MODEL_SIDECAR_EXTS) {
    const abs = path.join(dir, `${base}${ext}`);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        fs.unlinkSync(abs);
        count += 1;
      }
    } catch {
      // ignore
    }
  }
  return count;
}

/**
 * Move benchmark sample images into `{benchmarkRoot}/!Deleted/…` (preserving
 * relative paths). Never deletes outside the Checkpoint Benchmark folder.
 */
function quarantineMasterImagesForCheckpoint(opts: {
  absolutePath: string;
  stem: string;
  autoV2?: string;
}): number {
  const masters =
    resolveCheckpointMasterImages({
      checkpointAbsolutePath: opts.absolutePath,
      stem: path.basename(opts.stem),
      autoV2: opts.autoV2,
    }) ?? null;
  if (!masters) return 0;
  const mastersRootRaw = getActiveLibrary().benchmarkOutputFolder;
  if (!mastersRootRaw) {
    clearCheckpointMasterCache({
      absolutePath: opts.absolutePath,
      autoV2: opts.autoV2,
    });
    return 0;
  }
  const mastersRoot = path.resolve(mastersRootRaw);
  const deletedRoot = path.join(mastersRoot, MASTERS_DELETED_FOLDER);
  let count = 0;
  const all = [masters.masterAbsolutePath, ...masters.genAbsolutePaths];
  for (const abs of all) {
    try {
      const resolved = path.resolve(abs);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;
      const rel = path.relative(mastersRoot, resolved);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
      // Already quarantined — leave in place.
      if (
        rel === MASTERS_DELETED_FOLDER ||
        rel.startsWith(`${MASTERS_DELETED_FOLDER}${path.sep}`)
      ) {
        continue;
      }
      let dest = path.join(deletedRoot, rel);
      if (fs.existsSync(dest)) {
        const ext = path.extname(dest);
        const base = dest.slice(0, dest.length - ext.length);
        let n = 1;
        while (fs.existsSync(`${base}__${n}${ext}`)) n += 1;
        dest = `${base}__${n}${ext}`;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(resolved, dest);
      count += 1;
    } catch {
      // ignore per-file failures
    }
  }
  clearCheckpointMasterCache({
    absolutePath: opts.absolutePath,
    autoV2: opts.autoV2,
  });
  return count;
}

/**
 * Delete one or more checkpoints under the configured folder, including local
 * sidecars; quarantine benchmark samples into `!Deleted`; clear rating/hash/link;
 * archive Civitai.
 */
export async function deleteCheckpoints(
  relativePaths: string[],
): Promise<DeleteCheckpointsResultDto> {
  const index = await requireConfiguredCheckpointIndex();

  const result: DeleteCheckpointsResultDto = {
    deleted: [],
    deletedMasterImages: 0,
    archivedCivitaiModelIds: [],
    errors: [],
  };
  const archived = new Set<number>();

  for (const raw of relativePaths) {
    const relativePath = raw.trim().replace(/\\/g, '/');
    if (!relativePath) continue;
    try {
      const file =
        index.files.find((f) => f.relativePath === relativePath) ??
        index.files.find(
          (f) => f.relativePath.toLowerCase() === relativePath.toLowerCase(),
        );
      if (!file) {
        result.errors.push({
          relativePath,
          message: 'Checkpoint not found in index',
        });
        continue;
      }
      if (!isManagedModelPath(file.absolutePath)) {
        result.errors.push({
          relativePath,
          message: 'Path is outside the configured checkpoint folder',
        });
        continue;
      }

      const civitai = resolveCivitaiFields(
        file.absolutePath,
        file.autoV2,
        getAutoV2CatalogIndex(),
      );
      const modelId = civitai.civitaiModelId;

      result.deletedMasterImages += quarantineMasterImagesForCheckpoint({
        absolutePath: file.absolutePath,
        stem: file.stem,
        autoV2: file.autoV2,
      });

      deleteSameStemSidecars(file.absolutePath);
      if (fs.existsSync(file.absolutePath)) {
        fs.unlinkSync(file.absolutePath);
      }

      removeCachedFileEntry(file.absolutePath);
      clearManualCivitaiLink({
        absolutePath: file.absolutePath,
        autoV2: file.autoV2,
      });
      clearModelRating({
        absolutePath: file.absolutePath,
        autoV2: file.autoV2,
      });
      clearCheckpointIgnored(file.absolutePath);

      if (typeof modelId === 'number' && Number.isFinite(modelId)) {
        unmarkCivitaiModelInstalled(modelId);
        archiveCivitaiModel(modelId);
        archived.add(modelId);
      }

      result.deleted.push(file.relativePath);
    } catch (e) {
      result.errors.push({
        relativePath,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  invalidateCheckpointIndexCache();
  result.archivedCivitaiModelIds = [...archived];
  return result;
}

/** True when another LoRA (not in this delete batch) still owns the same hash/model. */
function otherLoraStillOwnsCivitai(
  index: LoraIndex,
  file: LoraFileEntry,
  modelId: number | undefined,
  deletingNorm: Set<string>,
  catalog: Map<string, AutoV2IndexRef>,
): boolean {
  const hash = file.autoV2?.trim().toUpperCase() ?? '';
  for (const other of index.files) {
    if (
      other.absolutePath.replace(/\\/g, '/').toLowerCase() ===
      file.absolutePath.replace(/\\/g, '/').toLowerCase()
    ) {
      continue;
    }
    const otherRel = other.relativePath.replace(/\\/g, '/').toLowerCase();
    if (deletingNorm.has(otherRel)) continue;
    if (hash && other.autoV2?.trim().toUpperCase() === hash) return true;
    if (modelId != null) {
      const otherFields = resolveCivitaiFields(
        other.absolutePath,
        other.autoV2,
        catalog,
      );
      if (otherFields.civitaiModelId === modelId) return true;
    }
  }
  return false;
}

/**
 * Delete one or more LoRAs under the configured folder, including local
 * sidecars; strip matching `<lora:…>` tags from wildcards; clear rating/hash/link;
 * archive Civitai only when no remaining on-disk copy still owns that model.
 */
export async function deleteLoras(
  relativePaths: string[],
): Promise<DeleteLorasResultDto> {
  const index = await requireConfiguredLoraIndex();

  const result: DeleteLorasResultDto = {
    deleted: [],
    editedWildcardFiles: 0,
    removedTagOccurrences: 0,
    archivedCivitaiModelIds: [],
    errors: [],
  };
  const archived = new Set<number>();
  const deletingNorm = new Set(
    relativePaths
      .map((p) => p.trim().replace(/\\/g, '/').toLowerCase())
      .filter(Boolean),
  );
  const catalog = getAutoV2CatalogIndex();
  const libraryFiles = (() => {
    try {
      return libraryService.loadAllFiles();
    } catch {
      return [];
    }
  })();

  for (const raw of relativePaths) {
    const relativePath = raw.trim().replace(/\\/g, '/');
    if (!relativePath) continue;
    try {
      const file =
        index.files.find((f) => f.relativePath === relativePath) ??
        index.files.find(
          (f) => f.relativePath.toLowerCase() === relativePath.toLowerCase(),
        );
      if (!file) {
        result.errors.push({
          relativePath,
          message: 'LoRA not found in index',
        });
        continue;
      }
      if (!isManagedModelPath(file.absolutePath)) {
        result.errors.push({
          relativePath,
          message: 'Path is outside the configured LoRA folder',
        });
        continue;
      }

      const civitai = resolveCivitaiFields(
        file.absolutePath,
        file.autoV2,
        catalog,
      );
      const modelId = civitai.civitaiModelId;
      const keepCivitai = otherLoraStillOwnsCivitai(
        index,
        file,
        typeof modelId === 'number' && Number.isFinite(modelId)
          ? modelId
          : undefined,
        deletingNorm,
        catalog,
      );

      const edits: Array<{ relativePath: string; text: string }> = [];
      let tagCount = 0;
      for (const lib of libraryFiles) {
        const { text, count } = removeLoraReferences(
          lib.text,
          file.absolutePath,
          index,
        );
        if (count > 0) {
          edits.push({ relativePath: lib.relativePath, text });
          tagCount += count;
          lib.text = text;
        }
      }
      if (edits.length > 0) {
        applyMutation(
          `Delete LoRA ${file.relativePath} (remove wildcard refs)`,
          edits,
        );
        result.editedWildcardFiles += edits.length;
        result.removedTagOccurrences += tagCount;
      }

      deleteSameStemSidecars(file.absolutePath);
      if (fs.existsSync(file.absolutePath)) {
        fs.unlinkSync(file.absolutePath);
      }

      removeCachedFileEntry(file.absolutePath);
      // When a hash-identical sibling remains, only clear this path — keep
      // AutoV2-keyed rating/link for the surviving copy.
      clearManualCivitaiLink({
        absolutePath: file.absolutePath,
        autoV2: keepCivitai ? null : file.autoV2,
      });
      clearModelRating({
        absolutePath: file.absolutePath,
        autoV2: keepCivitai ? null : file.autoV2,
      });
      removeIgnoredUnusedLora(file.relativePath);

      if (
        !keepCivitai &&
        typeof modelId === 'number' &&
        Number.isFinite(modelId)
      ) {
        unmarkCivitaiModelInstalled(modelId);
        archiveCivitaiModel(modelId);
        archived.add(modelId);
      }

      result.deleted.push(file.relativePath);
    } catch (e) {
      result.errors.push({
        relativePath,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  invalidateLoraIndexCache();
  result.archivedCivitaiModelIds = [...archived];
  return result;
}

/** True when `absolutePath` resolves under the configured LoRA or checkpoint root. */
export function isManagedModelPath(absolutePath: string): boolean {
  const roots = [
    getConfiguredLoraIndex()?.root,
    getConfiguredCheckpointIndex()?.root,
  ].filter(Boolean) as string[];
  const resolved = path.resolve(absolutePath);
  return roots.some((root) => {
    const rel = path.relative(path.resolve(root), resolved);
    return (
      path.resolve(resolved) === path.resolve(root) ||
      (Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel))
    );
  });
}

/** Data URL for a sidecar image under the LoRA/checkpoint folder (capped). */
export function readModelSidecarImageDataUrl(
  absolutePath: string,
): string | null {
  const resolved = path.resolve(absolutePath);
  if (!isManagedModelPath(resolved)) return null;
  try {
    const st = fs.statSync(resolved);
    if (!st.isFile() || st.size <= 0 || st.size > 12 * 1024 * 1024) return null;
    const ext = path.extname(resolved).toLowerCase();
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : 'image/jpeg';
    const buf = fs.readFileSync(resolved);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
