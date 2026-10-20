import type {
  CivitaiBrowseFiltersDto,
  CivitaiImageBrowseFiltersDto,
  HfBrowseFiltersDto,
  ValidationPlatform,
} from '../shared/contracts.js';
import type {
  CivitaiArchitectureId,
  CivitaiSdxlFamilyToggleId,
} from '../domain/civitaiBaseModels.js';
import type { CivitaiModelCategoryId } from '../domain/civitaiModelCategories.js';
import type { LoraDownloadCategory } from '../domain/loraDownloadCategory.js';
import {
  normalizePromptSubstitutions,
  type PromptSubstitution,
} from '../domain/promptSubstitution.js';
import type { CivitaiOrigin } from '../domain/civitaiSnippet.js';
import { libraryJsonPath, legacyWildcardsWcmDir } from '../domain/librarySidecarPaths.js';
import { atomicWriteFile, readJsonFile } from './librarySidecarIo.js';
import { noteBlockingWork } from './mainStallWatchdog.js';
import path from 'node:path';

export const LIBRARY_LOCAL_VERSION = 1 as const;

type ArchivedCivitaiModel = {
  origin: CivitaiOrigin;
  modelId: number;
};

type ArchivedHfModel = {
  repoId: string;
};

type MarkedInstalledCivitaiVersion = {
  origin: CivitaiOrigin;
  modelId: number;
  versionId: number;
  fileId: number;
  fileName?: string;
};

type MaybeCivitaiModel = {
  origin: CivitaiOrigin;
  modelId: number;
};

type WatchedCivitaiModel = {
  origin: CivitaiOrigin;
  modelId: number;
  modelName: string;
  type: 'LORA' | 'Checkpoint';
  versionId?: number;
  earlyAccessEndsAt?: string;
  available: boolean;
  addedAt: string;
  availableAt?: string;
};

/** Models that left Notify after early access ended — kept findable in Browse. */
type RecentlyUnlockedCivitaiModel = {
  origin: CivitaiOrigin;
  modelId: number;
  modelName: string;
  type: 'LORA' | 'Checkpoint';
  versionId?: number;
  unlockedAt: string;
};

type BlockedCivitaiCreator = {
  origin: CivitaiOrigin;
  username: string;
  addedAt: string;
};

/** Payload stored at sibling `<basename>.wcm/library.json` next to the wildcards root. */
export type LibraryLocalPayload = {
  version: typeof LIBRARY_LOCAL_VERSION;
  lastRootFile?: string;
  ignoredUnusedLoras?: string[];
  /**
   * Checkpoint relative paths this library does not use. Other libraries that
   * share the same checkpoint folder keep their own list. Missing means all
   * checkpoints are in use.
   */
  ignoredCheckpoints?: string[];
  /**
   * Generation prompt replacements for this library. A rule runs when the
   * checkpoint file name contains `modelContains`.
   */
  promptSubstitutions?: PromptSubstitution[];
  archivedCivitaiModels?: ArchivedCivitaiModel[];
  archivedCivitaiImages?: Array<{ origin: CivitaiOrigin; imageId: number }>;
  archivedCivitaiVideos?: Array<{ origin: CivitaiOrigin; imageId: number }>;
  archivedHfModels?: ArchivedHfModel[];
  downloadedHfModels?: ArchivedHfModel[];
  maybeCivitaiModels?: MaybeCivitaiModel[];
  markedInstalledCivitaiModels?: ArchivedCivitaiModel[];
  markedInstalledCivitaiVersions?: MarkedInstalledCivitaiVersion[];
  civitaiWatchlist?: WatchedCivitaiModel[];
  /** Models that left Notify after unlock — pinned in Browse until dismissed. */
  civitaiRecentlyUnlocked?: RecentlyUnlockedCivitaiModel[];
  /** Creators whose Browse cards are hidden for this library. */
  blockedCivitaiCreators?: BlockedCivitaiCreator[];
  lastCivitaiDownloadCategory?: Partial<Record<'LORA' | 'Checkpoint', string>>;
  loraDownloadCategories?: LoraDownloadCategory[];
  lastLoraDownloadCategoryId?: string;
  civitaiBrowseFilters?: CivitaiBrowseFiltersDto;
  civitaiImageBrowseFilters?: CivitaiImageBrowseFiltersDto;
  civitaiVideoBrowseFilters?: CivitaiImageBrowseFiltersDto;
  hfBrowseFilters?: HfBrowseFiltersDto;
  enabledArchitectures?: CivitaiArchitectureId[];
  enabledSdxlFamilies?: CivitaiSdxlFamilyToggleId[];
  enabledCivitaiCategories?: CivitaiModelCategoryId[];
  validationPlatform?: ValidationPlatform;
  civitaiOrigin?: CivitaiOrigin;
};

