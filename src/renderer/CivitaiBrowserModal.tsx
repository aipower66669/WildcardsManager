import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellRing,
  Bookmark,
  BookmarkMinus,
  Box,
  Building2,
  Car,
  CheckCircle2,
  ClipboardPaste,
  Cuboid,
  Download,
  ExternalLink,
  FolderOpen,
  Image,
  Video,
  LayoutGrid,
  Layers,
  Lightbulb,
  ListOrdered,
  Minus,
  Package,
  Palette,
  PanelTop,
  PanelRightClose,
  PawPrint,
  PersonStanding,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  Shirt,
  Sparkles,
  Sprout,
  SquareArrowOutUpRight,
  Undo2,
  User,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  CIVITAI_ARCHITECTURE_PRESETS,
  CIVITAI_SDXL_FAMILY_PRESETS,
  expandArchitectureApiValues,
  matchesArchitectureFilter,
  matchesEnabledSdxlFamilies,
  matchesSdxlFamily,
  resolveVersionBaseModel,
  sdxlFamilyBadgeId,
  type CivitaiArchitectureId,
  type CivitaiSdxlFamilyId,
  type CivitaiSdxlFamilyToggleId,
} from '../domain/civitaiBaseModels';
import { CivitaiImagesPanel } from './CivitaiImagesPanel';
import { isEarlyAccessActive } from '../domain/civitaiEarlyAccess';
import { versionMarksForCurrentPicks } from '../domain/civitaiVersionMark';
import {
  CIVITAI_MODEL_CATEGORY_PRESETS,
  categoryIdFromTags,
  modelCategoryTag,
  type CivitaiModelCategoryId,
} from '../domain/civitaiModelCategories';
import { civitaiModelPageUrl } from '../domain/civitaiSnippet';
import {
  proposeDownloadSaveFileName,
  resolveDownloadSaveFileName,
} from '../domain/civitaiDownloadFileName';
import { mergeDownloadedCatalogCards } from '../domain/civitaiDownloadedMerge';
import {
  formatVersionVariantLabel,
  installFlagsForVersions,
} from '../domain/civitaiVersions';
import {
  DEFAULT_LORA_DOWNLOAD_WEIGHTS,
  normalizeLoraWeights,
  uniqueExtraLoraCategoryIds,
} from '../domain/loraDownloadCategory';
import { LoraDownloadCategoryManagerModal } from './LoraDownloadCategoryManagerModal';
import { ModelDownloadQueueModal } from './ModelDownloadQueueModal';
import { DownloadConsole } from './DownloadConsole';
import { modalOverlayDismiss } from './modalOverlayDismiss';
import { useDraggableModal } from './useDraggableModal';
import { CivitaiVirtualGrid } from './CivitaiVirtualGrid';
import { civitaiSizedPreviewUrl } from '../shared/civitaiPreviewUrl';
import {
  CivitaiCardContextMenu,
  openCivitaiCardContextMenu,
  type CivitaiCardContextMenuState,
  type CivitaiCardMenuContext,
} from './CivitaiCardContextMenu';
import { CivitaiDownloadProgressHud } from './CivitaiDownloadProgressHud';
import { CivitaiImageDownloadProgressHud } from './CivitaiImageDownloadProgressHud';
import { CivitaiPreviewDownloader } from './CivitaiPreviewDownloader';
import {
  CivitaiBackgroundWarmStatus,
  CivitaiPreviewWarmButton,
} from './CivitaiWarmStatusHud';
import type {
  CivitaiArchitectureIdDto,
  CivitaiBrowseFiltersDto,
  CivitaiCatalogSyncProgressDto,
  CivitaiDownloadCategoryDto,
  CivitaiDownloadQueueItemDto,
  CivitaiDownloadQueueSnapshotDto,
  CivitaiLocalSortDto,
  CivitaiModelCardDto,
  CivitaiModelCategoryIdDto,
  CivitaiModelDownloadOptionsDto,
  CivitaiModelDownloadPickDto,
  CivitaiBrowseKindDto,
  CivitaiModelTypeDto,
  CivitaiOriginDto,
  CivitaiShelfSummariesDto,
  CivitaiShelfSummaryDto,
  CivitaiSdxlFamilyIdDto,
  CivitaiSdxlFamilyToggleIdDto,
  LoraDownloadCategoryListDto,
  WatchedCivitaiModelDto,
} from '../shared/contracts';

type DownloadConfirmOpts = {
  /** Checkpoint / legacy folder name. */
  category?: string;
  loraCategoryId?: string;
  /** Extra LoRA categories — wildcard append only (same file). */
  extraLoraCategoryIds?: string[];
  weights?: string;
  /** Optional `#` comment between URL and `<lora:…>` (LoRA only). */
  extraComment?: string;
  /** Optional prompt after triggers on the `<lora:…>` line (LoRA only). */
  extraPrompt?: string;
  /** On-disk file name (editable; may omit extension). */
  fileName?: string;
  /** Civitai model version to download (defaults to card’s latest). */
  versionId?: number;
  /** Specific weight file on that version. */
  fileId?: number;
};
type Tab = 'browse' | 'queued' | 'downloaded' | 'maybe' | 'archive' | 'notify';

function cardToShelfSummary(card: CivitaiModelCardDto): CivitaiShelfSummaryDto {
  return {
    id: card.id,
    type: card.type,
    tags: card.tags ?? [],
    baseModel: card.baseModel,
    versionBaseModels: [
      ...new Set(
        (card.versionInstalls ?? [])
          .map((row) => row.baseModel)
          .filter((value): value is string => Boolean(value?.trim())),
      ),
    ],
    latestVersionInstalled: card.latestVersionInstalled,
  };
}

function preferredShelfRows<T extends { id: number }>(
  summaries: T[] | null | undefined,
  cards: T[],
): T[] {
  if (summaries && summaries.length >= cards.length) return summaries;
  return cards;
}

function summaryToStubCard(
  row: CivitaiShelfSummaryDto,
  flags: { archived?: boolean; maybe?: boolean; installed?: boolean },
): CivitaiModelCardDto {
  const archived = flags.archived === true;
  const maybe = flags.maybe === true;
  const installed = flags.installed === true;
  return {
    id: row.id,
    name: `Model ${row.id}`,
    type: row.type,
    nsfw: false,
    tags: row.tags ?? [],
    baseModel: row.baseModel,
    trainedWords: [],
    pageUrl: '',
    installed,
    latestVersionInstalled: row.latestVersionInstalled === true,
    hasUninstalledVersion: false,
    hasDownloadableVersion: false,
    versionInstalls: (row.versionBaseModels ?? []).map((baseModel, index) => ({
      versionId: index + 1,
      versionName: baseModel,
      baseModel,
      installed,
      earlyAccess: false,
      localMatches: [],
    })),
    markedInstalled: false,
    archived,
    maybe,
    hidden: archived,
    potentialLocalMatches: [],
    statusTags: [],
    earlyAccess: false,
    watching: false,
  };
}

type DownloadTarget = Pick<
  CivitaiModelCardDto,
  | 'id'
  | 'name'
  | 'versionId'
  | 'versionName'
  | 'type'
  | 'fileName'
  | 'fileSizeKB'
  | 'trainedWords'
  | 'pageUrl'
  | 'baseModel'
  | 'earlyAccess'
  | 'earlyAccessEndsAt'
  | 'versionInstalls'
> & { typeHint: CivitaiModelTypeDto };

/** Prefer missing downloadable rows, then any non-EA, then first. */
function preferDownloadPick(
  picks: CivitaiModelDownloadPickDto[],
  preferredVersionId?: number | null,
  preferredFileName?: string | null,
): CivitaiModelDownloadPickDto | null {
  if (picks.length === 0) return null;
  const fileName = preferredFileName?.trim().toLowerCase() || '';
  if (preferredVersionId != null) {
    const match =
      picks.find(
        (p) =>
          p.versionId === preferredVersionId &&
          (!fileName || p.fileName.toLowerCase() === fileName) &&
          !p.earlyAccess,
      ) ||
      picks.find(
        (p) => p.versionId === preferredVersionId && !p.earlyAccess,
      ) ||
      picks.find((p) => p.versionId === preferredVersionId);
    if (match) return match;
  }
  return (
    picks.find((p) => !p.earlyAccess && !p.installed) ??
    picks.find((p) => !p.earlyAccess) ??
    picks[0] ??
    null
  );
}

function markDownloadedPayloads(picks: CivitaiModelDownloadPickDto[]): Array<{
  versionId: number;
  fileId: number;
  fileName: string;
  label: string;
}> {
  return versionMarksForCurrentPicks(picks).map((mark) => {
    const pick = picks.find(
      (row) =>
        !row.earlyAccess &&
        row.versionId === mark.versionId &&
        row.fileId === mark.fileId &&
        row.fileName.trim().toLowerCase() ===
          (mark.fileName ?? '').toLowerCase(),
    );
    return {
      versionId: mark.versionId,
      fileId: mark.fileId,
      fileName: mark.fileName ?? pick?.fileName ?? '',
      label: pick?.label ?? mark.fileName ?? `Version ${mark.versionId}`,
    };
  });
}

/**
 * Instant download picks from the Browse card — no API. Enough to start a
 * download when the catalog already knows a library-scoped version.
 */
function buildInstantDownloadOptions(
  target: DownloadTarget,
  browseArchitectures: CivitaiArchitectureIdDto[],
  sdxlFamily: CivitaiSdxlFamilyIdDto,
  enabledSdxlFamilies: CivitaiSdxlFamilyToggleIdDto[],
): CivitaiModelDownloadOptionsDto {
  const scoped = filterVersionInstallsForContext(
    target.versionInstalls ?? [],
    browseArchitectures,
    sdxlFamily,
    enabledSdxlFamilies,
  );
  const picks: CivitaiModelDownloadPickDto[] = [];
  const seen = new Set<string>();
  for (const row of scoped) {
    const fileId = row.fileId ?? 0;
    const fileName =
      row.fileName?.trim() || target.fileName?.trim() || 'model.safetensors';
    const dedupeKey = `${row.versionId}:${fileName.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const ea = isEarlyAccessActive(row.earlyAccess, row.earlyAccessEndsAt);
    const label = formatVersionVariantLabel({
      versionName: row.versionName,
      variantLabel: row.variantLabel,
      fileName: row.variantLabel ? undefined : fileName,
    });
    picks.push({
      key: `${row.versionId}:${fileId || fileName.toLowerCase()}`,
      versionId: row.versionId,
      versionName: row.versionName,
      fileId,
      fileName,
      autoV2: row.autoV2,
      label:
        (row.installed ? `${label} · on disk` : label) +
        (ea ? ' · early access' : ''),
      earlyAccess: ea,
      installed: row.installed,
      sizeKB: row.sizeKB,
    });
  }
  if (picks.length === 0 && target.versionId != null) {
    const fileName = target.fileName?.trim() || 'model.safetensors';
    const ea = isEarlyAccessActive(
      target.earlyAccess,
      target.earlyAccessEndsAt,
    );
    const versionName =
      target.versionName?.trim() || `Version ${target.versionId}`;
    const label = formatVersionVariantLabel({
      versionName,
      fileName,
    });
    picks.push({
      key: `${target.versionId}:0`,
      versionId: target.versionId,
      versionName,
      fileId: 0,
      fileName,
      label: label + (ea ? ' · early access' : ''),
      earlyAccess: ea,
      installed: false,
      sizeKB: target.fileSizeKB,
    });
  }
  return {
    modelId: target.id,
    modelName: target.name,
    versions: [],
    picks,
  };
}

/**
 * Same defaults as opening the Download dialog and clicking Download
 * immediately (preferred non-EA pick, last category, default LoRA weights).
 */
async function resolveDefaultDownloadConfirmOpts(
  target: DownloadTarget,
  browseArchitectures: CivitaiArchitectureIdDto[],
  sdxlFamily: CivitaiSdxlFamilyIdDto,
  enabledSdxlFamilies: CivitaiSdxlFamilyToggleIdDto[],
): Promise<DownloadConfirmOpts> {
  let options = buildInstantDownloadOptions(
    target,
    browseArchitectures,
    sdxlFamily,
    enabledSdxlFamilies,
  );
  if (options.picks.length === 0) {
    options = await window.wcm.civitai.listModelDownloadOptions(target.id, {
      browseArchitectures,
    });
  }
  const preferred = preferDownloadPick(
    options.picks,
    target.versionId,
    target.fileName,
  );
  if (!preferred) {
    throw new Error('No downloadable version found for this model.');
  }
  if (preferred.earlyAccess) {
    throw new Error('That version is still early access.');
  }
  const fallbackName = target.fileName?.trim() || 'model.safetensors';
  const resolvedName = resolveDownloadSaveFileName(
    preferred.fileName,
    fallbackName,
  );
  if (!resolvedName.ok) {
    throw new Error(resolvedName.error);
  }
  const fileName = resolvedName.fileName;

  if (target.typeHint === 'LORA') {
    const result = await window.wcm.civitai.listLoraDownloadCategories();
    const loraCategoryId =
      result.lastCategoryId &&
      result.categories.some((c) => c.id === result.lastCategoryId)
        ? result.lastCategoryId
        : (result.categories[0]?.id ?? '');
    if (!loraCategoryId) {
      throw new Error('Create a LoRA download category first.');
    }
    const dest = await window.wcm.civitai.checkDownloadDestination({
      type: 'LORA',
      fileName,
      fallbackFileName: fallbackName,
      loraCategoryId,
    });
    if (!dest.ok) throw new Error(dest.error);
    const weights = normalizeLoraWeights(DEFAULT_LORA_DOWNLOAD_WEIGHTS);
    if (!weights) {
      throw new Error(
        `Invalid LoRA weights "${DEFAULT_LORA_DOWNLOAD_WEIGHTS}".`,
      );
    }
    return {
      loraCategoryId,
      weights,
      fileName,
      versionId: preferred.versionId,
      fileId: preferred.fileId || undefined,
    };
  }

  const folders = await window.wcm.civitai.listDownloadCategories(
    target.typeHint,
  );
  const dest = await window.wcm.civitai.checkDownloadDestination({
    type: target.typeHint,
    fileName,
    fallbackFileName: fallbackName,
    category: folders.lastCategory,
  });
  if (!dest.ok) throw new Error(dest.error);
  return {
    category: folders.lastCategory,
    fileName,
    versionId: preferred.versionId,
    fileId: preferred.fileId || undefined,
  };
}

function matchesModelType(
  modelType: string | undefined,
  expected: CivitaiModelTypeDto,
): boolean {
  const isCheckpoint = (modelType ?? '').toLowerCase() === 'checkpoint';
  return expected === 'Checkpoint' ? isCheckpoint : !isCheckpoint;
}

function matchesCardCategory(
  tags: string[] | undefined,
  category: CivitaiModelCategoryIdDto | null,
  enabledCategories?: readonly CivitaiModelCategoryIdDto[],
): boolean {
  if (category) {
    if (enabledCategories && !enabledCategories.includes(category)) {
      return false;
    }
    const tag = modelCategoryTag(category)?.toLowerCase();
    if (!tag) return true;
    return (tags ?? []).some((value) => value.toLowerCase() === tag);
  }
  if (enabledCategories) {
    const id = categoryIdFromTags(tags);
    if (id && !enabledCategories.includes(id)) return false;
  }
  return true;
}

function tokenizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Same fields as the local catalog search haystack. */
function cardSearchHay(model: {
  name?: string;
  modelName?: string;
  creator?: string;
  tags?: string[];
  fileName?: string;
  baseModel?: string;
}): string {
  const parts = [
    model.name ?? model.modelName ?? '',
    model.creator ?? '',
    model.fileName ?? '',
    model.baseModel ?? '',
    ...(Array.isArray(model.tags) ? model.tags : []),
  ];
  return parts.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchesCardQuery(
  model: {
    name?: string;
    modelName?: string;
    creator?: string;
    tags?: string[];
    fileName?: string;
    baseModel?: string;
  },
  query: string,
): boolean {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return true;
  const hay = cardSearchHay(model);
  return tokens.every((token) => hay.includes(token));
}

function sortCardsByLocalSort<T extends CivitaiModelCardDto>(
  items: T[],
  sort: CivitaiLocalSortDto,
): T[] {
  if (sort === 'newest') {
    return [...items].sort((a, b) =>
      (b.firstSeenAt ?? '').localeCompare(a.firstSeenAt ?? ''),
    );
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

/** Installed cards with a newer version float above the chosen local sort. */
function sortCardsWithUpdatesFirst(
  items: CivitaiModelCardDto[],
  architectures: CivitaiArchitectureIdDto[],
  sdxlFamily: CivitaiSdxlFamilyIdDto,
  enabledSdxlFamilies: CivitaiSdxlFamilyToggleIdDto[],
): CivitaiModelCardDto[] {
  return [...items].sort((a, b) => {
    const rank = (card: CivitaiModelCardDto) =>
      contextInstallFlags(
        card,
        architectures,
        sdxlFamily,
        enabledSdxlFamilies,
      ).updateAvailable
        ? 1
        : 0;
    return rank(b) - rank(a);
  });
}

/** Soonest unlock first; missing end times go last. */
function watchlistEndsAtMs(entry: WatchedCivitaiModelDto): number {
  const raw = entry.earlyAccessEndsAt ?? entry.card?.earlyAccessEndsAt;
  if (!raw?.trim()) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function sortWatchlistByTimeLeft(
  items: WatchedCivitaiModelDto[],
): WatchedCivitaiModelDto[] {
  return [...items].sort((a, b) => {
    const byEnds = watchlistEndsAtMs(a) - watchlistEndsAtMs(b);
    if (byEnds !== 0) return byEnds;
    return a.modelName.localeCompare(b.modelName, undefined, {
      sensitivity: 'base',
    });
  });
}

function matchesCardArchitecture(
  baseModel: string | undefined,
  architectures: CivitaiArchitectureIdDto[],
  sdxlFamily: CivitaiSdxlFamilyIdDto = 'all',
  enabledSdxlFamilies?: CivitaiSdxlFamilyToggleIdDto[],
): boolean {
  if (architectures.length === 0) return true;
  if (
    !matchesArchitectureFilter(
      baseModel,
      architectures as CivitaiArchitectureId[],
    )
  ) {
    return false;
  }
  if (!architectures.includes('sdxl')) return true;
  if (sdxlFamily !== 'all') {
    if (
      enabledSdxlFamilies &&
      !enabledSdxlFamilies.includes(sdxlFamily as CivitaiSdxlFamilyToggleIdDto)
    ) {
      return false;
    }
    return matchesSdxlFamily(baseModel, sdxlFamily as CivitaiSdxlFamilyId);
  }
  if (enabledSdxlFamilies) {
    return matchesEnabledSdxlFamilies(
      baseModel,
      enabledSdxlFamilies as CivitaiSdxlFamilyToggleId[],
    );
  }
  return true;
}

/**
 * Same rules as main-process browse filters: a card matches when the primary
 * base model OR any version row matches the architecture/family chips.
 */
function matchesCardOrVersionArchitecture(
  item: {
    baseModel?: string;
    versionInstalls?: ReadonlyArray<{ baseModel?: string }>;
    versionBaseModels?: ReadonlyArray<string>;
  },
  architectures: CivitaiArchitectureIdDto[],
  sdxlFamily: CivitaiSdxlFamilyIdDto = 'all',
  enabledSdxlFamilies?: CivitaiSdxlFamilyToggleIdDto[],
): boolean {
  if (architectures.length === 0) return true;
  if (
    matchesCardArchitecture(
      item.baseModel,
      architectures,
      sdxlFamily,
      enabledSdxlFamilies,
    )
  ) {
    return true;
  }
  if (
    (item.versionInstalls ?? []).some((row) =>
      matchesCardArchitecture(
        resolveVersionBaseModel(row),
        architectures,
        sdxlFamily,
        enabledSdxlFamilies,
      ),
    )
  ) {
    return true;
  }
  return (item.versionBaseModels ?? []).some((baseModel) =>
    matchesCardArchitecture(
      baseModel,
      architectures,
      sdxlFamily,
      enabledSdxlFamilies,
    ),
  );
}

/** Shelf rows loaded before their catalog page has no base model yet. */
function cardHasBaseModelEvidence(item: {
  baseModel?: string;
  versionInstalls?: ReadonlyArray<{ baseModel?: string }>;
  versionBaseModels?: ReadonlyArray<string>;
}): boolean {
  if (item.baseModel?.trim()) return true;
  if ((item.versionBaseModels ?? []).some((value) => value.trim())) return true;
  return (item.versionInstalls ?? []).some((row) =>
    Boolean(resolveVersionBaseModel(row)?.trim()),
  );
}

function filterVersionInstallsForContext(
  rows: CivitaiModelCardDto['versionInstalls'],
  architectures: CivitaiArchitectureIdDto[],
  sdxlFamily: CivitaiSdxlFamilyIdDto,
  enabledSdxlFamilies: CivitaiSdxlFamilyToggleIdDto[],
): CivitaiModelCardDto['versionInstalls'] {
  return rows.filter((row) =>
    matchesCardArchitecture(
      resolveVersionBaseModel(row),
      architectures,
      sdxlFamily,
      enabledSdxlFamilies,
    ),
  );
}

/**
 * Update / Notify for the base-model chip. A downloaded Krea 2 card stays
 * plain when the only leftover is another architecture (Illustrious EA).
 */
function contextInstallFlags(
  item: {
    installed: boolean;
    latestVersionInstalled: boolean;
    earlyAccess: boolean;
    earlyAccessEndsAt?: string;
    hasDownloadableVersion: boolean;
    versionInstalls?: CivitaiModelCardDto['versionInstalls'];
  },
  architectures: CivitaiArchitectureIdDto[],
  sdxlFamily: CivitaiSdxlFamilyIdDto,
  enabledSdxlFamilies: CivitaiSdxlFamilyToggleIdDto[],
): ReturnType<typeof installFlagsForVersions> {
  const all = item.versionInstalls ?? [];
  if (all.length === 0) {
    const earlyAccess = isEarlyAccessActive(
      item.earlyAccess,
      item.earlyAccessEndsAt,
    );
    return {
      latestVersionInstalled: item.latestVersionInstalled,
      updateAvailable: item.installed && item.latestVersionInstalled === false,
      notifyEarlyAccess: earlyAccess && !item.installed,
      hasDownloadableVersion: item.hasDownloadableVersion,
    };
  }
  return installFlagsForVersions(
    filterVersionInstallsForContext(
      all,
      architectures,
      sdxlFamily,
      enabledSdxlFamilies,
    ),
  );
}

/** Chip filters shared by tab badges (search query does not affect badges). */
function matchesTabChipFilters(
  item: {
    type?: string;
    tags?: string[];
    baseModel?: string;
    versionInstalls?: ReadonlyArray<{ baseModel?: string }>;
    versionBaseModels?: ReadonlyArray<string>;
  },
  type: CivitaiModelTypeDto,
  category: CivitaiModelCategoryIdDto | null,
  architectures: CivitaiArchitectureIdDto[],
  sdxlFamily: CivitaiSdxlFamilyIdDto,
  enabledCivitaiCategories: readonly CivitaiModelCategoryIdDto[],
  enabledSdxlFamilies: CivitaiSdxlFamilyToggleIdDto[],
): boolean {
  return (
    matchesModelType(item.type, type) &&
    matchesCardCategory(item.tags, category, enabledCivitaiCategories) &&
    (!cardHasBaseModelEvidence(item) ||
      matchesCardOrVersionArchitecture(
        item,
        architectures,
        sdxlFamily,
        enabledSdxlFamilies,
      ))
  );
}

/** Compact top-left icon badges — only when filters leave them ambiguous. */
const CATEGORY_META_ICONS: Record<
  CivitaiModelCategoryId,
  { icon: LucideIcon; label: string }
> = {
  character: { icon: User, label: 'Character' },
  style: { icon: Palette, label: 'Style' },
  concept: { icon: Lightbulb, label: 'Concept' },
  clothing: { icon: Shirt, label: 'Clothing' },
  'base model': { icon: Box, label: 'Base Model' },
  background: { icon: Image, label: 'Background' },
  poses: { icon: PersonStanding, label: 'Poses' },
  tool: { icon: Wrench, label: 'Tool' },
  assets: { icon: Package, label: 'Assets' },
  vehicle: { icon: Car, label: 'Vehicle' },
  buildings: { icon: Building2, label: 'Buildings' },
  objects: { icon: Cuboid, label: 'Objects' },
  animal: { icon: PawPrint, label: 'Animal' },
  action: { icon: Zap, label: 'Action' },
};

function PonyMetaIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 16c1.5-3 3-5 6-5 1 0 2 .3 3 1" />
      <path d="M13 12c2-3 4.5-4 7-3" />
      <path d="M18 9.5c.5-1.5 1.2-2.5 2.5-3.5" />
      <path d="M8 19v-3" />
      <path d="M12 19v-2.5" />
      <path d="M5.5 14.5c-1 .8-1.5 2-1.5 3.5" />
    </svg>
  );
}

function SdxlFamilyIcon({
  id,
  size = 12,
}: {
  id: CivitaiSdxlFamilyId;
  size?: number;
}) {
  if (id === 'all') return <LayoutGrid size={size} strokeWidth={2.25} />;
  if (id === 'pony') return <PonyMetaIcon size={size} />;
  if (id === 'illustrious') return <Sparkles size={size} strokeWidth={2.25} />;
  if (id === 'noobai') return <Sprout size={size} strokeWidth={2.25} />;
  return <Layers size={size} strokeWidth={2.25} />;
}

function familyMetaLabel(id: CivitaiSdxlFamilyId): string {
  if (id === 'all') return 'All families';
  if (id === 'pony') return 'Pony';
  if (id === 'illustrious') return 'Illustrious';
  if (id === 'noobai') return 'NoobAI';
  return 'SDXL';
}

function CardMetaOverlay({
  categoryId,
  familyId,
}: {
  categoryId?: CivitaiModelCategoryId | null;
  familyId?: Exclude<CivitaiSdxlFamilyId, 'all'> | null;
}) {
  const chips: Array<{ key: string; label: string; node: ReactNode }> = [];

  if (categoryId) {
    const meta = CATEGORY_META_ICONS[categoryId];
    if (meta) {
      const Icon = meta.icon;
      chips.push({
        key: `cat-${categoryId}`,
        label: meta.label,
        node: <Icon size={11} strokeWidth={2.25} />,
      });
    }
  }

  if (familyId) {
    chips.push({
      key: `fam-${familyId}`,
      label: familyMetaLabel(familyId),
      node: <SdxlFamilyIcon id={familyId} size={11} />,
    });
  }

  if (chips.length === 0) return null;
  return (
    <div className="civitai-card-meta-overlay">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="civitai-card-meta-chip"
          title={chip.label}
          aria-label={chip.label}
        >
          {chip.node}
        </span>
      ))}
    </div>
  );
}

/** Remaining early-access time from an ISO end timestamp. */
function formatEarlyAccessCountdown(
  endsAt: string,
  nowMs: number,
): { label: string; done: boolean } | null {
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end)) return null;
  const ms = end - nowMs;
  if (ms <= 0) return { label: 'Available now', done: true };

  const totalMin = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMin / (24 * 60));
  const hours = Math.floor((totalMin % (24 * 60)) / 60);
  const mins = totalMin % 60;

  let label: string;
  if (days > 0) label = `${days}d ${hours}h ${mins}m`;
  else if (hours > 0) label = `${hours}h ${mins}m`;
  else label = `${mins}m`;

  return { label, done: false };
}

/** Compact calendar date for Newest-progress on cards. */
function formatCardPublishedAt(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function publishedAtTitle(iso: string, nowMs: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'Published on Civitai';
  const abs = new Date(ms).toLocaleString();
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(0, Math.floor((nowMs - ms) / dayMs));
  let age: string;
  if (days < 1) age = 'today';
  else if (days === 1) age = '1 day ago';
  else if (days < 60) age = `${days} days ago`;
  else {
    const months = Math.floor(days / 30);
    age = months === 1 ? '1 month ago' : `${months} months ago`;
  }
  return `Published ${abs} (${age})`;
}

function EarlyAccessCountdown({
  endsAt,
  nowMs,
}: {
  endsAt: string;
  nowMs: number;
}) {
  const result = formatEarlyAccessCountdown(endsAt, nowMs);
  if (!result) return null;

  return (
    <small
      className={`civitai-ea-countdown${result.done ? ' done' : ''}`}
      title={new Date(endsAt).toLocaleString()}
    >
      {result.done ? result.label : `Opens in ${result.label}`}
    </small>
  );
}

/** Minute-resolution clock for early-access expiry (no per-second UI churn). */
function useNowMs(active: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [active]);
  return nowMs;
}

function NotifyWatchCard({
  entry,
  activeDownloadId,
  queuedIds,
  selectedId,
  canDownloadFor,
  requestDownload,
  removeWatch,
  onSelect,
  showCategoryMeta,
  showFamilyMeta,
}: {
  entry: WatchedCivitaiModelDto;
  activeDownloadId: number | null;
  queuedIds: Set<number>;
  selectedId: number | null;
  canDownloadFor: (modelType: string) => boolean;
  requestDownload: (
    item: Pick<
      CivitaiModelCardDto,
      | 'id'
      | 'name'
      | 'versionId'
      | 'versionName'
      | 'type'
      | 'fileName'
      | 'fileSizeKB'
      | 'trainedWords'
      | 'pageUrl'
      | 'baseModel'
      | 'earlyAccess'
      | 'earlyAccessEndsAt'
      | 'versionInstalls'
    > & { typeHint?: CivitaiModelTypeDto },
    opts?: { skipConfirm?: boolean },
  ) => void;
  removeWatch: (modelId: number) => void;
  onSelect: (pageUrl: string, modelId: number, name: string) => void;
  showCategoryMeta: boolean;
  showFamilyMeta: boolean;
}) {
  const card = entry.card;
  const endsAt = entry.earlyAccessEndsAt ?? card?.earlyAccessEndsAt;
  const nowMs = useNowMs(!entry.available);
  const isAvailable =
    entry.available ||
    (Boolean(endsAt) && !isEarlyAccessActive(true, endsAt, nowMs));
  const pageUrl =
    card?.pageUrl ?? `https://civitai.com/models/${entry.modelId}`;

  return (
    <article
      className={`civitai-card${isAvailable ? ' available' : ' watching'}${selectedId === entry.modelId ? ' selected' : ''}`}
    >
      <div
        className="civitai-thumb"
        role="button"
        tabIndex={0}
        title="Preview on Civitai"
        onClick={() => onSelect(pageUrl, entry.modelId, entry.modelName)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(pageUrl, entry.modelId, entry.modelName);
          }
        }}
      >
        <CivitaiPreviewThumb
          modelId={entry.modelId}
          url={card?.previewUrl}
          customUrl={card?.customPreviewUrl}
        />
        <CardMetaOverlay
          categoryId={
            showCategoryMeta ? categoryIdFromTags(card?.tags) : null
          }
          familyId={
            showFamilyMeta ? sdxlFamilyBadgeId(card?.baseModel) : null
          }
        />
      </div>
      <div className="civitai-card-body">
        <strong title={entry.modelName}>{entry.modelName}</strong>
        <small>
          {entry.type}
          {isAvailable ? ' · Available now' : ' · Early access'}
        </small>
        {!isAvailable ? (
          endsAt ? (
            <EarlyAccessCountdown endsAt={endsAt} nowMs={nowMs} />
          ) : (
            <small className="hint">
              Early access — end time unknown in catalog yet
            </small>
          )
        ) : null}
        <div className="civitai-card-actions">
          {isAvailable ? (
            <button
              type="button"
              className="civitai-icon-btn action-download"
              title={
                activeDownloadId === entry.modelId
                  ? 'Downloading…'
                  : queuedIds.has(entry.modelId)
                    ? 'Queued'
                    : 'Download · Shift+click skips options'
              }
              aria-label={
                activeDownloadId === entry.modelId
                  ? 'Downloading'
                  : queuedIds.has(entry.modelId)
                    ? 'Queued'
                    : 'Download'
              }
              disabled={
                activeDownloadId === entry.modelId ||
                queuedIds.has(entry.modelId) ||
                !canDownloadFor(entry.type)
              }
              onClick={(event) =>
                requestDownload(
                  {
                    id: entry.modelId,
                    name: entry.modelName,
                    versionId: entry.versionId ?? card?.versionId,
                    versionName: card?.versionName,
                    type: entry.type,
                    fileName: card?.fileName,
                    fileSizeKB: card?.fileSizeKB,
                    trainedWords: card?.trainedWords ?? [],
                    pageUrl:
                      card?.pageUrl ??
                      `https://civitai.com/models/${entry.modelId}`,
                    baseModel: card?.baseModel,
                    earlyAccess: Boolean(card?.earlyAccess),
                    earlyAccessEndsAt:
                      entry.earlyAccessEndsAt ?? card?.earlyAccessEndsAt,
                    versionInstalls: card?.versionInstalls ?? [],
                    typeHint: entry.type,
                  },
                  { skipConfirm: event.shiftKey },
                )
              }
            >
              <Download
                size={20}
                className={
                  activeDownloadId === entry.modelId ? 'spin' : undefined
                }
              />
            </button>
          ) : (
            <button
              type="button"
              className="civitai-icon-btn action-notify"
              title="Waiting for early access to end"
              aria-label="Waiting"
              disabled
            >
              <BellRing size={20} />
            </button>
          )}
          <button
            type="button"
            className="civitai-icon-btn action-unmark"
            title="Remove from notify list"
            aria-label="Remove"
            onClick={(event) => {
              event.stopPropagation();
              void removeWatch(entry.modelId);
            }}
          >
            <X size={20} />
          </button>
          <button
            type="button"
            className="civitai-icon-btn action-open"
            title="Open on Civitai"
            aria-label="Open on Civitai"
            onClick={(event) => {
              event.stopPropagation();
              void window.wcm.civitai.openModelPage(
                entry.modelId,
                entry.modelName,
              );
            }}
          >
            <ExternalLink size={20} />
          </button>
        </div>
      </div>
    </article>
  );
}

