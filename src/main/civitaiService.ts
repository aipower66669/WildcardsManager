import { BrowserWindow } from 'electron';
import {
  expandArchitectureApiValues,
  matchesArchitectureFilter,
  matchesEnabledLibraryVersion,
  matchesEnabledSdxlFamilies,
  matchesSdxlFamily,
  resolveVersionBaseModel,
  type CivitaiArchitectureId,
  type CivitaiSdxlFamilyId,
  type CivitaiSdxlFamilyToggleId,
} from '../domain/civitaiBaseModels.js';
import {
  modelCategoryIsEnabled,
  modelCategoryTag,
  modelHasCategoryTag,
  type CivitaiModelCategoryId,
} from '../domain/civitaiModelCategories.js';
import {
  buildPotentialMatchIndex,
  findPotentialLocalMatches,
  findPotentialLocalMatchesExact,
  type PotentialMatchIndex,
} from '../domain/civitaiLocalMatch.js';
import {
  formatVersionVariantLabel,
  dedupeDownloadPicks,
  dedupeFilesByName,
  hashesForVersionInstallMatch,
  hasNewerVersionUpdate,
  isLatestVersionLocallyInstalled,
  readFileSizeKB,
  snapshotsFromModelVersions,
  variantLabelFromFileName,
  type CivitaiVersionHashSnapshot,
} from '../domain/civitaiVersions.js';
import { civitaiModelPageUrl } from '../domain/civitaiSnippet.js';
import type {
  CivitaiArchitectureIdDto,
  CivitaiCatalogSliceDto,
  CivitaiCatalogSyncProgressDto,
  CivitaiLocalSortDto,
  CivitaiModelCardDto,
  CivitaiModelCategoryIdDto,
  CivitaiModelDownloadOptionsDto,
  CivitaiModelTypeDto,
  CivitaiSearchResultDto,
  CivitaiSdxlFamilyIdDto,
  CivitaiStatusTagDto,
  CivitaiVersionInstallDto,
  WatchedCivitaiModelDto,
} from '../shared/contracts.js';
import { IPC } from '../shared/contracts.js';
import {
  isEarlyAccessActive,
  isVersionConfirmedPublic,
  isVersionEarlyAccess,
  projectVersionSnapEarlyAccess,
  resolveEarlyAccessEndsAt,
  versionHasPaidBuzzResidue,
} from '../domain/civitaiEarlyAccess.js';
import { isCivitaiCreatorBlocked } from '../domain/civitaiBlockedCreators.js';
import {
  enrichVersionEarlyAccess,
  fetchEarlyAccessGateFromModelPage,
  hasCompletedEarlyAccessPageScrape,
  getCivitaiModel,
  pickPrimaryFile,
  primaryPreviewUrl,
  searchCivitaiModels,
  type CivitaiModel,
  type CivitaiModelType,
} from './civitaiClient.js';
import {
  pickCivitaiAutoV2,
  collectAutoV2HashesFromVersions,
} from '../domain/modelHash.js';
import { CATALOG_PAGE_SIZE } from '../domain/civitaiCatalogLayout.js';
import { startModelHashWarm } from './modelHashWarm.js';
import { prioritizeActiveLibraryPreviews } from './modelFilesService.js';
import {
  buildCatalogSliceKey,
  getCachedModel,
  getCatalogSliceStats,
  getCatalogSliceDir,
  getCatalogSliceIds,
  getSliceIdKnownSet,
  insertCachedModelsIfAbsent,
  getAutoV2CatalogIndex,
  listSliceIdsWindow,
  flushDirtyModelPagesSync,
  patchCachedModel,
  updateCatalogSlice,
  type CachedCivitaiModel,
} from './civitaiCatalogCache.js';
import {
  catalogSearchHay,
  ensureCatalogSearchIndex,
  searchCatalogIndex,
} from './civitaiCatalogSearchIndex.js';
import {
  getConfiguredCheckpointIndex,
  getConfiguredCheckpointIndexCachedHashes,
  findLocalInstallMatches,
} from './checkpointService.js';
import {
  getConfiguredLoraIndex,
  getConfiguredLoraIndexCachedHashes,
} from './loraService.js';
import type { LoraIndex } from '../domain/lora.js';
import { getCustomCivitaiPreview } from './civitaiPreviewCache.js';
import {
  getCivitaiOrigin,
  getActiveLibrary,
  getCivitaiCatalogAutoSyncIntervalMinutes,
  isCivitaiModelArchived,
  isCivitaiModelMarkedInstalled,
  isCivitaiModelMaybe,
  isCivitaiModelWatched,
  isCivitaiModelVersionMarkedInstalled,
  isCivitaiVersionMarkedInstalled,
  listArchivedCivitaiModels,
  listBlockedCivitaiCreators,
  listCivitaiWatchlist,
  listCivitaiRecentlyUnlocked,
  listMarkedInstalledCivitaiModels,
  listMaybeCivitaiModels,
  markCivitaiModelInstalled,
  markCivitaiVersionInstalled,
  purgeAvailableCivitaiWatchlistEntries,
  recordCivitaiRecentlyUnlocked,
  dismissCivitaiRecentlyUnlocked,
  unmarkCivitaiModelInstalled,
  unwatchCivitaiModel,
  updateCivitaiWatchlistEntry,
  type WatchedCivitaiModel,
} from './settingsStore.js';
import { clearShelvesForNotifyUnlock } from './civitaiArchivePolicy.js';
import {
  collectInstalledModelIdsFromHashes,
  mergePersistedInstalledIds,
} from '../domain/civitaiInstalledFromHashes.js';
import {
  collectLiveInstalledIds,
  listCivitaiShelfSummaries,
  listPersistedDownloadedSummaries,
  rememberDownloadedSummaries,
  summaryFromCardLike,
} from './civitaiShelfSummaries.js';

export { listCivitaiShelfSummaries };

const SYNC_PAGE_LIMIT = 100;
/** Extra pause between catalog pages (API client also paces ~1 req/sec). */
const SYNC_THROTTLE_MS = 750;

type ActiveSync = {
  sliceKey: string;
  cancelled: boolean;
  mode: 'incremental' | 'fill';
  pagesFetched: number;
  addedThisRun: number;
  lastPageReceived: number;
  lastPageAdded: number;
};

let activeSync: ActiveSync | null = null;

function buildStatusTags(card: {
  installed: boolean;
  archived: boolean;
  maybe: boolean;
  watching: boolean;
  earlyAccess: boolean;
  potentialLocalMatches: { length: number };
  latestVersionInstalled?: boolean;
  hasDownloadableVersion?: boolean;
}): CivitaiStatusTagDto[] {
  const tags: CivitaiStatusTagDto[] = [];
  if (card.archived) tags.push('archived');
  if (card.maybe) tags.push('maybe');
  if (card.installed) tags.push('installed');
  // Update = newer version id missing. Sibling quants of an installed latest
  // version are downloadable variants, not updates.
  if (card.installed && card.latestVersionInstalled === false) {
    tags.push('update-available');
  }
  if (card.watching) tags.push('watching');
  if (card.earlyAccess) tags.push('early-access');
  if (card.potentialLocalMatches.length > 0) tags.push('potential-duplicate');
  return tags;
}

function buildVersionInstalls(
  index: LoraIndex | null,
  opts: {
    modelId?: number;
    versions?: CivitaiVersionHashSnapshot[] | null;
    versionId?: number;
    versionName?: string;
    baseModel?: string;
    fileName?: string;
    autoV2?: string;
    autoV2Hashes?: string[];
    /**
     * Model-level EA flag/end from the catalog row. Version snaps often keep
     * `earlyAccess: true` with no end time after unlock — inherit the model
     * end (or cleared flag) so Browse can show Download again.
     */
    modelEarlyAccess?: boolean;
    modelEarlyAccessEndsAt?: string | null;
  },
): CivitaiVersionInstallDto[] {
  const out: CivitaiVersionInstallDto[] = [];
  const modelId = opts.modelId;

  if (opts.versions && opts.versions.length > 0) {
    const latestSnapId = Math.max(...opts.versions.map((v) => v.id));
    for (const snap of opts.versions) {
      // One projector for Browse / Download / Bell. Model-level inherit only
      // on the latest version (older snaps keep their own unlock stamps).
      const projected = projectVersionSnapEarlyAccess({
        earlyAccess: snap.earlyAccess,
        earlyAccessEndsAt: snap.earlyAccessEndsAt,
        downloadPrice: snap.downloadPrice,
        inheritModelEarlyAccess:
          snap.id === latestSnapId ? opts.modelEarlyAccess : false,
        inheritModelEndsAt:
          snap.id === latestSnapId ? opts.modelEarlyAccessEndsAt : undefined,
      });
      const earlyAccess = projected.earlyAccess;
      const endsAt = projected.earlyAccessEndsAt;
      const files = dedupeFilesByName(
        snap.files && snap.files.length > 0
          ? snap.files
          : [
              {
                id: undefined,
                name: snap.fileName ?? snap.name,
                autoV2: snap.autoV2,
                primary: true,
                variantLabel: undefined,
              },
            ],
      );
      const snapHashes = [
        snap.autoV2,
        ...(snap.autoV2Hashes ?? []),
        ...files.map((f) => f.autoV2),
      ];
      const versionCount = opts.versions?.length ?? 0;
      const isTipVersion =
        opts.versionId != null && snap.id === opts.versionId;
      for (const file of files) {
        const matchHashes = hashesForVersionInstallMatch({
          fileHashes: [file.autoV2, snap.autoV2, ...snapHashes],
          versionCount,
          isTipVersion,
          tipPrimaryAutoV2: opts.autoV2,
          allModelAutoV2Hashes: [
            opts.autoV2,
            ...(opts.autoV2Hashes ?? []),
          ],
        });
        const localMatches = findLocalInstallMatches(
          index,
          file.name ?? '',
          file.autoV2 ? { AutoV2: file.autoV2 } : undefined,
          matchHashes,
        );
        const marked =
          modelId != null &&
          isCivitaiVersionMarkedInstalled(
            modelId,
            snap.id,
            file.id,
            file.name,
          );
        out.push({
          versionId: snap.id,
          versionName: snap.name,
          baseModel: resolveVersionBaseModel({
            baseModel: snap.baseModel,
            versionName: snap.name,
          }),
          fileId: file.id,
          fileName: file.name,
          variantLabel:
            file.variantLabel ??
            variantLabelFromFileName(file.name, snap.name),
          autoV2: file.autoV2 ?? snap.autoV2,
          sizeKB: file.sizeKB,
          installed: localMatches.length > 0 || marked,
          earlyAccess,
          earlyAccessEndsAt: endsAt,
          localMatches,
        });
      }
    }
    return out;
  }

  if (opts.versionId != null || opts.autoV2 || opts.fileName) {
    const hashes = [
      opts.autoV2,
      ...(opts.autoV2Hashes ?? []),
    ].filter((h): h is string => Boolean(h?.trim()));
    const localMatches = findLocalInstallMatches(
      index,
      opts.fileName ?? '',
      opts.autoV2 ? { AutoV2: opts.autoV2 } : undefined,
      hashes.length > 0 ? hashes : null,
    );
    const marked =
      modelId != null &&
      opts.versionId != null &&
      isCivitaiVersionMarkedInstalled(
        modelId,
        opts.versionId,
        null,
        opts.fileName,
      );
    out.push({
      versionId: opts.versionId ?? 0,
      versionName: opts.versionName?.trim() || 'Latest',
      baseModel: resolveVersionBaseModel({
        baseModel: opts.baseModel,
        versionName: opts.versionName,
      }),
      fileName: opts.fileName,
      variantLabel: variantLabelFromFileName(opts.fileName, opts.versionName),
      autoV2: opts.autoV2,
      installed: localMatches.length > 0 || marked,
      earlyAccess: false,
      localMatches,
    });
  }
  return out;
}