/** Structural library fields used when reading/writing the local payload. */
export type LibraryLocalSource = {
  wildcardsRoot: string | null;
  lastRootFile?: string;
  ignoredUnusedLoras?: string[];
  ignoredCheckpoints?: string[];
  promptSubstitutions?: PromptSubstitution[];
  archivedCivitaiModels?: ArchivedCivitaiModel[];
  archivedCivitaiImages?: Array<{ origin: CivitaiOrigin; imageId: number }>;
  archivedCivitaiVideos?: Array<{ origin: CivitaiOrigin; imageId: number }>;
  archivedHfModels?: ArchivedHfModel[];
  downloadedHfModels?: ArchivedHfModel[];
  maybeCivitaiModels?: MaybeCivitaiModel[];
  markedInstalledCivitaiModels?: ArchivedCivitaiModel[];
  markedInstalledCivitaiVersions?: MarkedInstalledCivitaiVersion[];
  civitaiWatchlist?: WatchedCivitaiModel[];
  civitaiRecentlyUnlocked?: RecentlyUnlockedCivitaiModel[];
  blockedCivitaiCreators?: BlockedCivitaiCreator[];
  lastCivitaiDownloadCategory?: Partial<Record<'LORA' | 'Checkpoint', string>>;
  loraDownloadCategories?: LoraDownloadCategory[];
  lastLoraDownloadCategoryId?: string;
  civitaiBrowseFilters?: CivitaiBrowseFiltersDto;
  civitaiImageBrowseFilters?: CivitaiImageBrowseFiltersDto;
  civitaiVideoBrowseFilters?: CivitaiImageBrowseFiltersDto;
  hfBrowseFilters?: HfBrowseFiltersDto;
  enabledArchitectures: CivitaiArchitectureId[];
  enabledSdxlFamilies: CivitaiSdxlFamilyToggleId[];
  enabledCivitaiCategories: CivitaiModelCategoryId[];
  validationPlatform: ValidationPlatform;
  civitaiOrigin: CivitaiOrigin;
};

