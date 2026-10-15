import { BrowserWindow } from 'electron';
import { categoryIdFromTags } from '../domain/civitaiModelCategories.js';
import {
  collectAutoV2HashesFromVersions,
  unionAutoV2Hashes,
} from '../domain/modelHash.js';
import { snapshotsFromModelVersions } from '../domain/civitaiVersions.js';
import type { CivitaiCatalogVersionHashEnrichProgressDto } from '../shared/contracts.js';
import { IPC } from '../shared/contracts.js';
import {
  getCivitaiModelsByIds,
  type CivitaiModel,
} from './civitaiClient.js';
import { maybeUnarchiveForNewVersion } from './civitaiArchivePolicy.js';
import {
  findCachedModelByAutoV2,
  flushDirtyModelPagesSync,
  getCachedModel,
  patchCachedModel,
  type CachedCivitaiModel,
} from './civitaiCatalogCache.js';
import {
  getConfiguredCheckpointIndex,
  getConfiguredCheckpointIndexCachedHashes,
} from './checkpointService.js';
import {
  getConfiguredLoraIndex,
  getConfiguredLoraIndexCachedHashes,
} from './loraService.js';
import {
  getCivitaiOrigin,
  listMarkedInstalledCivitaiModels,
} from './settingsStore.js';

/**
 * Expand catalog cards that match the *active library* (local LoRA/checkpoint
 * AutoV2 hits + marked-installed) with hashes from all versions via
 * `GET /models?ids=…` (batched, ≤100 ids / request). Does **not** walk the
 * whole catalog cache, does **not** change previewUrl / re-download covers.
 * Skips Character-tagged matches.
 *
 * Re-fetches on a TTL so installed checkpoints learn newer Civitai versions —
 * tip-check alone only refreshes models that reappear in Newest.
 */

/** Re-fetch detail for library matches older than this. */
const VERSION_HASH_REFRESH_MS = 12 * 60 * 60 * 1000;
/** Avoid stacking enrich passes when tip-check fires often. */
const MIN_RUN_GAP_MS = 30 * 60 * 1000;
/** Civitai `ids` list page size. */
const ENRICH_ID_BATCH = 100;

let active: { cancelled: boolean } | null = null;
let lastRunAt = 0;

function emit(progress: CivitaiCatalogVersionHashEnrichProgressDto): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(IPC.civitaiCatalogVersionHashEnrichProgress, progress);
    } catch {
      // ignore
    }
  }
}

function needsVersionHashEnrich(
  model: CachedCivitaiModel,
  nowMs: number = Date.now(),
): boolean {
  const type = String(model.type ?? '').toLowerCase();
  if (type !== 'lora' && type !== 'checkpoint') return false;
  if (categoryIdFromTags(model.tags) === 'character') return false;
  if (!model.autoV2HashesExpandedAt) return true;
  const ts = Date.parse(model.autoV2HashesExpandedAt);
  if (!Number.isFinite(ts)) return true;
  return nowMs - ts >= VERSION_HASH_REFRESH_MS;
}