/**
 * Version rows must match the library’s enabled architectures, and when the
 * Browse chip set is non-empty, that selection too (so a Krea chip never lists
 * Illustrious/Anima siblings even if those archs are still enabled on the library).
 */
function versionAllowedInContext(
  row: {
    baseModel?: string;
    versionName?: string;
    fileName?: string;
    name?: string;
  },
  browseArchitectures?: CivitaiArchitectureId[] | null,
): boolean {
  const lib = getActiveLibrary();
  const sdxlFamilies = lib.enabledSdxlFamilies as CivitaiSdxlFamilyToggleId[];
  const resolved = {
    ...row,
    baseModel: resolveVersionBaseModel(row),
  };
  if (
    !matchesEnabledLibraryVersion(resolved, {
      architectures: lib.enabledArchitectures as CivitaiArchitectureId[],
      sdxlFamilies,
    })
  ) {
    return false;
  }
  if (!browseArchitectures?.length) return true;
  return matchesEnabledLibraryVersion(resolved, {
    architectures: browseArchitectures,
    sdxlFamilies,
  });
}

function overlayCardFields(
  base: {
    id: number;
    name: string;
    type: string;
    nsfw: boolean;
    creator?: string;
    tags: string[];
    baseModel?: string;
    versionId?: number;
    versionName?: string;
    fileName?: string;
    autoV2?: string;
    /** All known version/file AutoV2 hashes for installed detection. */
    autoV2Hashes?: string[];
    versions?: CivitaiVersionHashSnapshot[] | null;
    fileSizeKB?: number;
    trainedWords: string[];
    previewUrl?: string;
    pageUrl: string;
    earlyAccess: boolean;
    earlyAccessEndsAt?: string;
    firstSeenAt?: string;
    publishedAt?: string;
  },
  index: LoraIndex | null,
  options?: {
    /** Precomputed stem dictionary — O(1) potential matches for bulk catalog. */
    matchIndex?: PotentialMatchIndex | null;
    /**
     * When false, skip potential-local matching entirely.
     * Default true; pass a matchIndex for fast exact-only lookups.
     */
    includePotentialMatches?: boolean;
    /** Active Browse architecture chip(s) — further narrows version rows. */
    browseArchitectures?: CivitaiArchitectureId[] | null;
    /**
     * Archive / Maybe lists: skip folder-hash matching so 7k+ local ids
     * hydrate from catalog pages only.
     */
    skipInstallScan?: boolean;
  },
): CivitaiModelCardDto {
  const { autoV2Hashes, versions, ...cardFields } = base;
  const browseArchitectures = options?.browseArchitectures ?? null;
  if (options?.skipInstallScan) {
    const archived = isCivitaiModelArchived(base.id);
    const maybe = isCivitaiModelMaybe(base.id);
    const watching = isCivitaiModelWatched(base.id);
    const markedInstalled = isCivitaiModelMarkedInstalled(base.id);
    const earlyAccess = isEarlyAccessActive(
      Boolean(base.earlyAccess),
      base.earlyAccessEndsAt,
    );
    return {
      ...cardFields,
      customPreviewUrl: getCustomCivitaiPreview(base.id) ?? undefined,
      installed: markedInstalled,
      latestVersionInstalled: markedInstalled,
      hasUninstalledVersion: !markedInstalled,
      hasDownloadableVersion: !markedInstalled,
      versionInstalls: [],
      markedInstalled,
      archived,
      maybe,
      hidden: archived,
      potentialLocalMatches: [],
      watching,
      earlyAccess,
      earlyAccessEndsAt: base.earlyAccessEndsAt,
      statusTags: buildStatusTags({
        installed: markedInstalled,
        archived,
        maybe,
        watching,
        earlyAccess,
        potentialLocalMatches: [],
        latestVersionInstalled: markedInstalled,
        hasDownloadableVersion: !markedInstalled,
      }),
    };
  }
  // Scope version rows to this library’s enabled architectures (+ Browse chip).
  // Prefer each version’s own baseModel / name — never the card primary alone.
  const versionInstalls = buildVersionInstalls(index, {
    modelId: base.id,
    versions,
    versionId: base.versionId,
    versionName: base.versionName,
    baseModel: base.baseModel,
    fileName: base.fileName,
    autoV2: base.autoV2,
    autoV2Hashes,
    modelEarlyAccess: base.earlyAccess,
    modelEarlyAccessEndsAt: base.earlyAccessEndsAt,
  }).filter((row) =>
    versionAllowedInContext(row, browseArchitectures),
  );
  const localInstallMatches = findLocalInstallMatches(
    index,
    base.fileName ?? '',
    base.autoV2 ? { AutoV2: base.autoV2 } : undefined,
    autoV2Hashes,
  );
  const fileInstalled = localInstallMatches.length > 0;
  const markedInstalled = isCivitaiModelMarkedInstalled(base.id);
  const versionMarkedInstalled =
    versionInstalls.some((v) => v.installed) ||
    isCivitaiModelVersionMarkedInstalled(base.id);
  const installed = fileInstalled || markedInstalled || versionMarkedInstalled;
  // Download affordance: any scoped non-EA weight still missing locally.
  // Thin catalog caches often omit per-version baseModel; if there are no
  // scoped rows left but the card already matches a local file, treat download
  // as done so cards don't look "empty" after a rematch.
  const hasMissingScopedDownload = versionInstalls.some(
    (v) => !v.installed && !v.earlyAccess,
  );
  const hasDownloadableVersion = markedInstalled
    ? false
    : versionInstalls.length > 0
      ? hasMissingScopedDownload
      : !installed;
  // Newest version present (any variant). Missing sibling quants of that
  // version must NOT clear this — they are not “updates”.
  const latestVersionInstalled =
    markedInstalled ||
    isLatestVersionLocallyInstalled(versionInstalls) ||
    (installed && !hasNewerVersionUpdate(versionInstalls));
  const hasUninstalledVersion = markedInstalled
    ? false
    : versionInstalls.length > 0
      ? versionInstalls.some((v) => !v.installed)
      : !installed;
  const archived = isCivitaiModelArchived(base.id);
  const maybe = isCivitaiModelMaybe(base.id);
  const watching = isCivitaiModelWatched(base.id);
  // Card EA = any gated version (Bell). Download uses hasDownloadableVersion
  // (any non-EA missing weight). Countdown = soonest future end among gated.
  let earlyAccess = false;
  let earlyAccessEndsAt: string | undefined;
  if (versionInstalls.length > 0) {
    const gated = versionInstalls.filter((v) =>
      isEarlyAccessActive(v.earlyAccess, v.earlyAccessEndsAt),
    );
    earlyAccess = gated.length > 0;
    const futureEnds = gated
      .map((v) => v.earlyAccessEndsAt)
      .filter((raw): raw is string => Boolean(raw?.trim()))
      .filter((raw) => isEarlyAccessActive(true, raw))
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    earlyAccessEndsAt =
      futureEnds[0] ||
      base.earlyAccessEndsAt ||
      pickEndsAtFromVersionSnapshots(
        versions,
        Math.max(...versionInstalls.map((v) => v.versionId)),
      );
  } else {
    earlyAccess = isEarlyAccessActive(
      Boolean(base.earlyAccess),
      base.earlyAccessEndsAt,
    );
    earlyAccessEndsAt =
      base.earlyAccessEndsAt ||
      pickEndsAtFromVersionSnapshots(versions, base.versionId);
  }
  const includePotential = options?.includePotentialMatches !== false;
  const potentialLocalMatches =
    includePotential && !installed && base.fileName
      ? options?.matchIndex
        ? findPotentialLocalMatchesExact(options.matchIndex, base.fileName, {
            modelName: base.name,
          })
        : findPotentialLocalMatches(index, base.fileName, {
            modelName: base.name,
          })
      : [];

  const cardBase = {
    ...cardFields,
    earlyAccess,
    earlyAccessEndsAt,
    customPreviewUrl: getCustomCivitaiPreview(base.id) ?? undefined,
    installed,
    latestVersionInstalled,
    hasUninstalledVersion,
    hasDownloadableVersion,
    versionInstalls,
    markedInstalled,
    archived,
    maybe,
    hidden: archived,
    potentialLocalMatches,
    localInstallMatches,
    watching,
  };

  return {
    ...cardBase,
    statusTags: buildStatusTags({
      installed,
      archived,
      maybe,
      watching,
      earlyAccess,
      potentialLocalMatches,
      latestVersionInstalled,
      hasDownloadableVersion,
    }),
  };
}

