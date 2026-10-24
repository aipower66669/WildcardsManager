import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_CONVERT_CHILD_SUFFIX,
  normalizeConvertChildSuffix,
} from '../domain/convertToChild.js';
import {
  DEFAULT_CIVITAI_ORIGIN,
  normalizeCivitaiOrigin,
  type CivitaiOrigin,
} from '../domain/civitaiSnippet.js';
import {
  DEFAULT_ENABLED_ARCHITECTURES,
  DEFAULT_ENABLED_SDXL_FAMILIES,
  normalizeEnabledArchitectures,
  normalizeEnabledSdxlFamilies,
  type CivitaiArchitectureId,
  type CivitaiSdxlFamilyToggleId,
} from '../domain/civitaiBaseModels.js';
import {
  DEFAULT_ENABLED_CIVITAI_CATEGORIES,
  normalizeEnabledCivitaiCategories,
  type CivitaiModelCategoryId,
} from '../domain/civitaiModelCategories.js';
import {
  parseLoraDownloadCategories,
  type LoraDownloadCategory,
} from '../domain/loraDownloadCategory.js';
import {
  normalizePromptSubstitutions,
  type PromptSubstitution,
} from '../domain/promptSubstitution.js';
import { versionFileIsMarkedInstalled } from '../domain/civitaiVersionMark.js';
import type {
  GenerationFamily,
  GraphLayoutStyle,
  ValidationPlatform,
  CivitaiArchitectureIdDto,
  CivitaiBrowseFiltersDto,
  CivitaiBrowseKindDto,
  CivitaiImageBrowseFiltersDto,
  CivitaiModelCategoryIdDto,
  CivitaiModelTypeDto,
  CivitaiSdxlFamilyToggleIdDto,
  HfBrowseFiltersDto,
  BenchmarkResultsViewDto,
  TabPanelWidthsDto,
  WorkspaceListFiltersDto,
  WorkspaceListFilterTab,
  WorkspaceTabId,
} from '../shared/contracts.js';
import { parseBenchmarkResultsView } from '../shared/benchmarkResultsView.js';
import {
  parseWorkspaceListFilters,
  normalizeWorkspaceListFilter,
  defaultWorkspaceListFilters,
} from '../shared/workspaceListFilters.js';
import {
  DEFAULT_HF_BROWSE_FILTERS,
  parseHfBrowseFilters,
} from '../domain/huggingfaceSearch.js';
import { WORKSPACE_TAB_IDS } from '../shared/contracts.js';
import {
  applyPayloadToLibrary,
  flushLibraryLocalSync,
  persistLibraryLocalFromConfig,
  readLibraryLocalPayload,
} from './libraryLocalState.js';
import { invalidateCivitaiMediaKnown } from './civitaiMediaKnownCache.js';
import { migratePerLibraryCatalogs } from './perLibraryCatalogMigration.js';

export type WindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
};

export type ArchivedCivitaiModel = {
  origin: CivitaiOrigin;
  modelId: number;
};

/** Shelved Civitai community image (Browse hide). */
export type ArchivedCivitaiImage = {
  origin: CivitaiOrigin;
  imageId: number;
};

/** Shelved Hugging Face Hub repo (`org/name`). */
export type ArchivedHfModel = {
  repoId: string;
};

/** Manually marked download for a single version/file variant. */
export type MarkedInstalledCivitaiVersion = {
  origin: CivitaiOrigin;
  modelId: number;
  versionId: number;
  fileId: number;
  /** Used when catalog snapshots omit file ids. */
  fileName?: string;
};

/** Shortlist ("maybe later") entry — same shape as an archive entry. */
export type MaybeCivitaiModel = {
  origin: CivitaiOrigin;
  modelId: number;
};

/** Creator whose Browse cards are hidden for this library / origin. */
export type BlockedCivitaiCreator = {
  origin: CivitaiOrigin;
  /** Display username as blocked (matching is case-insensitive). */
  username: string;
  addedAt: string;
};

/** @deprecated Use ArchivedCivitaiModel */
export type HiddenCivitaiModel = ArchivedCivitaiModel;

export type WatchedCivitaiModel = {
  origin: CivitaiOrigin;
  modelId: number;
  modelName: string;
  type: 'LORA' | 'Checkpoint';
  versionId?: number;
  earlyAccessEndsAt?: string;
  /** True once a refresh found the model is no longer early-access. */
  available: boolean;
  addedAt: string;
  availableAt?: string;
};

/** Left Notify after early access ended — kept findable until dismissed. */
export type RecentlyUnlockedCivitaiModel = {
  origin: CivitaiOrigin;
  modelId: number;
  modelName: string;
  type: 'LORA' | 'Checkpoint';
  versionId?: number;
  unlockedAt: string;
};

/** Named library config: folders + per-library Civitai tracking. */
export type LibraryConfig = {
  id: string;
  name: string;
  wildcardsRoot: string | null;
  loraFolder: string | null;
  checkpointFolder: string | null;
  /** Root for Civitai community image downloads (`{baseModel}/file`). */
  imagesFolder: string | null;
  /** Root for Civitai community video downloads (`{baseModel}/file`). */
  videosFolder: string | null;
  /**
   * Folder of external “master” collage JPGs for checkpoints (same stem as the
   * `.safetensors`, typically 13 images: 1 master + 12 gens).
   */
  mastersFolder: string | null;
  /**
   * Root of the local LoRA training library (dataset folders with
   * `dataset.json` + preview icons for multi-step series).
   */
  trainingLibraryFolder: string | null;
  /** Root folder for prompt categories (`!gen.txt` + sample images). */
  promptsFolder: string | null;
  /** Generation image output roots (Realistic / Hentai / 3D). */
  generationOutputRealistic: string | null;
  generationOutputHentai: string | null;
  generationOutput3d: string | null;
  /** Root for Checkpoint Benchmark image folders + stats JSON. */
  benchmarkOutputFolder: string | null;
  lastRootFile?: string;
  ignoredUnusedLoras?: string[];
  /**
   * Checkpoints this library does not use (root-relative paths). Lives in
   * `library.json`, not on the shared checkpoint folder.
   */
  ignoredCheckpoints?: string[];
  /**
   * Before a Generation prompt is expanded, replace text when the checkpoint
   * file name contains a keyword. Lives in this library’s `library.json`.
   */
  promptSubstitutions?: PromptSubstitution[];
  archivedCivitaiModels?: ArchivedCivitaiModel[];
  /** Shelved Civitai community image ids for this library. */
  archivedCivitaiImages?: ArchivedCivitaiImage[];
  /** Shelved Civitai community video ids for this library. */
  archivedCivitaiVideos?: ArchivedCivitaiImage[];
  /** Shelved Hugging Face Hub repos (`org/name`) for this library. */
  archivedHfModels?: ArchivedHfModel[];
  /** Hub repos this library has downloaded. Hidden from Browse. */
  downloadedHfModels?: ArchivedHfModel[];
  maybeCivitaiModels?: MaybeCivitaiModel[];
  markedInstalledCivitaiModels?: ArchivedCivitaiModel[];
  /** Per-version/file “Mark as Downloaded” from the download dialog. */
  markedInstalledCivitaiVersions?: MarkedInstalledCivitaiVersion[];
  civitaiWatchlist?: WatchedCivitaiModel[];
  /** Models that left Notify after unlock — pinned in Browse until dismissed. */
  civitaiRecentlyUnlocked?: RecentlyUnlockedCivitaiModel[];
  /** Creators whose Browse cards are hidden for this library. */
  blockedCivitaiCreators?: BlockedCivitaiCreator[];
  lastCivitaiDownloadCategory?: Partial<Record<'LORA' | 'Checkpoint', string>>;
  /** Named LoRA download destinations (folder + wildcard + weights). */
  loraDownloadCategories?: LoraDownloadCategory[];
  /** Last selected LoRA download category id. */
  lastLoraDownloadCategoryId?: string;
  civitaiBrowseFilters?: CivitaiBrowseFiltersDto;
  /** Last Civitai Images tab filters for this library. */
  civitaiImageBrowseFilters?: CivitaiImageBrowseFiltersDto;
  /** Last Civitai Videos tab filters for this library. */
  civitaiVideoBrowseFilters?: CivitaiImageBrowseFiltersDto;
  /** Last Hugging Face Hub search filters for this library. */
  hfBrowseFilters?: HfBrowseFiltersDto;
  /** Base-model groups this library may browse (sync still fills full arch slices). */
  enabledArchitectures: CivitaiArchitectureId[];
  /** SDXL families this library may browse when Base Model is SDXL. */
  enabledSdxlFamilies: CivitaiSdxlFamilyToggleId[];
  /**
   * Civitai model categories this library may browse/sync.
   * Hidden categories keep on-disk catalog + previews; they are not updated
   * and their missing previews are not queued.
   */
  enabledCivitaiCategories: CivitaiModelCategoryId[];
  /**
   * Wildcard validation target for this library.
   * ComfyUI rejects Dynamic Prompt logic inside `__wildcard__` names.
   */
  validationPlatform: ValidationPlatform;
  /**
   * Generation graph family. `krea2` keeps the current Generation screen.
   * `sdxl` hides CLIP and VAE and queues the hires upscaler graph.
   */
  generationFamily: GenerationFamily;
  /** Civitai site this library browses/downloads from (.com vs .red). */
  civitaiOrigin: CivitaiOrigin;
};

type Settings = {
  recentRoots: string[];
  /** @deprecated Mirror of active library wildcardsRoot — kept for older readers. */
  lastRoot?: string;
  /** @deprecated Mirror of active library lastRootFile. */
  lastRootFile?: string;
  detailsPanelWidth?: number;
  filesPanelWidth?: number;
  /** Per main-workspace-tab files/details splitter widths. */
  panelWidthsByTab?: Partial<Record<WorkspaceTabId, TabPanelWidthsDto>>;
  /** Prompts tab Samples side panel collapsed (UI preference). */
  promptsSamplesCollapsed?: boolean;
  /** Generation tab Last output side panel collapsed (UI preference). */
  generationPreviewCollapsed?: boolean;
  /** Additional Positive Prompt textarea height in px. */
  generationAdditionalPositiveHeight?: number;
  /** Negative Prompt textarea height in px. */
  generationNegativePromptHeight?: number;
  /** Prompt Coverage floating window geometry. */
  promptCoverageWindow?: {
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
  };
  /** Generation prompt-substitutions dialog floating window geometry. */
  promptSubstitutionsWindow?: {
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
  };
  /** Checkpoint Benchmark results chart floating window geometry. */
  benchmarkResultsWindow?: {
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
  };
  /** Checkpoint Benchmark results name filter and sort. */
  benchmarkResultsView?: BenchmarkResultsViewDto;
  simulationIterations?: number;
  simulationSeed?: number;
  graphLayoutStyle?: GraphLayoutStyle;
  workspaceListFilters?: WorkspaceListFiltersDto;
  validationPlatform?: ValidationPlatform;
  convertChildSuffix?: string;
  /** @deprecated Mirror of active library loraFolder. */
  loraFolder?: string;
  /** @deprecated Mirror of active library checkpointFolder. */
  checkpointFolder?: string;
  /** @deprecated Mirror of active library imagesFolder. */
  imagesFolder?: string;
  /** @deprecated Mirror of active library videosFolder. */
  videosFolder?: string;
  /** @deprecated Mirror of active library mastersFolder. */
  mastersFolder?: string;
  /** @deprecated Mirror of active library trainingLibraryFolder. */
  trainingLibraryFolder?: string;
  /** @deprecated Mirror of active library promptsFolder. */
  promptsFolder?: string;
  /** @deprecated Mirror of active library ignoredUnusedLoras. */
  ignoredUnusedLoras?: string[];
  /** @deprecated Mirror of active library civitaiOrigin. */
  civitaiOrigin?: CivitaiOrigin;
  civitaiApiKey?: string;
  /** Hugging Face Hub token for gated search/downloads. */
  huggingfaceToken?: string;
  /**
   * Minutes between automatic Browse “new models” tip-checks while idle.
   * 0 = never auto tip-check (manual refresh / filter change still sync;
   * incomplete catalogs still backfill). Default 5.
   */
  civitaiCatalogAutoSyncIntervalMinutes?: number;
  /** @deprecated Mirror of active library archivedCivitaiModels. */
  archivedCivitaiModels?: ArchivedCivitaiModel[];
  /** @deprecated Mirror of active library archivedCivitaiImages. */
  archivedCivitaiImages?: ArchivedCivitaiImage[];
  /** @deprecated Mirror of active library archivedCivitaiVideos. */
  archivedCivitaiVideos?: ArchivedCivitaiImage[];
  /** @deprecated migrated to archivedCivitaiModels */
  hiddenCivitaiModels?: ArchivedCivitaiModel[];
  /** @deprecated Mirror of active library maybeCivitaiModels. */
  maybeCivitaiModels?: MaybeCivitaiModel[];
  /** One-time flag: existing archive entries were moved into the Maybe list. */
  archiveToMaybeMigrated?: boolean;
  /** @deprecated Mirror of active library markedInstalledCivitaiModels. */
  markedInstalledCivitaiModels?: ArchivedCivitaiModel[];
  /** @deprecated Mirror of active library markedInstalledCivitaiVersions. */
  markedInstalledCivitaiVersions?: MarkedInstalledCivitaiVersion[];
  /** @deprecated Mirror of active library civitaiWatchlist. */
  civitaiWatchlist?: WatchedCivitaiModel[];
  /** @deprecated Mirror of active library blockedCivitaiCreators. */
  blockedCivitaiCreators?: BlockedCivitaiCreator[];
  /** When true, Civitai browser opens as a separate OS window. */
  civitaiBrowserDetached?: boolean;
  civitaiWindowState?: WindowState;
  /** Remembered bounds for the detached Hugging Face window. */
  hfWindowState?: WindowState;
  /** @deprecated Mirror of active library lastCivitaiDownloadCategory. */
  lastCivitaiDownloadCategory?: Partial<Record<'LORA' | 'Checkpoint', string>>;
  /** @deprecated Mirror of active library civitaiBrowseFilters. */
  civitaiBrowseFilters?: CivitaiBrowseFiltersDto;
  /** Left pane fraction for the Civitai card-grid / preview split. */
  civitaiSplitRatio?: number;
  /** Card grid min column width in px for the Civitai browser. */
  civitaiCardMinWidth?: number;
  windowState?: WindowState;
  libraries?: LibraryConfig[];
  activeLibraryId?: string;
  /**
   * When true (default), Chromium uses software rendering so the app fights
   * less with Comfy/A1111 for the GPU. Requires app restart to apply.
   */
  disableHardwareAcceleration?: boolean;
  /**
   * When true, folder-mode Generation output goes in `{prompt folder}/New`.
   * Default off. ComfyUI creates the folder when it saves.
   */
  generationSaveInNewSubfolder?: boolean;
  /**
   * Folder of electron-builder installers (`release/`) used by in-app Update.
   * App-global (not per library).
   */
  updateReleaseFolder?: string | null;
};

const DEFAULTS: Settings = { recentRoots: [] };

const DEFAULT_TAB_PANEL_WIDTHS: Record<WorkspaceTabId, TabPanelWidthsDto> = {
  prompts: { filesPanelWidth: 240, detailsPanelWidth: 330 },
  generation: { filesPanelWidth: 240, detailsPanelWidth: 420 },
  wildcards: { filesPanelWidth: 240, detailsPanelWidth: 330 },
  loras: { filesPanelWidth: 240, detailsPanelWidth: 420 },
  checkpoints: { filesPanelWidth: 240, detailsPanelWidth: 420 },
  search: { filesPanelWidth: 240, detailsPanelWidth: 420 },
};

function clampStoredFilesWidth(width: number): number {
  return Math.max(160, Math.min(720, Math.round(width)));
}

function clampStoredDetailsWidth(width: number): number {
  return Math.max(240, Math.min(1200, Math.round(width)));
}

function parseTabPanelWidths(raw: unknown): TabPanelWidthsDto | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const files =
    typeof rec.filesPanelWidth === 'number' &&
    Number.isFinite(rec.filesPanelWidth)
      ? clampStoredFilesWidth(rec.filesPanelWidth)
      : null;
  const details =
    typeof rec.detailsPanelWidth === 'number' &&
    Number.isFinite(rec.detailsPanelWidth)
      ? clampStoredDetailsWidth(rec.detailsPanelWidth)
      : null;
  if (files === null || details === null) return null;
  return { filesPanelWidth: files, detailsPanelWidth: details };
}

