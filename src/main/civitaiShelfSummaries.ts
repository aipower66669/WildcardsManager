/**
 * Compact LoRA/Checkpoint shelf metadata for tab badges.
 * Local catalog + persisted ids only — never the Civitai API.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CachedCivitaiModel } from './civitaiCatalogCache.js';
import {
  getAutoV2CatalogIndex,
  getCachedModel,
  getCatalogCacheRootDir,
} from './civitaiCatalogCache.js';
import {
  collectInstalledModelIdsFromHashes,
  keepLongerRows,
  mergeDownloadedIds,
} from '../domain/civitaiInstalledFromHashes.js';
import type { CivitaiShelfSummariesDto, CivitaiShelfSummaryDto } from '../shared/contracts.js';
import { getConfiguredCheckpointIndex } from './checkpointService.js';
import { getConfiguredLoraIndex } from './loraService.js';
import {
  getCivitaiOrigin,
  listArchivedCivitaiModels,
  listMarkedInstalledCivitaiModels,
  listMaybeCivitaiModels,
} from './settingsStore.js';

const STORE_VERSION = 1 as const;
const FILE_NAME = 'shelf-summaries.json';

type DiskStore = {
  version: typeof STORE_VERSION;
  origin: string;
  downloaded: CivitaiShelfSummaryDto[];
  archived: CivitaiShelfSummaryDto[];
  maybe: CivitaiShelfSummaryDto[];
};

function storePath(): string {
  return path.join(getCatalogCacheRootDir(), FILE_NAME);
}

function emptyStore(origin: string): DiskStore {
  return {
    version: STORE_VERSION,
    origin,
    downloaded: [],
    archived: [],
    maybe: [],
  };
}

function readStore(origin: string): DiskStore {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as DiskStore;
    if (raw?.version !== STORE_VERSION || !Array.isArray(raw.downloaded)) {
      return emptyStore(origin);
    }
    // A different origin string is not a reason to throw the rows away.
    // The next save stamps the current origin. Discarding them here made
    // Downloaded drop from the real count to 0 on the next shelf read.
    return {
      version: STORE_VERSION,
      origin,
      downloaded: raw.downloaded ?? [],
      archived: raw.archived ?? [],
      maybe: raw.maybe ?? [],
    };
  } catch {
    return emptyStore(origin);
  }
}

function writeStore(store: DiskStore): void {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(store)}\n`, 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.renameSync(temp, file);
  }
}

export function summaryFromCached(
  cached: CachedCivitaiModel,
  extra?: Pick<CivitaiShelfSummaryDto, 'latestVersionInstalled'>,
): CivitaiShelfSummaryDto {
  const versionBaseModels: string[] = [];
  const seen = new Set<string>();
  const add = (raw?: string) => {
    const value = raw?.trim();
    if (!value || seen.has(value.toLowerCase())) return;
    seen.add(value.toLowerCase());
    versionBaseModels.push(value);
  };
  add(cached.baseModel);
  for (const row of cached.versions ?? []) add(row.baseModel);
  return {
    id: cached.id,
    type: cached.type,
    tags: Array.isArray(cached.tags) ? cached.tags : [],
    baseModel: cached.baseModel,
    versionBaseModels,
    latestVersionInstalled: extra?.latestVersionInstalled,
  };
}

function uniqueIds(ids: Iterable<number>): number[] {
  const out = new Set<number>();
  for (const id of ids) {
    if (Number.isFinite(id) && id > 0) out.add(id);
  }
  return [...out].sort((a, b) => a - b);
}

function summariesForIds(
  origin: string,
  ids: readonly number[],
  persistById: Map<number, CivitaiShelfSummaryDto>,
): CivitaiShelfSummaryDto[] {
  const out: CivitaiShelfSummaryDto[] = [];
  for (const id of ids) {
    const cached = getCachedModel(origin, id);
    if (cached) {
      const row = summaryFromCached(cached, {
        latestVersionInstalled: persistById.get(id)?.latestVersionInstalled,
      });
      out.push(row);
      continue;
    }
    const prior = persistById.get(id);
    // Keep the id even when this library's catalog page is not on disk yet.
    // Dropping it made Archive, Maybe, and Downloaded show 0 while Browse
    // re-downloaded an empty catalog.
    out.push(
      prior ?? {
        id,
        type: 'LORA',
        tags: [],
      },
    );
  }
  return out;
}

function indexHashKeys(index: { byAutoV2?: Map<string, string> } | null): string[] {
  if (!index?.byAutoV2) return [];
  return [...index.byAutoV2.keys()];
}

function indexFullyHashedOnFileObjects(index: {
  files: Array<{ autoV2?: string }>;
} | null): boolean {
  if (!index || index.files.length === 0) return false;
  return index.files.every((file) => Boolean(file.autoV2?.trim()));
}

/** Local hashes already on the folder index (no ADS scan). */
export function collectLiveInstalledIds(): {
  ids: number[];
  canShrink: boolean;
} {
  const catalogIndex = getAutoV2CatalogIndex();
  const lora = getConfiguredLoraIndex();
  const checkpoint = getConfiguredCheckpointIndex();
  const hashes = [...indexHashKeys(lora), ...indexHashKeys(checkpoint)];
  const live = collectInstalledModelIdsFromHashes({
    hashes,
    catalogIndex,
  });
  for (const entry of listMarkedInstalledCivitaiModels()) {
    if (entry.modelId > 0) live.push(entry.modelId);
  }
  const canShrink =
    (indexFullyHashedOnFileObjects(lora) || !lora || lora.files.length === 0) &&
    (indexFullyHashedOnFileObjects(checkpoint) ||
      !checkpoint ||
      checkpoint.files.length === 0) &&
    live.length > 0;
  return { ids: uniqueIds(live), canShrink };
}

