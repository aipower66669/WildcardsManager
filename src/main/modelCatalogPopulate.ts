import { BrowserWindow } from 'electron';
import {
  collectAutoV2HashesFromVersions,
  pickCivitaiAutoV2,
  unionAutoV2Hashes,
} from '../domain/modelHash.js';
import { civitaiModelPageUrl } from '../domain/civitaiSnippet.js';
import {
  findCatalogMatchesByLocalFilename,
  type CatalogFilenameMatchCandidate,
} from '../domain/civitaiFilenameMatch.js';
import { stripLoraExtension } from '../domain/lora.js';
import type { ModelCatalogPopulateProgressDto } from '../shared/contracts.js';
import { IPC } from '../shared/contracts.js';
import {
  getCivitaiModel,
  getCivitaiModelVersionByHash,
  primaryPreviewUrl,
  searchCivitaiModels,
  versionPreviewUrl,
  type CivitaiModel,
  type CivitaiModelVersion,
} from './civitaiClient.js';
import {
  forEachCachedModelOfOrigin,
  findCachedModelByAutoV2,
  getAutoV2CatalogIndex,
  getCachedModel,
  insertCachedModelsIfAbsent,
  patchCachedModel,
  rememberAllAutoV2InCatalogIndex,
  type CachedCivitaiModel,
} from './civitaiCatalogCache.js';
import { hasCachedCivitaiPreview } from './civitaiPreviewCache.js';
import {
  PREVIEW_PRIORITY,
  requestCachedPreview,
} from './civitaiPreviewQueue.js';
import {
  getConfiguredLoraIndex,
  getConfiguredLoraIndexCachedHashes,
} from './loraService.js';
import {
  getConfiguredCheckpointIndex,
  getConfiguredCheckpointIndexCachedHashes,
} from './checkpointService.js';
import { getCivitaiOrigin } from './settingsStore.js';
import type { LoraFileEntry, LoraIndex } from '../domain/lora.js';
import { hashNeedsCatalogMatch } from '../domain/civitaiPopulateSkip.js';
import {
  isModelResolveSettled,
  markModelFolderResolved,
} from './modelResolveState.js';
import {
  isKnownModelHashMiss,
  isPermanentCivitaiHashMiss,
  rememberModelHashMiss,
  clearModelHashMiss,
  flushModelHashMissCacheSync,
} from './modelHashMissCache.js';

/**
 * Match local AutoV2 → catalog Map, then by-hash once for remaining hashes
 * that are not in the persistent miss cache. Hits enrich `autoV2Hashes` so
 * sibling versions match without further API calls.
 */

export type ModelPopulateKind = 'LORA' | 'Checkpoint';

type Active = {
  cancelled: boolean;
  generation: number;
  kind: ModelPopulateKind;
};

let active: Active | null = null;
const ranThisSession = new Set<ModelPopulateKind>();
let generation = 0;
let lastProgress: ModelCatalogPopulateProgressDto | null = null;

function emit(progress: ModelCatalogPopulateProgressDto): void {
  lastProgress = progress;
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(IPC.modelFilesPopulateProgress, progress);
    } catch {
      // ignore
    }
  }
}

function queuePreview(url: string | undefined, modelId?: number): boolean {
  const trimmed = url?.trim();
  if (!trimmed) return false;
  if (hasCachedCivitaiPreview(trimmed)) return false;
  void requestCachedPreview(trimmed, PREVIEW_PRIORITY.library, modelId);
  return true;
}

function indexForKind(kind: ModelPopulateKind): LoraIndex | null {
  const raw =
    kind === 'LORA'
      ? getConfiguredLoraIndex()
      : getConfiguredCheckpointIndex();
  if (raw?.byAutoV2 && raw.byAutoV2.size > 0) return raw;
  if (kind === 'LORA') {
    return getConfiguredLoraIndexCachedHashes() ?? raw;
  }
  return getConfiguredCheckpointIndexCachedHashes() ?? raw;
}