function parsePanelWidthsByTab(
  raw: unknown,
): Partial<Record<WorkspaceTabId, TabPanelWidthsDto>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const out: Partial<Record<WorkspaceTabId, TabPanelWidthsDto>> = {};
  for (const tab of WORKSPACE_TAB_IDS) {
    const parsed = parseTabPanelWidths(rec[tab]);
    if (parsed) out[tab] = parsed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseFloatingWindow(
  raw: unknown,
): Settings['promptCoverageWindow'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const nums = ['x', 'y', 'width', 'height'] as const;
  for (const key of nums) {
    if (typeof rec[key] !== 'number' || !Number.isFinite(rec[key])) {
      return undefined;
    }
  }
  return {
    x: Math.round(rec.x as number),
    y: Math.round(rec.y as number),
    width: Math.max(320, Math.round(rec.width as number)),
    height: Math.max(240, Math.round(rec.height as number)),
    maximized: rec.maximized === true,
  };
}

/** Resolve per-tab widths, migrating legacy global widths onto wildcards. */
export function resolvePanelWidthsByTab(
  settings: Settings,
): Record<WorkspaceTabId, TabPanelWidthsDto> {
  const out: Record<WorkspaceTabId, TabPanelWidthsDto> = {
    ...DEFAULT_TAB_PANEL_WIDTHS,
  };
  for (const tab of WORKSPACE_TAB_IDS) {
    const saved = settings.panelWidthsByTab?.[tab];
    if (saved) out[tab] = { ...saved };
  }
  const hasAnyTab = WORKSPACE_TAB_IDS.some(
    (tab) => settings.panelWidthsByTab?.[tab],
  );
  if (!hasAnyTab) {
    const legacyFiles =
      typeof settings.filesPanelWidth === 'number' &&
      Number.isFinite(settings.filesPanelWidth)
        ? clampStoredFilesWidth(settings.filesPanelWidth)
        : null;
    const legacyDetails =
      typeof settings.detailsPanelWidth === 'number' &&
      Number.isFinite(settings.detailsPanelWidth)
        ? clampStoredDetailsWidth(settings.detailsPanelWidth)
        : null;
    if (legacyFiles !== null || legacyDetails !== null) {
      out.wildcards = {
        filesPanelWidth: legacyFiles ?? out.wildcards.filesPanelWidth,
        detailsPanelWidth: legacyDetails ?? out.wildcards.detailsPanelWidth,
      };
    }
  }
  return out;
}

function isWorkspaceTabId(value: unknown): value is WorkspaceTabId {
  return (
    typeof value === 'string' &&
    (WORKSPACE_TAB_IDS as readonly string[]).includes(value)
  );
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function atomicWrite(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, data, 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch {
    // Windows cannot rename over an existing file. Prefer copy+unlink over
    // unlink-then-rename — the latter leaves a gap where settings.json is gone
    // if the process dies mid-write (worse with multi-MB settings files).
    fs.copyFileSync(temp, file);
    try {
      fs.unlinkSync(temp);
    } catch {
      // temp cleanup is best-effort
    }
  }
}

function parseArchivedCivitaiModels(raw: unknown): ArchivedCivitaiModel[] {
  if (!Array.isArray(raw)) return [];
  const out: ArchivedCivitaiModel[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { origin?: unknown; modelId?: unknown };
    if (typeof row.modelId !== 'number' || !Number.isFinite(row.modelId)) {
      continue;
    }
    const origin = normalizeCivitaiOrigin(
      typeof row.origin === 'string' ? row.origin : DEFAULT_CIVITAI_ORIGIN,
    );
    const modelId = Math.round(row.modelId);
    const key = `${origin}:${modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ origin, modelId });
  }
  return out.sort(
    (a, b) => a.origin.localeCompare(b.origin) || a.modelId - b.modelId,
  );
}

function parseArchivedCivitaiImages(raw: unknown): ArchivedCivitaiImage[] {
  if (!Array.isArray(raw)) return [];
  const out: ArchivedCivitaiImage[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { origin?: unknown; imageId?: unknown };
    if (typeof row.imageId !== 'number' || !Number.isFinite(row.imageId)) {
      continue;
    }
    const origin = normalizeCivitaiOrigin(
      typeof row.origin === 'string' ? row.origin : DEFAULT_CIVITAI_ORIGIN,
    );
    const imageId = Math.round(row.imageId);
    const key = `${origin}:${imageId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ origin, imageId });
  }
  return out.sort(
    (a, b) => a.origin.localeCompare(b.origin) || a.imageId - b.imageId,
  );
}

function normalizeHfRepoId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().replace(/^\/+|\/+$/g, '');
  if (!id || id.includes('..') || id.includes('\\')) return null;
  // Hub ids are `org/name` (or rarely a single segment for legacy).
  if (!/^[A-Za-z0-9][\w.\-+]*(?:\/[A-Za-z0-9][\w.\-+]*)?$/.test(id)) {
    return null;
  }
  return id;
}

function parseArchivedHfModels(raw: unknown): ArchivedHfModel[] {
  if (!Array.isArray(raw)) return [];
  const out: ArchivedHfModel[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let repoId: string | null = null;
    if (typeof item === 'string') {
      repoId = normalizeHfRepoId(item);
    } else if (item && typeof item === 'object') {
      const row = item as { repoId?: unknown; id?: unknown };
      repoId = normalizeHfRepoId(row.repoId) ?? normalizeHfRepoId(row.id);
    }
    if (!repoId) continue;
    const key = repoId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ repoId });
  }
  return out.sort((a, b) =>
    a.repoId.toLowerCase().localeCompare(b.repoId.toLowerCase()),
  );
}

function parseBlockedCivitaiCreators(raw: unknown): BlockedCivitaiCreator[] {
  if (!Array.isArray(raw)) return [];
  const out: BlockedCivitaiCreator[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as {
      origin?: unknown;
      username?: unknown;
      addedAt?: unknown;
    };
    const username =
      typeof row.username === 'string' ? row.username.trim() : '';
    if (!username) continue;
    const origin = normalizeCivitaiOrigin(
      typeof row.origin === 'string' ? row.origin : DEFAULT_CIVITAI_ORIGIN,
    );
    const key = `${origin}:${username.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const addedAt =
      typeof row.addedAt === 'string' && row.addedAt.trim()
        ? row.addedAt.trim()
        : new Date(0).toISOString();
    out.push({ origin, username, addedAt });
  }
  return out.sort(
    (a, b) =>
      a.origin.localeCompare(b.origin) ||
      a.username.toLowerCase().localeCompare(b.username.toLowerCase()),
  );
}

function markedVersionKey(
  modelId: number,
  versionId: number,
  fileId: number,
): string {
  return `${Math.round(modelId)}:${Math.round(versionId)}:${Math.round(fileId)}`;
}

function parseMarkedInstalledCivitaiVersions(
  raw: unknown,
): MarkedInstalledCivitaiVersion[] {
  if (!Array.isArray(raw)) return [];
  const out: MarkedInstalledCivitaiVersion[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as {
      origin?: unknown;
      modelId?: unknown;
      versionId?: unknown;
      fileId?: unknown;
      fileName?: unknown;
    };
    if (
      typeof row.modelId !== 'number' ||
      !Number.isFinite(row.modelId) ||
      typeof row.versionId !== 'number' ||
      !Number.isFinite(row.versionId) ||
      typeof row.fileId !== 'number' ||
      !Number.isFinite(row.fileId)
    ) {
      continue;
    }
    const origin = normalizeCivitaiOrigin(
      typeof row.origin === 'string' ? row.origin : DEFAULT_CIVITAI_ORIGIN,
    );
    const modelId = Math.round(row.modelId);
    const versionId = Math.round(row.versionId);
    const fileId = Math.round(row.fileId);
    const fileName =
      typeof row.fileName === 'string' && row.fileName.trim()
        ? row.fileName.trim()
        : undefined;
    const key = `${origin}:${markedVersionKey(modelId, versionId, fileId)}:${(
      fileName ?? ''
    ).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ origin, modelId, versionId, fileId, fileName });
  }
  return out.sort(
    (a, b) =>
      a.origin.localeCompare(b.origin) ||
      a.modelId - b.modelId ||
      a.versionId - b.versionId ||
      a.fileId - b.fileId,
  );
}

function parseCivitaiWatchlist(raw: unknown): WatchedCivitaiModel[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchedCivitaiModel[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.modelId !== 'number' || !Number.isFinite(row.modelId)) {
      continue;
    }
    const origin = normalizeCivitaiOrigin(
      typeof row.origin === 'string' ? row.origin : DEFAULT_CIVITAI_ORIGIN,
    );
    const modelId = Math.round(row.modelId);
    const key = `${origin}:${modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const type = row.type === 'Checkpoint' ? 'Checkpoint' : 'LORA';
    out.push({
      origin,
      modelId,
      modelName:
        typeof row.modelName === 'string' && row.modelName.trim()
          ? row.modelName.trim()
          : String(modelId),
      type,
      versionId:
        typeof row.versionId === 'number' && Number.isFinite(row.versionId)
          ? Math.round(row.versionId)
          : undefined,
      earlyAccessEndsAt:
        typeof row.earlyAccessEndsAt === 'string'
          ? row.earlyAccessEndsAt
          : undefined,
      available: row.available === true,
      addedAt:
        typeof row.addedAt === 'string' && row.addedAt
          ? row.addedAt
          : new Date().toISOString(),
      availableAt:
        typeof row.availableAt === 'string' ? row.availableAt : undefined,
    });
  }
  return out.sort(
    (a, b) =>
      a.origin.localeCompare(b.origin) ||
      Number(b.available) - Number(a.available) ||
      a.modelName.localeCompare(b.modelName),
  );
}

const MAX_RECENTLY_UNLOCKED = 40;
const RECENTLY_UNLOCKED_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function parseCivitaiRecentlyUnlocked(
  raw: unknown,
): RecentlyUnlockedCivitaiModel[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentlyUnlockedCivitaiModel[] = [];
  const seen = new Set<string>();
  const cutoff = Date.now() - RECENTLY_UNLOCKED_MAX_AGE_MS;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.modelId !== 'number' || !Number.isFinite(row.modelId)) {
      continue;
    }
    const origin = normalizeCivitaiOrigin(
      typeof row.origin === 'string' ? row.origin : DEFAULT_CIVITAI_ORIGIN,
    );
    const modelId = Math.round(row.modelId);
    const key = `${origin}:${modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const unlockedAt =
      typeof row.unlockedAt === 'string' && row.unlockedAt
        ? row.unlockedAt
        : new Date().toISOString();
    const unlockedMs = Date.parse(unlockedAt);
    if (Number.isFinite(unlockedMs) && unlockedMs < cutoff) continue;
    const type = row.type === 'Checkpoint' ? 'Checkpoint' : 'LORA';
    out.push({
      origin,
      modelId,
      modelName:
        typeof row.modelName === 'string' && row.modelName.trim()
          ? row.modelName.trim()
          : String(modelId),
      type,
      versionId:
        typeof row.versionId === 'number' && Number.isFinite(row.versionId)
          ? Math.round(row.versionId)
          : undefined,
      unlockedAt,
    });
  }
  return out.sort(
    (a, b) => Date.parse(b.unlockedAt) - Date.parse(a.unlockedAt),
  );
}

const ARCHITECTURE_IDS: CivitaiArchitectureIdDto[] = [
  'sd15',
  'sd2',
  'sd3',
  'sdxl',
  'flux',
  'krea',
  'pixart',
  'wan',
  'other',
];

const MODEL_CATEGORY_IDS: CivitaiModelCategoryIdDto[] = [
  'character',
  'style',
  'concept',
  'clothing',
  'base model',
  'background',
  'poses',
  'tool',
  'assets',
  'vehicle',
  'buildings',
  'objects',
  'animal',
  'action',
];

export const DEFAULT_CIVITAI_BROWSE_FILTERS: CivitaiBrowseFiltersDto = {
  type: 'LORA',
  browseKind: 'LORA',
  sort: 'newest',
  nsfw: false,
  hideInstalled: true,
  onlyNew: false,
  onlyPotentialDuplicate: false,
  includeArchived: false,
  includeMaybe: false,
  /** Always one architecture — Browse never shows "All". */
  architectures: ['sd15'],
  sdxlFamily: 'all',
  category: null,
};

export const DEFAULT_CIVITAI_IMAGE_BROWSE_FILTERS: CivitaiImageBrowseFiltersDto =
  {
    sort: 'Newest',
    period: 'AllTime',
    nsfwMode: 'sfw',
    tool: 'any',
    tab: 'browse',
    architecture: 'krea',
    sdxlFamily: 'all',
  };

const IMAGE_SORTS: CivitaiImageBrowseFiltersDto['sort'][] = [
  'Newest',
  'Most Reactions',
  'Most Comments',
  'Most Collected',
];

const IMAGE_PERIODS: CivitaiImageBrowseFiltersDto['period'][] = [
  'AllTime',
  'Year',
  'Month',
  'Week',
  'Day',
];

const IMAGE_NSFW_MODES: CivitaiImageBrowseFiltersDto['nsfwMode'][] = [
  'sfw',
  'all',
  'nsfw',
];

const IMAGE_TOOLS: CivitaiImageBrowseFiltersDto['tool'][] = [
  'any',
  'krea',
  'comfyui',
  'civitai',
  'automatic1111',
  'forge',
  'swarmui',
  'fooocus',
];

const IMAGE_TABS: CivitaiImageBrowseFiltersDto['tab'][] = [
  'browse',
  'downloaded',
  'archive',
];

function parseCivitaiBrowseFilters(raw: unknown): CivitaiBrowseFiltersDto {
  const defaults = { ...DEFAULT_CIVITAI_BROWSE_FILTERS };
  if (!raw || typeof raw !== 'object') return defaults;
  const row = raw as Record<string, unknown>;
  const type: CivitaiModelTypeDto =
    row.type === 'Checkpoint' ? 'Checkpoint' : 'LORA';
  const browseKindRaw = row.browseKind;
  const browseKind: CivitaiBrowseKindDto =
    browseKindRaw === 'Images' ||
    browseKindRaw === 'Videos' ||
    browseKindRaw === 'LORA' ||
    browseKindRaw === 'Checkpoint'
      ? browseKindRaw
      : type;
  const sort: CivitaiBrowseFiltersDto['sort'] =
    row.sort === 'name' || row.sort === 'creator' || row.sort === 'newest'
      ? row.sort
      : row.sort === 'Newest' ||
          row.sort === 'Most Downloaded' ||
          row.sort === 'Highest Rated'
        ? 'newest'
        : defaults.sort;
  const architectures = Array.isArray(row.architectures)
    ? row.architectures
        .filter((value): value is CivitaiArchitectureIdDto =>
          ARCHITECTURE_IDS.includes(value as CivitaiArchitectureIdDto),
        )
        .slice(0, 1)
    : [];
  const sdxlFamilyRaw = row.sdxlFamily;
  const sdxlFamily: CivitaiBrowseFiltersDto['sdxlFamily'] =
    sdxlFamilyRaw === 'sdxl' ||
    sdxlFamilyRaw === 'pony' ||
    sdxlFamilyRaw === 'illustrious' ||
    sdxlFamilyRaw === 'noobai' ||
    sdxlFamilyRaw === 'all'
      ? sdxlFamilyRaw
      : defaults.sdxlFamily;
  const category =
    typeof row.category === 'string' &&
    MODEL_CATEGORY_IDS.includes(row.category as CivitaiModelCategoryIdDto)
      ? (row.category as CivitaiModelCategoryIdDto)
      : null;
  return {
    type,
    browseKind,
    sort,
    nsfw: row.nsfw === true,
    hideInstalled: row.hideInstalled !== false,
    onlyNew: row.onlyNew === true,
    onlyPotentialDuplicate: row.onlyPotentialDuplicate === true,
    includeArchived: row.includeArchived === true,
    includeMaybe: row.includeMaybe === true,
    architectures:
      architectures.length > 0 ? architectures : [...defaults.architectures],
    sdxlFamily,
    category,
  };
}