export function libraryConfigToPayload(
  lib: LibraryLocalSource,
): LibraryLocalPayload {
  return {
    version: LIBRARY_LOCAL_VERSION,
    lastRootFile: lib.lastRootFile,
    ignoredUnusedLoras: lib.ignoredUnusedLoras ?? [],
    ignoredCheckpoints: lib.ignoredCheckpoints ?? [],
    promptSubstitutions: lib.promptSubstitutions ?? [],
    archivedCivitaiModels: lib.archivedCivitaiModels ?? [],
    archivedCivitaiImages: lib.archivedCivitaiImages ?? [],
    archivedCivitaiVideos: lib.archivedCivitaiVideos ?? [],
    archivedHfModels: lib.archivedHfModels ?? [],
    downloadedHfModels: lib.downloadedHfModels ?? [],
    maybeCivitaiModels: lib.maybeCivitaiModels ?? [],
    markedInstalledCivitaiModels: lib.markedInstalledCivitaiModels ?? [],
    markedInstalledCivitaiVersions: lib.markedInstalledCivitaiVersions ?? [],
    civitaiWatchlist: lib.civitaiWatchlist ?? [],
    civitaiRecentlyUnlocked: lib.civitaiRecentlyUnlocked ?? [],
    blockedCivitaiCreators: lib.blockedCivitaiCreators ?? [],
    lastCivitaiDownloadCategory: lib.lastCivitaiDownloadCategory ?? {},
    loraDownloadCategories: lib.loraDownloadCategories ?? [],
    lastLoraDownloadCategoryId: lib.lastLoraDownloadCategoryId,
    civitaiBrowseFilters: lib.civitaiBrowseFilters,
    civitaiImageBrowseFilters: lib.civitaiImageBrowseFilters,
    civitaiVideoBrowseFilters: lib.civitaiVideoBrowseFilters,
    hfBrowseFilters: lib.hfBrowseFilters,
    enabledArchitectures: lib.enabledArchitectures,
    enabledSdxlFamilies: lib.enabledSdxlFamilies,
    enabledCivitaiCategories: lib.enabledCivitaiCategories,
    validationPlatform: lib.validationPlatform,
    civitaiOrigin: lib.civitaiOrigin,
  };
}

export function applyPayloadToLibrary<T extends LibraryLocalSource>(
  lib: T,
  payload: LibraryLocalPayload | null | undefined,
): T {
  if (!payload || payload.version !== LIBRARY_LOCAL_VERSION) return lib;
  return {
    ...lib,
    lastRootFile: payload.lastRootFile ?? lib.lastRootFile,
    ignoredUnusedLoras: payload.ignoredUnusedLoras ?? lib.ignoredUnusedLoras,
    ignoredCheckpoints: payload.ignoredCheckpoints ?? lib.ignoredCheckpoints,
    promptSubstitutions:
      payload.promptSubstitutions !== undefined
        ? normalizePromptSubstitutions(payload.promptSubstitutions)
        : lib.promptSubstitutions,
    archivedCivitaiModels:
      payload.archivedCivitaiModels ?? lib.archivedCivitaiModels,
    archivedCivitaiImages:
      payload.archivedCivitaiImages ?? lib.archivedCivitaiImages,
    archivedCivitaiVideos:
      payload.archivedCivitaiVideos ?? lib.archivedCivitaiVideos,
    archivedHfModels: payload.archivedHfModels ?? lib.archivedHfModels,
    downloadedHfModels:
      payload.downloadedHfModels ?? lib.downloadedHfModels,
    maybeCivitaiModels: payload.maybeCivitaiModels ?? lib.maybeCivitaiModels,
    markedInstalledCivitaiModels:
      payload.markedInstalledCivitaiModels ?? lib.markedInstalledCivitaiModels,
    markedInstalledCivitaiVersions:
      payload.markedInstalledCivitaiVersions ??
      lib.markedInstalledCivitaiVersions,
    civitaiWatchlist: payload.civitaiWatchlist ?? lib.civitaiWatchlist,
    civitaiRecentlyUnlocked:
      payload.civitaiRecentlyUnlocked ?? lib.civitaiRecentlyUnlocked,
    blockedCivitaiCreators:
      payload.blockedCivitaiCreators ?? lib.blockedCivitaiCreators,
    lastCivitaiDownloadCategory:
      payload.lastCivitaiDownloadCategory ?? lib.lastCivitaiDownloadCategory,
    loraDownloadCategories:
      payload.loraDownloadCategories ?? lib.loraDownloadCategories,
    lastLoraDownloadCategoryId:
      payload.lastLoraDownloadCategoryId ?? lib.lastLoraDownloadCategoryId,
    civitaiBrowseFilters:
      payload.civitaiBrowseFilters ?? lib.civitaiBrowseFilters,
    civitaiImageBrowseFilters:
      payload.civitaiImageBrowseFilters ?? lib.civitaiImageBrowseFilters,
    civitaiVideoBrowseFilters:
      payload.civitaiVideoBrowseFilters ?? lib.civitaiVideoBrowseFilters,
    hfBrowseFilters: payload.hfBrowseFilters ?? lib.hfBrowseFilters,
    enabledArchitectures:
      payload.enabledArchitectures ?? lib.enabledArchitectures,
    enabledSdxlFamilies: payload.enabledSdxlFamilies ?? lib.enabledSdxlFamilies,
    enabledCivitaiCategories:
      payload.enabledCivitaiCategories ?? lib.enabledCivitaiCategories,
    validationPlatform: payload.validationPlatform ?? lib.validationPlatform,
    civitaiOrigin: payload.civitaiOrigin ?? lib.civitaiOrigin,
  };
}