function modelPublishedAt(model: CivitaiModel): string | undefined {
  const version = model.modelVersions?.[0];
  const raw = version?.publishedAt ?? version?.createdAt;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function toCard(
  model: CivitaiModel,
  _type: CivitaiModelType,
  index: LoraIndex | null,
): CivitaiModelCardDto {
  const version = model.modelVersions?.[0];
  const file = pickPrimaryFile(version);
  const origin = getCivitaiOrigin();
  const earlyAccess = isVersionEarlyAccess(version);
  const earlyAccessEndsAt = resolveEarlyAccessEndsAt(version);
  const autoV2 = pickCivitaiAutoV2(file?.hashes) ?? undefined;
  const autoV2Hashes = collectAutoV2HashesFromVersions(model.modelVersions);
  const versions = snapshotsFromModelVersions(model.modelVersions);
  return overlayCardFields(
    {
      id: model.id,
      name: model.name,
      type: model.type,
      nsfw: Boolean(model.nsfw),
      creator: model.creator?.username,
      tags: Array.isArray(model.tags) ? model.tags : [],
      baseModel: version?.baseModel,
      versionId: version?.id,
      versionName: version?.name,
      fileName: file?.name,
      autoV2,
      autoV2Hashes:
        autoV2Hashes.length > 0
          ? autoV2Hashes
          : autoV2
            ? [autoV2]
            : undefined,
      versions,
      fileSizeKB: file?.sizeKB,
      trainedWords: version?.trainedWords ?? [],
      previewUrl: primaryPreviewUrl(model) ?? undefined,
      pageUrl: civitaiModelPageUrl(origin, model.id, model.name),
      earlyAccess,
      earlyAccessEndsAt: earlyAccessEndsAt || undefined,
      publishedAt: modelPublishedAt(model),
    },
    index,
  );
}

function toCachedModel(model: CivitaiModel): CachedCivitaiModel {
  const version = model.modelVersions?.[0];
  const file = pickPrimaryFile(version);
  const origin = getCivitaiOrigin();
  const now = new Date().toISOString();
  const earlyAccessEndsAt = resolveEarlyAccessEndsAt(version);
  const autoV2 = pickCivitaiAutoV2(file?.hashes) ?? undefined;
  const autoV2Hashes = collectAutoV2HashesFromVersions(model.modelVersions);
  const versions = snapshotsFromModelVersions(model.modelVersions);
  return {
    id: model.id,
    origin,
    name: model.name,
    type: model.type,
    nsfw: Boolean(model.nsfw),
    creator: model.creator?.username,
    tags: Array.isArray(model.tags) ? model.tags : [],
    baseModel: version?.baseModel,
    versionId: version?.id,
    versionName: version?.name,
    fileName: file?.name,
    fileSizeKB: file?.sizeKB,
    trainedWords: version?.trainedWords ?? [],
    previewUrl: primaryPreviewUrl(model) ?? undefined,
    pageUrl: civitaiModelPageUrl(origin, model.id, model.name),
    earlyAccess: isVersionEarlyAccess(version),
    earlyAccessEndsAt: earlyAccessEndsAt || undefined,
    autoV2,
    autoV2Hashes:
      autoV2Hashes.length > 0
        ? autoV2Hashes
        : autoV2
          ? [autoV2]
          : undefined,
    versions: versions.length > 0 ? versions : undefined,
    publishedAt: modelPublishedAt(model),
    firstSeenAt: now,
    updatedAt: now,
  };
}

function cachedToCard(
  cached: CachedCivitaiModel,
  index: LoraIndex | null,
  options?: {
    matchIndex?: PotentialMatchIndex | null;
    includePotentialMatches?: boolean;
    browseArchitectures?: CivitaiArchitectureId[] | null;
    skipInstallScan?: boolean;
  },
): CivitaiModelCardDto {
  return overlayCardFields(
    {
      id: cached.id,
      name: cached.name,
      type: cached.type,
      nsfw: cached.nsfw,
      creator: cached.creator,
      tags: cached.tags,
      baseModel: cached.baseModel,
      versionId: cached.versionId,
      versionName: cached.versionName,
      fileName: cached.fileName,
      autoV2: cached.autoV2,
      autoV2Hashes: cached.autoV2Hashes,
      versions: cached.versions,
      fileSizeKB: cached.fileSizeKB,
      trainedWords: cached.trainedWords,
      previewUrl: cached.previewUrl,
      pageUrl: cached.pageUrl,
      // Catalog snapshots can leave earlyAccess=true forever; re-evaluate from end time.
      earlyAccess: isEarlyAccessActive(
        cached.earlyAccess,
        cached.earlyAccessEndsAt,
      ),
      earlyAccessEndsAt: cached.earlyAccessEndsAt,
      firstSeenAt: cached.firstSeenAt,
      publishedAt: cached.publishedAt,
    },
    index,
    options,
  );
}

async function indexForType(type: CivitaiModelType): Promise<LoraIndex | null> {
  // Never await full AutoV2 warm on IPC — that blocked the UI for minutes even
  // when SHA-256 itself ran on a worker. Cache-only index + background warm.
  const index = indexForTypeFast(type);
  if (type === 'LORA') {
    startModelHashWarm('LORA', () => getConfiguredLoraIndex());
  } else {
    startModelHashWarm('Checkpoint', () => getConfiguredCheckpointIndex());
  }
  return index;
}

/**
 * Fast index for the browse hot path: hashes already on the in-memory index
 * only. Do not open AUTOV2 ADS here — a sweep of every weight file stalls
 * the main window (editor, hover, clipboard), not just Civitai.
 */
function indexForTypeFast(type: CivitaiModelType): LoraIndex | null {
  return type === 'LORA'
    ? getConfiguredLoraIndexCachedHashes()
    : getConfiguredCheckpointIndexCachedHashes();
}

function toWatchDto(
  entry: WatchedCivitaiModel,
  card?: CivitaiModelCardDto,
): WatchedCivitaiModelDto {
  return {
    origin: entry.origin,
    modelId: entry.modelId,
    modelName: entry.modelName,
    type: entry.type,
    versionId: entry.versionId,
    earlyAccessEndsAt: entry.earlyAccessEndsAt,
    available: entry.available,
    addedAt: entry.addedAt,
    availableAt: entry.availableAt,
    card,
  };
}

/** Drop Archive/Maybe + watch membership when Notify early access ends. */
function unlockNotifyWatchEntry(
  entry: WatchedCivitaiModel,
  card?: CivitaiModelCardDto,
): WatchedCivitaiModelDto {
  clearShelvesForNotifyUnlock(entry.modelId);
  unwatchCivitaiModel(entry.modelId);
  const unlockedCard = card
    ? {
        ...card,
        watching: false,
        earlyAccess: false,
        archived: false,
        maybe: false,
        hidden: false,
        statusTags: card.statusTags.filter(
          (t) => t !== 'archived' && t !== 'maybe' && t !== 'watching',
        ),
      }
    : undefined;
  return toWatchDto(
    {
      ...entry,
      available: true,
      availableAt: new Date().toISOString(),
      earlyAccessEndsAt: undefined,
    },
    unlockedCard,
  );
}

/** Prefer a parseable ISO end time from the first non-empty candidate. */
function coerceEndsAtIso(raw: string | undefined | null): string | undefined {
  if (!raw?.trim()) return undefined;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

function pickEndsAtFromVersionSnapshots(
  versions: CivitaiVersionHashSnapshot[] | null | undefined,
  preferredVersionId?: number,
): string | undefined {
  if (!versions?.length) return undefined;
  if (preferredVersionId != null) {
    const match = versions.find((v) => v.id === preferredVersionId);
    const hit = coerceEndsAtIso(match?.earlyAccessEndsAt);
    if (hit) return hit;
  }
  let best: string | undefined;
  let bestId = -1;
  for (const v of versions) {
    const hit = coerceEndsAtIso(v.earlyAccessEndsAt);
    if (!hit) continue;
    if (v.id >= bestId) {
      bestId = v.id;
      best = hit;
    }
  }
  return best;
}

/** Resolve EA end time from watch entry + catalog (top-level or version snaps). */
function pickWatchlistEarlyAccessEndsAt(
  entry: WatchedCivitaiModel,
  cached: CachedCivitaiModel | null | undefined,
  card?: CivitaiModelCardDto | null,
): string | undefined {
  return (
    coerceEndsAtIso(entry.earlyAccessEndsAt) ||
    coerceEndsAtIso(card?.earlyAccessEndsAt) ||
    coerceEndsAtIso(cached?.earlyAccessEndsAt) ||
    pickEndsAtFromVersionSnapshots(
      cached?.versions as CivitaiVersionHashSnapshot[] | undefined,
      entry.versionId ?? cached?.versionId ?? card?.versionId,
    )
  );
}

export type CivitaiBrowseCatalogParams = {
  type: CivitaiModelTypeDto;
  query?: string;
  sort?: CivitaiLocalSortDto;
  includeArchived?: boolean;
  includeMaybe?: boolean;
  hideInstalled?: boolean;
  onlyPotentialDuplicate?: boolean;
  onlyNew?: boolean;
  includeWatching?: boolean;
  architectures?: CivitaiArchitectureIdDto[];
  /** Narrow SDXL results further (Illustrious / Pony / …). Not part of slice key. */
  sdxlFamily?: CivitaiSdxlFamilyIdDto;
  category?: CivitaiModelCategoryIdDto | null;
  /** Id-index scan offset. */
  offset?: number;
  /** Max cards after filters (default 200). */
  limit?: number;
};

export type CivitaiCatalogSyncParams = {
  type: CivitaiModelTypeDto;
  query?: string;
  architectures?: CivitaiArchitectureIdDto[];
  category?: CivitaiModelCategoryIdDto | null;
  /** auto = fill when empty, else incremental. */
  mode?: 'auto' | 'incremental' | 'fill';
  /** Bypass the idle auto-sync interval (manual Refresh). */
  force?: boolean;
};

function applyBrowseFilters(
  items: CivitaiModelCardDto[],
  params: CivitaiBrowseCatalogParams,
): CivitaiModelCardDto[] {
  const blocked = new Set(
    listBlockedCivitaiCreators()
      .map((entry) => entry.username.trim().toLowerCase())
      .filter(Boolean),
  );
  let filtered = items.filter(
    (item) => !isCivitaiCreatorBlocked(item.creator, blocked),
  );
  if (!params.includeArchived) {
    filtered = filtered.filter((item) => !item.archived);
  }
  if (!params.includeMaybe) {
    filtered = filtered.filter((item) => !item.maybe);
  }
  if (!params.includeWatching) {
    filtered = filtered.filter((item) => !item.watching);
  }
  if (params.hideInstalled) {
    filtered = filtered.filter((item) => !item.installed);
  }
  if (params.onlyPotentialDuplicate) {
    filtered = filtered.filter(
      (item) => item.potentialLocalMatches.length > 0,
    );
  }
  if (params.onlyNew) {
    filtered = filtered.filter(
      (item) =>
        !item.archived &&
        !item.maybe &&
        !item.installed &&
        !item.watching,
    );
  }
  if (params.architectures?.length) {
    const ids = params.architectures as CivitaiArchitectureId[];
    filtered = filtered.filter((item) => {
      // Prefer the card primary, but multi-arch models often list a newer Flux
      // (etc.) as [0] while still having a library-matching version.
      if (matchesArchitectureFilter(item.baseModel, ids)) return true;
      return item.versionInstalls.some((row) =>
        matchesArchitectureFilter(row.baseModel, ids),
      );
    });
    if (ids.includes('sdxl')) {
      const enabledFamilies = getActiveLibrary()
        .enabledSdxlFamilies as CivitaiSdxlFamilyToggleId[];
      const versionOrCardBase = (item: CivitaiModelCardDto): string | undefined => {
        if (matchesArchitectureFilter(item.baseModel, ['sdxl'])) {
          return item.baseModel;
        }
        return item.versionInstalls.find((row) =>
          matchesArchitectureFilter(row.baseModel, ['sdxl']),
        )?.baseModel;
      };
      if (params.sdxlFamily && params.sdxlFamily !== 'all') {
        const family = params.sdxlFamily as CivitaiSdxlFamilyId;
        if (!enabledFamilies.includes(family as CivitaiSdxlFamilyToggleId)) {
          return [];
        }
        filtered = filtered.filter((item) =>
          matchesSdxlFamily(versionOrCardBase(item), family),
        );
      } else {
        filtered = filtered.filter((item) =>
          matchesEnabledSdxlFamilies(versionOrCardBase(item), enabledFamilies),
        );
      }
    }
  }
  const enabledCategories = getActiveLibrary()
    .enabledCivitaiCategories as CivitaiModelCategoryId[];
  if (params.category) {
    if (!enabledCategories.includes(params.category as CivitaiModelCategoryId)) {
      return [];
    }
    // Filter by tag on the unified All catalog — per-category sync slices can
    // miss models that also carry this tag but were discovered under another
    // category (badge uses tags; chip must match the badge).
    filtered = filtered.filter((item) =>
      modelHasCategoryTag(item.tags, params.category as CivitaiModelCategoryId),
    );
  } else {
    // "All" = every enabled category only (never hidden ones).
    filtered = filtered.filter((item) =>
      modelCategoryIsEnabled(item.tags, enabledCategories),
    );
  }
  return filtered;
}

function sortLocalCards(
  items: CivitaiModelCardDto[],
  sort: CivitaiLocalSortDto,
  sliceOrder: number[],
): CivitaiModelCardDto[] {
  if (sort === 'newest') {
    const order = new Map(sliceOrder.map((id, index) => [id, index]));
    return [...items].sort((a, b) => {
      const ai = order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bi = order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return (b.firstSeenAt ?? '').localeCompare(a.firstSeenAt ?? '');
    });
  }
  if (sort === 'creator') {
    return [...items].sort((a, b) => {
      const ac = (a.creator ?? '').localeCompare(b.creator ?? '', undefined, {
        sensitivity: 'base',
      });
      if (ac !== 0) return ac;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }
  return [...items].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

function emitCatalogSyncProgress(payload: CivitaiCatalogSyncProgressDto): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(IPC.civitaiCatalogSyncProgress, payload);
    } catch {
      // Renderer went away mid-sync — disk state is enough to resume.
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Local hash warm + active-library preview coverage.
 * Catalog-wide image warm is intentionally not started here.
 */
function deferBrowseBackgroundWork(
  type: CivitaiModelTypeDto,
  offset: number,
): void {
  if (offset > 0) return;
  setTimeout(() => {
    if (type === 'LORA') {
      startModelHashWarm('LORA', () => getConfiguredLoraIndex());
    } else {
      startModelHashWarm('Checkpoint', () => getConfiguredCheckpointIndex());
    }
    try {
      prioritizeActiveLibraryPreviews();
    } catch {
      // Folders may be unset.
    }
  }, 800);
}

export async function getCatalogSlice(
  params: CivitaiBrowseCatalogParams,
): Promise<CivitaiCatalogSliceDto> {
  const origin = getCivitaiOrigin();
  const architectures = params.architectures ?? [];
  // Logical key for UI sync progress (All vs a category chip).
  const sliceKey = buildCatalogSliceKey({
    origin,
    type: params.type,
    category: params.category ?? null,
    architectures,
    query: '',
  });
  // Always scan the unified All index. Category chips filter by model tags
  // (see applyBrowseFilters). Reading a per-tag sync slice alone misses cards
  // that show e.g. Character under All but were ingested via Style/etc.
  const catalogSliceKey = buildCatalogSliceKey({
    origin,
    type: params.type,
    category: null,
    architectures,
    query: '',
  });
  const requestOffset = Math.max(0, Math.floor(params.offset ?? 0));
  const stats = getCatalogSliceStats(catalogSliceKey);
  // Per-category chips report that tag’s sync slice. “All” is complete only
  // when every enabled category fill for this type/arch is exhausted.
  const syncExhausted = params.category
    ? getCatalogSliceStats(sliceKey).exhausted
    : areEnabledCategorySlicesExhausted({
        type: params.type,
        architectures,
      });
  const syncStats = params.category
    ? getCatalogSliceStats(sliceKey)
    : stats;
  // Fast cached hashes only — never kick disk walks / API backfills here.
  const index = indexForTypeFast(params.type);

  const wantPotential = params.onlyPotentialDuplicate === true;
  const matchIndex = wantPotential
    ? buildPotentialMatchIndex(index)
    : null;

  const limit = Math.min(200, Math.max(1, Math.floor(params.limit ?? 200)));
  let scanOffset = Math.max(0, Math.floor(params.offset ?? 0));
  const items: CivitaiModelCardDto[] = [];
  const filterParams = { ...params, architectures };
  const query = params.query?.trim() ?? '';

  const loadCards = (ids: number[]): CivitaiModelCardDto[] => {
    const batch: CivitaiModelCardDto[] = [];
    for (const id of ids) {
      const cached = getCachedModel(origin, id);
      if (!cached) continue;
      batch.push(
        cachedToCard(cached, index, {
          matchIndex,
          includePotentialMatches: wantPotential,
          browseArchitectures: architectures as CivitaiArchitectureId[],
        }),
      );
    }
    return applyBrowseFilters(batch, filterParams);
  };

  if (query) {
    // Local search over the full type/arch All catalog index.
    const searchIndex = await ensureCatalogSearchIndex({
      sliceKey: catalogSliceKey,
      sliceDir: getCatalogSliceDir(catalogSliceKey),
      ids: getCatalogSliceIds(catalogSliceKey),
      idChunkCount: Math.ceil(stats.idCount / CATALOG_PAGE_SIZE) || 0,
      loadModel: (id) => getCachedModel(origin, id),
    });

    // scanOffset is a hay-array cursor. Over-fetch so UI filters still fill pages.
    let hayCursor = scanOffset;
    let searchHasMore = false;
    const maxPasses = 12;
    for (let pass = 0; pass < maxPasses && items.length < limit; pass += 1) {
      const need = Math.max(limit - items.length, 16);
      const hit = searchCatalogIndex(
        searchIndex,
        query,
        hayCursor,
        need * 4,
      );
      if (hit.matches.length === 0) {
        hayCursor = hit.nextIndex;
        searchHasMore = false;
        break;
      }

      const byId = new Map(
        loadCards(hit.matches.map((m) => m.id)).map((c) => [c.id, c]),
      );
      let filled = false;
      for (const match of hit.matches) {
        hayCursor = match.hayIndex + 1;
        const card = byId.get(match.id);
        if (!card) continue;
        items.push(card);
        if (items.length >= limit) {
          filled = true;
          searchHasMore = true;
          break;
        }
      }
      if (!filled) {
        hayCursor = hit.nextIndex;
        searchHasMore = hit.hasMore;
      }
      scanOffset = hayCursor;
      if (filled || !hit.hasMore) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    scanOffset = hayCursor;

    const sorted =
      (params.sort ?? 'newest') === 'newest'
        ? items
        : sortLocalCards(items, params.sort ?? 'name', items.map((c) => c.id));

    // Do NOT full-scan the slice for match counts — that blocks the grid.
    const hasMore =
      searchHasMore ||
      (items.length >= limit && hayCursor < searchIndex.ids.length);
    const unscanned = Math.max(0, searchIndex.ids.length - hayCursor);

    deferBrowseBackgroundWork(params.type, requestOffset);
    return {
      items: sorted,
      sliceKey,
      totalCached: stats.idCount,
      exhausted: syncExhausted,
      lastSyncedAt: syncStats.lastSyncedAt,
      nextOffset: scanOffset,
      hasMore,
      matchTotal: stats.idCount,
      matchRemaining: hasMore ? Math.max(1, unscanned) : 0,
    };
  }

  // Small batches: each id can JSON.parse a catalog page on this thread.
  const BATCH = 16;
  while (items.length < limit) {
    const { ids, total } = listSliceIdsWindow(
      catalogSliceKey,
      scanOffset,
      BATCH,
    );
    if (ids.length === 0) {
      scanOffset = total;
      break;
    }
    // Load/filter the batch once, then advance offset id-by-id so we never
    // skip leftover family matches when the page fills mid-batch.
    const byId = new Map(loadCards(ids).map((card) => [card.id, card]));
    for (const id of ids) {
      scanOffset += 1;
      const card = byId.get(id);
      if (card) {
        items.push(card);
        if (items.length >= limit) break;
      }
    }
    if (scanOffset >= total) break;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  const sorted =
    (params.sort ?? 'newest') === 'newest'
      ? items
      : sortLocalCards(items, params.sort ?? 'name', items.map((c) => c.id));

  // Upper-bound remaining (raw unscanned ids). Exact family/installed counts
  // used to full-scan the slice and delayed the first grid by many seconds.
  const hasMore = items.length >= limit && scanOffset < stats.idCount;
  const unscanned = Math.max(0, stats.idCount - scanOffset);

  deferBrowseBackgroundWork(params.type, requestOffset);
  return {
    items: sorted,
    sliceKey,
    totalCached: stats.idCount,
    exhausted: syncExhausted,
    lastSyncedAt: syncStats.lastSyncedAt,
    nextOffset: scanOffset,
    hasMore,
    matchTotal: stats.idCount,
    matchRemaining: hasMore ? Math.max(1, unscanned) : 0,
  };
}

/** @deprecated Prefer getCatalogSlice. */
export async function searchCivitaiModelCards(
  params: CivitaiBrowseCatalogParams,
): Promise<CivitaiSearchResultDto> {
  const result = await getCatalogSlice(params);
  return { items: result.items, nextCursor: null };
}

export function cancelCatalogSync(): void {
  if (activeSync) activeSync.cancelled = true;
}

function enabledCivitaiCategoriesForSync(): CivitaiModelCategoryId[] {
  return getActiveLibrary().enabledCivitaiCategories as CivitaiModelCategoryId[];
}

/**
 * Browse “All” uses a unified id index, but fills sync per category tag.
 * Only category slices were marked exhausted — the All slice stayed incomplete
 * forever. Derive All.exhausted from every enabled category slice.
 */
function areEnabledCategorySlicesExhausted(opts: {
  type: CivitaiModelType;
  architectures: CivitaiArchitectureIdDto[];
}): boolean {
  const origin = getCivitaiOrigin();
  const enabled = enabledCivitaiCategoriesForSync();
  if (enabled.length === 0) return true;
  return enabled.every((category) => {
    const key = buildCatalogSliceKey({
      origin,
      type: opts.type,
      category,
      architectures: opts.architectures,
      query: '',
    });
    return getCatalogSliceStats(key).exhausted;
  });
}

function syncAllSliceExhaustedFlag(opts: {
  type: CivitaiModelType;
  architectures: CivitaiArchitectureIdDto[];
}): boolean {
  const exhausted = areEnabledCategorySlicesExhausted(opts);
  const allKey = buildCatalogSliceKey({
    origin: getCivitaiOrigin(),
    type: opts.type,
    category: null,
    architectures: opts.architectures,
    query: '',
  });
  updateCatalogSlice(allKey, {
    exhausted,
    ...(exhausted ? { nextCursor: null } : {}),
  });
  return exhausted;
}

/**
 * Sync one tagged category slice. Progress counters live on `sync`;
 * `reportSliceKey` is what the UI is watching (may be the All key).
 * New ids are also mirrored into the untagged All slice so All browse
 * stays fresh without an untagged API crawl.
 */
async function syncTaggedCategorySlice(opts: {
  type: CivitaiModelTypeDto;
  architectures: CivitaiArchitectureIdDto[];
  category: CivitaiModelCategoryIdDto;
  requestedMode: 'auto' | 'incremental' | 'fill';
  force?: boolean;
  sync: ActiveSync;
  emit: (
    status: CivitaiCatalogSyncProgressDto['status'],
    error?: string,
  ) => CivitaiCatalogSyncProgressDto;
}): Promise<'done' | 'cancelled' | 'error'> {
  const origin = getCivitaiOrigin();
  const architectures = opts.architectures;
  const dataSliceKey = buildCatalogSliceKey({
    origin,
    type: opts.type,
    category: opts.category,
    architectures,
    query: '',
  });
  const allSliceKey = buildCatalogSliceKey({
    origin,
    type: opts.type,
    category: null,
    architectures,
    query: '',
  });

  let stats = getCatalogSliceStats(dataSliceKey);
  if (
    stats.idCount === 0 &&
    typeof stats.nextCursor === 'string' &&
    stats.nextCursor
  ) {
    updateCatalogSlice(dataSliceKey, {
      nextCursor: null,
      exhausted: false,
    });
    stats = getCatalogSliceStats(dataSliceKey);
  }

  const mode: 'incremental' | 'fill' =
    opts.requestedMode === 'fill'
      ? 'fill'
      : opts.requestedMode === 'incremental'
        ? 'incremental'
        : stats.idCount === 0 || !stats.exhausted
          ? 'fill'
          : 'incremental';
  opts.sync.mode = mode;

  // Idle tip-check cooldown (Settings → Civitai auto-sync interval).
  // Incomplete fills still run; force bypasses the interval.
  if (mode === 'incremental' && !opts.force) {
    const intervalMin = getCivitaiCatalogAutoSyncIntervalMinutes();
    if (intervalMin <= 0) {
      opts.sync.lastPageAdded = 0;
      return 'done';
    }
    const lastMs = stats.lastSyncedAt
      ? Date.parse(stats.lastSyncedAt)
      : Number.NaN;
    if (
      Number.isFinite(lastMs) &&
      Date.now() - lastMs < intervalMin * 60_000
    ) {
      opts.sync.lastPageAdded = 0;
      return 'done';
    }
  }

  const architectureIds = architectures as CivitaiArchitectureId[];
  const baseModels =
    architectureIds.length > 0
      ? expandArchitectureApiValues(architectureIds)
      : undefined;
  const tag = modelCategoryTag(opts.category);

  const knownIds = getSliceIdKnownSet(dataSliceKey);
  const filling = mode === 'fill';
  let cursor: string | undefined =
    filling && typeof stats.nextCursor === 'string' && stats.nextCursor
      ? stats.nextCursor
      : undefined;

  try {
    while (!opts.sync.cancelled) {
      const result = await searchCivitaiModels({
        type: opts.type,
        cursor,
        limit: SYNC_PAGE_LIMIT,
        sort: 'Newest',
        nsfw: true,
        baseModels: baseModels?.length ? baseModels : undefined,
        tag,
      });
      opts.sync.pagesFetched += 1;
      opts.sync.lastPageReceived = result.items.length;

      const pageIds = result.items.map((m) => m.id);
      const allKnown =
        pageIds.length > 0 && pageIds.every((id) => knownIds.has(id));

      // Always merge the tip page — known IDs can still carry newer versionId /
      // version snapshots. Exiting before insert missed checkpoint updates.
      const cached = result.items.map(toCachedModel);
      insertCachedModelsIfAbsent(cached);

      if (!filling && allKnown) {
        const now = new Date().toISOString();
        updateCatalogSlice(dataSliceKey, { lastSyncedAt: now });
        updateCatalogSlice(allSliceKey, { lastSyncedAt: now });
        opts.sync.lastPageAdded = 0;
        opts.emit('syncing');
        return 'done';
      }

      const newIds: number[] = [];
      const seenNew = new Set<number>();
      for (const id of pageIds) {
        if (knownIds.has(id) || seenNew.has(id)) continue;
        seenNew.add(id);
        newIds.push(id);
      }
      // EA page enrich is Browse-grid only (see scheduleEarlyAccessPageHeal) —
      // tip-check must not scrape every synced model.
      opts.sync.lastPageAdded = newIds.length;
      opts.sync.addedThisRun += newIds.length;

      const hayById = new Map(
        cached.map((m) => [m.id, catalogSearchHay(m)] as const),
      );
      const appendHays = newIds.map((id) => hayById.get(id) ?? '');

      const nextCursor =
        typeof result.nextCursor === 'string' && result.nextCursor
          ? result.nextCursor
          : null;
      const now = new Date().toISOString();

      if (filling) {
        updateCatalogSlice(dataSliceKey, {
          appendIds: newIds,
          appendHays,
          nextCursor,
          exhausted: !nextCursor,
          lastSyncedAt: now,
        });
        if (newIds.length > 0) {
          updateCatalogSlice(allSliceKey, {
            appendIds: newIds,
            appendHays,
            lastSyncedAt: now,
          });
        } else {
          updateCatalogSlice(allSliceKey, { lastSyncedAt: now });
        }
        if (!nextCursor) {
          syncAllSliceExhaustedFlag({
            type: opts.type,
            architectures,
          });
        }
      } else {
        updateCatalogSlice(dataSliceKey, {
          prependIds: newIds,
          lastSyncedAt: now,
        });
        if (newIds.length > 0) {
          updateCatalogSlice(allSliceKey, {
            prependIds: newIds,
            lastSyncedAt: now,
          });
        } else {
          updateCatalogSlice(allSliceKey, { lastSyncedAt: now });
        }
      }

      opts.emit('syncing');
      // Preview downloads are active-library scoped — do not queue every sync card.

      if (!nextCursor) {
        updateCatalogSlice(dataSliceKey, {
          exhausted: true,
          nextCursor: null,
          lastSyncedAt: now,
        });
        syncAllSliceExhaustedFlag({
          type: opts.type,
          architectures,
        });
        return 'done';
      }

      if (!filling && newIds.length === 0) {
        return 'done';
      }

      cursor = nextCursor;
      await sleep(SYNC_THROTTLE_MS);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    return 'cancelled';
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    opts.emit('error', message);
    return 'error';
  }
}

export async function syncCatalogSlice(
  params: CivitaiCatalogSyncParams,
): Promise<CivitaiCatalogSyncProgressDto> {
  const origin = getCivitaiOrigin();
  const architectures = params.architectures ?? [];
  const reportCategory = params.category ?? null;
  const reportSliceKey = buildCatalogSliceKey({
    origin,
    type: params.type,
    category: reportCategory,
    architectures,
    query: '',
  });
  const enabled = enabledCivitaiCategoriesForSync();

  if (activeSync && !activeSync.cancelled) {
    if (activeSync.sliceKey === reportSliceKey) {
      const stats = getCatalogSliceStats(reportSliceKey);
      return {
        sliceKey: reportSliceKey,
        status: 'syncing',
        mode: activeSync.mode,
        pagesFetched: activeSync.pagesFetched,
        totalCached: stats.idCount,
        addedThisRun: activeSync.addedThisRun,
        lastPageReceived: activeSync.lastPageReceived,
        lastPageAdded: activeSync.lastPageAdded,
        exhausted: stats.exhausted,
      };
    }
    activeSync.cancelled = true;
  }

  // Hidden category: leave disk cache alone; do not hit the API.
  if (
    reportCategory != null &&
    !enabled.includes(reportCategory as CivitaiModelCategoryId)
  ) {
    const stats = getCatalogSliceStats(reportSliceKey);
    const payload: CivitaiCatalogSyncProgressDto = {
      sliceKey: reportSliceKey,
      status: 'done',
      mode: 'incremental',
      pagesFetched: 0,
      totalCached: stats.idCount,
      addedThisRun: 0,
      lastPageReceived: 0,
      lastPageAdded: 0,
      exhausted: stats.exhausted,
      lastSyncedAt: stats.lastSyncedAt,
    };
    emitCatalogSyncProgress(payload);
    return payload;
  }

  // "All" syncs each enabled category (never an untagged crawl).
  const categoriesToSync: CivitaiModelCategoryIdDto[] =
    reportCategory == null
      ? [...enabled]
      : [reportCategory];

  const requested = params.mode ?? 'auto';
  const force = Boolean(params.force);

  // Avoid a “Checking for new models…” flash when every category is within the
  // idle tip-check interval (and none still need a fill backfill).
  if (requested !== 'fill' && !force) {
    const intervalMin = getCivitaiCatalogAutoSyncIntervalMinutes();
    const anyWork = categoriesToSync.some((category) => {
      const dataSliceKey = buildCatalogSliceKey({
        origin,
        type: params.type,
        category,
        architectures,
        query: '',
      });
      const stats = getCatalogSliceStats(dataSliceKey);
      const needsFill = stats.idCount === 0 || !stats.exhausted;
      if (requested === 'auto' && needsFill) return true;
      if (intervalMin <= 0) return false;
      const lastMs = stats.lastSyncedAt
        ? Date.parse(stats.lastSyncedAt)
        : Number.NaN;
      if (!Number.isFinite(lastMs)) return true;
      return Date.now() - lastMs >= intervalMin * 60_000;
    });
    if (!anyWork) {
      // Keep All.exhausted aligned even when we skip API work this tick.
      if (reportCategory == null) {
        syncAllSliceExhaustedFlag({
          type: params.type,
          architectures,
        });
      }
      const stats = getCatalogSliceStats(reportSliceKey);
      const payload: CivitaiCatalogSyncProgressDto = {
        sliceKey: reportSliceKey,
        status: 'done',
        mode: 'incremental',
        pagesFetched: 0,
        totalCached: stats.idCount,
        addedThisRun: 0,
        lastPageReceived: 0,
        lastPageAdded: 0,
        exhausted:
          reportCategory != null
            ? stats.exhausted
            : areEnabledCategorySlicesExhausted({
                type: params.type,
                architectures,
              }),
        lastSyncedAt: stats.lastSyncedAt,
      };
      emitCatalogSyncProgress(payload);
      return payload;
    }
  }

  const sync: ActiveSync = {
    sliceKey: reportSliceKey,
    cancelled: false,
    mode: 'incremental',
    pagesFetched: 0,
    addedThisRun: 0,
    lastPageReceived: 0,
    lastPageAdded: 0,
  };
  activeSync = sync;

  const reportExhausted = (): boolean =>
    reportCategory
      ? getCatalogSliceStats(reportSliceKey).exhausted
      : areEnabledCategorySlicesExhausted({
          type: params.type,
          architectures,
        });

  const emit = (
    status: CivitaiCatalogSyncProgressDto['status'],
    error?: string,
  ) => {
    const stats = getCatalogSliceStats(reportSliceKey);
    const payload: CivitaiCatalogSyncProgressDto = {
      sliceKey: reportSliceKey,
      status,
      mode: sync.mode,
      pagesFetched: sync.pagesFetched,
      totalCached: stats.idCount,
      addedThisRun: sync.addedThisRun,
      lastPageReceived: sync.lastPageReceived,
      lastPageAdded: sync.lastPageAdded,
      exhausted: reportExhausted(),
      error,
      lastSyncedAt: stats.lastSyncedAt,
    };
    emitCatalogSyncProgress(payload);
    return payload;
  };

  emit('syncing');

  try {
    let outcome: 'done' | 'cancelled' | 'error' = 'done';
    for (const category of categoriesToSync) {
      if (sync.cancelled) {
        outcome = 'cancelled';
        break;
      }
      const pass = await syncTaggedCategorySlice({
        type: params.type,
        architectures,
        category,
        requestedMode: requested,
        force,
        sync,
        emit,
      });
      if (pass === 'error') {
        // Error progress already emitted inside the pass.
        syncAllSliceExhaustedFlag({
          type: params.type,
          architectures,
        });
        const stats = getCatalogSliceStats(reportSliceKey);
        return {
          sliceKey: reportSliceKey,
          status: 'error',
          mode: sync.mode,
          pagesFetched: sync.pagesFetched,
          totalCached: stats.idCount,
          addedThisRun: sync.addedThisRun,
          lastPageReceived: sync.lastPageReceived,
          lastPageAdded: sync.lastPageAdded,
          exhausted: reportCategory
            ? stats.exhausted
            : areEnabledCategorySlicesExhausted({
                type: params.type,
                architectures,
              }),
        };
      }
      if (pass === 'cancelled') {
        outcome = 'cancelled';
        break;
      }
    }
    syncAllSliceExhaustedFlag({
      type: params.type,
      architectures,
    });
    return emit(outcome === 'cancelled' ? 'cancelled' : 'done');
  } finally {
    flushDirtyModelPagesSync();
    if (activeSync === sync) activeSync = null;
  }
}

export async function getCivitaiModelCard(
  modelId: number,
  typeHint?: CivitaiModelTypeDto,
): Promise<CivitaiModelCardDto> {
  const model = await getCivitaiModel(modelId);
  const versions = model.modelVersions ?? [];
  // Enrich library-relevant versions (not only global [0] — that may be Flux
  // while Krea is the gated one for this library).
  let enrichedLibrary = 0;
  for (let i = 0; i < versions.length; i++) {
    const version = versions[i]!;
    if (
      !versionAllowedInContext(
        {
          baseModel: version.baseModel,
          name: version.name,
        },
        null,
      )
    ) {
      continue;
    }
    const enriched = await enrichVersionEarlyAccess(version, {
      force: true,
      modelId,
      lane: 'interactive',
    });
    if (enriched) versions[i] = enriched;
    enrichedLibrary += 1;
    // Newest library match is enough for card EA; avoid N detail calls.
    if (enrichedLibrary >= 1) break;
  }
  if (enrichedLibrary === 0 && versions[0]) {
    const enriched = await enrichVersionEarlyAccess(versions[0], {
      force: true,
      modelId,
      lane: 'interactive',
    });
    if (enriched) versions[0] = enriched;
  }
  const type: CivitaiModelType =
    typeHint ??
    (model.type.toLowerCase() === 'checkpoint' ? 'Checkpoint' : 'LORA');
  const index = await indexForType(type);
  const card = toCard(model, type, index);
  const previewUrl = primaryPreviewUrl(model) ?? undefined;
  patchCachedModel(getCivitaiOrigin(), model.id, {
    previewUrl,
    previewMissing: !previewUrl,
    earlyAccess: card.earlyAccess,
    earlyAccessEndsAt: card.earlyAccessEndsAt,
    ...(card.publishedAt ? { publishedAt: card.publishedAt } : {}),
    ...(card.versionInstalls.length
      ? {
          versions: snapshotsFromModelVersions(model.modelVersions),
        }
      : {}),
  });
  return {
    ...card,
    previewUrl,
  };
}

/** Versions + weight files for the download confirm dialog. */
export async function listCivitaiModelDownloadOptions(
  modelId: number,
  opts?: {
    browseArchitectures?: CivitaiArchitectureIdDto[] | null;
  },
): Promise<CivitaiModelDownloadOptionsDto> {
  const model = await getCivitaiModel(modelId);
  const type: CivitaiModelType =
    model.type.toLowerCase() === 'checkpoint' ? 'Checkpoint' : 'LORA';
  const index = indexForTypeFast(type);
  const browseArchitectures = (opts?.browseArchitectures ?? null) as
    | CivitaiArchitectureId[]
    | null;
  const seenVersionIds = new Set<number>();
  const versions = (model.modelVersions ?? [])
    .map((version) => {
      const weightFiles = (version.files ?? []).filter(
        (f) =>
          Boolean(f.name) &&
          (f.primary === true ||
            /\.(safetensors|ckpt|pt)$/i.test(f.name) ||
            Boolean(f.downloadUrl)),
      );
      const files = dedupeFilesByName(
        weightFiles.length > 0
          ? weightFiles
          : (version.files ?? []).filter((f) => Boolean(f.name)),
      );
      const earlyAccessEndsAt = resolveEarlyAccessEndsAt(version);
      const earlyAccess = isVersionEarlyAccess(version);
      const versionName = version.name?.trim() || `Version ${version.id}`;
      return {
        id: version.id,
        name: versionName,
        baseModel: version.baseModel,
        earlyAccess,
        earlyAccessEndsAt: earlyAccessEndsAt || undefined,
        files: files.map((f) => {
          const autoV2 = pickCivitaiAutoV2(f.hashes) ?? undefined;
          const installed =
            findLocalInstallMatches(
              index,
              f.name ?? '',
              autoV2 ? { AutoV2: autoV2 } : undefined,
              autoV2 ? [autoV2] : null,
            ).length > 0 ||
            isCivitaiVersionMarkedInstalled(
              modelId,
              version.id,
              f.id,
              f.name,
            );
          return {
            id: f.id,
            name: f.name,
            sizeKB: readFileSizeKB(f),
            primary: Boolean(f.primary),
            autoV2,
            variantLabel: variantLabelFromFileName(f.name, versionName),
            installed,
          };
        }),
      };
    })
    .filter((v) => {
      if (v.files.length === 0) return false;
      if (seenVersionIds.has(v.id)) return false;
      seenVersionIds.add(v.id);
      return versionAllowedInContext(
        {
          baseModel: v.baseModel,
          name: v.name,
        },
        browseArchitectures,
      );
    });

  const picks = dedupeDownloadPicks(
    versions.flatMap((v) => {
      const ea = isEarlyAccessActive(
        Boolean(v.earlyAccess),
        v.earlyAccessEndsAt,
      );
      const multi = v.files.length > 1;
      return v.files.map((f) => {
        const label = formatVersionVariantLabel({
          versionName: v.name,
          variantLabel: multi ? f.variantLabel : undefined,
          fileName: multi ? f.name : undefined,
        });
        const fileKey =
          typeof f.id === 'number' && f.id > 0
            ? String(f.id)
            : f.name.trim().toLowerCase();
        return {
          key: `${v.id}:${fileKey}`,
          versionId: v.id,
          versionName: v.name,
          fileId: f.id,
          fileName: f.name,
          autoV2: f.autoV2,
          label:
            (f.installed ? `${label} · on disk` : label) +
            (ea ? ' · early access' : ''),
          earlyAccess: ea,
          installed: Boolean(f.installed),
          sizeKB: f.sizeKB,
        };
      });
    }),
  );

  return {
    modelId: model.id,
    modelName: model.name,
    versions,
    picks,
  };
}

/**
 * Fetch full model detail, refresh catalog version snapshots, and return an
 * updated card (install rows for every version).
 */
const missingCivitaiModelIds = new Set<number>();

function isCivitaiModelNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\(404\)/.test(message) || /No model with id/i.test(message);
}

export async function refreshCivitaiModelVersionInstalls(
  modelId: number,
  typeHint?: CivitaiModelTypeDto,
): Promise<CivitaiModelCardDto> {
  const origin = getCivitaiOrigin();
  if (missingCivitaiModelIds.has(modelId)) {
    const cached = getCachedModel(origin, modelId);
    if (cached) {
      const type: CivitaiModelType =
        typeHint ??
        (cached.type.toLowerCase() === 'checkpoint' ? 'Checkpoint' : 'LORA');
      return cachedToCard(
        cached,
        type === 'Checkpoint'
          ? getConfiguredCheckpointIndexCachedHashes()
          : getConfiguredLoraIndexCachedHashes(),
        { includePotentialMatches: false },
      );
    }
    throw new Error(`Civitai model ${modelId} is gone`);
  }
  let model;
  try {
    model = await getCivitaiModel(modelId);
  } catch (error) {
    if (isCivitaiModelNotFoundError(error)) {
      missingCivitaiModelIds.add(modelId);
      const cached = getCachedModel(origin, modelId);
      if (cached) {
        const type: CivitaiModelType =
          typeHint ??
          (cached.type.toLowerCase() === 'checkpoint' ? 'Checkpoint' : 'LORA');
        return cachedToCard(
          cached,
          type === 'Checkpoint'
            ? getConfiguredCheckpointIndexCachedHashes()
            : getConfiguredLoraIndexCachedHashes(),
          { includePotentialMatches: false },
        );
      }
    }
    throw error;
  }
  // Do not page-scrape here — Downloaded hydrate / version rows only.
  // EA deadlines are Browse-grid enrich (enrichBrowseEarlyAccess) or
  // explicit card open (getCivitaiModelCard).
  const versions = snapshotsFromModelVersions(model.modelVersions);
  const latest = versions[0];
  const hashes = collectAutoV2HashesFromVersions(model.modelVersions);
  patchCachedModel(origin, modelId, {
    autoV2Hashes: hashes,
    autoV2HashesExpandedAt: new Date().toISOString(),
    ...(latest
      ? {
          versionId: latest.id,
          versionName: latest.name,
          fileName: latest.fileName,
          baseModel: latest.baseModel,
          autoV2: latest.autoV2,
          earlyAccess: Boolean(latest.earlyAccess),
          earlyAccessEndsAt: latest.earlyAccessEndsAt,
        }
      : {}),
    ...(versions.length > 0 ? { versions } : {}),
  });
  const type: CivitaiModelType =
    typeHint ??
    (model.type.toLowerCase() === 'checkpoint' ? 'Checkpoint' : 'LORA');
  const index = await indexForType(type);
  return toCard(model, type, index);
}

function stubShelfCard(opts: {
  id: number;
  origin: string;
  type: string;
  name?: string;
  archived: boolean;
  maybe: boolean;
}): CivitaiModelCardDto {
  const name = opts.name?.trim() || `Model ${opts.id}`;
  return {
    id: opts.id,
    name,
    type: opts.type,
    nsfw: false,
    tags: [],
    trainedWords: [],
    pageUrl: civitaiModelPageUrl(opts.origin, opts.id, name),
    installed: false,
    latestVersionInstalled: true,
    hasUninstalledVersion: false,
    hasDownloadableVersion: false,
    versionInstalls: [],
    markedInstalled: false,
    archived: opts.archived,
    maybe: opts.maybe,
    hidden: opts.archived,
    potentialLocalMatches: [],
    statusTags: [],
    earlyAccess: false,
    watching: false,
  };
}

function hydrateShelfCardsFromCache(
  entries: Array<{ origin: string; modelId: number }>,
  flags: { archived: boolean; maybe: boolean },
): CivitaiModelCardDto[] {
  const origin = getCivitaiOrigin();
  const seen = new Set<number>();
  const ids: Array<{ origin: string; modelId: number }> = [];
  for (const entry of entries) {
    if (seen.has(entry.modelId)) continue;
    seen.add(entry.modelId);
    ids.push(entry);
  }
  ids.sort((a, b) => a.modelId - b.modelId);
  const cards: CivitaiModelCardDto[] = [];
  for (const entry of ids) {
    const cached =
      getCachedModel(origin, entry.modelId) ??
      getCachedModel(entry.origin, entry.modelId);
    if (cached) {
      cards.push(
        cachedToCard(cached, null, {
          includePotentialMatches: false,
          skipInstallScan: true,
        }),
      );
      continue;
    }
    cards.push(
      stubShelfCard({
        id: entry.modelId,
        origin: entry.origin || origin,
        type: 'LORA',
        archived: flags.archived,
        maybe: flags.maybe,
      }),
    );
  }
  return cards;
}

export async function listArchivedCivitaiCards(): Promise<CivitaiModelCardDto[]> {
  // Local archive ids + catalog cache only. Network fallback used to serialize
  // thousands of API calls and left the Archive grid empty for minutes.
  return hydrateShelfCardsFromCache(listArchivedCivitaiModels(), {
    archived: true,
    maybe: false,
  });
}

export async function listMaybeCivitaiCards(): Promise<CivitaiModelCardDto[]> {
  return hydrateShelfCardsFromCache(listMaybeCivitaiModels(), {
    archived: false,
    maybe: true,
  });
}

function freezeIndexForInstallScan(
  index: LoraIndex | null,
): LoraIndex | null {
  if (!index) return null;
  if (!index.byAutoV2) return index;
  return {
    ...index,
    byAutoV2: new Map(index.byAutoV2),
  };
}

/** Cached Civitai models that are installed locally (or marked installed). */
export async function listInstalledCivitaiCards(): Promise<CivitaiModelCardDto[]> {
  const origin = getCivitaiOrigin();
  // Snapshot hashes — a concurrent folder walk / hash attach mutates the
  // live index and was marking thousands of catalog cards as installed.
  const loraIndex = freezeIndexForInstallScan(
    getConfiguredLoraIndexCachedHashes(),
  );
  const checkpointIndex = freezeIndexForInstallScan(
    getConfiguredCheckpointIndexCachedHashes(),
  );
  const catalogIndex = getAutoV2CatalogIndex();
  const hashes = [
    ...(loraIndex?.byAutoV2?.keys() ?? []),
    ...(checkpointIndex?.byAutoV2?.keys() ?? []),
  ];
  const liveIds = collectInstalledModelIdsFromHashes({
    hashes,
    catalogIndex,
  });
  for (const entry of listMarkedInstalledCivitaiModels()) {
    if (entry.modelId > 0) liveIds.push(entry.modelId);
  }
  const persistedRows = listPersistedDownloadedSummaries();
  const persistById = new Map(persistedRows.map((row) => [row.id, row]));
  const live = collectLiveInstalledIds();
  const ids = mergePersistedInstalledIds(
    persistedRows.map((row) => row.id),
    [...new Set(liveIds)],
    live.canShrink &&
      Boolean(loraIndex?.byAutoV2 || checkpointIndex?.byAutoV2),
  ).sort((a, b) => a - b);

  const persistSet = new Set(ids);
  const byId = new Map<number, CivitaiModelCardDto>();
  let scanned = 0;
  for (const id of ids) {
    scanned += 1;
    if (scanned % 16 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const cached = getCachedModel(origin, id);
    if (!cached) {
      const prior = persistById.get(id);
      if (!prior) continue;
      const stub = stubShelfCard({
        id,
        origin,
        type: prior.type || 'LORA',
        archived: false,
        maybe: false,
      });
      byId.set(id, { ...stub, installed: true, tags: prior.tags });
      continue;
    }
    const type: CivitaiModelType =
      cached.type.toLowerCase() === 'checkpoint' ? 'Checkpoint' : 'LORA';
    const card = cachedToCard(
      cached,
      type === 'Checkpoint' ? checkpointIndex : loraIndex,
      { includePotentialMatches: false },
    );
    if (card.installed || card.markedInstalled || persistSet.has(id)) {
      const forced = persistSet.has(id) && !card.installed && !card.markedInstalled;
      // A persisted download with no hash hit is still installed. Leaving
      // latestVersionInstalled false here is what flagged dozens of current
      // checkpoints as updates.
      const latestVersionInstalled = forced
        ? !hasNewerVersionUpdate(card.versionInstalls)
        : card.latestVersionInstalled;
      const installedCard = {
        ...card,
        installed: true,
        latestVersionInstalled,
      };
      byId.set(card.id, {
        ...installedCard,
        statusTags: buildStatusTags({
          installed: true,
          archived: installedCard.archived,
          maybe: installedCard.maybe,
          watching: installedCard.watching,
          earlyAccess: installedCard.earlyAccess,
          potentialLocalMatches: installedCard.potentialLocalMatches,
          latestVersionInstalled,
          hasDownloadableVersion: installedCard.hasDownloadableVersion,
        }),
      });
    }
  }

  const cards = [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
  rememberDownloadedSummaries(cards.map((card) => summaryFromCardLike(card)));
  return cards;
}

export {
  markCivitaiModelInstalled,
  markCivitaiVersionInstalled,
  unmarkCivitaiModelInstalled,
};

export function listCivitaiWatchlistDtos(): WatchedCivitaiModelDto[] {
  // Legacy rows marked available must leave Notify immediately.
  purgeAvailableCivitaiWatchlistEntries();

  const origin = getCivitaiOrigin();
  const loraIndex = getConfiguredLoraIndexCachedHashes();
  const checkpointIndex = getConfiguredCheckpointIndexCachedHashes();
  const out: WatchedCivitaiModelDto[] = [];

  for (const entry of listCivitaiWatchlist()) {
    const cached =
      getCachedModel(origin, entry.modelId) ??
      (entry.origin !== origin
        ? getCachedModel(entry.origin, entry.modelId)
        : undefined);
    if (!cached) {
      out.push(toWatchDto(entry));
      continue;
    }
    const modelType: CivitaiModelType =
      cached.type.toLowerCase() === 'checkpoint' ? 'Checkpoint' : 'LORA';
    const card = cachedToCard(
      cached,
      modelType === 'Checkpoint' ? checkpointIndex : loraIndex,
      { includePotentialMatches: false },
    );
    const earlyAccessEndsAt = pickWatchlistEarlyAccessEndsAt(
      entry,
      cached,
      card,
    );
    // Persist catalog end times onto the watch row so Notify survives thin feeds.
    if (
      earlyAccessEndsAt &&
      earlyAccessEndsAt !== coerceEndsAtIso(entry.earlyAccessEndsAt)
    ) {
      updateCivitaiWatchlistEntry(entry.modelId, { earlyAccessEndsAt });
    }
    // Never auto-unwatch from cache alone — missing EA fields looked like
    // “available” and wrongly returned still-gated models to Browse.
    const enriched = {
      ...entry,
      available: false,
      earlyAccessEndsAt,
    };
    out.push(toWatchDto(enriched, { ...card, earlyAccessEndsAt }));
  }
  return out;
}

let watchlistRefreshInFlight: Promise<{
  items: WatchedCivitaiModelDto[];
  newlyAvailable: WatchedCivitaiModelDto[];
}> | null = null;

/**
 * Clear model + version early-access flags in the catalog after unlock.
 * Version snaps often keep `earlyAccess: true` with no end time; leaving them
 * makes Browse keep the Bell and hide Download.
 */
function patchCachedModelEarlyAccessCleared(
  origin: string,
  modelId: number,
  cached: CachedCivitaiModel,
  endsAt?: string,
): void {
  // Stamp a concrete end time so catalog merges treat the unlock as proven
  // (thin feeds that send earlyAccess:false without an end must not flip
  // active Buzz EA back and forth — but a past end must stick).
  const unlockedAt = endsAt ?? new Date().toISOString();
  const versions = (cached.versions ?? []).map((v) => ({
    ...v,
    earlyAccess: false,
    earlyAccessEndsAt: v.earlyAccessEndsAt ?? unlockedAt,
    // Clear paid residue so tip-check cannot re-lock after unlock.
    downloadPrice: undefined,
  }));
  patchCachedModel(origin, modelId, {
    earlyAccess: false,
    earlyAccessEndsAt: unlockedAt,
    ...(versions.length > 0 ? { versions } : {}),
  });
}

/**
 * Stamp an active EA gate from a page scrape onto the catalog row.
 * Only the latest version snap is gated — older unlocked versions stay open.
 */
function patchCachedModelEarlyAccessActive(
  origin: string,
  modelId: number,
  cached: CachedCivitaiModel,
  opts: { endsAt?: string; downloadPrice?: number },
): void {
  const versions = cached.versions ?? [];
  const latestId =
    versions.length > 0
      ? Math.max(...versions.map((v) => v.id))
      : cached.versionId;
  const nextVersions = versions.map((v) => {
    if (latestId != null && v.id === latestId) {
      return {
        ...v,
        earlyAccess: true,
        earlyAccessEndsAt: opts.endsAt ?? v.earlyAccessEndsAt,
        ...(opts.downloadPrice != null
          ? { downloadPrice: opts.downloadPrice }
          : {}),
      };
    }
    // Keep proven unlocks on older versions.
    if (v.earlyAccessEndsAt && !isEarlyAccessActive(true, v.earlyAccessEndsAt)) {
      return { ...v, earlyAccess: false };
    }
    return v;
  });
  patchCachedModel(origin, modelId, {
    earlyAccess: true,
    earlyAccessEndsAt: opts.endsAt ?? cached.earlyAccessEndsAt,
    ...(nextVersions.length > 0 ? { versions: nextVersions } : {}),
  });
}

/**
 * REST lists paid Buzz EA as `Public` with no deadline. Scrape the model page
 * for endsAt and/or Buzz price, then patch the catalog so Browse shows Bell
 * instead of a false Download.
 *
 * A *past* catalog endsAt must NOT skip the scrape — a newer version can open
 * a fresh EA window while the model row still carries the old unlock.
 */
async function applyEarlyAccessEndsAtFromPage(
  modelId: number,
  opts?: { lane?: 'background' | 'interactive' },
): Promise<'active' | 'ended' | 'none'> {
  const origin = getCivitaiOrigin();
  const cached = getCachedModel(origin, modelId);
  if (!cached) return 'none';
  const known = coerceEndsAtIso(cached.earlyAccessEndsAt);
  const knownPrice = (cached.versions ?? []).some(
    (v) => typeof v.downloadPrice === 'number' && v.downloadPrice > 0,
  );
  // Skip network only when we already know a *future* window or paid gate.
  if (
    (known && isEarlyAccessActive(true, known)) ||
    (cached.earlyAccess && knownPrice && !known)
  ) {
    return 'active';
  }

  const gate = await fetchEarlyAccessGateFromModelPage(modelId, {
    lane: opts?.lane ?? 'background',
  });
  if (!gate) {
    if (known && !isEarlyAccessActive(true, known)) return 'ended';
    return 'none';
  }
  const fresh = getCachedModel(origin, modelId) ?? cached;
  if (gate.gated) {
    patchCachedModelEarlyAccessActive(origin, modelId, fresh, {
      endsAt: gate.endsAt,
      downloadPrice: gate.downloadPrice,
    });
    return 'active';
  }
  if (gate.endsAt) {
    patchCachedModelEarlyAccessCleared(origin, modelId, fresh, gate.endsAt);
    return 'ended';
  }
  return 'none';
}

const earlyAccessHealInFlight = new Set<number>();
/** One Browse EA enrich attempt per model per process (success or fail). */
const earlyAccessEnrichAttempted = new Set<number>();

/**
 * EA page enrich for model ids the Browse UI is actually showing.
 * Call only with post-filter visible grid ids — never from tip-check / peek.
 * Each model is attempted at most once per app session.
 * Returns how many catalog cards changed (caller may quiet-reload Browse).
 */
export function enrichBrowseEarlyAccess(
  modelIds: number[],
  reportSliceKey?: string,
): Promise<number> {
  const origin = getCivitaiOrigin();
  const key =
    reportSliceKey?.trim() ||
    buildCatalogSliceKey({
      origin,
      type: 'LORA',
      category: null,
      architectures: [],
      query: '',
    });
  return scheduleEarlyAccessPageHeal(modelIds, key);
}

/**
 * Background EA check for cards currently returned to the Browse grid.
 * Does nothing when Browse is empty. Not used by tip-check / catalog sync.
 * Does not emit fake catalog-sync progress (that re-triggered loadCatalog).
 */
function scheduleEarlyAccessPageHeal(
  modelIds: number[],
  _reportSliceKey: string,
): Promise<number> {
  const ids = [
    ...new Set(
      modelIds.filter((id) => Number.isFinite(id) && id > 0).map(Math.round),
    ),
  ].filter(
    (id) =>
      !earlyAccessHealInFlight.has(id) && !earlyAccessEnrichAttempted.has(id),
  );
  if (ids.length === 0) return Promise.resolve(0);
  // Reserve in-flight only — permanent "attempted" waits for a definitive result
  // so a .red 403 does not permanently hide a .com deadline forever.
  for (const id of ids) earlyAccessHealInFlight.add(id);

  return (async () => {
    let changed = 0;
    try {
      for (const id of ids) {
        try {
          const before = getCachedModel(getCivitaiOrigin(), id);
          const result = await applyEarlyAccessEndsAtFromPage(id, {
            lane: 'background',
          });
          if (
            result === 'active' ||
            result === 'ended' ||
            hasCompletedEarlyAccessPageScrape(id)
          ) {
            earlyAccessEnrichAttempted.add(id);
          }
          const after = getCachedModel(getCivitaiOrigin(), id);
          if (
            result !== 'none' &&
            (before?.earlyAccess !== after?.earlyAccess ||
              before?.earlyAccessEndsAt !== after?.earlyAccessEndsAt)
          ) {
            changed += 1;
          }
        } catch {
          // Keep healing the rest.
        } finally {
          earlyAccessHealInFlight.delete(id);
        }
      }
    } finally {
      for (const id of ids) earlyAccessHealInFlight.delete(id);
    }
    return changed;
  })();
}

/**
 * Re-check Notify list. Prefer catalog end times (instant countdown / unlock).
 * Only hits the network for models that still lack an end time.
 * Concurrent callers share one in-flight pass (avoids stacked 1 req/s crawls).
 */
export async function refreshCivitaiWatchlist(opts?: {
  /** When false, only use catalog/cached end times — no model-page scrape. */
  allowPageScrape?: boolean;
}): Promise<{
  items: WatchedCivitaiModelDto[];
  newlyAvailable: WatchedCivitaiModelDto[];
}> {
  if (watchlistRefreshInFlight) return watchlistRefreshInFlight;
  const allowPageScrape = opts?.allowPageScrape !== false;
  watchlistRefreshInFlight = refreshCivitaiWatchlistOnce({
    allowPageScrape,
  }).finally(() => {
    watchlistRefreshInFlight = null;
  });
  return watchlistRefreshInFlight;
}

async function refreshCivitaiWatchlistOnce(opts: {
  allowPageScrape: boolean;
}): Promise<{
  items: WatchedCivitaiModelDto[];
  newlyAvailable: WatchedCivitaiModelDto[];
}> {
  purgeAvailableCivitaiWatchlistEntries();

  const origin = getCivitaiOrigin();
  const newlyAvailable: WatchedCivitaiModelDto[] = [];
  const items: WatchedCivitaiModelDto[] = [];
  const loraIndex = getConfiguredLoraIndexCachedHashes();
  const checkpointIndex = getConfiguredCheckpointIndexCachedHashes();

  for (const entry of listCivitaiWatchlist()) {
    if (entry.origin !== origin) {
      items.push(toWatchDto(entry));
      continue;
    }

    const cached = getCachedModel(origin, entry.modelId);
    const cachedType: CivitaiModelType =
      cached && cached.type.toLowerCase() === 'checkpoint'
        ? 'Checkpoint'
        : entry.type === 'Checkpoint'
          ? 'Checkpoint'
          : 'LORA';
    const cachedCard = cached
      ? cachedToCard(
          cached,
          cachedType === 'Checkpoint' ? checkpointIndex : loraIndex,
          { includePotentialMatches: false },
        )
      : undefined;
    const catalogEndsAt = pickWatchlistEarlyAccessEndsAt(
      entry,
      cached,
      cachedCard,
    );

    // Known future end → show countdown, skip network.
    if (catalogEndsAt && isEarlyAccessActive(true, catalogEndsAt)) {
      if (catalogEndsAt !== coerceEndsAtIso(entry.earlyAccessEndsAt)) {
        updateCivitaiWatchlistEntry(entry.modelId, {
          earlyAccessEndsAt: catalogEndsAt,
          available: false,
        });
      }
      const updated = listCivitaiWatchlist().find(
        (m) => m.modelId === entry.modelId,
      )!;
      items.push(
        toWatchDto(updated, cachedCard
          ? { ...cachedCard, earlyAccessEndsAt: catalogEndsAt }
          : undefined),
      );
      continue;
    }

    // Known past end → unlock from catalog time when there is no Buzz residue.
    // Paid Buzz snaps often keep downloadPrice after the countdown; those need
    // a live page/API confirm (below) so we do not pin false “available” cards.
    if (catalogEndsAt && !isEarlyAccessActive(true, catalogEndsAt)) {
      const buzzResidue = (cached?.versions ?? []).some((v) =>
        versionHasPaidBuzzResidue(v),
      );
      if (!buzzResidue) {
        if (cached) {
          patchCachedModelEarlyAccessCleared(
            origin,
            entry.modelId,
            cached,
            catalogEndsAt,
          );
        }
        newlyAvailable.push(
          unlockNotifyWatchEntry(
            entry,
            cachedCard
              ? {
                  ...cachedCard,
                  earlyAccess: false,
                  earlyAccessEndsAt: catalogEndsAt,
                }
              : undefined,
          ),
        );
        continue;
      }
      if (!opts.allowPageScrape) {
        items.push(toWatchDto(entry, cachedCard));
        continue;
      }
      // Fall through to page scrape / API confirm.
    }

    // No confirmed unlock yet — page scrape only when allowed
    // (explicit Notify refresh). Background polls must not hit civitai.red HTML.
    if (!opts.allowPageScrape) {
      items.push(toWatchDto(entry, cachedCard));
      continue;
    }

    try {
      const gate = await fetchEarlyAccessGateFromModelPage(entry.modelId, {
        lane: 'interactive',
        force: true,
      });
      let endsAt = gate?.endsAt;

      if (gate?.gated) {
        updateCivitaiWatchlistEntry(entry.modelId, {
          earlyAccessEndsAt: endsAt,
          available: false,
        });
        if (cached) {
          patchCachedModelEarlyAccessActive(origin, entry.modelId, cached, {
            endsAt,
            downloadPrice: gate.downloadPrice,
          });
        }
        const updated = listCivitaiWatchlist().find(
          (m) => m.modelId === entry.modelId,
        )!;
        items.push(
          toWatchDto(
            updated,
            cachedCard
              ? {
                  ...cachedCard,
                  earlyAccess: true,
                  earlyAccessEndsAt: endsAt ?? cachedCard.earlyAccessEndsAt,
                }
              : undefined,
          ),
        );
        continue;
      }

      // Page says not gated (past end and/or no Buzz) — unlock with real card state.
      if (endsAt && !isEarlyAccessActive(true, endsAt) && gate && !gate.gated) {
        if (cached) {
          patchCachedModelEarlyAccessCleared(origin, entry.modelId, cached, endsAt);
        }
        newlyAvailable.push(
          unlockNotifyWatchEntry(
            entry,
            cachedCard
              ? {
                  ...cachedCard,
                  earlyAccess: false,
                  earlyAccessEndsAt: endsAt,
                }
              : undefined,
          ),
        );
        continue;
      }

      const model = await getCivitaiModel(entry.modelId, {
        lane: 'interactive',
      });
      const matching = (model.modelVersions ?? []).filter((version) =>
        versionAllowedInContext(
          {
            baseModel: version.baseModel,
            name: version.name,
          },
          null,
        ),
      );
      const latestLibrary = matching[0] ?? model.modelVersions?.[0];
      const enrichedVersion = latestLibrary
        ? await enrichVersionEarlyAccess(latestLibrary, {
            lane: 'interactive',
            modelId: entry.modelId,
            force: true,
          })
        : undefined;
      if (enrichedVersion && latestLibrary) {
        const idx = (model.modelVersions ?? []).findIndex(
          (v) => v.id === latestLibrary.id,
        );
        if (idx >= 0) model.modelVersions![idx] = enrichedVersion;
      }

      const type: CivitaiModelType =
        entry.type === 'Checkpoint' ? 'Checkpoint' : 'LORA';
      const index = await indexForType(type);
      const card = toCard(model, type, index);
      endsAt =
        resolveEarlyAccessEndsAt(enrichedVersion) ||
        card.earlyAccessEndsAt ||
        endsAt ||
        undefined;

      const unlocked =
        enrichedVersion != null &&
        isVersionConfirmedPublic(enrichedVersion) &&
        !card.earlyAccess;

      if (unlocked) {
        const liveVersions = (
          snapshotsFromModelVersions(model.modelVersions) ?? []
        ).map((v) => ({
          ...v,
          earlyAccess: false,
          earlyAccessEndsAt: v.earlyAccessEndsAt ?? endsAt,
        }));
        patchCachedModel(origin, entry.modelId, {
          earlyAccess: false,
          earlyAccessEndsAt: endsAt,
          versions: liveVersions,
        });
        newlyAvailable.push(
          unlockNotifyWatchEntry(
            {
              ...entry,
              modelName: card.name,
              versionId: card.versionId,
            },
            card,
          ),
        );
        continue;
      }

      updateCivitaiWatchlistEntry(entry.modelId, {
        modelName: card.name,
        versionId: card.versionId,
        earlyAccessEndsAt: endsAt,
        available: false,
      });
      patchCachedModel(origin, entry.modelId, {
        earlyAccess: card.earlyAccess,
        earlyAccessEndsAt: endsAt || card.earlyAccessEndsAt,
        versions: snapshotsFromModelVersions(model.modelVersions),
      });
      const updated = listCivitaiWatchlist().find(
        (m) => m.modelId === entry.modelId,
      )!;
      items.push(
        toWatchDto(updated, {
          ...card,
          earlyAccessEndsAt: endsAt || card.earlyAccessEndsAt,
        }),
      );
    } catch {
      items.push(toWatchDto(entry, cachedCard));
    }
  }

  if (newlyAvailable.length > 0) {
    recordCivitaiRecentlyUnlocked(
      newlyAvailable.map((e) => ({
        modelId: e.modelId,
        modelName: e.modelName,
        type: e.type === 'Checkpoint' ? 'Checkpoint' : 'LORA',
        versionId: e.versionId,
        unlockedAt: e.availableAt,
      })),
    );
  }

  return { items, newlyAvailable };
}

/**
 * Models that left Notify after early access ended. Pinned in Browse until the
 * user dismisses or downloads them — catalog sort alone often hides old models.
 */
export function listCivitaiRecentlyUnlockedDtos(): WatchedCivitaiModelDto[] {
  const origin = getCivitaiOrigin();
  const loraIndex = getConfiguredLoraIndexCachedHashes();
  const checkpointIndex = getConfiguredCheckpointIndexCachedHashes();
  const out: WatchedCivitaiModelDto[] = [];

  for (const entry of listCivitaiRecentlyUnlocked()) {
    if (entry.origin !== origin) {
      out.push(
        toWatchDto({
          ...entry,
          available: true,
          addedAt: entry.unlockedAt,
          availableAt: entry.unlockedAt,
          earlyAccessEndsAt: undefined,
        }),
      );
      continue;
    }
    // User already shelved or installed — drop the Browse pin so Archive/Maybe
    // and Downloaded stick instead of being re-injected as “just unlocked”.
    if (
      isCivitaiModelArchived(entry.modelId) ||
      isCivitaiModelMaybe(entry.modelId) ||
      isCivitaiModelMarkedInstalled(entry.modelId)
    ) {
      dismissCivitaiRecentlyUnlocked(entry.modelId);
      continue;
    }
    const cached = getCachedModel(origin, entry.modelId);
    let card: CivitaiModelCardDto | undefined;
    if (cached) {
      const modelType: CivitaiModelType =
        cached.type.toLowerCase() === 'checkpoint' ? 'Checkpoint' : 'LORA';
      card = cachedToCard(
        cached,
        modelType === 'Checkpoint' ? checkpointIndex : loraIndex,
        { includePotentialMatches: false },
      );
      if (card.installed) {
        dismissCivitaiRecentlyUnlocked(entry.modelId);
        continue;
      }
      card = {
        ...card,
        watching: false,
        archived: false,
        maybe: false,
      };
    }
    out.push(
      toWatchDto(
        {
          ...entry,
          available: true,
          addedAt: entry.unlockedAt,
          availableAt: entry.unlockedAt,
          earlyAccessEndsAt: undefined,
        },
        card,
      ),
    );
  }
  return out;
}

export { dismissCivitaiRecentlyUnlocked };