export function parseCivitaiImageBrowseFilters(
  raw: unknown,
): CivitaiImageBrowseFiltersDto {
  const defaults = { ...DEFAULT_CIVITAI_IMAGE_BROWSE_FILTERS };
  if (!raw || typeof raw !== 'object') return defaults;
  const row = raw as Record<string, unknown>;
  const architecture = ARCHITECTURE_IDS.includes(
    row.architecture as CivitaiArchitectureIdDto,
  )
    ? (row.architecture as CivitaiArchitectureIdDto)
    : defaults.architecture;
  const sdxlFamilyRaw = row.sdxlFamily;
  const sdxlFamily: CivitaiImageBrowseFiltersDto['sdxlFamily'] =
    sdxlFamilyRaw === 'sdxl' ||
    sdxlFamilyRaw === 'pony' ||
    sdxlFamilyRaw === 'illustrious' ||
    sdxlFamilyRaw === 'noobai' ||
    sdxlFamilyRaw === 'all'
      ? sdxlFamilyRaw
      : defaults.sdxlFamily;
  return {
    sort: IMAGE_SORTS.includes(row.sort as CivitaiImageBrowseFiltersDto['sort'])
      ? (row.sort as CivitaiImageBrowseFiltersDto['sort'])
      : defaults.sort,
    period: IMAGE_PERIODS.includes(
      row.period as CivitaiImageBrowseFiltersDto['period'],
    )
      ? (row.period as CivitaiImageBrowseFiltersDto['period'])
      : defaults.period,
    nsfwMode: IMAGE_NSFW_MODES.includes(
      row.nsfwMode as CivitaiImageBrowseFiltersDto['nsfwMode'],
    )
      ? (row.nsfwMode as CivitaiImageBrowseFiltersDto['nsfwMode'])
      : defaults.nsfwMode,
    tool: IMAGE_TOOLS.includes(row.tool as CivitaiImageBrowseFiltersDto['tool'])
      ? (row.tool as CivitaiImageBrowseFiltersDto['tool'])
      : defaults.tool,
    tab: IMAGE_TABS.includes(row.tab as CivitaiImageBrowseFiltersDto['tab'])
      ? (row.tab as CivitaiImageBrowseFiltersDto['tab'])
      : defaults.tab,
    architecture,
    sdxlFamily: architecture === 'sdxl' ? sdxlFamily : 'all',
  };
}

function parseLastCivitaiDownloadCategory(
  raw: unknown,
): Partial<Record<'LORA' | 'Checkpoint', string>> {
  if (!raw || typeof raw !== 'object') return {};
  const row = raw as Record<string, unknown>;
  const out: Partial<Record<'LORA' | 'Checkpoint', string>> = {};
  if (typeof row.LORA === 'string') out.LORA = row.LORA.trim();
  if (typeof row.Checkpoint === 'string') {
    out.Checkpoint = row.Checkpoint.trim();
  }
  return out;
}

function parseWindowState(raw: unknown): WindowState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const state = raw as Record<string, unknown>;
  if (
    typeof state.x !== 'number' ||
    !Number.isFinite(state.x) ||
    typeof state.y !== 'number' ||
    !Number.isFinite(state.y) ||
    typeof state.width !== 'number' ||
    !Number.isFinite(state.width) ||
    typeof state.height !== 'number' ||
    !Number.isFinite(state.height)
  ) {
    return undefined;
  }
  return {
    x: Math.round(state.x),
    y: Math.round(state.y),
    width: Math.round(state.width),
    height: Math.round(state.height),
    maximized: state.maximized === true,
  };
}

function resolveOptionalDir(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return path.resolve(raw.trim());
}

/**
 * Library ids whose settings.json record already has base-model, SDXL-family,
 * and category choices. Those must not be replaced by library.json: that file
 * is one per wildcards folder, so two libraries sharing a folder would
 * otherwise load whichever library saved last.
 */
const modelFiltersSavedOnPointer = new Set<string>();

function pointerHasModelFilters(row: Record<string, unknown>): boolean {
  return (
    Array.isArray(row.enabledArchitectures) &&
    Array.isArray(row.enabledSdxlFamilies) &&
    Array.isArray(row.enabledCivitaiCategories)
  );
}

function parseLibraryConfig(
  raw: unknown,
  fallbackPlatform: ValidationPlatform = 'comfyui',
  fallbackOrigin: CivitaiOrigin = DEFAULT_CIVITAI_ORIGIN,
): LibraryConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id =
    typeof row.id === 'string' && row.id.trim() ? row.id.trim() : randomUUID();
  const name =
    typeof row.name === 'string' && row.name.trim()
      ? row.name.trim()
      : 'Library';
  return {
    id,
    name,
    wildcardsRoot: resolveOptionalDir(row.wildcardsRoot),
    loraFolder: resolveOptionalDir(row.loraFolder),
    checkpointFolder: resolveOptionalDir(row.checkpointFolder),
    imagesFolder: resolveOptionalDir(row.imagesFolder),
    videosFolder: resolveOptionalDir(row.videosFolder),
    mastersFolder: resolveOptionalDir(row.mastersFolder),
    trainingLibraryFolder: resolveOptionalDir(row.trainingLibraryFolder),
    promptsFolder: resolveOptionalDir(row.promptsFolder),
    generationOutputRealistic: resolveOptionalDir(
      row.generationOutputRealistic,
    ),
    generationOutputHentai: resolveOptionalDir(row.generationOutputHentai),
    generationOutput3d: resolveOptionalDir(row.generationOutput3d),
    benchmarkOutputFolder: resolveOptionalDir(row.benchmarkOutputFolder),
    lastRootFile:
      typeof row.lastRootFile === 'string' && row.lastRootFile.trim()
        ? row.lastRootFile.trim().replaceAll('\\', '/')
        : undefined,
    ignoredUnusedLoras: Array.isArray(row.ignoredUnusedLoras)
      ? [
          ...new Set(
            row.ignoredUnusedLoras
              .filter((value): value is string => typeof value === 'string')
              .map((value) => value.trim().replaceAll('\\', '/'))
              .filter(Boolean),
          ),
        ]
      : [],
    ignoredCheckpoints: Array.isArray(row.ignoredCheckpoints)
      ? [
          ...new Set(
            row.ignoredCheckpoints
              .filter((value): value is string => typeof value === 'string')
              .map((value) => value.trim().replaceAll('\\', '/'))
              .filter(Boolean),
          ),
        ]
      : [],
    promptSubstitutions: normalizePromptSubstitutions(row.promptSubstitutions),
    archivedCivitaiModels: parseArchivedCivitaiModels(row.archivedCivitaiModels),
    archivedCivitaiImages: parseArchivedCivitaiImages(row.archivedCivitaiImages),
    archivedCivitaiVideos: parseArchivedCivitaiImages(row.archivedCivitaiVideos),
    archivedHfModels: parseArchivedHfModels(row.archivedHfModels),
    downloadedHfModels: parseArchivedHfModels(row.downloadedHfModels),
    maybeCivitaiModels: parseArchivedCivitaiModels(row.maybeCivitaiModels),
    markedInstalledCivitaiModels: parseArchivedCivitaiModels(
      row.markedInstalledCivitaiModels,
    ),
    markedInstalledCivitaiVersions: parseMarkedInstalledCivitaiVersions(
      row.markedInstalledCivitaiVersions,
    ),
    civitaiWatchlist: parseCivitaiWatchlist(row.civitaiWatchlist),
    civitaiRecentlyUnlocked: parseCivitaiRecentlyUnlocked(
      row.civitaiRecentlyUnlocked,
    ),
    blockedCivitaiCreators: parseBlockedCivitaiCreators(
      row.blockedCivitaiCreators,
    ),
    lastCivitaiDownloadCategory: parseLastCivitaiDownloadCategory(
      row.lastCivitaiDownloadCategory,
    ),
    loraDownloadCategories: parseLoraDownloadCategories(
      row.loraDownloadCategories,
    ),
    lastLoraDownloadCategoryId:
      typeof row.lastLoraDownloadCategoryId === 'string' &&
      row.lastLoraDownloadCategoryId.trim()
        ? row.lastLoraDownloadCategoryId.trim()
        : undefined,
    civitaiBrowseFilters: parseCivitaiBrowseFilters(row.civitaiBrowseFilters),
    civitaiImageBrowseFilters: parseCivitaiImageBrowseFilters(
      row.civitaiImageBrowseFilters,
    ),
    civitaiVideoBrowseFilters: parseCivitaiImageBrowseFilters(
      row.civitaiVideoBrowseFilters,
    ),
    hfBrowseFilters: parseHfBrowseFilters(row.hfBrowseFilters),
    enabledArchitectures: normalizeEnabledArchitectures(
      row.enabledArchitectures,
    ),
    enabledSdxlFamilies: normalizeEnabledSdxlFamilies(row.enabledSdxlFamilies),
    enabledCivitaiCategories: normalizeEnabledCivitaiCategories(
      row.enabledCivitaiCategories,
    ),
    validationPlatform:
      row.validationPlatform === 'stable-diffusion' ||
      row.validationPlatform === 'comfyui'
        ? row.validationPlatform
        : fallbackPlatform,
    generationFamily: row.generationFamily === 'sdxl' ? 'sdxl' : 'krea2',
    civitaiOrigin: normalizeCivitaiOrigin(
      typeof row.civitaiOrigin === 'string' && row.civitaiOrigin.trim()
        ? row.civitaiOrigin
        : fallbackOrigin,
    ),
  };
}

function parseLibraries(
  raw: unknown,
  fallbackPlatform: ValidationPlatform = 'comfyui',
  fallbackOrigin: CivitaiOrigin = DEFAULT_CIVITAI_ORIGIN,
): LibraryConfig[] {
  if (!Array.isArray(raw)) return [];
  modelFiltersSavedOnPointer.clear();
  const out: LibraryConfig[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const lib = parseLibraryConfig(item, fallbackPlatform, fallbackOrigin);
    if (
      lib &&
      item &&
      typeof item === 'object' &&
      pointerHasModelFilters(item as Record<string, unknown>)
    ) {
      modelFiltersSavedOnPointer.add(lib.id);
    }
    if (!lib || seen.has(lib.id)) continue;
    seen.add(lib.id);
    out.push(lib);
  }
  return out;
}

function createEmptyLibrary(name: string): LibraryConfig {
  return {
    id: randomUUID(),
    name: name.trim() || 'Library',
    wildcardsRoot: null,
    loraFolder: null,
    checkpointFolder: null,
    imagesFolder: null,
    videosFolder: null,
    mastersFolder: null,
    trainingLibraryFolder: null,
    promptsFolder: null,
    generationOutputRealistic: null,
    generationOutputHentai: null,
    generationOutput3d: null,
    benchmarkOutputFolder: null,
    ignoredUnusedLoras: [],
    ignoredCheckpoints: [],
    promptSubstitutions: [],
    archivedCivitaiModels: [],
    archivedCivitaiImages: [],
    archivedCivitaiVideos: [],
    archivedHfModels: [],
    downloadedHfModels: [],
    maybeCivitaiModels: [],
    markedInstalledCivitaiModels: [],
    markedInstalledCivitaiVersions: [],
    civitaiWatchlist: [],
    civitaiRecentlyUnlocked: [],
    blockedCivitaiCreators: [],
    lastCivitaiDownloadCategory: {},
    loraDownloadCategories: [],
    civitaiBrowseFilters: { ...DEFAULT_CIVITAI_BROWSE_FILTERS },
    civitaiImageBrowseFilters: { ...DEFAULT_CIVITAI_IMAGE_BROWSE_FILTERS },
    civitaiVideoBrowseFilters: { ...DEFAULT_CIVITAI_IMAGE_BROWSE_FILTERS },
    hfBrowseFilters: { ...DEFAULT_HF_BROWSE_FILTERS },
    enabledArchitectures: [...DEFAULT_ENABLED_ARCHITECTURES],
    enabledSdxlFamilies: [...DEFAULT_ENABLED_SDXL_FAMILIES],
    enabledCivitaiCategories: [...DEFAULT_ENABLED_CIVITAI_CATEGORIES],
    validationPlatform: 'comfyui',
    generationFamily: 'krea2',
    civitaiOrigin: DEFAULT_CIVITAI_ORIGIN,
  };
}

/** Keep deprecated flat fields aligned with the active library. */
function syncFlatMirrors(
  settings: Settings,
  lib: LibraryConfig,
): Settings {
  const next: Settings = {
    ...settings,
    lastRoot: lib.wildcardsRoot ?? undefined,
    lastRootFile: lib.lastRootFile,
    loraFolder: lib.loraFolder ?? undefined,
    checkpointFolder: lib.checkpointFolder ?? undefined,
    imagesFolder: lib.imagesFolder ?? undefined,
    videosFolder: lib.videosFolder ?? undefined,
    mastersFolder: lib.mastersFolder ?? undefined,
    trainingLibraryFolder: lib.trainingLibraryFolder ?? undefined,
    promptsFolder: lib.promptsFolder ?? undefined,
    ignoredUnusedLoras: lib.ignoredUnusedLoras ?? [],
    archivedCivitaiModels: lib.archivedCivitaiModels ?? [],
    archivedCivitaiImages: lib.archivedCivitaiImages ?? [],
    archivedCivitaiVideos: lib.archivedCivitaiVideos ?? [],
    maybeCivitaiModels: lib.maybeCivitaiModels ?? [],
    markedInstalledCivitaiModels: lib.markedInstalledCivitaiModels ?? [],
    markedInstalledCivitaiVersions: lib.markedInstalledCivitaiVersions ?? [],
    civitaiWatchlist: lib.civitaiWatchlist ?? [],
    blockedCivitaiCreators: lib.blockedCivitaiCreators ?? [],
    lastCivitaiDownloadCategory: lib.lastCivitaiDownloadCategory ?? {},
    civitaiBrowseFilters:
      lib.civitaiBrowseFilters ?? { ...DEFAULT_CIVITAI_BROWSE_FILTERS },
    validationPlatform: lib.validationPlatform ?? 'comfyui',
    civitaiOrigin: normalizeCivitaiOrigin(
      lib.civitaiOrigin ?? DEFAULT_CIVITAI_ORIGIN,
    ),
  };
  if (!lib.wildcardsRoot) delete next.lastRoot;
  if (!lib.lastRootFile) delete next.lastRootFile;
  if (!lib.loraFolder) delete next.loraFolder;
  if (!lib.checkpointFolder) delete next.checkpointFolder;
  if (!lib.imagesFolder) delete next.imagesFolder;
  if (!lib.videosFolder) delete next.videosFolder;
  if (!lib.mastersFolder) delete next.mastersFolder;
  if (!lib.trainingLibraryFolder) delete next.trainingLibraryFolder;
  if (!lib.promptsFolder) delete next.promptsFolder;
  return next;
}

/**
 * Ensure there is an active library. Does not rewrite or "heal" existing
 * libraries — parse-from-disk is the source of truth.
 */
function ensureActiveLibrary(settings: Settings): {
  settings: Settings;
  wrote: boolean;
} {
  const libraries = settings.libraries ?? [];
  if (libraries.length === 0) {
    const lib = createEmptyLibrary('Default');
    if (settings.lastRoot?.trim()) {
      lib.wildcardsRoot = path.resolve(settings.lastRoot.trim());
    }
    if (settings.loraFolder?.trim()) {
      lib.loraFolder = path.resolve(settings.loraFolder.trim());
    }
    if (settings.checkpointFolder?.trim()) {
      lib.checkpointFolder = path.resolve(settings.checkpointFolder.trim());
    }
    if (settings.imagesFolder?.trim()) {
      lib.imagesFolder = path.resolve(settings.imagesFolder.trim());
    }
    if (settings.videosFolder?.trim()) {
      lib.videosFolder = path.resolve(settings.videosFolder.trim());
    }
    if (settings.lastRootFile?.trim()) {
      lib.lastRootFile = settings.lastRootFile.trim().replaceAll('\\', '/');
    }
    lib.ignoredUnusedLoras = [...(settings.ignoredUnusedLoras ?? [])];
    lib.archivedCivitaiModels = [...(settings.archivedCivitaiModels ?? [])];
    lib.maybeCivitaiModels = [...(settings.maybeCivitaiModels ?? [])];
    lib.markedInstalledCivitaiModels = [
      ...(settings.markedInstalledCivitaiModels ?? []),
    ];
    lib.civitaiWatchlist = [...(settings.civitaiWatchlist ?? [])];
    lib.lastCivitaiDownloadCategory = {
      ...(settings.lastCivitaiDownloadCategory ?? {}),
    };
    if (settings.civitaiBrowseFilters) {
      lib.civitaiBrowseFilters = { ...settings.civitaiBrowseFilters };
    }
    if (settings.validationPlatform) {
      lib.validationPlatform = settings.validationPlatform;
    }
    if (settings.civitaiOrigin) {
      lib.civitaiOrigin = normalizeCivitaiOrigin(settings.civitaiOrigin);
    }
    return {
      settings: syncFlatMirrors(
        {
          ...settings,
          libraries: [lib],
          activeLibraryId: lib.id,
        },
        lib,
      ),
      wrote: true,
    };
  }

  let activeId = settings.activeLibraryId;
  let wrote = false;
  if (!activeId || !libraries.some((lib) => lib.id === activeId)) {
    activeId = libraries[0]!.id;
    wrote = true;
  }
  const active = libraries.find((lib) => lib.id === activeId)!;
  return {
    settings: syncFlatMirrors(
      { ...settings, activeLibraryId: activeId },
      active,
    ),
    wrote,
  };
}