function labelFor(kind: ModelPopulateKind): string {
  return kind === 'LORA' ? 'lora' : 'checkpoint';
}

function hashesFromVersion(version: CivitaiModelVersion | undefined): string[] {
  const out: string[] = [];
  for (const file of version?.files ?? []) {
    const h = pickCivitaiAutoV2(file.hashes);
    if (h) out.push(h);
  }
  return out;
}

function ensureCatalogModel(opts: {
  modelId: number;
  name: string;
  type?: string;
  nsfw?: boolean;
  mapHashes: string[];
  previewUrl?: string;
  versionId?: number;
  versionName?: string;
  fileName?: string;
  baseModel?: string;
}): CachedCivitaiModel {
  const origin = getCivitaiOrigin();
  const hashes = unionAutoV2Hashes(opts.mapHashes);
  const existing = getCachedModel(origin, opts.modelId);
  if (existing) {
    patchCachedModel(origin, opts.modelId, {
      ...(opts.previewUrl && !existing.previewUrl
        ? { previewUrl: opts.previewUrl, previewMissing: false }
        : {}),
      ...(!existing.autoV2 && hashes[0] ? { autoV2: hashes[0] } : {}),
      ...(!existing.fileName && opts.fileName
        ? { fileName: opts.fileName }
        : {}),
      autoV2Hashes: hashes,
    });
    const row = getCachedModel(origin, opts.modelId) ?? existing;
    rememberAllAutoV2InCatalogIndex(row);
    return row;
  }

  const now = new Date().toISOString();
  const row: CachedCivitaiModel = {
    id: opts.modelId,
    origin,
    name: opts.name,
    type: opts.type ?? 'Checkpoint',
    nsfw: Boolean(opts.nsfw),
    tags: [],
    trainedWords: [],
    baseModel: opts.baseModel,
    versionId: opts.versionId,
    versionName: opts.versionName,
    fileName: opts.fileName,
    previewUrl: opts.previewUrl,
    previewMissing: !opts.previewUrl,
    autoV2: hashes[0],
    autoV2Hashes: hashes,
    pageUrl: civitaiModelPageUrl(origin, opts.modelId, opts.name),
    earlyAccess: false,
    firstSeenAt: now,
    updatedAt: now,
  };
  insertCachedModelsIfAbsent([row]);
  const saved = getCachedModel(origin, opts.modelId) ?? row;
  rememberAllAutoV2InCatalogIndex(saved);
  return saved;
}

export type RematchFilenameCandidate = {
  civitaiModelId: number;
  civitaiName: string;
  civitaiPageUrl: string;
  previewUrl?: string;
  matchedFileName: string;
  matchKind: 'exact' | 'similar';
};

export type RematchByHashResult = {
  matched: boolean;
  civitaiModelId?: number;
  civitaiName?: string;
  civitaiPageUrl?: string;
  previewUrl?: string;
  reason?: string;
  /**
   * Filename-based suggestions after a hash miss. Never auto-applied —
   * the UI must confirm before linking.
   */
  filenameCandidates?: RematchFilenameCandidate[];
};

function toFilenameCandidateDto(
  c: CatalogFilenameMatchCandidate,
): RematchFilenameCandidate {
  return {
    civitaiModelId: c.modelId,
    civitaiName: c.modelName,
    civitaiPageUrl: c.pageUrl,
    previewUrl: c.previewUrl,
    matchedFileName: c.matchedFileName,
    matchKind: c.matchKind,
  };
}

/**
 * Manual Rematch only: after hash miss, find catalog / API candidates by
 * local filename. Never called from automatic populate paths.
 */
