import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IPC, WORKSPACE_TAB_IDS, type WorkspaceTabId } from '../shared/contracts.js';
import { isWorkspaceListFilterTab } from '../shared/workspaceListFilters.js';
import {
  openFolderInMyFileExplorer,
  revealInMyFileExplorer,
} from './myFileExplorer.js';
import {
  analyzeFromContent,
  analyzeFromFile,
  refreshUnusedLoraIssues,
  validateFileContent,
} from './analyzeService.js';
import {
  cancelWildcardValidation,
  getWildcardValidationReport,
  startWildcardValidation,
} from './wildcardValidationService.js';
import { buildLibraryIndex } from '../domain/resolveWildcard.js';
import { libraryService } from './libraryService.js';
import {
  loadSettings,
  ignoreUnusedLora,
  ignoreUnusedLoras,
  setDetailsPanelWidth,
  setFilesPanelWidth,
  setPromptsSamplesCollapsed,
  setGenerationPreviewCollapsed,
  setGenerationPromptBoxHeights,
  setPromptCoverageWindow,
  setPromptSubstitutionsWindow,
  setBenchmarkResultsWindow,
  getBenchmarkResultsView,
  setBenchmarkResultsView,
  resolvePanelWidthsByTab,
  setGraphLayoutStyle,
  getWorkspaceListFilters,
  setWorkspaceListFilter,
  setLastFile,
  clearLastFile,
  setConvertChildSuffix,
  getConvertChildSuffix,
  setLoraFolder,
  setCheckpointFolder,
  setImagesFolder,
  setVideosFolder,
  setTrainingLibraryFolder,
  setPromptsFolder,
  getCivitaiOrigin,
  setCivitaiOrigin,
  getCivitaiApiKey,
  setCivitaiApiKey,
  getHuggingFaceToken,
  setHuggingFaceToken,
  archiveHfModel,
  unarchiveHfModel,
  listArchivedHfModels,
  listDownloadedHfModels,
  forgetDownloadedHfModel,
  getCivitaiCatalogAutoSyncIntervalMinutes,
  setCivitaiCatalogAutoSyncIntervalMinutes,
  getDisableHardwareAcceleration,
  setDisableHardwareAcceleration,
  getGenerationSaveInNewSubfolder,
  setGenerationSaveInNewSubfolder,
  getUpdateReleaseFolder,
  setUpdateReleaseFolder,
  getCivitaiBrowseFilters,
  setCivitaiBrowseFilters,
  getCivitaiImageBrowseFilters,
  setCivitaiImageBrowseFilters,
  getCivitaiVideoBrowseFilters,
  setCivitaiVideoBrowseFilters,
  getHfBrowseFilters,
  setHfBrowseFilters,
  clearHfBrowseFilters,
  getCivitaiSplitRatio,
  setCivitaiSplitRatio,
  getCivitaiCardMinWidth,
  setCivitaiCardMinWidth,
  archiveCivitaiModel,
  archiveCivitaiModels,
  unarchiveCivitaiModel,
  listArchivedCivitaiModels,
  archiveCivitaiImage,
  archiveCivitaiImages,
  unarchiveCivitaiImage,
  listArchivedCivitaiImages,
  archiveCivitaiVideo,
  archiveCivitaiVideos,
  unarchiveCivitaiVideo,
  listArchivedCivitaiVideos,
  maybeCivitaiModel,
  unmaybeCivitaiModel,
  listMaybeCivitaiModels,
  blockCivitaiCreator,
  unblockCivitaiCreator,
  listBlockedCivitaiCreators,
  watchCivitaiModel,
  unwatchCivitaiModel,
  setSimulationSettings,
  listLibraryConfigs,
  getActiveLibrary,
  getActiveLibraryId,
  createLibraryConfig,
  updateLibraryConfig,
  deleteLibraryConfig,
  setActiveLibraryId,
} from './settingsStore.js';
import { toLibraryConfigDto } from './libraryConfigDto.js';
import { bindActiveLibraryDataRoots } from './libraryDataMigration.js';
import {
  applyLibraryPathMigration,
  planLibraryPathMigrationForLibrary,
  suggestLibraryPathMigrationPrefix,
} from './libraryPathMigration.js';
import { wildcardsBackupsDir } from '../domain/librarySidecarPaths.js';
import {
  categorizeUnusedLoraSeries,
  extendUnusedLoraSeriesSteps,
  invalidateLoraIndexCache,
  previewRenameLora,
  refreshLoraIndexIfStale,
  renameLoraModel,
  searchConfiguredLoras,
} from './loraService.js';
import {
  invalidateCheckpointIndexCache,
} from './checkpointService.js';
import { searchLibrary } from './globalSearchService.js';
import { setMainActivityJob } from './mainActivity.js';
import { prioritizeActiveLibraryPreviews } from './modelFilesService.js';
import type {
  GlobalSearchScopesDto,
  LibraryCreateRequestDto,
  LibraryListDto,
  LibraryPathMigrationRequestDto,
  LibrarySwitchResultDto,
  LibraryUpdateRequestDto,
} from '../shared/contracts.js';
import {
  cancelCatalogSync,
  getCatalogSlice,
  enrichBrowseEarlyAccess,
  getCivitaiModelCard,
  listCivitaiModelDownloadOptions,
  refreshCivitaiModelVersionInstalls,
  listArchivedCivitaiCards,
  listMaybeCivitaiCards,
  listCivitaiWatchlistDtos,
  listInstalledCivitaiCards,
  listCivitaiShelfSummaries,
  markCivitaiModelInstalled,
  markCivitaiVersionInstalled,
  markCivitaiVersionsInstalled,
  refreshCivitaiWatchlist,
  searchCivitaiModelCards,
  syncCatalogSlice,
  unmarkCivitaiModelInstalled,
} from './civitaiService.js';
import {
  cancelModelDownload,
  enqueueModelDownload,
  listModelDownloadQueue,
  moveModelDownloadInQueue,
  prepareModelDownloadQueueLibrarySwitch,
  reorderModelDownloadQueue,
  restorePersistedModelDownloadQueue,
  resumeModelDownloadQueue,
  pauseModelDownloadQueue,
  hasPendingModelDownloads,
  updateQueuedModelDownload,
} from './civitaiModelDownloadQueue.js';
import { checkCivitaiDownloadDestination } from './civitaiDownload.js';
import {
  clearDownloadLog,
  listDownloadLog,
} from './downloadLog.js';
import { enterBackgroundDownloads } from './backgroundDownloads.js';
import {
  checkForAppUpdate,
  fetchAppReleaseNotes,
  installAppUpdate,
  pickUpdateReleaseFolder,
} from './appUpdateService.js';
import {
  getCustomCivitaiPreview,
  refreshCivitaiPreview,
  saveCustomCivitaiPreviewFromClipboard,
} from './civitaiPreviewCache.js';
import {
  startCivitaiPreviewWarm,
  prioritizePreviewUrls,
  getPreviewDownloadStrip,
  requestCachedPreview,
  resetPreviewQueuesForLibrarySwitch,
  syncPreviewQueueWithEnabledCategories,
} from './civitaiPreviewWarm.js';
import { randomUUID } from 'node:crypto';
import type { GenerationStartRequestDto } from '../shared/contracts.js';
import {
  createGenFile,
  createPromptSubfolder,
  deletePromptFolder,
  listPromptTree,
  listSampleImages,
  loadGenPrompts,
  readGenFile,
  renamePromptFolder,
  writeGenFile,
} from './promptsService.js';
import {
  validateAllGenPrompts,
  validateGenPromptText,
  validateOneGenPrompt,
} from './genPromptValidationService.js';
import {
  cancelPromptCoverage,
  getPromptCoverageProgress,
  getPromptCoverageReport,
  patchPromptCoverageIgnore,
  refreshPromptCoverageNeverUsedReport,
  revealPromptCoverageReport,
  startPromptCoverage,
} from './promptCoverageService.js';
import { ComfyAdapter } from './comfy/adapter.js';
import {
  getComfyConnection,
  readComfyApiKey,
  setComfyConnection,
} from './comfy/comfySettings.js';
import { resolveContract } from './comfy/contract.js';
import { isWorkflowGraph } from './comfy/workflowGraph.js';
import {
  loadWorkflowProfile,
  saveWorkflowProfile,
} from './comfy/workflowStore.js';
import {
  cancelGeneration,
  clearLastGenerationPreviewProgress,
  startGeneration,
} from './comfy/generationQueue.js';
import {
  getCheckpointBenchmarkResults,
  getCheckpointBenchmarkStatus,
} from './comfy/checkpointBenchmarkService.js';
import {
  deleteLastGenerationOutput,
  lastGenerationOutputAbsolutePath,
  lastGenerationOutputBasename,
  loadGenerationForm,
  loadGenerationFormWithPreview,
  saveGenerationForm,
  setGenerationFormLibraryResolver,
} from './comfy/generationFormStore.js';
import {
  assistWildcardWithLmStudio,
  listLmStudioModels,
  testLmStudioConnection,
} from './lmStudio/lmStudioClient.js';
import {
  deleteLmStudioSavedPrompt,
  getLmStudioPromptLibrary,
  renameLmStudioSavedPrompt,
  setLmStudioPromptSession,
  upsertLmStudioSavedPrompt,
} from './lmStudio/lmStudioPromptLibrary.js';
import {
  getLmStudioConnection,
  setLmStudioConnection,
} from './lmStudio/lmStudioSettings.js';
import {
  listManagedLoras,
  listManagedCheckpoints,
  getLoraManagerDetail,
  getDefinedLoraReference,
  getCheckpointManagerDetail,
  readModelSidecarImageDataUrl,
  setManualCivitaiLink,
  clearManualCivitaiLink,
  setModelRating,
  setCheckpointEnabled,
  resolveCheckpointMasterImages,
  readMastersImageDataUrl,
  deleteCheckpoints,
  deleteLoras,
  isManagedModelPath,
} from './modelFilesService.js';
import { inspectLoraFile } from './safetensorsInspect.js';
import { startModelCatalogPopulate, rematchLocalModelByHash } from './modelCatalogPopulate.js';
import { startCatalogVersionHashEnrich } from './civitaiCatalogVersionHashEnrich.js';
import {
  createDownloadCategory,
  listDownloadCategories,
} from './civitaiCategoryService.js';
import {
  createLoraDownloadCategory,
  deleteLoraDownloadCategory,
  listLoraDownloadCategories,
  updateLoraDownloadCategory,
} from './loraDownloadCategoryService.js';
import { civitaiModelPageUrl } from '../domain/civitaiSnippet.js';
import { huggingfaceModelPageUrl } from '../domain/huggingfaceSearch.js';
import {
  getHuggingFaceModelDetail,
  searchHuggingFaceModels,
} from './huggingfaceClient.js';
import { searchCivitaiImages, searchCivitaiVideos } from './civitaiClient.js';
import {
  downloadCivitaiImage,
  listDownloadedCivitaiImageIds,
  listDownloadedCivitaiImages,
  migrateDownloadedCivitaiImagesRegistry,
  openDownloadedCivitaiImage,
} from './civitaiImageDownload.js';
import {
  getCivitaiImageDownloadAllStatus,
  startCivitaiImageDownloadAll,
  stopCivitaiImageDownloadAll,
} from './civitaiImageDownloadAll.js';
import {
  commitBrowseCatchUp,
  evaluateBrowseCatchUpPage,
  noteBrowseResumeCursor,
} from './civitaiBrowseCatchUp.js';
import {
  downloadCivitaiVideo,
  listDownloadedCivitaiVideoIds,
  listDownloadedCivitaiVideos,
  migrateDownloadedCivitaiVideosRegistry,
  openDownloadedCivitaiVideo,
} from './civitaiVideoDownload.js';
import {
  getCivitaiVideoDownloadAllStatus,
  startCivitaiVideoDownloadAll,
  stopCivitaiVideoDownloadAll,
} from './civitaiVideoDownloadAll.js';
import { resolveHfDownloadDestination } from './huggingfaceDownload.js';
import {
  cancelHfDownloadJob,
  enqueueHfDownload,
  listHfDownloadQueue,
  pauseHfDownloadQueue,
  restoreHfDownloadQueue,
  resumeHfDownloadQueue,
} from './huggingfaceDownloadQueue.js';
import {
  closeHuggingFaceBrowserWindow,
  openHuggingFaceBrowser,
} from './huggingfaceWindow.js';
import { relativeFolderUnderRoot } from '../domain/civitaiCategory.js';
import {
  attachCivitaiBrowser,
  closeCivitaiBrowserWindow,
  detachCivitaiBrowser,
  focusModelInCivitaiBrowser,
  openCivitaiBrowser,
  revealLocalFileInMainApp,
} from './civitaiWindow.js';
import {
  absorb,
  applyCycleFix,
  cleanupMissingReference,
  consolidate,
  convertToChild,
  createDescendant,
  createFile,
  previewAbsorb,
  previewConsolidation,
  previewConvertToChild,
  previewCycleFix,
  previewRename,
  referenceStats,
  removeFile,
  renameFile,
  saveFile,
} from './refactorService.js';
import { expandPreview } from './expandService.js';
import {
  getPromptSubstitutions,
  setPromptSubstitutions,
} from './promptSubstitutions.js';
import { exportSimulatedLines, runSimulation } from './simulateService.js';
import {
  historyState,
  redo,
  resetHistory,
  undo,
} from './mutationService.js';
import { folderWatcher } from './watcher.js';

const ARCHITECTURE_VALUES = [
  'sd15',
  'sd2',
  'sd3',
  'sdxl',
  'flux',
  'krea',
  'pixart',
  'wan',
  'other',
] as const;

const CATEGORY_VALUES = [
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
] as const;

const SDXL_FAMILY_VALUES = [
  'all',
  'sdxl',
  'pony',
  'illustrious',
  'noobai',
] as const;

function parseArchitectures(
  raw: unknown,
): (typeof ARCHITECTURE_VALUES)[number][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter(
    (value): value is (typeof ARCHITECTURE_VALUES)[number] =>
      typeof value === 'string' &&
      (ARCHITECTURE_VALUES as readonly string[]).includes(value),
  );
}

function parseCategory(
  raw: unknown,
): (typeof CATEGORY_VALUES)[number] | null {
  return typeof raw === 'string' &&
    (CATEGORY_VALUES as readonly string[]).includes(raw)
    ? (raw as (typeof CATEGORY_VALUES)[number])
    : null;
}

function parseSdxlFamily(
  raw: unknown,
): (typeof SDXL_FAMILY_VALUES)[number] | undefined {
  return typeof raw === 'string' &&
    (SDXL_FAMILY_VALUES as readonly string[]).includes(raw)
    ? (raw as (typeof SDXL_FAMILY_VALUES)[number])
    : undefined;
}

function parseCatalogBrowseParams(p: Record<string, unknown>) {
  const type = p.type === 'Checkpoint' ? 'Checkpoint' : 'LORA';
  const sort: 'newest' | 'name' | 'creator' =
    p.sort === 'name' || p.sort === 'creator' || p.sort === 'newest'
      ? p.sort
      : 'newest';
  const offset =
    typeof p.offset === 'number' && Number.isFinite(p.offset)
      ? Math.max(0, Math.floor(p.offset))
      : undefined;
  const limit =
    typeof p.limit === 'number' && Number.isFinite(p.limit)
      ? Math.max(1, Math.floor(p.limit))
      : undefined;
  return {
    type: type as 'LORA' | 'Checkpoint',
    query: typeof p.query === 'string' ? p.query : undefined,
    sort,
    includeArchived: p.includeArchived === true,
    includeMaybe: p.includeMaybe === true,
    hideInstalled: p.hideInstalled === true,
    onlyPotentialDuplicate: p.onlyPotentialDuplicate === true,
    onlyNew: p.onlyNew === true,
    includeWatching: p.includeWatching === true,
    architectures: parseArchitectures(p.architectures),
    sdxlFamily: parseSdxlFamily(p.sdxlFamily),
    category: parseCategory(p.category),
    offset,
    limit,
  };
}