/** List fields that must not be clobbered by an empty in-memory flush. */
const PROTECTED_LIST_KEYS = [
  'ignoredUnusedLoras',
  'ignoredCheckpoints',
  'archivedCivitaiModels',
  'archivedCivitaiImages',
  'archivedCivitaiVideos',
  'archivedHfModels',
  'downloadedHfModels',
  'maybeCivitaiModels',
  'markedInstalledCivitaiModels',
  'markedInstalledCivitaiVersions',
  'civitaiWatchlist',
  'civitaiRecentlyUnlocked',
  'blockedCivitaiCreators',
  'loraDownloadCategories',
] as const satisfies ReadonlyArray<keyof LibraryLocalPayload>;
function listLen(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function readLibraryLocalPayload(
  wildcardsRoot: string | null | undefined,
): LibraryLocalPayload | null {
  if (!wildcardsRoot?.trim()) return null;
  const sibling = readJsonFile<LibraryLocalPayload>(
    libraryJsonPath(wildcardsRoot),
  );
  const legacy = readJsonFile<LibraryLocalPayload>(
    path.join(legacyWildcardsWcmDir(wildcardsRoot), 'library.json'),
  );
  if (sibling && legacy) {
    // Membership lists pick which file wins when both still exist. Keys that
    // exist on only one file (prompt substitutions saved on the sibling while
    // the in-tree file still has the longer archive lists) must survive.
    const score = (p: LibraryLocalPayload) =>
      PROTECTED_LIST_KEYS.reduce((sum, key) => sum + listLen(p[key]), 0);
    const primary = score(sibling) >= score(legacy) ? sibling : legacy;
    const secondary = primary === sibling ? legacy : sibling;
    return { ...secondary, ...primary };
  }
  return sibling ?? legacy;
}

export function writeLibraryLocalPayload(
  wildcardsRoot: string,
  payload: LibraryLocalPayload,
): void {
  // Compact JSON — pretty-print of 10k+ archive rows blocks the UI.
  noteBlockingWork('Writing library.json', () => {
    atomicWriteFile(
      libraryJsonPath(wildcardsRoot),
      `${JSON.stringify({ ...payload, version: LIBRARY_LOCAL_VERSION })}\n`,
    );
  });
}

/**
 * Merge outgoing payload with on-disk lists so an accidental empty in-memory
 * state cannot wipe non-empty lists.
 *
 * - Catastrophic wipe: every protected membership list is empty in memory
 *   while disk still has items → restore all non-empty disk lists.
 * - Single-list wipe: one membership list goes empty while disk still has
 *   items for it, and other membership lists did not also shrink to empty
 *   as part of a coordinated clear → restore that list. (Shared wildcards
 *   roots / unhydrated secondary libraries used to empty one list at a time.)
 * - Category wipe: `loraDownloadCategories` alone empty while disk has
 *   categories → keep disk categories.
 *
 * Pass `allowEmptyMembershipLists` for intentional clears (migrations).
 */
export function protectLibraryListsFromEmptyClobber(
  incoming: LibraryLocalPayload,
  existing: LibraryLocalPayload | null,
  opts?: { allowEmptyMembershipLists?: boolean },
): LibraryLocalPayload {
  if (!existing || existing.version !== LIBRARY_LOCAL_VERSION) return incoming;

  const membershipKeys = PROTECTED_LIST_KEYS.filter(
    (key) => key !== 'loraDownloadCategories',
  );

  let diskTotal = 0;
  let memTotal = 0;
  for (const key of membershipKeys) {
    diskTotal += listLen(existing[key]);
    memTotal += listLen(incoming[key]);
  }

  const next: LibraryLocalPayload = { ...incoming };
  const protectedKeys: string[] = [];
  const allowEmpty = opts?.allowEmptyMembershipLists === true;

  if (!allowEmpty && diskTotal > 0 && memTotal === 0) {
    for (const key of membershipKeys) {
      const diskLen = listLen(existing[key]);
      if (diskLen > 0) {
        (next as Record<string, unknown>)[key] = existing[key];
        protectedKeys.push(`${key}(${diskLen})`);
      }
    }
  } else if (!allowEmpty) {
    // Partial wipe: restore any single list that vanished while disk still
    // has members. Legitimate "unarchive last item" is mem=0 disk=1 for that
    // list only — also restore when disk had multiple items (suspicious).
    for (const key of membershipKeys) {
      const diskLen = listLen(existing[key]);
      const memLen = listLen(incoming[key]);
      if (diskLen > 1 && memLen === 0) {
        (next as Record<string, unknown>)[key] = existing[key];
        protectedKeys.push(`${key}(${diskLen}→0)`);
      }
    }
  }

  const diskCats = listLen(existing.loraDownloadCategories);
  const memCats = listLen(incoming.loraDownloadCategories);
  if (diskCats > 0 && memCats === 0) {
    next.loraDownloadCategories = existing.loraDownloadCategories;
    protectedKeys.push(`loraDownloadCategories(${diskCats})`);
  }

  if (protectedKeys.length > 0) {
    console.warn(
      `[libraryLocalState] refused empty clobber of non-empty lists: ${protectedKeys.join(', ')}`,
    );
  }
  return next;
}

const pendingLibraryLocal = new Map<string, LibraryLocalPayload>();
let libraryLocalFlushTimer: ReturnType<typeof setImmediate> | null = null;

function membershipItemCount(payload: LibraryLocalPayload): number {
  return PROTECTED_LIST_KEYS.filter((key) => key !== 'loraDownloadCategories')
    .reduce((sum, key) => sum + listLen(payload[key]), 0);
}

function flushPendingLibraryLocal(): void {
  libraryLocalFlushTimer = null;
  const batch = [...pendingLibraryLocal];
  pendingLibraryLocal.clear();
  for (const [root, payload] of batch) {
    writeLibraryLocalPayload(root, payload);
  }
}

/** Flush queued sibling library.json writes (quit / library switch). */
export function flushLibraryLocalSync(): void {
  if (libraryLocalFlushTimer !== null) {
    clearImmediate(libraryLocalFlushTimer);
    libraryLocalFlushTimer = null;
  }
  flushPendingLibraryLocal();
}

export function persistLibraryLocalFromConfig(
  lib: LibraryLocalSource,
  opts?: { allowEmptyMembershipLists?: boolean; flushImmediate?: boolean },
): void {
  if (!lib.wildcardsRoot?.trim()) return;
  const root = lib.wildcardsRoot;
  const incoming = libraryConfigToPayload(lib);
  // Memory already has lists — don't re-parse a multi-MB library.json on
  // every Archive click (that froze the UI). Only read disk when memory
  // looks emptied (clobber guard).
  const existing =
    membershipItemCount(incoming) === 0
      ? readLibraryLocalPayload(root)
      : null;
  const payload = protectLibraryListsFromEmptyClobber(
    incoming,
    existing,
    opts,
  );
  pendingLibraryLocal.set(root, payload);
  if (opts?.flushImmediate === true) {
    flushLibraryLocalSync();
    return;
  }
  if (libraryLocalFlushTimer !== null) return;
  libraryLocalFlushTimer = setImmediate(flushPendingLibraryLocal);
}