async function findFilenameRematchCandidates(opts: {
  localStem: string;
  kind: ModelPopulateKind;
}): Promise<RematchFilenameCandidate[]> {
  const origin = getCivitaiOrigin();
  const catalogModels: CachedCivitaiModel[] = [];
  await forEachCachedModelOfOrigin(origin, (model) => {
    catalogModels.push(model);
  });

  const fromCatalog = findCatalogMatchesByLocalFilename(
    catalogModels,
    opts.localStem,
    { type: opts.kind, max: 12 },
  );
  if (fromCatalog.length > 0) {
    return fromCatalog.map(toFilenameCandidateDto);
  }

  // Catalog miss (or AIR-only cards without stored fileName) — ask Civitai
  // search, then score API results the same way. Still confirmation-only.
  const query = stripLoraExtension(opts.localStem.split(/[/\\]/).pop() ?? opts.localStem)
    .replace(/[_-]\d{3,}$/, '')
    .trim();
  if (!query) return [];

  try {
    const result = await searchCivitaiModels({
      type: opts.kind,
      query,
      limit: 20,
      nsfw: true,
      sort: 'Most Downloaded',
    });
    const apiModels = result.items.map((item) => {
      const versions = item.modelVersions ?? [];
      const primary =
        versions[0]?.files?.find((f) => f.primary) ?? versions[0]?.files?.[0];
      return {
        id: item.id,
        name: item.name,
        type: item.type,
        pageUrl: civitaiModelPageUrl(origin, item.id, item.name),
        previewUrl: primaryPreviewUrl(item) ?? undefined,
        fileName: primary?.name,
        versions: versions.map((v) => ({
          fileName: v.files?.find((f) => f.primary)?.name ?? v.files?.[0]?.name,
          files: (v.files ?? []).map((f) => ({ name: f.name })),
        })),
      };
    });
    return findCatalogMatchesByLocalFilename(apiModels, opts.localStem, {
      type: opts.kind,
      max: 12,
    }).map(toFilenameCandidateDto);
  } catch {
    return [];
  }
}

/**
 * One-shot by-hash rematch for a single local file (manual UI action).
 * Clears any prior miss-cache entry for this hash. Does not replace an
 * existing previewUrl on a catalog card (avoids re-downloading covers).
 *
 * On hash miss, optionally returns filename candidates for user confirmation
 * — never auto-links by filename.
 */