/** Catalog model ids tied to the active library’s on-disk models / marks. */
async function collectLibraryMatchedModelIds(
  _origin: string,
): Promise<Set<number>> {
  const ids = new Set<number>();

  const indexes = [
    getConfiguredLoraIndexCachedHashes() ?? getConfiguredLoraIndex(),
    getConfiguredCheckpointIndexCachedHashes() ??
      getConfiguredCheckpointIndex(),
  ];
  let stepped = 0;
  for (const index of indexes) {
    if (!index) continue;
    for (const file of index.files) {
      const hash = file.autoV2?.trim();
      if (!hash) continue;
      const hit = findCachedModelByAutoV2(hash);
      if (hit) ids.add(hit.id);
      stepped += 1;
      if (stepped % 24 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }

  for (const entry of listMarkedInstalledCivitaiModels()) {
    ids.add(entry.modelId);
  }

  return ids;
}

function libraryHasEnrichAnchors(_origin: string): boolean {
  if (listMarkedInstalledCivitaiModels().length > 0) {
    return true;
  }
  const indexes = [
    getConfiguredLoraIndexCachedHashes() ?? getConfiguredLoraIndex(),
    getConfiguredCheckpointIndexCachedHashes() ??
      getConfiguredCheckpointIndex(),
  ];
  for (const index of indexes) {
    if (!index) continue;
    if (index.files.some((file) => Boolean(file.autoV2?.trim()))) return true;
  }
  return false;
}

async function queueLibraryMatchedModels(origin: string): Promise<{
  queue: CachedCivitaiModel[];
  skippedCharacter: number;
}> {
  const matchedIds = await collectLibraryMatchedModelIds(origin);
  const queue: CachedCivitaiModel[] = [];
  let skippedCharacter = 0;
  let stepped = 0;

  for (const id of matchedIds) {
    stepped += 1;
    if (stepped % 16 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const model = getCachedModel(origin, id);
    if (!model) continue;
    if (categoryIdFromTags(model.tags) === 'character') {
      const type = String(model.type ?? '').toLowerCase();
      if (type === 'lora' || type === 'checkpoint') skippedCharacter += 1;
      continue;
    }
    if (needsVersionHashEnrich(model)) queue.push(model);
  }

  return { queue, skippedCharacter };
}

function applyEnrichFromApiModel(
  origin: string,
  entry: CachedCivitaiModel,
  full: CivitaiModel,
): void {
  const hashes = unionAutoV2Hashes(
    entry.autoV2 ? [entry.autoV2] : undefined,
    entry.autoV2Hashes,
    collectAutoV2HashesFromVersions(full.modelVersions),
  );
  const versions = snapshotsFromModelVersions(full.modelVersions);
  const latest = versions[0];
  const previousVersionId = entry.versionId;
  const now = new Date().toISOString();
  // Hash + version metadata — never patch previewUrl (avoids re-queueing covers).
  patchCachedModel(origin, entry.id, {
    ...(hashes[0] && !entry.autoV2 ? { autoV2: hashes[0] } : {}),
    autoV2Hashes: hashes,
    autoV2HashesExpandedAt: now,
    ...(latest
      ? {
          versionId: latest.id,
          versionName: latest.name,
          fileName: latest.fileName ?? entry.fileName,
          baseModel: latest.baseModel ?? entry.baseModel,
          autoV2: latest.autoV2 ?? entry.autoV2 ?? hashes[0],
        }
      : {}),
    ...(versions.length > 0 ? { versions } : {}),
  });
  if (
    latest &&
    previousVersionId != null &&
    latest.id !== previousVersionId
  ) {
    maybeUnarchiveForNewVersion({
      modelId: entry.id,
      type: entry.type,
      previousVersionId,
      nextVersionId: latest.id,
      autoV2: latest.autoV2 ?? entry.autoV2,
      autoV2Hashes: hashes,
      versions,
    });
  }
}

/**
 * Background pass: fill `autoV2Hashes` on library-matched non-Character
 * LORA/Checkpoint cards. Metadata only — existing preview URLs stay untouched.
 * Uses batched `ids` lookups (not one GET per model).
 */
export function startCatalogVersionHashEnrich(opts?: {
  force?: boolean;
}): void {
  if (active) return;
  const nowMs = Date.now();
  if (!opts?.force && nowMs - lastRunAt < MIN_RUN_GAP_MS) return;

  const origin = getCivitaiOrigin();
  const sync = { cancelled: false };
  active = sync;

  void (async () => {
    // Building this queue used to JSON.parse a catalog page per local file
    // before the first await, which froze Browse when a tip-check finished.
    const { queue, skippedCharacter } = await queueLibraryMatchedModels(origin);
    if (sync.cancelled || active !== sync) return;

    if (queue.length === 0) {
      active = null;
      // Nothing stale right now — still record the attempt so tip-check does not
      // thrash. force:true always re-evaluates immediately next call.
      if (libraryHasEnrichAnchors(origin) && !opts?.force) lastRunAt = nowMs;
      emit({
        status: 'done',
        done: 0,
        total: 0,
        patchedThisRun: 0,
        skippedCharacter,
        failedThisRun: 0,
      });
      return;
    }

    lastRunAt = nowMs;

    const total = queue.length;
    let done = 0;
    let patched = 0;
    let failed = 0;

    emit({
      status: 'running',
      done: 0,
      total,
      patchedThisRun: 0,
      skippedCharacter,
      failedThisRun: 0,
    });

    for (let i = 0; i < queue.length; i += ENRICH_ID_BATCH) {
      if (sync.cancelled) break;
      const batch = queue.slice(i, i + ENRICH_ID_BATCH);
      let byId = new Map<number, CivitaiModel>();
      try {
        const items = await getCivitaiModelsByIds(batch.map((e) => e.id));
        byId = new Map(items.map((m) => [m.id, m]));
      } catch {
        failed += batch.length;
        done += batch.length;
        emit({
          status: 'running',
          done,
          total,
          patchedThisRun: patched,
          skippedCharacter,
          failedThisRun: failed,
          currentName: batch[0]?.name,
        });
        continue;
      }

      for (const entry of batch) {
        if (sync.cancelled) break;
        const full = byId.get(entry.id);
        if (!full) {
          // Omitted from the batch (deleted / filtered) — retry next TTL.
          failed += 1;
          done += 1;
          continue;
        }
        try {
          applyEnrichFromApiModel(origin, entry, full);
          patched += 1;
        } catch {
          failed += 1;
        }
        done += 1;
      }

      emit({
        status: 'running',
        done,
        total,
        patchedThisRun: patched,
        skippedCharacter,
        failedThisRun: failed,
        currentName: batch[batch.length - 1]?.name,
      });
    }

    flushDirtyModelPagesSync();
    active = null;
    emit({
      status: sync.cancelled ? 'cancelled' : 'done',
      done,
      total,
      patchedThisRun: patched,
      skippedCharacter,
      failedThisRun: failed,
    });
  })().catch((e) => {
    active = null;
    emit({
      status: 'error',
      done: 0,
      total: 0,
      patchedThisRun: 0,
      skippedCharacter: 0,
      failedThisRun: 0,
      error: e instanceof Error ? e.message : String(e),
    });
  });
}

export function cancelCatalogVersionHashEnrich(): void {
  if (active) active.cancelled = true;
}

/** Test / settings helper. */
export function resetCatalogVersionHashEnrichState(): void {
  if (active) active.cancelled = true;
  active = null;
  lastRunAt = 0;
}