/**
 * In-memory settings. Card building can call `isCivitaiModelArchived` /
 * `isCivitaiModelMaybe` / etc. thousands of times per catalog load — without
 * this, each call re-reads and re-parses settings.json and freezes the UI.
 */
let memSettings: Settings | null = null;

function readSettingsFromDisk(): Settings {
  const file = settingsPath();
  if (!fs.existsSync(file)) return { ...DEFAULTS, recentRoots: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Settings>;
    return {
      recentRoots: Array.isArray(raw.recentRoots)
        ? raw.recentRoots.filter((r): r is string => typeof r === 'string')
        : [],
      lastRoot: typeof raw.lastRoot === 'string' ? raw.lastRoot : undefined,
      lastRootFile:
        typeof raw.lastRootFile === 'string' ? raw.lastRootFile : undefined,
      detailsPanelWidth:
        typeof raw.detailsPanelWidth === 'number' &&
        Number.isFinite(raw.detailsPanelWidth)
          ? Math.round(raw.detailsPanelWidth)
          : undefined,
      filesPanelWidth:
        typeof raw.filesPanelWidth === 'number' &&
        Number.isFinite(raw.filesPanelWidth)
          ? Math.round(raw.filesPanelWidth)
          : undefined,
      panelWidthsByTab: parsePanelWidthsByTab(raw.panelWidthsByTab),
      promptsSamplesCollapsed:
        typeof raw.promptsSamplesCollapsed === 'boolean'
          ? raw.promptsSamplesCollapsed
          : undefined,
      generationPreviewCollapsed:
        typeof raw.generationPreviewCollapsed === 'boolean'
          ? raw.generationPreviewCollapsed
          : undefined,
      generationAdditionalPositiveHeight: parsePromptBoxHeight(
        raw.generationAdditionalPositiveHeight,
      ),
      generationNegativePromptHeight: parsePromptBoxHeight(
        raw.generationNegativePromptHeight,
      ),
      promptCoverageWindow: parseFloatingWindow(raw.promptCoverageWindow),
      promptSubstitutionsWindow: parseFloatingWindow(
        raw.promptSubstitutionsWindow,
      ),
      benchmarkResultsWindow: parseFloatingWindow(raw.benchmarkResultsWindow),
      benchmarkResultsView: parseBenchmarkResultsView(raw.benchmarkResultsView),
      simulationIterations:
        typeof raw.simulationIterations === 'number' &&
        Number.isFinite(raw.simulationIterations)
          ? Math.round(raw.simulationIterations)
          : undefined,
      simulationSeed:
        typeof raw.simulationSeed === 'number' &&
        Number.isFinite(raw.simulationSeed)
          ? Math.round(raw.simulationSeed)
          : undefined,
      graphLayoutStyle:
        raw.graphLayoutStyle === 'default'
          ? 'default'
          : raw.graphLayoutStyle === 'compact'
            ? 'compact'
            : 'optimized',
      workspaceListFilters: parseWorkspaceListFilters(raw.workspaceListFilters),
      validationPlatform:
        raw.validationPlatform === 'stable-diffusion'
          ? 'stable-diffusion'
          : 'comfyui',
      convertChildSuffix:
        typeof raw.convertChildSuffix === 'string'
          ? raw.convertChildSuffix
          : undefined,
      loraFolder:
        typeof raw.loraFolder === 'string' && raw.loraFolder.trim()
          ? path.resolve(raw.loraFolder.trim())
          : undefined,
      checkpointFolder:
        typeof raw.checkpointFolder === 'string' && raw.checkpointFolder.trim()
          ? path.resolve(raw.checkpointFolder.trim())
          : undefined,
      imagesFolder:
        typeof raw.imagesFolder === 'string' && raw.imagesFolder.trim()
          ? path.resolve(raw.imagesFolder.trim())
          : undefined,
      videosFolder:
        typeof raw.videosFolder === 'string' && raw.videosFolder.trim()
          ? path.resolve(raw.videosFolder.trim())
          : undefined,
      ignoredUnusedLoras: Array.isArray(raw.ignoredUnusedLoras)
        ? [
            ...new Set(
              raw.ignoredUnusedLoras
                .filter((value): value is string => typeof value === 'string')
                .map((value) => value.trim().replaceAll('\\', '/'))
                .filter(Boolean),
            ),
          ]
        : [],
      civitaiOrigin: normalizeCivitaiOrigin(raw.civitaiOrigin),
      civitaiApiKey:
        typeof raw.civitaiApiKey === 'string' && raw.civitaiApiKey.trim()
          ? raw.civitaiApiKey.trim()
          : undefined,
      huggingfaceToken:
        typeof raw.huggingfaceToken === 'string' && raw.huggingfaceToken.trim()
          ? raw.huggingfaceToken.trim()
          : undefined,
      civitaiCatalogAutoSyncIntervalMinutes:
        parseCivitaiCatalogAutoSyncIntervalMinutes(
          raw.civitaiCatalogAutoSyncIntervalMinutes,
        ),
      archivedCivitaiModels: parseArchivedCivitaiModels(
        raw.archivedCivitaiModels ?? raw.hiddenCivitaiModels,
      ),
      markedInstalledCivitaiModels: parseArchivedCivitaiModels(
        raw.markedInstalledCivitaiModels,
      ),
      markedInstalledCivitaiVersions: parseMarkedInstalledCivitaiVersions(
        raw.markedInstalledCivitaiVersions,
      ),
      maybeCivitaiModels: parseArchivedCivitaiModels(raw.maybeCivitaiModels),
      archiveToMaybeMigrated: raw.archiveToMaybeMigrated === true,
      civitaiWatchlist: parseCivitaiWatchlist(raw.civitaiWatchlist),
      civitaiBrowserDetached: raw.civitaiBrowserDetached === true,
      civitaiWindowState: parseWindowState(raw.civitaiWindowState),
      hfWindowState: parseWindowState(raw.hfWindowState),
      lastCivitaiDownloadCategory: parseLastCivitaiDownloadCategory(
        raw.lastCivitaiDownloadCategory,
      ),
      civitaiBrowseFilters: parseCivitaiBrowseFilters(raw.civitaiBrowseFilters),
      civitaiSplitRatio: parseCivitaiSplitRatio(raw.civitaiSplitRatio),
      civitaiCardMinWidth: parseCivitaiCardMinWidth(raw.civitaiCardMinWidth),
      windowState: parseWindowState(raw.windowState),
      libraries: parseLibraries(
        raw.libraries,
        raw.validationPlatform === 'stable-diffusion'
          ? 'stable-diffusion'
          : 'comfyui',
        normalizeCivitaiOrigin(raw.civitaiOrigin),
      ),
      activeLibraryId:
        typeof raw.activeLibraryId === 'string' && raw.activeLibraryId.trim()
          ? raw.activeLibraryId.trim()
          : undefined,
      // Default true when unset — shared-GPU (SD) setups need this.
      disableHardwareAcceleration:
        typeof raw.disableHardwareAcceleration === 'boolean'
          ? raw.disableHardwareAcceleration
          : true,
      generationSaveInNewSubfolder: raw.generationSaveInNewSubfolder === true,
      updateReleaseFolder:
        typeof raw.updateReleaseFolder === 'string' &&
        raw.updateReleaseFolder.trim()
          ? path.resolve(raw.updateReleaseFolder.trim())
          : null,
    };
  } catch {
    return { ...DEFAULTS, recentRoots: [] };
  }
}

function hydrateLibrariesFromLocal(settings: Settings): Settings {
  const idsByRoot = new Map<string, { root: string; ids: string[] }>();
  for (const lib of settings.libraries ?? []) {
    if (!lib.wildcardsRoot?.trim()) continue;
    const key = path.resolve(lib.wildcardsRoot).toLowerCase();
    const group = idsByRoot.get(key) ?? { root: lib.wildcardsRoot, ids: [] };
    group.ids.push(lib.id);
    idsByRoot.set(key, group);
  }
  for (const group of idsByRoot.values()) {
    migratePerLibraryCatalogs(group.root, group.ids);
  }

  const libraries = (settings.libraries ?? []).map((lib) => {
    if (!lib.wildcardsRoot?.trim()) return lib;
    const payload = readLibraryLocalPayload(lib.wildcardsRoot, lib.id);
    const merged = applyPayloadToLibrary(lib, payload);
    if (!modelFiltersSavedOnPointer.has(lib.id)) return merged;
    return {
      ...merged,
      enabledArchitectures: lib.enabledArchitectures,
      enabledSdxlFamilies: lib.enabledSdxlFamilies,
      enabledCivitaiCategories: lib.enabledCivitaiCategories,
    };
  });
  modelFiltersSavedOnPointer.clear();
  const active =
    libraries.find((lib) => lib.id === settings.activeLibraryId) ??
    libraries[0];
  if (!active) return { ...settings, libraries };
  return syncFlatMirrors({ ...settings, libraries }, active);
}

/**
 * AppData settings.json: keep library pointers + app prefs only.
 * Library datasets go to sibling `<basename>.wcm/library.json` next to the
 * wildcards root.
 */
const dirtyLibraryLocalIds = new Set<string>();

function markLibraryLocalDirty(libraryId: string): void {
  dirtyLibraryLocalIds.add(libraryId);
}

function settingsForDisk(
  settings: Settings,
  opts?: {
    persistAllLibraries?: boolean;
    allowEmptyMembershipLists?: boolean;
  },
): Settings {
  const persistAll = opts?.persistAllLibraries === true;
  for (const lib of settings.libraries ?? []) {
    if (!lib.wildcardsRoot?.trim()) continue;
    if (persistAll || dirtyLibraryLocalIds.has(lib.id)) {
      persistLibraryLocalFromConfig(lib, {
        allowEmptyMembershipLists: opts?.allowEmptyMembershipLists === true,
        flushImmediate: persistAll,
      });
      dirtyLibraryLocalIds.delete(lib.id);
    }
  }

  const libraries = (settings.libraries ?? []).map((lib) => {
    if (!lib.wildcardsRoot?.trim()) {
      // No wildcards root yet — keep payload in settings until one exists.
      return lib;
    }
    // Pointers only — datasets live in sibling `<basename>.wcm/library.json`.
    return {
      id: lib.id,
      name: lib.name,
      wildcardsRoot: lib.wildcardsRoot,
      loraFolder: lib.loraFolder,
      checkpointFolder: lib.checkpointFolder,
      imagesFolder: lib.imagesFolder,
      videosFolder: lib.videosFolder,
      mastersFolder: lib.mastersFolder,
      trainingLibraryFolder: lib.trainingLibraryFolder,
      promptsFolder: lib.promptsFolder,
      generationOutputRealistic: lib.generationOutputRealistic,
      generationOutputHentai: lib.generationOutputHentai,
      generationOutput3d: lib.generationOutput3d,
      benchmarkOutputFolder: lib.benchmarkOutputFolder,
      civitaiOrigin: lib.civitaiOrigin,
      validationPlatform: lib.validationPlatform,
      generationFamily: lib.generationFamily === 'sdxl' ? 'sdxl' : 'krea2',
      enabledArchitectures: lib.enabledArchitectures,
      enabledSdxlFamilies: lib.enabledSdxlFamilies,
      enabledCivitaiCategories: lib.enabledCivitaiCategories,
    } as LibraryConfig;
  });

  const next: Settings = {
    ...settings,
    libraries,
  };
  // Drop flat mirrors of library payloads from AppData.
  delete next.lastRootFile;
  delete next.ignoredUnusedLoras;
  delete next.archivedCivitaiModels;
  delete next.hiddenCivitaiModels;
  delete next.maybeCivitaiModels;
  delete next.markedInstalledCivitaiModels;
  delete next.markedInstalledCivitaiVersions;
  delete next.civitaiWatchlist;
  delete next.blockedCivitaiCreators;
  delete next.lastCivitaiDownloadCategory;
  delete next.civitaiBrowseFilters;
  delete next.validationPlatform;
  // Image/video archives belong in library.json only — writing them into
  // AppData settings.json ballooned the file (~10MB) and made Windows
  // replace races more likely to wipe folder pointers like videosFolder.
  delete next.archivedCivitaiImages;
  delete next.archivedCivitaiVideos;
  // Keep lastRoot / folder pointers as deprecated path mirrors of the active
  // library (pointers only). images/videos must be included — omitting them
  // left flat mirrors stale and getters could report "unset".
  const active =
    libraries.find((lib) => lib.id === settings.activeLibraryId) ??
    libraries[0];
  if (active) {
    next.lastRoot = active.wildcardsRoot ?? undefined;
    next.loraFolder = active.loraFolder ?? undefined;
    next.checkpointFolder = active.checkpointFolder ?? undefined;
    next.imagesFolder = active.imagesFolder ?? undefined;
    next.videosFolder = active.videosFolder ?? undefined;
    next.mastersFolder = active.mastersFolder ?? undefined;
    next.trainingLibraryFolder = active.trainingLibraryFolder ?? undefined;
    next.promptsFolder = active.promptsFolder ?? undefined;
    if (!active.wildcardsRoot) delete next.lastRoot;
    if (!active.loraFolder) delete next.loraFolder;
    if (!active.checkpointFolder) delete next.checkpointFolder;
    if (!active.imagesFolder) delete next.imagesFolder;
    if (!active.videosFolder) delete next.videosFolder;
    if (!active.mastersFolder) delete next.mastersFolder;
    if (!active.trainingLibraryFolder) delete next.trainingLibraryFolder;
    if (!active.promptsFolder) delete next.promptsFolder;
  }
  return next;
}

function writeSettingsToDisk(
  settings: Settings,
  opts?: {
    persistAllLibraries?: boolean;
    allowEmptyMembershipLists?: boolean;
  },
): void {
  atomicWrite(
    settingsPath(),
    `${JSON.stringify(settingsForDisk(settings, opts), null, 2)}\n`,
  );
}

export function loadSettings(): Settings {
  if (memSettings) return memSettings;
  const loaded = readSettingsFromDisk();
  const { settings, wrote } = ensureActiveLibrary(loaded);
  const hydrated = hydrateLibrariesFromLocal(settings);
  memSettings = hydrated;
  if (wrote) {
    writeSettingsToDisk(hydrated, { persistAllLibraries: true });
  }
  return memSettings;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  // Always go through persistSettings so we strip library payloads, keep
  // folder mirrors, and cancel any coalesced flush (avoids a stale pending
  // write overwriting a fresher immediate save).
  membershipCache = null;
  return persistSettings(
    { ...loadSettings(), ...patch },
    { flushImmediate: true },
  );
}

function persistSettings(
  next: Settings,
  opts?: { flushImmediate?: boolean; allowEmptyMembershipLists?: boolean },
): Settings {
  memSettings = next;
  // Keep membership cache — archive/maybe helpers update it in place so spam
  // clicks don't rebuild Sets from the full archive list every time. Cleared
  // explicitly on library switch / origin change.
  if (opts?.flushImmediate) {
    if (settingsFlushTimer !== null) {
      clearTimeout(settingsFlushTimer);
      settingsFlushTimer = null;
    }
    pendingSettingsWrite = null;
    writeSettingsToDisk(next, {
      allowEmptyMembershipLists: opts.allowEmptyMembershipLists,
    });
    return next;
  }
  scheduleSettingsFlush(next);
  return next;
}

let pendingSettingsWrite: Settings | null = null;
let settingsFlushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSettingsFlush(next: Settings): void {
  pendingSettingsWrite = next;
  if (settingsFlushTimer !== null) return;
  // Coalesce rapid Archive/Maybe clicks into one disk write.
  settingsFlushTimer = setTimeout(() => {
    settingsFlushTimer = null;
    const toWrite = pendingSettingsWrite;
    pendingSettingsWrite = null;
    if (!toWrite) return;
    setImmediate(() => {
      writeSettingsToDisk(toWrite);
    });
  }, 100);
}