export function registerIpc(): void {
  setGenerationFormLibraryResolver(() => {
    const libs = listLibraryConfigs();
    let activeId = libs[0]?.id ?? 'local';
    try {
      activeId = getActiveLibraryId();
    } catch {
      // Keep the first library when settings are not ready.
    }
    const allIds = libs.map((lib) => lib.id);
    if (!allIds.includes(activeId)) allIds.push(activeId);
    return { activeId, allIds };
  });
  ipcMain.handle(IPC.libraryPickRoot, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select wildcard library folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(IPC.libraryOpenRoot, async (_e, root: unknown) => {
    if (typeof root !== 'string' || !root.trim()) {
      throw new Error('Invalid library root');
    }
    const snapshot = libraryService.openRoot(root.trim());
    resetHistory();
    folderWatcher.start(snapshot.root);
    try {
      prioritizeActiveLibraryPreviews();
    } catch {
      // ignore
    }
    return snapshot;
  });

  function librariesListDto(): LibraryListDto {
    const libraries = listLibraryConfigs().map(toLibraryConfigDto);
    return {
      libraries,
      activeLibraryId: getActiveLibraryId(),
    };
  }

  function applyActiveLibrarySwitch(): LibrarySwitchResultDto {
    const lib = getActiveLibrary();
    invalidateLoraIndexCache();
    invalidateCheckpointIndexCache();
    try {
      bindActiveLibraryDataRoots();
    } catch {
      // ignore
    }
    let snapshot = null;
    if (lib.wildcardsRoot) {
      try {
        snapshot = libraryService.openRoot(lib.wildcardsRoot);
        resetHistory();
        folderWatcher.start(snapshot.root);
      } catch {
        snapshot = null;
        libraryService.closeRoot();
        folderWatcher.stop();
        resetHistory();
      }
    } else {
      libraryService.closeRoot();
      folderWatcher.stop();
      resetHistory();
    }
    // Only warm covers for this library’s models — drop other libraries’ backlog.
    try {
      resetPreviewQueuesForLibrarySwitch();
      prioritizeActiveLibraryPreviews();
    } catch {
      // Folders may be unset — ignore.
    }
    // Queue file is per-library; resume if this library left unfinished jobs.
    try {
      restorePersistedModelDownloadQueue();
    } catch {
      // ignore
    }
    return {
      library: toLibraryConfigDto(lib),
      snapshot,
    };
  }

  ipcMain.handle(IPC.libraryListLibraries, async () => librariesListDto());

  ipcMain.handle(IPC.libraryGetActive, async () =>
    toLibraryConfigDto(getActiveLibrary()),
  );

  ipcMain.handle(IPC.librarySetActive, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('Invalid library id');
    }
    // Save + park this library's download queue before folders change.
    try {
      prepareModelDownloadQueueLibrarySwitch();
    } catch {
      // ignore
    }
    setActiveLibraryId(id.trim());
    return applyActiveLibrarySwitch();
  });

  ipcMain.handle(IPC.libraryCreate, async (_e, input: unknown) => {
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid library create request');
    }
    const row = input as LibraryCreateRequestDto;
    if (typeof row.name !== 'string') throw new Error('Invalid library name');
    return toLibraryConfigDto(
      createLibraryConfig({
        name: row.name,
        wildcardsRoot: row.wildcardsRoot,
        loraFolder: row.loraFolder,
        checkpointFolder: row.checkpointFolder,
        imagesFolder: row.imagesFolder,
        videosFolder: row.videosFolder,
        mastersFolder: row.mastersFolder,
        trainingLibraryFolder: row.trainingLibraryFolder,
        promptsFolder: row.promptsFolder,
        generationOutputRealistic: row.generationOutputRealistic,
        generationOutputHentai: row.generationOutputHentai,
        generationOutput3d: row.generationOutput3d,
        benchmarkOutputFolder: row.benchmarkOutputFolder,
        enabledArchitectures: row.enabledArchitectures,
        enabledSdxlFamilies: row.enabledSdxlFamilies,
        enabledCivitaiCategories: row.enabledCivitaiCategories,
        validationPlatform: row.validationPlatform,
        generationFamily: row.generationFamily,
        civitaiOrigin: row.civitaiOrigin,
      }),
    );
  });

  ipcMain.handle(
    IPC.libraryUpdate,
    async (_e, id: unknown, patch: unknown) => {
      if (typeof id !== 'string' || !id.trim()) {
        throw new Error('Invalid library id');
      }
      if (!patch || typeof patch !== 'object') {
        throw new Error('Invalid library update');
      }
      const row = patch as LibraryUpdateRequestDto;
      const before = getActiveLibrary();
      const update: Parameters<typeof updateLibraryConfig>[1] = {};
      if (typeof row.name === 'string') update.name = row.name;
      if ('wildcardsRoot' in row) update.wildcardsRoot = row.wildcardsRoot ?? null;
      if ('loraFolder' in row) update.loraFolder = row.loraFolder ?? null;
      if ('checkpointFolder' in row) {
        update.checkpointFolder = row.checkpointFolder ?? null;
      }
      if ('imagesFolder' in row) {
        update.imagesFolder = row.imagesFolder ?? null;
      }
      if ('videosFolder' in row) {
        update.videosFolder = row.videosFolder ?? null;
      }
      if ('mastersFolder' in row) {
        update.mastersFolder = row.mastersFolder ?? null;
      }
      if ('trainingLibraryFolder' in row) {
        update.trainingLibraryFolder = row.trainingLibraryFolder ?? null;
      }
      if ('promptsFolder' in row) {
        update.promptsFolder = row.promptsFolder ?? null;
      }
      if ('generationOutputRealistic' in row) {
        update.generationOutputRealistic =
          row.generationOutputRealistic ?? null;
      }
      if ('generationOutputHentai' in row) {
        update.generationOutputHentai = row.generationOutputHentai ?? null;
      }
      if ('generationOutput3d' in row) {
        update.generationOutput3d = row.generationOutput3d ?? null;
      }
      if ('benchmarkOutputFolder' in row) {
        update.benchmarkOutputFolder = row.benchmarkOutputFolder ?? null;
      }
      if (row.enabledArchitectures !== undefined) {
        update.enabledArchitectures = row.enabledArchitectures;
      }
      if (row.enabledSdxlFamilies !== undefined) {
        update.enabledSdxlFamilies = row.enabledSdxlFamilies;
      }
      if (row.enabledCivitaiCategories !== undefined) {
        update.enabledCivitaiCategories = row.enabledCivitaiCategories;
      }
      if (
        row.validationPlatform === 'comfyui' ||
        row.validationPlatform === 'stable-diffusion'
      ) {
        update.validationPlatform = row.validationPlatform;
      }
      if (row.generationFamily === 'krea2' || row.generationFamily === 'sdxl') {
        update.generationFamily = row.generationFamily;
      }
      if (
        row.civitaiOrigin === 'https://civitai.com' ||
        row.civitaiOrigin === 'https://civitai.red'
      ) {
        update.civitaiOrigin = row.civitaiOrigin;
      }
      const updated = updateLibraryConfig(id.trim(), update);
      if (updated.id === before.id) {
        if (updated.loraFolder !== before.loraFolder) {
          invalidateLoraIndexCache();
        }
        if (updated.checkpointFolder !== before.checkpointFolder) {
          invalidateCheckpointIndexCache();
        }
      }
      return toLibraryConfigDto(updated);
    },
  );

  ipcMain.handle(IPC.libraryDelete, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('Invalid library id');
    }
    const before = getActiveLibraryId();
    const result = deleteLibraryConfig(id.trim());
    if (result.activeLibraryId !== before) {
      applyActiveLibrarySwitch();
    }
    return {
      libraries: result.libraries.map(toLibraryConfigDto),
      activeLibraryId: result.activeLibraryId,
    };
  });

  ipcMain.handle(IPC.libraryPickWildcardsFolder, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const current = getActiveLibrary().wildcardsRoot;
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select wildcards folder',
      properties: ['openDirectory'],
      defaultPath: current || undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    IPC.librarySuggestPathMigrationPrefix,
    async (_e, libraryId: unknown) => {
      if (typeof libraryId !== 'string' || !libraryId.trim()) {
        throw new Error('Invalid library id');
      }
      return suggestLibraryPathMigrationPrefix(libraryId.trim());
    },
  );

  ipcMain.handle(IPC.libraryPickPathMigrationPrefix, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select path prefix folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    IPC.libraryPlanPathMigration,
    async (_e, request: unknown) => {
      if (!request || typeof request !== 'object') {
        throw new Error('Invalid path migration request');
      }
      const row = request as LibraryPathMigrationRequestDto;
      if (typeof row.libraryId !== 'string' || !row.libraryId.trim()) {
        throw new Error('Invalid library id');
      }
      if (typeof row.oldPrefix !== 'string' || typeof row.newPrefix !== 'string') {
        throw new Error('Old and new path prefixes are required');
      }
      return planLibraryPathMigrationForLibrary({
        libraryId: row.libraryId.trim(),
        oldPrefix: row.oldPrefix,
        newPrefix: row.newPrefix,
        folderOverrides: row.folderOverrides,
      });
    },
  );

  ipcMain.handle(
    IPC.libraryApplyPathMigration,
    async (_e, request: unknown) => {
      if (!request || typeof request !== 'object') {
        throw new Error('Invalid path migration request');
      }
      const row = request as LibraryPathMigrationRequestDto;
      if (typeof row.libraryId !== 'string' || !row.libraryId.trim()) {
        throw new Error('Invalid library id');
      }
      if (typeof row.oldPrefix !== 'string' || typeof row.newPrefix !== 'string') {
        throw new Error('Old and new path prefixes are required');
      }
      return applyLibraryPathMigration({
        libraryId: row.libraryId.trim(),
        oldPrefix: row.oldPrefix,
        newPrefix: row.newPrefix,
        folderOverrides: row.folderOverrides,
      });
    },
  );

  ipcMain.handle(IPC.libraryListFiles, async () => libraryService.listFiles());

  ipcMain.handle(IPC.libraryListWildcardKeys, async () => {
    const index = buildLibraryIndex(libraryService.loadAllFiles());
    return [
      ...new Set([
        ...index.files
          .filter((file) => file.ext === '.txt')
          .map((file) => file.key),
        ...[...index.structuredByKey.values()]
          .filter((entry) => entry.values.length > 0)
          .map((entry) => entry.key),
      ]),
    ].sort((a, b) => a.localeCompare(b));
  });

  ipcMain.handle(IPC.libraryGetRecent, async () => loadSettings().recentRoots);

  ipcMain.handle(IPC.libraryGetStartup, async () => {
    const settings = loadSettings();
    return {
      lastRoot: settings.lastRoot ?? settings.recentRoots[0] ?? null,
      lastRootFile: settings.lastRootFile ?? null,
    };
  });

  ipcMain.handle(IPC.librarySetLastFile, async (_e, relativePath: unknown) => {
    if (typeof relativePath !== 'string') throw new Error('Invalid path');
    setLastFile(relativePath);
  });

  ipcMain.handle(IPC.libraryClearLastFile, async () => {
    clearLastFile();
  });

  ipcMain.handle(IPC.libraryReadFile, async (_e, relativePath: unknown) => {
    if (typeof relativePath !== 'string') throw new Error('Invalid path');
    return libraryService.readFile(relativePath);
  });

  ipcMain.handle(
    IPC.libraryOpenFileExternal,
    async (_e, relativePath: unknown) => {
      if (typeof relativePath !== 'string') throw new Error('Invalid path');
      const file = libraryService.readFile(relativePath);
      const error = await shell.openPath(file.absolutePath);
      if (error) throw new Error(`Could not open file: ${error}`);
    },
  );

  ipcMain.handle(
    IPC.libraryWriteFile,
    async (
      _e,
      relativePath: unknown,
      text: unknown,
      editSessionId: unknown,
      basedOn: unknown,
    ) => {
      if (typeof relativePath !== 'string') throw new Error('Invalid path');
      if (typeof text !== 'string') throw new Error('Invalid file contents');
      if (editSessionId !== undefined && typeof editSessionId !== 'string') {
        throw new Error('Invalid edit session');
      }
      if (basedOn !== undefined && typeof basedOn !== 'string') {
        throw new Error('Invalid basedOn');
      }
      folderWatcher.suppressChanges();
      const { writtenText } = saveFile(
        relativePath,
        text,
        editSessionId,
        basedOn !== undefined ? { basedOn } : undefined,
      );
      return { ...historyState(), writtenText };
    },
  );

  ipcMain.on(
    IPC.libraryFlushFile,
    (
      event,
      relativePath: unknown,
      text: unknown,
      editSessionId: unknown,
      basedOn: unknown,
    ) => {
      try {
        if (typeof relativePath !== 'string') throw new Error('Invalid path');
        if (typeof text !== 'string') throw new Error('Invalid file contents');
        if (editSessionId !== undefined && typeof editSessionId !== 'string') {
          throw new Error('Invalid edit session');
        }
        if (basedOn !== undefined && typeof basedOn !== 'string') {
          throw new Error('Invalid basedOn');
        }
        folderWatcher.suppressChanges();
        const { writtenText } = saveFile(
          relativePath,
          text,
          editSessionId,
          basedOn !== undefined ? { basedOn } : undefined,
        );
        event.returnValue = { ...historyState(), writtenText };
      } catch (error) {
        // sendSync must always receive a serializable response.
        event.returnValue = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(IPC.libraryRefStats, async () => referenceStats());

  ipcMain.handle(IPC.uiGetSettings, async () => {
    const settings = loadSettings();
    const libraries = listLibraryConfigs();
    const panelWidthsByTab = resolvePanelWidthsByTab(settings);
    return {
      detailsPanelWidth: panelWidthsByTab.wildcards.detailsPanelWidth,
      filesPanelWidth: panelWidthsByTab.wildcards.filesPanelWidth,
      panelWidthsByTab,
      promptsSamplesCollapsed:
        typeof settings.promptsSamplesCollapsed === 'boolean'
          ? settings.promptsSamplesCollapsed
          : null,
      generationPreviewCollapsed:
        typeof settings.generationPreviewCollapsed === 'boolean'
          ? settings.generationPreviewCollapsed
          : null,
      generationAdditionalPositiveHeight:
        settings.generationAdditionalPositiveHeight ?? null,
      generationNegativePromptHeight:
        settings.generationNegativePromptHeight ?? null,
      promptCoverageWindow: settings.promptCoverageWindow ?? null,
      promptSubstitutionsWindow: settings.promptSubstitutionsWindow ?? null,
      benchmarkResultsWindow: settings.benchmarkResultsWindow ?? null,
      benchmarkResultsView: getBenchmarkResultsView(),
      simulationIterations: settings.simulationIterations ?? 10_000,
      simulationSeed: settings.simulationSeed ?? 1,
      graphLayoutStyle: settings.graphLayoutStyle ?? 'optimized',
      workspaceListFilters: getWorkspaceListFilters(),
      loraFolder: settings.loraFolder ?? null,
      checkpointFolder: settings.checkpointFolder ?? null,
      imagesFolder: getActiveLibrary().imagesFolder ?? null,
      videosFolder: getActiveLibrary().videosFolder ?? null,
      mastersFolder: getActiveLibrary().mastersFolder ?? null,
      trainingLibraryFolder: getActiveLibrary().trainingLibraryFolder ?? null,
      promptsFolder: settings.promptsFolder ?? null,
      convertChildSuffix: getConvertChildSuffix(),
      civitaiOrigin: getCivitaiOrigin(),
      hasCivitaiApiKey: Boolean(getCivitaiApiKey()),
      activeLibraryId: getActiveLibraryId(),
      libraries: libraries.map((lib) => ({ id: lib.id, name: lib.name })),
      disableHardwareAcceleration: getDisableHardwareAcceleration(),
      generationSaveInNewSubfolder: getGenerationSaveInNewSubfolder(),
      updateReleaseFolder: getUpdateReleaseFolder(),
      appVersion: app.getVersion(),
    };
  });

  ipcMain.handle(
    IPC.uiSetDetailsPanelWidth,
    async (_e, tab: unknown, width: unknown) => {
      if (
        typeof tab !== 'string' ||
        !(WORKSPACE_TAB_IDS as readonly string[]).includes(tab)
      ) {
        throw new Error('Invalid workspace tab');
      }
      if (typeof width !== 'number' || !Number.isFinite(width)) {
        throw new Error('Invalid details panel width');
      }
      setDetailsPanelWidth(tab as WorkspaceTabId, width);
    },
  );

  ipcMain.handle(
    IPC.uiSetFilesPanelWidth,
    async (_e, tab: unknown, width: unknown) => {
      if (
        typeof tab !== 'string' ||
        !(WORKSPACE_TAB_IDS as readonly string[]).includes(tab)
      ) {
        throw new Error('Invalid workspace tab');
      }
      if (typeof width !== 'number' || !Number.isFinite(width)) {
        throw new Error('Invalid files panel width');
      }
      setFilesPanelWidth(tab as WorkspaceTabId, width);
    },
  );

  ipcMain.handle(
    IPC.uiSetPromptsSamplesCollapsed,
    async (_e, collapsed: unknown) => {
      if (typeof collapsed !== 'boolean') {
        throw new Error('Invalid prompts samples collapsed flag');
      }
      setPromptsSamplesCollapsed(collapsed);
    },
  );

  ipcMain.handle(
    IPC.uiSetGenerationPreviewCollapsed,
    async (_e, collapsed: unknown) => {
      if (typeof collapsed !== 'boolean') {
        throw new Error('Invalid generation preview collapsed flag');
      }
      setGenerationPreviewCollapsed(collapsed);
    },
  );

  ipcMain.handle(
    IPC.uiSetGenerationPromptBoxHeights,
    async (_e, patch: unknown) => {
      if (!patch || typeof patch !== 'object') {
        throw new Error('Invalid prompt box height');
      }
      const rec = patch as Record<string, unknown>;
      const additionalPositive =
        typeof rec.additionalPositive === 'number' ? rec.additionalPositive : undefined;
      const negative = typeof rec.negative === 'number' ? rec.negative : undefined;
      if (additionalPositive === undefined && negative === undefined) {
        throw new Error('Invalid prompt box height');
      }
      setGenerationPromptBoxHeights({ additionalPositive, negative });
    },
  );

  ipcMain.handle(
    IPC.uiSetPromptCoverageWindow,
    async (_e, state: unknown) => {
      if (!state || typeof state !== 'object') {
        throw new Error('Invalid coverage window state');
      }
      const rec = state as Record<string, unknown>;
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        if (typeof rec[key] !== 'number' || !Number.isFinite(rec[key])) {
          throw new Error('Invalid coverage window state');
        }
      }
      return setPromptCoverageWindow({
        x: rec.x as number,
        y: rec.y as number,
        width: rec.width as number,
        height: rec.height as number,
        maximized: rec.maximized === true,
      });
    },
  );

  ipcMain.handle(
    IPC.uiSetPromptSubstitutionsWindow,
    async (_e, state: unknown) => {
      if (!state || typeof state !== 'object') {
        throw new Error('Invalid prompt substitutions window state');
      }
      const rec = state as Record<string, unknown>;
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        if (typeof rec[key] !== 'number' || !Number.isFinite(rec[key])) {
          throw new Error('Invalid prompt substitutions window state');
        }
      }
      return setPromptSubstitutionsWindow({
        x: rec.x as number,
        y: rec.y as number,
        width: rec.width as number,
        height: rec.height as number,
        maximized: rec.maximized === true,
      });
    },
  );

  ipcMain.handle(
    IPC.uiSetBenchmarkResultsWindow,
    async (_e, state: unknown) => {
      if (!state || typeof state !== 'object') {
        throw new Error('Invalid benchmark results window state');
      }
      const rec = state as Record<string, unknown>;
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        if (typeof rec[key] !== 'number' || !Number.isFinite(rec[key])) {
          throw new Error('Invalid benchmark results window state');
        }
      }
      return setBenchmarkResultsWindow({
        x: rec.x as number,
        y: rec.y as number,
        width: rec.width as number,
        height: rec.height as number,
        maximized: rec.maximized === true,
      });
    },
  );

  ipcMain.handle(IPC.uiSetBenchmarkResultsView, async (_e, view: unknown) =>
    setBenchmarkResultsView(view),
  );

  ipcMain.handle(
    IPC.uiSetSimulationSettings,
    async (_e, iterations: unknown, seed: unknown) => {
      if (
        typeof iterations !== 'number' ||
        !Number.isFinite(iterations) ||
        typeof seed !== 'number' ||
        !Number.isFinite(seed)
      ) {
        throw new Error('Invalid simulation settings');
      }
      setSimulationSettings(iterations, seed);
    },
  );

  ipcMain.handle(IPC.uiSetGraphLayoutStyle, async (_e, style: unknown) => {
    if (
      style !== 'default' &&
      style !== 'optimized' &&
      style !== 'compact'
    ) {
      throw new Error('Invalid graph layout style');
    }
    setGraphLayoutStyle(style);
  });

  ipcMain.handle(
    IPC.uiSetWorkspaceListFilter,
    async (_e, tab: unknown, filter: unknown) => {
      if (!isWorkspaceListFilterTab(tab)) {
        throw new Error('Invalid workspace list filter tab');
      }
      setWorkspaceListFilter(tab, filter);
    },
  );

  ipcMain.handle(IPC.uiSetConvertChildSuffix, async (_e, suffix: unknown) => {
    if (typeof suffix !== 'string') {
      throw new Error('Invalid convert-child suffix');
    }
    return setConvertChildSuffix(suffix);
  });

  ipcMain.handle(IPC.uiOpenSettingsFolder, async () => {
    const directory = app.getPath('userData');
    fs.mkdirSync(directory, { recursive: true });
    try {
      await openFolderInMyFileExplorer(directory);
    } catch (error) {
      throw new Error(
        `Could not open settings folder: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  ipcMain.handle(IPC.uiGetUpdateReleaseFolder, async () =>
    getUpdateReleaseFolder(),
  );

  ipcMain.handle(IPC.uiPickUpdateReleaseFolder, async () =>
    pickUpdateReleaseFolder(),
  );

  ipcMain.handle(IPC.uiSetUpdateReleaseFolder, async (_e, folder: unknown) => {
    if (folder !== null && typeof folder !== 'string') {
      throw new Error('Invalid update release folder');
    }
    return setUpdateReleaseFolder(folder);
  });

  ipcMain.handle(IPC.uiClearUpdateReleaseFolder, async () => {
    setUpdateReleaseFolder(null);
  });

  ipcMain.handle(IPC.uiCheckForAppUpdate, async () => checkForAppUpdate());

  ipcMain.handle(IPC.uiInstallAppUpdate, async () => installAppUpdate());

  ipcMain.handle(IPC.uiGetAppReleaseNotes, async (_e, version: unknown) => {
    if (typeof version !== 'string' || !version.trim()) {
      throw new Error('Missing release version');
    }
    return fetchAppReleaseNotes(version.trim());
  });

  ipcMain.handle(IPC.uiGetPromptSubstitutions, async () =>
    getPromptSubstitutions(),
  );

  ipcMain.handle(IPC.uiSetPromptSubstitutions, async (_e, rules: unknown) => {
    if (!Array.isArray(rules)) {
      throw new Error('Invalid prompt substitutions');
    }
    return setPromptSubstitutions(rules);
  });

  ipcMain.handle(IPC.uiGetLoraFolder, async () => loadSettings().loraFolder ?? null);

  ipcMain.handle(IPC.uiPickLoraFolder, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const current = loadSettings().loraFolder;
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select LoRA models folder',
      properties: ['openDirectory'],
      defaultPath: current || undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folder = result.filePaths[0] ?? null;
    if (!folder) return null;
    invalidateLoraIndexCache();
    return setLoraFolder(folder);
  });

  ipcMain.handle(IPC.uiSetLoraFolder, async (_e, folder: unknown) => {
    if (folder !== null && typeof folder !== 'string') {
      throw new Error('Invalid LoRA folder');
    }
    invalidateLoraIndexCache();
    return setLoraFolder(folder);
  });

  ipcMain.handle(IPC.uiClearLoraFolder, async () => {
    invalidateLoraIndexCache();
    setLoraFolder(null);
  });

  ipcMain.handle(IPC.uiIgnoreUnusedLora, async (_e, relativePath: unknown) => {
    if (typeof relativePath === 'string') {
      ignoreUnusedLora(relativePath);
      return;
    }
    if (
      Array.isArray(relativePath) &&
      relativePath.every((item) => typeof item === 'string')
    ) {
      ignoreUnusedLoras(relativePath as string[]);
      return;
    }
    throw new Error('Invalid LoRA path');
  });

  ipcMain.handle(IPC.uiCategorizeUnusedLora, async (_e, opts: unknown) => {
    if (!opts || typeof opts !== 'object') {
      throw new Error('Invalid categorize request');
    }
    const row = opts as Record<string, unknown>;
    if (
      !Array.isArray(row.relativePaths) ||
      !row.relativePaths.every((item) => typeof item === 'string')
    ) {
      throw new Error('Invalid LoRA paths');
    }
    if (typeof row.loraCategoryId !== 'string' || !row.loraCategoryId.trim()) {
      throw new Error('Invalid LoRA category');
    }
    return categorizeUnusedLoraSeries({
      relativePaths: row.relativePaths as string[],
      loraCategoryId: row.loraCategoryId.trim(),
      extraComment:
        typeof row.extraComment === 'string' ? row.extraComment : undefined,
      extraPrompt:
        typeof row.extraPrompt === 'string' ? row.extraPrompt : undefined,
    });
  });

  ipcMain.handle(IPC.uiExtendUnusedLoraSeries, async (_e, relativePaths: unknown) => {
    if (
      !Array.isArray(relativePaths) ||
      !relativePaths.every((item) => typeof item === 'string')
    ) {
      throw new Error('Invalid LoRA paths');
    }
    return extendUnusedLoraSeriesSteps(relativePaths as string[]);
  });

  ipcMain.handle(IPC.uiSearchLoras, async (_e, query: unknown) => {
    if (typeof query !== 'string') throw new Error('Invalid LoRA search query');
    return searchConfiguredLoras(query);
  });

  ipcMain.handle(
    IPC.uiSearchLibrary,
    async (_e, query: unknown, scopes: unknown) => {
      if (typeof query !== 'string') {
        throw new Error('Invalid search query');
      }
      if (!scopes || typeof scopes !== 'object') {
        throw new Error('Invalid search scopes');
      }
      const raw = scopes as Record<string, unknown>;
      const parsed: GlobalSearchScopesDto = {
        wildcards: Boolean(raw.wildcards),
        prompts: Boolean(raw.prompts),
        loras: Boolean(raw.loras),
        checkpoints: Boolean(raw.checkpoints),
      };
      return searchLibrary(query, parsed);
    },
  );

  ipcMain.handle(IPC.modelFilesListLoras, async (_e, opts: unknown) => {
    const force =
      Boolean(opts) &&
      typeof opts === 'object' &&
      (opts as { force?: unknown }).force === true;
    return listManagedLoras({ force });
  });
  ipcMain.handle(
    IPC.modelFilesRefreshLoraIndexIfStale,
    async (_e, opts: unknown) => {
      const maxAgeMs =
        opts &&
        typeof opts === 'object' &&
        typeof (opts as { maxAgeMs?: unknown }).maxAgeMs === 'number' &&
        Number.isFinite((opts as { maxAgeMs: number }).maxAgeMs)
          ? Math.max(0, (opts as { maxAgeMs: number }).maxAgeMs)
          : undefined;
      return refreshLoraIndexIfStale(maxAgeMs);
    },
  );
  ipcMain.handle(IPC.modelFilesListCheckpoints, async (_e, opts: unknown) => {
    const force =
      Boolean(opts) &&
      typeof opts === 'object' &&
      (opts as { force?: unknown }).force === true;
    return listManagedCheckpoints({ force });
  });
  ipcMain.handle(IPC.modelFilesGetLoraDetail, async (_e, relativePath: unknown) => {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      throw new Error('Invalid LoRA path');
    }
    return getLoraManagerDetail(relativePath.trim());
  });
  ipcMain.handle(
    IPC.modelFilesGetDefinedLoraReference,
    async (_e, relativePath: unknown) => {
      if (typeof relativePath !== 'string' || !relativePath.trim()) {
        throw new Error('Invalid LoRA path');
      }
      return getDefinedLoraReference(relativePath.trim());
    },
  );
  ipcMain.handle(
    IPC.modelFilesResolveLoraSeriesDataset,
    async (_e, opts: unknown) => {
      if (!opts || typeof opts !== 'object') {
        throw new Error('Invalid series dataset request');
      }
      const row = opts as {
        dir?: unknown;
        seriesBase?: unknown;
        separator?: unknown;
        force?: unknown;
      };
      if (typeof row.seriesBase !== 'string' || !row.seriesBase.trim()) {
        throw new Error('Invalid series base');
      }
      if (row.separator !== '_' && row.separator !== '-') {
        throw new Error('Invalid series separator');
      }
      const { resolveLoraSeriesDatasetPreview } = await import(
        './loraTrainingDatasetService.js'
      );
      return resolveLoraSeriesDatasetPreview(
        {
          dir: typeof row.dir === 'string' ? row.dir : '',
          seriesBase: row.seriesBase.trim(),
          separator: row.separator,
        },
        { force: row.force === true },
      );
    },
  );
  ipcMain.handle(
    IPC.modelFilesReadTrainingLibraryImage,
    async (_e, absolutePath: unknown) => {
      if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
        throw new Error('Invalid image path');
      }
      const { readTrainingLibraryImageDataUrl } = await import(
        './loraTrainingDatasetService.js'
      );
      return readTrainingLibraryImageDataUrl(absolutePath.trim());
    },
  );
  ipcMain.handle(IPC.modelFilesInspectLora, async (_e, relativePath: unknown) => {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      throw new Error('Invalid LoRA path');
    }
    return inspectLoraFile(relativePath.trim());
  });
  ipcMain.handle(
    IPC.modelFilesGetCheckpointDetail,
    async (_e, relativePath: unknown) => {
      if (typeof relativePath !== 'string' || !relativePath.trim()) {
        throw new Error('Invalid checkpoint path');
      }
      return getCheckpointManagerDetail(relativePath.trim());
    },
  );
  ipcMain.handle(
    IPC.modelFilesReadSidecarImage,
    async (_e, absolutePath: unknown) => {
      if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
        throw new Error('Invalid image path');
      }
      return readModelSidecarImageDataUrl(absolutePath.trim());
    },
  );

  ipcMain.handle(IPC.modelFilesSetCivitaiLink, async (_e, opts: unknown) => {
    const o =
      opts && typeof opts === 'object'
        ? (opts as {
            absolutePath?: unknown;
            autoV2?: unknown;
            pageUrl?: unknown;
          })
        : {};
    if (typeof o.absolutePath !== 'string' || !o.absolutePath.trim()) {
      throw new Error('Invalid model path');
    }
    if (typeof o.pageUrl !== 'string' || !o.pageUrl.trim()) {
      throw new Error('Invalid Civitai URL');
    }
    const link = await setManualCivitaiLink({
      absolutePath: o.absolutePath.trim(),
      autoV2: typeof o.autoV2 === 'string' ? o.autoV2 : null,
      pageUrl: o.pageUrl.trim(),
    });
    return {
      civitaiModelId: link.modelId,
      civitaiName: link.name,
      civitaiPageUrl: link.pageUrl,
      previewUrl: link.previewUrl,
    };
  });

  ipcMain.handle(IPC.modelFilesClearCivitaiLink, async (_e, opts: unknown) => {
    const o =
      opts && typeof opts === 'object'
        ? (opts as { absolutePath?: unknown; autoV2?: unknown })
        : {};
    if (typeof o.absolutePath !== 'string' || !o.absolutePath.trim()) {
      throw new Error('Invalid model path');
    }
    clearManualCivitaiLink({
      absolutePath: o.absolutePath.trim(),
      autoV2: typeof o.autoV2 === 'string' ? o.autoV2 : null,
    });
  });

  ipcMain.handle(IPC.modelFilesSetRating, async (_e, opts: unknown) => {
    const o =
      opts && typeof opts === 'object'
        ? (opts as {
            absolutePath?: unknown;
            autoV2?: unknown;
            rating?: unknown;
          })
        : {};
    if (typeof o.absolutePath !== 'string' || !o.absolutePath.trim()) {
      throw new Error('Invalid model path');
    }
    if (typeof o.rating !== 'number' || !Number.isFinite(o.rating)) {
      throw new Error('Invalid rating');
    }
    return setModelRating({
      absolutePath: o.absolutePath.trim(),
      autoV2: typeof o.autoV2 === 'string' ? o.autoV2 : null,
      rating: o.rating,
    });
  });

  ipcMain.handle(IPC.modelFilesSetCheckpointEnabled, async (_e, opts: unknown) => {
    const o =
      opts && typeof opts === 'object'
        ? (opts as { absolutePath?: unknown; enabled?: unknown })
        : {};
    if (typeof o.absolutePath !== 'string' || !o.absolutePath.trim()) {
      throw new Error('Invalid model path');
    }
    if (typeof o.enabled !== 'boolean') {
      throw new Error('Invalid checkpoint enabled flag');
    }
    return setCheckpointEnabled({
      absolutePath: o.absolutePath.trim(),
      enabled: o.enabled,
    });
  });

  ipcMain.handle(IPC.modelFilesResolveMasterImages, async (_e, opts: unknown) => {
    const o =
      opts && typeof opts === 'object'
        ? (opts as {
            absolutePath?: unknown;
            stem?: unknown;
            autoV2?: unknown;
            force?: unknown;
          })
        : {};
    if (typeof o.absolutePath !== 'string' || !o.absolutePath.trim()) {
      throw new Error('Invalid model path');
    }
    if (typeof o.stem !== 'string' || !o.stem.trim()) {
      throw new Error('Invalid stem');
    }
    const stemRaw = o.stem.trim().replaceAll('\\', '/');
    const stem = stemRaw.includes('/')
      ? stemRaw.slice(stemRaw.lastIndexOf('/') + 1)
      : stemRaw;
    return resolveCheckpointMasterImages({
      checkpointAbsolutePath: o.absolutePath.trim(),
      stem,
      autoV2: typeof o.autoV2 === 'string' ? o.autoV2 : null,
      force: o.force === true,
    });
  });

  ipcMain.handle(
    IPC.modelFilesReadMasterImage,
    async (_e, absolutePath: unknown) => {
      if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
        throw new Error('Invalid image path');
      }
      return readMastersImageDataUrl(absolutePath.trim());
    },
  );

  ipcMain.handle(
    IPC.modelFilesDeleteCheckpoints,
    async (_e, relativePaths: unknown) => {
      if (!Array.isArray(relativePaths)) {
        throw new Error('Invalid checkpoint paths');
      }
      const paths = relativePaths.filter(
        (p): p is string => typeof p === 'string' && Boolean(p.trim()),
      );
      return deleteCheckpoints(paths);
    },
  );

  ipcMain.handle(
    IPC.modelFilesDeleteLoras,
    async (_e, relativePaths: unknown) => {
      if (!Array.isArray(relativePaths)) {
        throw new Error('Invalid LoRA paths');
      }
      const paths = relativePaths.filter(
        (p): p is string => typeof p === 'string' && Boolean(p.trim()),
      );
      return deleteLoras(paths);
    },
  );

  ipcMain.handle(
    IPC.modelFilesShowInFolder,
    async (_e, absolutePath: unknown) => {
      if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
        throw new Error('Invalid model path');
      }
      const resolved = path.resolve(absolutePath.trim());
      if (!isManagedModelPath(resolved)) {
        throw new Error('Path is outside the configured model folders');
      }
      if (!fs.existsSync(resolved)) {
        throw new Error('Model file no longer exists');
      }
      await revealInMyFileExplorer(resolved);
    },
  );

  ipcMain.handle(
    IPC.modelFilesOpenExternal,
    async (_e, absolutePath: unknown) => {
      if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
        throw new Error('Invalid model path');
      }
      const resolved = path.resolve(absolutePath.trim());
      if (!isManagedModelPath(resolved)) {
        throw new Error('Path is outside the configured model folders');
      }
      const error = await shell.openPath(resolved);
      if (error) throw new Error(`Could not open file: ${error}`);
    },
  );

  ipcMain.handle(IPC.modelFilesRematchByHash, async (_e, opts: unknown) => {
    const o =
      opts && typeof opts === 'object'
        ? (opts as {
            autoV2?: unknown;
            kind?: unknown;
            localStem?: unknown;
          })
        : {};
    if (typeof o.autoV2 !== 'string' || !o.autoV2.trim()) {
      throw new Error('Invalid AutoV2 hash');
    }
    const kind =
      o.kind === 'Checkpoint' ? 'Checkpoint' : o.kind === 'LORA' ? 'LORA' : undefined;
    return rematchLocalModelByHash({
      autoV2: o.autoV2.trim(),
      kind,
      localStem:
        typeof o.localStem === 'string' && o.localStem.trim()
          ? o.localStem.trim()
          : undefined,
    });
  });

  ipcMain.handle(IPC.civitaiStartVersionHashEnrich, async (_e, opts: unknown) => {
    const force =
      opts &&
      typeof opts === 'object' &&
      (opts as { force?: unknown }).force === true;
    startCatalogVersionHashEnrich(force ? { force: true } : undefined);
  });

  ipcMain.handle(IPC.modelFilesStartPopulate, async (_e, opts: unknown) => {
    const o = opts && typeof opts === 'object' ? (opts as { kind?: unknown; force?: unknown }) : {};
    const kind = o.kind === 'Checkpoint' ? 'Checkpoint' : o.kind === 'LORA' ? 'LORA' : null;
    if (!kind) throw new Error('Invalid populate kind');
    startModelCatalogPopulate(kind, o.force === true ? { force: true } : undefined);
  });

  ipcMain.handle(IPC.modelFilesStartLoraPopulate, async (_e, opts: unknown) => {
    const force =
      opts &&
      typeof opts === 'object' &&
      (opts as { force?: unknown }).force === true;
    startModelCatalogPopulate('LORA', force ? { force: true } : undefined);
  });

  ipcMain.handle(
    IPC.uiPreviewRenameLora,
    async (_e, sourceName: unknown, newBasename: unknown) => {
      if (typeof sourceName !== 'string') throw new Error('Invalid LoRA name');
      if (typeof newBasename !== 'string') throw new Error('Invalid new name');
      return previewRenameLora(sourceName, newBasename);
    },
  );

  ipcMain.handle(
    IPC.uiRenameLora,
    async (_e, sourceName: unknown, newBasename: unknown) => {
      if (typeof sourceName !== 'string') throw new Error('Invalid LoRA name');
      if (typeof newBasename !== 'string') throw new Error('Invalid new name');
      return renameLoraModel(sourceName, newBasename);
    },
  );

  ipcMain.handle(IPC.uiOpenLoraFolder, async () => {
    const folder = loadSettings().loraFolder;
    if (!folder) throw new Error('No LoRA folder configured');
    if (!fs.existsSync(folder)) {
      throw new Error('Configured LoRA folder no longer exists');
    }
    try {
      await openFolderInMyFileExplorer(folder);
    } catch (error) {
      throw new Error(
        `Could not open LoRA folder: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  ipcMain.handle(IPC.uiGetCheckpointFolder, async () =>
    loadSettings().checkpointFolder ?? null,
  );

  ipcMain.handle(IPC.uiPickCheckpointFolder, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const current = loadSettings().checkpointFolder;
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select checkpoint models folder',
      properties: ['openDirectory'],
      defaultPath: current || undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folder = result.filePaths[0] ?? null;
    if (!folder) return null;
    invalidateCheckpointIndexCache();
    return setCheckpointFolder(folder);
  });

  ipcMain.handle(IPC.uiSetCheckpointFolder, async (_e, folder: unknown) => {
    if (folder !== null && typeof folder !== 'string') {
      throw new Error('Invalid checkpoint folder');
    }
    invalidateCheckpointIndexCache();
    return setCheckpointFolder(folder);
  });

  ipcMain.handle(IPC.uiClearCheckpointFolder, async () => {
    invalidateCheckpointIndexCache();
    setCheckpointFolder(null);
  });

  ipcMain.handle(IPC.uiOpenCheckpointFolder, async () => {
    const folder = loadSettings().checkpointFolder;
    if (!folder) throw new Error('No checkpoint folder configured');
    if (!fs.existsSync(folder)) {
      throw new Error('Configured checkpoint folder no longer exists');
    }
    try {
      await openFolderInMyFileExplorer(folder);
    } catch (error) {
      throw new Error(
        `Could not open checkpoint folder: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  ipcMain.handle(IPC.uiGetImagesFolder, async () =>
    getActiveLibrary().imagesFolder ?? null,
  );

  ipcMain.handle(IPC.uiPickImagesFolder, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const current = loadSettings().imagesFolder;
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select community images folder',
      properties: ['openDirectory'],
      defaultPath: current || undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folder = result.filePaths[0] ?? null;
    if (!folder) return null;
    const previous = loadSettings().imagesFolder;
    const next = setImagesFolder(folder);
    try {
      migrateDownloadedCivitaiImagesRegistry(
        previous ? [previous] : undefined,
      );
    } catch {
      // ignore migration errors; downloads still work with AppData registry
    }
    return next;
  });

  ipcMain.handle(IPC.uiSetImagesFolder, async (_e, folder: unknown) => {
    if (folder !== null && typeof folder !== 'string') {
      throw new Error('Invalid images folder');
    }
    const previous = loadSettings().imagesFolder;
    const next = setImagesFolder(folder);
    try {
      migrateDownloadedCivitaiImagesRegistry(
        [previous, typeof folder === 'string' ? folder : null].filter(
          (p): p is string => Boolean(p?.trim()),
        ),
      );
    } catch {
      // ignore
    }
    return next;
  });

  ipcMain.handle(IPC.uiClearImagesFolder, async () => {
    const previous = loadSettings().imagesFolder;
    setImagesFolder(null);
    try {
      migrateDownloadedCivitaiImagesRegistry(
        previous ? [previous] : undefined,
      );
    } catch {
      // ignore
    }
  });

  ipcMain.handle(IPC.uiOpenImagesFolder, async () => {
    const folder = loadSettings().imagesFolder;
    if (!folder) throw new Error('No images folder configured');
    if (!fs.existsSync(folder)) {
      throw new Error('Configured images folder no longer exists');
    }
    try {
      await openFolderInMyFileExplorer(folder);
    } catch (error) {
      throw new Error(
        `Could not open images folder: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  ipcMain.handle(IPC.uiGetVideosFolder, async () =>
    getActiveLibrary().videosFolder ?? null,
  );

  ipcMain.handle(IPC.uiPickVideosFolder, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const current = loadSettings().videosFolder;
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select community videos folder',
      properties: ['openDirectory'],
      defaultPath: current || undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folder = result.filePaths[0] ?? null;
    if (!folder) return null;
    const previous = loadSettings().videosFolder;
    const next = setVideosFolder(folder);
    try {
      migrateDownloadedCivitaiVideosRegistry(
        previous ? [previous] : undefined,
      );
    } catch {
      // ignore migration errors; downloads still work with AppData registry
    }
    return next;
  });

  ipcMain.handle(IPC.uiSetVideosFolder, async (_e, folder: unknown) => {
    if (folder !== null && typeof folder !== 'string') {
      throw new Error('Invalid videos folder');
    }
    const previous = loadSettings().videosFolder;
    const next = setVideosFolder(folder);
    try {
      migrateDownloadedCivitaiVideosRegistry(
        [previous, typeof folder === 'string' ? folder : null].filter(
          (p): p is string => Boolean(p?.trim()),
        ),
      );
    } catch {
      // ignore
    }
    return next;
  });

  ipcMain.handle(IPC.uiClearVideosFolder, async () => {
    const previous = loadSettings().videosFolder;
    setVideosFolder(null);
    try {
      migrateDownloadedCivitaiVideosRegistry(
        previous ? [previous] : undefined,
      );
    } catch {
      // ignore
    }
  });

  ipcMain.handle(IPC.uiOpenVideosFolder, async () => {
    const folder = loadSettings().videosFolder;
    if (!folder) throw new Error('No videos folder configured');
    if (!fs.existsSync(folder)) {
      throw new Error('Configured videos folder no longer exists');
    }
    try {
      await openFolderInMyFileExplorer(folder);
    } catch (error) {
      throw new Error(
        `Could not open videos folder: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  /** Legacy masters IPC — now points at Checkpoint Benchmark folder. */
  ipcMain.handle(IPC.uiGetMastersFolder, async () =>
    getActiveLibrary().benchmarkOutputFolder ?? null,
  );

  ipcMain.handle(IPC.uiPickMastersFolder, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const current = getActiveLibrary().benchmarkOutputFolder;
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select Checkpoint Benchmark folder',
      properties: ['openDirectory'],
      defaultPath: current || undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folder = result.filePaths[0] ?? null;
    if (!folder) return null;
    const lib = getActiveLibrary();
    updateLibraryConfig(lib.id, { benchmarkOutputFolder: folder });
    return getActiveLibrary().benchmarkOutputFolder;
  });

  ipcMain.handle(IPC.uiSetMastersFolder, async (_e, folder: unknown) => {
    if (folder !== null && typeof folder !== 'string') {
      throw new Error('Invalid Checkpoint Benchmark folder');
    }
    const lib = getActiveLibrary();
    updateLibraryConfig(lib.id, {
      benchmarkOutputFolder: folder,
    });
    return getActiveLibrary().benchmarkOutputFolder;
  });

  ipcMain.handle(IPC.uiClearMastersFolder, async () => {
    const lib = getActiveLibrary();
    updateLibraryConfig(lib.id, { benchmarkOutputFolder: null });
  });

  ipcMain.handle(IPC.uiOpenMastersFolder, async () => {
    const folder = getActiveLibrary().benchmarkOutputFolder;
    if (!folder) throw new Error('No Checkpoint Benchmark folder configured');
    if (!fs.existsSync(folder)) {
      throw new Error('Configured Checkpoint Benchmark folder no longer exists');
    }
    try {
      await openFolderInMyFileExplorer(folder);
    } catch (error) {
      throw new Error(
        `Could not open Checkpoint Benchmark folder: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  ipcMain.handle(IPC.uiGetTrainingLibraryFolder, async () =>
    getActiveLibrary().trainingLibraryFolder ?? null,
  );

  ipcMain.handle(IPC.uiPickTrainingLibraryFolder, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const current = getActiveLibrary().trainingLibraryFolder;
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select LoRA training library folder',
      properties: ['openDirectory'],
      defaultPath: current || undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folder = result.filePaths[0] ?? null;
    if (!folder) return null;
    return setTrainingLibraryFolder(folder);
  });

  ipcMain.handle(
    IPC.uiSetTrainingLibraryFolder,
    async (_e, folder: unknown) => {
      if (folder !== null && typeof folder !== 'string') {
        throw new Error('Invalid training library folder');
      }
      return setTrainingLibraryFolder(folder);
    },
  );

  ipcMain.handle(IPC.uiClearTrainingLibraryFolder, async () => {
    setTrainingLibraryFolder(null);
  });

  ipcMain.handle(IPC.uiOpenTrainingLibraryFolder, async () => {
    const folder = getActiveLibrary().trainingLibraryFolder;
    if (!folder) throw new Error('No training library folder configured');
    if (!fs.existsSync(folder)) {
      throw new Error('Configured training library folder no longer exists');
    }
    try {
      await openFolderInMyFileExplorer(folder);
    } catch (error) {
      throw new Error(
        `Could not open training library folder: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  ipcMain.handle(IPC.uiGetPromptsFolder, async () =>
    loadSettings().promptsFolder ?? null,
  );

  ipcMain.handle(IPC.uiPickPromptsFolder, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const current = loadSettings().promptsFolder;
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select prompts folder',
      properties: ['openDirectory'],
      defaultPath: current || undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folder = result.filePaths[0] ?? null;
    if (!folder) return null;
    return setPromptsFolder(folder);
  });

  ipcMain.handle(IPC.uiSetPromptsFolder, async (_e, folder: unknown) => {
    if (folder !== null && typeof folder !== 'string') {
      throw new Error('Invalid prompts folder');
    }
    return setPromptsFolder(folder);
  });

  ipcMain.handle(IPC.uiClearPromptsFolder, async () => {
    setPromptsFolder(null);
  });

  ipcMain.handle(IPC.uiOpenPromptsFolder, async () => {
    const folder = loadSettings().promptsFolder;
    if (!folder) throw new Error('No prompts folder configured');
    if (!fs.existsSync(folder)) {
      throw new Error('Configured prompts folder no longer exists');
    }
    try {
      await openFolderInMyFileExplorer(folder);
    } catch (error) {
      throw new Error(
        `Could not open prompts folder: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  ipcMain.handle(IPC.uiGetCivitaiSettings, async () => ({
    origin: getCivitaiOrigin(),
    hasApiKey: Boolean(getCivitaiApiKey()),
    catalogAutoSyncIntervalMinutes: getCivitaiCatalogAutoSyncIntervalMinutes(),
    loraFolder: loadSettings().loraFolder ?? null,
    checkpointFolder: loadSettings().checkpointFolder ?? null,
    imagesFolder: getActiveLibrary().imagesFolder ?? null,
    videosFolder: getActiveLibrary().videosFolder ?? null,
    browseFilters: getCivitaiBrowseFilters(),
    splitRatio: getCivitaiSplitRatio(),
    cardMinWidth: getCivitaiCardMinWidth(),
    activeLibraryId: getActiveLibraryId(),
    libraries: listLibraryConfigs().map((lib) => ({
      id: lib.id,
      name: lib.name,
    })),
  }));

  ipcMain.handle(IPC.uiSetCivitaiOrigin, async (_e, origin: unknown) => {
    if (typeof origin !== 'string') throw new Error('Invalid Civitai origin');
    return setCivitaiOrigin(origin);
  });

  ipcMain.handle(IPC.uiSetCivitaiApiKey, async (_e, key: unknown) => {
    if (key !== null && typeof key !== 'string') {
      throw new Error('Invalid Civitai API key');
    }
    return Boolean(setCivitaiApiKey(key));
  });

  ipcMain.handle(IPC.uiSetHuggingFaceToken, async (_e, token: unknown) => {
    if (token !== null && typeof token !== 'string') {
      throw new Error('Invalid Hugging Face token');
    }
    return Boolean(setHuggingFaceToken(token));
  });

  ipcMain.handle(IPC.uiGetHuggingFaceTokenStatus, async () => ({
    hasToken: Boolean(getHuggingFaceToken()),
  }));

  ipcMain.handle(
    IPC.uiSetCivitaiCatalogAutoSyncInterval,
    async (_e, minutes: unknown) => {
      if (typeof minutes !== 'number' || !Number.isFinite(minutes)) {
        throw new Error('Invalid catalog auto-sync interval');
      }
      return setCivitaiCatalogAutoSyncIntervalMinutes(minutes);
    },
  );

  ipcMain.handle(
    IPC.uiSetDisableHardwareAcceleration,
    async (_e, disable: unknown) => {
      if (typeof disable !== 'boolean') {
        throw new Error('Invalid hardware acceleration setting');
      }
      return setDisableHardwareAcceleration(disable);
    },
  );

  ipcMain.handle(
    IPC.uiSetGenerationSaveInNewSubfolder,
    async (_e, enabled: unknown) => {
      if (typeof enabled !== 'boolean') {
        throw new Error('Invalid New subfolder setting');
      }
      return setGenerationSaveInNewSubfolder(enabled);
    },
  );

  ipcMain.handle(IPC.uiSetCivitaiBrowseFilters, async (_e, filters: unknown) => {
    if (!filters || typeof filters !== 'object') {
      throw new Error('Invalid Civitai browse filters');
    }
    return setCivitaiBrowseFilters(filters as Parameters<typeof setCivitaiBrowseFilters>[0]);
  });

  ipcMain.handle(IPC.uiGetCivitaiImageBrowseFilters, async () =>
    getCivitaiImageBrowseFilters(),
  );

  ipcMain.handle(
    IPC.uiSetCivitaiImageBrowseFilters,
    async (_e, filters: unknown) => {
      if (!filters || typeof filters !== 'object') {
        throw new Error('Invalid Civitai image browse filters');
      }
      return setCivitaiImageBrowseFilters(
        filters as Parameters<typeof setCivitaiImageBrowseFilters>[0],
      );
    },
  );

  ipcMain.handle(IPC.uiGetCivitaiVideoBrowseFilters, async () =>
    getCivitaiVideoBrowseFilters(),
  );

  ipcMain.handle(
    IPC.uiSetCivitaiVideoBrowseFilters,
    async (_e, filters: unknown) => {
      if (!filters || typeof filters !== 'object') {
        throw new Error('Invalid Civitai video browse filters');
      }
      return setCivitaiVideoBrowseFilters(
        filters as Parameters<typeof setCivitaiVideoBrowseFilters>[0],
      );
    },
  );

  ipcMain.handle(IPC.uiGetHfBrowseFilters, async () => getHfBrowseFilters());

  ipcMain.handle(IPC.uiSetHfBrowseFilters, async (_e, filters: unknown) => {
    if (!filters || typeof filters !== 'object') {
      throw new Error('Invalid Hugging Face browse filters');
    }
    return setHfBrowseFilters(
      filters as Parameters<typeof setHfBrowseFilters>[0],
    );
  });

  ipcMain.handle(IPC.uiClearHfBrowseFilters, async () => clearHfBrowseFilters());

  ipcMain.handle(IPC.huggingfaceSearchModels, async (_e, opts: unknown) => {
    if (!opts || typeof opts !== 'object') {
      throw new Error('Invalid Hugging Face search params');
    }
    const row = opts as Record<string, unknown>;
    return searchHuggingFaceModels({
      filters: row.filters,
      cursor: typeof row.cursor === 'string' ? row.cursor : null,
    });
  });

  ipcMain.handle(IPC.huggingfaceOpenModelPage, async (_e, modelId: unknown) => {
    if (typeof modelId !== 'string' || !modelId.trim()) {
      throw new Error('Invalid Hugging Face model id');
    }
    await shell.openExternal(huggingfaceModelPageUrl(modelId));
  });

  ipcMain.handle(IPC.huggingfaceOpenBrowser, async () => openHuggingFaceBrowser());

  ipcMain.handle(IPC.huggingfaceCloseBrowser, async () => {
    closeHuggingFaceBrowserWindow();
  });

  ipcMain.handle(IPC.huggingfaceGetModelDetail, async (_e, repoId: unknown) => {
    if (typeof repoId !== 'string' || !repoId.trim()) {
      throw new Error('Invalid Hugging Face model id');
    }
    return getHuggingFaceModelDetail(repoId);
  });

  ipcMain.handle(IPC.huggingfaceArchiveModel, async (_e, repoId: unknown) => {
    if (typeof repoId !== 'string' || !repoId.trim()) {
      throw new Error('Invalid Hugging Face model id');
    }
    return archiveHfModel(repoId);
  });

  ipcMain.handle(IPC.huggingfaceUnarchiveModel, async (_e, repoId: unknown) => {
    if (typeof repoId !== 'string' || !repoId.trim()) {
      throw new Error('Invalid Hugging Face model id');
    }
    return unarchiveHfModel(repoId);
  });

  ipcMain.handle(IPC.huggingfaceListArchived, async () => listArchivedHfModels());

  ipcMain.handle(IPC.huggingfaceListDownloaded, async () =>
    listDownloadedHfModels(),
  );

  ipcMain.handle(
    IPC.huggingfaceForgetDownloaded,
    async (_e, repoId: unknown) => {
      if (typeof repoId !== 'string' || !repoId.trim()) {
        throw new Error('Invalid Hugging Face model id');
      }
      return forgetDownloadedHfModel(repoId);
    },
  );

  ipcMain.handle(IPC.huggingfaceDownloadModel, async (_e, opts: unknown) => {
    if (!opts || typeof opts !== 'object') {
      throw new Error('Invalid Hugging Face download options');
    }
    const row = opts as Record<string, unknown>;
    if (typeof row.repoId !== 'string' || !row.repoId.trim()) {
      throw new Error('Invalid repo id');
    }
    if (typeof row.filePath !== 'string' || !row.filePath.trim()) {
      throw new Error('Invalid file path');
    }
    const type = row.type === 'Checkpoint' ? 'Checkpoint' : 'LORA';
    return enqueueHfDownload({
      repoId: row.repoId.trim(),
      revision: typeof row.revision === 'string' ? row.revision : undefined,
      filePath: row.filePath.trim(),
      type,
      category: typeof row.category === 'string' ? row.category : undefined,
      loraCategoryId:
        typeof row.loraCategoryId === 'string' ? row.loraCategoryId : undefined,
      extraLoraCategoryIds: Array.isArray(row.extraLoraCategoryIds)
        ? row.extraLoraCategoryIds.filter(
            (id): id is string => typeof id === 'string',
          )
        : undefined,
      weights: typeof row.weights === 'string' ? row.weights : undefined,
      extraComment:
        typeof row.extraComment === 'string' ? row.extraComment : undefined,
      extraPrompt:
        typeof row.extraPrompt === 'string' ? row.extraPrompt : undefined,
      modelName: typeof row.modelName === 'string' ? row.modelName : undefined,
      fileName: typeof row.fileName === 'string' ? row.fileName : undefined,
    });
  });

  ipcMain.handle(
    IPC.huggingfaceCheckDownloadDestination,
    async (_e, opts: unknown) => {
      if (!opts || typeof opts !== 'object') {
        throw new Error('Invalid destination check');
      }
      const row = opts as Record<string, unknown>;
      if (typeof row.fileName !== 'string' || !row.fileName.trim()) {
        throw new Error('Invalid file name');
      }
      return resolveHfDownloadDestination({
        type: row.type === 'Checkpoint' ? 'Checkpoint' : 'LORA',
        category: typeof row.category === 'string' ? row.category : undefined,
        loraCategoryId:
          typeof row.loraCategoryId === 'string' ? row.loraCategoryId : undefined,
        fileName: row.fileName.trim(),
      });
    },
  );

  ipcMain.handle(IPC.huggingfaceDownloadQueueList, async () =>
    listHfDownloadQueue(),
  );
  ipcMain.handle(
    IPC.huggingfaceDownloadQueueCancel,
    async (_e, jobId: unknown) => {
      if (typeof jobId !== 'string' || !jobId.trim()) {
        throw new Error('Invalid job id');
      }
      return cancelHfDownloadJob(jobId);
    },
  );
  ipcMain.handle(IPC.huggingfaceDownloadQueuePause, async () =>
    pauseHfDownloadQueue(),
  );
  ipcMain.handle(IPC.huggingfaceDownloadQueueResume, async () =>
    resumeHfDownloadQueue(),
  );

  // Restore any persisted HF queue after handlers are registered.
  try {
    restoreHfDownloadQueue();
  } catch {
    // ignore
  }

  ipcMain.handle(IPC.uiSetCivitaiSplitRatio, async (_e, ratio: unknown) => {
    if (typeof ratio !== 'number' || !Number.isFinite(ratio)) {
      throw new Error('Invalid Civitai split ratio');
    }
    return setCivitaiSplitRatio(ratio);
  });

  ipcMain.handle(IPC.uiSetCivitaiCardMinWidth, async (_e, px: unknown) => {
    if (typeof px !== 'number' || !Number.isFinite(px)) {
      throw new Error('Invalid Civitai card size');
    }
    return setCivitaiCardMinWidth(px);
  });

  ipcMain.handle(IPC.civitaiSearchModels, async (_e, params: unknown) => {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid Civitai search params');
    }
    const p = params as Record<string, unknown>;
    return searchCivitaiModelCards(parseCatalogBrowseParams(p));
  });

  ipcMain.handle(IPC.civitaiGetCatalogSlice, async (_e, params: unknown) => {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid Civitai catalog params');
    }
    return getCatalogSlice(parseCatalogBrowseParams(params as Record<string, unknown>));
  });

  ipcMain.handle(
    IPC.civitaiEnrichBrowseEarlyAccess,
    async (_e, params: unknown) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid enrich params');
      }
      const p = params as { modelIds?: unknown; sliceKey?: unknown };
      const modelIds = Array.isArray(p.modelIds)
        ? p.modelIds.filter(
            (id): id is number => typeof id === 'number' && Number.isFinite(id),
          )
        : [];
      return enrichBrowseEarlyAccess(
        modelIds,
        typeof p.sliceKey === 'string' ? p.sliceKey : undefined,
      );
    },
  );

  ipcMain.handle(IPC.civitaiSyncCatalogSlice, async (_e, params: unknown) => {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid Civitai sync params');
    }
    const p = params as Record<string, unknown>;
    const type = p.type === 'Checkpoint' ? 'Checkpoint' : 'LORA';
    return syncCatalogSlice({
      type,
      query: typeof p.query === 'string' ? p.query : undefined,
      architectures: parseArchitectures(p.architectures),
      sdxlFamily: parseSdxlFamily(p.sdxlFamily),
      category: parseCategory(p.category),
      mode:
        p.mode === 'fill' || p.mode === 'incremental' || p.mode === 'auto'
          ? p.mode
          : 'auto',
      force: p.force === true,
    });
  });

  ipcMain.handle(IPC.civitaiCancelCatalogSync, async () => {
    cancelCatalogSync();
  });

  ipcMain.handle(IPC.civitaiGetModel, async (_e, modelId: unknown) => {
    if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
      throw new Error('Invalid model id');
    }
    return getCivitaiModelCard(modelId);
  });

  ipcMain.handle(
    IPC.civitaiListModelDownloadOptions,
    async (_e, modelId: unknown, opts: unknown) => {
      if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
        throw new Error('Invalid model id');
      }
      const browseArchitectures =
        opts &&
        typeof opts === 'object' &&
        Array.isArray((opts as { browseArchitectures?: unknown }).browseArchitectures)
          ? parseArchitectures(
              (opts as { browseArchitectures: unknown }).browseArchitectures,
            )
          : undefined;
      return listCivitaiModelDownloadOptions(modelId, {
        browseArchitectures,
      });
    },
  );

  ipcMain.handle(
    IPC.civitaiRefreshModelVersionInstalls,
    async (_e, modelId: unknown, typeHint: unknown) => {
      if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
        throw new Error('Invalid model id');
      }
      const hint =
        typeHint === 'Checkpoint' || typeHint === 'LORA' ? typeHint : undefined;
      return refreshCivitaiModelVersionInstalls(modelId, hint);
    },
  );

  ipcMain.handle(IPC.civitaiArchiveModel, async (_e, modelId: unknown) => {
    if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
      throw new Error('Invalid model id');
    }
    return archiveCivitaiModel(modelId);
  });

  ipcMain.handle(IPC.civitaiArchiveModels, async (_e, modelIds: unknown) => {
    if (!Array.isArray(modelIds)) {
      throw new Error('Invalid model ids');
    }
    const ids = modelIds.filter(
      (id): id is number => typeof id === 'number' && Number.isFinite(id),
    );
    return archiveCivitaiModels(ids);
  });

  ipcMain.handle(IPC.civitaiUnarchiveModel, async (_e, modelId: unknown) => {
    if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
      throw new Error('Invalid model id');
    }
    return unarchiveCivitaiModel(modelId);
  });

  ipcMain.handle(IPC.civitaiListArchived, async () =>
    listArchivedCivitaiModels(),
  );

  ipcMain.handle(IPC.civitaiListArchivedCards, async () =>
    listArchivedCivitaiCards(),
  );

  ipcMain.handle(IPC.civitaiSearchImages, async (_e, params: unknown) => {
    const row =
      params && typeof params === 'object'
        ? (params as Record<string, unknown>)
        : {};
    const baseModels = Array.isArray(row.baseModels)
      ? row.baseModels.filter((v): v is string => typeof v === 'string')
      : undefined;
    const tools = Array.isArray(row.tools)
      ? row.tools.filter(
          (
            v,
          ): v is
            | 'krea'
            | 'comfyui'
            | 'civitai'
            | 'automatic1111'
            | 'forge'
            | 'swarmui'
            | 'fooocus' =>
            v === 'krea' ||
            v === 'comfyui' ||
            v === 'civitai' ||
            v === 'automatic1111' ||
            v === 'forge' ||
            v === 'swarmui' ||
            v === 'fooocus',
        )
      : undefined;
    return searchCivitaiImages({
      cursor: typeof row.cursor === 'string' ? row.cursor : null,
      limit: typeof row.limit === 'number' ? row.limit : undefined,
      baseModels,
      tools,
      sort:
        row.sort === 'Most Reactions' ||
        row.sort === 'Most Comments' ||
        row.sort === 'Most Collected' ||
        row.sort === 'Newest' ||
        row.sort === 'Oldest'
          ? row.sort
          : 'Newest',
      period:
        row.period === 'AllTime' ||
        row.period === 'Year' ||
        row.period === 'Month' ||
        row.period === 'Week' ||
        row.period === 'Day'
          ? row.period
          : undefined,
      nsfwMode:
        row.nsfwMode === 'sfw' ||
        row.nsfwMode === 'all' ||
        row.nsfwMode === 'nsfw'
          ? row.nsfwMode
          : undefined,
      nsfw: row.nsfw === true,
      username: typeof row.username === 'string' ? row.username : undefined,
      modelId: typeof row.modelId === 'number' ? row.modelId : undefined,
      withMeta: row.withMeta !== false,
    });
  });

  ipcMain.handle(IPC.civitaiDownloadImage, async (_e, params: unknown) => {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid image download request');
    }
    const row = params as Record<string, unknown>;
    if (typeof row.imageId !== 'number' || !Number.isFinite(row.imageId)) {
      throw new Error('Invalid image id');
    }
    if (typeof row.url !== 'string' || !row.url.trim()) {
      throw new Error('Invalid image URL');
    }
    return downloadCivitaiImage({
      imageId: row.imageId,
      url: row.url.trim(),
      baseModel: typeof row.baseModel === 'string' ? row.baseModel : null,
      username: typeof row.username === 'string' ? row.username : null,
      fileName: typeof row.fileName === 'string' ? row.fileName : undefined,
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
    });
  });

  ipcMain.handle(IPC.civitaiListDownloadedImages, async () =>
    listDownloadedCivitaiImages(),
  );

  ipcMain.handle(IPC.civitaiListDownloadedImageIds, async () =>
    listDownloadedCivitaiImageIds(),
  );

  ipcMain.handle(
    IPC.civitaiStartImageDownloadAll,
    async (_e, params: unknown) => {
      const row =
        params && typeof params === 'object'
          ? (params as Record<string, unknown>)
          : {};
      const baseModels = Array.isArray(row.baseModels)
        ? row.baseModels.filter(
            (b): b is string => typeof b === 'string' && Boolean(b.trim()),
          )
        : undefined;
      return startCivitaiImageDownloadAll({
        sort:
          row.sort === 'Newest' ||
          row.sort === 'Most Reactions' ||
          row.sort === 'Most Comments' ||
          row.sort === 'Most Collected'
            ? row.sort
            : undefined,
        period:
          row.period === 'AllTime' ||
          row.period === 'Year' ||
          row.period === 'Month' ||
          row.period === 'Week' ||
          row.period === 'Day'
            ? row.period
            : undefined,
        nsfwMode:
          row.nsfwMode === 'sfw' ||
          row.nsfwMode === 'all' ||
          row.nsfwMode === 'nsfw'
            ? row.nsfwMode
            : undefined,
        tool:
          row.tool === 'any' ||
          row.tool === 'krea' ||
          row.tool === 'comfyui' ||
          row.tool === 'civitai' ||
          row.tool === 'automatic1111' ||
          row.tool === 'forge' ||
          row.tool === 'swarmui' ||
          row.tool === 'fooocus'
            ? row.tool
            : undefined,
        baseModels,
      });
    },
  );

  ipcMain.handle(IPC.civitaiStopImageDownloadAll, async () =>
    stopCivitaiImageDownloadAll(),
  );

  ipcMain.handle(IPC.civitaiGetImageDownloadAllStatus, async () =>
    getCivitaiImageDownloadAllStatus(),
  );

  ipcMain.handle(IPC.civitaiEvaluateBrowseCatchUp, async (_e, request: unknown) => {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid browse catch-up request');
    }
    const row = request as Record<string, unknown>;
    if (row.media !== 'image' && row.media !== 'video') {
      throw new Error('Invalid browse catch-up media');
    }
    if (!row.keyParts || typeof row.keyParts !== 'object') {
      throw new Error('Invalid browse catch-up key parts');
    }
    if (!Array.isArray(row.page)) {
      throw new Error('Invalid browse catch-up page');
    }
    return evaluateBrowseCatchUpPage({
      media: row.media,
      keyParts: row.keyParts as Parameters<
        typeof evaluateBrowseCatchUpPage
      >[0]['keyParts'],
      page: row.page as Parameters<typeof evaluateBrowseCatchUpPage>[0]['page'],
      consecutiveDownloadedPages:
        typeof row.consecutiveDownloadedPages === 'number'
          ? row.consecutiveDownloadedPages
          : 0,
      append: row.append === true,
      alreadyJumpedToResume: row.alreadyJumpedToResume === true,
      ignoreEarlyStop: row.ignoreEarlyStop === true,
    });
  });

  ipcMain.handle(
    IPC.civitaiNoteBrowseResumeCursor,
    async (_e, request: unknown) => {
      if (!request || typeof request !== 'object') {
        throw new Error('Invalid browse resume request');
      }
      const row = request as Record<string, unknown>;
      if (row.media !== 'image' && row.media !== 'video') {
        throw new Error('Invalid browse catch-up media');
      }
      if (!row.keyParts || typeof row.keyParts !== 'object') {
        throw new Error('Invalid browse catch-up key parts');
      }
      noteBrowseResumeCursor(
        row.media,
        row.keyParts as Parameters<typeof noteBrowseResumeCursor>[1],
        typeof row.cursor === 'string' ? row.cursor : null,
        { alreadyJumpedToResume: row.alreadyJumpedToResume === true },
      );
    },
  );

  ipcMain.handle(IPC.civitaiCommitBrowseCatchUp, async (_e, request: unknown) => {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid browse catch-up commit');
    }
    const row = request as Record<string, unknown>;
    if (row.media !== 'image' && row.media !== 'video') {
      throw new Error('Invalid browse catch-up media');
    }
    if (!row.keyParts || typeof row.keyParts !== 'object') {
      throw new Error('Invalid browse catch-up key parts');
    }
    commitBrowseCatchUp({
      media: row.media,
      keyParts: row.keyParts as Parameters<typeof commitBrowseCatchUp>[0]['keyParts'],
      tipHits: Array.isArray(row.tipHits)
        ? (row.tipHits as Parameters<typeof commitBrowseCatchUp>[0]['tipHits'])
        : [],
      coveredHits: Array.isArray(row.coveredHits)
        ? (row.coveredHits as Parameters<
            typeof commitBrowseCatchUp
          >[0]['coveredHits'])
        : [],
      exhausted: row.exhausted === true,
    });
  });

  ipcMain.handle(IPC.civitaiArchiveImage, async (_e, imageId: unknown) => {
    if (typeof imageId !== 'number' || !Number.isFinite(imageId)) {
      throw new Error('Invalid image id');
    }
    const archived = archiveCivitaiImage(imageId);
    return { total: archived.length };
  });

  ipcMain.handle(IPC.civitaiArchiveImages, async (_e, imageIds: unknown) => {
    if (!Array.isArray(imageIds)) {
      throw new Error('Invalid image ids');
    }
    const ids = imageIds.filter(
      (id): id is number => typeof id === 'number' && Number.isFinite(id),
    );
    const result = archiveCivitaiImages(ids);
    return { archivedCount: result.archivedCount, total: result.archived.length };
  });

  ipcMain.handle(IPC.civitaiUnarchiveImage, async (_e, imageId: unknown) => {
    if (typeof imageId !== 'number' || !Number.isFinite(imageId)) {
      throw new Error('Invalid image id');
    }
    const archived = unarchiveCivitaiImage(imageId);
    return { total: archived.length };
  });

  ipcMain.handle(IPC.civitaiListArchivedImages, async () =>
    listArchivedCivitaiImages().map((a) => a.imageId),
  );

  ipcMain.handle(
    IPC.civitaiOpenDownloadedImage,
    async (_e, absolutePath: unknown) => {
      if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
        throw new Error('Invalid path');
      }
      await openDownloadedCivitaiImage(absolutePath.trim());
    },
  );

  ipcMain.handle(IPC.civitaiSearchVideos, async (_e, params: unknown) => {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid video search params');
    }
    const row = params as Record<string, unknown>;
    const baseModels = Array.isArray(row.baseModels)
      ? row.baseModels.filter(
          (b): b is string => typeof b === 'string' && Boolean(b.trim()),
        )
      : undefined;
    const tools = Array.isArray(row.tools)
      ? row.tools.filter(
          (
            v,
          ): v is
            | 'krea'
            | 'comfyui'
            | 'civitai'
            | 'automatic1111'
            | 'forge'
            | 'swarmui'
            | 'fooocus' =>
            v === 'krea' ||
            v === 'comfyui' ||
            v === 'civitai' ||
            v === 'automatic1111' ||
            v === 'forge' ||
            v === 'swarmui' ||
            v === 'fooocus',
        )
      : undefined;
    return searchCivitaiVideos({
      cursor: typeof row.cursor === 'string' ? row.cursor : null,
      limit: typeof row.limit === 'number' ? row.limit : undefined,
      baseModels,
      tools,
      sort:
        row.sort === 'Most Reactions' ||
        row.sort === 'Most Comments' ||
        row.sort === 'Most Collected' ||
        row.sort === 'Newest' ||
        row.sort === 'Oldest'
          ? row.sort
          : 'Newest',
      period:
        row.period === 'AllTime' ||
        row.period === 'Year' ||
        row.period === 'Month' ||
        row.period === 'Week' ||
        row.period === 'Day'
          ? row.period
          : undefined,
      nsfwMode:
        row.nsfwMode === 'sfw' ||
        row.nsfwMode === 'all' ||
        row.nsfwMode === 'nsfw'
          ? row.nsfwMode
          : undefined,
      nsfw: row.nsfw === true,
      username: typeof row.username === 'string' ? row.username : undefined,
      modelId: typeof row.modelId === 'number' ? row.modelId : undefined,
      withMeta: row.withMeta !== false,
    });
  });

  ipcMain.handle(IPC.civitaiDownloadVideo, async (_e, params: unknown) => {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid video download request');
    }
    const row = params as Record<string, unknown>;
    if (typeof row.imageId !== 'number' || !Number.isFinite(row.imageId)) {
      throw new Error('Invalid video id');
    }
    if (typeof row.url !== 'string' || !row.url.trim()) {
      throw new Error('Invalid video URL');
    }
    return downloadCivitaiVideo({
      imageId: row.imageId,
      url: row.url.trim(),
      baseModel: typeof row.baseModel === 'string' ? row.baseModel : null,
      username: typeof row.username === 'string' ? row.username : null,
      fileName: typeof row.fileName === 'string' ? row.fileName : undefined,
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
    });
  });

  ipcMain.handle(IPC.civitaiListDownloadedVideos, async () =>
    listDownloadedCivitaiVideos(),
  );

  ipcMain.handle(IPC.civitaiListDownloadedVideoIds, async () =>
    listDownloadedCivitaiVideoIds(),
  );

  ipcMain.handle(
    IPC.civitaiStartVideoDownloadAll,
    async (_e, params: unknown) => {
      const row =
        params && typeof params === 'object'
          ? (params as Record<string, unknown>)
          : {};
      const baseModels = Array.isArray(row.baseModels)
        ? row.baseModels.filter(
            (b): b is string => typeof b === 'string' && Boolean(b.trim()),
          )
        : undefined;
      return startCivitaiVideoDownloadAll({
        sort:
          row.sort === 'Newest' ||
          row.sort === 'Most Reactions' ||
          row.sort === 'Most Comments' ||
          row.sort === 'Most Collected'
            ? row.sort
            : undefined,
        period:
          row.period === 'AllTime' ||
          row.period === 'Year' ||
          row.period === 'Month' ||
          row.period === 'Week' ||
          row.period === 'Day'
            ? row.period
            : undefined,
        nsfwMode:
          row.nsfwMode === 'sfw' ||
          row.nsfwMode === 'all' ||
          row.nsfwMode === 'nsfw'
            ? row.nsfwMode
            : undefined,
        tool:
          row.tool === 'any' ||
          row.tool === 'krea' ||
          row.tool === 'comfyui' ||
          row.tool === 'civitai' ||
          row.tool === 'automatic1111' ||
          row.tool === 'forge' ||
          row.tool === 'swarmui' ||
          row.tool === 'fooocus'
            ? row.tool
            : undefined,
        baseModels,
      });
    },
  );

  ipcMain.handle(IPC.civitaiStopVideoDownloadAll, async () =>
    stopCivitaiVideoDownloadAll(),
  );

  ipcMain.handle(IPC.civitaiGetVideoDownloadAllStatus, async () =>
    getCivitaiVideoDownloadAllStatus(),
  );

  ipcMain.handle(IPC.civitaiArchiveVideo, async (_e, imageId: unknown) => {
    if (typeof imageId !== 'number' || !Number.isFinite(imageId)) {
      throw new Error('Invalid video id');
    }
    const archived = archiveCivitaiVideo(imageId);
    return { total: archived.length };
  });

  ipcMain.handle(IPC.civitaiArchiveVideos, async (_e, imageIds: unknown) => {
    if (!Array.isArray(imageIds)) {
      throw new Error('Invalid video ids');
    }
    const ids = imageIds.filter(
      (id): id is number => typeof id === 'number' && Number.isFinite(id),
    );
    const result = archiveCivitaiVideos(ids);
    return { archivedCount: result.archivedCount, total: result.archived.length };
  });

  ipcMain.handle(IPC.civitaiUnarchiveVideo, async (_e, imageId: unknown) => {
    if (typeof imageId !== 'number' || !Number.isFinite(imageId)) {
      throw new Error('Invalid video id');
    }
    const archived = unarchiveCivitaiVideo(imageId);
    return { total: archived.length };
  });

  ipcMain.handle(IPC.civitaiListArchivedVideos, async () =>
    listArchivedCivitaiVideos().map((a) => a.imageId),
  );

  ipcMain.handle(
    IPC.civitaiOpenDownloadedVideo,
    async (_e, absolutePath: unknown) => {
      if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
        throw new Error('Invalid path');
      }
      await openDownloadedCivitaiVideo(absolutePath.trim());
    },
  );

  ipcMain.handle(IPC.civitaiMaybeModel, async (_e, modelId: unknown) => {
    if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
      throw new Error('Invalid model id');
    }
    return maybeCivitaiModel(modelId);
  });

  ipcMain.handle(IPC.civitaiUnmaybeModel, async (_e, modelId: unknown) => {
    if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
      throw new Error('Invalid model id');
    }
    return unmaybeCivitaiModel(modelId);
  });

  ipcMain.handle(IPC.civitaiListMaybe, async () => listMaybeCivitaiModels());

  ipcMain.handle(IPC.civitaiListMaybeCards, async () =>
    listMaybeCivitaiCards(),
  );

  ipcMain.handle(IPC.civitaiBlockCreator, async (_e, username: unknown) => {
    if (typeof username !== 'string' || !username.trim()) {
      throw new Error('Creator username required');
    }
    return blockCivitaiCreator(username);
  });

  ipcMain.handle(IPC.civitaiUnblockCreator, async (_e, username: unknown) => {
    if (typeof username !== 'string' || !username.trim()) {
      throw new Error('Creator username required');
    }
    return unblockCivitaiCreator(username);
  });

  ipcMain.handle(IPC.civitaiListBlockedCreators, async () =>
    listBlockedCivitaiCreators(),
  );

  ipcMain.handle(IPC.civitaiListInstalledCards, async () =>
    listInstalledCivitaiCards(),
  );

  ipcMain.handle(IPC.civitaiListShelfSummaries, async () =>
    listCivitaiShelfSummaries(),
  );

  ipcMain.handle(IPC.civitaiMarkInstalled, async (_e, modelId: unknown) => {
    if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
      throw new Error('Invalid model id');
    }
    markCivitaiModelInstalled(modelId);
  });

  ipcMain.handle(
    IPC.civitaiMarkVersionInstalled,
    async (_e, params: unknown) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid mark-version params');
      }
      const p = params as Record<string, unknown>;
      if (typeof p.modelId !== 'number' || !Number.isFinite(p.modelId)) {
        throw new Error('Invalid model id');
      }
      if (typeof p.versionId !== 'number' || !Number.isFinite(p.versionId)) {
        throw new Error('Invalid version id');
      }
      if (typeof p.fileId !== 'number' || !Number.isFinite(p.fileId)) {
        throw new Error('Invalid file id');
      }
      markCivitaiVersionInstalled({
        modelId: p.modelId,
        versionId: p.versionId,
        fileId: p.fileId,
        fileName: typeof p.fileName === 'string' ? p.fileName : undefined,
      });
    },
  );

  ipcMain.handle(
    IPC.civitaiMarkVersionsInstalled,
    async (_e, params: unknown) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid mark-versions params');
      }
      const p = params as Record<string, unknown>;
      if (typeof p.modelId !== 'number' || !Number.isFinite(p.modelId)) {
        throw new Error('Invalid model id');
      }
      if (!Array.isArray(p.versions)) {
        throw new Error('Invalid version list');
      }
      const versions: Array<{
        versionId: number;
        fileId: number;
        fileName?: string;
      }> = [];
      for (const row of p.versions) {
        if (!row || typeof row !== 'object') continue;
        const item = row as Record<string, unknown>;
        if (typeof item.versionId !== 'number' || !Number.isFinite(item.versionId)) {
          continue;
        }
        if (typeof item.fileId !== 'number' || !Number.isFinite(item.fileId)) {
          continue;
        }
        versions.push({
          versionId: item.versionId,
          fileId: item.fileId,
          fileName: typeof item.fileName === 'string' ? item.fileName : undefined,
        });
      }
      if (versions.length === 0) {
        throw new Error('No versions to mark');
      }
      markCivitaiVersionsInstalled(p.modelId, versions);
    },
  );

  ipcMain.handle(IPC.civitaiUnmarkInstalled, async (_e, modelId: unknown) => {
    if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
      throw new Error('Invalid model id');
    }
    unmarkCivitaiModelInstalled(modelId);
  });

  ipcMain.handle(IPC.civitaiWatchModel, async (_e, params: unknown) => {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid watch params');
    }
    const p = params as Record<string, unknown>;
    if (typeof p.modelId !== 'number' || !Number.isFinite(p.modelId)) {
      throw new Error('Invalid model id');
    }
    if (typeof p.modelName !== 'string') throw new Error('Invalid model name');
    const type = p.type === 'Checkpoint' ? 'Checkpoint' : 'LORA';
    let earlyAccessEndsAt =
      typeof p.earlyAccessEndsAt === 'string'
        ? p.earlyAccessEndsAt
        : undefined;
    // List/catalog cards often lack end times; fetch version detail when watching.
    if (!earlyAccessEndsAt) {
      try {
        const card = await getCivitaiModelCard(p.modelId, type);
        earlyAccessEndsAt = card.earlyAccessEndsAt;
      } catch {
        /* keep watching without countdown */
      }
    }
    watchCivitaiModel({
      modelId: p.modelId,
      modelName: p.modelName,
      type,
      versionId:
        typeof p.versionId === 'number' && Number.isFinite(p.versionId)
          ? p.versionId
          : undefined,
      earlyAccessEndsAt,
    });
    return listCivitaiWatchlistDtos();
  });

  ipcMain.handle(IPC.civitaiUnwatchModel, async (_e, modelId: unknown) => {
    if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
      throw new Error('Invalid model id');
    }
    unwatchCivitaiModel(modelId);
    return listCivitaiWatchlistDtos();
  });

  ipcMain.handle(IPC.civitaiListWatchlist, async () =>
    listCivitaiWatchlistDtos(),
  );

  ipcMain.handle(IPC.civitaiRefreshWatchlist, async (_e, opts: unknown) => {
    const allowPageScrape =
      !opts ||
      typeof opts !== 'object' ||
      (opts as { allowPageScrape?: unknown }).allowPageScrape !== false;
    return refreshCivitaiWatchlist({ allowPageScrape });
  });

  ipcMain.handle(IPC.civitaiListRecentlyUnlocked, async () => {
    const { listCivitaiRecentlyUnlockedDtos } = await import(
      './civitaiService.js'
    );
    return listCivitaiRecentlyUnlockedDtos();
  });

  ipcMain.handle(
    IPC.civitaiDismissRecentlyUnlocked,
    async (_e, modelId: unknown) => {
      if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
        throw new Error('Invalid model id');
      }
      const { dismissCivitaiRecentlyUnlocked, listCivitaiRecentlyUnlockedDtos } =
        await import('./civitaiService.js');
      dismissCivitaiRecentlyUnlocked(modelId);
      return listCivitaiRecentlyUnlockedDtos();
    },
  );

  ipcMain.handle(IPC.civitaiListDownloadCategories, async (_e, type: unknown) => {
    const modelType = type === 'Checkpoint' ? 'Checkpoint' : 'LORA';
    return listDownloadCategories(modelType);
  });

  ipcMain.handle(
    IPC.civitaiCreateDownloadCategory,
    async (_e, type: unknown, name: unknown) => {
      const modelType = type === 'Checkpoint' ? 'Checkpoint' : 'LORA';
      if (typeof name !== 'string' || !name.trim()) {
        throw new Error('Invalid category name');
      }
      return createDownloadCategory(modelType, name);
    },
  );

  ipcMain.handle(IPC.civitaiDownloadModel, async (_e, params: unknown) => {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid download params');
    }
    const p = params as Record<string, unknown>;
    if (typeof p.modelId !== 'number' || !Number.isFinite(p.modelId)) {
      throw new Error('Invalid model id');
    }
    const type = p.type === 'Checkpoint' ? 'Checkpoint' : 'LORA';
    const extraLoraCategoryIds = Array.isArray(p.extraLoraCategoryIds)
      ? p.extraLoraCategoryIds.filter(
          (id): id is string => typeof id === 'string',
        )
      : undefined;
    return enqueueModelDownload({
      modelId: p.modelId,
      versionId:
        typeof p.versionId === 'number' && Number.isFinite(p.versionId)
          ? p.versionId
          : undefined,
      fileId:
        typeof p.fileId === 'number' && Number.isFinite(p.fileId)
          ? p.fileId
          : undefined,
      type,
      category: typeof p.category === 'string' ? p.category : undefined,
      loraCategoryId:
        typeof p.loraCategoryId === 'string' ? p.loraCategoryId : undefined,
      extraLoraCategoryIds,
      weights: typeof p.weights === 'string' ? p.weights : undefined,
      extraComment:
        typeof p.extraComment === 'string' ? p.extraComment : undefined,
      extraPrompt:
        typeof p.extraPrompt === 'string' ? p.extraPrompt : undefined,
      modelName: typeof p.modelName === 'string' ? p.modelName : undefined,
      fileName: typeof p.fileName === 'string' ? p.fileName : undefined,
    });
  });

  ipcMain.handle(
    IPC.civitaiCheckDownloadDestination,
    async (_e, params: unknown) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid destination check');
      }
      const p = params as Record<string, unknown>;
      if (typeof p.fileName !== 'string') {
        throw new Error('File name required');
      }
      const type = p.type === 'Checkpoint' ? 'Checkpoint' : 'LORA';
      return checkCivitaiDownloadDestination({
        type,
        fileName: p.fileName,
        fallbackFileName:
          typeof p.fallbackFileName === 'string'
            ? p.fallbackFileName
            : undefined,
        category: typeof p.category === 'string' ? p.category : undefined,
        loraCategoryId:
          typeof p.loraCategoryId === 'string' ? p.loraCategoryId : undefined,
      });
    },
  );

  ipcMain.handle(IPC.civitaiDownloadQueueList, async () =>
    listModelDownloadQueue(),
  );

  ipcMain.handle(IPC.civitaiDownloadLogList, async () => listDownloadLog());
  ipcMain.handle(IPC.civitaiDownloadLogClear, async () => {
    clearDownloadLog();
    return listDownloadLog();
  });

  ipcMain.handle(IPC.civitaiDownloadQueueCancel, async (_e, modelId: unknown) => {
    if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
      throw new Error('Invalid model id');
    }
    return cancelModelDownload(modelId);
  });

  ipcMain.handle(IPC.civitaiDownloadQueueResume, async () =>
    resumeModelDownloadQueue(),
  );

  ipcMain.handle(IPC.civitaiDownloadQueuePause, async (_e, reason: unknown) =>
    pauseModelDownloadQueue(
      typeof reason === 'string' && reason.trim()
        ? reason.trim()
        : 'Paused',
    ),
  );

  ipcMain.handle(IPC.civitaiEnterBackgroundDownloads, async () => {
    if (!hasPendingModelDownloads()) {
      throw new Error('Download queue is empty');
    }
    const ok = enterBackgroundDownloads();
    if (!ok) throw new Error('Download queue is empty');
    return true;
  });

  ipcMain.handle(
    IPC.civitaiDownloadQueueMove,
    async (_e, modelId: unknown, delta: unknown) => {
      if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
        throw new Error('Invalid model id');
      }
      if (delta !== -1 && delta !== 1) {
        throw new Error('Invalid move delta');
      }
      return moveModelDownloadInQueue(modelId, delta);
    },
  );

  ipcMain.handle(
    IPC.civitaiDownloadQueueReorder,
    async (_e, orderedModelIds: unknown) => {
      if (!Array.isArray(orderedModelIds)) {
        throw new Error('Invalid reorder list');
      }
      const ids = orderedModelIds.filter(
        (id): id is number => typeof id === 'number' && Number.isFinite(id),
      );
      if (ids.length !== orderedModelIds.length) {
        throw new Error('Invalid reorder list');
      }
      return reorderModelDownloadQueue(ids);
    },
  );

  ipcMain.handle(
    IPC.civitaiDownloadQueueUpdate,
    async (_e, modelId: unknown, patch: unknown) => {
      if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
        throw new Error('Invalid model id');
      }
      if (!patch || typeof patch !== 'object') {
        throw new Error('Invalid queue update');
      }
      const o = patch as Record<string, unknown>;
      return updateQueuedModelDownload(modelId, {
        loraCategoryId:
          typeof o.loraCategoryId === 'string' ? o.loraCategoryId : undefined,
        extraLoraCategoryIds: Array.isArray(o.extraLoraCategoryIds)
          ? o.extraLoraCategoryIds.filter(
              (id): id is string => typeof id === 'string',
            )
          : undefined,
        category: typeof o.category === 'string' ? o.category : undefined,
        weights: typeof o.weights === 'string' ? o.weights : undefined,
        extraComment:
          typeof o.extraComment === 'string' ? o.extraComment : undefined,
        extraPrompt:
          typeof o.extraPrompt === 'string' ? o.extraPrompt : undefined,
        versionId:
          typeof o.versionId === 'number' && Number.isFinite(o.versionId)
            ? o.versionId
            : undefined,
        fileId:
          typeof o.fileId === 'number' && Number.isFinite(o.fileId)
            ? o.fileId
            : undefined,
        fileName: typeof o.fileName === 'string' ? o.fileName : undefined,
      });
    },
  );

  ipcMain.handle(IPC.loraDownloadCategoriesList, async (_e, opts: unknown) => {
    const includeWildcardFiles =
      !!opts &&
      typeof opts === 'object' &&
      (opts as { includeWildcardFiles?: unknown }).includeWildcardFiles === true;
    return listLoraDownloadCategories({ includeWildcardFiles });
  });

  ipcMain.handle(IPC.loraDownloadCategoriesCreate, async (_e, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid input');
    const o = input as Record<string, unknown>;
    return createLoraDownloadCategory({
      name: typeof o.name === 'string' ? o.name : '',
      folder: typeof o.folder === 'string' ? o.folder : '',
      wildcardRelativePath:
        typeof o.wildcardRelativePath === 'string' ? o.wildcardRelativePath : '',
      defaultWeights:
        typeof o.defaultWeights === 'string' ? o.defaultWeights : undefined,
    });
  });

  ipcMain.handle(
    IPC.loraDownloadCategoriesUpdate,
    async (_e, id: unknown, input: unknown) => {
      if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid id');
      if (!input || typeof input !== 'object') throw new Error('Invalid input');
      const o = input as Record<string, unknown>;
      return updateLoraDownloadCategory(id.trim(), {
        name: typeof o.name === 'string' ? o.name : '',
        folder: typeof o.folder === 'string' ? o.folder : '',
        wildcardRelativePath:
          typeof o.wildcardRelativePath === 'string'
            ? o.wildcardRelativePath
            : '',
        defaultWeights:
          typeof o.defaultWeights === 'string' ? o.defaultWeights : undefined,
      });
    },
  );

  ipcMain.handle(IPC.loraDownloadCategoriesDelete, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid id');
    return deleteLoraDownloadCategory(id.trim());
  });

  ipcMain.handle(IPC.loraDownloadCategoriesPickFolder, async () => {
    const loraRoot = loadSettings().loraFolder;
    if (!loraRoot) throw new Error('No LoRA folder configured');
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select LoRA category folder',
      properties: ['openDirectory'],
      defaultPath: loraRoot,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const picked = result.filePaths[0]!;
    const relative = relativeFolderUnderRoot(loraRoot, picked);
    if (!relative) {
      throw new Error(
        'Choose a folder inside the LoRA root (not the root itself).',
      );
    }
    return relative;
  });

  ipcMain.handle(
    IPC.civitaiOpenModelPage,
    async (_e, modelId: unknown, modelName: unknown) => {
      if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
        throw new Error('Invalid model id');
      }
      const name = typeof modelName === 'string' ? modelName : String(modelId);
      const url = civitaiModelPageUrl(getCivitaiOrigin(), modelId, name);
      await shell.openExternal(url);
    },
  );

  ipcMain.handle(IPC.civitaiCachePreview, async (_e, url: unknown) => {
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('Invalid preview url');
    }
    // All renderer cache requests join the single preview worker queue.
    return requestCachedPreview(url.trim());
  });

  ipcMain.handle(IPC.civitaiWarmPreviews, async (_e, urls: unknown) => {
    if (!Array.isArray(urls)) throw new Error('Invalid preview urls');
    const list = urls.filter((u): u is string => typeof u === 'string');
    startCivitaiPreviewWarm(list);
  });

  ipcMain.handle(IPC.civitaiPrioritizePreviews, async (_e, params: unknown) => {
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid preview priority params');
    }
    const p = params as Record<string, unknown>;
    const parseTargets = (raw: unknown) => {
      if (!Array.isArray(raw)) return [];
      const out: Array<string | { url: string; modelId?: number }> = [];
      for (const item of raw) {
        if (typeof item === 'string') {
          out.push(item);
          continue;
        }
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        if (typeof rec.url !== 'string') continue;
        out.push({
          url: rec.url,
          modelId:
            typeof rec.modelId === 'number' && Number.isFinite(rec.modelId)
              ? rec.modelId
              : undefined,
        });
      }
      return out;
    };
    prioritizePreviewUrls({
      visible: parseTargets(p.visible),
      prefetch: parseTargets(p.prefetch),
    });
  });

  ipcMain.handle(
    IPC.civitaiSyncPreviewQueueCategories,
    async (_e, opts: unknown) => {
      const reseedEnabled =
        Boolean(
          opts &&
            typeof opts === 'object' &&
            (opts as { reseedEnabled?: unknown }).reseedEnabled === true,
        );
      const progress = syncPreviewQueueWithEnabledCategories({ reseedEnabled });
      if (reseedEnabled) {
        try {
          prioritizeActiveLibraryPreviews();
        } catch {
          // ignore
        }
      }
      return progress;
    },
  );

  ipcMain.handle(IPC.civitaiGetPreviewDownloadStrip, async () => {
    return getPreviewDownloadStrip();
  });

  ipcMain.handle(IPC.civitaiRefreshPreview, async (_e, url: unknown) => {
    if (typeof url !== 'string' || !url.trim()) {
      throw new Error('Invalid preview url');
    }
    return refreshCivitaiPreview(url.trim());
  });

  ipcMain.handle(IPC.civitaiGetCustomPreview, async (_e, modelId: unknown) => {
    if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
      throw new Error('Invalid model id');
    }
    return getCustomCivitaiPreview(modelId);
  });

  ipcMain.handle(
    IPC.civitaiSetCustomPreviewFromClipboard,
    async (_e, modelId: unknown) => {
      if (typeof modelId !== 'number' || !Number.isFinite(modelId)) {
        throw new Error('Invalid model id');
      }
      return saveCustomCivitaiPreviewFromClipboard(modelId);
    },
  );

  ipcMain.handle(IPC.civitaiOpenBrowser, async () => openCivitaiBrowser());
  ipcMain.handle(IPC.civitaiFocusModelInBrowser, async (_e, raw: unknown) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid focus request');
    }
    const o = raw as Record<string, unknown>;
    if (typeof o.modelId !== 'number' || !Number.isFinite(o.modelId)) {
      throw new Error('Invalid model id');
    }
    if (typeof o.pageUrl !== 'string' || !o.pageUrl.trim()) {
      throw new Error('Invalid page URL');
    }
    return focusModelInCivitaiBrowser({
      modelId: o.modelId,
      pageUrl: o.pageUrl.trim(),
      name: typeof o.name === 'string' ? o.name : undefined,
    });
  });
  ipcMain.handle(IPC.civitaiDetachBrowser, async () => detachCivitaiBrowser());
  ipcMain.handle(IPC.civitaiAttachBrowser, async () => attachCivitaiBrowser());
  ipcMain.handle(IPC.civitaiCloseBrowser, async () => {
    closeCivitaiBrowserWindow();
  });
  ipcMain.handle(IPC.civitaiRevealLocalFile, async (_e, raw: unknown) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid reveal request');
    }
    const o = raw as Record<string, unknown>;
    const type = o.type === 'Checkpoint' ? 'Checkpoint' : 'LORA';
    if (typeof o.relativePath !== 'string' || !o.relativePath.trim()) {
      throw new Error('Invalid relative path');
    }
    revealLocalFileInMainApp({
      type,
      relativePath: o.relativePath.trim().replace(/\\/g, '/'),
    });
  });

  ipcMain.handle(IPC.uiOpenBackupsFolder, async () => {
    const root = getActiveLibrary().wildcardsRoot;
    if (!root?.trim()) {
      throw new Error('Open a wildcards folder first to view backups');
    }
    const directory = wildcardsBackupsDir(root);
    fs.mkdirSync(directory, { recursive: true });
    try {
      await openFolderInMyFileExplorer(directory);
    } catch (error) {
      throw new Error(
        `Could not open backup folder: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  ipcMain.handle(IPC.historyState, async () => historyState());

  ipcMain.handle(IPC.historyUndo, async () => {
    const result = undo();
    return { label: result.entry?.label ?? null, state: result.state };
  });

  ipcMain.handle(IPC.historyRedo, async () => {
    const result = redo();
    return { label: result.entry?.label ?? null, state: result.state };
  });

  ipcMain.handle(IPC.analyzeFile, async (_e, relativePath: unknown) => {
    if (typeof relativePath !== 'string') throw new Error('Invalid path');
    setMainActivityJob('analyze', 'Analyzing wildcards…');
    try {
      return await analyzeFromFile(relativePath);
    } finally {
      setMainActivityJob('analyze', null);
    }
  });

  ipcMain.handle(
    IPC.analyzeContent,
    async (_e, relativePath: unknown, text: unknown) => {
      if (typeof relativePath !== 'string') throw new Error('Invalid path');
      if (typeof text !== 'string') throw new Error('Invalid file contents');
      return analyzeFromContent(relativePath, text);
    },
  );

  ipcMain.handle(
    IPC.analyzeValidateFile,
    async (_e, relativePath: unknown, text: unknown) => {
      if (typeof relativePath !== 'string') throw new Error('Invalid path');
      if (typeof text !== 'string') throw new Error('Invalid file contents');
      return validateFileContent(relativePath, text);
    },
  );

  ipcMain.handle(
    IPC.analyzeRefreshUnusedLoras,
    async (_e, relativePath: unknown, text: unknown) => {
      if (relativePath !== undefined && typeof relativePath !== 'string') {
        throw new Error('Invalid path');
      }
      if (text !== undefined && typeof text !== 'string') {
        throw new Error('Invalid file contents');
      }
      return refreshUnusedLoraIssues(
        typeof relativePath === 'string' ? relativePath : undefined,
        typeof text === 'string' ? text : undefined,
      );
    },
  );

  ipcMain.handle(IPC.analyzeValidateAll, async () => startWildcardValidation());
  ipcMain.handle(IPC.analyzeValidateAllCancel, async () => {
    cancelWildcardValidation();
  });
  ipcMain.handle(IPC.analyzeValidateAllReport, async () =>
    getWildcardValidationReport(),
  );

  ipcMain.handle(IPC.expandPreview, async (_e, request: unknown) => {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid expand request');
    }
    const req = request as {
      source?: unknown;
      relativePath?: unknown;
      relativeFolder?: unknown;
      content?: unknown;
      promptSource?: unknown;
      promptText?: unknown;
      promptFoldersRecursive?: unknown;
      additionalPositivePrompt?: unknown;
      checkpoint?: unknown;
      generationSeed?: unknown;
      mode?: unknown;
      limit?: unknown;
      seed?: unknown;
    };
    const source =
      req.source === 'gen-file' || req.source === 'generation'
        ? req.source
        : 'wildcard';
    if (source === 'wildcard' && typeof req.relativePath !== 'string') {
      throw new Error('Invalid path');
    }
    if (req.mode !== 'exhaustive' && req.mode !== 'random') {
      throw new Error('Invalid expand mode');
    }
    return expandPreview({
      source,
      relativePath:
        typeof req.relativePath === 'string' ? req.relativePath : undefined,
      relativeFolder:
        typeof req.relativeFolder === 'string' ? req.relativeFolder : undefined,
      content: typeof req.content === 'string' ? req.content : undefined,
      promptSource: req.promptSource === 'text' ? 'text' : 'folder',
      promptText: typeof req.promptText === 'string' ? req.promptText : undefined,
      promptFoldersRecursive: req.promptFoldersRecursive === true,
      additionalPositivePrompt:
        typeof req.additionalPositivePrompt === 'string'
          ? req.additionalPositivePrompt
          : undefined,
      checkpoint:
        typeof req.checkpoint === 'string' ? req.checkpoint : undefined,
      generationSeed:
        typeof req.generationSeed === 'number' ? req.generationSeed : undefined,
      mode: req.mode,
      limit: typeof req.limit === 'number' ? req.limit : undefined,
      seed: typeof req.seed === 'number' ? req.seed : undefined,
    });
  });

  ipcMain.handle(IPC.simulateRun, async (_e, request: unknown) => {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid simulate request');
    }
    const req = request as {
      relativePath?: unknown;
      iterations?: unknown;
      seed?: unknown;
    };
    if (typeof req.relativePath !== 'string') throw new Error('Invalid path');
    if (typeof req.iterations !== 'number') throw new Error('Invalid iterations');
    return runSimulation({
      relativePath: req.relativePath,
      iterations: req.iterations,
      seed: typeof req.seed === 'number' ? req.seed : undefined,
    });
  });

  ipcMain.handle(IPC.simulateExportLines, async (_e, request: unknown) => {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid simulate request');
    }
    const req = request as {
      relativePath?: unknown;
      iterations?: unknown;
      seed?: unknown;
    };
    if (typeof req.relativePath !== 'string') throw new Error('Invalid path');
    if (typeof req.iterations !== 'number') throw new Error('Invalid iterations');
    const win = BrowserWindow.getFocusedWindow();
    const stem = req.relativePath
      .replace(/\\/g, '/')
      .replace(/\.(txt|ya?ml|json)$/i, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-');
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Export simulated lines',
      defaultPath: `${stem || 'simulation'}-lines.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (picked.canceled || !picked.filePath) return { saved: false };
    return exportSimulatedLines(
      {
        relativePath: req.relativePath,
        iterations: req.iterations,
        seed: typeof req.seed === 'number' ? req.seed : undefined,
      },
      picked.filePath,
    );
  });

  ipcMain.handle(
    IPC.fileCreate,
    async (_e, relativePath: unknown, text: unknown) => {
      if (typeof relativePath !== 'string') throw new Error('Invalid path');
      return createFile(relativePath, typeof text === 'string' ? text : '');
    },
  );

  ipcMain.handle(
    IPC.fileRename,
    async (_e, relativePath: unknown, newKey: unknown) => {
      if (typeof relativePath !== 'string') throw new Error('Invalid path');
      if (typeof newKey !== 'string') throw new Error('Invalid new name');
      return renameFile(relativePath, newKey);
    },
  );

  ipcMain.handle(IPC.fileDelete, async (_e, relativePath: unknown) => {
    if (typeof relativePath !== 'string') throw new Error('Invalid path');
    return removeFile(relativePath);
  });

  ipcMain.handle(
    IPC.refactorPreviewConsolidate,
    async (_e, relativePath: unknown) => {
      if (typeof relativePath !== 'string') throw new Error('Invalid path');
      return previewConsolidation(relativePath);
    },
  );

  ipcMain.handle(IPC.refactorConsolidate, async (_e, relativePath: unknown) => {
    if (typeof relativePath !== 'string') throw new Error('Invalid path');
    return consolidate(relativePath);
  });

  ipcMain.handle(IPC.refactorPreviewAbsorb, async (_e, relativePath: unknown) => {
    if (typeof relativePath !== 'string') throw new Error('Invalid path');
    return previewAbsorb(relativePath);
  });

  ipcMain.handle(IPC.refactorAbsorb, async (_e, relativePath: unknown) => {
    if (typeof relativePath !== 'string') throw new Error('Invalid path');
    return absorb(relativePath);
  });

  ipcMain.handle(
    IPC.refactorPreviewRename,
    async (_e, relativePath: unknown, newKey: unknown) => {
      if (typeof relativePath !== 'string') throw new Error('Invalid path');
      if (typeof newKey !== 'string') throw new Error('Invalid new name');
      return previewRename(relativePath, newKey);
    },
  );

  ipcMain.handle(
    IPC.refactorPreviewConvertToChild,
    async (_e, relativePath: unknown, childKey: unknown) => {
      if (typeof relativePath !== 'string') throw new Error('Invalid path');
      if (typeof childKey !== 'string') throw new Error('Invalid child name');
      return previewConvertToChild(relativePath, childKey);
    },
  );

  ipcMain.handle(
    IPC.refactorConvertToChild,
    async (_e, relativePath: unknown, childKey: unknown) => {
      if (typeof relativePath !== 'string') throw new Error('Invalid path');
      if (typeof childKey !== 'string') throw new Error('Invalid child name');
      return convertToChild(relativePath, childKey);
    },
  );

  ipcMain.handle(
    IPC.refactorCreateDescendant,
    async (_e, parentRelativePath: unknown, childPath: unknown) => {
      if (typeof parentRelativePath !== 'string') {
        throw new Error('Invalid parent path');
      }
      if (typeof childPath !== 'string') throw new Error('Invalid child path');
      return createDescendant(parentRelativePath, childPath);
    },
  );

  ipcMain.handle(
    IPC.refactorCleanupMissing,
    async (_e, referenceName: unknown) => {
      if (typeof referenceName !== 'string') {
        throw new Error('Invalid reference name');
      }
      return cleanupMissingReference(referenceName);
    },
  );

  ipcMain.handle(
    IPC.refactorPreviewCycle,
    async (_e, rootRelativePath: unknown, issue: unknown) => {
      if (typeof rootRelativePath !== 'string') {
        throw new Error('Invalid root path');
      }
      if (!issue || typeof issue !== 'object') {
        throw new Error('Invalid cycle issue');
      }
      const seed = issue as {
        nodeId?: unknown;
        line?: unknown;
        column?: unknown;
        snippet?: unknown;
        message?: unknown;
      };
      return previewCycleFix(rootRelativePath, {
        nodeId: typeof seed.nodeId === 'string' ? seed.nodeId : undefined,
        line: typeof seed.line === 'number' ? seed.line : undefined,
        column: typeof seed.column === 'number' ? seed.column : undefined,
        snippet: typeof seed.snippet === 'string' ? seed.snippet : undefined,
        message: typeof seed.message === 'string' ? seed.message : undefined,
      });
    },
  );

  ipcMain.handle(IPC.refactorApplyCycleFix, async (_e, request: unknown) => {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid cycle fix request');
    }
    const req = request as {
      relativePath?: unknown;
      line?: unknown;
      column?: unknown;
      snippet?: unknown;
    };
    if (typeof req.relativePath !== 'string') {
      throw new Error('Invalid path');
    }
    if (typeof req.line !== 'number') throw new Error('Invalid line');
    if (typeof req.snippet !== 'string') throw new Error('Invalid snippet');
    return applyCycleFix({
      relativePath: req.relativePath,
      line: req.line,
      column: typeof req.column === 'number' ? req.column : undefined,
      snippet: req.snippet,
    });
  });

  ipcMain.handle(IPC.promptsListTree, async () => listPromptTree());
  ipcMain.handle(IPC.promptsReadGen, async (_e, relativeFolder: unknown) => {
    if (typeof relativeFolder !== 'string') {
      throw new Error('Invalid prompts folder');
    }
    return readGenFile(relativeFolder);
  });
  ipcMain.handle(
    IPC.promptsWriteGen,
    async (_e, relativeFolder: unknown, content: unknown) => {
      if (typeof relativeFolder !== 'string') {
        throw new Error('Invalid prompts folder');
      }
      if (typeof content !== 'string') throw new Error('Invalid gen content');
      return writeGenFile(relativeFolder, content);
    },
  );
  ipcMain.handle(IPC.promptsCreateGen, async (_e, relativeFolder: unknown) => {
    if (typeof relativeFolder !== 'string') {
      throw new Error('Invalid prompts folder');
    }
    return createGenFile(relativeFolder);
  });
  ipcMain.handle(
    IPC.promptsCreateFolder,
    async (_e, parentRelativeFolder: unknown) => {
      if (typeof parentRelativeFolder !== 'string') {
        throw new Error('Invalid prompts folder');
      }
      return createPromptSubfolder(parentRelativeFolder);
    },
  );
  ipcMain.handle(
    IPC.promptsRenameFolder,
    async (_e, relativeFolder: unknown, newName: unknown) => {
      if (typeof relativeFolder !== 'string') {
        throw new Error('Invalid prompts folder');
      }
      if (typeof newName !== 'string') throw new Error('Invalid folder name');
      return renamePromptFolder(relativeFolder, newName);
    },
  );
  ipcMain.handle(
    IPC.promptsDeleteFolder,
    async (_e, relativeFolder: unknown) => {
      if (typeof relativeFolder !== 'string' || !relativeFolder.trim()) {
        throw new Error('Invalid prompts folder');
      }
      const rel = relativeFolder.trim().replaceAll('\\', '/');
      const win = BrowserWindow.getFocusedWindow();
      const { response } = await dialog.showMessageBox(win ?? undefined!, {
        type: 'warning',
        buttons: ['Cancel', 'Delete folder'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: 'Delete prompt folder',
        message: `Permanently delete “${rel}”?`,
        detail:
          'This deletes the folder and everything inside it — !gen.txt, images, and all subfolders. This cannot be undone.',
      });
      if (response !== 1) return { deleted: false as const };
      deletePromptFolder(rel);
      return { deleted: true as const };
    },
  );
  ipcMain.handle(
    IPC.promptsLoadGenPrompts,
    async (_e, relativeFolder: unknown) => {
      if (typeof relativeFolder !== 'string') {
        throw new Error('Invalid prompts folder');
      }
      return loadGenPrompts(relativeFolder);
    },
  );
  ipcMain.handle(
    IPC.promptsListSamples,
    async (_e, relativeFolder: unknown, limit: unknown, seed: unknown) => {
      if (typeof relativeFolder !== 'string') {
        throw new Error('Invalid prompts folder');
      }
      return listSampleImages(
        relativeFolder,
        typeof limit === 'number' ? limit : 12,
        typeof seed === 'number' ? seed : undefined,
      );
    },
  );
  ipcMain.handle(IPC.promptsValidateAll, async () => validateAllGenPrompts());
  ipcMain.handle(
    IPC.promptsValidateFolder,
    async (_e, relativeFolder: unknown) => {
      if (typeof relativeFolder !== 'string') {
        throw new Error('Invalid prompts folder');
      }
      return validateOneGenPrompt(relativeFolder);
    },
  );
  ipcMain.handle(IPC.promptsValidateText, async (_e, text: unknown) => {
    if (typeof text !== 'string') throw new Error('Invalid prompt text');
    return validateGenPromptText(text);
  });
  ipcMain.handle(IPC.promptsCoverageStart, async (_e, request: unknown) => {
    const body =
      request && typeof request === 'object'
        ? (request as { iterations?: number; seed?: number })
        : {};
    return startPromptCoverage({
      ...(typeof body.iterations === 'number'
        ? { iterations: body.iterations }
        : {}),
      ...(typeof body.seed === 'number' ? { seed: body.seed } : {}),
    });
  });
  ipcMain.handle(IPC.promptsCoverageCancel, async () => {
    cancelPromptCoverage();
  });
  ipcMain.handle(IPC.promptsCoverageReport, async () =>
    getPromptCoverageReport(),
  );
  ipcMain.handle(IPC.promptsCoverageProgressGet, async () =>
    getPromptCoverageProgress(),
  );
  ipcMain.handle(IPC.promptsCoverageReveal, async () =>
    revealPromptCoverageReport(),
  );
  ipcMain.handle(IPC.promptsCoverageRefreshNever, async () =>
    refreshPromptCoverageNeverUsedReport(),
  );
  ipcMain.handle(IPC.promptsCoveragePatchIgnore, async (_e, patch: unknown) => {
    if (!patch || typeof patch !== 'object') {
      throw new Error('Invalid coverage ignore patch');
    }
    const rec = patch as { add?: unknown; remove?: unknown };
    return patchPromptCoverageIgnore({
      add: Array.isArray(rec.add)
        ? rec.add.filter((k): k is string => typeof k === 'string')
        : undefined,
      remove: Array.isArray(rec.remove)
        ? rec.remove.filter((k): k is string => typeof k === 'string')
        : undefined,
    });
  });

  ipcMain.handle(IPC.comfyGetConnection, async () => getComfyConnection());
  ipcMain.handle(IPC.comfySetConnection, async (_e, patch: unknown) => {
    if (!patch || typeof patch !== 'object') {
      throw new Error('Invalid Comfy connection');
    }
    return setComfyConnection(
      patch as Parameters<typeof setComfyConnection>[0],
    );
  });
  ipcMain.handle(IPC.comfyPickGenerationFolder, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const current = getComfyConnection().generationFolder;
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select Generation output folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: current || undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folder = result.filePaths[0] ?? null;
    if (!folder) return null;
    return setComfyConnection({ generationFolder: folder }).generationFolder;
  });
  ipcMain.handle(IPC.comfyPickLaunchPath, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const current = getComfyConnection().launchPath;
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select ComfyUI launch shortcut',
      properties: ['openFile'],
      defaultPath: current || undefined,
      filters: [
        {
          name: 'Launchers',
          extensions: ['bat', 'cmd', 'exe', 'lnk', 'ps1', 'sh'],
        },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const file = result.filePaths[0] ?? null;
    if (!file) return null;
    return setComfyConnection({ launchPath: file }).launchPath;
  });
  ipcMain.handle(IPC.comfyTestConnection, async () => {
    const conn = getComfyConnection();
    const adapter = new ComfyAdapter(conn, {
      apiKey: readComfyApiKey(),
      apiKeyHeader: conn.apiKeyHeader,
    });
    return adapter.testConnection(randomUUID());
  });
  ipcMain.handle(IPC.comfyGetModelCatalog, async () => {
    const conn = getComfyConnection();
    const adapter = new ComfyAdapter(conn, {
      apiKey: readComfyApiKey(),
      apiKeyHeader: conn.apiKeyHeader,
    });
    const catalog = await adapter.getModelCatalog();
    return {
      checkpoints: catalog.checkpoints,
      unets: catalog.unets,
      vaes: catalog.vaes,
      clips: catalog.clips,
      loras: catalog.loras,
      samplers: catalog.samplers,
      schedulers: catalog.schedulers,
      upscalers: catalog.upscalers,
      fetchedAt: catalog.fetchedAt,
    };
  });
  ipcMain.handle(IPC.comfyCheckContract, async (_e, workflow: unknown) => {
    const graph =
      workflow && typeof workflow === 'object'
        ? workflow
        : loadWorkflowProfile()?.workflow;
    if (!graph || !isWorkflowGraph(graph)) {
      const family = getActiveLibrary().generationFamily === 'sdxl' ? 'sdxl' : 'krea2';
      throw new Error(
        family === 'sdxl'
          ? 'Open WildcardManager-ComfyUI-SDXL-Generation-Workflow.json in ComfyUI, then Save Workflow.'
          : 'No workflow available to check',
      );
    }
    const resolved = resolveContract(graph);
    return {
      ok: resolved.requiredMissing.length === 0,
      requiredMissing: resolved.requiredMissing,
      roles: resolved.roles,
      usesContractNodes: resolved.usesContractNodes,
    };
  });
  ipcMain.handle(IPC.comfyGetWorkflowProfile, async () => loadWorkflowProfile());
  ipcMain.handle(IPC.comfySaveWorkflowProfile, async (_e, profile: unknown) => {
    if (!profile || typeof profile !== 'object') {
      throw new Error('Invalid workflow profile');
    }
    const row = profile as {
      workflow?: Record<string, unknown>;
      uiWorkflow?: unknown;
      name?: string;
      notes?: string;
    };
    if (!row.workflow) throw new Error('Workflow graph required');
    return saveWorkflowProfile({
      workflow: row.workflow,
      uiWorkflow: row.uiWorkflow,
      name: row.name,
      notes: row.notes,
    });
  });
  ipcMain.handle(IPC.comfyGenerationStart, async (_e, request: unknown) => {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid generation request');
    }
    void startGeneration(request as GenerationStartRequestDto);
  });
  ipcMain.handle(IPC.comfyGenerationCancel, async () => {
    cancelGeneration();
  });
  ipcMain.handle(IPC.comfyGetGenerationForm, async () =>
    loadGenerationFormWithPreview(),
  );
  ipcMain.handle(IPC.comfySetGenerationForm, async (_e, patch: unknown, libraryId: unknown) => {
    if (!patch || typeof patch !== 'object') {
      throw new Error('Invalid generation form');
    }
    const id = typeof libraryId === 'string' ? libraryId : undefined;
    const saved = saveGenerationForm(
      patch as Parameters<typeof saveGenerationForm>[0],
      id,
    );
    let activeId = '';
    try {
      activeId = getActiveLibraryId();
    } catch {
      activeId = '';
    }
    if (!id || id === activeId) {
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
          win.webContents.send(IPC.comfyGenerationFormChanged, saved);
        } catch {
          // ignore
        }
      }
    }
    return saved;
  });
  ipcMain.handle(IPC.comfyGetCheckpointBenchmarkStatus, async () =>
    getCheckpointBenchmarkStatus(),
  );
  ipcMain.handle(IPC.comfyGetCheckpointBenchmarkResults, async () =>
    getCheckpointBenchmarkResults(),
  );
  ipcMain.handle(IPC.comfyDeleteLastGeneration, async () => {
    const name = lastGenerationOutputBasename();
    if (!name) return { deleted: false as const };
    const win = BrowserWindow.getFocusedWindow();
    const { response } = await dialog.showMessageBox(win ?? undefined!, {
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Delete last generation',
      message: `Delete “${name}”?`,
      detail:
        'Removes the Last output image from the output folder so you do not have to find it by hand.',
    });
    if (response !== 1) return { deleted: false as const };
    const result = await deleteLastGenerationOutput();
    if (result.deleted) clearLastGenerationPreviewProgress();
    return result;
  });
  ipcMain.handle(IPC.comfyRevealLastGeneration, async () => {
    const abs = lastGenerationOutputAbsolutePath();
    if (!abs) throw new Error('No last generation to reveal');
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error('Last generation file is no longer on disk');
    }
    await revealInMyFileExplorer(abs);
  });

  ipcMain.handle(IPC.lmStudioGetConnection, async () => getLmStudioConnection());
  ipcMain.handle(IPC.lmStudioSetConnection, async (_e, patch: unknown) => {
    if (!patch || typeof patch !== 'object') {
      throw new Error('Invalid LM Studio connection');
    }
    return setLmStudioConnection(
      patch as Parameters<typeof setLmStudioConnection>[0],
    );
  });
  ipcMain.handle(IPC.lmStudioTestConnection, async () => testLmStudioConnection());
  ipcMain.handle(IPC.lmStudioListModels, async () => listLmStudioModels());
  ipcMain.handle(IPC.lmStudioAssistWildcard, async (_e, request: unknown) => {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid assist request');
    }
    const row = request as Record<string, unknown>;
    if (typeof row.relativePath !== 'string' || !row.relativePath.trim()) {
      throw new Error('Invalid relative path');
    }
    if (typeof row.currentText !== 'string') {
      throw new Error('Invalid current text');
    }
    const preset = row.preset;
    if (
      preset !== 'review' &&
      preset !== 'find_errors' &&
      preset !== 'add_variations' &&
      preset !== 'polish' &&
      preset !== 'custom'
    ) {
      throw new Error('Invalid assist preset');
    }
    // Propose only — never write the library from this handler.
    return assistWildcardWithLmStudio({
      relativePath: row.relativePath.trim().replaceAll('\\', '/'),
      currentText: row.currentText,
      preset,
      instruction:
        typeof row.instruction === 'string' ? row.instruction : undefined,
      model: typeof row.model === 'string' ? row.model : undefined,
    });
  });

  ipcMain.handle(IPC.lmStudioGetPromptLibrary, async () =>
    getLmStudioPromptLibrary(),
  );
  ipcMain.handle(IPC.lmStudioSetPromptSession, async (_e, session: unknown) => {
    if (!session || typeof session !== 'object') {
      throw new Error('Invalid prompt session');
    }
    return setLmStudioPromptSession(
      session as Parameters<typeof setLmStudioPromptSession>[0],
    );
  });
  ipcMain.handle(IPC.lmStudioUpsertSavedPrompt, async (_e, input: unknown) => {
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid saved prompt');
    }
    const row = input as Record<string, unknown>;
    if (typeof row.name !== 'string') throw new Error('Prompt name required');
    const preset = row.preset;
    if (
      preset !== 'review' &&
      preset !== 'find_errors' &&
      preset !== 'add_variations' &&
      preset !== 'polish' &&
      preset !== 'custom'
    ) {
      throw new Error('Invalid assist preset');
    }
    return upsertLmStudioSavedPrompt({
      id: typeof row.id === 'string' ? row.id : undefined,
      name: row.name,
      preset,
      instruction: typeof row.instruction === 'string' ? row.instruction : '',
    });
  });
  ipcMain.handle(
    IPC.lmStudioRenameSavedPrompt,
    async (_e, id: unknown, name: unknown) => {
      if (typeof id !== 'string' || !id.trim()) {
        throw new Error('Invalid prompt id');
      }
      if (typeof name !== 'string') throw new Error('Prompt name required');
      return renameLmStudioSavedPrompt(id.trim(), name);
    },
  );
  ipcMain.handle(IPC.lmStudioDeleteSavedPrompt, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('Invalid prompt id');
    }
    return deleteLmStudioSavedPrompt(id.trim());
  });

  ipcMain.handle(IPC.watchStart, async () => {
    const root = libraryService.getRoot();
    if (root) folderWatcher.start(root);
  });

  ipcMain.handle(IPC.watchStop, async () => {
    folderWatcher.stop();
  });
}