export async function rematchLocalModelByHash(opts: {
  autoV2: string;
  kind?: ModelPopulateKind;
  /** Local relative path or stem — enables filename fallback candidates. */
  localStem?: string;
}): Promise<RematchByHashResult> {
  const autoV2 = opts.autoV2.trim().toUpperCase();
  if (!/^[0-9A-F]{10}$/.test(autoV2)) {
    return { matched: false, reason: 'Invalid or missing AutoV2 hash' };
  }

  clearModelHashMiss(autoV2);
  flushModelHashMissCacheSync();

  const existing = findCachedModelByAutoV2(autoV2);
  if (existing) {
    if (queuePreview(existing.previewUrl, existing.id)) {
      // queued only when not already on disk
    }
    return {
      matched: true,
      civitaiModelId: existing.id,
      civitaiName: existing.name,
      civitaiPageUrl: existing.pageUrl,
      previewUrl: existing.previewUrl,
    };
  }

  const kind = opts.kind ?? 'LORA';
  const localStem = opts.localStem?.trim() || '';

  const withFilenameFallback = async (
    reason: string,
  ): Promise<RematchByHashResult> => {
    if (!localStem) {
      return { matched: false, reason };
    }
    const filenameCandidates = await findFilenameRematchCandidates({
      localStem,
      kind,
    });
    if (filenameCandidates.length === 0) {
      return { matched: false, reason };
    }
    return {
      matched: false,
      reason: `${reason}. Filename match candidates need confirmation.`,
      filenameCandidates,
    };
  };

  try {
    const version = await getCivitaiModelVersionByHash(autoV2);
    const modelId = version.modelId;
    if (!modelId) {
      rememberModelHashMiss(autoV2);
      flushModelHashMissCacheSync();
      return withFilenameFallback('Hash not found on Civitai');
    }

    const versionHashes = new Set<string>([
      autoV2,
      ...hashesFromVersion(version),
    ]);
    let previewUrl = versionPreviewUrl(version) ?? undefined;
    const primaryFile =
      version.files?.find((f) => f.primary) ?? version.files?.[0];

    try {
      const full = await getCivitaiModel(modelId);
      for (const h of collectAutoV2HashesFromVersions(full.modelVersions)) {
        versionHashes.add(h);
      }
      // Prefer existing catalog cover; only fill preview when card has none.
      const prior = getCachedModel(getCivitaiOrigin(), modelId);
      previewUrl =
        prior?.previewUrl ??
        previewUrl ??
        primaryPreviewUrl(full) ??
        undefined;
      const row = ensureCatalogModel({
        modelId,
        name: full.name ?? version.model?.name ?? `Model ${modelId}`,
        type:
          full.type ??
          version.model?.type ??
          (kind === 'Checkpoint' ? 'Checkpoint' : 'LORA'),
        nsfw: full.nsfw ?? version.model?.nsfw,
        mapHashes: [...versionHashes],
        previewUrl,
        versionId: version.id,
        versionName: version.name,
        fileName: primaryFile?.name,
        baseModel: version.baseModel,
      });
      patchCachedModel(getCivitaiOrigin(), modelId, {
        autoV2HashesExpandedAt: new Date().toISOString(),
      });
      queuePreview(row.previewUrl ?? previewUrl, row.id);
      return {
        matched: true,
        civitaiModelId: row.id,
        civitaiName: row.name,
        civitaiPageUrl: row.pageUrl,
        previewUrl: row.previewUrl ?? previewUrl,
      };
    } catch {
      const row = ensureCatalogModel({
        modelId,
        name: version.model?.name ?? `Model ${modelId}`,
        type:
          version.model?.type ??
          (kind === 'Checkpoint' ? 'Checkpoint' : 'LORA'),
        nsfw: version.model?.nsfw,
        mapHashes: [...versionHashes],
        previewUrl,
        versionId: version.id,
        versionName: version.name,
        fileName: primaryFile?.name,
        baseModel: version.baseModel,
      });
      queuePreview(row.previewUrl ?? previewUrl, row.id);
      return {
        matched: true,
        civitaiModelId: row.id,
        civitaiName: row.name,
        civitaiPageUrl: row.pageUrl,
        previewUrl: row.previewUrl ?? previewUrl,
      };
    }
  } catch (e) {
    if (isPermanentCivitaiHashMiss(e)) {
      rememberModelHashMiss(autoV2);
      flushModelHashMissCacheSync();
      return withFilenameFallback('Hash not found on Civitai');
    }
    return withFilenameFallback(
      e instanceof Error ? e.message : String(e),
    );
  }
}