/** Flush any coalesced settings write immediately (call before quit). */
export function flushSettingsSync(): void {
  if (settingsFlushTimer !== null) {
    clearTimeout(settingsFlushTimer);
    settingsFlushTimer = null;
  }
  const toWrite = pendingSettingsWrite ?? memSettings;
  pendingSettingsWrite = null;
  if (!toWrite) return;
  // Quit / library switch — ensure every library sidecar matches memory.
  writeSettingsToDisk(toWrite, { persistAllLibraries: true });
  flushLibraryLocalSync();
}

export function getActiveLibrary(): LibraryConfig {
  const settings = loadSettings();
  const libraries = settings.libraries ?? [];
  const activeId = settings.activeLibraryId;
  const active =
    libraries.find((lib) => lib.id === activeId) ?? libraries[0] ?? null;
  if (!active) {
    const lib = createEmptyLibrary('Default');
    persistSettings(
      syncFlatMirrors(
        { ...settings, libraries: [lib], activeLibraryId: lib.id },
        lib,
      ),
    );
    return lib;
  }
  return active;
}

/** Patch the active library and sync flat mirrors. */
export function patchActiveLibrary(
  patch: Partial<Omit<LibraryConfig, 'id'>>,
  opts?: { flushImmediate?: boolean },
): LibraryConfig {
  const settings = loadSettings();
  const active = getActiveLibrary();
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<Omit<LibraryConfig, 'id'>>;
  const updated: LibraryConfig = {
    ...active,
    ...cleanPatch,
    id: active.id,
  };
  const libraries = (settings.libraries ?? []).map((lib) =>
    lib.id === active.id ? updated : lib,
  );
  markLibraryLocalDirty(active.id);
  persistSettings(
    syncFlatMirrors(
      { ...settings, libraries, activeLibraryId: active.id },
      updated,
    ),
    { flushImmediate: opts?.flushImmediate === true },
  );
  return updated;
}

export function listLibraryConfigs(): LibraryConfig[] {
  return [...(loadSettings().libraries ?? [])];
}

export function getActiveLibraryId(): string {
  return getActiveLibrary().id;
}

export type LibraryCreateInput = {
  name: string;
  wildcardsRoot?: string | null;
  loraFolder?: string | null;
  checkpointFolder?: string | null;
  imagesFolder?: string | null;
  videosFolder?: string | null;
  mastersFolder?: string | null;
  trainingLibraryFolder?: string | null;
  promptsFolder?: string | null;
  generationOutputRealistic?: string | null;
  generationOutputHentai?: string | null;
  generationOutput3d?: string | null;
  benchmarkOutputFolder?: string | null;
  enabledArchitectures?: CivitaiArchitectureIdDto[];
  enabledSdxlFamilies?: CivitaiSdxlFamilyToggleIdDto[];
  enabledCivitaiCategories?: CivitaiModelCategoryIdDto[];
  validationPlatform?: ValidationPlatform;
  generationFamily?: GenerationFamily;
  civitaiOrigin?: CivitaiOrigin;
};

function assignOptionalLibraryDir(
  target: LibraryConfig,
  field:
    | 'wildcardsRoot'
    | 'loraFolder'
    | 'checkpointFolder'
    | 'imagesFolder'
    | 'videosFolder'
    | 'mastersFolder'
    | 'trainingLibraryFolder'
    | 'promptsFolder'
    | 'generationOutputRealistic'
    | 'generationOutputHentai'
    | 'generationOutput3d'
    | 'benchmarkOutputFolder',
  raw: string | null | undefined,
  label: string,
  opts?: { createIfMissing?: boolean },
): void {
  if (raw === undefined) return;
  if (!raw?.trim()) {
    target[field] = null;
    return;
  }
  const resolved = path.resolve(raw.trim());
  if (!fs.existsSync(resolved)) {
    if (opts?.createIfMissing) {
      fs.mkdirSync(resolved, { recursive: true });
    } else {
      throw new Error(`${label} is not a directory`);
    }
  } else if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`${label} is not a directory`);
  }
  target[field] = resolved;
}

export function createLibraryConfig(input: LibraryCreateInput): LibraryConfig {
  const lib = createEmptyLibrary(input.name);
  if (input.wildcardsRoot?.trim()) {
    const resolved = path.resolve(input.wildcardsRoot.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('Wildcards folder is not a directory');
    }
    lib.wildcardsRoot = resolved;
  }
  if (input.loraFolder?.trim()) {
    const resolved = path.resolve(input.loraFolder.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('LoRA folder is not a directory');
    }
    lib.loraFolder = resolved;
  }
  if (input.checkpointFolder?.trim()) {
    const resolved = path.resolve(input.checkpointFolder.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('Checkpoint folder is not a directory');
    }
    lib.checkpointFolder = resolved;
  }
  if (input.imagesFolder?.trim()) {
    const resolved = path.resolve(input.imagesFolder.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('Images folder is not a directory');
    }
    lib.imagesFolder = resolved;
  }
  if (input.videosFolder?.trim()) {
    const resolved = path.resolve(input.videosFolder.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('Videos folder is not a directory');
    }
    lib.videosFolder = resolved;
  }
  if (input.mastersFolder?.trim()) {
    const resolved = path.resolve(input.mastersFolder.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('Masters folder is not a directory');
    }
    lib.mastersFolder = resolved;
  }
  if (input.trainingLibraryFolder?.trim()) {
    const resolved = path.resolve(input.trainingLibraryFolder.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('Training library folder is not a directory');
    }
    lib.trainingLibraryFolder = resolved;
  }
  if (input.promptsFolder?.trim()) {
    const resolved = path.resolve(input.promptsFolder.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('Prompts folder is not a directory');
    }
    lib.promptsFolder = resolved;
  }
  assignOptionalLibraryDir(
    lib,
    'generationOutputRealistic',
    input.generationOutputRealistic,
    'Generation output (Realistic)',
    { createIfMissing: true },
  );
  assignOptionalLibraryDir(
    lib,
    'generationOutputHentai',
    input.generationOutputHentai,
    'Generation output (Hentai)',
    { createIfMissing: true },
  );
  assignOptionalLibraryDir(
    lib,
    'generationOutput3d',
    input.generationOutput3d,
    'Generation output (3D)',
    { createIfMissing: true },
  );
  assignOptionalLibraryDir(
    lib,
    'benchmarkOutputFolder',
    input.benchmarkOutputFolder,
    'Checkpoint Benchmark folder',
    { createIfMissing: true },
  );
  if (input.enabledArchitectures !== undefined) {
    lib.enabledArchitectures = normalizeEnabledArchitectures(
      input.enabledArchitectures,
    );
  }
  if (input.enabledSdxlFamilies !== undefined) {
    lib.enabledSdxlFamilies = normalizeEnabledSdxlFamilies(
      input.enabledSdxlFamilies,
    );
  }
  if (input.enabledCivitaiCategories !== undefined) {
    lib.enabledCivitaiCategories = normalizeEnabledCivitaiCategories(
      input.enabledCivitaiCategories,
    );
  }
  if (
    input.validationPlatform === 'comfyui' ||
    input.validationPlatform === 'stable-diffusion'
  ) {
    lib.validationPlatform = input.validationPlatform;
  }
  if (input.generationFamily === 'krea2' || input.generationFamily === 'sdxl') {
    lib.generationFamily = input.generationFamily;
  }
  if (input.civitaiOrigin !== undefined) {
    lib.civitaiOrigin = normalizeCivitaiOrigin(input.civitaiOrigin);
  }
  const settings = loadSettings();
  markLibraryLocalDirty(lib.id);
  persistSettings({
    ...settings,
    libraries: [...(settings.libraries ?? []), lib],
  });
  return lib;
}

export function updateLibraryConfig(
  id: string,
  patch: Partial<Omit<LibraryConfig, 'id'>>,
): LibraryConfig {
  const settings = loadSettings();
  const libraries = settings.libraries ?? [];
  const index = libraries.findIndex((lib) => lib.id === id);
  if (index < 0) throw new Error('Library not found');
  const current = libraries[index]!;

  // Ignore undefined keys so a rename-only patch cannot wipe folders.
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<Omit<LibraryConfig, 'id'>>;

  const nextLib: LibraryConfig = { ...current, ...cleanPatch, id: current.id };

  if (cleanPatch.wildcardsRoot !== undefined) {
    if (cleanPatch.wildcardsRoot) {
      const resolved = path.resolve(cleanPatch.wildcardsRoot);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error('Wildcards folder is not a directory');
      }
      nextLib.wildcardsRoot = resolved;
    } else {
      nextLib.wildcardsRoot = null;
    }
  }
  if (cleanPatch.loraFolder !== undefined) {
    if (cleanPatch.loraFolder) {
      const resolved = path.resolve(cleanPatch.loraFolder);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error('LoRA folder is not a directory');
      }
      nextLib.loraFolder = resolved;
    } else {
      nextLib.loraFolder = null;
    }
  }
  if (cleanPatch.checkpointFolder !== undefined) {
    if (cleanPatch.checkpointFolder) {
      const resolved = path.resolve(cleanPatch.checkpointFolder);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error('Checkpoint folder is not a directory');
      }
      nextLib.checkpointFolder = resolved;
    } else {
      nextLib.checkpointFolder = null;
    }
  }
  if (cleanPatch.imagesFolder !== undefined) {
    if (cleanPatch.imagesFolder) {
      const resolved = path.resolve(cleanPatch.imagesFolder);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error('Images folder is not a directory');
      }
      nextLib.imagesFolder = resolved;
    } else {
      nextLib.imagesFolder = null;
    }
  }
  if (cleanPatch.videosFolder !== undefined) {
    if (cleanPatch.videosFolder) {
      const resolved = path.resolve(cleanPatch.videosFolder);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error('Videos folder is not a directory');
      }
      nextLib.videosFolder = resolved;
    } else {
      nextLib.videosFolder = null;
    }
  }
  if (cleanPatch.mastersFolder !== undefined) {
    if (cleanPatch.mastersFolder) {
      const resolved = path.resolve(cleanPatch.mastersFolder);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error('Masters folder is not a directory');
      }
      nextLib.mastersFolder = resolved;
    } else {
      nextLib.mastersFolder = null;
    }
  }
  if (cleanPatch.trainingLibraryFolder !== undefined) {
    if (cleanPatch.trainingLibraryFolder) {
      const resolved = path.resolve(cleanPatch.trainingLibraryFolder);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error('Training library folder is not a directory');
      }
      nextLib.trainingLibraryFolder = resolved;
    } else {
      nextLib.trainingLibraryFolder = null;
    }
  }
  if (cleanPatch.promptsFolder !== undefined) {
    if (cleanPatch.promptsFolder) {
      const resolved = path.resolve(cleanPatch.promptsFolder);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error('Prompts folder is not a directory');
      }
      nextLib.promptsFolder = resolved;
    } else {
      nextLib.promptsFolder = null;
    }
  }
  if (cleanPatch.generationOutputRealistic !== undefined) {
    assignOptionalLibraryDir(
      nextLib,
      'generationOutputRealistic',
      cleanPatch.generationOutputRealistic,
      'Generation output (Realistic)',
      { createIfMissing: true },
    );
  }
  if (cleanPatch.generationOutputHentai !== undefined) {
    assignOptionalLibraryDir(
      nextLib,
      'generationOutputHentai',
      cleanPatch.generationOutputHentai,
      'Generation output (Hentai)',
      { createIfMissing: true },
    );
  }
  if (cleanPatch.generationOutput3d !== undefined) {
    assignOptionalLibraryDir(
      nextLib,
      'generationOutput3d',
      cleanPatch.generationOutput3d,
      'Generation output (3D)',
      { createIfMissing: true },
    );
  }
  if (cleanPatch.benchmarkOutputFolder !== undefined) {
    assignOptionalLibraryDir(
      nextLib,
      'benchmarkOutputFolder',
      cleanPatch.benchmarkOutputFolder,
      'Checkpoint Benchmark folder',
      { createIfMissing: true },
    );
  }
  if (typeof cleanPatch.name === 'string') {
    const name = cleanPatch.name.trim();
    if (!name) throw new Error('Library name is empty');
    nextLib.name = name;
  }
  if (cleanPatch.enabledArchitectures !== undefined) {
    nextLib.enabledArchitectures = normalizeEnabledArchitectures(
      cleanPatch.enabledArchitectures,
    );
  }
  if (cleanPatch.enabledSdxlFamilies !== undefined) {
    nextLib.enabledSdxlFamilies = normalizeEnabledSdxlFamilies(
      cleanPatch.enabledSdxlFamilies,
    );
  }
  if (cleanPatch.enabledCivitaiCategories !== undefined) {
    nextLib.enabledCivitaiCategories = normalizeEnabledCivitaiCategories(
      cleanPatch.enabledCivitaiCategories,
    );
  }
  if (
    cleanPatch.validationPlatform === 'comfyui' ||
    cleanPatch.validationPlatform === 'stable-diffusion'
  ) {
    nextLib.validationPlatform = cleanPatch.validationPlatform;
  }
  if (cleanPatch.civitaiOrigin !== undefined) {
    const prevOrigin = normalizeCivitaiOrigin(
      current.civitaiOrigin ?? DEFAULT_CIVITAI_ORIGIN,
    );
    const nextOrigin = normalizeCivitaiOrigin(cleanPatch.civitaiOrigin);
    nextLib.civitaiOrigin = nextOrigin;
    // Keep Archive / Maybe / Notify / blocks visible after a site change —
    // entries were tagged with the old origin and would otherwise vanish.
    if (prevOrigin !== nextOrigin) {
      nextLib.archivedCivitaiModels = (nextLib.archivedCivitaiModels ?? []).map(
        (e) => ({ ...e, origin: nextOrigin }),
      );
      nextLib.maybeCivitaiModels = (nextLib.maybeCivitaiModels ?? []).map(
        (e) => ({ ...e, origin: nextOrigin }),
      );
      nextLib.markedInstalledCivitaiModels = (
        nextLib.markedInstalledCivitaiModels ?? []
      ).map((e) => ({ ...e, origin: nextOrigin }));
      nextLib.markedInstalledCivitaiVersions = (
        nextLib.markedInstalledCivitaiVersions ?? []
      ).map((e) => ({ ...e, origin: nextOrigin }));
      nextLib.civitaiWatchlist = (nextLib.civitaiWatchlist ?? []).map((e) => ({
        ...e,
        origin: nextOrigin,
      }));
      nextLib.civitaiRecentlyUnlocked = (
        nextLib.civitaiRecentlyUnlocked ?? []
      ).map((e) => ({ ...e, origin: nextOrigin }));
      nextLib.blockedCivitaiCreators = (
        nextLib.blockedCivitaiCreators ?? []
      ).map((e) => ({ ...e, origin: nextOrigin }));
      nextLib.archivedCivitaiImages = (nextLib.archivedCivitaiImages ?? []).map(
        (e) => ({ ...e, origin: nextOrigin }),
      );
      nextLib.archivedCivitaiVideos = (nextLib.archivedCivitaiVideos ?? []).map(
        (e) => ({ ...e, origin: nextOrigin }),
      );
      membershipCache = null;
    }
  }

  const nextLibraries = libraries.slice();
  nextLibraries[index] = nextLib;
  const activeId = settings.activeLibraryId ?? nextLib.id;
  const active =
    nextLibraries.find((lib) => lib.id === activeId) ?? nextLib;
  markLibraryLocalDirty(nextLib.id);
  if (nextLib.id === active.id) membershipCache = null;
  persistSettings(
    syncFlatMirrors(
      { ...settings, libraries: nextLibraries, activeLibraryId: active.id },
      active,
    ),
    { flushImmediate: true },
  );
  return nextLib;
}

export function deleteLibraryConfig(id: string): {
  libraries: LibraryConfig[];
  activeLibraryId: string;
} {
  const settings = loadSettings();
  const libraries = settings.libraries ?? [];
  if (libraries.length <= 1) {
    throw new Error('Cannot delete the last library');
  }
  if (!libraries.some((lib) => lib.id === id)) {
    throw new Error('Library not found');
  }
  const nextLibraries = libraries.filter((lib) => lib.id !== id);
  let activeId = settings.activeLibraryId ?? nextLibraries[0]!.id;
  if (activeId === id) activeId = nextLibraries[0]!.id;
  const active = nextLibraries.find((lib) => lib.id === activeId)!;
  persistSettings(
    syncFlatMirrors(
      { ...settings, libraries: nextLibraries, activeLibraryId: activeId },
      active,
    ),
  );
  return { libraries: nextLibraries, activeLibraryId: activeId };
}