export function listPersistedDownloadedSummaries(): CivitaiShelfSummaryDto[] {
  return readStore(getCivitaiOrigin()).downloaded;
}

export function summaryFromCardLike(card: {
  id: number;
  type: string;
  tags?: string[];
  baseModel?: string;
  versionInstalls?: Array<{ baseModel?: string }>;
  latestVersionInstalled?: boolean;
}): CivitaiShelfSummaryDto {
  const versionBaseModels: string[] = [];
  const seen = new Set<string>();
  const add = (raw?: string) => {
    const value = raw?.trim();
    if (!value || seen.has(value.toLowerCase())) return;
    seen.add(value.toLowerCase());
    versionBaseModels.push(value);
  };
  add(card.baseModel);
  for (const row of card.versionInstalls ?? []) add(row.baseModel);
  return {
    id: card.id,
    type: card.type,
    tags: Array.isArray(card.tags) ? card.tags : [],
    baseModel: card.baseModel,
    versionBaseModels,
    latestVersionInstalled: card.latestVersionInstalled,
  };
}

let downloadedWriteTimer: ReturnType<typeof setImmediate> | null = null;
let pendingDownloadedRows: CivitaiShelfSummaryDto[] | null = null;
let pendingDownloadedOrigin = '';

export function rememberDownloadedSummaries(
  rows: CivitaiShelfSummaryDto[],
): void {
  pendingDownloadedRows = rows;
  pendingDownloadedOrigin = getCivitaiOrigin();
  if (downloadedWriteTimer) return;
  // Stringify of the full downloaded shelf used to run on the IPC that paints
  // the tab. Write it on the next turn instead.
  downloadedWriteTimer = setImmediate(() => {
    downloadedWriteTimer = null;
    const next = pendingDownloadedRows;
    const origin = pendingDownloadedOrigin;
    pendingDownloadedRows = null;
    pendingDownloadedOrigin = '';
    if (!next || getCivitaiOrigin() !== origin) return;
    const store = readStore(origin);
    store.origin = origin;
    store.downloaded = keepLongerRows(store.downloaded, next);
    writeStore(store);
  });
}

/**
 * Instant LoRA/Checkpoint tab-badge rows from library.json + catalog cache.
 * Does not walk the catalog or hash files.
 */
export function listCivitaiShelfSummaries(): CivitaiShelfSummariesDto {
  const origin = getCivitaiOrigin();
  const store = readStore(origin);
  const archivedIds = uniqueIds(
    listArchivedCivitaiModels().map((entry) => entry.modelId),
  );
  const maybeIds = uniqueIds(
    listMaybeCivitaiModels().map((entry) => entry.modelId),
  );

  const archivedPersist = new Map(store.archived.map((row) => [row.id, row]));
  const maybePersist = new Map(store.maybe.map((row) => [row.id, row]));
  const downloadedPersist = new Map(
    store.downloaded.map((row) => [row.id, row]),
  );

  const archived = summariesForIds(origin, archivedIds, archivedPersist);
  const maybe = summariesForIds(origin, maybeIds, maybePersist);

  const live = collectLiveInstalledIds();
  const downloadedIds = mergeDownloadedIds(
    store.downloaded.map((row) => row.id),
    live.ids,
    live.canShrink,
  );
  const downloaded = summariesForIds(origin, downloadedIds, downloadedPersist);

  writeStore({
    version: STORE_VERSION,
    origin,
    downloaded: keepLongerRows(store.downloaded, downloaded),
    archived,
    maybe,
  });

  return { archived, maybe, downloaded };
}