function withCardFlags(
  card: CivitaiModelCardDto,
  patch: Partial<
    Pick<
      CivitaiModelCardDto,
      | 'archived'
      | 'maybe'
      | 'installed'
      | 'latestVersionInstalled'
      | 'hasUninstalledVersion'
      | 'hasDownloadableVersion'
      | 'markedInstalled'
      | 'watching'
    >
  >,
): CivitaiModelCardDto {
  const next = {
    ...card,
    ...patch,
  };
  const archived = next.archived;
  return {
    ...next,
    hidden: archived,
    statusTags: card.statusTags,
  };
}

function cardClassName(
  item: CivitaiModelCardDto,
  activeDownloadId: number | null,
  queuedIds: Set<number>,
  selectedId: number | null,
  flags?: ReturnType<typeof installFlagsForVersions>,
): string {
  const classes = ['civitai-card'];
  if (item.installed) classes.push('installed');
  const updateAvailable =
    flags?.updateAvailable ??
    (item.installed && !item.latestVersionInstalled);
  if (updateAvailable) classes.push('update-available');
  if (item.archived) classes.push('archived');
  if (item.maybe) classes.push('maybe');
  const earlyAccess =
    flags?.notifyEarlyAccess ??
    isEarlyAccessActive(item.earlyAccess, item.earlyAccessEndsAt);
  if (earlyAccess) classes.push('early-access');
  if (item.potentialLocalMatches.length > 0) classes.push('potential-match');
  if (activeDownloadId === item.id) classes.push('downloading');
  else if (queuedIds.has(item.id)) classes.push('queued');
  if (selectedId === item.id) classes.push('selected');
  return classes.join(' ');
}

/** Minimal card so every queue job appears even before catalog/API enrichment. */
function placeholderQueuedCard(
  item: Pick<
    CivitaiDownloadQueueItemDto,
    'modelId' | 'modelName' | 'type' | 'versionId'
  >,
  origin: string,
): CivitaiModelCardDto {
  return {
    id: item.modelId,
    name: item.modelName,
    type: item.type,
    nsfw: false,
    tags: [],
    versionId: item.versionId,
    trainedWords: [],
    pageUrl: civitaiModelPageUrl(origin, item.modelId, item.modelName),
    installed: false,
    latestVersionInstalled: false,
    hasUninstalledVersion: true,
    hasDownloadableVersion: true,
    versionInstalls: [],
    markedInstalled: false,
    archived: false,
    maybe: false,
    potentialLocalMatches: [],
    statusTags: [],
    earlyAccess: false,
    watching: false,
  };
}

function queuedCardRichness(card: CivitaiModelCardDto): number {
  return (
    (card.previewUrl || card.customPreviewUrl ? 4 : 0) +
    (card.versionInstalls.length > 0 ? 2 : 0) +
    (card.baseModel ? 1 : 0) +
    (card.tags.length > 0 ? 1 : 0) +
    (card.creator ? 1 : 0)
  );
}

function preferRicherQueuedCard(
  a: CivitaiModelCardDto,
  b: CivitaiModelCardDto,
): CivitaiModelCardDto {
  return queuedCardRichness(b) > queuedCardRichness(a) ? b : a;
}