/**
 * Switch the active library (persist + sync flat mirrors). Caller should apply
 * folders / open root / invalidate indexes.
 */
export function setActiveLibraryId(id: string): LibraryConfig {
  const settings = loadSettings();
  const lib = (settings.libraries ?? []).find((item) => item.id === id);
  if (!lib) throw new Error('Library not found');
  membershipCache = null;
  persistSettings(
    syncFlatMirrors({ ...settings, activeLibraryId: id }, lib),
    { flushImmediate: true },
  );
  return lib;
}

type MembershipCache = {
  origin: string;
  archived: Set<number>;
  maybe: Set<number>;
  markedInstalled: Set<number>;
  /** `${modelId}:${versionId}:${fileId}` for the active origin. */
  markedInstalledVersions: Set<string>;
  watching: Set<number>;
  /** Lowercased creator usernames blocked for this origin. */
  blockedCreators: Set<string>;
};

let membershipCache: MembershipCache | null = null;

function membershipForOrigin(origin: string): MembershipCache {
  const active = getActiveLibrary();
  const cacheKey = `${active.id}\0${origin}`;
  if (membershipCache && membershipCache.origin === cacheKey) {
    return membershipCache;
  }
  const archived = new Set<number>();
  const maybe = new Set<number>();
  const markedInstalled = new Set<number>();
  const markedInstalledVersions = new Set<string>();
  const watching = new Set<number>();
  const blockedCreators = new Set<string>();

  // Active library is source of truth (flat mirrors can lag / be stripped).
  // Match by modelId within the library — entry.origin may be stale after a
  // site change; marks must not disappear when switching .com ↔ .red.
  for (const entry of active.archivedCivitaiModels ?? []) {
    archived.add(entry.modelId);
  }
  for (const entry of active.maybeCivitaiModels ?? []) {
    maybe.add(entry.modelId);
  }
  for (const entry of active.markedInstalledCivitaiModels ?? []) {
    markedInstalled.add(entry.modelId);
  }
  for (const entry of active.markedInstalledCivitaiVersions ?? []) {
    markedInstalledVersions.add(
      markedVersionKey(entry.modelId, entry.versionId, entry.fileId),
    );
  }
  for (const entry of active.civitaiWatchlist ?? []) {
    watching.add(entry.modelId);
  }
  for (const entry of active.blockedCivitaiCreators ?? []) {
    const key = entry.username.trim().toLowerCase();
    if (key) blockedCreators.add(key);
  }

  membershipCache = {
    origin: cacheKey,
    archived,
    maybe,
    markedInstalled,
    markedInstalledVersions,
    watching,
    blockedCreators,
  };
  return membershipCache;
}

export function pushRecentRoot(root: string): string[] {
  const settings = loadSettings();
  const normalized = path.resolve(root);
  const recent = [
    normalized,
    ...settings.recentRoots.filter(
      (r) => r.toLowerCase() !== normalized.toLowerCase(),
    ),
  ].slice(0, 12);
  const active = getActiveLibrary();
  const switchedRoot =
    (active.wildcardsRoot ?? '').toLowerCase() !== normalized.toLowerCase();
  const updated: LibraryConfig = {
    ...active,
    wildcardsRoot: normalized,
    lastRootFile: switchedRoot ? undefined : active.lastRootFile,
  };
  const libraries = (settings.libraries ?? []).map((lib) =>
    lib.id === active.id ? updated : lib,
  );
  persistSettings(
    syncFlatMirrors(
      {
        ...settings,
        recentRoots: recent,
        libraries,
        activeLibraryId: active.id,
      },
      updated,
    ),
  );
  return recent;
}

export function setLastFile(relativePath: string): void {
  const normalized = relativePath.split(path.sep).join('/');
  patchActiveLibrary({ lastRootFile: normalized });
}

export function clearLastFile(): void {
  patchActiveLibrary({ lastRootFile: undefined });
}

export function setDetailsPanelWidth(tab: WorkspaceTabId, width: number): void {
  if (!isWorkspaceTabId(tab)) throw new Error('Invalid workspace tab');
  const clamped = clampStoredDetailsWidth(width);
  const settings = loadSettings();
  const byTab = resolvePanelWidthsByTab(settings);
  byTab[tab] = {
    ...byTab[tab],
    detailsPanelWidth: clamped,
  };
  const patch: Partial<Settings> = {
    panelWidthsByTab: byTab,
  };
  // Keep legacy fields in sync with wildcards for older readers.
  if (tab === 'wildcards') {
    patch.detailsPanelWidth = clamped;
  }
  saveSettings(patch);
}

export function setFilesPanelWidth(tab: WorkspaceTabId, width: number): void {
  if (!isWorkspaceTabId(tab)) throw new Error('Invalid workspace tab');
  const clamped = clampStoredFilesWidth(width);
  const settings = loadSettings();
  const byTab = resolvePanelWidthsByTab(settings);
  byTab[tab] = {
    ...byTab[tab],
    filesPanelWidth: clamped,
  };
  const patch: Partial<Settings> = {
    panelWidthsByTab: byTab,
  };
  if (tab === 'wildcards') {
    patch.filesPanelWidth = clamped;
  }
  saveSettings(patch);
}

export function setPromptsSamplesCollapsed(collapsed: boolean): void {
  saveSettings({ promptsSamplesCollapsed: collapsed === true });
}

export function setGenerationPreviewCollapsed(collapsed: boolean): void {
  saveSettings({ generationPreviewCollapsed: collapsed === true });
}

const PROMPT_BOX_MIN_HEIGHT = 48;
const PROMPT_BOX_MAX_HEIGHT = 720;

function parsePromptBoxHeight(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(
    PROMPT_BOX_MIN_HEIGHT,
    Math.min(PROMPT_BOX_MAX_HEIGHT, Math.round(value)),
  );
}

export function setGenerationPromptBoxHeights(patch: {
  additionalPositive?: number;
  negative?: number;
}): void {
  const next: Partial<Settings> = {};
  if (patch.additionalPositive !== undefined) {
    const height = parsePromptBoxHeight(patch.additionalPositive);
    if (height !== undefined) next.generationAdditionalPositiveHeight = height;
  }
  if (patch.negative !== undefined) {
    const height = parsePromptBoxHeight(patch.negative);
    if (height !== undefined) next.generationNegativePromptHeight = height;
  }
  if (Object.keys(next).length > 0) saveSettings(next);
}

export function getPromptCoverageWindow(): Settings['promptCoverageWindow'] {
  return loadSettings().promptCoverageWindow;
}

export function setPromptCoverageWindow(state: {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}): NonNullable<Settings['promptCoverageWindow']> {
  const next = {
    x: Math.round(state.x),
    y: Math.round(state.y),
    width: Math.max(320, Math.round(state.width)),
    height: Math.max(240, Math.round(state.height)),
    maximized: state.maximized === true,
  };
  saveSettings({ promptCoverageWindow: next });
  return next;
}

export function setPromptSubstitutionsWindow(state: {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}): NonNullable<Settings['promptSubstitutionsWindow']> {
  const next = {
    x: Math.round(state.x),
    y: Math.round(state.y),
    width: Math.max(320, Math.round(state.width)),
    height: Math.max(240, Math.round(state.height)),
    maximized: state.maximized === true,
  };
  saveSettings({ promptSubstitutionsWindow: next });
  return next;
}

export function getBenchmarkResultsWindow(): Settings['benchmarkResultsWindow'] {
  return loadSettings().benchmarkResultsWindow;
}

export function setBenchmarkResultsWindow(state: {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}): NonNullable<Settings['benchmarkResultsWindow']> {
  const next = {
    x: Math.round(state.x),
    y: Math.round(state.y),
    width: Math.max(320, Math.round(state.width)),
    height: Math.max(240, Math.round(state.height)),
    maximized: state.maximized === true,
  };
  saveSettings({ benchmarkResultsWindow: next });
  return next;
}

export function getBenchmarkResultsView(): BenchmarkResultsViewDto {
  return (
    loadSettings().benchmarkResultsView ?? parseBenchmarkResultsView(undefined)
  );
}

export function setBenchmarkResultsView(
  view: unknown,
): BenchmarkResultsViewDto {
  const next = parseBenchmarkResultsView(view);
  saveSettings({ benchmarkResultsView: next });
  return next;
}

export function setSimulationSettings(
  iterations: number,
  seed: number,
): void {
  saveSettings({
    simulationIterations: Math.max(
      1,
      Math.min(1_000_000, Math.round(iterations)),
    ),
    simulationSeed: Math.max(0, Math.min(0xffffffff, Math.round(seed))),
  });
}

export function setGraphLayoutStyle(style: GraphLayoutStyle): void {
  saveSettings({ graphLayoutStyle: style });
}

export function getWorkspaceListFilters(): WorkspaceListFiltersDto {
  return (
    loadSettings().workspaceListFilters ?? defaultWorkspaceListFilters()
  );
}

export function setWorkspaceListFilter(
  tab: WorkspaceListFilterTab,
  filter: unknown,
): void {
  const current = getWorkspaceListFilters();
  saveSettings({
    workspaceListFilters: {
      ...current,
      [tab]: normalizeWorkspaceListFilter(tab, filter),
    },
  });
}

export function setConvertChildSuffix(suffix: string): string {
  const normalized = normalizeConvertChildSuffix(suffix);
  saveSettings({ convertChildSuffix: normalized });
  return normalized;
}

export function getConvertChildSuffix(): string {
  return normalizeConvertChildSuffix(
    loadSettings().convertChildSuffix ?? DEFAULT_CONVERT_CHILD_SUFFIX,
  );
}

export function setLoraFolder(folder: string | null): string | null {
  if (!folder || !folder.trim()) {
    patchActiveLibrary({ loraFolder: null });
    return null;
  }
  const resolved = path.resolve(folder.trim());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('LoRA folder is not a directory');
  }
  patchActiveLibrary({ loraFolder: resolved });
  return resolved;
}

export function setCheckpointFolder(folder: string | null): string | null {
  if (!folder || !folder.trim()) {
    patchActiveLibrary({ checkpointFolder: null });
    return null;
  }
  const resolved = path.resolve(folder.trim());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Checkpoint folder is not a directory');
  }
  patchActiveLibrary({ checkpointFolder: resolved });
  return resolved;
}

export function setImagesFolder(folder: string | null): string | null {
  if (!folder || !folder.trim()) {
    patchActiveLibrary({ imagesFolder: null }, { flushImmediate: true });
    return null;
  }
  const resolved = path.resolve(folder.trim());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Images folder is not a directory');
  }
  patchActiveLibrary({ imagesFolder: resolved }, { flushImmediate: true });
  return resolved;
}

export function setVideosFolder(folder: string | null): string | null {
  if (!folder || !folder.trim()) {
    patchActiveLibrary({ videosFolder: null }, { flushImmediate: true });
    return null;
  }
  const resolved = path.resolve(folder.trim());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Videos folder is not a directory');
  }
  patchActiveLibrary({ videosFolder: resolved }, { flushImmediate: true });
  return resolved;
}

export function setMastersFolder(folder: string | null): string | null {
  if (!folder || !folder.trim()) {
    patchActiveLibrary({ mastersFolder: null });
    return null;
  }
  const resolved = path.resolve(folder.trim());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Masters folder is not a directory');
  }
  patchActiveLibrary({ mastersFolder: resolved });
  return resolved;
}

export function setTrainingLibraryFolder(folder: string | null): string | null {
  if (!folder || !folder.trim()) {
    patchActiveLibrary({ trainingLibraryFolder: null });
    return null;
  }
  const resolved = path.resolve(folder.trim());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Training library folder is not a directory');
  }
  patchActiveLibrary({ trainingLibraryFolder: resolved });
  return resolved;
}

export function setPromptsFolder(folder: string | null): string | null {
  if (!folder || !folder.trim()) {
    patchActiveLibrary({ promptsFolder: null });
    return null;
  }
  const resolved = path.resolve(folder.trim());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Prompts folder is not a directory');
  }
  patchActiveLibrary({ promptsFolder: resolved });
  return resolved;
}

export function getCivitaiOrigin(): CivitaiOrigin {
  const lib = getActiveLibrary();
  return normalizeCivitaiOrigin(
    lib.civitaiOrigin ??
      loadSettings().civitaiOrigin ??
      DEFAULT_CIVITAI_ORIGIN,
  );
}

/** Updates the active library’s Civitai site (kept for older IPC callers). */
export function setCivitaiOrigin(origin: string): CivitaiOrigin {
  const normalized = normalizeCivitaiOrigin(origin);
  const active = getActiveLibrary();
  updateLibraryConfig(active.id, { civitaiOrigin: normalized });
  return normalized;
}

export function getCivitaiApiKey(): string | null {
  return loadSettings().civitaiApiKey ?? null;
}

export function setCivitaiApiKey(key: string | null): string | null {
  if (!key || !key.trim()) {
    const next = { ...loadSettings() };
    delete next.civitaiApiKey;
    persistSettings(next, { flushImmediate: true });
    return null;
  }
  const trimmed = key.trim();
  saveSettings({ civitaiApiKey: trimmed });
  return trimmed;
}

export function getHuggingFaceToken(): string | null {
  return loadSettings().huggingfaceToken ?? null;
}

export function setHuggingFaceToken(token: string | null): string | null {
  if (!token || !token.trim()) {
    const next = { ...loadSettings() };
    delete next.huggingfaceToken;
    persistSettings(next, { flushImmediate: true });
    return null;
  }
  const trimmed = token.trim();
  saveSettings({ huggingfaceToken: trimmed });
  return trimmed;
}

export function listArchivedHfModels(): ArchivedHfModel[] {
  return getActiveLibrary().archivedHfModels ?? [];
}

export function archiveHfModel(repoIdRaw: string): ArchivedHfModel[] {
  const repoId = normalizeHfRepoId(repoIdRaw);
  if (!repoId) return listArchivedHfModels();
  const current = listArchivedHfModels();
  if (current.some((m) => m.repoId.toLowerCase() === repoId.toLowerCase())) {
    return current;
  }
  const next = [...current, { repoId }];
  patchActiveLibrary({ archivedHfModels: next }, { flushImmediate: true });
  return next;
}

export function unarchiveHfModel(repoIdRaw: string): ArchivedHfModel[] {
  const repoId = normalizeHfRepoId(repoIdRaw);
  if (!repoId) return listArchivedHfModels();
  const next = listArchivedHfModels().filter(
    (m) => m.repoId.toLowerCase() !== repoId.toLowerCase(),
  );
  patchActiveLibrary({ archivedHfModels: next }, { flushImmediate: true });
  return next;
}

export function isHfModelArchived(repoIdRaw: string): boolean {
  const repoId = normalizeHfRepoId(repoIdRaw);
  if (!repoId) return false;
  return listArchivedHfModels().some(
    (m) => m.repoId.toLowerCase() === repoId.toLowerCase(),
  );
}

export function listDownloadedHfModels(): ArchivedHfModel[] {
  return getActiveLibrary().downloadedHfModels ?? [];
}

export function markDownloadedHfModel(repoIdRaw: string): ArchivedHfModel[] {
  const repoId = normalizeHfRepoId(repoIdRaw);
  if (!repoId) return listDownloadedHfModels();
  const current = listDownloadedHfModels();
  if (current.some((m) => m.repoId.toLowerCase() === repoId.toLowerCase())) {
    return current;
  }
  const next = [...current, { repoId }];
  patchActiveLibrary({ downloadedHfModels: next }, { flushImmediate: true });
  return next;
}

export function forgetDownloadedHfModel(repoIdRaw: string): ArchivedHfModel[] {
  const repoId = normalizeHfRepoId(repoIdRaw);
  if (!repoId) return listDownloadedHfModels();
  const next = listDownloadedHfModels().filter(
    (m) => m.repoId.toLowerCase() !== repoId.toLowerCase(),
  );
  patchActiveLibrary({ downloadedHfModels: next }, { flushImmediate: true });
  return next;
}