/** Match local hashes to the catalog Map; by-hash once for unknown misses. */
export function startModelCatalogPopulate(
  kind: ModelPopulateKind,
  opts?: { force?: boolean },
): void {
  if (active) {
    if (lastProgress) emit(lastProgress);
    return;
  }
  if (ranThisSession.has(kind) && !opts?.force) {
    if (lastProgress?.kind === kind) emit(lastProgress);
    return;
  }
  const existingIndex =
    kind === 'LORA'
      ? getConfiguredLoraIndex()
      : getConfiguredCheckpointIndex();
  if (
    !opts?.force &&
    existingIndex &&
    isModelResolveSettled(kind, existingIndex.files.length)
  ) {
    ranThisSession.add(kind);
    console.info(
      `[civitai] ${labelFor(kind)} populate: skipped (${existingIndex.files.length} already resolved)`,
    );
    emit({
      kind,
      status: 'done',
      done: existingIndex.files.length,
      total: existingIndex.files.length,
      matched: existingIndex.files.length,
      fetchedMatch: 0,
      queuedPreviews: 0,
      skippedNoHash: 0,
      failed: 0,
    });
    return;
  }
  ranThisSession.add(kind);

  const sync: Active = {
    cancelled: false,
    generation: ++generation,
    kind,
  };
  active = sync;

  void (async () => {
    let done = 0;
    let matched = 0;
    let fetchedMatch = 0;
    let queuedPreviews = 0;
    let skippedNoHash = 0;
    let failed = 0;

    try {
      const index = indexForKind(kind);
      if (!index) {
        emit({
          kind,
          status: 'done',
          done: 0,
          total: 0,
          matched: 0,
          fetchedMatch: 0,
          queuedPreviews: 0,
          skippedNoHash: 0,
          failed: 0,
        });
        return;
      }

      const files = index.files;
      const total = files.length;
      const catalogIndex = getAutoV2CatalogIndex();

      const needsApi: Array<{ file: LoraFileEntry; autoV2: string }> = [];
      const seenHash = new Set<string>();
      for (const file of files) {
        const autoV2 = file.autoV2?.trim().toUpperCase();
        if (!autoV2) {
          skippedNoHash += 1;
          done += 1;
          continue;
        }
        if (seenHash.has(autoV2)) {
          done += 1;
          if (catalogIndex.has(autoV2)) matched += 1;
          else if (isKnownModelHashMiss(autoV2)) failed += 1;
          continue;
        }
        seenHash.add(autoV2);
        if (!hashNeedsCatalogMatch(autoV2, catalogIndex, isKnownModelHashMiss)) {
          if (catalogIndex.has(autoV2)) matched += 1;
          else failed += 1;
          done += 1;
          continue;
        }
        needsApi.push({ file, autoV2 });
      }

      if (needsApi.length === 0) {
        markModelFolderResolved(kind, total);
        console.info(
          `[civitai] ${labelFor(kind)} populate: skipped (${total} already resolved)`,
        );
        emit({
          kind,
          status: 'done',
          done: total,
          total,
          matched,
          fetchedMatch: 0,
          queuedPreviews: 0,
          skippedNoHash,
          failed,
        });
        return;
      }

      emit({
        kind,
        status: 'running',
        done,
        total,
        matched,
        fetchedMatch: 0,
        queuedPreviews: 0,
        skippedNoHash,
        failed,
        phase: 'fetching',
      });

      const enrichedModels = new Set<number>();

      for (const { file, autoV2 } of needsApi) {
        if (sync.cancelled || sync.generation !== generation) break;

        const already = findCachedModelByAutoV2(autoV2);
        if (already) {
          matched += 1;
          if (queuePreview(already.previewUrl, already.id)) {
            queuedPreviews += 1;
          }
          done += 1;
          if (done % 16 === 0) {
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
          continue;
        }

        if (isKnownModelHashMiss(autoV2)) {
          failed += 1;
          done += 1;
          if (done % 16 === 0) {
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
          continue;
        }

        try {
          emit({
            kind,
            status: 'running',
            done,
            total,
            matched,
            fetchedMatch,
            queuedPreviews,
            skippedNoHash,
            failed,
            phase: 'fetching',
            currentStem: file.stem,
          });

          const version = await getCivitaiModelVersionByHash(autoV2);
          const modelId = version.modelId;
          if (!modelId) {
            rememberModelHashMiss(autoV2);
            failed += 1;
            done += 1;
            continue;
          }

          const versionHashes = new Set<string>([
            autoV2,
            ...hashesFromVersion(version),
          ]);
          let previewUrl = versionPreviewUrl(version) ?? undefined;
          const primaryFile =
            version.files?.find((f) => f.primary) ?? version.files?.[0];

          if (!enrichedModels.has(modelId)) {
            try {
              const full: CivitaiModel = await getCivitaiModel(modelId);
              enrichedModels.add(modelId);
              for (const h of collectAutoV2HashesFromVersions(
                full.modelVersions,
              )) {
                versionHashes.add(h);
              }
              previewUrl =
                previewUrl ?? primaryPreviewUrl(full) ?? undefined;
              const row = ensureCatalogModel({
                modelId,
                name: full.name ?? version.model?.name ?? `Model ${modelId}`,
                type:
                  full.type ??
                  version.model?.type ??
                  (kind === 'Checkpoint' ? 'Checkpoint' : 'LORA'),
                nsfw: full.nsfw ?? version.model?.nsfw,
                mapHashes: [...versionHashes],
                previewUrl,
                versionId: version.id,
                versionName: version.name,
                fileName: primaryFile?.name,
                baseModel: version.baseModel,
              });
              if (queuePreview(row.previewUrl ?? previewUrl, row.id)) {
                queuedPreviews += 1;
              }
            } catch {
              const row = ensureCatalogModel({
                modelId,
                name: version.model?.name ?? `Model ${modelId}`,
                type:
                  version.model?.type ??
                  (kind === 'Checkpoint' ? 'Checkpoint' : 'LORA'),
                nsfw: version.model?.nsfw,
                mapHashes: [...versionHashes],
                previewUrl,
                versionId: version.id,
                versionName: version.name,
                fileName: primaryFile?.name,
                baseModel: version.baseModel,
              });
              if (queuePreview(row.previewUrl ?? previewUrl, row.id)) {
                queuedPreviews += 1;
              }
            }
          } else {
            const origin = getCivitaiOrigin();
            const row =
              getCachedModel(origin, modelId) ??
              ensureCatalogModel({
                modelId,
                name: version.model?.name ?? `Model ${modelId}`,
                type:
                  version.model?.type ??
                  (kind === 'Checkpoint' ? 'Checkpoint' : 'LORA'),
                nsfw: version.model?.nsfw,
                mapHashes: [...versionHashes],
                previewUrl,
                versionId: version.id,
                versionName: version.name,
                fileName: primaryFile?.name,
                baseModel: version.baseModel,
              });
            patchCachedModel(origin, modelId, {
              autoV2Hashes: [...versionHashes],
            });
            rememberAllAutoV2InCatalogIndex(
              getCachedModel(origin, modelId) ?? row,
            );
            if (queuePreview(row.previewUrl ?? previewUrl, row.id)) {
              queuedPreviews += 1;
            }
          }

          fetchedMatch += 1;
          matched += 1;
        } catch (e) {
          if (isPermanentCivitaiHashMiss(e)) {
            rememberModelHashMiss(autoV2);
          }
          failed += 1;
        }

        done += 1;
        if (done === total || done % 3 === 0) {
          emit({
            kind,
            status: 'running',
            done,
            total,
            matched,
            fetchedMatch,
            queuedPreviews,
            skippedNoHash,
            failed,
            phase: 'fetching',
            currentStem: file.stem,
          });
        }
      }

      flushModelHashMissCacheSync();
      if (!sync.cancelled && sync.generation === generation) {
        markModelFolderResolved(kind, total);
      }

      console.info(
        `[civitai] ${labelFor(kind)} populate: ${done}/${total}` +
          ` matched=${matched} api=${fetchedMatch} fail=${failed}` +
          ` noHash=${skippedNoHash} previews+=${queuedPreviews}` +
          ` catalogIndex=${getAutoV2CatalogIndex().size} enrichedModels=${enrichedModels.size}`,
      );
      emit({
        kind,
        status: sync.cancelled ? 'cancelled' : 'done',
        done,
        total,
        matched,
        fetchedMatch,
        queuedPreviews,
        skippedNoHash,
        failed,
      });
    } catch (e) {
      emit({
        kind,
        status: 'error',
        done,
        total: done,
        matched,
        fetchedMatch,
        queuedPreviews,
        skippedNoHash,
        failed,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      if (active === sync) active = null;
    }
  })();
}

/** @deprecated Prefer startModelCatalogPopulate('LORA'). */
export function startLoraCatalogPopulate(opts?: { force?: boolean }): void {
  startModelCatalogPopulate('LORA', opts);
}

export function startCheckpointCatalogPopulate(opts?: {
  force?: boolean;
}): void {
  startModelCatalogPopulate('Checkpoint', opts);
}

export function cancelModelCatalogPopulate(): void {
  if (active) active.cancelled = true;
  generation += 1;
}

/** @deprecated Prefer cancelModelCatalogPopulate. */
export function cancelLoraCatalogPopulate(): void {
  cancelModelCatalogPopulate();
}