export function CivitaiBrowserModal({
  onClose,
  onNotice,
  onError,
  presentation = 'modal',
  onDetach,
  onAttach,
  onBeforeDownload,
  focusModel = null,
  onFocusModelConsumed,
}: {
  onClose: () => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  presentation?: 'modal' | 'window';
  onDetach?: () => void;
  onAttach?: () => void;
  /**
   * Flush the main editor before download so a category wildcard append
   * sees the latest buffer (and the editor can reload the new reference).
   */
  onBeforeDownload?: () => void | Promise<void>;
  /** Open the preview pane on this model (e.g. from a comment URL above a LoRA). */
  focusModel?: {
    modelId: number;
    pageUrl: string;
    name?: string;
  } | null;
  onFocusModelConsumed?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('browse');
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [browseKind, setBrowseKind] = useState<CivitaiBrowseKindDto>('LORA');
  const lastModelTypeRef = useRef<CivitaiModelTypeDto>('LORA');
  const type: CivitaiModelTypeDto =
    browseKind === 'Images' || browseKind === 'Videos'
      ? lastModelTypeRef.current
      : browseKind;
  const setType = (next: CivitaiModelTypeDto) => {
    lastModelTypeRef.current = next;
    setBrowseKind(next);
  };
  const imagesMode = browseKind === 'Images';
  const videosMode = browseKind === 'Videos';
  const mediaMode = imagesMode || videosMode;
  const [hasImagesFolder, setHasImagesFolder] = useState(false);
  const [hasVideosFolder, setHasVideosFolder] = useState(false);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CivitaiLocalSortDto>('newest');
  const [nsfw, setNsfw] = useState(false);
  const hideInstalled = true;
  const includeArchived = false;
  const includeMaybe = false;
  const [onlyNew, setOnlyNew] = useState(false);
  const [onlyPotentialDuplicate, setOnlyPotentialDuplicate] = useState(false);
  const [architectures, setArchitectures] = useState<CivitaiArchitectureIdDto[]>(
    ['sd15'],
  );
  const [sdxlFamily, setSdxlFamily] = useState<CivitaiSdxlFamilyIdDto>('all');
  const [enabledArchitectures, setEnabledArchitectures] = useState<
    CivitaiArchitectureIdDto[]
  >(CIVITAI_ARCHITECTURE_PRESETS.map((p) => p.id as CivitaiArchitectureIdDto));
  const [enabledSdxlFamilies, setEnabledSdxlFamilies] = useState<
    CivitaiSdxlFamilyToggleIdDto[]
  >(['sdxl', 'pony', 'illustrious', 'noobai']);
  const [enabledCivitaiCategories, setEnabledCivitaiCategories] = useState<
    CivitaiModelCategoryIdDto[]
  >(CIVITAI_MODEL_CATEGORY_PRESETS.map((p) => p.id));
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null);
  const [categoryVisibilityOpen, setCategoryVisibilityOpen] = useState(false);
  const categoriesWhenVisibilityOpenedRef = useRef<
    CivitaiModelCategoryIdDto[] | null
  >(null);
  const [category, setCategory] = useState<CivitaiModelCategoryIdDto | null>(
    null,
  );
  const [filtersReady, setFiltersReady] = useState(false);
  const [browseGridReady, setBrowseGridReady] = useState(false);
  const [items, setItems] = useState<CivitaiModelCardDto[]>([]);

  // Debounce keystroke search so we filter the local catalog without
  // thrashing IPC / resyncing on every character.
  useEffect(() => {
    const trimmed = queryInput.trim();
    if (trimmed === query) return;
    const timer = window.setTimeout(() => setQuery(trimmed), 200);
    return () => window.clearTimeout(timer);
  }, [query, queryInput]);
  const [archiveItems, setArchiveItems] = useState<CivitaiModelCardDto[]>([]);
  const [maybeItems, setMaybeItems] = useState<CivitaiModelCardDto[]>([]);
  const [downloadedItems, setDownloadedItems] = useState<CivitaiModelCardDto[]>(
    [],
  );
  /** Cards for models currently in the download queue (active + pending). */
  const [queuedCards, setQueuedCards] = useState<CivitaiModelCardDto[]>([]);
  const [watchlist, setWatchlist] = useState<WatchedCivitaiModelDto[]>([]);
  /** Left Notify after unlock — pinned on Browse until dismissed. */
  const [recentlyUnlocked, setRecentlyUnlocked] = useState<
    WatchedCivitaiModelDto[]
  >([]);
  /** Tab badge counts stay hidden until each list has been loaded once. */
  const [tabListReady, setTabListReady] = useState({
    downloaded: false,
    maybe: false,
    archive: false,
    notify: false,
  });
  /** Local id/catalog summaries — badge + Archive membership without card hydrate. */
  const [shelfSummaries, setShelfSummaries] =
    useState<CivitaiShelfSummariesDto | null>(null);
  const [shelfReady, setShelfReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [catalogSync, setCatalogSync] =
    useState<CivitaiCatalogSyncProgressDto | null>(null);
  /** Minutes between tip-checks, counted from last sync completion (0 = off). */
  const [catalogAutoSyncMinutes, setCatalogAutoSyncMinutes] = useState(10);
  const catalogAutoSyncMinutesRef = useRef(10);
  catalogAutoSyncMinutesRef.current = catalogAutoSyncMinutes;
  const tipCheckTimerRef = useRef<number | null>(null);
  const [previewDownloaderOpen, setPreviewDownloaderOpen] = useState(false);
  const [catalogMeta, setCatalogMeta] = useState<{
    sliceKey: string;
    totalCached: number;
    exhausted: boolean;
    nextOffset: number;
    hasMore: boolean;
    matchTotal: number;
    matchRemaining: number;
  } | null>(null);
  const [activeDownloadId, setActiveDownloadId] = useState<number | null>(null);
  const [activeDownloadLabel, setActiveDownloadLabel] = useState<string | null>(
    null,
  );
  const [queuedDownloads, setQueuedDownloads] = useState<
    Array<{ modelId: number; modelName: string }>
  >([]);
  const [downloadQueueSnapshot, setDownloadQueueSnapshot] =
    useState<CivitaiDownloadQueueSnapshotDto | null>(null);
  const [downloadQueueOpen, setDownloadQueueOpen] = useState(false);
  const queuedIds = useMemo(() => {
    const ids = new Set<number>();
    if (downloadQueueSnapshot?.active?.modelId != null) {
      ids.add(downloadQueueSnapshot.active.modelId);
    }
    for (const item of downloadQueueSnapshot?.queue ?? []) {
      ids.add(item.modelId);
    }
    if (activeDownloadId != null) ids.add(activeDownloadId);
    for (const item of queuedDownloads) ids.add(item.modelId);
    return ids;
  }, [activeDownloadId, downloadQueueSnapshot, queuedDownloads]);
  const queuedIdsRef = useRef(queuedIds);
  queuedIdsRef.current = queuedIds;
  const queueCount = queuedIds.size;
  const [origin, setOrigin] = useState<CivitaiOriginDto>('https://civitai.com');
  const [hasFolders, setHasFolders] = useState({ lora: false, ckpt: false });
  const [downloadTarget, setDownloadTarget] = useState<DownloadTarget | null>(
    null,
  );
  /** When set, confirm updates this queued job instead of enqueueing. */
  const [editingQueueModelId, setEditingQueueModelId] = useState<number | null>(
    null,
  );
  const [downloadInitialOpts, setDownloadInitialOpts] =
    useState<DownloadConfirmOpts | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<{
    modelId: number;
    pageUrl: string;
    name: string;
  } | null>(null);
  /** Browser pane starts collapsed; opens on card click until manually collapsed. */
  const [previewOpen, setPreviewOpen] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.42);
  const [cardMinWidth, setCardMinWidth] = useState(160);
  const [resizingSplit, setResizingSplit] = useState(false);
  const splitRowRef = useRef<HTMLDivElement | null>(null);
  const liveSplitRatioRef = useRef(0.42);
  const persistSplitTimerRef = useRef<number | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const statusNoticeTimerRef = useRef<number | null>(null);
  const activeSliceKeyRef = useRef<string | null>(null);
  /** Optimistic flag overrides so catalog reloads can't resurrect a just-archived card. */
  const localPatchesRef = useRef<
    Map<
      number,
      Partial<
        Pick<
          CivitaiModelCardDto,
          | 'archived'
          | 'maybe'
          | 'installed'
          | 'latestVersionInstalled'
          | 'hasUninstalledVersion'
          | 'hasDownloadableVersion'
          | 'markedInstalled'
          | 'watching'
        >
      >
    >
  >(new Map());
  /**
   * Ids removed from Browse optimistically. Survives quiet catalog reloads
   * (hash warm / sync) that would otherwise flash the card back for a frame
   * after localPatches are cleared.
   */
  const browseHiddenIdsRef = useRef(new Set<number>());
  /**
   * Browse cards held in-place as ghosts after Maybe/Archive so the grid does
   * not shift under the cursor. Cleared on Undo or after a short timeout.
   */
  const [browseGhostIds, setBrowseGhostIds] = useState(() => new Set<number>());
  const [browseBucketUndo, setBrowseBucketUndo] = useState<{
    modelId: number;
    name: string;
    bucket: 'maybe' | 'archive';
    /** Card with the post-move flags (needed so restore can unarchive/unmaybe). */
    flaggedItem: CivitaiModelCardDto;
  } | null>(null);
  const browseBucketUndoRef = useRef(browseBucketUndo);
  browseBucketUndoRef.current = browseBucketUndo;
  const browseBucketUndoTimerRef = useRef<number | null>(null);
  const [cardContextMenu, setCardContextMenu] =
    useState<CivitaiCardContextMenuState | null>(null);
  /** Optimistic Queue→Downloaded settle expires if hash rematch never confirms. */
  const optimisticInstallUntilRef = useRef(new Map<number, number>());
  const onNoticeRef = useRef(onNotice);
  const onErrorRef = useRef(onError);
  onNoticeRef.current = onNotice;
  onErrorRef.current = onError;
  const itemsRefForSettle = useRef(items);
  itemsRefForSettle.current = items;
  const queuedCardsRef = useRef(queuedCards);
  queuedCardsRef.current = queuedCards;
  const downloadedItemsRef = useRef(downloadedItems);
  downloadedItemsRef.current = downloadedItems;
  const loadDownloadedGenRef = useRef(0);
  const originRef = useRef(origin);
  originRef.current = origin;
  const moveToBucketRef = useRef<
    (item: CivitaiModelCardDto, bucket: 'none' | 'maybe' | 'archive') => void
  >(() => {});

  const flashStatusNotice = useCallback((message: string) => {
    if (statusNoticeTimerRef.current !== null) {
      window.clearTimeout(statusNoticeTimerRef.current);
    }
    setStatusError(null);
    setStatusNotice(message);
    onNoticeRef.current(message);
    statusNoticeTimerRef.current = window.setTimeout(() => {
      statusNoticeTimerRef.current = null;
      setStatusNotice(null);
    }, 6000);
  }, []);

  const flashStatusError = useCallback((message: string) => {
    if (statusNoticeTimerRef.current !== null) {
      window.clearTimeout(statusNoticeTimerRef.current);
      statusNoticeTimerRef.current = null;
    }
    setStatusNotice(null);
    setStatusError(message);
    onErrorRef.current(message);
  }, []);

  /**
   * Queue → Downloaded without a Browse flash. Called only after the weight
   * file is on disk (`progress.saved`), before hash rematch catches up.
   */
  const settleSuccessfulDownload = useCallback(
    (opts: {
      modelId: number;
      modelName?: string;
      type?: CivitaiModelTypeDto;
      versionId?: number;
      card?: CivitaiModelCardDto | null;
    }) => {
      const modelId = opts.modelId;
      const fromQueued = queuedCardsRef.current.find((c) => c.id === modelId);
      const fromBrowse = itemsRefForSettle.current.find((c) => c.id === modelId);
      const fromDownloaded = downloadedItemsRef.current.find(
        (c) => c.id === modelId,
      );
      const base =
        opts.card ??
        fromQueued ??
        fromBrowse ??
        fromDownloaded ??
        placeholderQueuedCard(
          {
            modelId,
            modelName: opts.modelName?.trim() || `Model ${modelId}`,
            type: opts.type ?? 'LORA',
            versionId: opts.versionId,
          },
          originRef.current,
        );
      const patched = withCardFlags(base, {
        installed: true,
        latestVersionInstalled: true,
        hasUninstalledVersion: false,
      });

      localPatchesRef.current.set(modelId, {
        installed: true,
        latestVersionInstalled: true,
        hasUninstalledVersion: false,
      });
      // Keep until rematch lists it — drop sooner on cancel / failed rematch.
      optimisticInstallUntilRef.current.set(modelId, Date.now() + 90_000);

      browseHiddenIdsRef.current.add(modelId);
      setItems((prev) => prev.filter((card) => card.id !== modelId));

      setDownloadedItems((prev) => {
        if (prev.some((card) => card.id === modelId)) {
          return prev.map((card) =>
            card.id === modelId ? preferRicherQueuedCard(card, patched) : card,
          );
        }
        return [patched, ...prev];
      });
      // Drop Notify unlock pin — otherwise Browse keeps a stale “not installed” card.
      setRecentlyUnlocked((prev) =>
        prev.filter((entry) => entry.modelId !== modelId),
      );
      void window.wcm.civitai.dismissRecentlyUnlocked(modelId).then(
        (next) => setRecentlyUnlocked(next),
        () => {
          /* non-critical */
        },
      );
    },
    [],
  );

  /** Undo a false Queue→Downloaded settle (cancel / failed transfer). */
  const clearOptimisticInstall = useCallback((modelId: number) => {
    const patch = localPatchesRef.current.get(modelId);
    if (patch?.installed === true && patch.markedInstalled !== true) {
      localPatchesRef.current.delete(modelId);
    }
    optimisticInstallUntilRef.current.delete(modelId);
    browseHiddenIdsRef.current.delete(modelId);
    setDownloadedItems((prev) => prev.filter((card) => card.id !== modelId));
  }, []);

  useEffect(() => {
    return () => {
      if (statusNoticeTimerRef.current !== null) {
        window.clearTimeout(statusNoticeTimerRef.current);
      }
      if (browseBucketUndoTimerRef.current !== null) {
        window.clearTimeout(browseBucketUndoTimerRef.current);
      }
      void window.wcm.civitai.cancelCatalogSync();
    };
  }, []);

  useEffect(() => {
    void Promise.all([
      window.wcm.ui.getCivitaiSettings(),
      window.wcm.library.getActiveLibrary(),
    ]).then(([s, lib]) => {
      setOrigin(lib.civitaiOrigin ?? s.origin);
      setHasFolders({
        lora: Boolean(s.loraFolder),
        ckpt: Boolean(s.checkpointFolder),
      });
      setHasImagesFolder(Boolean(s.imagesFolder));
      setHasVideosFolder(Boolean(s.videosFolder));
      setCatalogAutoSyncMinutes(s.catalogAutoSyncIntervalMinutes);
      const enabledArch = lib.enabledArchitectures;
      const enabledFamilies = lib.enabledSdxlFamilies;
      const enabledCats = lib.enabledCivitaiCategories;
      setActiveLibraryId(lib.id);
      setEnabledArchitectures(enabledArch);
      setEnabledSdxlFamilies(enabledFamilies);
      setEnabledCivitaiCategories(enabledCats);
      const filters = s.browseFilters;
      lastModelTypeRef.current = filters.type;
      setBrowseKind(filters.browseKind ?? filters.type);
      setSort(filters.sort);
      setNsfw(filters.nsfw);
      setOnlyNew(filters.onlyNew);
      setOnlyPotentialDuplicate(filters.onlyPotentialDuplicate);
      const savedArch =
        filters.architectures.length > 0
          ? filters.architectures.slice(0, 1)
          : ['sd15'];
      const arch = (
        enabledArch.includes(savedArch[0] as CivitaiArchitectureIdDto)
          ? savedArch
          : [enabledArch[0] ?? 'sdxl']
      ) as CivitaiArchitectureIdDto[];
      setArchitectures(arch);
      const savedFamily = filters.sdxlFamily ?? 'all';
      if (
        savedFamily !== 'all' &&
        !enabledFamilies.includes(savedFamily as CivitaiSdxlFamilyToggleIdDto)
      ) {
        setSdxlFamily('all');
      } else {
        setSdxlFamily(savedFamily);
      }
      const savedCategory = filters.category;
      if (
        savedCategory &&
        !enabledCats.includes(savedCategory)
      ) {
        setCategory(null);
      } else {
        setCategory(savedCategory);
      }
      setSplitRatio(s.splitRatio);
      liveSplitRatioRef.current = s.splitRatio;
      setCardMinWidth(s.cardMinWidth ?? 160);
      setFiltersReady(true);
    });
  }, []);

  // Surface background Images/Videos “Download all” while on LORA/Checkpoint (panel unmounted).
  useEffect(() => {
    const unsubImage = window.wcm.civitai.onImageDownloadAllProgress((s) => {
      if (!s.statusMessage) return;
      if (s.active) {
        setStatusError(null);
        setStatusNotice(s.statusMessage);
      } else {
        flashStatusNotice(s.statusMessage);
      }
    });
    const unsubVideo = window.wcm.civitai.onVideoDownloadAllProgress((s) => {
      if (!s.statusMessage) return;
      if (s.active) {
        setStatusError(null);
        setStatusNotice(s.statusMessage);
      } else {
        flashStatusNotice(s.statusMessage);
      }
    });
    return () => {
      unsubImage();
      unsubVideo();
    };
  }, [flashStatusNotice]);

  useEffect(() => {
    if (!filtersReady) return;
    const payload: CivitaiBrowseFiltersDto = {
      type,
      browseKind,
      sort,
      nsfw,
      hideInstalled,
      onlyNew,
      onlyPotentialDuplicate,
      includeArchived,
      includeMaybe,
      architectures,
      sdxlFamily,
      category,
    };
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      void window.wcm.ui.setCivitaiBrowseFilters(payload).catch(() => {
        // Persistence is best-effort; browse still works.
      });
    }, 200);
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, [
    architectures,
    browseKind,
    category,
    filtersReady,
    hideInstalled,
    includeArchived,
    includeMaybe,
    nsfw,
    onlyNew,
    onlyPotentialDuplicate,
    sdxlFamily,
    sort,
    type,
  ]);

  useEffect(() => {
    let lastQueueKey = '';
    let lastLeanKey = '';
    return window.wcm.civitai.onDownloadProgress((p) => {
      // Lean byte ticks omit queue/active arrays — never rebuild the snapshot
      // from those or the manage-queue panel empties mid-transfer.
      const hasQueueDetail = Array.isArray(p.queue);
      if (hasQueueDetail) {
        const queueKey = [
          p.activeModelId ?? '',
          p.queuedCount ?? 0,
          p.phase ?? '',
          p.paused ? '1' : '0',
          p.active?.jobId ?? '',
          p.queue!.map((row) => row.jobId).join(','),
        ].join('|');
        if (queueKey !== lastQueueKey) {
          lastQueueKey = queueKey;
          lastLeanKey = '';
          setActiveDownloadId(p.activeModelId ?? null);
          setActiveDownloadLabel(p.activeModelName ?? null);
          const rows: Array<{ modelId: number; modelName: string }> = [];
          if (p.active) {
            rows.push({
              modelId: p.active.modelId,
              modelName: p.active.modelName,
            });
          } else if (p.activeModelId != null) {
            rows.push({
              modelId: p.activeModelId,
              modelName: p.activeModelName ?? `Model ${p.activeModelId}`,
            });
          }
          for (const item of p.queue ?? []) {
            if (rows.some((row) => row.modelId === item.modelId)) continue;
            rows.push({ modelId: item.modelId, modelName: item.modelName });
          }
          setQueuedDownloads(rows);
          setDownloadQueueSnapshot({
            phase: p.phase ?? (p.activeModelId ? 'active' : 'queued'),
            active: p.active ?? null,
            queue: p.queue ?? [],
            queuedCount: p.queuedCount ?? 0,
            activeModelId: p.activeModelId ?? null,
            activeModelName: p.activeModelName ?? null,
            paused: Boolean(p.paused),
            pauseReason: p.pauseReason ?? null,
          });
        }
      } else if (
        p.activeModelId != null ||
        (p.queuedCount ?? 0) > 0 ||
        p.paused
      ) {
        // Byte ticks (~2/s): only touch React state when queue identity changes.
        // Returning a new snapshot object every tick re-rendered the whole Browse
        // grid and made long sessions feel progressively worse.
        const leanKey = [
          p.activeModelId ?? '',
          p.queuedCount ?? 0,
          p.phase ?? '',
          p.paused ? '1' : '0',
          p.activeModelName ?? '',
          p.pauseReason ?? '',
        ].join('|');
        if (leanKey !== lastLeanKey) {
          lastLeanKey = leanKey;
          setActiveDownloadId((prev) =>
            prev === (p.activeModelId ?? null) ? prev : (p.activeModelId ?? null),
          );
          if (p.activeModelName) {
            const name = p.activeModelName;
            setActiveDownloadLabel((prev) => (prev === name ? prev : name));
          }
          setDownloadQueueSnapshot((prev) => {
            if (!prev) return prev;
            const phase = p.phase ?? prev.phase;
            const queuedCount = p.queuedCount ?? prev.queuedCount;
            const activeModelId = p.activeModelId ?? null;
            const activeModelName =
              p.activeModelName ?? prev.activeModelName;
            const paused = Boolean(p.paused);
            const pauseReason = p.pauseReason ?? prev.pauseReason;
            if (
              prev.phase === phase &&
              prev.queuedCount === queuedCount &&
              prev.activeModelId === activeModelId &&
              prev.activeModelName === activeModelName &&
              prev.paused === paused &&
              prev.pauseReason === pauseReason
            ) {
              return prev;
            }
            return {
              ...prev,
              phase,
              queuedCount,
              activeModelId,
              activeModelName,
              paused,
              pauseReason,
            };
          });
        }
      } else if (p.activeModelId == null && (p.queuedCount ?? 0) === 0) {
        setActiveDownloadId(null);
        setActiveDownloadLabel(null);
        setQueuedDownloads([]);
        setDownloadQueueSnapshot(null);
        lastQueueKey = '';
        lastLeanKey = '';
      }

      // Only settle after the weight is on disk. Cancel/fail still send `done`
      // (and often a planned fileName) — those must not enter Downloaded.
      if (p.done && p.saved) {
        settleSuccessfulDownload({
          modelId: p.modelId,
          modelName: p.modelName,
          type: p.type,
          versionId: p.versionId || undefined,
        });
      } else if (
        p.done &&
        !p.saved &&
        (/download cancelled/i.test(p.error ?? '') ||
          /aborted/i.test(p.error ?? ''))
      ) {
        clearOptimisticInstall(p.modelId);
      }

      // Errors and retries stay on the download HUD. Pushing them into the
      // app-wide notice/error re-rendered the whole window on every attempt.
    });
  }, [clearOptimisticInstall, settleSuccessfulDownload]);

  // Hydrate queue after mount (restored jobs may have started before subscribe).
  useEffect(() => {
    void window.wcm.civitai
      .listDownloadQueue()
      .then((snap) => {
        setDownloadQueueSnapshot(snap);
        setActiveDownloadId(snap.activeModelId);
        setActiveDownloadLabel(snap.activeModelName);
        const rows: Array<{ modelId: number; modelName: string }> = [];
        if (snap.active) {
          rows.push({
            modelId: snap.active.modelId,
            modelName: snap.active.modelName,
          });
        }
        for (const item of snap.queue) {
          if (rows.some((row) => row.modelId === item.modelId)) continue;
          rows.push({ modelId: item.modelId, modelName: item.modelName });
        }
        setQueuedDownloads(rows);
      })
      .catch(() => {
        // best-effort
      });
  }, []);

  const loadWatchlist = useCallback(async () => {
    try {
      const items = await window.wcm.civitai.listWatchlist();
      setWatchlist((prev) => {
        const byId = new Map(items.map((entry) => [entry.modelId, entry]));
        for (const [id, patch] of localPatchesRef.current) {
          if (patch.watching === false) {
            byId.delete(id);
            continue;
          }
          if (patch.watching === true && !byId.has(id)) {
            const local = prev.find((entry) => entry.modelId === id);
            if (local) byId.set(id, local);
          }
        }
        return [...byId.values()];
      });
      setTabListReady((prev) =>
        prev.notify ? prev : { ...prev, notify: true },
      );
    } catch (e) {
      flashStatusError(e instanceof Error ? e.message : String(e));
    }
  }, [flashStatusError]);

  const loadRecentlyUnlocked = useCallback(async () => {
    try {
      setRecentlyUnlocked(await window.wcm.civitai.listRecentlyUnlocked());
    } catch {
      // Non-critical — Browse still works without the pin list.
    }
  }, []);

  const dismissRecentlyUnlocked = useCallback(async (modelId: number) => {
    setRecentlyUnlocked((prev) =>
      prev.filter((entry) => entry.modelId !== modelId),
    );
    try {
      setRecentlyUnlocked(
        await window.wcm.civitai.dismissRecentlyUnlocked(modelId),
      );
    } catch (e) {
      flashStatusError(e instanceof Error ? e.message : String(e));
    }
  }, [flashStatusError]);

  const loadArchive = useCallback(async () => {
    try {
      const cards = await window.wcm.civitai.listArchivedCards();
      setArchiveItems((prev) => {
        const byId = new Map(cards.map((card) => [card.id, card]));
        for (const [id, patch] of localPatchesRef.current) {
          if (patch.archived === false || patch.maybe === true) {
            byId.delete(id);
            continue;
          }
          if (patch.archived === true && !byId.has(id)) {
            const local = prev.find((card) => card.id === id);
            if (local) byId.set(id, local);
          }
        }
        return [...byId.values()];
      });
      setTabListReady((prev) =>
        prev.archive ? prev : { ...prev, archive: true },
      );
      setShelfSummaries((prev) => ({
        downloaded: prev?.downloaded ?? [],
        maybe: prev?.maybe ?? [],
        archived: cards.map(cardToShelfSummary),
      }));
    } catch (e) {
      flashStatusError(e instanceof Error ? e.message : String(e));
    }
  }, [flashStatusError]);

  const loadMaybe = useCallback(async () => {
    try {
      const cards = await window.wcm.civitai.listMaybeCards();
      setMaybeItems((prev) => {
        const byId = new Map(cards.map((card) => [card.id, card]));
        for (const [id, patch] of localPatchesRef.current) {
          if (patch.maybe === false || patch.archived === true) {
            byId.delete(id);
            continue;
          }
          if (patch.maybe === true && !byId.has(id)) {
            const local = prev.find((card) => card.id === id);
            if (local) byId.set(id, local);
          }
        }
        return [...byId.values()];
      });
      setTabListReady((prev) =>
        prev.maybe ? prev : { ...prev, maybe: true },
      );
      setShelfSummaries((prev) => ({
        downloaded: prev?.downloaded ?? [],
        archived: prev?.archived ?? [],
        maybe: cards.map(cardToShelfSummary),
      }));
    } catch (e) {
      flashStatusError(e instanceof Error ? e.message : String(e));
    }
  }, [flashStatusError]);

  const loadDownloaded = useCallback(async () => {
    const gen = ++loadDownloadedGenRef.current;
    try {
      const cards = await window.wcm.civitai.listInstalledCards();
      if (gen !== loadDownloadedGenRef.current) return;
      setDownloadedItems((prev) => {
        // Union-merge — a short incomplete scan must not replace the library.
        const byId = new Map(
          mergeDownloadedCatalogCards(prev, cards).map((card) => [card.id, card]),
        );
        const now = Date.now();
        for (const [id, patch] of localPatchesRef.current) {
          if (patch.installed === false && patch.markedInstalled === false) {
            byId.delete(id);
            continue;
          }
          if (
            (patch.installed === true || patch.markedInstalled === true) &&
            !byId.has(id)
          ) {
            if (
              patch.installed === true &&
              patch.markedInstalled !== true &&
              (optimisticInstallUntilRef.current.get(id) ?? 0) < now
            ) {
              localPatchesRef.current.delete(id);
              optimisticInstallUntilRef.current.delete(id);
              browseHiddenIdsRef.current.delete(id);
              continue;
            }
            const local = prev.find((card) => card.id === id);
            if (local) byId.set(id, local);
          }
        }
        // Keep optimistic just-downloaded cards briefly until hash rematch.
        // Do not keep cancel/false settles forever — that parked cards on
        // Downloaded with no file on disk.
        for (const card of prev) {
          if (byId.has(card.id)) continue;
          const patch = localPatchesRef.current.get(card.id);
          if (patch?.installed !== true && patch?.markedInstalled !== true) {
            continue;
          }
          if (patch.markedInstalled === true) {
            byId.set(card.id, card);
            continue;
          }
          const until = optimisticInstallUntilRef.current.get(card.id) ?? 0;
          if (now < until) {
            byId.set(card.id, card);
          } else {
            localPatchesRef.current.delete(card.id);
            optimisticInstallUntilRef.current.delete(card.id);
            browseHiddenIdsRef.current.delete(card.id);
          }
        }
        return [...byId.values()];
      });
      // Server-confirmed installs no longer need optimistic patches.
      for (const card of cards) {
        if (card.installed || card.markedInstalled) {
          localPatchesRef.current.delete(card.id);
          optimisticInstallUntilRef.current.delete(card.id);
        }
      }
      setTabListReady((prev) =>
        prev.downloaded ? prev : { ...prev, downloaded: true },
      );
      setShelfSummaries((prev) => {
        const prevDownloaded = prev?.downloaded ?? [];
        const nextDownloaded = cards.map(cardToShelfSummary);
        // A hash scan that runs before the catalog index is loaded returns
        // nothing. That must not replace the count already on screen.
        const downloaded =
          nextDownloaded.length >= prevDownloaded.length
            ? nextDownloaded
            : prevDownloaded;
        return {
          archived: prev?.archived ?? [],
          maybe: prev?.maybe ?? [],
          downloaded,
        };
      });
      // Version-row API hydrate is not required for membership or counts.
      // Only fill thin rows when the Downloaded tab is open (max 8).
      if (tabRef.current !== 'downloaded') return;
      const needsHydrate = cards
        .filter(
          (c) =>
            (c.installed || c.markedInstalled) &&
            c.versionInstalls.length <= 1,
        )
        .slice(0, 8);
      for (const card of needsHydrate) {
        if (gen !== loadDownloadedGenRef.current) return;
        try {
          const fresh = await window.wcm.civitai.refreshModelVersionInstalls(
            card.id,
            type,
          );
          const apply = (prev: CivitaiModelCardDto[]) =>
            prev.map((row) =>
              row.id === fresh.id
                ? {
                    ...row,
                    ...fresh,
                    archived: row.archived,
                    maybe: row.maybe,
                    watching: row.watching,
                  }
                : row,
            );
          setDownloadedItems(apply);
          setItems(apply);
        } catch {
          // Deleted / rate-limited models stay on the local card.
        }
      }
    } catch (e) {
      flashStatusError(e instanceof Error ? e.message : String(e));
    }
  }, [flashStatusError, type]);

  const loadShelfSummaries = useCallback(async () => {
    try {
      const next = await window.wcm.civitai.listShelfSummaries();
      setShelfSummaries(next);
      setShelfReady(true);
      setArchiveItems((prev) =>
        prev.length > 0
          ? prev
          : next.archived.map((row) =>
              summaryToStubCard(row, { archived: true }),
            ),
      );
      setMaybeItems((prev) =>
        prev.length > 0
          ? prev
          : next.maybe.map((row) => summaryToStubCard(row, { maybe: true })),
      );
      setDownloadedItems((prev) =>
        prev.length > 0
          ? prev
          : next.downloaded.map((row) =>
              summaryToStubCard(row, { installed: true }),
            ),
      );
      setTabListReady((prev) => ({
        ...prev,
        archive: prev.archive || next.archived.length > 0,
        maybe: prev.maybe || next.maybe.length > 0,
        downloaded: prev.downloaded || next.downloaded.length > 0,
      }));
    } catch (e) {
      flashStatusError(e instanceof Error ? e.message : String(e));
    }
  }, [flashStatusError]);

  const catalogQueryParams = useCallback(
    () => ({
      type,
      query: query.trim() || undefined,
      sort,
      // Browse is unsorted-only — never pull sorted shelves into the main grid.
      hideInstalled: true,
      onlyNew,
      onlyPotentialDuplicate,
      includeArchived: false,
      includeMaybe: false,
      includeWatching: false as const,
      architectures: architectures.length ? architectures : undefined,
      sdxlFamily:
        architectures.includes('sdxl') && sdxlFamily !== 'all'
          ? sdxlFamily
          : undefined,
      category,
    }),
    [
      architectures,
      category,
      onlyNew,
      onlyPotentialDuplicate,
      query,
      sdxlFamily,
      sort,
      type,
    ],
  );

  const applyLocalPatches = useCallback((cards: CivitaiModelCardDto[]) => {
    const patches = localPatchesRef.current;
    const hidden = browseHiddenIdsRef.current;
    const out: CivitaiModelCardDto[] = [];
    for (const card of cards) {
      if (hidden.has(card.id)) continue;
      const patch = patches.get(card.id);
      const next = patch ? withCardFlags(card, patch) : card;
      // Browse = unsorted only — sorted shelves never re-enter the main grid.
      if (next.archived || next.maybe || next.watching || next.installed) {
        continue;
      }
      out.push(next);
    }
    return out;
  }, []);

  const notePreviewUrlChange = useCallback(
    (modelId: number, previewUrl: string) => {
      const patch = (card: CivitaiModelCardDto) =>
        card.id === modelId ? { ...card, previewUrl } : card;
      setItems((prev) => prev.map(patch));
      setDownloadedItems((prev) => prev.map(patch));
      setArchiveItems((prev) => prev.map(patch));
      setMaybeItems((prev) => prev.map(patch));
    },
    [],
  );

  const catalogMetaRef = useRef(catalogMeta);
  catalogMetaRef.current = catalogMeta;
  const browseTopUpRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const archiveItemsRef = useRef(archiveItems);
  const maybeItemsRef = useRef(maybeItems);
  archiveItemsRef.current = archiveItems;
  maybeItemsRef.current = maybeItems;
  const loadCatalogRef = useRef<
    (opts?: {
      quiet?: boolean;
      append?: boolean;
      limit?: number;
      revealTop?: boolean;
    }) => Promise<void>
  >(async () => undefined);
  const catalogLoadSeqRef = useRef(0);
  const catalogBusySeqRef = useRef(0);
  const [browseRevealToken, setBrowseRevealToken] = useState(0);

  const loadCatalog = useCallback(
    async (opts?: {
      quiet?: boolean;
      append?: boolean;
      limit?: number;
      revealTop?: boolean;
    }) => {
      const seq = ++catalogLoadSeqRef.current;
      if (!opts?.quiet) {
        catalogBusySeqRef.current = seq;
        setBusy(true);
      }
      try {
        const offset = opts?.append
          ? (catalogMetaRef.current?.nextOffset ?? 0)
          : 0;
        const limit = Math.min(
          200,
          Math.max(1, Math.floor(opts?.limit ?? 200)),
        );
        const result = await window.wcm.civitai.getCatalogSlice({
          ...catalogQueryParams(),
          offset,
          limit,
        });
        if (seq !== catalogLoadSeqRef.current) return;
        activeSliceKeyRef.current = result.sliceKey;
        const patched = applyLocalPatches(result.items);
        setItems((prev) => {
          let next: CivitaiModelCardDto[];
          if (!opts?.append) {
            next = patched;
          } else {
            const seen = new Set(prev.map((c) => c.id));
            next = [...prev];
            for (const card of patched) {
              if (seen.has(card.id)) continue;
              seen.add(card.id);
              next.push(card);
            }
          }
          itemsRef.current = next;
          return next;
        });
        const meta = {
          sliceKey: result.sliceKey,
          totalCached: result.totalCached,
          exhausted: result.exhausted,
          nextOffset: result.nextOffset,
          hasMore: result.hasMore,
          matchTotal: result.matchTotal,
          matchRemaining: result.matchRemaining,
        };
        catalogMetaRef.current = meta;
        setCatalogMeta(meta);
        if (!opts?.append) setBrowseGridReady(true);
        if (opts?.revealTop && !opts.append) {
          setBrowseRevealToken((n) => n + 1);
        }
        // EA page enrich only for cards the Browse grid would actually render
        // (same filters as browseItems). Empty grid → no scrape.
        const healIds = patched
          .filter(
            (c) =>
              !queuedIdsRef.current.has(c.id) &&
              matchesCardCategory(c.tags, null, enabledCivitaiCategories) &&
              matchesCardOrVersionArchitecture(
                c,
                architectures,
                sdxlFamily,
                enabledSdxlFamilies,
              ) &&
              // Showing Download — re-check even when a *past* endsAt is cached
              // (a newer version can open a fresh EA window).
              !c.earlyAccess &&
              c.hasDownloadableVersion,
          )
          .map((c) => c.id)
          .slice(0, 16);
        if (healIds.length > 0) {
          void window.wcm.civitai
            .enrichBrowseEarlyAccess({
              modelIds: healIds,
              sliceKey: result.sliceKey,
            })
            .then((changed) => {
              if (changed > 0) void loadCatalogRef.current({ quiet: true });
            });
        }
      } catch (e) {
        if (seq !== catalogLoadSeqRef.current) return;
        flashStatusError(e instanceof Error ? e.message : String(e));
        if (!opts?.append) setBrowseGridReady(true);
      } finally {
        if (catalogBusySeqRef.current === seq) setBusy(false);
      }
    },
    [
      applyLocalPatches,
      architectures,
      catalogQueryParams,
      enabledCivitaiCategories,
      enabledSdxlFamilies,
      flashStatusError,
      sdxlFamily,
    ],
  );
  loadCatalogRef.current = loadCatalog;

  const startCatalogSync = useCallback(
    (
      mode: 'auto' | 'incremental' | 'fill' = 'auto',
      opts?: { force?: boolean },
    ) => {
      void window.wcm.civitai
        .syncCatalogSlice({
          type,
          architectures: architectures.length ? architectures : undefined,
          sdxlFamily:
            architectures[0] === 'sdxl' ? sdxlFamily : undefined,
          category,
          mode,
          force: opts?.force === true,
        })
        .then((progress) => {
          if (progress.sliceKey !== activeSliceKeyRef.current) return;
          // Joining an in-flight sync returns live counters — merge without
          // wiping a richer progress event that already arrived. Never regress
          // done/error/cancelled back to syncing (that left the UI stuck on
          // “Checking for new models…” forever).
          setCatalogSync((prev) => {
            if (
              prev &&
              prev.sliceKey === progress.sliceKey &&
              (prev.status === 'done' ||
                prev.status === 'error' ||
                prev.status === 'cancelled') &&
              progress.status === 'syncing'
            ) {
              return prev;
            }
            if (
              prev &&
              prev.sliceKey === progress.sliceKey &&
              prev.status === 'syncing' &&
              progress.status === 'syncing' &&
              progress.pagesFetched < prev.pagesFetched
            ) {
              return prev;
            }
            return progress;
          });
        })
        .catch((e) => {
          flashStatusError(e instanceof Error ? e.message : String(e));
        });
    },
    [architectures, category, flashStatusError, sdxlFamily, type],
  );

  const clearTipCheckTimer = useCallback(() => {
    if (tipCheckTimerRef.current !== null) {
      window.clearTimeout(tipCheckTimerRef.current);
      tipCheckTimerRef.current = null;
    }
  }, []);

  /**
   * Schedule the next “new models” tip-check. Delay is the full auto-sync
   * interval after `lastSyncedAt` when known (so a long check doesn't
   * shorten the following gap, and a cooldown skip doesn't add a full extra
   * interval).
   */
  const scheduleNextTipCheck = useCallback(
    (lastSyncedAt?: string) => {
      clearTipCheckTimer();
      const mins = catalogAutoSyncMinutesRef.current;
      if (mins <= 0) return;
      const intervalMs = mins * 60_000;
      let delayMs = intervalMs;
      if (lastSyncedAt) {
        const lastMs = Date.parse(lastSyncedAt);
        if (Number.isFinite(lastMs)) {
          // At least 5s so we never tight-loop if clocks skew.
          delayMs = Math.max(5_000, lastMs + intervalMs - Date.now());
        }
      }
      tipCheckTimerRef.current = window.setTimeout(() => {
        tipCheckTimerRef.current = null;
        startCatalogSync('incremental');
      }, delayMs);
    },
    [clearTipCheckTimer, startCatalogSync],
  );

  useEffect(() => {
    return () => {
      clearTipCheckTimer();
    };
  }, [clearTipCheckTimer]);

  useEffect(() => {
    let lastReloadAt = 0;
    let lastAdded = 0;
    let lastPaintAt = 0;
    return window.wcm.civitai.onCatalogSyncProgress((progress) => {
      if (
        activeSliceKeyRef.current &&
        progress.sliceKey !== activeSliceKeyRef.current
      ) {
        // Drop stale “syncing” from a previous filter so empty categories
        // don’t keep showing “Checking for new models…”.
        setCatalogSync((prev) =>
          prev &&
          prev.status === 'syncing' &&
          prev.sliceKey !== activeSliceKeyRef.current
            ? null
            : prev,
        );
        return;
      }
      const finished =
        progress.status === 'done' ||
        progress.status === 'error' ||
        progress.status === 'cancelled';
      const now = Date.now();
      // Heartbeats re-render this whole modal. Paint at most every 1.5s unless
      // the sync actually finished.
      if (finished || now - lastPaintAt > 1500) {
        lastPaintAt = now;
        setCatalogSync(progress);
        setCatalogMeta((prev) =>
          prev && prev.sliceKey === progress.sliceKey
            ? {
                ...prev,
                totalCached: progress.totalCached,
                exhausted: progress.exhausted,
              }
            : prev,
        );
      }
      // Remap browse cards only when sync finishes, or (throttled) when new
      // models arrived — never on every empty "syncing" heartbeat.
      const addedSince = progress.addedThisRun > lastAdded;
      if (addedSince) lastAdded = progress.addedThisRun;
      if (finished) lastAdded = 0;
      if (finished || (addedSince && now - lastReloadAt > 5000)) {
        lastReloadAt = now;
        void loadCatalog({
          quiet: true,
          revealTop:
            progress.mode === 'incremental' && progress.addedThisRun > 0,
        });
        // Tip-check finds new IDs; library detail enrich finds new versions of
        // models you already have (esp. checkpoints that never reappear in Newest).
        if (finished && progress.status === 'done') {
          void window.wcm.civitai.startVersionHashEnrich();
        }
      }
      if (progress.status === 'error' && progress.error) {
        flashStatusError(progress.error);
      }
      // Wait until lastSyncedAt + interval before the next tip-check.
      if (finished) {
        scheduleNextTipCheck(progress.lastSyncedAt);
      }
    });
  }, [
    flashStatusError,
    loadCatalog,
    scheduleNextTipCheck,
  ]);

  const rematchAfterWarm = useCallback(() => {
    void loadCatalog({ quiet: true });
    void loadDownloaded();
  }, [loadCatalog, loadDownloaded]);

  const openPreviewDownloader = () => {
    setPreviewDownloaderOpen(true);
  };

  const applyDownloadQueueSnapshot = useCallback(
    (snap: CivitaiDownloadQueueSnapshotDto) => {
      setDownloadQueueSnapshot(snap);
      setActiveDownloadId(snap.activeModelId);
      setActiveDownloadLabel(snap.activeModelName);
      const rows: Array<{ modelId: number; modelName: string }> = [];
      if (snap.active) {
        rows.push({
          modelId: snap.active.modelId,
          modelName: snap.active.modelName,
        });
      }
      for (const item of snap.queue) {
        if (rows.some((row) => row.modelId === item.modelId)) continue;
        rows.push({ modelId: item.modelId, modelName: item.modelName });
      }
      setQueuedDownloads(rows);
    },
    [],
  );

  // Keep one card per queue job. Placeholders come from the queue snapshot so
  // the Queued tab matches the badge count even when Browse filters / catalog
  // churn would otherwise wipe unresolved cards (and cancel getModel fetches).
  useEffect(() => {
    if (queueCount === 0) {
      setQueuedCards([]);
      if (tab === 'queued') setTab('browse');
      return;
    }

    const queueRows: CivitaiDownloadQueueItemDto[] = [];
    if (downloadQueueSnapshot?.active) {
      queueRows.push(downloadQueueSnapshot.active);
    }
    for (const item of downloadQueueSnapshot?.queue ?? []) {
      if (!queueRows.some((row) => row.modelId === item.modelId)) {
        queueRows.push(item);
      }
    }
    for (const item of queuedDownloads) {
      if (queueRows.some((row) => row.modelId === item.modelId)) continue;
      queueRows.push({
        jobId: `fallback-${item.modelId}`,
        modelId: item.modelId,
        modelName: item.modelName,
        type: 'LORA',
        status: 'queued',
        categoryLabel: '',
      });
    }
    for (const id of queuedIds) {
      if (queueRows.some((row) => row.modelId === id)) continue;
      queueRows.push({
        jobId: `fallback-${id}`,
        modelId: id,
        modelName: `Model ${id}`,
        type: 'LORA',
        status: 'queued',
        categoryLabel: '',
      });
    }

    const orderedIds = queueRows.map((row) => row.modelId);
    const byQueueId = new Map(queueRows.map((row) => [row.modelId, row]));

    setQueuedCards((prev) => {
      const known = new Map<number, CivitaiModelCardDto>();
      for (const card of prev) known.set(card.id, card);
      for (const list of [items, downloadedItems, maybeItems, archiveItems]) {
        for (const card of list) {
          if (!queuedIds.has(card.id)) continue;
          const existing = known.get(card.id);
          known.set(
            card.id,
            existing ? preferRicherQueuedCard(existing, card) : card,
          );
        }
      }

      return orderedIds.map((id) => {
        const row = byQueueId.get(id)!;
        const placeholder = placeholderQueuedCard(row, origin);
        const existing = known.get(id);
        return existing
          ? preferRicherQueuedCard(placeholder, existing)
          : placeholder;
      });
    });
  }, [
    archiveItems,
    downloadQueueSnapshot,
    downloadedItems,
    items,
    maybeItems,
    origin,
    queueCount,
    queuedDownloads,
    queuedIds,
    tab,
  ]);

  const cancelQueuedDownload = useCallback(
    async (modelId: number) => {
      try {
        const snap = await window.wcm.civitai.cancelDownloadQueueItem(modelId);
        clearOptimisticInstall(modelId);
        applyDownloadQueueSnapshot(snap);
        flashStatusNotice('Removed from download queue');
      } catch (e) {
        flashStatusError(e instanceof Error ? e.message : String(e));
      }
    },
    [
      applyDownloadQueueSnapshot,
      clearOptimisticInstall,
      flashStatusError,
      flashStatusNotice,
    ],
  );

  const openDownloadQueue = () => {
    setDownloadQueueOpen(true);
    void window.wcm.civitai
      .listDownloadQueue()
      .then((snap) => applyDownloadQueueSnapshot(snap))
      .catch((e) => {
        flashStatusError(e instanceof Error ? e.message : String(e));
      });
  };

  // Display from local catalog first — do not compete with other tab loads.
  useEffect(() => {
    if (tab !== 'browse' || !filtersReady) return;
    setBrowseGridReady(false);
    void loadCatalog();
  }, [filtersReady, loadCatalog, tab]);

  // Local shelf ids/counts first — do not wait for card hydrate or hash warm.
  useEffect(() => {
    if (!filtersReady) return;
    void loadShelfSummaries();
  }, [filtersReady, loadShelfSummaries, origin]);

  // Recompute Downloaded update flags after the first grid paint. Counts on
  // open come from shelf summaries; this replaces a stale "update" bit once
  // local hashes are attached. Yields on the main process so it does not
  // lock the window.
  useEffect(() => {
    if (!filtersReady || !browseGridReady) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) void loadDownloaded();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [browseGridReady, filtersReady, loadDownloaded, origin]);

  // Background catalog sync AFTER the first grid page is on screen.
  // Incomplete slices auto-fill until exhausted (resumes from saved cursor);
  // exhausted slices only tip-check Newest. Do not cancel on effect cleanup —
  // that was aborting in-progress backfills and making every revisit feel like
  // a full re-download (cursor is persisted; restarting same slice is a no-op).
  useEffect(() => {
    if (tab !== 'browse' || !filtersReady || !browseGridReady) return;
    clearTipCheckTimer();
    const timer = window.setTimeout(() => {
      startCatalogSync('auto');
    }, 1500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    architectures,
    browseGridReady,
    category,
    clearTipCheckTimer,
    filtersReady,
    origin,
    startCatalogSync,
    tab,
    type,
  ]);

  // Other tabs load on demand only — never on Browse open. Eagerly hydrating
  // Maybe (~900 cards) + Downloaded (scan of full catalog) was blocking the
  // main process and showing "Refreshing…" before any Browse preview appeared.
  // Watchlist is small and required so Browse can hide Notify-sorted cards.
  useEffect(() => {
    if (!filtersReady) return;
    void loadRecentlyUnlocked();
    void loadWatchlist();
    if (tab === 'archive') void loadArchive();
    else if (tab === 'maybe') void loadMaybe();
    else if (tab === 'downloaded') void loadDownloaded();
  }, [
    tab,
    filtersReady,
    origin,
    loadWatchlist,
    loadRecentlyUnlocked,
    loadArchive,
    loadMaybe,
    loadDownloaded,
  ]);

  // Folder walk / hash attach finished — invert is cheap, rematch immediately.
  useEffect(() => {
    return window.wcm.modelFiles.onLoraIndexRefreshed(() => {
      void loadShelfSummaries();
      void loadDownloaded();
    });
  }, [loadDownloaded, loadShelfSummaries]);

  // Origin change: drop stale lists so a later tab visit reloads cleanly.
  useEffect(() => {
    setArchiveItems([]);
    setMaybeItems([]);
    setDownloadedItems([]);
    setWatchlist([]);
    setRecentlyUnlocked([]);
    setTabListReady({
      downloaded: false,
      maybe: false,
      archive: false,
      notify: false,
    });
    setShelfSummaries(null);
    setShelfReady(false);
  }, [origin]);

  const selectArchitecture = (id: CivitaiArchitectureIdDto) => {
    setArchitectures([id]);
    if (id !== 'sdxl') setSdxlFamily('all');
  };

  // Keep model-browse architecture inside the library-enabled set (avoids a
  // select that displays "Krea 2" while filtering as an unlisted value).
  useEffect(() => {
    if (!filtersReady || enabledArchitectures.length === 0) return;
    const current = architectures[0];
    if (current && enabledArchitectures.includes(current)) return;
    setArchitectures([enabledArchitectures[0]!]);
    if (enabledArchitectures[0] !== 'sdxl') setSdxlFamily('all');
  }, [architectures, enabledArchitectures, filtersReady]);

  const visibleCategoryPresets = useMemo(
    () =>
      CIVITAI_MODEL_CATEGORY_PRESETS.filter((preset) =>
        enabledCivitaiCategories.includes(preset.id),
      ),
    [enabledCivitaiCategories],
  );

  const toggleCivitaiCategoryVisibility = (id: CivitaiModelCategoryIdDto) => {
    if (!activeLibraryId) return;
    const current = new Set(enabledCivitaiCategories);
    if (current.has(id)) {
      if (current.size <= 1) {
        flashStatusError('Keep at least one category enabled');
        return;
      }
      current.delete(id);
    } else {
      current.add(id);
    }
    const next = CIVITAI_MODEL_CATEGORY_PRESETS.map((p) => p.id).filter((cid) =>
      current.has(cid),
    );
    setEnabledCivitaiCategories(next);
    if (category && !current.has(category)) {
      setCategory(null);
    }
    void window.wcm.library
      .updateLibrary(activeLibraryId, { enabledCivitaiCategories: next })
      .catch((e) => {
        flashStatusError(e instanceof Error ? e.message : String(e));
      });
  };

  const openCategoryVisibility = () => {
    categoriesWhenVisibilityOpenedRef.current = [...enabledCivitaiCategories];
    setCategoryVisibilityOpen(true);
  };

  const closeCategoryVisibility = () => {
    setCategoryVisibilityOpen(false);
    const before = new Set(categoriesWhenVisibilityOpenedRef.current ?? []);
    categoriesWhenVisibilityOpenedRef.current = null;
    const reseedEnabled = enabledCivitaiCategories.some((id) => !before.has(id));
    void window.wcm.civitai
      .syncPreviewQueueCategories({ reseedEnabled })
      .catch((e) => {
        flashStatusError(e instanceof Error ? e.message : String(e));
      });
  };

  const selectPreview = useCallback(
    (pageUrl: string, modelId: number, name: string) => {
      setSelectedPreview({ pageUrl, modelId, name });
      setPreviewOpen(true);
    },
    [],
  );

  /** Collapse the embedded browser when clicking empty grid space (not a card). */
  const collapsePreviewOnGridBackground = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!previewOpen) return;
      if (event.target !== event.currentTarget) return;
      setPreviewOpen(false);
    },
    [previewOpen],
  );

  useEffect(() => {
    if (!focusModel) return;
    let cancelled = false;
    const requested = focusModel;
    void (async () => {
      try {
        const card = await window.wcm.civitai.getModel(requested.modelId);
        if (cancelled) return;
        if (card.installed || card.markedInstalled) setTab('downloaded');
        else if (card.archived) setTab('archive');
        else if (card.maybe) setTab('maybe');
        else setTab('browse');
        selectPreview(
          card.pageUrl || requested.pageUrl,
          card.id,
          card.name || requested.name || String(requested.modelId),
        );
      } catch {
        if (cancelled) return;
        selectPreview(
          requested.pageUrl,
          requested.modelId,
          requested.name ?? String(requested.modelId),
        );
      } finally {
        if (!cancelled) onFocusModelConsumed?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusModel, onFocusModelConsumed, selectPreview]);

  const persistSplitRatio = useCallback((ratio: number) => {
    if (persistSplitTimerRef.current !== null) {
      window.clearTimeout(persistSplitTimerRef.current);
    }
    persistSplitTimerRef.current = window.setTimeout(() => {
      persistSplitTimerRef.current = null;
      void window.wcm.ui.setCivitaiSplitRatio(ratio).catch(() => {
        // best-effort
      });
    }, 200);
  }, []);

  const adjustCardMinWidth = useCallback((delta: number) => {
    setCardMinWidth((prev) => {
      const next = Math.min(280, Math.max(100, prev + delta));
      void window.wcm.ui.setCivitaiCardMinWidth(next).catch(() => {
        // best-effort
      });
      return next;
    });
  }, []);

  const clampSplitRatio = (ratio: number) =>
    Math.min(0.7, Math.max(0.22, ratio));

  const beginSplitResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingSplit(true);
  };

  const moveSplitResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingSplit || !splitRowRef.current) return;
    const rect = splitRowRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const next = clampSplitRatio((event.clientX - rect.left) / rect.width);
    liveSplitRatioRef.current = next;
    setSplitRatio(next);
  };

  const finishSplitResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingSplit) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    setResizingSplit(false);
    persistSplitRatio(liveSplitRatioRef.current);
  };

  const canDownloadFor = (modelType: string) =>
    modelType.toLowerCase() === 'checkpoint'
      ? hasFolders.ckpt
      : hasFolders.lora;

  const refreshCurrentTab = () => {
    if (tab === 'browse') {
      void loadCatalog().then(() => startCatalogSync('auto', { force: true }));
    } else if (tab === 'archive') void loadArchive();
    else if (tab === 'maybe') void loadMaybe();
    else if (tab === 'downloaded') void loadDownloaded();
    else void loadWatchlist();
  };

  const startDownload = async (
    target: DownloadTarget,
    opts: DownloadConfirmOpts,
  ) => {
    // Download means "yes" — drop Maybe so the card leaves that shortlist
    // (Queue → Downloaded only). Covers Maybe-tab clicks too.
    const maybeCard = maybeItemsRef.current.find((c) => c.id === target.id);
    const browseMaybe = itemsRef.current.find(
      (c) => c.id === target.id && c.maybe,
    );
    const toClear = maybeCard ?? browseMaybe;
    if (toClear) {
      moveToBucketRef.current(withCardFlags(toClear, { maybe: true }), 'none');
    }

    const dlType = target.typeHint;
    const label = target.name;
    const fallbackName = target.fileName?.trim() || 'model.safetensors';
    const resolvedName = resolveDownloadSaveFileName(
      opts.fileName ?? fallbackName,
      fallbackName,
    );
    if (!resolvedName.ok) {
      flashStatusError(resolvedName.error);
      return;
    }
    const fileName = resolvedName.fileName;
    const weights =
      dlType === 'LORA'
        ? normalizeLoraWeights(opts.weights ?? '') ?? undefined
        : undefined;
    if (dlType === 'LORA' && (opts.weights ?? '').trim() && !weights) {
      flashStatusError(
        `Invalid LoRA weights "${(opts.weights ?? '').trim()}". Use a number or pick-list, e.g. 0.8 or {0.8|0.9|1|1}.`,
      );
      return;
    }
    try {
      const dest = await window.wcm.civitai.checkDownloadDestination({
        type: dlType,
        fileName,
        fallbackFileName: fallbackName,
        category: opts.category,
        loraCategoryId: opts.loraCategoryId,
      });
      if (!dest.ok) {
        flashStatusError(dest.error);
        return;
      }
    } catch (e) {
      flashStatusError(e instanceof Error ? e.message : String(e));
      return;
    }
    setDownloadTarget(null);
    setEditingQueueModelId(null);
    setDownloadInitialOpts(null);

    try {
      await onBeforeDownload?.();
    } catch {
      // Still attempt the download; append uses disk as last resort.
    }

    flashStatusNotice(`Queued ${label}`);

    setQueuedCards((prev) => {
      if (prev.some((card) => card.id === target.id)) return prev;
      const fromBrowse = items.find((card) => card.id === target.id);
      if (fromBrowse) return [...prev, fromBrowse];
      return prev;
    });

    try {
      const extras = uniqueExtraLoraCategoryIds(
        opts.loraCategoryId,
        opts.extraLoraCategoryIds,
      );
      const result = await window.wcm.civitai.downloadModel({
        modelId: target.id,
        versionId: opts.versionId ?? target.versionId,
        fileId: opts.fileId,
        type: dlType,
        category: opts.category,
        loraCategoryId: opts.loraCategoryId,
        extraLoraCategoryIds: extras.length > 0 ? extras : undefined,
        weights,
        extraComment: opts.extraComment,
        extraPrompt: opts.extraPrompt,
        modelName: label,
        fileName,
      });
      const folderNote = result.categoryFolder
        ? ` → ${result.categoryFolder}/`
        : '';
      const wildNote = result.wildcardAppended
        ? ` · added to ${result.wildcardRelativePath}`
        : result.wildcardAppendError
          ? ` · wildcard append failed: ${result.wildcardAppendError}`
          : result.wildcardRelativePath && result.wildcardAppended === false
            ? ` · already in ${result.wildcardRelativePath}`
            : '';
      flashStatusNotice(`Downloaded ${result.fileName}${folderNote}${wildNote}`);
      // Progress handler already settled Queue → Downloaded. Refresh Downloaded
      // from disk hashes; do not reload Browse (that was flashing cards back).
      void loadDownloaded();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/download cancelled/i.test(msg)) {
        flashStatusNotice(msg);
      } else {
        flashStatusError(msg);
      }
    }
  };

  const requestDownload = (
    item: Pick<
      CivitaiModelCardDto,
      | 'id'
      | 'name'
      | 'versionId'
      | 'versionName'
      | 'type'
      | 'fileName'
      | 'fileSizeKB'
      | 'trainedWords'
      | 'pageUrl'
      | 'baseModel'
      | 'earlyAccess'
      | 'earlyAccessEndsAt'
      | 'versionInstalls'
    > & { typeHint?: CivitaiModelTypeDto },
    opts?: { skipConfirm?: boolean },
  ) => {
    const dlType: CivitaiModelTypeDto =
      item.typeHint ??
      (item.type.toLowerCase() === 'checkpoint' ? 'Checkpoint' : 'LORA');
    if (!canDownloadFor(dlType)) {
      flashStatusError(
        dlType === 'LORA'
          ? 'Configure a LoRA folder in Settings first.'
          : 'Configure a checkpoint folder in Settings first.',
      );
      return;
    }
    const target: DownloadTarget = {
      id: item.id,
      name: item.name,
      versionId: item.versionId,
      versionName: item.versionName,
      type: item.type,
      fileName: item.fileName,
      fileSizeKB: item.fileSizeKB,
      trainedWords: item.trainedWords ?? [],
      pageUrl: item.pageUrl,
      baseModel: item.baseModel,
      earlyAccess: item.earlyAccess,
      earlyAccessEndsAt: item.earlyAccessEndsAt,
      versionInstalls: item.versionInstalls ?? [],
      typeHint: dlType,
    };
    if (opts?.skipConfirm) {
      void (async () => {
        try {
          const confirmOpts = await resolveDefaultDownloadConfirmOpts(
            target,
            architectures,
            sdxlFamily,
            enabledSdxlFamilies,
          );
          await startDownload(target, confirmOpts);
        } catch (e) {
          flashStatusError(e instanceof Error ? e.message : String(e));
        }
      })();
      return;
    }
    setDownloadTarget(target);
  };

  const closeDownloadModal = () => {
    setDownloadTarget(null);
    setEditingQueueModelId(null);
    setDownloadInitialOpts(null);
  };

  const openEditQueuedDownload = (item: CivitaiDownloadQueueItemDto) => {
    const card =
      queuedCards.find((c) => c.id === item.modelId) ??
      items.find((c) => c.id === item.modelId) ??
      null;
    const dlType = item.type;
    const target: DownloadTarget = {
      id: item.modelId,
      name: item.modelName,
      versionId: item.versionId ?? card?.versionId,
      versionName: card?.versionName,
      type: card?.type ?? dlType,
      fileName: item.fileName ?? card?.fileName,
      fileSizeKB: card?.fileSizeKB,
      trainedWords: card?.trainedWords ?? [],
      pageUrl: card?.pageUrl ?? '',
      baseModel: card?.baseModel,
      earlyAccess: card?.earlyAccess ?? false,
      earlyAccessEndsAt: card?.earlyAccessEndsAt,
      versionInstalls: card?.versionInstalls ?? [],
      typeHint: dlType,
    };
    setEditingQueueModelId(item.modelId);
    setDownloadInitialOpts({
      category: item.category,
      loraCategoryId: item.loraCategoryId,
      extraLoraCategoryIds: item.extraLoraCategoryIds,
      weights: item.weights,
      extraComment: item.extraComment,
      extraPrompt: item.extraPrompt,
      fileName: item.fileName,
      versionId: item.versionId,
      fileId: item.fileId,
    });
    setDownloadTarget(target);
  };

  const confirmDownload = async (opts: DownloadConfirmOpts) => {
    if (!downloadTarget) return;
    if (editingQueueModelId != null) {
      const dlType = downloadTarget.typeHint;
      const fallbackName =
        downloadTarget.fileName?.trim() || 'model.safetensors';
      const resolvedName = resolveDownloadSaveFileName(
        opts.fileName ?? fallbackName,
        fallbackName,
      );
      if (!resolvedName.ok) {
        flashStatusError(resolvedName.error);
        return;
      }
      const fileName = resolvedName.fileName;
      const weights =
        dlType === 'LORA'
          ? normalizeLoraWeights(opts.weights ?? '') ?? undefined
          : undefined;
      if (dlType === 'LORA' && (opts.weights ?? '').trim() && !weights) {
        flashStatusError(
          `Invalid LoRA weights "${(opts.weights ?? '').trim()}". Use a number or pick-list, e.g. 0.8 or {0.8|0.9|1|1}.`,
        );
        return;
      }
      const modelId = editingQueueModelId;
      closeDownloadModal();
      try {
        const extras = uniqueExtraLoraCategoryIds(
          opts.loraCategoryId,
          opts.extraLoraCategoryIds,
        );
        const snap = await window.wcm.civitai.updateDownloadQueueItem(modelId, {
          loraCategoryId: opts.loraCategoryId,
          extraLoraCategoryIds: extras,
          category: opts.category,
          weights,
          extraComment: opts.extraComment ?? '',
          extraPrompt: opts.extraPrompt ?? '',
          versionId: opts.versionId,
          fileId: opts.fileId,
          fileName,
        });
        applyDownloadQueueSnapshot(snap);
        flashStatusNotice('Updated queued download');
      } catch (e) {
        flashStatusError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    await startDownload(downloadTarget, opts);
  };

  const markVersionDownloaded = async (
    picks: Array<{
      versionId: number;
      fileId: number;
      fileName: string;
      label: string;
    }>,
  ) => {
    const target = downloadTarget;
    if (!target || picks.length === 0) return;
    setDownloadTarget(null);
    try {
      await window.wcm.civitai.markVersionsInstalled({
        modelId: target.id,
        versions: picks.map((pick) => ({
          versionId: pick.versionId,
          fileId: pick.fileId,
          fileName: pick.fileName,
        })),
      });
      let card: CivitaiModelCardDto;
      try {
        card = await window.wcm.civitai.refreshModelVersionInstalls(
          target.id,
          target.typeHint,
        );
      } catch {
        card = await window.wcm.civitai.getModel(target.id);
      }
      // Keep a short-lived patch so Browse tip-checks don't flash the old card.
      localPatchesRef.current.set(target.id, {
        installed: card.installed,
        latestVersionInstalled: card.latestVersionInstalled,
        hasUninstalledVersion: card.hasUninstalledVersion,
        hasDownloadableVersion: card.hasDownloadableVersion,
        markedInstalled: card.markedInstalled,
      });
      setItems((prev) => {
        if (hideInstalled && card.installed) {
          browseHiddenIdsRef.current.add(target.id);
          return prev.filter((c) => c.id !== target.id);
        }
        return prev.map((c) => (c.id === target.id ? card : c));
      });
      setDownloadedItems((prev) =>
        prev.some((c) => c.id === target.id)
          ? prev.map((c) => (c.id === target.id ? card : c))
          : [...prev, card].sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
            ),
      );
      // Drop only after downloaded list can see the server-confirmed card.
      if (card.installed) {
        localPatchesRef.current.delete(target.id);
      }
      flashStatusNotice(
        picks.length === 1
          ? `Marked ${target.name} · ${picks[0]!.label} as downloaded.`
          : `Marked ${picks.length} versions of ${target.name} as downloaded.`,
      );
      void loadDownloaded();
    } catch (e) {
      flashStatusError(e instanceof Error ? e.message : String(e));
    }
  };

  /** After Maybe/Archive removals, pull more cards if the grid got sparse. */
  const BROWSE_TOP_UP_BELOW = 20;
  const topUpBrowseIfLow = useCallback(
    async (visibleCount: number) => {
      if (tab !== 'browse') return;
      let count = visibleCount;
      while (
        count < BROWSE_TOP_UP_BELOW &&
        catalogMetaRef.current?.hasMore &&
        !browseTopUpRef.current
      ) {
        browseTopUpRef.current = true;
        const beforeLen = itemsRef.current.length;
        const beforeOffset = catalogMetaRef.current?.nextOffset ?? 0;
        try {
          await loadCatalog({ quiet: true, append: true, limit: 200 });
        } catch {
          // loadCatalog already flashes errors
          break;
        } finally {
          browseTopUpRef.current = false;
        }
        count = itemsRef.current.filter((card) =>
          matchesCardArchitecture(
            card.baseModel,
            architectures,
            sdxlFamily,
            enabledSdxlFamilies,
          ),
        ).length;
        const afterOffset = catalogMetaRef.current?.nextOffset ?? 0;
        // No progress (same offset / no new cards) — stop to avoid a tight loop.
        if (
          afterOffset <= beforeOffset &&
          itemsRef.current.length <= beforeLen
        ) {
          break;
        }
      }
    },
    [architectures, loadCatalog, sdxlFamily, enabledSdxlFamilies, tab],
  );

  /**
   * Drop a Browse ghost for real (grid may shift) and optionally top up.
   */
  const finalizeBrowseGhost = useCallback(
    (modelId: number, opts?: { topUp?: boolean }) => {
      if (browseBucketUndoTimerRef.current !== null) {
        window.clearTimeout(browseBucketUndoTimerRef.current);
        browseBucketUndoTimerRef.current = null;
      }
      setBrowseGhostIds((prev) => {
        if (!prev.has(modelId)) return prev;
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
      setBrowseBucketUndo((prev) =>
        prev?.modelId === modelId ? null : prev,
      );
      browseHiddenIdsRef.current.add(modelId);
      setItems((prev) => {
        const next = prev.filter((card) => card.id !== modelId);
        itemsRef.current = next;
        return next;
      });
      if (opts?.topUp !== false && tab === 'browse') {
        const remaining = itemsRef.current.filter((card) =>
          matchesCardArchitecture(
            card.baseModel,
            architectures,
            sdxlFamily,
            enabledSdxlFamilies,
          ),
        ).length;
        void topUpBrowseIfLow(remaining);
      }
    },
    [
      architectures,
      enabledSdxlFamilies,
      sdxlFamily,
      tab,
      topUpBrowseIfLow,
    ],
  );

  const undoBrowseBucketMove = useCallback(
    (modelId?: number) => {
      const pending = browseBucketUndo;
      if (!pending) return;
      if (modelId != null && pending.modelId !== modelId) return;
      if (browseBucketUndoTimerRef.current !== null) {
        window.clearTimeout(browseBucketUndoTimerRef.current);
        browseBucketUndoTimerRef.current = null;
      }
      setBrowseGhostIds((prev) => {
        if (!prev.has(pending.modelId)) return prev;
        const next = new Set(prev);
        next.delete(pending.modelId);
        return next;
      });
      setBrowseBucketUndo(null);
      browseHiddenIdsRef.current.delete(pending.modelId);
      // Restore to Browse (clears Maybe/Archive on disk).
      moveToBucketRef.current(pending.flaggedItem, 'none');
      flashStatusNotice(
        `Restored ${pending.name} to Browse.`,
      );
    },
    [browseBucketUndo, flashStatusNotice],
  );

  /**
   * Move a model between the Browse / Maybe / Archive buckets. Maybe and Archive
   * are mutually exclusive (mirrors the main-process behaviour); `'none'` means
   * "back to Browse". Updates Browse immediately, persists in the background.
   *
   * From Browse, Maybe/Archive keep a ghost card in the same grid slot briefly
   * so the next card does not slide under the cursor — Undo restores it.
   */
  const moveToBucket = useCallback(
    (item: CivitaiModelCardDto, bucket: 'none' | 'maybe' | 'archive') => {
      const nextArchived = bucket === 'archive';
      const nextMaybe = bucket === 'maybe';
      const previous = {
        items: itemsRef.current,
        archiveItems: archiveItemsRef.current,
        maybeItems: maybeItemsRef.current,
      };
      localPatchesRef.current.set(item.id, {
        archived: nextArchived,
        maybe: nextMaybe,
      });
      const flagged = withCardFlags(item, {
        archived: nextArchived,
        maybe: nextMaybe,
      });

      // Browse is unsorted-only — Maybe/Archive never stay on the main grid.
      const keepInBrowse = bucket === 'none';

      // Leaving Browse via Maybe/Archive: hold the slot as a ghost + undo.
      const holdGhost =
        !keepInBrowse &&
        tab === 'browse' &&
        (bucket === 'maybe' || bucket === 'archive');

      if (holdGhost) {
        // Finalize any previous ghost so we only keep one undo / one held slot.
        const prior = browseBucketUndoRef.current;
        if (prior && prior.modelId !== item.id) {
          finalizeBrowseGhost(prior.modelId, { topUp: false });
        }
        setBrowseGhostIds((prev) => {
          const next = new Set(prev);
          next.add(item.id);
          return next;
        });
        setBrowseBucketUndo({
          modelId: item.id,
          name: item.name,
          bucket,
          flaggedItem: flagged,
        });
        if (browseBucketUndoTimerRef.current !== null) {
          window.clearTimeout(browseBucketUndoTimerRef.current);
        }
        const ghostId = item.id;
        browseBucketUndoTimerRef.current = window.setTimeout(() => {
          browseBucketUndoTimerRef.current = null;
          finalizeBrowseGhost(ghostId);
        }, 8000);
      }

      if (bucket === 'none') {
        browseHiddenIdsRef.current.delete(item.id);
        setBrowseGhostIds((ghosts) => {
          if (!ghosts.has(item.id)) return ghosts;
          const nextGhosts = new Set(ghosts);
          nextGhosts.delete(item.id);
          return nextGhosts;
        });
        setBrowseBucketUndo((undo) =>
          undo?.modelId === item.id ? null : undo,
        );
      }

      // Sync browse update — startTransition made spam-clicks feel ~1s laggy.
      setItems((prev) => {
        if (!keepInBrowse && !holdGhost) {
          browseHiddenIdsRef.current.add(item.id);
          const next = prev.filter((card) => card.id !== item.id);
          itemsRef.current = next;
          return next;
        }
        const next = prev.map((card) =>
          card.id === item.id ? flagged : card,
        );
        itemsRef.current = next;
        return next;
      });

      if (!keepInBrowse && !holdGhost && tab === 'browse') {
        const remaining = itemsRef.current.filter((card) =>
          matchesCardArchitecture(
            card.baseModel,
            architectures,
            sdxlFamily,
            enabledSdxlFamilies,
          ),
        ).length;
        void topUpBrowseIfLow(remaining);
      }

      // Keep Maybe/Archive lists in sync on every move so tab badges stay truthful
      // even while still on Browse (lists hydrate in the background).
      setArchiveItems((prev) => {
        const without = prev.filter((card) => card.id !== item.id);
        return nextArchived ? [flagged, ...without] : without;
      });
      setMaybeItems((prev) => {
        const without = prev.filter((card) => card.id !== item.id);
        return nextMaybe ? [flagged, ...without] : without;
      });
      setShelfSummaries((prev) => {
        const summary = cardToShelfSummary(flagged);
        const withoutArchived = (prev?.archived ?? []).filter(
          (row) => row.id !== item.id,
        );
        const withoutMaybe = (prev?.maybe ?? []).filter(
          (row) => row.id !== item.id,
        );
        return {
          downloaded: prev?.downloaded ?? [],
          archived: nextArchived ? [summary, ...withoutArchived] : withoutArchived,
          maybe: nextMaybe ? [summary, ...withoutMaybe] : withoutMaybe,
        };
      });

      // Unlock pins re-inject Browse cards after shelve unless dismissed here.
      if (bucket === 'archive' || bucket === 'maybe') {
        void dismissRecentlyUnlocked(item.id);
      }

      void (async () => {
        try {
          if (bucket === 'archive') {
            await window.wcm.civitai.archiveModel(item.id);
          } else if (bucket === 'maybe') {
            await window.wcm.civitai.maybeModel(item.id);
          } else if (item.archived) {
            await window.wcm.civitai.unarchiveModel(item.id);
          } else if (item.maybe) {
            await window.wcm.civitai.unmaybeModel(item.id);
          }
          localPatchesRef.current.delete(item.id);
          // Reconcile tab lists from disk so a stale Maybe entry cannot linger
          // after Archive (and vice versa).
          if (bucket === 'archive' || bucket === 'maybe') {
            void loadArchive();
            void loadMaybe();
          }
        } catch (e) {
          localPatchesRef.current.delete(item.id);
          browseHiddenIdsRef.current.delete(item.id);
          setBrowseGhostIds((prev) => {
            if (!prev.has(item.id)) return prev;
            const next = new Set(prev);
            next.delete(item.id);
            return next;
          });
          setBrowseBucketUndo((undo) =>
            undo?.modelId === item.id ? null : undo,
          );
          if (browseBucketUndoTimerRef.current !== null) {
            window.clearTimeout(browseBucketUndoTimerRef.current);
            browseBucketUndoTimerRef.current = null;
          }
          setItems(previous.items);
          setArchiveItems(previous.archiveItems);
          setMaybeItems(previous.maybeItems);
          flashStatusError(e instanceof Error ? e.message : String(e));
        }
      })();
    },
    [
      architectures,
      dismissRecentlyUnlocked,
      finalizeBrowseGhost,
      flashStatusError,
      loadArchive,
      loadMaybe,
      sdxlFamily,
      enabledSdxlFamilies,
      tab,
      topUpBrowseIfLow,
    ],
  );
  moveToBucketRef.current = moveToBucket;

  const markInstalled = async (item: CivitaiModelCardDto) => {
    const previousBrowse = items;
    const patched = withCardFlags(item, {
      installed: true,
      latestVersionInstalled: true,
      hasUninstalledVersion: false,
      hasDownloadableVersion: false,
      markedInstalled: true,
    });
    localPatchesRef.current.set(item.id, {
      installed: true,
      latestVersionInstalled: true,
      hasUninstalledVersion: false,
      hasDownloadableVersion: false,
      markedInstalled: true,
    });
    setItems((prev) => {
      browseHiddenIdsRef.current.add(item.id);
      return prev.filter((card) => card.id !== item.id);
    });
    setDownloadedItems((prev) =>
      prev.some((card) => card.id === item.id)
        ? prev.map((card) => (card.id === item.id ? patched : card))
        : [...prev, patched].sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
          ),
    );
    void dismissRecentlyUnlocked(item.id);
    try {
      await window.wcm.civitai.markInstalled(item.id);
      localPatchesRef.current.delete(item.id);
      flashStatusNotice(`Marked ${item.name} as downloaded.`);
    } catch (e) {
      localPatchesRef.current.delete(item.id);
      browseHiddenIdsRef.current.delete(item.id);
      setItems(previousBrowse);
      setDownloadedItems((prev) =>
        prev.filter((card) => card.id !== item.id),
      );
      flashStatusError(e instanceof Error ? e.message : String(e));
    }
  };

  const unmarkInstalled = async (item: CivitaiModelCardDto) => {
    const previousBrowse = items;
    const previousDownloaded = downloadedItems;
    localPatchesRef.current.set(item.id, {
      installed: false,
      latestVersionInstalled: false,
      hasUninstalledVersion: true,
      markedInstalled: false,
    });
    setItems((prev) =>
      prev.map((card) =>
        card.id === item.id
          ? withCardFlags(card, {
              installed: false,
              latestVersionInstalled: false,
              hasUninstalledVersion: true,
              markedInstalled: false,
            })
          : card,
      ),
    );
    setDownloadedItems((prev) => prev.filter((card) => card.id !== item.id));
    try {
      await window.wcm.civitai.unmarkInstalled(item.id);
      localPatchesRef.current.delete(item.id);
      flashStatusNotice(`Unmarked ${item.name} as downloaded.`);
      void loadDownloaded();
    } catch (e) {
      localPatchesRef.current.delete(item.id);
      setItems(previousBrowse);
      setDownloadedItems(previousDownloaded);
      flashStatusError(e instanceof Error ? e.message : String(e));
    }
  };

  const blockAuthor = async (item: CivitaiModelCardDto) => {
    const creator = item.creator?.trim();
    if (!creator) {
      flashStatusError('This card has no author to block.');
      return;
    }
    const key = creator.toLowerCase();
    const matchesAuthor = (card: CivitaiModelCardDto) =>
      (card.creator ?? '').trim().toLowerCase() === key;

    const previousBrowse = items;
    const previousPreview = selectedPreview;

    const hideIds: number[] = [];
    for (const card of items) {
      if (matchesAuthor(card)) hideIds.push(card.id);
    }
    for (const id of hideIds) browseHiddenIdsRef.current.add(id);

    setItems((prev) => prev.filter((card) => !matchesAuthor(card)));
    if (
      selectedPreview &&
      hideIds.includes(selectedPreview.modelId)
    ) {
      setSelectedPreview(null);
    }

    try {
      await window.wcm.civitai.blockCreator(creator);
      flashStatusNotice(
        `Blocked ${creator}. Hidden from Browse — manage in Settings → Civitai.`,
      );
      void topUpBrowseIfLow(
        itemsRef.current.filter((card) =>
          matchesCardArchitecture(
            card.baseModel,
            architectures,
            sdxlFamily,
            enabledSdxlFamilies,
          ),
        ).length,
      );
    } catch (e) {
      for (const id of hideIds) browseHiddenIdsRef.current.delete(id);
      setItems(previousBrowse);
      setSelectedPreview(previousPreview);
      flashStatusError(e instanceof Error ? e.message : String(e));
    }
  };

  const openCardMenu = (
    item: CivitaiModelCardDto,
    event: ReactMouseEvent,
    context: CivitaiCardMenuContext,
    typeHint?: CivitaiModelTypeDto,
  ) => {
    setCardContextMenu(openCivitaiCardContextMenu(item, event, context, typeHint));
  };

  const watchForNotify = async (item: CivitaiModelCardDto) => {
    const previousBrowse = items;
    const previousWatchlist = watchlist;
    const watchingCard = withCardFlags(item, { watching: true });
    const optimisticEntry: WatchedCivitaiModelDto = {
      origin,
      modelId: item.id,
      modelName: item.name,
      type,
      versionId: item.versionId,
      earlyAccessEndsAt: item.earlyAccessEndsAt,
      available: !item.earlyAccess,
      addedAt: new Date().toISOString(),
      card: watchingCard,
    };
    localPatchesRef.current.set(item.id, { watching: true });
    browseHiddenIdsRef.current.add(item.id);
    setItems((prev) => prev.filter((card) => card.id !== item.id));
    setWatchlist((prev) =>
      prev.some((entry) => entry.modelId === item.id)
        ? prev
        : [optimisticEntry, ...prev],
    );
    try {
      await window.wcm.civitai.watchModel({
        modelId: item.id,
        modelName: item.name,
        type: type,
        versionId: item.versionId,
        earlyAccessEndsAt: item.earlyAccessEndsAt,
      });
      // Keep watching:true until the next catalog hydrate — Browse membership
      // also keys off watchlist, but patches cover in-flight reloads.
      flashStatusNotice(
        `Watching ${item.name} — it will return to Browse when available.`,
      );
    } catch (e) {
      localPatchesRef.current.delete(item.id);
      browseHiddenIdsRef.current.delete(item.id);
      setItems(previousBrowse);
      setWatchlist(previousWatchlist);
      flashStatusError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeWatch = async (modelId: number) => {
    // Keep remaining cards' previews: drop only this row optimistically, then
    // sync from the hydrated DTO list (not the raw settings rows).
    setWatchlist((prev) => prev.filter((entry) => entry.modelId !== modelId));
    try {
      setWatchlist(await window.wcm.civitai.unwatchModel(modelId));
      if (tab === 'browse') void loadCatalog();
    } catch (e) {
      void loadWatchlist();
      flashStatusError(e instanceof Error ? e.message : String(e));
    }
  };

  const applyWatchlistRefresh = useCallback(
    (result: {
      items: WatchedCivitaiModelDto[];
      newlyAvailable: WatchedCivitaiModelDto[];
    }) => {
      setWatchlist(result.items);
      setTabListReady((prev) =>
        prev.notify ? prev : { ...prev, notify: true },
      );
      if (result.newlyAvailable.length === 0) return;
      const unlockedIds = new Set(
        result.newlyAvailable.map((entry) => entry.modelId),
      );
      for (const entry of result.newlyAvailable) {
        browseHiddenIdsRef.current.delete(entry.modelId);
        localPatchesRef.current.delete(entry.modelId);
      }
      // Notify unlock clears Archive/Maybe server-side — drop local shelf lists.
      setArchiveItems((prev) =>
        prev.filter((card) => !unlockedIds.has(card.id)),
      );
      setMaybeItems((prev) => prev.filter((card) => !unlockedIds.has(card.id)));
      const names = result.newlyAvailable
        .map((m) => m.modelName)
        .slice(0, 3)
        .join(', ');
      const more =
        result.newlyAvailable.length > 3
          ? ` (+${result.newlyAvailable.length - 3} more)`
          : '';
      flashStatusNotice(
        `Just unlocked (pinned in Browse + Notify): ${names}${more}`,
      );
      void loadRecentlyUnlocked();
      // Pin unlocked cards at the front of Browse immediately — catalog sort
      // often buries older models that only just left early access.
      const unlockedCards = result.newlyAvailable
        .map((e) => e.card)
        .filter((c): c is CivitaiModelCardDto => Boolean(c))
        .map((c) => ({
          ...c,
          archived: false,
          maybe: false,
          watching: false,
          earlyAccess: false,
        }));
      if (unlockedCards.length > 0) {
        setItems((prev) => {
          const cleared = prev.map((card) =>
            unlockedIds.has(card.id)
              ? {
                  ...card,
                  archived: false,
                  maybe: false,
                  watching: false,
                  earlyAccess: false,
                }
              : card,
          );
          const seen = new Set(cleared.map((c) => c.id));
          const pinned = unlockedCards.filter((c) => !seen.has(c.id));
          const next = [...pinned, ...cleared];
          itemsRef.current = next;
          return next;
        });
      } else if (tab === 'browse') {
        void loadCatalog();
      }
    },
    [flashStatusNotice, loadCatalog, loadRecentlyUnlocked, tab],
  );

  const refreshNotify = async (opts?: { quietIfEmpty?: boolean }) => {
    setBusy(true);
    try {
      const result = await window.wcm.civitai.refreshWatchlist({
        allowPageScrape: true,
      });
      applyWatchlistRefresh(result);
      if (
        result.newlyAvailable.length === 0 &&
        !opts?.quietIfEmpty
      ) {
        flashStatusNotice('Still early access — nothing new to show in Browse.');
      }
    } catch (e) {
      flashStatusError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Auto-check the watchlist so unlocked models return to Browse without
  // visiting the Notify tab.
  useEffect(() => {
    if (!filtersReady) return;
    let cancelled = false;
    const run = async (quiet: boolean) => {
      try {
        const result = await window.wcm.civitai.refreshWatchlist({
          allowPageScrape: false,
        });
        if (cancelled) return;
        applyWatchlistRefresh(result);
        if (!quiet && result.newlyAvailable.length === 0) {
          // Opening refresh stays quiet when nothing changed.
        }
      } catch {
        // Background check — ignore transient API errors.
      }
    };
    void run(true);
    const timer = window.setInterval(() => void run(true), 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyWatchlistRefresh, filtersReady, origin]);


  const renderCardActions = (
    item: CivitaiModelCardDto,
    context: Tab,
    typeHint: CivitaiModelTypeDto | undefined,
    flags: ReturnType<typeof installFlagsForVersions>,
  ) => {
    const dlType = typeHint ?? type;
    // Bell only for a version of this base model that is still gated and not
    // on disk. A downloaded Krea 2 file, or an Illustrious sibling, is not Notify.
    const stillEarlyAccess = flags.notifyEarlyAccess;
    const showDownload =
      flags.hasDownloadableVersion && !flags.latestVersionInstalled;
    const showNotify = stillEarlyAccess;
    const showMarkInstalled =
      !item.installed && item.potentialLocalMatches.length > 0;
    const showUnmarkInstalled = item.markedInstalled;
    const localMatches = item.localInstallMatches ?? [];
    const showRevealLocal = localMatches.length > 0;
    const primaryLocalMatch = localMatches[0] ?? null;
    const downloading = activeDownloadId === item.id;
    const queued = queuedIds.has(item.id);
    const downloadBusy = downloading || queued;

    return (
      <div className="civitai-card-actions">
        {showNotify ? (
          <button
            type="button"
            className="civitai-icon-btn action-notify"
            title="Notify me when early access ends"
            aria-label="Notify me"
            onClick={() => void watchForNotify(item)}
          >
            <Bell size={20} />
          </button>
        ) : null}
        {showDownload ? (
          <button
            type="button"
            className="civitai-icon-btn action-download"
            title={
              downloading
                ? 'Downloading…'
                : queued
                  ? 'Queued'
                  : stillEarlyAccess || item.hasUninstalledVersion
                    ? 'Download version · Shift+click skips options'
                    : 'Download · Shift+click skips options'
            }
            aria-label={
              downloading
                ? 'Downloading'
                : queued
                  ? 'Queued'
                  : stillEarlyAccess || item.hasUninstalledVersion
                    ? 'Download version'
                    : 'Download'
            }
            disabled={downloadBusy || !canDownloadFor(dlType)}
            onClick={(event) =>
              requestDownload(
                { ...item, typeHint: dlType },
                { skipConfirm: event.shiftKey },
              )
            }
          >
            <Download size={20} className={downloading ? 'spin' : undefined} />
          </button>
        ) : null}
        {showMarkInstalled ? (
          <button
            type="button"
            className="civitai-icon-btn action-mark"
            title="Mark as installed (confirm possible local match)"
            aria-label="Mark as installed"
            onClick={() => void markInstalled(item)}
          >
            <CheckCircle2 size={20} />
          </button>
        ) : null}
        {showUnmarkInstalled ? (
          <button
            type="button"
            className="civitai-icon-btn action-unmark"
            title="Unmark installed"
            aria-label="Unmark installed"
            onClick={() => void unmarkInstalled(item)}
          >
            <X size={20} />
          </button>
        ) : null}
        {showRevealLocal && primaryLocalMatch ? (
          <button
            type="button"
            className="civitai-icon-btn action-reveal-local"
            title={`Open matched file in ${
              dlType === 'Checkpoint' ? 'Checkpoints' : 'LoRA files'
            }: ${primaryLocalMatch.relativePath}${
              localMatches.length > 1
                ? ` (+${localMatches.length - 1} more)`
                : ''
            } (${primaryLocalMatch.via})`}
            aria-label="Open matched local file"
            onClick={(event) => {
              event.stopPropagation();
              void window.wcm.civitai
                .revealLocalFile({
                  type: dlType,
                  relativePath: primaryLocalMatch.relativePath,
                })
                .catch((e) => {
                  flashStatusError(
                    e instanceof Error ? e.message : String(e),
                  );
                });
            }}
          >
            <FolderOpen size={20} />
          </button>
        ) : null}
        {context === 'archive' ? (
          <>
            <button
              type="button"
              className="civitai-icon-btn action-maybe"
              title="Move to Maybe"
              aria-label="Move to Maybe"
              onClick={() => void moveToBucket(item, 'maybe')}
            >
              <Bookmark size={20} />
            </button>
            <button
              type="button"
              className="civitai-icon-btn action-archive"
              title="Restore to Browse"
              aria-label="Restore to Browse"
              onClick={() => void moveToBucket(item, 'none')}
            >
              <ArchiveRestore size={20} />
            </button>
          </>
        ) : context === 'maybe' ? (
          <>
            <button
              type="button"
              className="civitai-icon-btn action-maybe"
              title="Remove from Maybe"
              aria-label="Remove from Maybe"
              onClick={() => void moveToBucket(item, 'none')}
            >
              <BookmarkMinus size={20} />
            </button>
            <button
              type="button"
              className="civitai-icon-btn action-archive"
              title="Move to Archive"
              aria-label="Move to Archive"
              onClick={() => void moveToBucket(item, 'archive')}
            >
              <Archive size={20} />
            </button>
          </>
        ) : context === 'queued' ? (
          <button
            type="button"
            className="civitai-icon-btn action-archive"
            title={
              downloading ? 'Cancel download' : 'Remove from download queue'
            }
            aria-label={
              downloading ? 'Cancel download' : 'Remove from download queue'
            }
            onClick={() => void cancelQueuedDownload(item.id)}
          >
            <X size={20} />
          </button>
        ) : (
          <>
            <button
              type="button"
              className="civitai-icon-btn action-maybe"
              title={item.maybe ? 'Remove from Maybe' : 'Maybe later'}
              aria-label={item.maybe ? 'Remove from Maybe' : 'Maybe later'}
              onClick={() =>
                void moveToBucket(item, item.maybe ? 'none' : 'maybe')
              }
            >
              {item.maybe ? (
                <BookmarkMinus size={20} />
              ) : (
                <Bookmark size={20} />
              )}
            </button>
            <button
              type="button"
              className="civitai-icon-btn action-archive"
              title={item.archived ? 'Unarchive' : 'Archive'}
              aria-label={item.archived ? 'Unarchive' : 'Archive'}
              onClick={() =>
                void moveToBucket(item, item.archived ? 'none' : 'archive')
              }
            >
              {item.archived ? (
                <ArchiveRestore size={20} />
              ) : (
                <Archive size={20} />
              )}
            </button>
          </>
        )}
        <button
          type="button"
          className="civitai-icon-btn action-open"
          title="Open in external browser"
          aria-label="Open in external browser"
          onClick={(event) => {
            event.stopPropagation();
            void window.wcm.civitai.openModelPage(item.id, item.name);
          }}
        >
          <ExternalLink size={20} />
        </button>
      </div>
    );
  };

  const showCategoryMeta = category == null;
  const showFamilyMeta =
    architectures.includes('sdxl') && sdxlFamily === 'all';

  const renderModelCard = (
    item: CivitaiModelCardDto,
    context: Tab,
    typeHint?: CivitaiModelTypeDto,
  ) => {
    if (context === 'browse' && browseGhostIds.has(item.id)) {
      const bucketLabel = item.archived ? 'Archive' : 'Maybe';
      return (
        <article
          key={item.id}
          className="civitai-card civitai-card-bucket-ghost"
          aria-label={`${item.name} moved to ${bucketLabel}`}
        >
          <div className="civitai-bucket-ghost-body">
            <strong title={item.name}>{item.name}</strong>
            <span className="civitai-bucket-ghost-label">
              Moved to {bucketLabel}
            </span>
            <button
              type="button"
              className="civitai-bucket-ghost-undo"
              onClick={(event) => {
                event.stopPropagation();
                undoBrowseBucketMove(item.id);
              }}
            >
              <Undo2 size={14} /> Undo
            </button>
          </div>
        </article>
      );
    }
    const versionRows = filterVersionInstallsForContext(
      item.versionInstalls,
      architectures,
      sdxlFamily,
      enabledSdxlFamilies,
    );
    const chipFlags = contextInstallFlags(
      item,
      architectures,
      sdxlFamily,
      enabledSdxlFamilies,
    );
    const publishedLabel = item.publishedAt
      ? formatCardPublishedAt(item.publishedAt)
      : null;
    return (
    <article
      key={item.id}
      className={cardClassName(
        item,
        activeDownloadId,
        queuedIds,
        selectedPreview?.modelId ?? null,
        chipFlags,
      )}
      onContextMenu={(event) => openCardMenu(item, event, context, typeHint)}
    >
      <div
        className="civitai-thumb"
        role="button"
        tabIndex={0}
        title="Preview on Civitai"
        onClick={() => selectPreview(item.pageUrl, item.id, item.name)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectPreview(item.pageUrl, item.id, item.name);
          }
        }}
      >
        <CivitaiPreviewThumb
          modelId={item.id}
          url={item.previewUrl}
          customUrl={item.customPreviewUrl}
          onPreviewUrlChange={notePreviewUrlChange}
        />
        {chipFlags.updateAvailable ? (
          <span className="civitai-card-update-badge" title="Newer version available">
            Update
          </span>
        ) : null}
        <CardMetaOverlay
          categoryId={
            showCategoryMeta ? categoryIdFromTags(item.tags) : null
          }
          familyId={
            showFamilyMeta ? sdxlFamilyBadgeId(item.baseModel) : null
          }
        />
      </div>
      <div className="civitai-card-body">
        <strong title={item.name}>{item.name}</strong>
        <small>{item.creator ?? item.type}</small>
        {publishedLabel && item.publishedAt ? (
          <small
            className="civitai-card-date"
            title={publishedAtTitle(item.publishedAt, Date.now())}
          >
            {publishedLabel}
          </small>
        ) : null}
        {versionRows.length > 1 ||
        (context === 'downloaded' && versionRows.length > 0) ? (
          <ul className="civitai-version-list">
            {versionRows.map((v) => (
              <li
                key={`${item.id}-${v.versionId}-${v.fileId ?? v.fileName ?? 'f'}`}
                className={
                  v.installed
                    ? 'civitai-version-row installed'
                    : v.earlyAccess
                      ? 'civitai-version-row early-access'
                      : 'civitai-version-row missing'
                }
              >
                <span
                  className="civitai-version-label"
                  title={v.fileName ?? v.versionName}
                >
                  {v.variantLabel
                    ? `${v.versionName} · ${v.variantLabel}`
                    : v.versionName}
                  {v.earlyAccess ? ' · EA' : ''}
                  {!v.variantLabel &&
                  v.fileName &&
                  v.fileName !== v.versionName
                    ? ` · ${v.fileName}`
                    : ''}
                </span>
                {v.installed ? (
                  <span className="civitai-version-status" title="On disk">
                    ✓
                  </span>
                ) : v.earlyAccess ? (
                  <span
                    className="civitai-version-status"
                    title="Early access — notify from the bell when ready"
                  >
                    🔒
                  </span>
                ) : (
                  <button
                    type="button"
                    className="civitai-version-dl"
                    title={`Download ${v.versionName}`}
                    disabled={
                      activeDownloadId === item.id ||
                      queuedIds.has(item.id) ||
                      !canDownloadFor(typeHint ?? type)
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      requestDownload({
                        ...item,
                        versionId: v.versionId,
                        fileName: v.fileName ?? item.fileName,
                        typeHint: typeHint ?? type,
                      });
                    }}
                  >
                    <Download size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : item.versionName ? (
          <p className="civitai-version-single" title={item.fileName}>
            {item.versionName}
            {item.installed ? ' · on disk' : ''}
            {item.earlyAccess ? ' · early access' : ''}
          </p>
        ) : null}
        {item.potentialLocalMatches.length > 0 ? (
          <p className="civitai-match-hint">
            Possible local match:{' '}
            <code>{item.potentialLocalMatches[0]?.relativePath}</code>
            {item.potentialLocalMatches.length > 1
              ? ` (+${item.potentialLocalMatches.length - 1} more)`
              : ''}
          </p>
        ) : null}
        {renderCardActions(item, context, typeHint, chipFlags)}
      </div>
    </article>
    );
  };

  const queuedCount = queuedDownloads.length;
  const isDownloading = activeDownloadId !== null || queuedCount > 0;
  const isSyncing = catalogSync?.status === 'syncing';
  const catalogCachedCount =
    catalogSync?.totalCached ?? catalogMeta?.totalCached ?? 0;
  const newArrivalLabel = (count: number) => {
    const bits = [`+${count.toLocaleString()} new`];
    if (architectures[0] === 'sdxl' && sdxlFamily !== 'all') {
      bits.push(familyMetaLabel(sdxlFamily));
    }
    if (category) {
      const label =
        CATEGORY_META_ICONS[category as CivitaiModelCategoryId]?.label;
      if (label) bits.push(label);
    }
    return bits.join(' · ');
  };
  const activeCatalogStatusText = isSyncing
    ? catalogSync?.mode === 'incremental'
      ? catalogSync.addedThisRun > 0
        ? `Checking for new models… ${newArrivalLabel(catalogSync.addedThisRun)}`
        : 'Checking for new models…'
      : catalogSync
        ? (() => {
            const pages = catalogSync.pagesFetched;
            const pageBit =
              pages > 0 ? `page ${pages.toLocaleString()}` : 'starting';
            const received = catalogSync.lastPageReceived;
            const pageAdded = catalogSync.lastPageAdded;
            const pageDetail =
              typeof received === 'number' && pages > 0
                ? ` · +${(pageAdded ?? 0).toLocaleString()}/${received.toLocaleString()} this page`
                : '';
            const runBit =
              catalogSync.addedThisRun > 0
                ? ` · ${newArrivalLabel(catalogSync.addedThisRun)}`
                : '';
            // First-time / incomplete backfill — resumes from saved cursor.
            return `Backfilling catalog… ${pageBit}${pageDetail}${runBit} · ${catalogCachedCount.toLocaleString()} indexed`;
          })()
        : null
    : null;
  const busyStatusText = busy
    ? tab === 'notify'
      ? 'Checking availability…'
      : tab === 'browse'
        ? 'Loading catalog…'
        : 'Refreshing…'
    : null;
  // Catalog / hash work still matters while a download is running — don't let
  // the queue swallow “Checking for new models…”.
  const backgroundStatusText =
    (busy && items.length === 0 ? busyStatusText : null) ??
    activeCatalogStatusText ??
    busyStatusText ??
    null;
  const statusMessage =
    statusError ?? statusNotice ?? backgroundStatusText ?? '';
  const statusTone = statusError
    ? 'error'
    : isDownloading || statusNotice
      ? 'notice'
      : 'idle';

  const filteredDownloadedItems = useMemo(() => {
    const filtered = downloadedItems.filter(
      (item) =>
        matchesModelType(item.type, type) &&
        matchesCardQuery(item, query) &&
        matchesCardCategory(item.tags, category, enabledCivitaiCategories) &&
        (!cardHasBaseModelEvidence(item) ||
          matchesCardOrVersionArchitecture(
            item,
            architectures,
            sdxlFamily,
            enabledSdxlFamilies,
          )),
    );
    const sorted = sortCardsByLocalSort(filtered, sort);
    return sortCardsWithUpdatesFirst(
      sorted,
      architectures,
      sdxlFamily,
      enabledSdxlFamilies,
    );
  }, [
    architectures,
    category,
    downloadedItems,
    enabledCivitaiCategories,
    query,
    sdxlFamily,
    enabledSdxlFamilies,
    sort,
    type,
  ]);

  const filteredQueuedItems = useMemo(
    () =>
      // Queued is the only tab that ignores Browse category / type /
      // architecture filters — badge count and grid must stay in sync.
      queuedCards.filter(
        (item) =>
          queuedIds.has(item.id) && matchesCardQuery(item, query),
      ),
    [query, queuedCards, queuedIds],
  );

  const filteredArchiveItems = useMemo(
    () =>
      sortCardsByLocalSort(
        archiveItems.filter(
          (item) =>
            matchesModelType(item.type, type) &&
            matchesCardQuery(item, query) &&
            matchesCardCategory(item.tags, category, enabledCivitaiCategories) &&
            (!cardHasBaseModelEvidence(item) ||
              matchesCardOrVersionArchitecture(
                item,
                architectures,
                sdxlFamily,
                enabledSdxlFamilies,
              )),
        ),
        sort,
      ),
    [
      architectures,
      archiveItems,
      category,
      enabledCivitaiCategories,
      query,
      sdxlFamily,
      enabledSdxlFamilies,
      sort,
      type,
    ],
  );

  const filteredMaybeItems = useMemo(
    () =>
      sortCardsByLocalSort(
        maybeItems.filter(
          (item) =>
            matchesModelType(item.type, type) &&
            matchesCardQuery(item, query) &&
            matchesCardCategory(item.tags, category, enabledCivitaiCategories) &&
            (!cardHasBaseModelEvidence(item) ||
              matchesCardOrVersionArchitecture(
                item,
                architectures,
                sdxlFamily,
                enabledSdxlFamilies,
              )),
        ),
        sort,
      ),
    [
      architectures,
      category,
      enabledCivitaiCategories,
      maybeItems,
      query,
      sdxlFamily,
      enabledSdxlFamilies,
      sort,
      type,
    ],
  );

  const filteredWatchlist = useMemo(
    () =>
      sortWatchlistByTimeLeft(
        watchlist.filter((entry) => {
          // Unlocked models must not linger on Notify.
          if (entry.available) return false;
          if (!matchesModelType(entry.type, type)) return false;
          const card = entry.card;
          if (
            !matchesCardQuery(
              card ?? { name: entry.modelName, modelName: entry.modelName },
              query,
            )
          ) {
            return false;
          }
          // Watchlist rows may lack card details; don't hide them just because
          // category/architecture chips are set for Browse.
          if (!card) return true;
          return (
            matchesCardCategory(card.tags, category, enabledCivitaiCategories) &&
            matchesCardArchitecture(
              card.baseModel,
              architectures,
              sdxlFamily,
              enabledSdxlFamilies,
            )
          );
        }),
      ),
    [
      architectures,
      category,
      enabledCivitaiCategories,
      query,
      sdxlFamily,
      enabledSdxlFamilies,
      type,
      watchlist,
    ],
  );

  /** Tab badges: type + category + base model + family (not search). */
  const tabDownloadedUpdateCount = useMemo(
    () =>
      downloadedItems.filter(
        (item) =>
          // Shelf stubs have no page URL. Their latestVersionInstalled bit is
          // not a match result — counting it flagged current checkpoints.
          Boolean(item.pageUrl) &&
          contextInstallFlags(
            item,
            architectures,
            sdxlFamily,
            enabledSdxlFamilies,
          ).updateAvailable &&
          matchesTabChipFilters(
            item,
            type,
            category,
            architectures,
            sdxlFamily,
            enabledCivitaiCategories,
            enabledSdxlFamilies,
          ),
      ).length,
    [
      architectures,
      category,
      downloadedItems,
      enabledCivitaiCategories,
      enabledSdxlFamilies,
      sdxlFamily,
      type,
    ],
  );

  const tabDownloadedCount = useMemo(
    () =>
      preferredShelfRows(shelfSummaries?.downloaded, downloadedItems).filter(
        (item) =>
          matchesTabChipFilters(
            item,
            type,
            category,
            architectures,
            sdxlFamily,
            enabledCivitaiCategories,
            enabledSdxlFamilies,
          ),
      ).length,
    [
      architectures,
      category,
      downloadedItems,
      enabledCivitaiCategories,
      enabledSdxlFamilies,
      sdxlFamily,
      shelfSummaries,
      type,
    ],
  );

  const tabMaybeCount = useMemo(
    () =>
      preferredShelfRows(shelfSummaries?.maybe, maybeItems).filter((item) =>
        matchesTabChipFilters(
          item,
          type,
          category,
          architectures,
          sdxlFamily,
          enabledCivitaiCategories,
          enabledSdxlFamilies,
        ),
      ).length,
    [
      architectures,
      category,
      enabledCivitaiCategories,
      enabledSdxlFamilies,
      maybeItems,
      sdxlFamily,
      shelfSummaries,
      type,
    ],
  );

  const tabArchiveCount = useMemo(
    () =>
      preferredShelfRows(shelfSummaries?.archived, archiveItems).filter((item) =>
        matchesTabChipFilters(
          item,
          type,
          category,
          architectures,
          sdxlFamily,
          enabledCivitaiCategories,
          enabledSdxlFamilies,
        ),
      ).length,
    [
      architectures,
      archiveItems,
      category,
      enabledCivitaiCategories,
      enabledSdxlFamilies,
      sdxlFamily,
      shelfSummaries,
      type,
    ],
  );

  const tabWatchlistForChips = useMemo(
    () =>
      watchlist.filter((entry) => {
        if (entry.available) return false;
        if (!matchesModelType(entry.type, type)) return false;
        const card = entry.card;
        if (!card) {
          // No details yet — only count under "All" categories.
          return category === null;
        }
        return matchesTabChipFilters(
          card,
          type,
          category,
          architectures,
          sdxlFamily,
          enabledCivitaiCategories,
          enabledSdxlFamilies,
        );
      }),
    [
      architectures,
      category,
      enabledCivitaiCategories,
      enabledSdxlFamilies,
      sdxlFamily,
      type,
      watchlist,
    ],
  );

  const tabNotifyCount = tabWatchlistForChips.length;

  const browseItems = useMemo(() => {
    const archivedIds = new Set(
      preferredShelfRows(shelfSummaries?.archived, archiveItems).map(
        (c) => c.id,
      ),
    );
    const maybeIds = new Set(
      preferredShelfRows(shelfSummaries?.maybe, maybeItems).map((c) => c.id),
    );
    const watchingIds = new Set(watchlist.map((e) => e.modelId));
    for (const [id, patch] of localPatchesRef.current) {
      if (patch.archived) archivedIds.add(id);
      if (patch.maybe) maybeIds.add(id);
      if (patch.watching === true) watchingIds.add(id);
      if (patch.watching === false) watchingIds.delete(id);
    }

    const matchesBrowseFilters = (item: CivitaiModelCardDto) => {
      // Ghost cards keep a Browse slot briefly after Maybe/Archive (undo).
      const isGhost = browseGhostIds.has(item.id);
      if (!isGhost) {
        const archived = item.archived || archivedIds.has(item.id);
        const maybe = item.maybe || maybeIds.has(item.id);
        const watching = item.watching || watchingIds.has(item.id);
        // Browse = unsorted only. Sorted shelves never stay on the main grid.
        if (archived) return false;
        if (maybe) return false;
        if (watching) return false;
        if (item.installed) return false;
      }
      return (
        !queuedIds.has(item.id) &&
        matchesCardCategory(item.tags, null, enabledCivitaiCategories) &&
        matchesCardOrVersionArchitecture(
          item,
          architectures,
          sdxlFamily,
          enabledSdxlFamilies,
        )
      );
    };

    const base = items.filter(matchesBrowseFilters);
    const seen = new Set(base.map((c) => c.id));
    const pinned = recentlyUnlocked
      .filter((e) => matchesModelType(e.type, type))
      // Unlock pins never bypass Maybe/Archive/Notify — dismiss handles persistence.
      .filter(
        (e) =>
          !archivedIds.has(e.modelId) &&
          !maybeIds.has(e.modelId) &&
          !watchingIds.has(e.modelId),
      )
      .map((e) => {
        // Prefer the live Browse/Downloaded card so install state wins over a
        // stale unlock snapshot that forced “downloadable”.
        const live =
          items.find((c) => c.id === e.modelId) ??
          downloadedItems.find((c) => c.id === e.modelId);
        return live ?? e.card;
      })
      .filter((c): c is CivitaiModelCardDto => Boolean(c))
      .filter((c) => !seen.has(c.id) && matchesBrowseFilters(c));
    return pinned.length > 0 ? [...pinned, ...base] : base;
  }, [
    archiveItems,
    architectures,
    browseGhostIds,
    downloadedItems,
    enabledCivitaiCategories,
    items,
    maybeItems,
    queuedIds,
    recentlyUnlocked,
    sdxlFamily,
    enabledSdxlFamilies,
    shelfSummaries,
    type,
    watchlist,
  ]);

  /**
   * Archive only what the Browse grid is rendering right now.
   * Never scans the catalog index. Never archives family-filtered-away cards.
   */
  const archiveShownCards = useCallback(() => {
    if (!category || tab !== 'browse') return;

    // Snapshot the exact cards on screen — same array `.map` uses for the grid.
    const shown = browseItems.filter(
      (card) =>
        !card.archived &&
        !card.maybe &&
        !card.installed &&
        !card.watching &&
        matchesCardArchitecture(
            card.baseModel,
            architectures,
            sdxlFamily,
            enabledSdxlFamilies,
          ),
    );
    if (shown.length === 0) {
      flashStatusNotice(
        'Nothing to archive among the cards on screen — Maybe and installed are kept.',
      );
      return;
    }

    const eligibleIds = shown.map((card) => card.id);
    const eligibleIdSet = new Set(eligibleIds);
    const previousItems = items;
    for (const id of eligibleIds) browseHiddenIdsRef.current.add(id);

    // Update items + ref synchronously so top-up sees an empty/sparse grid
    // (startTransition left itemsRef stale and skipped the refill).
    const nextItems = itemsRef.current.filter(
      (card) => !eligibleIdSet.has(card.id),
    );
    itemsRef.current = nextItems;
    setItems(nextItems);
    setArchiveItems((prev) => {
      const byId = new Map(prev.map((card) => [card.id, card]));
      for (const card of shown) {
        byId.set(
          card.id,
          withCardFlags(card, { archived: true, maybe: false }),
        );
      }
      return [...byId.values()];
    });
    setMaybeItems((prev) => prev.filter((card) => !eligibleIdSet.has(card.id)));

    void (async () => {
      try {
        setBusy(true);
        const result = await window.wcm.civitai.archiveModels(eligibleIds);
        flashStatusNotice(
          result.archivedCount > 0
            ? `Archived ${result.archivedCount.toLocaleString()} on-screen model${result.archivedCount === 1 ? '' : 's'}`
            : 'Nothing new to archive.',
        );
        void loadArchive();
        const remaining = itemsRef.current.filter((card) =>
          matchesCardArchitecture(
            card.baseModel,
            architectures,
            sdxlFamily,
            enabledSdxlFamilies,
          ),
        ).length;
        await topUpBrowseIfLow(remaining);
      } catch (e) {
        for (const id of eligibleIds) browseHiddenIdsRef.current.delete(id);
        itemsRef.current = previousItems;
        setItems(previousItems);
        void loadArchive();
        void loadMaybe();
        flashStatusError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  }, [
    architectures,
    browseItems,
    category,
    flashStatusNotice,
    flashStatusError,
    items,
    loadArchive,
    loadMaybe,
    sdxlFamily,
    enabledSdxlFamilies,
    tab,
    topUpBrowseIfLow,
  ]);

  // Reset loaded window when filters change (server returns a fresh page).
  const browseFilterKey = `${type}|${architectures.join(',')}|${sdxlFamily}|${enabledSdxlFamilies.join(',')}|${enabledCivitaiCategories.join(',')}|${category ?? ''}|${query}|${sort}|${onlyNew}|${onlyPotentialDuplicate}`;

  useEffect(() => {
    browseHiddenIdsRef.current.clear();
    // Clear sync chrome immediately on filter change — a late join/result from
    // the previous slice must not keep “Checking for new models…” on screen.
    setCatalogSync(null);
  }, [browseFilterKey]);

  // Queue only the mounted window, without re-rendering this modal on scroll.
  const browseVisibleRef = useRef<CivitaiModelCardDto[]>([]);
  const browseVisibleTimerRef = useRef<number | null>(null);
  const onBrowseVisibleItems = useCallback(
    (items: readonly CivitaiModelCardDto[]) => {
      browseVisibleRef.current = items as CivitaiModelCardDto[];
      if (browseVisibleTimerRef.current !== null) {
        window.clearTimeout(browseVisibleTimerRef.current);
      }
      browseVisibleTimerRef.current = window.setTimeout(() => {
        browseVisibleTimerRef.current = null;
        if (tabRef.current !== 'browse') return;
        const visible = browseVisibleRef.current
          .filter((item): item is CivitaiModelCardDto & { previewUrl: string } =>
            Boolean(item.previewUrl),
          )
          .map((item) => ({ url: item.previewUrl, modelId: item.id }));
        if (visible.length === 0) return;
        void window.wcm.civitai.prioritizePreviews({ visible });
      }, 200);
    },
    [],
  );

  const catalogHasMore = catalogMeta?.hasMore === true;
  // Unscanned matches only — do NOT add browseItems (that made "Show more (~N
  // left)" mean "N already on screen" with nothing left to fetch).
  const catalogRemaining = Math.max(0, catalogMeta?.matchRemaining ?? 0);
  /**
   * Browse tab badge must match the grid, not the raw catalog index.
   * When the slice scan is finished, use loaded (filter-applied) cards.
   * While still scanning, loaded + remaining is an upper bound that shrinks
   * toward the true filtered total (so “No models matched” ends at 0).
   */
  const browseTabCount =
    catalogMeta == null
      ? null
      : catalogHasMore
        ? browseItems.length + catalogRemaining
        : browseItems.length;
  const browseTabCountReady = browseTabCount !== null;
  const typeLabel = type === 'Checkpoint' ? 'checkpoints' : 'LoRAs';
  const browseEmptyState: {
    message: string;
    churning: boolean;
  } | null =
    tab !== 'browse'
      ? null
      : busy && browseItems.length === 0
        ? { message: `Loading ${typeLabel}…`, churning: true }
        : isSyncing && browseItems.length === 0
          ? catalogSync?.mode === 'incremental'
            ? {
                message:
                  catalogSync.addedThisRun > 0
                    ? `Checking for new ${typeLabel}… ${newArrivalLabel(catalogSync.addedThisRun)}`
                    : `Checking for new ${typeLabel}…`,
                churning: true,
              }
            : { message: 'Backfilling catalog…', churning: true }
          : !isSyncing && browseItems.length === 0 && catalogHasMore
            ? {
                message: 'Loading more matching models… or use Show more.',
                churning: true,
              }
            : !isSyncing && browseItems.length === 0 && !catalogHasMore
              ? {
                  message: 'No models matched these filters.',
                  churning: false,
                }
              : null;
  const isWindow = presentation === 'window';

  const previewDownloader = (
    <CivitaiPreviewDownloader
      open={previewDownloaderOpen}
      onClose={() => setPreviewDownloaderOpen(false)}
      cardMinWidth={cardMinWidth}
      adjustCardMinWidth={adjustCardMinWidth}
    />
  );

  const body = (
    <>
        <header className="modal-head civitai-modal-head">
          <h2>
            <Search size={18} /> Civitai browser
          </h2>
          <div className="civitai-head-kind" role="group" aria-label="Browse kind">
            <div className="segmented">
              <button
                type="button"
                className={browseKind === 'LORA' ? 'active' : ''}
                onClick={() => setBrowseKind('LORA')}
              >
                LoRA
              </button>
              <button
                type="button"
                className={browseKind === 'Checkpoint' ? 'active' : ''}
                onClick={() => setBrowseKind('Checkpoint')}
              >
                Checkpoint
              </button>
              <button
                type="button"
                className={browseKind === 'Images' ? 'active' : ''}
                onClick={() => setBrowseKind('Images')}
              >
                <Image size={13} /> Images
              </button>
              <button
                type="button"
                className={browseKind === 'Videos' ? 'active' : ''}
                onClick={() => setBrowseKind('Videos')}
              >
                <Video size={13} /> Videos
              </button>
            </div>
          </div>
          <div className="civitai-head-actions">
            {!mediaMode ? (
              <CivitaiPreviewWarmButton
                onOpenDownloader={openPreviewDownloader}
              />
            ) : null}
            {isWindow ? (
              <button
                type="button"
                className="manage-btn"
                title="Dock back into the main Wildcards Manager window"
                onClick={() => onAttach?.()}
              >
                <PanelTop size={13} /> Attach
              </button>
            ) : (
              <button
                type="button"
                className="manage-btn"
                title="Open in a separate resizable window (remembered)"
                onClick={() => onDetach?.()}
              >
                <SquareArrowOutUpRight size={13} /> Detach
              </button>
            )}
            <button type="button" className="icon-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="modal-body">
          {mediaMode ? (
            <CivitaiImagesPanel
              key={browseKind}
              kind={videosMode ? 'video' : 'image'}
              imagesFolderConfigured={
                videosMode ? hasVideosFolder : hasImagesFolder
              }
              nsfw={nsfw}
              onStatus={(message, tone) => {
                if (!message) {
                  setStatusNotice(null);
                  setStatusError(null);
                  return;
                }
                if (tone === 'error') {
                  setStatusError(message);
                  setStatusNotice(null);
                } else {
                  setStatusNotice(message);
                  setStatusError(null);
                }
              }}
              onError={(message) => {
                setStatusError(message);
                setStatusNotice(null);
              }}
            />
          ) : null}
          {!mediaMode ? (
          <>
          <div className="civitai-tabs-row">
            <div className="segmented civitai-tabs">
              <button
                type="button"
                className={tab === 'browse' ? 'active' : ''}
                onClick={() => setTab('browse')}
                title={
                  browseTabCountReady
                    ? catalogHasMore
                      ? `About ${browseTabCount.toLocaleString()} models for these Browse filters (still scanning…)`
                      : `${browseTabCount.toLocaleString()} models match these Browse filters`
                    : 'Browse catalog'
                }
              >
                Browse
                {browseTabCountReady
                  ? ` (${browseTabCount.toLocaleString()})`
                  : ''}
              </button>
              {queueCount > 0 ? (
                <button
                  type="button"
                  className={tab === 'queued' ? 'active' : ''}
                  onClick={() => setTab('queued')}
                  title="Models waiting in the download queue (hidden from Browse until finished or cancelled)"
                >
                  <ListOrdered size={13} /> Queued ({queueCount})
                </button>
              ) : null}
              <button
                type="button"
                className={tab === 'downloaded' ? 'active' : ''}
                onClick={() => setTab('downloaded')}
                title={
                  tabDownloadedUpdateCount > 0
                    ? `${tabDownloadedUpdateCount} update${tabDownloadedUpdateCount === 1 ? '' : 's'} available`
                    : undefined
                }
              >
                <Download size={13} /> Downloaded
                {shelfReady || tabListReady.downloaded
                  ? ` (${tabDownloadedCount})`
                  : ''}
                {(shelfReady || tabListReady.downloaded) &&
                tabDownloadedUpdateCount > 0
                  ? ` · ${tabDownloadedUpdateCount} update${tabDownloadedUpdateCount === 1 ? '' : 's'}`
                  : ''}
              </button>
              <button
                type="button"
                className={tab === 'maybe' ? 'active' : ''}
                onClick={() => setTab('maybe')}
              >
                <Bookmark size={13} /> Maybe
                {shelfReady || tabListReady.maybe
                  ? ` (${tabMaybeCount})`
                  : ''}
              </button>
              <button
                type="button"
                className={tab === 'archive' ? 'active' : ''}
                onClick={() => setTab('archive')}
              >
                <Archive size={13} /> Archive
                {shelfReady || tabListReady.archive
                  ? ` (${tabArchiveCount})`
                  : ''}
              </button>
              <button
                type="button"
                className={tab === 'notify' ? 'active' : ''}
                onClick={() => setTab('notify')}
              >
                <Bell size={13} /> Notify me
                {tabListReady.notify ? ` (${tabNotifyCount})` : ''}
              </button>
            </div>

            <div className="civitai-toolbar">
              <label className="search-box civitai-search">
                <Search size={14} />
                <input
                  type="search"
                  placeholder={
                    tab === 'browse'
                      ? 'Search catalog…'
                      : tab === 'queued'
                        ? 'Search queue…'
                        : tab === 'downloaded'
                          ? 'Search downloaded…'
                          : tab === 'maybe'
                            ? 'Search maybe…'
                            : tab === 'archive'
                              ? 'Search archive…'
                              : 'Search notify list…'
                  }
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                />
              </label>
              <select
                className="civitai-sort-select"
                value={tab === 'notify' ? 'time-left' : sort}
                disabled={tab === 'notify'}
                title={
                  tab === 'notify'
                    ? 'Notify is sorted by soonest unlock first'
                    : undefined
                }
                onChange={(e) =>
                  setSort(e.target.value as CivitaiLocalSortDto)
                }
              >
                {tab === 'notify' ? (
                  <option value="time-left">Time left ↑</option>
                ) : (
                  <>
                    <option value="newest">Newest</option>
                    <option value="name">Name</option>
                    <option value="creator">Creator</option>
                  </>
                )}
              </select>
            </div>
          </div>
          <div
            className={`civitai-filter-row${tab === 'queued' ? ' civitai-filter-row-inactive' : ''}`}
            title={
              tab === 'queued'
                ? 'Category and base-model filters apply to other tabs — Queued always shows every download job'
                : undefined
            }
          >
            <div className="civitai-filter-group civitai-filter-category">
              <div className="civitai-chip-row">
                <button
                  type="button"
                  className={`civitai-chip${category === null ? ' active' : ''}`}
                  onClick={() => setCategory(null)}
                  title="All enabled categories"
                  disabled={tab === 'queued'}
                >
                  All
                </button>
                {visibleCategoryPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`civitai-chip${category === preset.id ? ' active' : ''}`}
                    disabled={tab === 'queued'}
                    onClick={() =>
                      setCategory((current) =>
                        current === preset.id ? null : preset.id,
                      )
                    }
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="civitai-chip civitai-chip-manage"
                  title="Show or hide categories"
                  aria-label="Show or hide categories"
                  disabled={tab === 'queued'}
                  onClick={openCategoryVisibility}
                >
                  …
                </button>
              </div>
            </div>
            <div className="civitai-filter-archive-slot">
              {tab === 'browse' && category ? (
                <button
                  type="button"
                  className="civitai-chip civitai-chip-action"
                  disabled={busy || isSyncing || browseItems.length === 0}
                  title="Archive only the cards currently on screen — never hidden or unscanned models"
                  onClick={() => archiveShownCards()}
                >
                  <Archive size={11} /> Archive shown
                </button>
              ) : null}
            </div>
            <div className="civitai-filter-group civitai-filter-architecture">
              <label className="civitai-base-model-label" htmlFor="civitai-base-model">
                Base Model
              </label>
              <select
                id="civitai-base-model"
                className="civitai-architecture-select"
                value={
                  architectures[0] &&
                  enabledArchitectures.includes(architectures[0])
                    ? architectures[0]
                    : (enabledArchitectures[0] ?? 'sdxl')
                }
                aria-label="Base Model"
                disabled={tab === 'queued'}
                onChange={(e) =>
                  selectArchitecture(e.target.value as CivitaiArchitectureIdDto)
                }
              >
                {CIVITAI_ARCHITECTURE_PRESETS.filter((preset) =>
                  enabledArchitectures.includes(
                    preset.id as CivitaiArchitectureIdDto,
                  ),
                ).map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              {architectures[0] === 'sdxl' ? (
                <div
                  className="civitai-chip-row civitai-sdxl-family-row"
                  role="group"
                  aria-label="SDXL family"
                >
                  {CIVITAI_SDXL_FAMILY_PRESETS.filter(
                    (preset) =>
                      preset.id === 'all' ||
                      enabledSdxlFamilies.includes(
                        preset.id as CivitaiSdxlFamilyToggleIdDto,
                      ),
                  ).map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`civitai-chip civitai-sdxl-family-chip${sdxlFamily === preset.id ? ' active' : ''}`}
                      disabled={tab === 'queued'}
                      title={
                        preset.id === 'all'
                          ? 'All enabled SDXL families'
                          : familyMetaLabel(preset.id as CivitaiSdxlFamilyId)
                      }
                      aria-pressed={sdxlFamily === preset.id}
                      onClick={() =>
                        setSdxlFamily(preset.id as CivitaiSdxlFamilyIdDto)
                      }
                    >
                      <SdxlFamilyIcon
                        id={preset.id as CivitaiSdxlFamilyId}
                        size={12}
                      />
                      <span>{familyMetaLabel(preset.id as CivitaiSdxlFamilyId)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {tab === 'browse' ? (
            <div className="civitai-filters">
                {origin === 'https://civitai.red' ? (
                  <span title="This library uses civitai.red. Browse lists mature models only.">
                    Mature only
                  </span>
                ) : (
                  <label title="Civitai still returns mature models either way; this used to blank their cover images">
                    <input
                      type="checkbox"
                      checked={nsfw}
                      onChange={(e) => setNsfw(e.target.checked)}
                    />{' '}
                    Include NSFW
                  </label>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={onlyNew}
                    onChange={(e) => setOnlyNew(e.target.checked)}
                  />{' '}
                  Only new
                </label>
                  <label title="Name-based guesses only — not shown in normal Browse. Prefer hash-based Installed.">
                    <input
                      type="checkbox"
                      checked={onlyPotentialDuplicate}
                      onChange={(e) =>
                        setOnlyPotentialDuplicate(e.target.checked)
                      }
                    />{' '}
                    Only possible matches
                  </label>
                <span className="civitai-filters-divider" aria-hidden>
                  |
                </span>
                <div
                  className="civitai-card-zoom"
                  role="group"
                  aria-label="Card size"
                >
                  <button
                    type="button"
                    className="civitai-icon-btn civitai-card-zoom-btn"
                    title="Smaller cards"
                    aria-label="Smaller cards"
                    disabled={cardMinWidth <= 100}
                    onClick={() => adjustCardMinWidth(-20)}
                  >
                    <Minus size={14} />
                  </button>
                  <span className="civitai-card-zoom-label" title="Card size">
                    {cardMinWidth}px
                  </span>
                  <button
                    type="button"
                    className="civitai-icon-btn civitai-card-zoom-btn"
                    title="Larger cards"
                    aria-label="Larger cards"
                    disabled={cardMinWidth >= 280}
                    onClick={() => adjustCardMinWidth(20)}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {catalogMeta && !catalogMeta.exhausted ? (
                  <button
                    type="button"
                    className="manage-btn"
                    disabled={isSyncing}
                    title="Continue fetching older catalog pages for this filter into the local cache (runs in the background)"
                    onClick={() => startCatalogSync('fill')}
                  >
                    <RefreshCw
                      size={13}
                      className={isSyncing ? 'spin' : undefined}
                    />{' '}
                    Resume catalog
                  </button>
                ) : null}
            </div>
          ) : tab === 'notify' ? (
            <div className="civitai-filters">
              <button
                type="button"
                className="manage-btn"
                disabled={busy || watchlist.length === 0}
                title="Unlock models whose early access ended; only fetch Civitai when catalog end times are missing"
                onClick={() => void refreshNotify()}
              >
                <RefreshCw size={13} className={busy ? 'spin' : ''} /> Check
                availability
              </button>
              <span className="hint">
                Waiting only — unlocked models return to Browse (checked
                automatically).
              </span>
            </div>
          ) : tab === 'downloaded' ? (
            <div className="civitai-filters">
              <button
                type="button"
                className="manage-btn"
                disabled={busy}
                onClick={() => refreshCurrentTab()}
              >
                <RefreshCw size={13} className={busy ? 'spin' : ''} /> Refresh
              </button>
              <span className="hint">
                Models matched to files in your LoRA or checkpoint folder (or
                marked as installed).
              </span>
            </div>
          ) : tab === 'maybe' ? (
            <div className="civitai-filters">
              <button
                type="button"
                className="manage-btn"
                disabled={busy}
                onClick={() => refreshCurrentTab()}
              >
                <RefreshCw size={13} className={busy ? 'spin' : ''} /> Refresh
              </button>
              <span className="hint">
                Models you might want later. Hidden from Browse. Move them to
                Archive to bin them, or back to Browse.
              </span>
            </div>
          ) : (
            <div className="civitai-filters">
              <button
                type="button"
                className="manage-btn"
                disabled={busy}
                onClick={() => refreshCurrentTab()}
              >
                <RefreshCw size={13} className={busy ? 'spin' : ''} /> Refresh
              </button>
              <span className="hint">
                Archived models are hidden from Browse. Restore or move to Maybe
                ones you want to reconsider.
              </span>
            </div>
          )}

          <div
            className={`civitai-split${previewOpen ? '' : ' is-collapsed'}${resizingSplit ? ' resizing' : ''}`}
            ref={splitRowRef}
          >
            <div
              className={`civitai-split-grid${
                tab === 'browse' && browseEmptyState ? ' is-empty' : ''
              }`}
              style={{
                flex: previewOpen
                  ? `0 0 ${splitRatio * 100}%`
                  : '1 1 auto',
                ['--civitai-card-min' as string]: `${cardMinWidth}px`,
              }}
              onClick={collapsePreviewOnGridBackground}
            >
              {tab === 'browse' ? (
                browseEmptyState ? (
                  <div
                    className="civitai-browse-empty"
                    role="status"
                    aria-live="polite"
                  >
                    {browseEmptyState.churning ? (
                      <RefreshCw
                        size={36}
                        className="spin civitai-browse-empty-icon"
                        aria-hidden
                      />
                    ) : (
                      <SearchX
                        size={36}
                        className="civitai-browse-empty-icon"
                        aria-hidden
                      />
                    )}
                    <p className="civitai-browse-empty-message">
                      {browseEmptyState.message}
                    </p>
                  </div>
                ) : (
                <>
                  <CivitaiVirtualGrid
                    items={browseItems}
                    cardMinWidth={cardMinWidth}
                    getItemKey={(item) => item.id}
                    scrollToTopToken={browseRevealToken}
                    onClick={collapsePreviewOnGridBackground}
                    onVisibleItems={onBrowseVisibleItems}
                    renderItem={(item) => renderModelCard(item, 'browse')}
                  />
                  {browseItems.length > 0 || catalogHasMore ? (
                    <div className="civitai-show-more">
                      {catalogHasMore ? (
                        <button
                          type="button"
                          className="civitai-chip civitai-chip-action"
                          disabled={busy}
                          onClick={() => void loadCatalog({ append: true })}
                        >
                          Show more
                          {catalogRemaining > 0
                            ? ` (~${catalogRemaining.toLocaleString()} more)`
                            : ''}
                        </button>
                      ) : null}
                      <span
                        className="hint"
                        title={[
                          'Loaded cards: models on screen right now that match your Browse filters (category, base model, family, hide downloaded, etc.).',
                          catalogHasMore
                            ? '“Show more (~N)” / Browse (N): loaded matches plus remaining catalog entries still to scan — N shrinks as you load more; when scanning finishes, Browse equals the true filtered total.'
                            : 'Browse (N): exact filtered total for the current filters (scan finished).',
                          'Index: raw local catalog size for this type/category/architecture slice. It can be larger because it still includes disabled SDXL families and models that are only on Downloaded / Maybe / Archive / Notify. Tab badges are not meant to add up to Index.',
                          catalogMeta && !catalogMeta.exhausted
                            ? 'Incomplete: more pages can still be synced into this catalog slice from Civitai.'
                            : '',
                        ]
                          .filter(Boolean)
                          .join('\n\n')}
                      >
                        Showing {browseItems.length.toLocaleString()} loaded
                        cards
                        {catalogMeta
                          ? catalogMeta.matchTotal !== catalogMeta.totalCached
                            ? ` · ${catalogMeta.matchTotal.toLocaleString()} match filter · index ${catalogMeta.totalCached.toLocaleString()}`
                            : ` · index ${catalogMeta.totalCached.toLocaleString()}`
                          : ''}
                        {catalogMeta && !catalogMeta.exhausted
                          ? ' · incomplete'
                          : ''}
                      </span>
                    </div>
                  ) : null}
                </>
                )
              ) : tab === 'queued' ? (
                <>
                  <CivitaiVirtualGrid
                    items={filteredQueuedItems}
                    cardMinWidth={cardMinWidth}
                    getItemKey={(item) => item.id}
                    onClick={collapsePreviewOnGridBackground}
                    renderItem={(item) => renderModelCard(item, 'queued')}
                  />
                  {filteredQueuedItems.length === 0 ? (
                    <p className="hint">
                      {queueCount === 0
                        ? 'Download queue is empty.'
                        : query.trim()
                          ? 'No queued models match this search.'
                          : 'Loading queued models…'}
                    </p>
                  ) : (
                    <p className="hint">
                      Queued models stay out of Browse until the download
                      finishes (then Downloaded) or you cancel (back to Browse).
                    </p>
                  )}
                </>
              ) : tab === 'downloaded' ? (
                <>
                  <CivitaiVirtualGrid
                    items={filteredDownloadedItems}
                    cardMinWidth={cardMinWidth}
                    getItemKey={(item) => item.id}
                    onClick={collapsePreviewOnGridBackground}
                    renderItem={(item) =>
                      renderModelCard(item, 'downloaded')
                    }
                  />
                  {!busy && filteredDownloadedItems.length === 0 ? (
                    <p className="hint">
                      {downloadedItems.length === 0
                        ? 'No downloaded models in the catalog yet. Download from Browse — installed detection uses AutoV2 hashes.'
                        : 'No downloaded models match these filters.'}
                    </p>
                  ) : null}
                </>
              ) : tab === 'maybe' ? (
                <>
                  <CivitaiVirtualGrid
                    items={filteredMaybeItems}
                    cardMinWidth={cardMinWidth}
                    getItemKey={(item) => item.id}
                    onClick={collapsePreviewOnGridBackground}
                    renderItem={(item) => renderModelCard(item, 'maybe')}
                  />
                  {!tabListReady.maybe ? (
                    <p className="hint">Loading Maybe list…</p>
                  ) : filteredMaybeItems.length === 0 ? (
                    <p className="hint">
                      {maybeItems.length === 0
                        ? 'No models on your Maybe list. Use the bookmark on a Browse card to save one for later.'
                        : 'No Maybe models match these filters.'}
                    </p>
                  ) : null}
                </>
              ) : tab === 'archive' ? (
                <>
                  <CivitaiVirtualGrid
                    items={filteredArchiveItems}
                    cardMinWidth={cardMinWidth}
                    getItemKey={(item) => item.id}
                    onClick={collapsePreviewOnGridBackground}
                    renderItem={(item) => renderModelCard(item, 'archive')}
                  />
                  {!tabListReady.archive ? (
                    <p className="hint">Loading Archive list…</p>
                  ) : filteredArchiveItems.length === 0 ? (
                    <p className="hint">
                      {archiveItems.length === 0
                        ? 'No archived models. Use Archive on a Browse card to hide it from search.'
                        : 'No archived models match these filters.'}
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  {recentlyUnlocked.filter((e) =>
                    matchesModelType(e.type, type),
                  ).length > 0 ? (
                    <div className="civitai-just-unlocked">
                      <p className="hint pad">
                        Just unlocked — also pinned at the top of Browse until
                        you dismiss or download.
                      </p>
                      <div
                        className="civitai-grid"
                        onClick={collapsePreviewOnGridBackground}
                      >
                        {recentlyUnlocked
                          .filter((e) => matchesModelType(e.type, type))
                          .map((entry) => {
                            const card =
                              entry.card ??
                              ({
                                id: entry.modelId,
                                name: entry.modelName,
                                type: entry.type,
                                nsfw: false,
                                tags: [],
                                trainedWords: [],
                                pageUrl: `${origin}/models/${entry.modelId}`,
                                installed: false,
                                latestVersionInstalled: false,
                                hasUninstalledVersion: true,
                                markedInstalled: false,
                                archived: false,
                                maybe: false,
                                watching: false,
                                earlyAccess: false,
                                hasDownloadableVersion: true,
                                potentialLocalMatches: [],
                                versionInstalls: [],
                                statusTags: [],
                              } satisfies CivitaiModelCardDto);
                            return (
                              <div
                                key={`unlocked:${entry.modelId}`}
                                className="civitai-just-unlocked-card"
                              >
                                {renderModelCard(card, 'browse')}
                                <button
                                  type="button"
                                  className="ghost-btn civitai-just-unlocked-dismiss"
                                  onClick={() =>
                                    void dismissRecentlyUnlocked(entry.modelId)
                                  }
                                >
                                  Dismiss
                                </button>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ) : null}
                  <CivitaiVirtualGrid
                    items={filteredWatchlist}
                    cardMinWidth={cardMinWidth}
                    getItemKey={(entry) => `${entry.origin}:${entry.modelId}`}
                    onClick={collapsePreviewOnGridBackground}
                    renderItem={(entry) => (
                      <NotifyWatchCard
                        entry={entry}
                        activeDownloadId={activeDownloadId}
                        queuedIds={queuedIds}
                        selectedId={selectedPreview?.modelId ?? null}
                        canDownloadFor={canDownloadFor}
                        requestDownload={requestDownload}
                        removeWatch={removeWatch}
                        onSelect={selectPreview}
                        showCategoryMeta={showCategoryMeta}
                        showFamilyMeta={showFamilyMeta}
                      />
                    )}
                  />
                  {filteredWatchlist.length === 0 ? (
                    <p className="hint">
                      {watchlist.length === 0 ? (
                        <>
                          Nothing waiting. On Browse, use{' '}
                          <strong>Notify me</strong> on early-access cards —
                          when they unlock they stay pinned here and on Browse
                          until you dismiss or download.
                        </>
                      ) : (
                        'No watched models match these filters.'
                      )}
                    </p>
                  ) : null}
                </>
              )}
            </div>

            <div
              className={`panel-splitter civitai-splitter${resizingSplit ? ' active' : ''}`}
              role="separator"
              aria-label="Resize model preview"
              aria-orientation="vertical"
              aria-valuemin={22}
              aria-valuemax={70}
              aria-valuenow={Math.round(splitRatio * 100)}
              aria-hidden={!previewOpen}
              tabIndex={previewOpen ? 0 : -1}
              title={`Grid ${Math.round(splitRatio * 100)}% · drag to resize · double-click to reset`}
              onPointerDown={previewOpen ? beginSplitResize : undefined}
              onPointerMove={previewOpen ? moveSplitResize : undefined}
              onPointerUp={previewOpen ? finishSplitResize : undefined}
              onPointerCancel={previewOpen ? finishSplitResize : undefined}
              onDoubleClick={
                previewOpen
                  ? () => {
                      const next = 0.42;
                      liveSplitRatioRef.current = next;
                      setSplitRatio(next);
                      persistSplitRatio(next);
                    }
                  : undefined
              }
            >
              <span />
            </div>

            <div className="civitai-split-preview" aria-hidden={!previewOpen}>
              {selectedPreview ? (
                <>
                  <div className="civitai-preview-bar">
                    <strong title={selectedPreview.name}>
                      {selectedPreview.name}
                    </strong>
                    <div className="civitai-preview-bar-actions">
                      <button
                        type="button"
                        className="civitai-icon-btn action-open"
                        title="Open in external browser"
                        aria-label="Open in external browser"
                        onClick={() =>
                          void window.wcm.civitai.openModelPage(
                            selectedPreview.modelId,
                            selectedPreview.name,
                          )
                        }
                      >
                        <ExternalLink size={15} />
                      </button>
                      <button
                        type="button"
                        className="civitai-icon-btn"
                        title="Collapse browser panel"
                        aria-label="Collapse browser panel"
                        onClick={() => setPreviewOpen(false)}
                      >
                        <PanelRightClose size={15} />
                      </button>
                    </div>
                  </div>
                  <webview
                    className="civitai-preview-webview"
                    src={selectedPreview.pageUrl}
                    allowpopups={true}
                    partition="persist:civitai-preview"
                  />
                </>
              ) : (
                <div className="civitai-preview-empty">
                  <p>Select a model card to preview its Civitai page here.</p>
                  <p className="hint">
                    The external-link icon still opens the page in your system
                    browser.
                  </p>
                </div>
              )}
            </div>
          </div>
          </>
          ) : null}
        </div>
        {!mediaMode ? <DownloadConsole /> : null}
        <footer
          className={`status-bar civitai-status-bar${
            statusTone === 'error'
              ? ' status-error'
              : statusTone === 'notice'
                ? ' status-notice'
                : ''
          }`}
          role="status"
          aria-live="polite"
        >
          {mediaMode ? (
            <CivitaiImageDownloadProgressHud
              kind={videosMode ? 'video' : 'image'}
            />
          ) : (
            <CivitaiDownloadProgressHud
              activeDownloadId={activeDownloadId}
              activeDownloadLabel={activeDownloadLabel}
              queuedCount={queuedCount}
              firstQueuedName={queuedDownloads[0]?.modelName ?? null}
              paused={Boolean(downloadQueueSnapshot?.paused)}
              onOpenQueue={openDownloadQueue}
              afterBar={
                isDownloading || busy || isSyncing ? (
                  <RefreshCw size={13} className="spin" />
                ) : null
              }
            />
          )}
          {!mediaMode && !isDownloading && (busy || isSyncing) ? (
            <RefreshCw size={13} className="spin" />
          ) : null}
          {statusMessage ? (
            <span className="status-bar-message" title={statusMessage}>
              {statusMessage}
            </span>
          ) : null}
          {/* Always mounted so rematch-on-done still fires while other status text shows. */}
          <span hidden={Boolean(statusMessage)}>
            <CivitaiBackgroundWarmStatus
              onRematch={rematchAfterWarm}
              onFlashError={flashStatusError}
            />
          </span>
          {browseBucketUndo ? (
            <>
              <span
                className="status-bar-message"
                title={`${browseBucketUndo.name} → ${
                  browseBucketUndo.bucket === 'maybe' ? 'Maybe' : 'Archive'
                }`}
              >
                Moved {browseBucketUndo.name} to{' '}
                {browseBucketUndo.bucket === 'maybe' ? 'Maybe' : 'Archive'}
              </span>
              <button
                type="button"
                className="manage-btn"
                title="Restore to Browse (keeps grid slot until you undo or it expires)"
                onClick={() => undoBrowseBucketMove()}
              >
                <Undo2 size={13} /> Undo
              </button>
            </>
          ) : null}
          {statusError ? (
            <button
              type="button"
              className="status-bar-dismiss"
              title="Dismiss"
              onClick={() => setStatusError(null)}
            >
              <X size={13} />
            </button>
          ) : null}
          {!isWindow ? (
            <button type="button" className="manage-btn" onClick={onClose}>
              Close
            </button>
          ) : null}
        </footer>
    </>
  );

  if (isWindow) {
    return (
      <>
        {categoryVisibilityOpen ? (
          <CivitaiCategoryVisibilityModal
            enabled={enabledCivitaiCategories}
            onToggle={toggleCivitaiCategoryVisibility}
            onClose={closeCategoryVisibility}
          />
        ) : null}
        <ModelDownloadQueueModal
          open={downloadQueueOpen}
          onClose={() => setDownloadQueueOpen(false)}
          snapshot={downloadQueueSnapshot}
          onChanged={(snap) => {
            applyDownloadQueueSnapshot(snap);
          }}
          onError={flashStatusError}
          onEditQueued={openEditQueuedDownload}
        />
        {downloadTarget ? (
          <CivitaiDownloadModal
            target={downloadTarget}
            browseArchitectures={architectures}
            sdxlFamily={sdxlFamily}
            enabledSdxlFamilies={enabledSdxlFamilies}
            initialValues={downloadInitialOpts}
            editMode={editingQueueModelId != null}
            onCancel={closeDownloadModal}
            onConfirm={(opts) => void confirmDownload(opts)}
            onMarkDownloaded={(picks) => void markVersionDownloaded(picks)}
          />
        ) : null}
        {previewDownloader}
        {cardContextMenu ? (
          <CivitaiCardContextMenu
            menu={cardContextMenu}
            canDownload={canDownloadFor(
              cardContextMenu.typeHint ??
                (cardContextMenu.item.type === 'Checkpoint'
                  ? 'Checkpoint'
                  : type),
            )}
            downloading={activeDownloadId === cardContextMenu.item.id}
            queued={queuedIds.has(cardContextMenu.item.id)}
            onClose={() => setCardContextMenu(null)}
            onNotify={(card) => void watchForNotify(card)}
            onDownload={(card, opts) =>
              requestDownload(
                {
                  ...card,
                  typeHint:
                    cardContextMenu.typeHint ??
                    (card.type === 'Checkpoint' ? 'Checkpoint' : type),
                },
                opts,
              )
            }
            onMarkInstalled={(card) => void markInstalled(card)}
            onUnmarkInstalled={(card) => void unmarkInstalled(card)}
            onRevealLocal={(card, dlType) => {
              const match = card.localInstallMatches?.[0];
              if (!match) return;
              void window.wcm.civitai
                .revealLocalFile({
                  type: dlType,
                  relativePath: match.relativePath,
                })
                .catch((e) => {
                  flashStatusError(
                    e instanceof Error ? e.message : String(e),
                  );
                });
            }}
            onMaybe={(card) => void moveToBucket(card, 'maybe')}
            onArchive={(card) => void moveToBucket(card, 'archive')}
            onRestore={(card) => void moveToBucket(card, 'none')}
            onCancelQueue={(modelId) => void cancelQueuedDownload(modelId)}
            onOpenExternal={(card) => {
              void window.wcm.civitai.openModelPage(card.id, card.name);
            }}
            onBlockAuthor={(card) => void blockAuthor(card)}
          />
        ) : null}
        <div className="civitai-window-shell">
          <div
            className={`modal modal-wide civitai-modal civitai-modal-window${
              type === 'Checkpoint' ? ' civitai-mode-checkpoint' : ''
            }`}
          >
            {body}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {categoryVisibilityOpen ? (
        <CivitaiCategoryVisibilityModal
          enabled={enabledCivitaiCategories}
          onToggle={toggleCivitaiCategoryVisibility}
          onClose={closeCategoryVisibility}
        />
      ) : null}
      <ModelDownloadQueueModal
        open={downloadQueueOpen}
        onClose={() => setDownloadQueueOpen(false)}
        snapshot={downloadQueueSnapshot}
        onChanged={(snap) => {
          applyDownloadQueueSnapshot(snap);
        }}
        onError={flashStatusError}
        onEditQueued={openEditQueuedDownload}
      />
      {downloadTarget ? (
        <CivitaiDownloadModal
          target={downloadTarget}
          browseArchitectures={architectures}
          sdxlFamily={sdxlFamily}
          enabledSdxlFamilies={enabledSdxlFamilies}
          initialValues={downloadInitialOpts}
          editMode={editingQueueModelId != null}
          onCancel={closeDownloadModal}
          onConfirm={(opts) => void confirmDownload(opts)}
          onMarkDownloaded={(picks) => void markVersionDownloaded(picks)}
        />
      ) : null}
      {previewDownloader}
      {cardContextMenu ? (
        <CivitaiCardContextMenu
          menu={cardContextMenu}
          canDownload={canDownloadFor(
            cardContextMenu.typeHint ??
              (cardContextMenu.item.type === 'Checkpoint'
                ? 'Checkpoint'
                : type),
          )}
          downloading={activeDownloadId === cardContextMenu.item.id}
          queued={queuedIds.has(cardContextMenu.item.id)}
          onClose={() => setCardContextMenu(null)}
          onNotify={(card) => void watchForNotify(card)}
          onDownload={(card, opts) =>
            requestDownload(
              {
                ...card,
                typeHint:
                  cardContextMenu.typeHint ??
                  (card.type === 'Checkpoint' ? 'Checkpoint' : type),
              },
              opts,
            )
          }
          onMarkInstalled={(card) => void markInstalled(card)}
          onUnmarkInstalled={(card) => void unmarkInstalled(card)}
          onRevealLocal={(card, dlType) => {
            const match = card.localInstallMatches?.[0];
            if (!match) return;
            void window.wcm.civitai
              .revealLocalFile({
                type: dlType,
                relativePath: match.relativePath,
              })
              .catch((e) => {
                flashStatusError(
                  e instanceof Error ? e.message : String(e),
                );
              });
          }}
          onMaybe={(card) => void moveToBucket(card, 'maybe')}
          onArchive={(card) => void moveToBucket(card, 'archive')}
          onRestore={(card) => void moveToBucket(card, 'none')}
          onCancelQueue={(modelId) => void cancelQueuedDownload(modelId)}
          onOpenExternal={(card) => {
            void window.wcm.civitai.openModelPage(card.id, card.name);
          }}
          onBlockAuthor={(card) => void blockAuthor(card)}
        />
      ) : null}
      <div className="modal-overlay" {...modalOverlayDismiss(onClose)}>
        <div
          className={`modal modal-wide civitai-modal${
            type === 'Checkpoint' ? ' civitai-mode-checkpoint' : ''
          }`}
          onClick={(event) => event.stopPropagation()}
        >
          {body}
        </div>
      </div>
    </>
  );
}

const CivitaiPreviewThumb = memo(function CivitaiPreviewThumb({
  modelId,
  url,
  customUrl,
  onPreviewUrlChange,
}: {
  modelId: number;
  url?: string;
  customUrl?: string;
  /** Fired when Refresh re-resolves a different cover URL from Civitai. */
  onPreviewUrlChange?: (modelId: number, previewUrl: string) => void;
}) {
  // Prefer the on-disk thumb. If it is not cached yet, show the same sized
  // CDN image the website uses — do not wait for the serial download queue.
  const cdnUrl = url ? civitaiSizedPreviewUrl(url, 450) : null;
  const localUrl =
    customUrl ?? (url ? window.wcm.civitai.localPreviewUrl(url) : null);
  const [src, setSrc] = useState<string | null>(localUrl ?? cdnUrl);
  const [remoteUrl, setRemoteUrl] = useState<string | undefined>(url);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState(false);
  const [emptyHint, setEmptyHint] = useState('No preview');
  const triedDownloadRef = useRef(false);

  useEffect(() => {
    setRemoteUrl(url);
    triedDownloadRef.current = false;
    setBusy(false);
    setBroken(false);
    setEmptyHint(url || customUrl ? 'Loading…' : 'No preview');
    setSrc(
      customUrl ??
        (url ? window.wcm.civitai.localPreviewUrl(url) : null) ??
        (url ? civitaiSizedPreviewUrl(url, 450) : null),
    );
  }, [modelId, url, customUrl]);

  const bust = (next: string) =>
    `${next}${next.includes('?') ? '&' : '?'}t=${Date.now()}`;

  // Local `wcm-preview://` first. A 404 means the thumb is not cached yet —
  // show the CDN image immediately and fill the cache in the background.
  // Refresh is the only path that re-downloads that one image right now.
  const handleImgError = () => {
    if (!customUrl && cdnUrl && src !== cdnUrl) {
      setSrc(cdnUrl);
      setBroken(false);
      setEmptyHint('Loading…');
      if (remoteUrl && !triedDownloadRef.current) {
        triedDownloadRef.current = true;
        void window.wcm.civitai.cachePreview(remoteUrl).then((local) => {
          if (local) setSrc(bust(local));
        });
      }
      return;
    }
    setBroken(true);
    setEmptyHint('No preview');
  };

  const refreshPreview = async (event: {
    preventDefault(): void;
    stopPropagation(): void;
  }) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    setBroken(false);
    try {
      // Always re-fetch the model — Refresh must re-resolve the cover URL, not
      // just re-download whatever stale URL is already on the card.
      const card = await window.wcm.civitai.getModel(modelId);
      const nextUrl = card.previewUrl;
      if (!nextUrl) {
        setEmptyHint('No image on Civitai (video-only?)');
        setSrc(null);
        setRemoteUrl(undefined);
        return;
      }
      setRemoteUrl(nextUrl);
      onPreviewUrlChange?.(modelId, nextUrl);
      const local = await window.wcm.civitai.refreshPreview(nextUrl);
      triedDownloadRef.current = true;
      if (local) {
        setSrc(bust(local));
      } else {
        setSrc(null);
        setBroken(true);
        setEmptyHint('Could not refresh preview');
      }
    } catch {
      setEmptyHint('Could not refresh preview');
      setBroken(true);
    } finally {
      setBusy(false);
    }
  };

  const pasteClipboardPreview = async (event: {
    preventDefault(): void;
    stopPropagation(): void;
  }) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    setBroken(false);
    try {
      const local =
        await window.wcm.civitai.setCustomPreviewFromClipboard(modelId);
      if (!local) {
        setEmptyHint('Clipboard has no image');
        return;
      }
      triedDownloadRef.current = true;
      setSrc(bust(local));
    } catch {
      setEmptyHint('Could not use clipboard image');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="civitai-thumb-lazy">
      {src && !broken ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => handleImgError()}
        />
      ) : (
        <div className="civitai-thumb-empty">
          {busy ? 'Saving…' : broken ? 'Broken preview' : emptyHint}
        </div>
      )}
      <div className="civitai-thumb-actions">
        <button
          type="button"
          className="civitai-thumb-action"
          title="Use clipboard image as preview"
          aria-label="Use clipboard image as preview"
          disabled={busy}
          onClick={(event) => void pasteClipboardPreview(event)}
        >
          <ClipboardPaste size={15} />
        </button>
        <button
          type="button"
          className="civitai-thumb-action"
          title={
            remoteUrl
              ? 'Refresh preview'
              : 'Fetch preview from Civitai'
          }
          aria-label="Refresh preview"
          disabled={busy}
          onClick={(event) => void refreshPreview(event)}
        >
          <RefreshCw size={15} className={busy ? 'spin' : undefined} />
        </button>
      </div>
    </div>
  );
});

function CivitaiCategoryVisibilityModal({
  enabled,
  onToggle,
  onClose,
}: {
  enabled: CivitaiModelCategoryIdDto[];
  onToggle: (id: CivitaiModelCategoryIdDto) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onClose)}>
      <div
        className="modal civitai-category-visibility-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Civitai categories"
      >
        <header className="modal-head">
          <h2>Civitai categories</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <p className="hint">
            Hidden categories stay on disk but are not synced. Preview downloads
            only cover models in the active library (plus on-screen Browse).
            Closing this dialog refreshes that queue.
          </p>
          <div className="library-manager-check-grid" role="group">
            {CIVITAI_MODEL_CATEGORY_PRESETS.map((preset) => {
              const checked = enabled.includes(preset.id);
              return (
                <label key={preset.id} className="library-manager-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(preset.id)}
                  />
                  <span>{preset.label}</span>
                </label>
              );
            })}
          </div>
        </div>
        <footer className="modal-foot">
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function CivitaiDownloadModal({
  target,
  browseArchitectures,
  sdxlFamily,
  enabledSdxlFamilies,
  initialValues = null,
  editMode = false,
  onCancel,
  onConfirm,
  onMarkDownloaded,
}: {
  target: DownloadTarget;
  browseArchitectures: CivitaiArchitectureIdDto[];
  sdxlFamily: CivitaiSdxlFamilyIdDto;
  enabledSdxlFamilies: CivitaiSdxlFamilyToggleIdDto[];
  /** Prefill when editing a queued download. */
  initialValues?: DownloadConfirmOpts | null;
  editMode?: boolean;
  onCancel: () => void;
  onConfirm: (opts: DownloadConfirmOpts) => void;
  onMarkDownloaded: (
    picks: Array<{
      versionId: number;
      fileId: number;
      fileName: string;
      label: string;
    }>,
  ) => void;
}) {
  const { modalStyle, dragging, headerPointerProps } = useDraggableModal();
  const isLora = target.typeHint === 'LORA';
  const instantOptions = useMemo(
    () =>
      buildInstantDownloadOptions(
        target,
        browseArchitectures,
        sdxlFamily,
        enabledSdxlFamilies,
      ),
    [
      browseArchitectures,
      enabledSdxlFamilies,
      sdxlFamily,
      target,
    ],
  );
  const [folderInfo, setFolderInfo] =
    useState<CivitaiDownloadCategoryDto | null>(null);
  const [loraList, setLoraList] = useState<LoraDownloadCategoryListDto | null>(
    null,
  );
  const [category, setCategory] = useState(initialValues?.category ?? '');
  const [loraCategoryId, setLoraCategoryId] = useState(
    initialValues?.loraCategoryId ?? '',
  );
  const [extraLoraCategoryIds, setExtraLoraCategoryIds] = useState<string[]>(
    () =>
      uniqueExtraLoraCategoryIds(
        initialValues?.loraCategoryId,
        initialValues?.extraLoraCategoryIds,
      ),
  );
  const [downloadOptions, setDownloadOptions] =
    useState<CivitaiModelDownloadOptionsDto>(() => instantOptions);
  const [pickKey, setPickKey] = useState<string | null>(() => {
    const preferred = preferDownloadPick(
      instantOptions.picks,
      initialValues?.versionId ?? target.versionId,
      initialValues?.fileName ?? target.fileName,
    );
    return preferred?.key ?? null;
  });
  const [saveFileName, setSaveFileName] = useState(() => {
    const raw = initialValues?.fileName?.trim()
      ? initialValues.fileName.trim()
      : preferDownloadPick(
          instantOptions.picks,
          initialValues?.versionId ?? target.versionId,
          initialValues?.fileName ?? target.fileName,
        )?.fileName?.trim() ||
        target.fileName?.trim() ||
        '';
    return proposeDownloadSaveFileName(raw, target.fileName || 'model.safetensors');
  });
  // Always start from the global default — never reuse last download / category
  // “defaultWeights” (too easy to re-queue a bad pattern by accident).
  // Edit mode keeps the queued weights.
  const [weights, setWeights] = useState(
    initialValues?.weights?.trim() || DEFAULT_LORA_DOWNLOAD_WEIGHTS,
  );
  const [extraComment, setExtraComment] = useState(
    initialValues?.extraComment ?? '',
  );
  const [extraPrompt, setExtraPrompt] = useState(
    initialValues?.extraPrompt ?? '',
  );
  const [creating, setCreating] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [destIssue, setDestIssue] = useState<string | null>(null);
  const [destChecking, setDestChecking] = useState(false);
  /** Full API version list — only when nothing known, or user asks. */
  const [optionsBusy, setOptionsBusy] = useState(
    () => instantOptions.picks.length === 0,
  );
  const [fullOptionsLoaded, setFullOptionsLoaded] = useState(false);
  const [markScopeOpen, setMarkScopeOpen] = useState(false);

  const applyOptions = useCallback(
    (opts: CivitaiModelDownloadOptionsDto) => {
      setDownloadOptions(opts);
      const preferred = preferDownloadPick(
        opts.picks,
        target.versionId,
        target.fileName,
      );
      if (preferred) {
        setPickKey(preferred.key);
        setSaveFileName((current) =>
          current.trim()
            ? current
            : proposeDownloadSaveFileName(
                preferred.fileName,
                target.fileName || 'model.safetensors',
              ),
        );
      }
    },
    [target.fileName, target.versionId],
  );

  const loadFullOptions = useCallback(async () => {
    setOptionsBusy(true);
    setErr(null);
    try {
      const opts = await window.wcm.civitai.listModelDownloadOptions(target.id, {
        browseArchitectures,
      });
      applyOptions(opts);
      setFullOptionsLoaded(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setOptionsBusy(false);
    }
  }, [applyOptions, browseArchitectures, target.id]);

  // Seed from the Browse card immediately; fetch API only when we have no pick.
  useEffect(() => {
    applyOptions(instantOptions);
    setFullOptionsLoaded(false);
    if (instantOptions.picks.length === 0) {
      void loadFullOptions();
    } else {
      setOptionsBusy(false);
    }
    // Intentionally keyed on the instant snapshot for this target — not on
    // loadFullOptions, so a successful “All…” fetch is not wiped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instantOptions, target.id]);

  useEffect(() => {
    let cancelled = false;
    if (isLora) {
      void window.wcm.civitai
        .listLoraDownloadCategories()
        .then((result) => {
          if (cancelled) return;
          setLoraList(result);
          const initialPrimary = initialValues?.loraCategoryId?.trim() ?? '';
          if (
            initialPrimary &&
            result.categories.some((c) => c.id === initialPrimary)
          ) {
            setLoraCategoryId(initialPrimary);
            setExtraLoraCategoryIds(
              uniqueExtraLoraCategoryIds(
                initialPrimary,
                initialValues?.extraLoraCategoryIds,
              ).filter((id) => result.categories.some((c) => c.id === id)),
            );
            return;
          }
          const last =
            result.lastCategoryId &&
            result.categories.some((c) => c.id === result.lastCategoryId)
              ? result.lastCategoryId
              : (result.categories[0]?.id ?? '');
          setLoraCategoryId(last);
          setExtraLoraCategoryIds([]);
        })
        .catch((e) => {
          if (cancelled) return;
          setErr(e instanceof Error ? e.message : String(e));
        });
    } else {
      void window.wcm.civitai
        .listDownloadCategories(target.typeHint)
        .then((result) => {
          if (cancelled) return;
          setFolderInfo(result);
          setCategory(
            initialValues?.category !== undefined
              ? initialValues.category
              : result.lastCategory,
          );
        })
        .catch((e) => {
          if (cancelled) return;
          setErr(e instanceof Error ? e.message : String(e));
        });
    }
    return () => {
      cancelled = true;
    };
    // initialValues is fixed for the lifetime of this modal instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLora, target.typeHint]);

  const selectedPick =
    downloadOptions?.picks.find((p) => p.key === pickKey) ??
    downloadOptions?.picks[0] ??
    null;
  const markableVersions = useMemo(
    () => markDownloadedPayloads(downloadOptions.picks),
    [downloadOptions.picks],
  );

  const createCategory = async () => {
    const trimmed = newCategory.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await window.wcm.civitai.createDownloadCategory(
        target.typeHint,
        trimmed,
      );
      setFolderInfo(result);
      setCategory(
        result.categories.includes(trimmed) ? trimmed : result.lastCategory,
      );
      setNewCategory('');
      setCreating(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const selectedLora = loraList?.categories.find((c) => c.id === loraCategoryId);
  const extrasValid =
    extraLoraCategoryIds.length === 0 ||
    extraLoraCategoryIds.every(
      (id) =>
        id &&
        id !== loraCategoryId &&
        loraList?.categories.some((c) => c.id === id),
    );
  const canDownload =
    Boolean(selectedPick && !selectedPick.earlyAccess) &&
    (isLora
      ? Boolean(loraCategoryId && selectedLora && extrasValid)
      : Boolean(folderInfo));
  const fallbackFileName =
    selectedPick?.fileName?.trim() ||
    target.fileName?.trim() ||
    'model.safetensors';
  const saveNameResolved = useMemo(
    () => resolveDownloadSaveFileName(saveFileName, fallbackFileName),
    [saveFileName, fallbackFileName],
  );
  const nameIssue = saveNameResolved.ok ? null : saveNameResolved.error;

  useEffect(() => {
    if (!canDownload || !saveNameResolved.ok) {
      setDestIssue(null);
      setDestChecking(false);
      return;
    }
    let cancelled = false;
    setDestChecking(true);
    const timer = window.setTimeout(() => {
      void window.wcm.civitai
        .checkDownloadDestination({
          type: target.typeHint,
          fileName: saveNameResolved.fileName,
          fallbackFileName,
          category: isLora ? undefined : category,
          loraCategoryId: isLora ? loraCategoryId : undefined,
        })
        .then((result) => {
          if (cancelled) return;
          setDestIssue(result.ok ? null : result.error);
        })
        .catch((e) => {
          if (cancelled) return;
          setDestIssue(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setDestChecking(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    canDownload,
    saveNameResolved,
    fallbackFileName,
    isLora,
    category,
    loraCategoryId,
    target.typeHint,
  ]);

  const fileNameBlocked = Boolean(nameIssue || destIssue || destChecking);
  const canSubmit = canDownload && !fileNameBlocked && !busy;

  const categoryOptionsFor = (currentId: string, usedElsewhere: Set<string>) =>
    (loraList?.categories ?? []).filter(
      (c) => c.id === currentId || !usedElsewhere.has(c.id),
    );

  const addExtraLoraCategory = () => {
    const used = new Set(
      [loraCategoryId, ...extraLoraCategoryIds].filter(Boolean),
    );
    const next = loraList?.categories.find((c) => !used.has(c.id));
    if (!next) {
      setErr('All LoRA categories are already selected.');
      return;
    }
    setErr(null);
    setExtraLoraCategoryIds((prev) => [...prev, next.id]);
  };

  const submitDownload = () => {
    const resolved = resolveDownloadSaveFileName(saveFileName, fallbackFileName);
    if (!resolved.ok) {
      setErr(resolved.error);
      return;
    }
    if (destIssue) {
      setErr(destIssue);
      return;
    }
    if (!selectedPick) {
      setErr('Pick a model version / variant to download.');
      return;
    }
    if (selectedPick.earlyAccess) {
      setErr('That version is still early access.');
      return;
    }
    if (isLora) {
      if (!loraCategoryId) {
        setErr('Pick a LoRA category.');
        return;
      }
      if (!extrasValid) {
        setErr('Each extra category must be unique and filled in.');
        return;
      }
      const normalized = normalizeLoraWeights(weights);
      if (!normalized) {
        setErr(
          'Invalid weights. Use a number or pick-list, e.g. 0.8, -0.5, or {0.8|0.9|1|1}.',
        );
        return;
      }
      const extras = uniqueExtraLoraCategoryIds(
        loraCategoryId,
        extraLoraCategoryIds,
      );
      setErr(null);
      onConfirm({
        loraCategoryId,
        extraLoraCategoryIds: extras.length > 0 ? extras : undefined,
        weights: normalized,
        extraComment: extraComment.trim() || undefined,
        extraPrompt: extraPrompt.trim() || undefined,
        fileName: resolved.fileName,
        versionId: selectedPick.versionId,
        fileId: selectedPick.fileId || undefined,
      });
      return;
    }
    onConfirm({
      category,
      fileName: resolved.fileName,
      versionId: selectedPick.versionId,
      fileId: selectedPick.fileId || undefined,
    });
  };

  return (
    <>
      <div
        className="modal-overlay civitai-download-overlay"
        {...modalOverlayDismiss(onCancel)}
      >
        <div
          className="modal"
          style={modalStyle}
          onClick={(event) => event.stopPropagation()}
        >
          <header
            className={`modal-head modal-head-draggable${dragging ? ' dragging' : ''}`}
            title="Drag to move"
            {...headerPointerProps}
          >
            <h2>
              <Download size={18} /> {editMode ? 'Edit download' : 'Download'}
            </h2>
            <button type="button" className="icon-btn" onClick={onCancel}>
              <X size={16} />
            </button>
          </header>
          <div className="modal-body">
            <p className="hint civitai-download-target">
              <strong>{target.name}</strong>
            </p>

            <label
              className="field-label"
              htmlFor="civitai-download-pick"
              title="Version and weight variant (e.g. v2.0 · nf4 vs v2.0 · fp8)"
            >
              Version / variant
            </label>
            <div className="civitai-category-row">
              <select
                id="civitai-download-pick"
                className="text-input"
                value={pickKey ?? ''}
                disabled={
                  busy ||
                  optionsBusy ||
                  !(downloadOptions?.picks.length)
                }
                onChange={(e) => {
                  const nextKey = e.target.value;
                  setPickKey(nextKey);
                  const next =
                    downloadOptions?.picks.find((p) => p.key === nextKey) ??
                    null;
                  if (next?.fileName) {
                    setSaveFileName(
                      proposeDownloadSaveFileName(
                        next.fileName,
                        fallbackFileName,
                      ),
                    );
                  }
                }}
              >
                {optionsBusy && !(downloadOptions?.picks.length) ? (
                  <option value="">Loading versions…</option>
                ) : null}
                {(downloadOptions?.picks ?? []).map((p) => (
                  <option key={p.key} value={p.key} disabled={p.earlyAccess}>
                    {p.label}
                    {typeof p.sizeKB === 'number'
                      ? ` · ${(p.sizeKB / 1024).toFixed(1)} MB`
                      : ''}
                  </option>
                ))}
                {!optionsBusy &&
                downloadOptions &&
                downloadOptions.picks.length === 0 ? (
                  <option value="">No downloadable versions</option>
                ) : null}
              </select>
              {!fullOptionsLoaded ? (
                <button
                  type="button"
                  className="civitai-category-side-btn"
                  title="Fetch every version/variant from Civitai"
                  disabled={busy || optionsBusy}
                  onClick={() => void loadFullOptions()}
                >
                  {optionsBusy ? '…' : 'All…'}
                </button>
              ) : null}
            </div>
            {!fullOptionsLoaded && (downloadOptions?.picks.length ?? 0) > 0 ? (
              <p className="hint">
                Using the version already known from Browse. Click{' '}
                <strong>All…</strong> only if you need another version or
                variant.
              </p>
            ) : null}

            <label
              className="field-label"
              htmlFor="civitai-download-filename"
              title="Saved file name under the category folder. Names starting with V1 or optimizer are blocked. Existing files are never auto-renamed — pick a free name."
            >
              File name
            </label>
            <input
              id="civitai-download-filename"
              className="text-input mono"
              value={saveFileName}
              disabled={busy}
              placeholder={fallbackFileName}
              spellCheck={false}
              onChange={(e) => {
                setSaveFileName(e.target.value);
                setErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) {
                  e.preventDefault();
                  submitDownload();
                }
              }}
            />
            {nameIssue || destIssue ? (
              <p className="error-inline">{nameIssue ?? destIssue}</p>
            ) : destChecking ? (
              <p className="hint">Checking destination…</p>
            ) : (
              <p className="hint">
                Must be unique in the destination folder. Names starting with
                “V1” or “optimizer” are not allowed. Downloads never auto-rename.
              </p>
            )}

            {isLora ? (
              <>
                <label
                  className="field-label"
                  htmlFor="civitai-lora-category"
                  title={
                    selectedLora
                      ? [
                          `Saves under ${selectedLora.folder}/`,
                          loraList?.loraRoot
                            ? `in ${loraList.loraRoot}`
                            : null,
                          `appends to ${selectedLora.wildcardRelativePath}`,
                          extraLoraCategoryIds.length > 0
                            ? `+ ${extraLoraCategoryIds.length} more wildcard(s)`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : loraList && loraList.categories.length === 0
                        ? 'No categories yet — click … to create one (folder + wildcard).'
                        : 'Pick a LoRA category (folder + wildcard). Extra rows append the same reference to more wildcards.'
                  }
                >
                  LoRA category
                </label>
                <div className="civitai-category-row">
                  <select
                    id="civitai-lora-category"
                    className="text-input"
                    value={loraCategoryId}
                    disabled={!loraList || busy}
                    onChange={(e) => {
                      const next = e.target.value;
                      setLoraCategoryId(next);
                      setExtraLoraCategoryIds((prev) =>
                        prev.filter((id) => id !== next),
                      );
                    }}
                  >
                    <option value="">Select a category…</option>
                    {categoryOptionsFor(
                      loraCategoryId,
                      new Set(extraLoraCategoryIds),
                    ).map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="civitai-category-side-btn"
                    title="Manage LoRA categories"
                    aria-label="Manage LoRA categories"
                    disabled={busy}
                    onClick={() => setManageOpen(true)}
                  >
                    …
                  </button>
                  <button
                    type="button"
                    className="civitai-category-side-btn"
                    title="Also append to another category’s wildcard"
                    aria-label="Add another LoRA category"
                    disabled={
                      busy ||
                      !loraList ||
                      loraList.categories.length <=
                        1 + extraLoraCategoryIds.length
                    }
                    onClick={addExtraLoraCategory}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {extraLoraCategoryIds.map((extraId, index) => {
                  const usedElsewhere = new Set(
                    [
                      loraCategoryId,
                      ...extraLoraCategoryIds.filter((_, i) => i !== index),
                    ].filter(Boolean),
                  );
                  return (
                    <div
                      key={`extra-lora-cat-${index}`}
                      className="civitai-category-row civitai-category-row-extra"
                    >
                      <select
                        className="text-input"
                        value={extraId}
                        disabled={!loraList || busy}
                        aria-label={`Extra LoRA category ${index + 1}`}
                        title="Append the same <lora:…> reference to this category’s wildcard (file still saves in the primary folder)"
                        onChange={(e) => {
                          const next = e.target.value;
                          setExtraLoraCategoryIds((prev) =>
                            prev.map((id, i) => (i === index ? next : id)),
                          );
                        }}
                      >
                        <option value="">Select a category…</option>
                        {categoryOptionsFor(extraId, usedElsewhere).map(
                          (entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.name}
                            </option>
                          ),
                        )}
                      </select>
                      <button
                        type="button"
                        className="civitai-category-side-btn"
                        title="Remove this category"
                        aria-label="Remove extra LoRA category"
                        disabled={busy}
                        onClick={() =>
                          setExtraLoraCategoryIds((prev) =>
                            prev.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Minus size={16} />
                      </button>
                    </div>
                  );
                })}
                {loraList && loraList.categories.length === 0 ? (
                  <p className="hint">
                    No categories yet — click … to create one.
                  </p>
                ) : extraLoraCategoryIds.length > 0 ? (
                  <p className="hint">
                    File saves in the first category’s folder; the snippet is
                    appended to every selected wildcard.
                  </p>
                ) : null}

                <label
                  className="field-label"
                  htmlFor="civitai-lora-weights"
                  title={`Used in the <lora:…> snippet. Default each time: ${DEFAULT_LORA_DOWNLOAD_WEIGHTS}. Also accepts 0.8 or -0.5.`}
                >
                  Weights
                </label>
                <input
                  id="civitai-lora-weights"
                  className="text-input mono"
                  value={weights}
                  disabled={busy}
                  placeholder={DEFAULT_LORA_DOWNLOAD_WEIGHTS}
                  onChange={(e) => setWeights(e.target.value)}
                />

                <label
                  className="field-label"
                  htmlFor="civitai-lora-extra-comment"
                  title="Optional note inserted between the Civitai URL comment and the <lora:…> line in the category wildcard (e.g. slider value guidance). Leave empty to skip."
                >
                  Extra comment
                  <span className="hint"> (optional)</span>
                </label>
                <textarea
                  id="civitai-lora-extra-comment"
                  className="text-input"
                  rows={2}
                  value={extraComment}
                  disabled={busy}
                  placeholder="e.g. Value range −10…+10; clamped −3…6"
                  spellCheck={false}
                  onChange={(e) => setExtraComment(e.target.value)}
                />

                <label
                  className="field-label"
                  htmlFor="civitai-lora-extra-prompt"
                  title="Optional prompt text appended after trained-word triggers on the <lora:…> line (e.g. atmosphere / lighting tags). Leave empty to skip."
                >
                  Extra prompt
                  <span className="hint"> (optional)</span>
                </label>
                <input
                  id="civitai-lora-extra-prompt"
                  className="text-input"
                  value={extraPrompt}
                  disabled={busy}
                  placeholder="e.g. atmospheric, dynamic lighting, bokeh"
                  spellCheck={false}
                  onChange={(e) => setExtraPrompt(e.target.value)}
                />
              </>
            ) : (
              <>
                <label
                  className="field-label"
                  htmlFor="civitai-download-category"
                >
                  Category folder
                </label>
                <div className="civitai-category-row">
                  <select
                    id="civitai-download-category"
                    className="text-input"
                    value={category}
                    disabled={!folderInfo || busy}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="">(root folder)</option>
                    {folderInfo?.categories.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="icon-action"
                    title="Create a new category folder"
                    disabled={busy}
                    onClick={() => {
                      setCreating((current) => !current);
                      setErr(null);
                    }}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {folderInfo ? (
                  <p className="hint">
                    Saves under <code>{folderInfo.rootFolder}</code>
                    {category ? (
                      <>
                        {' '}
                        → <code>{category}</code>
                      </>
                    ) : null}
                    . Your last choice is remembered.
                  </p>
                ) : null}
                {creating ? (
                  <div className="civitai-category-create">
                    <input
                      className="text-input"
                      autoFocus
                      placeholder="New category name…"
                      value={newCategory}
                      disabled={busy}
                      onChange={(e) => setNewCategory(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void createCategory();
                      }}
                    />
                    <button
                      type="button"
                      className="manage-btn"
                      disabled={busy || !newCategory.trim()}
                      onClick={() => void createCategory()}
                    >
                      Create
                    </button>
                  </div>
                ) : null}
              </>
            )}

            {err ? <p className="error-inline">{err}</p> : null}
          </div>
          <footer className="modal-foot civitai-download-foot">
            <div className="civitai-mark-downloaded-wrap">
              {markScopeOpen ? (
                <div
                  className="civitai-mark-scope"
                  role="group"
                  aria-label="Mark as downloaded"
                >
                  <p>Mark as downloaded</p>
                  <div className="civitai-mark-scope-actions">
                    <button
                      type="button"
                      disabled={
                        !selectedPick || selectedPick.earlyAccess || busy
                      }
                      title={
                        selectedPick?.earlyAccess
                          ? 'That version is still early access'
                          : selectedPick
                            ? selectedPick.label
                            : 'Pick a version first'
                      }
                      onClick={() => {
                        if (!selectedPick || selectedPick.earlyAccess) return;
                        setMarkScopeOpen(false);
                        onMarkDownloaded([
                          {
                            versionId: selectedPick.versionId,
                            fileId: selectedPick.fileId,
                            fileName: selectedPick.fileName,
                            label: selectedPick.label,
                          },
                        ]);
                      }}
                    >
                      This version
                    </button>
                    <button
                      type="button"
                      disabled={markableVersions.length === 0 || busy}
                      onClick={() => {
                        if (markableVersions.length === 0) return;
                        setMarkScopeOpen(false);
                        onMarkDownloaded(markableVersions);
                      }}
                    >
                      All current versions ({markableVersions.length})
                    </button>
                  </div>
                  <p className="hint">
                    Marks the versions listed now. A version published later
                    stays unmarked.
                  </p>
                  <button
                    type="button"
                    onClick={() => setMarkScopeOpen(false)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                className="civitai-mark-downloaded-btn"
                title={
                  markableVersions.length > 1
                    ? 'Mark this version, or every version listed now, as already downloaded'
                    : markableVersions.length === 1
                      ? `Mark “${markableVersions[0]!.label}” as already downloaded (no file transfer)`
                      : 'No downloadable version to mark'
                }
                disabled={markableVersions.length === 0 || busy}
                onClick={() => {
                  if (markableVersions.length === 0) return;
                  if (markableVersions.length === 1) {
                    onMarkDownloaded(markableVersions);
                    return;
                  }
                  setMarkScopeOpen(true);
                }}
              >
                <CheckCircle2 size={15} /> Mark as Downloaded
              </button>
            </div>
            <div className="modal-foot-end">
              <button type="button" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={!canSubmit}
                onClick={submitDownload}
              >
                {editMode ? 'Save' : 'Download'}
              </button>
            </div>
          </footer>
        </div>
      </div>

      {manageOpen ? (
        <LoraDownloadCategoryManagerModal
          onClose={() => setManageOpen(false)}
          onChanged={(next) => {
            setLoraList(next);
            if (
              !loraCategoryId ||
              !next.categories.some((c) => c.id === loraCategoryId)
            ) {
              const pick = next.lastCategoryId ?? next.categories[0]?.id ?? '';
              setLoraCategoryId(pick);
            }
            setExtraLoraCategoryIds((prev) =>
              prev.filter((id) => next.categories.some((c) => c.id === id)),
            );
          }}
        />
      ) : null}
    </>
  );
}