/** Default idle tip-check interval (minutes). */
export const DEFAULT_CIVITAI_CATALOG_AUTO_SYNC_INTERVAL_MINUTES = 10;
export const MIN_CIVITAI_CATALOG_AUTO_SYNC_INTERVAL_MINUTES = 0;
export const MAX_CIVITAI_CATALOG_AUTO_SYNC_INTERVAL_MINUTES = 24 * 60;

export function parseCivitaiCatalogAutoSyncIntervalMinutes(
  raw: unknown,
): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_CIVITAI_CATALOG_AUTO_SYNC_INTERVAL_MINUTES;
  }
  return Math.min(
    MAX_CIVITAI_CATALOG_AUTO_SYNC_INTERVAL_MINUTES,
    Math.max(
      MIN_CIVITAI_CATALOG_AUTO_SYNC_INTERVAL_MINUTES,
      Math.round(raw),
    ),
  );
}

export function getCivitaiCatalogAutoSyncIntervalMinutes(): number {
  return parseCivitaiCatalogAutoSyncIntervalMinutes(
    loadSettings().civitaiCatalogAutoSyncIntervalMinutes,
  );
}

export function setCivitaiCatalogAutoSyncIntervalMinutes(
  minutes: number,
): number {
  const next = parseCivitaiCatalogAutoSyncIntervalMinutes(minutes);
  saveSettings({ civitaiCatalogAutoSyncIntervalMinutes: next });
  return next;
}

/** Default true — soft-render UI while the GPU runs generations. */
export function getDisableHardwareAcceleration(): boolean {
  const v = loadSettings().disableHardwareAcceleration;
  return typeof v === 'boolean' ? v : true;
}

export function setDisableHardwareAcceleration(disable: boolean): boolean {
  const next = disable === true;
  saveSettings({ disableHardwareAcceleration: next });
  return next;
}

/** Default off. Folder-mode images use a `New` subfolder only when this is on. */
export function getGenerationSaveInNewSubfolder(): boolean {
  return loadSettings().generationSaveInNewSubfolder === true;
}

export function setGenerationSaveInNewSubfolder(enabled: boolean): boolean {
  const next = enabled === true;
  saveSettings({ generationSaveInNewSubfolder: next });
  return next;
}

export function getUpdateReleaseFolder(): string | null {
  const folder = loadSettings().updateReleaseFolder?.trim();
  return folder ? path.resolve(folder) : null;
}

export function setUpdateReleaseFolder(folder: string | null): string | null {
  if (!folder?.trim()) {
    saveSettings({ updateReleaseFolder: null });
    return null;
  }
  const resolved = path.resolve(folder.trim());
  saveSettings({ updateReleaseFolder: resolved });
  return resolved;
}

export function listArchivedCivitaiModels(): ArchivedCivitaiModel[] {
  return getActiveLibrary().archivedCivitaiModels ?? [];
}

export function listArchivedCivitaiImages(): ArchivedCivitaiImage[] {
  return getActiveLibrary().archivedCivitaiImages ?? [];
}

export function archiveCivitaiImage(imageId: number): ArchivedCivitaiImage[] {
  return archiveCivitaiImages([imageId]).archived;
}

export function archiveCivitaiImages(
  imageIds: number[],
): { archived: ArchivedCivitaiImage[]; archivedCount: number } {
  const origin = getCivitaiOrigin();
  const ids = [
    ...new Set(
      imageIds
        .filter((id) => typeof id === 'number' && Number.isFinite(id))
        .map((id) => Math.round(id)),
    ),
  ];
  if (ids.length === 0) {
    return { archived: listArchivedCivitaiImages(), archivedCount: 0 };
  }
  const current = listArchivedCivitaiImages();
  const existing = new Set(current.map((m) => m.imageId));
  const additions: ArchivedCivitaiImage[] = [];
  for (const id of ids) {
    if (existing.has(id)) continue;
    existing.add(id);
    additions.push({ origin, imageId: id });
  }
  if (additions.length === 0) {
    return { archived: current, archivedCount: 0 };
  }
  const next = [...current, ...additions];
  invalidateCivitaiMediaKnown('image');
  // Debounced disk write — spam-archive must not block main on every click.
  patchActiveLibrary({ archivedCivitaiImages: next });
  return { archived: next, archivedCount: additions.length };
}

export function unarchiveCivitaiImage(imageId: number): ArchivedCivitaiImage[] {
  const id = Math.round(imageId);
  const next = listArchivedCivitaiImages().filter((m) => m.imageId !== id);
  invalidateCivitaiMediaKnown('image');
  patchActiveLibrary({ archivedCivitaiImages: next });
  return next;
}

export function isCivitaiImageArchived(imageId: number): boolean {
  const id = Math.round(imageId);
  return listArchivedCivitaiImages().some((m) => m.imageId === id);
}

export function listArchivedCivitaiVideos(): ArchivedCivitaiImage[] {
  return getActiveLibrary().archivedCivitaiVideos ?? [];
}

export function archiveCivitaiVideo(imageId: number): ArchivedCivitaiImage[] {
  return archiveCivitaiVideos([imageId]).archived;
}

export function archiveCivitaiVideos(
  imageIds: number[],
): { archived: ArchivedCivitaiImage[]; archivedCount: number } {
  const origin = getCivitaiOrigin();
  const ids = [
    ...new Set(
      imageIds
        .filter((id) => typeof id === 'number' && Number.isFinite(id))
        .map((id) => Math.round(id)),
    ),
  ];
  if (ids.length === 0) {
    return { archived: listArchivedCivitaiVideos(), archivedCount: 0 };
  }
  const current = listArchivedCivitaiVideos();
  const existing = new Set(current.map((m) => m.imageId));
  const additions: ArchivedCivitaiImage[] = [];
  for (const id of ids) {
    if (existing.has(id)) continue;
    existing.add(id);
    additions.push({ origin, imageId: id });
  }
  if (additions.length === 0) {
    return { archived: current, archivedCount: 0 };
  }
  const next = [...current, ...additions];
  invalidateCivitaiMediaKnown('video');
  // Debounced disk write — spam-archive must not block main on every click.
  patchActiveLibrary({ archivedCivitaiVideos: next });
  return { archived: next, archivedCount: additions.length };
}

export function unarchiveCivitaiVideo(imageId: number): ArchivedCivitaiImage[] {
  const id = Math.round(imageId);
  const next = listArchivedCivitaiVideos().filter((m) => m.imageId !== id);
  invalidateCivitaiMediaKnown('video');
  patchActiveLibrary({ archivedCivitaiVideos: next });
  return next;
}

export function isCivitaiVideoArchived(imageId: number): boolean {
  const id = Math.round(imageId);
  return listArchivedCivitaiVideos().some((m) => m.imageId === id);
}

/** @deprecated Use listArchivedCivitaiModels */
export function listHiddenCivitaiModels(): ArchivedCivitaiModel[] {
  return listArchivedCivitaiModels();
}

export function archiveCivitaiModels(
  modelIds: number[],
): { archived: ArchivedCivitaiModel[]; archivedCount: number } {
  const origin = getCivitaiOrigin();
  const ids = [
    ...new Set(
      modelIds
        .filter((id) => typeof id === 'number' && Number.isFinite(id))
        .map((id) => Math.round(id)),
    ),
  ];
  if (ids.length === 0) {
    return { archived: listArchivedCivitaiModels(), archivedCount: 0 };
  }

  const idSet = new Set(ids);
  const mem = membershipForOrigin(origin);
  const current = listArchivedCivitaiModels();
  let archivedCount = 0;
  const additions: ArchivedCivitaiModel[] = [];
  for (const id of ids) {
    // Always drop Maybe — Archive and Maybe are mutually exclusive even when
    // the id was already archived (stale dual membership / no-op archive).
    mem.maybe.delete(id);
    if (mem.archived.has(id)) continue;
    mem.archived.add(id);
    additions.push({ origin, modelId: id });
    archivedCount += 1;
  }
  const maybe = listMaybeCivitaiModels().filter((m) => !idSet.has(m.modelId));
  const next =
    archivedCount > 0 ? [...current, ...additions] : current;
  // Always persist Maybe cleanup (not only when Archive membership changed).
  patchActiveLibrary(
    {
      archivedCivitaiModels: next,
      maybeCivitaiModels: maybe,
    },
    { flushImmediate: true },
  );
  return { archived: next, archivedCount };
}

export function archiveCivitaiModel(modelId: number): ArchivedCivitaiModel[] {
  return archiveCivitaiModels([modelId]).archived;
}

/** @deprecated Use archiveCivitaiModel */
export function hideCivitaiModel(modelId: number): ArchivedCivitaiModel[] {
  return archiveCivitaiModel(modelId);
}

export function unarchiveCivitaiModel(modelId: number): ArchivedCivitaiModel[] {
  const origin = getCivitaiOrigin();
  const id = Math.round(modelId);
  membershipForOrigin(origin).archived.delete(id);
  const next = listArchivedCivitaiModels().filter((m) => m.modelId !== id);
  patchActiveLibrary(
    { archivedCivitaiModels: next },
    { flushImmediate: true },
  );
  return next;
}

/** @deprecated Use unarchiveCivitaiModel */
export function unhideCivitaiModel(modelId: number): ArchivedCivitaiModel[] {
  return unarchiveCivitaiModel(modelId);
}

export function isCivitaiModelArchived(modelId: number): boolean {
  const origin = getCivitaiOrigin();
  return membershipForOrigin(origin).archived.has(modelId);
}

/** @deprecated Use isCivitaiModelArchived */
export function isCivitaiModelHidden(modelId: number): boolean {
  return isCivitaiModelArchived(modelId);
}

export function listMaybeCivitaiModels(): MaybeCivitaiModel[] {
  return getActiveLibrary().maybeCivitaiModels ?? [];
}

export function maybeCivitaiModel(modelId: number): MaybeCivitaiModel[] {
  const origin = getCivitaiOrigin();
  const id = Math.round(modelId);
  const mem = membershipForOrigin(origin);
  const current = listMaybeCivitaiModels();
  const archived = listArchivedCivitaiModels().filter((m) => m.modelId !== id);
  mem.archived.delete(id);
  if (mem.maybe.has(id)) {
    patchActiveLibrary(
      {
        maybeCivitaiModels: current,
        archivedCivitaiModels: archived,
      },
      { flushImmediate: true },
    );
    return current;
  }
  mem.maybe.add(id);
  const next = [...current, { origin, modelId: id }];
  patchActiveLibrary(
    { maybeCivitaiModels: next, archivedCivitaiModels: archived },
    { flushImmediate: true },
  );
  return next;
}

export function unmaybeCivitaiModel(modelId: number): MaybeCivitaiModel[] {
  const origin = getCivitaiOrigin();
  const id = Math.round(modelId);
  membershipForOrigin(origin).maybe.delete(id);
  const next = listMaybeCivitaiModels().filter((m) => m.modelId !== id);
  patchActiveLibrary(
    { maybeCivitaiModels: next },
    { flushImmediate: true },
  );
  return next;
}

export function isCivitaiModelMaybe(modelId: number): boolean {
  const origin = getCivitaiOrigin();
  return membershipForOrigin(origin).maybe.has(modelId);
}

export function listBlockedCivitaiCreators(): BlockedCivitaiCreator[] {
  return getActiveLibrary().blockedCivitaiCreators ?? [];
}

export function blockCivitaiCreator(username: string): BlockedCivitaiCreator[] {
  const trimmed = username.trim();
  if (!trimmed) throw new Error('Creator username required');
  const origin = getCivitaiOrigin();
  const key = trimmed.toLowerCase();
  const mem = membershipForOrigin(origin);
  const current = listBlockedCivitaiCreators();
  if (mem.blockedCreators.has(key)) {
    return current;
  }
  mem.blockedCreators.add(key);
  const next = [
    ...current,
    { origin, username: trimmed, addedAt: new Date().toISOString() },
  ].sort(
    (a, b) =>
      a.origin.localeCompare(b.origin) ||
      a.username.toLowerCase().localeCompare(b.username.toLowerCase()),
  );
  patchActiveLibrary({ blockedCivitaiCreators: next }, { flushImmediate: true });
  return next;
}

export function unblockCivitaiCreator(
  username: string,
): BlockedCivitaiCreator[] {
  const key = username.trim().toLowerCase();
  if (!key) return listBlockedCivitaiCreators();
  const origin = getCivitaiOrigin();
  membershipForOrigin(origin).blockedCreators.delete(key);
  const next = listBlockedCivitaiCreators().filter(
    (entry) => entry.username.trim().toLowerCase() !== key,
  );
  patchActiveLibrary({ blockedCivitaiCreators: next }, { flushImmediate: true });
  return next;
}

export function isBlockedCivitaiCreator(username: string): boolean {
  const key = username.trim().toLowerCase();
  if (!key) return false;
  const origin = getCivitaiOrigin();
  return membershipForOrigin(origin).blockedCreators.has(key);
}

/**
 * One-time migration: move every archived model into the Maybe shortlist so the
 * user can re-sort them (re-archive the ones they truly never want to see). Runs
 * once, tracked by `archiveToMaybeMigrated`; safe to call on every startup.
 */
