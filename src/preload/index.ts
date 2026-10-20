import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type AppUpdateDownloadProgressDto,
  type CivitaiCatalogSyncProgressDto,
  type CivitaiDownloadProgressDto,
  type CivitaiFocusModelDto,
  type DownloadLogEntryDto,
  type WcmDesktopApi,
} from '../shared/contracts.js';
import { localCivitaiPreviewUrl } from '../shared/civitaiPreviewUrl.js';

const api: WcmDesktopApi = {
  library: {
    pickRoot: () => ipcRenderer.invoke(IPC.libraryPickRoot),
    openRoot: (root) => ipcRenderer.invoke(IPC.libraryOpenRoot, root),
    listFiles: () => ipcRenderer.invoke(IPC.libraryListFiles),
    listWildcardKeys: () => ipcRenderer.invoke(IPC.libraryListWildcardKeys),
    getRecent: () => ipcRenderer.invoke(IPC.libraryGetRecent),
    getStartup: () => ipcRenderer.invoke(IPC.libraryGetStartup),
    setLastFile: (relativePath) =>
      ipcRenderer.invoke(IPC.librarySetLastFile, relativePath),
    clearLastFile: () => ipcRenderer.invoke(IPC.libraryClearLastFile),
    readFile: (relativePath) => ipcRenderer.invoke(IPC.libraryReadFile, relativePath),
    openFileExternal: (relativePath) =>
      ipcRenderer.invoke(IPC.libraryOpenFileExternal, relativePath),
    writeFile: (relativePath, text, editSessionId, basedOn) =>
      ipcRenderer.invoke(
        IPC.libraryWriteFile,
        relativePath,
        text,
        editSessionId,
        basedOn,
      ),
    flushFile: (relativePath, text, editSessionId, basedOn) =>
      ipcRenderer.sendSync(
        IPC.libraryFlushFile,
        relativePath,
        text,
        editSessionId,
        basedOn,
      ),
    refStats: () => ipcRenderer.invoke(IPC.libraryRefStats),
    listLibraries: () => ipcRenderer.invoke(IPC.libraryListLibraries),
    getActiveLibrary: () => ipcRenderer.invoke(IPC.libraryGetActive),
    setActiveLibrary: (id) => ipcRenderer.invoke(IPC.librarySetActive, id),
    createLibrary: (input) => ipcRenderer.invoke(IPC.libraryCreate, input),
    updateLibrary: (id, patch) =>
      ipcRenderer.invoke(IPC.libraryUpdate, id, patch),
    deleteLibrary: (id) => ipcRenderer.invoke(IPC.libraryDelete, id),
    pickWildcardsFolder: () =>
      ipcRenderer.invoke(IPC.libraryPickWildcardsFolder),
    suggestPathMigrationPrefix: (libraryId) =>
      ipcRenderer.invoke(IPC.librarySuggestPathMigrationPrefix, libraryId),
    pickPathMigrationPrefix: () =>
      ipcRenderer.invoke(IPC.libraryPickPathMigrationPrefix),
    planPathMigration: (request) =>
      ipcRenderer.invoke(IPC.libraryPlanPathMigration, request),
    applyPathMigration: (request) =>
      ipcRenderer.invoke(IPC.libraryApplyPathMigration, request),
    onMutated: (cb) => {
      const handler = (_event: unknown, payload: import('../shared/contracts').LibraryMutatedDto) =>
        cb(payload);
      ipcRenderer.on(IPC.libraryMutated, handler);
      return () => ipcRenderer.removeListener(IPC.libraryMutated, handler);
    },
  },
  analyze: {
    fromFile: (relativePath) => ipcRenderer.invoke(IPC.analyzeFile, relativePath),
    fromContent: (relativePath, text) =>
      ipcRenderer.invoke(IPC.analyzeContent, relativePath, text),
    validateFile: (relativePath, text) =>
      ipcRenderer.invoke(IPC.analyzeValidateFile, relativePath, text),
    refreshUnusedLoras: (relativePath, text) =>
      ipcRenderer.invoke(
        IPC.analyzeRefreshUnusedLoras,
        relativePath,
        text,
      ),
    validateAll: () => ipcRenderer.invoke(IPC.analyzeValidateAll),
    cancelValidateAll: () => ipcRenderer.invoke(IPC.analyzeValidateAllCancel),
    getValidationReport: () =>
      ipcRenderer.invoke(IPC.analyzeValidateAllReport),
    onValidateAllProgress: (cb) => {
      const handler = (
        _event: unknown,
        progress: import('../shared/contracts').WildcardValidationProgressDto,
      ) => cb(progress);
      ipcRenderer.on(IPC.analyzeValidateAllProgress, handler);
      return () =>
        ipcRenderer.removeListener(IPC.analyzeValidateAllProgress, handler);
    },
  },
  file: {
    create: (relativePath, text) =>
      ipcRenderer.invoke(IPC.fileCreate, relativePath, text ?? ''),
    rename: (relativePath, newKey) =>
      ipcRenderer.invoke(IPC.fileRename, relativePath, newKey),
    delete: (relativePath) => ipcRenderer.invoke(IPC.fileDelete, relativePath),
  },
  expand: {
    preview: (request) => ipcRenderer.invoke(IPC.expandPreview, request),
  },
  simulate: {
    run: (request) => ipcRenderer.invoke(IPC.simulateRun, request),
    exportLines: (request) =>
      ipcRenderer.invoke(IPC.simulateExportLines, request),
  },
  refactor: {
    previewConsolidate: (relativePath) =>
      ipcRenderer.invoke(IPC.refactorPreviewConsolidate, relativePath),
    consolidate: (relativePath) =>
      ipcRenderer.invoke(IPC.refactorConsolidate, relativePath),
    previewAbsorb: (relativePath) =>
      ipcRenderer.invoke(IPC.refactorPreviewAbsorb, relativePath),
    absorb: (relativePath) =>
      ipcRenderer.invoke(IPC.refactorAbsorb, relativePath),
    previewRename: (relativePath, newKey) =>
      ipcRenderer.invoke(IPC.refactorPreviewRename, relativePath, newKey),
    previewConvertToChild: (relativePath, childKey) =>
      ipcRenderer.invoke(
        IPC.refactorPreviewConvertToChild,
        relativePath,
        childKey,
      ),
    convertToChild: (relativePath, childKey) =>
      ipcRenderer.invoke(IPC.refactorConvertToChild, relativePath, childKey),
    createDescendant: (parentRelativePath, childPath) =>
      ipcRenderer.invoke(
        IPC.refactorCreateDescendant,
        parentRelativePath,
        childPath,
      ),
    cleanupMissing: (referenceName) =>
      ipcRenderer.invoke(IPC.refactorCleanupMissing, referenceName),
    previewCycle: (rootRelativePath, issue) =>
      ipcRenderer.invoke(IPC.refactorPreviewCycle, rootRelativePath, issue),
    applyCycleFix: (request) =>
      ipcRenderer.invoke(IPC.refactorApplyCycleFix, request),
  },
  history: {
    state: () => ipcRenderer.invoke(IPC.historyState),
    undo: () => ipcRenderer.invoke(IPC.historyUndo),
    redo: () => ipcRenderer.invoke(IPC.historyRedo),
  },
  ui: {
    getSettings: () => ipcRenderer.invoke(IPC.uiGetSettings),
    setDetailsPanelWidth: (tab, width) =>
      ipcRenderer.invoke(IPC.uiSetDetailsPanelWidth, tab, width),
    setFilesPanelWidth: (tab, width) =>
      ipcRenderer.invoke(IPC.uiSetFilesPanelWidth, tab, width),
    setPromptsSamplesCollapsed: (collapsed) =>
      ipcRenderer.invoke(IPC.uiSetPromptsSamplesCollapsed, collapsed),
    setGenerationPreviewCollapsed: (collapsed) =>
      ipcRenderer.invoke(IPC.uiSetGenerationPreviewCollapsed, collapsed),
    setGenerationPromptBoxHeights: (patch) =>
      ipcRenderer.invoke(IPC.uiSetGenerationPromptBoxHeights, patch),
    setPromptCoverageWindow: (state) =>
      ipcRenderer.invoke(IPC.uiSetPromptCoverageWindow, state),
    setPromptSubstitutionsWindow: (state) =>
      ipcRenderer.invoke(IPC.uiSetPromptSubstitutionsWindow, state),
    setBenchmarkResultsWindow: (state) =>
      ipcRenderer.invoke(IPC.uiSetBenchmarkResultsWindow, state),
    setBenchmarkResultsView: (view) =>
      ipcRenderer.invoke(IPC.uiSetBenchmarkResultsView, view),
    setSimulationSettings: (iterations, seed) =>
      ipcRenderer.invoke(IPC.uiSetSimulationSettings, iterations, seed),
    setGraphLayoutStyle: (style) =>
      ipcRenderer.invoke(IPC.uiSetGraphLayoutStyle, style),
    setWorkspaceListFilter: (tab, filter) =>
      ipcRenderer.invoke(IPC.uiSetWorkspaceListFilter, tab, filter),
    setConvertChildSuffix: (suffix) =>
      ipcRenderer.invoke(IPC.uiSetConvertChildSuffix, suffix),
    openSettingsFolder: () =>
      ipcRenderer.invoke(IPC.uiOpenSettingsFolder),
    openBackupsFolder: () =>
      ipcRenderer.invoke(IPC.uiOpenBackupsFolder),
    getUpdateReleaseFolder: () =>
      ipcRenderer.invoke(IPC.uiGetUpdateReleaseFolder),
    pickUpdateReleaseFolder: () =>
      ipcRenderer.invoke(IPC.uiPickUpdateReleaseFolder),
    setUpdateReleaseFolder: (folder) =>
      ipcRenderer.invoke(IPC.uiSetUpdateReleaseFolder, folder),
    clearUpdateReleaseFolder: () =>
      ipcRenderer.invoke(IPC.uiClearUpdateReleaseFolder),
    checkForAppUpdate: () => ipcRenderer.invoke(IPC.uiCheckForAppUpdate),
    installAppUpdate: () => ipcRenderer.invoke(IPC.uiInstallAppUpdate),
    getAppReleaseNotes: (version) =>
      ipcRenderer.invoke(IPC.uiGetAppReleaseNotes, version),
    onAppUpdateDownloadProgress: (cb) => {
      const handler = (
        _event: unknown,
        progress: AppUpdateDownloadProgressDto,
      ) => cb(progress);
      ipcRenderer.on(IPC.uiAppUpdateDownloadProgress, handler);
      return () =>
        ipcRenderer.removeListener(IPC.uiAppUpdateDownloadProgress, handler);
    },
    getLoraFolder: () => ipcRenderer.invoke(IPC.uiGetLoraFolder),
    pickLoraFolder: () => ipcRenderer.invoke(IPC.uiPickLoraFolder),
    setLoraFolder: (folder) =>
      ipcRenderer.invoke(IPC.uiSetLoraFolder, folder),
    clearLoraFolder: () => ipcRenderer.invoke(IPC.uiClearLoraFolder),
    openLoraFolder: () => ipcRenderer.invoke(IPC.uiOpenLoraFolder),
    getCheckpointFolder: () => ipcRenderer.invoke(IPC.uiGetCheckpointFolder),
    pickCheckpointFolder: () =>
      ipcRenderer.invoke(IPC.uiPickCheckpointFolder),
    setCheckpointFolder: (folder) =>
      ipcRenderer.invoke(IPC.uiSetCheckpointFolder, folder),
    clearCheckpointFolder: () =>
      ipcRenderer.invoke(IPC.uiClearCheckpointFolder),
    openCheckpointFolder: () =>
      ipcRenderer.invoke(IPC.uiOpenCheckpointFolder),
    getImagesFolder: () => ipcRenderer.invoke(IPC.uiGetImagesFolder),
    pickImagesFolder: () => ipcRenderer.invoke(IPC.uiPickImagesFolder),
    setImagesFolder: (folder) =>
      ipcRenderer.invoke(IPC.uiSetImagesFolder, folder),
    clearImagesFolder: () => ipcRenderer.invoke(IPC.uiClearImagesFolder),
    openImagesFolder: () => ipcRenderer.invoke(IPC.uiOpenImagesFolder),
    getVideosFolder: () => ipcRenderer.invoke(IPC.uiGetVideosFolder),
    pickVideosFolder: () => ipcRenderer.invoke(IPC.uiPickVideosFolder),
    setVideosFolder: (folder) =>
      ipcRenderer.invoke(IPC.uiSetVideosFolder, folder),
    clearVideosFolder: () => ipcRenderer.invoke(IPC.uiClearVideosFolder),
    openVideosFolder: () => ipcRenderer.invoke(IPC.uiOpenVideosFolder),
    getMastersFolder: () => ipcRenderer.invoke(IPC.uiGetMastersFolder),
    pickMastersFolder: () => ipcRenderer.invoke(IPC.uiPickMastersFolder),
    setMastersFolder: (folder) =>
      ipcRenderer.invoke(IPC.uiSetMastersFolder, folder),
    clearMastersFolder: () => ipcRenderer.invoke(IPC.uiClearMastersFolder),
    openMastersFolder: () => ipcRenderer.invoke(IPC.uiOpenMastersFolder),
    getTrainingLibraryFolder: () =>
      ipcRenderer.invoke(IPC.uiGetTrainingLibraryFolder),
    pickTrainingLibraryFolder: () =>
      ipcRenderer.invoke(IPC.uiPickTrainingLibraryFolder),
    setTrainingLibraryFolder: (folder) =>
      ipcRenderer.invoke(IPC.uiSetTrainingLibraryFolder, folder),
    clearTrainingLibraryFolder: () =>
      ipcRenderer.invoke(IPC.uiClearTrainingLibraryFolder),
    openTrainingLibraryFolder: () =>
      ipcRenderer.invoke(IPC.uiOpenTrainingLibraryFolder),
    getPromptsFolder: () => ipcRenderer.invoke(IPC.uiGetPromptsFolder),
    pickPromptsFolder: () => ipcRenderer.invoke(IPC.uiPickPromptsFolder),
    setPromptsFolder: (folder) =>
      ipcRenderer.invoke(IPC.uiSetPromptsFolder, folder),
    clearPromptsFolder: () => ipcRenderer.invoke(IPC.uiClearPromptsFolder),
    openPromptsFolder: () => ipcRenderer.invoke(IPC.uiOpenPromptsFolder),
    getCivitaiSettings: () => ipcRenderer.invoke(IPC.uiGetCivitaiSettings),
    setCivitaiOrigin: (origin) =>
      ipcRenderer.invoke(IPC.uiSetCivitaiOrigin, origin),
    setCivitaiApiKey: (key) =>
      ipcRenderer.invoke(IPC.uiSetCivitaiApiKey, key),
    setHuggingFaceToken: (token) =>
      ipcRenderer.invoke(IPC.uiSetHuggingFaceToken, token),
    getHuggingFaceTokenStatus: () =>
      ipcRenderer.invoke(IPC.uiGetHuggingFaceTokenStatus),
    setCivitaiCatalogAutoSyncInterval: (minutes) =>
      ipcRenderer.invoke(IPC.uiSetCivitaiCatalogAutoSyncInterval, minutes),
    setDisableHardwareAcceleration: (disable) =>
      ipcRenderer.invoke(IPC.uiSetDisableHardwareAcceleration, disable),
    setGenerationSaveInNewSubfolder: (enabled) =>
      ipcRenderer.invoke(IPC.uiSetGenerationSaveInNewSubfolder, enabled),
    setCivitaiBrowseFilters: (filters) =>
      ipcRenderer.invoke(IPC.uiSetCivitaiBrowseFilters, filters),
    getCivitaiImageBrowseFilters: () =>
      ipcRenderer.invoke(IPC.uiGetCivitaiImageBrowseFilters),
    setCivitaiImageBrowseFilters: (filters) =>
      ipcRenderer.invoke(IPC.uiSetCivitaiImageBrowseFilters, filters),
    getCivitaiVideoBrowseFilters: () =>
      ipcRenderer.invoke(IPC.uiGetCivitaiVideoBrowseFilters),
    setCivitaiVideoBrowseFilters: (filters) =>
      ipcRenderer.invoke(IPC.uiSetCivitaiVideoBrowseFilters, filters),
    setCivitaiSplitRatio: (ratio) =>
      ipcRenderer.invoke(IPC.uiSetCivitaiSplitRatio, ratio),
    setCivitaiCardMinWidth: (px) =>
      ipcRenderer.invoke(IPC.uiSetCivitaiCardMinWidth, px),
    getHfBrowseFilters: () => ipcRenderer.invoke(IPC.uiGetHfBrowseFilters),
    setHfBrowseFilters: (filters) =>
      ipcRenderer.invoke(IPC.uiSetHfBrowseFilters, filters),
    clearHfBrowseFilters: () => ipcRenderer.invoke(IPC.uiClearHfBrowseFilters),
    getPromptSubstitutions: () =>
      ipcRenderer.invoke(IPC.uiGetPromptSubstitutions),
    setPromptSubstitutions: (rules) =>
      ipcRenderer.invoke(IPC.uiSetPromptSubstitutions, rules),
    ignoreUnusedLora: (relativePath) =>
      ipcRenderer.invoke(IPC.uiIgnoreUnusedLora, relativePath),
    categorizeUnusedLora: (opts) =>
      ipcRenderer.invoke(IPC.uiCategorizeUnusedLora, opts),
    extendUnusedLoraSeries: (relativePaths) =>
      ipcRenderer.invoke(IPC.uiExtendUnusedLoraSeries, relativePaths),
    searchLoras: (query) => ipcRenderer.invoke(IPC.uiSearchLoras, query),
    onMainActivity: (cb) => {
      const handler = (
        _event: unknown,
        activity: import('../shared/contracts.js').MainActivityDto,
      ) => cb(activity);
      ipcRenderer.on(IPC.uiMainActivity, handler);
      return () => ipcRenderer.removeListener(IPC.uiMainActivity, handler);
    },
    searchLibrary: (query, scopes) =>
      ipcRenderer.invoke(IPC.uiSearchLibrary, query, scopes),
    previewRenameLora: (sourceName, newBasename) =>
      ipcRenderer.invoke(IPC.uiPreviewRenameLora, sourceName, newBasename),
    renameLora: (sourceName, newBasename) =>
      ipcRenderer.invoke(IPC.uiRenameLora, sourceName, newBasename),
  },
  modelFiles: {
    listLoras: (opts) => ipcRenderer.invoke(IPC.modelFilesListLoras, opts),
    refreshLoraIndexIfStale: (opts) =>
      ipcRenderer.invoke(IPC.modelFilesRefreshLoraIndexIfStale, opts),
    onLoraIndexRefreshed: (cb) => {
      const handler = (
        _event: unknown,
        info: { lastRefreshAt: number },
      ) => cb(info);
      ipcRenderer.on(IPC.modelFilesLoraIndexRefreshed, handler);
      return () =>
        ipcRenderer.removeListener(IPC.modelFilesLoraIndexRefreshed, handler);
    },
    listCheckpoints: (opts) =>
      ipcRenderer.invoke(IPC.modelFilesListCheckpoints, opts),
    getLoraDetail: (relativePath) =>
      ipcRenderer.invoke(IPC.modelFilesGetLoraDetail, relativePath),
    getDefinedLoraReference: (relativePath) =>
      ipcRenderer.invoke(IPC.modelFilesGetDefinedLoraReference, relativePath),
    resolveLoraSeriesDataset: (opts) =>
      ipcRenderer.invoke(IPC.modelFilesResolveLoraSeriesDataset, opts),
    readTrainingLibraryImage: (absolutePath) =>
      ipcRenderer.invoke(IPC.modelFilesReadTrainingLibraryImage, absolutePath),
    inspectLora: (relativePath) =>
      ipcRenderer.invoke(IPC.modelFilesInspectLora, relativePath),
    getCheckpointDetail: (relativePath) =>
      ipcRenderer.invoke(IPC.modelFilesGetCheckpointDetail, relativePath),
    readSidecarImage: (absolutePath) =>
      ipcRenderer.invoke(IPC.modelFilesReadSidecarImage, absolutePath),
    setCivitaiLink: (opts) =>
      ipcRenderer.invoke(IPC.modelFilesSetCivitaiLink, opts),
    clearCivitaiLink: (opts) =>
      ipcRenderer.invoke(IPC.modelFilesClearCivitaiLink, opts),
    setRating: (opts) => ipcRenderer.invoke(IPC.modelFilesSetRating, opts),
    setCheckpointEnabled: (opts) =>
      ipcRenderer.invoke(IPC.modelFilesSetCheckpointEnabled, opts),
    resolveMasterImages: (opts) =>
      ipcRenderer.invoke(IPC.modelFilesResolveMasterImages, opts),
    readMasterImage: (absolutePath) =>
      ipcRenderer.invoke(IPC.modelFilesReadMasterImage, absolutePath),
    deleteCheckpoints: (relativePaths) =>
      ipcRenderer.invoke(IPC.modelFilesDeleteCheckpoints, relativePaths),
    deleteLoras: (relativePaths) =>
      ipcRenderer.invoke(IPC.modelFilesDeleteLoras, relativePaths),
    showInFolder: (absolutePath) =>
      ipcRenderer.invoke(IPC.modelFilesShowInFolder, absolutePath),
    openExternal: (absolutePath) =>
      ipcRenderer.invoke(IPC.modelFilesOpenExternal, absolutePath),
    rematchByHash: (opts) =>
      ipcRenderer.invoke(IPC.modelFilesRematchByHash, opts),
    startPopulate: (opts) =>
      ipcRenderer.invoke(IPC.modelFilesStartPopulate, opts),
    onPopulateProgress: (cb) => {
      const handler = (
        _event: unknown,
        progress: import('../shared/contracts.js').ModelCatalogPopulateProgressDto,
      ) => cb(progress);
      ipcRenderer.on(IPC.modelFilesPopulateProgress, handler);
      return () =>
        ipcRenderer.removeListener(IPC.modelFilesPopulateProgress, handler);
    },
    startLoraPopulate: (opts) =>
      ipcRenderer.invoke(IPC.modelFilesStartPopulate, {
        kind: 'LORA',
        ...(opts ?? {}),
      }),
    onLoraPopulateProgress: (cb) => {
      const handler = (
        _event: unknown,
        progress: import('../shared/contracts.js').ModelCatalogPopulateProgressDto,
      ) => {
        if (progress.kind === 'LORA') cb(progress);
      };
      ipcRenderer.on(IPC.modelFilesPopulateProgress, handler);
      return () =>
        ipcRenderer.removeListener(IPC.modelFilesPopulateProgress, handler);
    },
  },
  huggingface: {
    searchModels: (opts) =>
      ipcRenderer.invoke(IPC.huggingfaceSearchModels, opts),
    openModelPage: (modelId) =>
      ipcRenderer.invoke(IPC.huggingfaceOpenModelPage, modelId),
    openBrowser: () => ipcRenderer.invoke(IPC.huggingfaceOpenBrowser),
    closeBrowser: () => ipcRenderer.invoke(IPC.huggingfaceCloseBrowser),
    getModelDetail: (repoId) =>
      ipcRenderer.invoke(IPC.huggingfaceGetModelDetail, repoId),
    archiveModel: (repoId) =>
      ipcRenderer.invoke(IPC.huggingfaceArchiveModel, repoId),
    unarchiveModel: (repoId) =>
      ipcRenderer.invoke(IPC.huggingfaceUnarchiveModel, repoId),
    listArchived: () => ipcRenderer.invoke(IPC.huggingfaceListArchived),
    listDownloaded: () => ipcRenderer.invoke(IPC.huggingfaceListDownloaded),
    forgetDownloaded: (repoId) =>
      ipcRenderer.invoke(IPC.huggingfaceForgetDownloaded, repoId),
    downloadModel: (opts) =>
      ipcRenderer.invoke(IPC.huggingfaceDownloadModel, opts),
    checkDownloadDestination: (opts) =>
      ipcRenderer.invoke(IPC.huggingfaceCheckDownloadDestination, opts),
    listDownloadQueue: () =>
      ipcRenderer.invoke(IPC.huggingfaceDownloadQueueList),
    cancelDownloadJob: (jobId) =>
      ipcRenderer.invoke(IPC.huggingfaceDownloadQueueCancel, jobId),
    pauseDownloadQueue: () =>
      ipcRenderer.invoke(IPC.huggingfaceDownloadQueuePause),
    resumeDownloadQueue: () =>
      ipcRenderer.invoke(IPC.huggingfaceDownloadQueueResume),
    onDownloadProgress: (cb) => {
      const handler = (
        _event: unknown,
        progress: import('../shared/contracts.js').HfDownloadProgressDto,
      ) => cb(progress);
      ipcRenderer.on(IPC.huggingfaceDownloadProgress, handler);
      return () =>
        ipcRenderer.removeListener(IPC.huggingfaceDownloadProgress, handler);
    },
    onDownloadQueueChanged: (cb) => {
      const handler = (
        _event: unknown,
        snap: import('../shared/contracts.js').HfDownloadQueueSnapshotDto,
      ) => cb(snap);
      ipcRenderer.on(IPC.huggingfaceDownloadQueueChanged, handler);
      return () =>
        ipcRenderer.removeListener(IPC.huggingfaceDownloadQueueChanged, handler);
    },
  },
  civitai: {
    searchModels: (params) =>
      ipcRenderer.invoke(IPC.civitaiSearchModels, params),
    getCatalogSlice: (params) =>
      ipcRenderer.invoke(IPC.civitaiGetCatalogSlice, params),
    enrichBrowseEarlyAccess: (params) =>
      ipcRenderer.invoke(IPC.civitaiEnrichBrowseEarlyAccess, params),
    syncCatalogSlice: (params) =>
      ipcRenderer.invoke(IPC.civitaiSyncCatalogSlice, params),
    cancelCatalogSync: () => ipcRenderer.invoke(IPC.civitaiCancelCatalogSync),
    onCatalogSyncProgress: (cb) => {
      const handler = (
        _event: unknown,
        progress: CivitaiCatalogSyncProgressDto,
      ) => cb(progress);
      ipcRenderer.on(IPC.civitaiCatalogSyncProgress, handler);
      return () =>
        ipcRenderer.removeListener(IPC.civitaiCatalogSyncProgress, handler);
    },
    onHashWarmProgress: (cb) => {
      const handler = (
        _event: unknown,
        progress: import('../shared/contracts.js').CivitaiHashWarmProgressDto,
      ) => cb(progress);
      ipcRenderer.on(IPC.civitaiHashWarmProgress, handler);
      return () =>
        ipcRenderer.removeListener(IPC.civitaiHashWarmProgress, handler);
    },
    onCatalogAutoV2BackfillProgress: (cb) => {
      const handler = (
        _event: unknown,
        progress: import('../shared/contracts.js').CivitaiCatalogAutoV2BackfillProgressDto,
      ) => cb(progress);
      ipcRenderer.on(IPC.civitaiCatalogAutoV2BackfillProgress, handler);
      return () =>
        ipcRenderer.removeListener(
          IPC.civitaiCatalogAutoV2BackfillProgress,
          handler,
        );
    },
    startVersionHashEnrich: (opts) =>
      ipcRenderer.invoke(IPC.civitaiStartVersionHashEnrich, opts ?? {}),
    onCatalogVersionHashEnrichProgress: (cb) => {
      const handler = (
        _event: unknown,
        progress: import('../shared/contracts.js').CivitaiCatalogVersionHashEnrichProgressDto,
      ) => cb(progress);
      ipcRenderer.on(IPC.civitaiCatalogVersionHashEnrichProgress, handler);
      return () =>
        ipcRenderer.removeListener(
          IPC.civitaiCatalogVersionHashEnrichProgress,
          handler,
        );
    },
    warmPreviews: (urls) => ipcRenderer.invoke(IPC.civitaiWarmPreviews, urls),
    prioritizePreviews: (params) =>
      ipcRenderer.invoke(IPC.civitaiPrioritizePreviews, params),
    syncPreviewQueueCategories: (opts) =>
      ipcRenderer.invoke(IPC.civitaiSyncPreviewQueueCategories, opts),
    onPreviewWarmProgress: (cb) => {
      const handler = (
        _event: unknown,
        progress: import('../shared/contracts.js').CivitaiPreviewWarmProgressDto,
      ) => cb(progress);
      ipcRenderer.on(IPC.civitaiPreviewWarmProgress, handler);
      return () =>
        ipcRenderer.removeListener(IPC.civitaiPreviewWarmProgress, handler);
    },
    getPreviewDownloadStrip: () =>
      ipcRenderer.invoke(IPC.civitaiGetPreviewDownloadStrip),
    getModel: (modelId) => ipcRenderer.invoke(IPC.civitaiGetModel, modelId),
    listModelDownloadOptions: (modelId, opts) =>
      ipcRenderer.invoke(IPC.civitaiListModelDownloadOptions, modelId, opts),
    refreshModelVersionInstalls: (modelId, typeHint) =>
      ipcRenderer.invoke(
        IPC.civitaiRefreshModelVersionInstalls,
        modelId,
        typeHint,
      ),
    archiveModel: (modelId) =>
      ipcRenderer.invoke(IPC.civitaiArchiveModel, modelId),
    archiveModels: (modelIds) =>
      ipcRenderer.invoke(IPC.civitaiArchiveModels, modelIds),
    unarchiveModel: (modelId) =>
      ipcRenderer.invoke(IPC.civitaiUnarchiveModel, modelId),
    listArchived: () => ipcRenderer.invoke(IPC.civitaiListArchived),
    listArchivedCards: () =>
      ipcRenderer.invoke(IPC.civitaiListArchivedCards),
    searchImages: (params) =>
      ipcRenderer.invoke(IPC.civitaiSearchImages, params),
    downloadImage: (params) =>
      ipcRenderer.invoke(IPC.civitaiDownloadImage, params),
    listDownloadedImages: () =>
      ipcRenderer.invoke(IPC.civitaiListDownloadedImages),
    listDownloadedImageIds: () =>
      ipcRenderer.invoke(IPC.civitaiListDownloadedImageIds),
    archiveImage: (imageId) =>
      ipcRenderer.invoke(IPC.civitaiArchiveImage, imageId),
    archiveImages: (imageIds) =>
      ipcRenderer.invoke(IPC.civitaiArchiveImages, imageIds),
    unarchiveImage: (imageId) =>
      ipcRenderer.invoke(IPC.civitaiUnarchiveImage, imageId),
    listArchivedImages: () =>
      ipcRenderer.invoke(IPC.civitaiListArchivedImages),
    openDownloadedImage: (absolutePath) =>
      ipcRenderer.invoke(IPC.civitaiOpenDownloadedImage, absolutePath),
    onImageDownloadProgress: (cb) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        progress: import('../shared/contracts.js').CivitaiImageDownloadProgressDto,
      ) => cb(progress);
      ipcRenderer.on(IPC.civitaiImageDownloadProgress, handler);
      return () =>
        ipcRenderer.removeListener(IPC.civitaiImageDownloadProgress, handler);
    },
    startImageDownloadAll: (params) =>
      ipcRenderer.invoke(IPC.civitaiStartImageDownloadAll, params),
    stopImageDownloadAll: () =>
      ipcRenderer.invoke(IPC.civitaiStopImageDownloadAll),
    getImageDownloadAllStatus: () =>
      ipcRenderer.invoke(IPC.civitaiGetImageDownloadAllStatus),
    onImageDownloadAllProgress: (cb) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        status: import('../shared/contracts.js').CivitaiImageDownloadAllStatusDto,
      ) => cb(status);
      ipcRenderer.on(IPC.civitaiImageDownloadAllProgress, handler);
      return () =>
        ipcRenderer.removeListener(
          IPC.civitaiImageDownloadAllProgress,
          handler,
        );
    },
    evaluateBrowseCatchUp: (request) =>
      ipcRenderer.invoke(IPC.civitaiEvaluateBrowseCatchUp, request),
    noteBrowseResumeCursor: (request) =>
      ipcRenderer.invoke(IPC.civitaiNoteBrowseResumeCursor, request),
    commitBrowseCatchUp: (request) =>
      ipcRenderer.invoke(IPC.civitaiCommitBrowseCatchUp, request),
    searchVideos: (params) =>
      ipcRenderer.invoke(IPC.civitaiSearchVideos, params),
    downloadVideo: (params) =>
      ipcRenderer.invoke(IPC.civitaiDownloadVideo, params),
    listDownloadedVideos: () =>
      ipcRenderer.invoke(IPC.civitaiListDownloadedVideos),
    listDownloadedVideoIds: () =>
      ipcRenderer.invoke(IPC.civitaiListDownloadedVideoIds),
    archiveVideo: (imageId) =>
      ipcRenderer.invoke(IPC.civitaiArchiveVideo, imageId),
    archiveVideos: (imageIds) =>
      ipcRenderer.invoke(IPC.civitaiArchiveVideos, imageIds),
    unarchiveVideo: (imageId) =>
      ipcRenderer.invoke(IPC.civitaiUnarchiveVideo, imageId),
    listArchivedVideos: () =>
      ipcRenderer.invoke(IPC.civitaiListArchivedVideos),
    openDownloadedVideo: (absolutePath) =>
      ipcRenderer.invoke(IPC.civitaiOpenDownloadedVideo, absolutePath),
    onVideoDownloadProgress: (cb) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        progress: import('../shared/contracts.js').CivitaiVideoDownloadProgressDto,
      ) => cb(progress);
      ipcRenderer.on(IPC.civitaiVideoDownloadProgress, handler);
      return () =>
        ipcRenderer.removeListener(IPC.civitaiVideoDownloadProgress, handler);
    },
    startVideoDownloadAll: (params) =>
      ipcRenderer.invoke(IPC.civitaiStartVideoDownloadAll, params),
    stopVideoDownloadAll: () =>
      ipcRenderer.invoke(IPC.civitaiStopVideoDownloadAll),
    getVideoDownloadAllStatus: () =>
      ipcRenderer.invoke(IPC.civitaiGetVideoDownloadAllStatus),
    onVideoDownloadAllProgress: (cb) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        status: import('../shared/contracts.js').CivitaiVideoDownloadAllStatusDto,
      ) => cb(status);
      ipcRenderer.on(IPC.civitaiVideoDownloadAllProgress, handler);
      return () =>
        ipcRenderer.removeListener(
          IPC.civitaiVideoDownloadAllProgress,
          handler,
        );
    },
    maybeModel: (modelId) => ipcRenderer.invoke(IPC.civitaiMaybeModel, modelId),
    unmaybeModel: (modelId) =>
      ipcRenderer.invoke(IPC.civitaiUnmaybeModel, modelId),
    listMaybe: () => ipcRenderer.invoke(IPC.civitaiListMaybe),
    listMaybeCards: () => ipcRenderer.invoke(IPC.civitaiListMaybeCards),
    blockCreator: (username) =>
      ipcRenderer.invoke(IPC.civitaiBlockCreator, username),
    unblockCreator: (username) =>
      ipcRenderer.invoke(IPC.civitaiUnblockCreator, username),
    listBlockedCreators: () =>
      ipcRenderer.invoke(IPC.civitaiListBlockedCreators),
    listInstalledCards: () =>
      ipcRenderer.invoke(IPC.civitaiListInstalledCards),
    listShelfSummaries: () =>
      ipcRenderer.invoke(IPC.civitaiListShelfSummaries),
    markInstalled: (modelId) =>
      ipcRenderer.invoke(IPC.civitaiMarkInstalled, modelId),
    markVersionInstalled: (params) =>
      ipcRenderer.invoke(IPC.civitaiMarkVersionInstalled, params),
    unmarkInstalled: (modelId) =>
      ipcRenderer.invoke(IPC.civitaiUnmarkInstalled, modelId),
    watchModel: (params) => ipcRenderer.invoke(IPC.civitaiWatchModel, params),
    unwatchModel: (modelId) =>
      ipcRenderer.invoke(IPC.civitaiUnwatchModel, modelId),
    listWatchlist: () => ipcRenderer.invoke(IPC.civitaiListWatchlist),
    refreshWatchlist: (opts) =>
      ipcRenderer.invoke(IPC.civitaiRefreshWatchlist, opts),
    listRecentlyUnlocked: () =>
      ipcRenderer.invoke(IPC.civitaiListRecentlyUnlocked),
    dismissRecentlyUnlocked: (modelId) =>
      ipcRenderer.invoke(IPC.civitaiDismissRecentlyUnlocked, modelId),
    downloadModel: (params) =>
      ipcRenderer.invoke(IPC.civitaiDownloadModel, params),
    checkDownloadDestination: (params) =>
      ipcRenderer.invoke(IPC.civitaiCheckDownloadDestination, params),
    listDownloadQueue: () =>
      ipcRenderer.invoke(IPC.civitaiDownloadQueueList),
    cancelDownloadQueueItem: (modelId) =>
      ipcRenderer.invoke(IPC.civitaiDownloadQueueCancel, modelId),
    resumeDownloadQueue: () =>
      ipcRenderer.invoke(IPC.civitaiDownloadQueueResume),
    pauseDownloadQueue: (reason) =>
      ipcRenderer.invoke(IPC.civitaiDownloadQueuePause, reason),
    enterBackgroundDownloads: () =>
      ipcRenderer.invoke(IPC.civitaiEnterBackgroundDownloads),
    moveDownloadQueueItem: (modelId, delta) =>
      ipcRenderer.invoke(IPC.civitaiDownloadQueueMove, modelId, delta),
    reorderDownloadQueue: (orderedModelIds) =>
      ipcRenderer.invoke(IPC.civitaiDownloadQueueReorder, orderedModelIds),
    updateDownloadQueueItem: (modelId, patch) =>
      ipcRenderer.invoke(IPC.civitaiDownloadQueueUpdate, modelId, patch),
    listDownloadCategories: (type) =>
      ipcRenderer.invoke(IPC.civitaiListDownloadCategories, type),
    createDownloadCategory: (type, name) =>
      ipcRenderer.invoke(IPC.civitaiCreateDownloadCategory, type, name),
    listLoraDownloadCategories: (opts) =>
      ipcRenderer.invoke(IPC.loraDownloadCategoriesList, opts),
    createLoraDownloadCategory: (input) =>
      ipcRenderer.invoke(IPC.loraDownloadCategoriesCreate, input),
    updateLoraDownloadCategory: (id, input) =>
      ipcRenderer.invoke(IPC.loraDownloadCategoriesUpdate, id, input),
    deleteLoraDownloadCategory: (id) =>
      ipcRenderer.invoke(IPC.loraDownloadCategoriesDelete, id),
    pickLoraCategoryFolder: () =>
      ipcRenderer.invoke(IPC.loraDownloadCategoriesPickFolder),
    openModelPage: (modelId, modelName) =>
      ipcRenderer.invoke(IPC.civitaiOpenModelPage, modelId, modelName),
    localPreviewUrl: (url) => localCivitaiPreviewUrl(url),
    cachePreview: (url) => ipcRenderer.invoke(IPC.civitaiCachePreview, url),
    refreshPreview: (url) =>
      ipcRenderer.invoke(IPC.civitaiRefreshPreview, url),
    getCustomPreview: (modelId) =>
      ipcRenderer.invoke(IPC.civitaiGetCustomPreview, modelId),
    setCustomPreviewFromClipboard: (modelId) =>
      ipcRenderer.invoke(IPC.civitaiSetCustomPreviewFromClipboard, modelId),
    openBrowser: () => ipcRenderer.invoke(IPC.civitaiOpenBrowser),
    focusModelInBrowser: (model) =>
      ipcRenderer.invoke(IPC.civitaiFocusModelInBrowser, model),
    detachBrowser: () => ipcRenderer.invoke(IPC.civitaiDetachBrowser),
    attachBrowser: () => ipcRenderer.invoke(IPC.civitaiAttachBrowser),
    closeBrowser: () => ipcRenderer.invoke(IPC.civitaiCloseBrowser),
    onOpenAttached: (cb) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.civitaiOpenAttached, handler);
      return () =>
        ipcRenderer.removeListener(IPC.civitaiOpenAttached, handler);
    },
    onFocusModel: (cb) => {
      const handler = (_event: unknown, model: CivitaiFocusModelDto) =>
        cb(model);
      ipcRenderer.on(IPC.civitaiFocusModel, handler);
      return () =>
        ipcRenderer.removeListener(IPC.civitaiFocusModel, handler);
    },
    revealLocalFile: (params) =>
      ipcRenderer.invoke(IPC.civitaiRevealLocalFile, params),
    onRevealLocalFile: (cb) => {
      const handler = (
        _event: unknown,
        params: { type: 'LORA' | 'Checkpoint'; relativePath: string },
      ) => cb(params);
      ipcRenderer.on(IPC.civitaiRevealLocalFile, handler);
      return () =>
        ipcRenderer.removeListener(IPC.civitaiRevealLocalFile, handler);
    },
    onDownloadProgress: (cb) => {
      const handler = (
        _event: unknown,
        progress: CivitaiDownloadProgressDto,
      ) => cb(progress);
      ipcRenderer.on(IPC.civitaiDownloadProgress, handler);
      return () =>
        ipcRenderer.removeListener(IPC.civitaiDownloadProgress, handler);
    },
    listDownloadLog: () => ipcRenderer.invoke(IPC.civitaiDownloadLogList),
    clearDownloadLog: () => ipcRenderer.invoke(IPC.civitaiDownloadLogClear),
    onDownloadLog: (cb) => {
      const handler = (_event: unknown, entry: DownloadLogEntryDto) =>
        cb(entry);
      ipcRenderer.on(IPC.civitaiDownloadLog, handler);
      return () => ipcRenderer.removeListener(IPC.civitaiDownloadLog, handler);
    },
  },
  prompts: {
    listTree: () => ipcRenderer.invoke(IPC.promptsListTree),
    readGen: (relativeFolder) =>
      ipcRenderer.invoke(IPC.promptsReadGen, relativeFolder),
    writeGen: (relativeFolder, content) =>
      ipcRenderer.invoke(IPC.promptsWriteGen, relativeFolder, content),
    createGen: (relativeFolder) =>
      ipcRenderer.invoke(IPC.promptsCreateGen, relativeFolder),
    createFolder: (parentRelativeFolder) =>
      ipcRenderer.invoke(IPC.promptsCreateFolder, parentRelativeFolder),
    renameFolder: (relativeFolder, newName) =>
      ipcRenderer.invoke(IPC.promptsRenameFolder, relativeFolder, newName),
    deleteFolder: (relativeFolder) =>
      ipcRenderer.invoke(IPC.promptsDeleteFolder, relativeFolder),
    loadGenPrompts: (relativeFolder) =>
      ipcRenderer.invoke(IPC.promptsLoadGenPrompts, relativeFolder),
    listSamples: (relativeFolder, limit, seed) =>
      ipcRenderer.invoke(IPC.promptsListSamples, relativeFolder, limit, seed),
    validateAll: () => ipcRenderer.invoke(IPC.promptsValidateAll),
    validateFolder: (relativeFolder) =>
      ipcRenderer.invoke(IPC.promptsValidateFolder, relativeFolder),
    validateText: (text) => ipcRenderer.invoke(IPC.promptsValidateText, text),
    startCoverage: (request) =>
      ipcRenderer.invoke(IPC.promptsCoverageStart, request ?? {}),
    cancelCoverage: () => ipcRenderer.invoke(IPC.promptsCoverageCancel),
    getCoverageReport: () => ipcRenderer.invoke(IPC.promptsCoverageReport),
    getCoverageProgress: () =>
      ipcRenderer.invoke(IPC.promptsCoverageProgressGet),
    revealCoverageReport: () => ipcRenderer.invoke(IPC.promptsCoverageReveal),
    refreshCoverageNeverUsed: () =>
      ipcRenderer.invoke(IPC.promptsCoverageRefreshNever),
    patchCoverageIgnore: (patch) =>
      ipcRenderer.invoke(IPC.promptsCoveragePatchIgnore, patch),
    onCoverageProgress: (cb) => {
      const handler = (
        _event: unknown,
        progress: import('../shared/contracts.js').PromptCoverageProgressDto,
      ) => {
        cb(progress);
      };
      ipcRenderer.on(IPC.promptsCoverageProgress, handler);
      return () =>
        ipcRenderer.removeListener(IPC.promptsCoverageProgress, handler);
    },
  },
  comfy: {
    getConnection: () => ipcRenderer.invoke(IPC.comfyGetConnection),
    setConnection: (patch) =>
      ipcRenderer.invoke(IPC.comfySetConnection, patch),
    pickGenerationFolder: () =>
      ipcRenderer.invoke(IPC.comfyPickGenerationFolder),
    pickLaunchPath: () => ipcRenderer.invoke(IPC.comfyPickLaunchPath),
    testConnection: () => ipcRenderer.invoke(IPC.comfyTestConnection),
    getModelCatalog: () => ipcRenderer.invoke(IPC.comfyGetModelCatalog),
    checkContract: (workflow) =>
      ipcRenderer.invoke(IPC.comfyCheckContract, workflow),
    getWorkflowProfile: () =>
      ipcRenderer.invoke(IPC.comfyGetWorkflowProfile),
    saveWorkflowProfile: (profile) =>
      ipcRenderer.invoke(IPC.comfySaveWorkflowProfile, profile),
    startGeneration: (request) =>
      ipcRenderer.invoke(IPC.comfyGenerationStart, request),
    cancelGeneration: () => ipcRenderer.invoke(IPC.comfyGenerationCancel),
    onGenerationProgress: (cb) => {
      const handler = (
        _event: unknown,
        progress: import('../shared/contracts.js').GenerationProgressDto,
      ) => cb(progress);
      ipcRenderer.on(IPC.comfyGenerationProgress, handler);
      return () =>
        ipcRenderer.removeListener(IPC.comfyGenerationProgress, handler);
    },
    getGenerationForm: () => ipcRenderer.invoke(IPC.comfyGetGenerationForm),
    setGenerationForm: (patch) =>
      ipcRenderer.invoke(IPC.comfySetGenerationForm, patch),
    getCheckpointBenchmarkStatus: () =>
      ipcRenderer.invoke(IPC.comfyGetCheckpointBenchmarkStatus),
    getCheckpointBenchmarkResults: () =>
      ipcRenderer.invoke(IPC.comfyGetCheckpointBenchmarkResults),
    deleteLastGeneration: () =>
      ipcRenderer.invoke(IPC.comfyDeleteLastGeneration),
    revealLastGeneration: () =>
      ipcRenderer.invoke(IPC.comfyRevealLastGeneration),
  },
  lmStudio: {
    getConnection: () => ipcRenderer.invoke(IPC.lmStudioGetConnection),
    setConnection: (patch) =>
      ipcRenderer.invoke(IPC.lmStudioSetConnection, patch),
    testConnection: () => ipcRenderer.invoke(IPC.lmStudioTestConnection),
    listModels: () => ipcRenderer.invoke(IPC.lmStudioListModels),
    assistWildcard: (request) =>
      ipcRenderer.invoke(IPC.lmStudioAssistWildcard, request),
    getPromptLibrary: () => ipcRenderer.invoke(IPC.lmStudioGetPromptLibrary),
    setPromptSession: (session) =>
      ipcRenderer.invoke(IPC.lmStudioSetPromptSession, session),
    upsertSavedPrompt: (input) =>
      ipcRenderer.invoke(IPC.lmStudioUpsertSavedPrompt, input),
    renameSavedPrompt: (id, name) =>
      ipcRenderer.invoke(IPC.lmStudioRenameSavedPrompt, id, name),
    deleteSavedPrompt: (id) =>
      ipcRenderer.invoke(IPC.lmStudioDeleteSavedPrompt, id),
  },
  watch: {
    start: () => ipcRenderer.invoke(IPC.watchStart),
    stop: () => ipcRenderer.invoke(IPC.watchStop),
    onChanged: (cb) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.watchChanged, handler);
      return () => ipcRenderer.removeListener(IPC.watchChanged, handler);
    },
  },
};

contextBridge.exposeInMainWorld('wcm', api);