export function migrateArchiveToMaybe(): void {
  const settings = loadSettings();
  if (settings.archiveToMaybeMigrated) return;

  const libraries = (settings.libraries ?? []).map((lib) => {
    const archived = lib.archivedCivitaiModels ?? [];
    if (archived.length === 0) {
      return { ...lib, archivedCivitaiModels: [] as ArchivedCivitaiModel[] };
    }
    const seen = new Set<string>();
    const merged: MaybeCivitaiModel[] = [];
    for (const entry of [...(lib.maybeCivitaiModels ?? []), ...archived]) {
      const key = `${entry.origin}:${entry.modelId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
    }
    merged.sort(
      (a, b) => a.origin.localeCompare(b.origin) || a.modelId - b.modelId,
    );
    return {
      ...lib,
      maybeCivitaiModels: merged,
      archivedCivitaiModels: [] as ArchivedCivitaiModel[],
    };
  });

  const activeId = settings.activeLibraryId ?? libraries[0]?.id;
  const active =
    libraries.find((lib) => lib.id === activeId) ?? libraries[0] ?? null;
  if (!active) {
    saveSettings({ archiveToMaybeMigrated: true });
    return;
  }
  for (const lib of libraries) {
    if (lib.wildcardsRoot?.trim()) markLibraryLocalDirty(lib.id);
  }
  persistSettings(
    syncFlatMirrors(
      {
        ...settings,
        libraries,
        activeLibraryId: active.id,
        archiveToMaybeMigrated: true,
      },
      active,
    ),
    { flushImmediate: true, allowEmptyMembershipLists: true },
  );
}

export function listMarkedInstalledCivitaiModels(): ArchivedCivitaiModel[] {
  return getActiveLibrary().markedInstalledCivitaiModels ?? [];
}

export function isCivitaiModelMarkedInstalled(modelId: number): boolean {
  const origin = getCivitaiOrigin();
  return membershipForOrigin(origin).markedInstalled.has(modelId);
}

export function markCivitaiModelInstalled(
  modelId: number,
): ArchivedCivitaiModel[] {
  const origin = getCivitaiOrigin();
  const id = Math.round(modelId);
  const mem = membershipForOrigin(origin);
  const current = listMarkedInstalledCivitaiModels();
  if (current.some((m) => m.modelId === id)) {
    return current;
  }
  mem.markedInstalled.add(id);
  const next = [...current, { origin, modelId: id }].sort(
    (a, b) => a.origin.localeCompare(b.origin) || a.modelId - b.modelId,
  );
  patchActiveLibrary(
    { markedInstalledCivitaiModels: next },
    { flushImmediate: true },
  );
  return next;
}

export function unmarkCivitaiModelInstalled(
  modelId: number,
): ArchivedCivitaiModel[] {
  const origin = getCivitaiOrigin();
  const id = Math.round(modelId);
  membershipForOrigin(origin).markedInstalled.delete(id);
  const next = listMarkedInstalledCivitaiModels().filter(
    (m) => m.modelId !== id,
  );
  patchActiveLibrary(
    { markedInstalledCivitaiModels: next },
    { flushImmediate: true },
  );
  return next;
}

export function listMarkedInstalledCivitaiVersions(): MarkedInstalledCivitaiVersion[] {
  return getActiveLibrary().markedInstalledCivitaiVersions ?? [];
}

/**
 * True when this version/file was marked via “Mark as Downloaded”.
 * Catalog rows often omit `fileId` — fall back to fileName, then any mark on
 * the version when the row itself has no file id.
 */
export function isCivitaiVersionMarkedInstalled(
  modelId: number,
  versionId: number,
  fileId?: number | null,
  fileName?: string | null,
): boolean {
  const mid = Math.round(modelId);
  const marks = listMarkedInstalledCivitaiVersions()
    .filter((m) => m.modelId === mid)
    .map((m) => ({
      versionId: m.versionId,
      fileId: m.fileId,
      fileName: m.fileName,
    }));
  // Lazy import avoided — keep matcher colocated for main-process callers.
  return versionFileIsMarkedInstalled(marks, versionId, fileId, fileName);
}

/** True when any version/file of this model was marked via the download dialog. */
export function isCivitaiModelVersionMarkedInstalled(modelId: number): boolean {
  const id = Math.round(modelId);
  return listMarkedInstalledCivitaiVersions().some((m) => m.modelId === id);
}

export function markCivitaiVersionInstalled(opts: {
  modelId: number;
  versionId: number;
  fileId: number;
  fileName?: string | null;
}): MarkedInstalledCivitaiVersion[] {
  const origin = getCivitaiOrigin();
  const modelId = Math.round(opts.modelId);
  const versionId = Math.round(opts.versionId);
  const fileId = Math.round(opts.fileId);
  const fileName = opts.fileName?.trim() || undefined;
  const key = markedVersionKey(modelId, versionId, fileId);
  const mem = membershipForOrigin(origin);
  const current = listMarkedInstalledCivitaiVersions();
  const existingIdx = current.findIndex(
    (m) =>
      m.modelId === modelId &&
      m.versionId === versionId &&
      (m.fileId === fileId ||
        (fileName &&
          m.fileName?.trim().toLowerCase() === fileName.toLowerCase())),
  );
  if (existingIdx >= 0) {
    const prev = current[existingIdx]!;
    if (!prev.fileName && fileName) {
      const next = current.map((m, i) =>
        i === existingIdx ? { ...m, fileName } : m,
      );
      patchActiveLibrary(
        { markedInstalledCivitaiVersions: next },
        { flushImmediate: true },
      );
      markCivitaiModelInstalled(modelId);
      return next;
    }
    markCivitaiModelInstalled(modelId);
    return current;
  }
  mem.markedInstalledVersions.add(key);
  const next = [
    ...current,
    { origin, modelId, versionId, fileId, fileName },
  ].sort(
    (a, b) =>
      a.origin.localeCompare(b.origin) ||
      a.modelId - b.modelId ||
      a.versionId - b.versionId ||
      a.fileId - b.fileId,
  );
  patchActiveLibrary(
    { markedInstalledCivitaiVersions: next },
    { flushImmediate: true },
  );
  // Also mark the model so Browse “Hide downloaded” works even when AutoV2
  // rematch lags or Civitai’s published hashes omit the local file.
  markCivitaiModelInstalled(modelId);
  return next;
}

export function listCivitaiWatchlist(): WatchedCivitaiModel[] {
  return getActiveLibrary().civitaiWatchlist ?? [];
}

export function isCivitaiModelWatched(modelId: number): boolean {
  const origin = getCivitaiOrigin();
  return membershipForOrigin(origin).watching.has(modelId);
}

export function watchCivitaiModel(entry: {
  modelId: number;
  modelName: string;
  type: 'LORA' | 'Checkpoint';
  versionId?: number;
  earlyAccessEndsAt?: string;
}): WatchedCivitaiModel[] {
  const origin = getCivitaiOrigin();
  const modelId = Math.round(entry.modelId);
  const current = listCivitaiWatchlist();
  if (current.some((m) => m.modelId === modelId)) {
    return current;
  }
  membershipForOrigin(origin).watching.add(modelId);
  const next: WatchedCivitaiModel[] = [
    ...current,
    {
      origin,
      modelId,
      modelName: entry.modelName.trim() || String(modelId),
      type: entry.type,
      versionId: entry.versionId,
      earlyAccessEndsAt: entry.earlyAccessEndsAt,
      available: false,
      addedAt: new Date().toISOString(),
    },
  ];
  const sorted = next.sort(
    (a, b) =>
      a.origin.localeCompare(b.origin) ||
      Number(b.available) - Number(a.available) ||
      a.modelName.localeCompare(b.modelName),
  );
  patchActiveLibrary({ civitaiWatchlist: sorted }, { flushImmediate: true });
  return listCivitaiWatchlist();
}

export function unwatchCivitaiModel(modelId: number): WatchedCivitaiModel[] {
  const origin = getCivitaiOrigin();
  const id = Math.round(modelId);
  membershipForOrigin(origin).watching.delete(id);
  const next = listCivitaiWatchlist().filter((m) => m.modelId !== id);
  patchActiveLibrary({ civitaiWatchlist: next }, { flushImmediate: true });
  return next;
}

/** Drop legacy “available” rows — unlocked models belong in Browse only. */
export function purgeAvailableCivitaiWatchlistEntries(): WatchedCivitaiModel[] {
  const origin = getCivitaiOrigin();
  const current = listCivitaiWatchlist();
  const next = current.filter((m) => {
    if (!m.available) return true;
    membershipForOrigin(origin).watching.delete(m.modelId);
    return false;
  });
  if (next.length === current.length) return current;
  patchActiveLibrary({ civitaiWatchlist: next }, { flushImmediate: true });
  return next;
}

export function updateCivitaiWatchlistEntry(
  modelId: number,
  patch: Partial<
    Pick<
      WatchedCivitaiModel,
      | 'modelName'
      | 'versionId'
      | 'earlyAccessEndsAt'
      | 'available'
      | 'availableAt'
      | 'type'
    >
  >,
): WatchedCivitaiModel[] {
  const id = Math.round(modelId);
  const next = listCivitaiWatchlist().map((m) =>
    m.modelId === id ? { ...m, ...patch } : m,
  );
  patchActiveLibrary({ civitaiWatchlist: next }, { flushImmediate: true });
  return listCivitaiWatchlist();
}

export function listCivitaiRecentlyUnlocked(): RecentlyUnlockedCivitaiModel[] {
  return parseCivitaiRecentlyUnlocked(
    getActiveLibrary().civitaiRecentlyUnlocked ?? [],
  );
}

export function recordCivitaiRecentlyUnlocked(
  entries: Array<{
    modelId: number;
    modelName: string;
    type: 'LORA' | 'Checkpoint';
    versionId?: number;
    unlockedAt?: string;
  }>,
): RecentlyUnlockedCivitaiModel[] {
  if (entries.length === 0) return listCivitaiRecentlyUnlocked();
  const origin = getCivitaiOrigin();
  const unlockedAt = new Date().toISOString();
  const incoming: RecentlyUnlockedCivitaiModel[] = entries.map((e) => ({
    origin,
    modelId: Math.round(e.modelId),
    modelName: e.modelName.trim() || String(e.modelId),
    type: e.type,
    versionId: e.versionId,
    unlockedAt: e.unlockedAt ?? unlockedAt,
  }));
  const seen = new Set(incoming.map((e) => `${e.origin}:${e.modelId}`));
  const kept = listCivitaiRecentlyUnlocked().filter(
    (e) => !seen.has(`${e.origin}:${e.modelId}`),
  );
  const next = parseCivitaiRecentlyUnlocked([...incoming, ...kept]).slice(
    0,
    MAX_RECENTLY_UNLOCKED,
  );
  patchActiveLibrary({ civitaiRecentlyUnlocked: next }, { flushImmediate: true });
  return next;
}

export function dismissCivitaiRecentlyUnlocked(
  modelId: number,
): RecentlyUnlockedCivitaiModel[] {
  const id = Math.round(modelId);
  const next = listCivitaiRecentlyUnlocked().filter((e) => e.modelId !== id);
  patchActiveLibrary({ civitaiRecentlyUnlocked: next }, { flushImmediate: true });
  return next;
}

export function ignoreUnusedLora(relativePath: string): string[] {
  return ignoreUnusedLoras([relativePath]);
}

/** Ignore one or more unused-LoRA paths (e.g. a full training-step series). */
export function ignoreUnusedLoras(relativePaths: string[]): string[] {
  const toAdd = relativePaths
    .map((p) => p.trim().replaceAll('\\', '/'))
    .filter(Boolean);
  if (toAdd.length === 0) throw new Error('Invalid LoRA path');
  const current = getActiveLibrary().ignoredUnusedLoras ?? [];
  const seen = new Set(current.map((item) => item.toLowerCase()));
  const next = [...current];
  for (const path of toAdd) {
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(path);
  }
  if (next.length === current.length) return current;
  next.sort((a, b) => a.localeCompare(b));
  patchActiveLibrary({ ignoredUnusedLoras: next });
  return next;
}

/** Update ignored-unused entries when a LoRA file is renamed on disk. */
export function renameIgnoredUnusedLora(
  oldRelativePath: string,
  newRelativePath: string,
): string[] {
  const from = oldRelativePath.trim().replaceAll('\\', '/');
  const to = newRelativePath.trim().replaceAll('\\', '/');
  if (!from || !to) return getActiveLibrary().ignoredUnusedLoras ?? [];
  const current = getActiveLibrary().ignoredUnusedLoras ?? [];
  let changed = false;
  const next = current.map((item) => {
    if (item.toLowerCase() === from.toLowerCase()) {
      changed = true;
      return to;
    }
    return item;
  });
  if (!changed) return current;
  const deduped = [
    ...new Set(next.map((item) => item.trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
  patchActiveLibrary({ ignoredUnusedLoras: deduped });
  return deduped;
}

/** Drop an ignored-unused entry when the LoRA file is deleted. */
export function removeIgnoredUnusedLora(relativePath: string): string[] {
  const normalized = relativePath.trim().replaceAll('\\', '/');
  if (!normalized) return getActiveLibrary().ignoredUnusedLoras ?? [];
  const current = getActiveLibrary().ignoredUnusedLoras ?? [];
  const next = current.filter(
    (item) => item.toLowerCase() !== normalized.toLowerCase(),
  );
  if (next.length === current.length) return current;
  patchActiveLibrary({ ignoredUnusedLoras: next });
  return next;
}

export function setWindowState(state: WindowState): void {
  saveSettings({ windowState: state });
}

export function isCivitaiBrowserDetached(): boolean {
  return loadSettings().civitaiBrowserDetached === true;
}

export function setCivitaiBrowserDetached(detached: boolean): boolean {
  saveSettings({ civitaiBrowserDetached: detached === true });
  return detached === true;
}

export function getCivitaiWindowState(): WindowState | undefined {
  return loadSettings().civitaiWindowState;
}

export function setCivitaiWindowState(state: WindowState): void {
  saveSettings({ civitaiWindowState: state });
}

export function getHfWindowState(): WindowState | undefined {
  return loadSettings().hfWindowState;
}

export function setHfWindowState(state: WindowState): void {
  saveSettings({ hfWindowState: state });
}

export function getLastCivitaiDownloadCategory(
  type: 'LORA' | 'Checkpoint',
): string {
  return getActiveLibrary().lastCivitaiDownloadCategory?.[type] ?? '';
}

export function setLastCivitaiDownloadCategory(
  type: 'LORA' | 'Checkpoint',
  category: string,
): string {
  const normalized = category.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const current = getActiveLibrary().lastCivitaiDownloadCategory ?? {};
  patchActiveLibrary({
    lastCivitaiDownloadCategory: {
      ...current,
      [type]: normalized,
    },
  });
  return normalized;
}

export function getLoraDownloadCategories(): LoraDownloadCategory[] {
  return [...(getActiveLibrary().loraDownloadCategories ?? [])];
}

export function setLoraDownloadCategories(
  categories: LoraDownloadCategory[],
): LoraDownloadCategory[] {
  const cleaned = parseLoraDownloadCategories(categories);
  patchActiveLibrary({ loraDownloadCategories: cleaned });
  return cleaned;
}

export function getLastLoraDownloadCategoryId(): string | null {
  const id = getActiveLibrary().lastLoraDownloadCategoryId?.trim();
  return id || null;
}

export function setLastLoraDownloadCategoryId(id: string | null): void {
  const trimmed = id?.trim() || '';
  patchActiveLibrary({
    lastLoraDownloadCategoryId: trimmed || undefined,
  });
}

export const DEFAULT_CIVITAI_SPLIT_RATIO = 0.42;
const MIN_CIVITAI_SPLIT_RATIO = 0.22;
const MAX_CIVITAI_SPLIT_RATIO = 0.7;

function parseCivitaiSplitRatio(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_CIVITAI_SPLIT_RATIO;
  }
  return Math.min(
    MAX_CIVITAI_SPLIT_RATIO,
    Math.max(MIN_CIVITAI_SPLIT_RATIO, raw),
  );
}

export function getCivitaiSplitRatio(): number {
  return parseCivitaiSplitRatio(loadSettings().civitaiSplitRatio);
}

export function setCivitaiSplitRatio(ratio: number): number {
  const next = parseCivitaiSplitRatio(ratio);
  saveSettings({ civitaiSplitRatio: next });
  return next;
}

export const DEFAULT_CIVITAI_CARD_MIN_WIDTH = 160;
export const MIN_CIVITAI_CARD_MIN_WIDTH = 100;
export const MAX_CIVITAI_CARD_MIN_WIDTH = 280;
export const CIVITAI_CARD_MIN_WIDTH_STEP = 20;

export function parseCivitaiCardMinWidth(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_CIVITAI_CARD_MIN_WIDTH;
  }
  const stepped =
    Math.round(raw / CIVITAI_CARD_MIN_WIDTH_STEP) * CIVITAI_CARD_MIN_WIDTH_STEP;
  return Math.min(
    MAX_CIVITAI_CARD_MIN_WIDTH,
    Math.max(MIN_CIVITAI_CARD_MIN_WIDTH, stepped),
  );
}

export function getCivitaiCardMinWidth(): number {
  return parseCivitaiCardMinWidth(loadSettings().civitaiCardMinWidth);
}

export function setCivitaiCardMinWidth(px: number): number {
  const next = parseCivitaiCardMinWidth(px);
  saveSettings({ civitaiCardMinWidth: next });
  return next;
}

export function getCivitaiBrowseFilters(): CivitaiBrowseFiltersDto {
  return (
    getActiveLibrary().civitaiBrowseFilters ?? {
      ...DEFAULT_CIVITAI_BROWSE_FILTERS,
    }
  );
}

export function setCivitaiBrowseFilters(
  filters: CivitaiBrowseFiltersDto,
): CivitaiBrowseFiltersDto {
  const normalized = parseCivitaiBrowseFilters(filters);
  patchActiveLibrary({ civitaiBrowseFilters: normalized });
  return normalized;
}

export function getCivitaiImageBrowseFilters(): CivitaiImageBrowseFiltersDto {
  return parseCivitaiImageBrowseFilters(
    getActiveLibrary().civitaiImageBrowseFilters,
  );
}

export function setCivitaiImageBrowseFilters(
  filters: CivitaiImageBrowseFiltersDto,
): CivitaiImageBrowseFiltersDto {
  const normalized = parseCivitaiImageBrowseFilters(filters);
  patchActiveLibrary({ civitaiImageBrowseFilters: normalized });
  return normalized;
}

export function getCivitaiVideoBrowseFilters(): CivitaiImageBrowseFiltersDto {
  return parseCivitaiImageBrowseFilters(
    getActiveLibrary().civitaiVideoBrowseFilters,
  );
}

export function setCivitaiVideoBrowseFilters(
  filters: CivitaiImageBrowseFiltersDto,
): CivitaiImageBrowseFiltersDto {
  const normalized = parseCivitaiImageBrowseFilters(filters);
  patchActiveLibrary({ civitaiVideoBrowseFilters: normalized });
  return normalized;
}

export function getHfBrowseFilters(): HfBrowseFiltersDto {
  return (
    getActiveLibrary().hfBrowseFilters ?? {
      ...DEFAULT_HF_BROWSE_FILTERS,
    }
  );
}

export function setHfBrowseFilters(
  filters: HfBrowseFiltersDto,
): HfBrowseFiltersDto {
  const normalized = parseHfBrowseFilters(filters);
  patchActiveLibrary({ hfBrowseFilters: normalized });
  return normalized;
}

export function clearHfBrowseFilters(): HfBrowseFiltersDto {
  const normalized = { ...DEFAULT_HF_BROWSE_FILTERS };
  patchActiveLibrary({ hfBrowseFilters: normalized });
  return normalized;
}
