/** IPC channel names — keep namespaced and stable. */
export const IPC = {
  libraryPickRoot: 'wcm:library:pickRoot',
  libraryOpenRoot: 'wcm:library:openRoot',
  libraryListFiles: 'wcm:library:listFiles',
  libraryListWildcardKeys: 'wcm:library:listWildcardKeys',
  libraryGetRecent: 'wcm:library:getRecent',
  libraryGetStartup: 'wcm:library:getStartup',
  librarySetLastFile: 'wcm:library:setLastFile',
  libraryClearLastFile: 'wcm:library:clearLastFile',
  libraryReadFile: 'wcm:library:readFile',
  libraryOpenFileExternal: 'wcm:library:openFileExternal',
  libraryWriteFile: 'wcm:library:writeFile',
  libraryFlushFile: 'wcm:library:flushFile',
  libraryRefStats: 'wcm:library:refStats',
  analyzeFile: 'wcm:analyze:file',
  analyzeContent: 'wcm:analyze:content',
  analyzeValidateFile: 'wcm:analyze:validateFile',
  analyzeRefreshUnusedLoras: 'wcm:analyze:refreshUnusedLoras',
  analyzeValidateAll: 'wcm:analyze:validateAll',
  analyzeValidateAllCancel: 'wcm:analyze:validateAllCancel',
  analyzeValidateAllReport: 'wcm:analyze:validateAllReport',
  analyzeValidateAllProgress: 'wcm:analyze:validateAllProgress',
  expandPreview: 'wcm:expand:preview',
  simulateRun: 'wcm:simulate:run',
  simulateExportLines: 'wcm:simulate:exportLines',
  fileCreate: 'wcm:file:create',
  fileRename: 'wcm:file:rename',
  fileDelete: 'wcm:file:delete',
  refactorPreviewConsolidate: 'wcm:refactor:previewConsolidate',
  refactorConsolidate: 'wcm:refactor:consolidate',
  refactorPreviewAbsorb: 'wcm:refactor:previewAbsorb',
  refactorAbsorb: 'wcm:refactor:absorb',
  refactorPreviewRename: 'wcm:refactor:previewRename',
  refactorPreviewConvertToChild: 'wcm:refactor:previewConvertToChild',
  refactorConvertToChild: 'wcm:refactor:convertToChild',
  refactorCreateDescendant: 'wcm:refactor:createDescendant',
  refactorCleanupMissing: 'wcm:refactor:cleanupMissing',
  refactorPreviewCycle: 'wcm:refactor:previewCycle',
  refactorApplyCycleFix: 'wcm:refactor:applyCycleFix',
  historyState: 'wcm:history:state',
  historyUndo: 'wcm:history:undo',
  historyRedo: 'wcm:history:redo',
  uiGetSettings: 'wcm:ui:getSettings',
  uiSetDetailsPanelWidth: 'wcm:ui:setDetailsPanelWidth',
  uiSetFilesPanelWidth: 'wcm:ui:setFilesPanelWidth',
  uiSetPromptsSamplesCollapsed: 'wcm:ui:setPromptsSamplesCollapsed',
  uiSetGenerationPreviewCollapsed: 'wcm:ui:setGenerationPreviewCollapsed',
  uiSetGenerationPromptBoxHeights: 'wcm:ui:setGenerationPromptBoxHeights',
  uiSetPromptCoverageWindow: 'wcm:ui:setPromptCoverageWindow',
  uiSetPromptSubstitutionsWindow: 'wcm:ui:setPromptSubstitutionsWindow',
  uiSetBenchmarkResultsWindow: 'wcm:ui:setBenchmarkResultsWindow',
  uiSetBenchmarkResultsView: 'wcm:ui:setBenchmarkResultsView',
  uiSetSimulationSettings: 'wcm:ui:setSimulationSettings',
  uiSetGraphLayoutStyle: 'wcm:ui:setGraphLayoutStyle',
  uiSetWorkspaceListFilter: 'wcm:ui:setWorkspaceListFilter',
  uiSetConvertChildSuffix: 'wcm:ui:setConvertChildSuffix',
  uiOpenSettingsFolder: 'wcm:ui:openSettingsFolder',
  uiOpenBackupsFolder: 'wcm:ui:openBackupsFolder',
  uiGetUpdateReleaseFolder: 'wcm:ui:getUpdateReleaseFolder',
  uiPickUpdateReleaseFolder: 'wcm:ui:pickUpdateReleaseFolder',
  uiSetUpdateReleaseFolder: 'wcm:ui:setUpdateReleaseFolder',
  uiClearUpdateReleaseFolder: 'wcm:ui:clearUpdateReleaseFolder',
  uiCheckForAppUpdate: 'wcm:ui:checkForAppUpdate',
  uiInstallAppUpdate: 'wcm:ui:installAppUpdate',
  uiGetLoraFolder: 'wcm:ui:getLoraFolder',
  uiPickLoraFolder: 'wcm:ui:pickLoraFolder',
  uiSetLoraFolder: 'wcm:ui:setLoraFolder',
  uiClearLoraFolder: 'wcm:ui:clearLoraFolder',
  uiOpenLoraFolder: 'wcm:ui:openLoraFolder',
  uiGetPromptSubstitutions: 'wcm:ui:getPromptSubstitutions',
  uiSetPromptSubstitutions: 'wcm:ui:setPromptSubstitutions',
  uiIgnoreUnusedLora: 'wcm:ui:ignoreUnusedLora',
  uiCategorizeUnusedLora: 'wcm:ui:categorizeUnusedLora',
  uiExtendUnusedLoraSeries: 'wcm:ui:extendUnusedLoraSeries',
  uiSearchLoras: 'wcm:ui:searchLoras',
  uiSearchLibrary: 'wcm:ui:searchLibrary',
  uiPreviewRenameLora: 'wcm:ui:previewRenameLora',
  uiRenameLora: 'wcm:ui:renameLora',
  libraryListLibraries: 'wcm:library:listLibraries',
  libraryGetActive: 'wcm:library:getActive',
  librarySetActive: 'wcm:library:setActive',
  libraryCreate: 'wcm:library:create',
  libraryUpdate: 'wcm:library:update',
  libraryDelete: 'wcm:library:delete',
  libraryPickWildcardsFolder: 'wcm:library:pickWildcardsFolder',
  libraryPlanPathMigration: 'wcm:library:planPathMigration',
  libraryApplyPathMigration: 'wcm:library:applyPathMigration',
  librarySuggestPathMigrationPrefix: 'wcm:library:suggestPathMigrationPrefix',
  libraryPickPathMigrationPrefix: 'wcm:library:pickPathMigrationPrefix',
  uiGetCheckpointFolder: 'wcm:ui:getCheckpointFolder',
  uiPickCheckpointFolder: 'wcm:ui:pickCheckpointFolder',
  uiSetCheckpointFolder: 'wcm:ui:setCheckpointFolder',
  uiClearCheckpointFolder: 'wcm:ui:clearCheckpointFolder',
  uiOpenCheckpointFolder: 'wcm:ui:openCheckpointFolder',
  uiGetImagesFolder: 'wcm:ui:getImagesFolder',
  uiPickImagesFolder: 'wcm:ui:pickImagesFolder',
  uiSetImagesFolder: 'wcm:ui:setImagesFolder',
  uiClearImagesFolder: 'wcm:ui:clearImagesFolder',
  uiOpenImagesFolder: 'wcm:ui:openImagesFolder',
  uiGetVideosFolder: 'wcm:ui:getVideosFolder',
  uiPickVideosFolder: 'wcm:ui:pickVideosFolder',
  uiSetVideosFolder: 'wcm:ui:setVideosFolder',
  uiClearVideosFolder: 'wcm:ui:clearVideosFolder',
  uiOpenVideosFolder: 'wcm:ui:openVideosFolder',
  uiGetMastersFolder: 'wcm:ui:getMastersFolder',
  uiPickMastersFolder: 'wcm:ui:pickMastersFolder',
  uiSetMastersFolder: 'wcm:ui:setMastersFolder',
  uiClearMastersFolder: 'wcm:ui:clearMastersFolder',
  uiOpenMastersFolder: 'wcm:ui:openMastersFolder',
  uiGetTrainingLibraryFolder: 'wcm:ui:getTrainingLibraryFolder',
  uiPickTrainingLibraryFolder: 'wcm:ui:pickTrainingLibraryFolder',
  uiSetTrainingLibraryFolder: 'wcm:ui:setTrainingLibraryFolder',
  uiClearTrainingLibraryFolder: 'wcm:ui:clearTrainingLibraryFolder',
  uiOpenTrainingLibraryFolder: 'wcm:ui:openTrainingLibraryFolder',
  modelFilesResolveLoraSeriesDataset:
    'wcm:modelFiles:resolveLoraSeriesDataset',
  modelFilesReadTrainingLibraryImage:
    'wcm:modelFiles:readTrainingLibraryImage',
  uiGetPromptsFolder: 'wcm:ui:getPromptsFolder',
  uiPickPromptsFolder: 'wcm:ui:pickPromptsFolder',
  uiSetPromptsFolder: 'wcm:ui:setPromptsFolder',
  uiClearPromptsFolder: 'wcm:ui:clearPromptsFolder',
  uiOpenPromptsFolder: 'wcm:ui:openPromptsFolder',
  promptsListTree: 'wcm:prompts:listTree',
  promptsReadGen: 'wcm:prompts:readGen',
  promptsWriteGen: 'wcm:prompts:writeGen',
  promptsCreateGen: 'wcm:prompts:createGen',
  promptsCreateFolder: 'wcm:prompts:createFolder',
  promptsRenameFolder: 'wcm:prompts:renameFolder',
  promptsDeleteFolder: 'wcm:prompts:deleteFolder',
  promptsLoadGenPrompts: 'wcm:prompts:loadGenPrompts',
  promptsListSamples: 'wcm:prompts:listSamples',
  promptsValidateAll: 'wcm:prompts:validateAll',
  promptsValidateFolder: 'wcm:prompts:validateFolder',
  promptsValidateText: 'wcm:prompts:validateText',
  promptsCoverageStart: 'wcm:prompts:coverageStart',
  promptsCoverageCancel: 'wcm:prompts:coverageCancel',
  promptsCoverageReport: 'wcm:prompts:coverageReport',
  promptsCoverageProgressGet: 'wcm:prompts:coverageProgressGet',
  promptsCoverageProgress: 'wcm:prompts:coverageProgress',
  promptsCoverageReveal: 'wcm:prompts:coverageReveal',
  promptsCoverageRefreshNever: 'wcm:prompts:coverageRefreshNever',
  promptsCoveragePatchIgnore: 'wcm:prompts:coveragePatchIgnore',
  comfyGetConnection: 'wcm:comfy:getConnection',
  comfySetConnection: 'wcm:comfy:setConnection',
  comfyPickGenerationFolder: 'wcm:comfy:pickGenerationFolder',
  comfyPickLaunchPath: 'wcm:comfy:pickLaunchPath',
  comfyTestConnection: 'wcm:comfy:testConnection',
  comfyGetModelCatalog: 'wcm:comfy:getModelCatalog',
  comfyCheckContract: 'wcm:comfy:checkContract',
  comfyGetWorkflowProfile: 'wcm:comfy:getWorkflowProfile',
  comfySaveWorkflowProfile: 'wcm:comfy:saveWorkflowProfile',
  comfyGenerationStart: 'wcm:comfy:generationStart',
  comfyGenerationCancel: 'wcm:comfy:generationCancel',
  comfyGenerationProgress: 'wcm:comfy:generationProgress',
  comfyGetGenerationForm: 'wcm:comfy:getGenerationForm',
  comfySetGenerationForm: 'wcm:comfy:setGenerationForm',
  comfyGetCheckpointBenchmarkStatus:
    'wcm:comfy:getCheckpointBenchmarkStatus',
  comfyGetCheckpointBenchmarkResults:
    'wcm:comfy:getCheckpointBenchmarkResults',
  comfyDeleteLastGeneration: 'wcm:comfy:deleteLastGeneration',
  comfyRevealLastGeneration: 'wcm:comfy:revealLastGeneration',
  lmStudioGetConnection: 'wcm:lmStudio:getConnection',
  lmStudioSetConnection: 'wcm:lmStudio:setConnection',
  lmStudioTestConnection: 'wcm:lmStudio:testConnection',
  lmStudioListModels: 'wcm:lmStudio:listModels',
  lmStudioAssistWildcard: 'wcm:lmStudio:assistWildcard',
  lmStudioGetPromptLibrary: 'wcm:lmStudio:getPromptLibrary',
  lmStudioSetPromptSession: 'wcm:lmStudio:setPromptSession',
  lmStudioUpsertSavedPrompt: 'wcm:lmStudio:upsertSavedPrompt',
  lmStudioRenameSavedPrompt: 'wcm:lmStudio:renameSavedPrompt',
  lmStudioDeleteSavedPrompt: 'wcm:lmStudio:deleteSavedPrompt',
  uiGetCivitaiSettings: 'wcm:ui:getCivitaiSettings',
  uiSetCivitaiOrigin: 'wcm:ui:setCivitaiOrigin',
  uiSetCivitaiApiKey: 'wcm:ui:setCivitaiApiKey',
  uiSetCivitaiCatalogAutoSyncInterval:
    'wcm:ui:setCivitaiCatalogAutoSyncInterval',
  uiSetDisableHardwareAcceleration: 'wcm:ui:setDisableHardwareAcceleration',
  uiSetGenerationSaveInNewSubfolder:
    'wcm:ui:setGenerationSaveInNewSubfolder',
  uiSetCivitaiBrowseFilters: 'wcm:ui:setCivitaiBrowseFilters',
  uiGetCivitaiImageBrowseFilters: 'wcm:ui:getCivitaiImageBrowseFilters',
  uiSetCivitaiImageBrowseFilters: 'wcm:ui:setCivitaiImageBrowseFilters',
  uiGetCivitaiVideoBrowseFilters: 'wcm:ui:getCivitaiVideoBrowseFilters',
  uiSetCivitaiVideoBrowseFilters: 'wcm:ui:setCivitaiVideoBrowseFilters',
  uiSetCivitaiSplitRatio: 'wcm:ui:setCivitaiSplitRatio',
  uiSetCivitaiCardMinWidth: 'wcm:ui:setCivitaiCardMinWidth',
  uiGetHfBrowseFilters: 'wcm:ui:getHfBrowseFilters',
  uiSetHfBrowseFilters: 'wcm:ui:setHfBrowseFilters',
  uiClearHfBrowseFilters: 'wcm:ui:clearHfBrowseFilters',
  huggingfaceSearchModels: 'wcm:huggingface:searchModels',
  huggingfaceOpenModelPage: 'wcm:huggingface:openModelPage',
  huggingfaceOpenBrowser: 'wcm:huggingface:openBrowser',
  huggingfaceCloseBrowser: 'wcm:huggingface:closeBrowser',
  huggingfaceGetModelDetail: 'wcm:huggingface:getModelDetail',
  huggingfaceArchiveModel: 'wcm:huggingface:archiveModel',
  huggingfaceUnarchiveModel: 'wcm:huggingface:unarchiveModel',
  huggingfaceListArchived: 'wcm:huggingface:listArchived',
  huggingfaceDownloadModel: 'wcm:huggingface:downloadModel',
  huggingfaceCheckDownloadDestination:
    'wcm:huggingface:checkDownloadDestination',
  huggingfaceDownloadProgress: 'wcm:huggingface:downloadProgress',
  huggingfaceDownloadQueueList: 'wcm:huggingface:downloadQueue:list',
  huggingfaceDownloadQueueCancel: 'wcm:huggingface:downloadQueue:cancel',
  huggingfaceDownloadQueuePause: 'wcm:huggingface:downloadQueue:pause',
  huggingfaceDownloadQueueResume: 'wcm:huggingface:downloadQueue:resume',
  huggingfaceDownloadQueueChanged: 'wcm:huggingface:downloadQueue:changed',
  uiSetHuggingFaceToken: 'wcm:ui:setHuggingFaceToken',
  uiGetHuggingFaceTokenStatus: 'wcm:ui:getHuggingFaceTokenStatus',
  civitaiSearchModels: 'wcm:civitai:searchModels',
  civitaiGetCatalogSlice: 'wcm:civitai:getCatalogSlice',
  civitaiSyncCatalogSlice: 'wcm:civitai:syncCatalogSlice',
  civitaiEnrichBrowseEarlyAccess: 'wcm:civitai:enrichBrowseEarlyAccess',
  civitaiCancelCatalogSync: 'wcm:civitai:cancelCatalogSync',
  civitaiCatalogSyncProgress: 'wcm:civitai:catalogSyncProgress',
  civitaiHashWarmProgress: 'wcm:civitai:hashWarmProgress',
  civitaiCatalogAutoV2BackfillProgress:
    'wcm:civitai:catalogAutoV2BackfillProgress',
  civitaiCatalogVersionHashEnrichProgress:
    'wcm:civitai:catalogVersionHashEnrichProgress',
  civitaiWarmPreviews: 'wcm:civitai:warmPreviews',
  modelFilesListLoras: 'wcm:modelFiles:listLoras',
  modelFilesRefreshLoraIndexIfStale: 'wcm:modelFiles:refreshLoraIndexIfStale',
  modelFilesLoraIndexRefreshed: 'wcm:modelFiles:loraIndexRefreshed',
  modelFilesListCheckpoints: 'wcm:modelFiles:listCheckpoints',
  modelFilesGetLoraDetail: 'wcm:modelFiles:getLoraDetail',
  modelFilesGetDefinedLoraReference: 'wcm:modelFiles:getDefinedLoraReference',
  modelFilesInspectLora: 'wcm:modelFiles:inspectLora',
  modelFilesGetCheckpointDetail: 'wcm:modelFiles:getCheckpointDetail',
  modelFilesReadSidecarImage: 'wcm:modelFiles:readSidecarImage',
  modelFilesSetCivitaiLink: 'wcm:modelFiles:setCivitaiLink',
  modelFilesClearCivitaiLink: 'wcm:modelFiles:clearCivitaiLink',
  modelFilesSetRating: 'wcm:modelFiles:setRating',
  modelFilesSetCheckpointEnabled: 'wcm:modelFiles:setCheckpointEnabled',
  modelFilesResolveMasterImages: 'wcm:modelFiles:resolveMasterImages',
  modelFilesReadMasterImage: 'wcm:modelFiles:readMasterImage',
  modelFilesDeleteCheckpoints: 'wcm:modelFiles:deleteCheckpoints',
  modelFilesDeleteLoras: 'wcm:modelFiles:deleteLoras',
  modelFilesShowInFolder: 'wcm:modelFiles:showInFolder',
  modelFilesOpenExternal: 'wcm:modelFiles:openExternal',
  modelFilesRematchByHash: 'wcm:modelFiles:rematchByHash',
  modelFilesStartLoraPopulate: 'wcm:modelFiles:startLoraPopulate',
  modelFilesLoraPopulateProgress: 'wcm:modelFiles:loraPopulateProgress',
  modelFilesStartPopulate: 'wcm:modelFiles:startPopulate',
  modelFilesPopulateProgress: 'wcm:modelFiles:populateProgress',
  /** Named main-process job for the status bar — never a generic “Working…”. */
  uiMainActivity: 'wcm:ui:mainActivity',
  civitaiStartVersionHashEnrich: 'wcm:civitai:startVersionHashEnrich',
  civitaiPrioritizePreviews: 'wcm:civitai:prioritizePreviews',
  civitaiSyncPreviewQueueCategories: 'wcm:civitai:syncPreviewQueueCategories',
  civitaiPreviewWarmProgress: 'wcm:civitai:previewWarmProgress',
  civitaiGetPreviewDownloadStrip: 'wcm:civitai:getPreviewDownloadStrip',
  civitaiGetModel: 'wcm:civitai:getModel',
  civitaiListModelDownloadOptions: 'wcm:civitai:listModelDownloadOptions',
  civitaiRefreshModelVersionInstalls: 'wcm:civitai:refreshModelVersionInstalls',
  civitaiArchiveModel: 'wcm:civitai:archiveModel',
  civitaiArchiveModels: 'wcm:civitai:archiveModels',
  civitaiUnarchiveModel: 'wcm:civitai:unarchiveModel',
  civitaiListArchived: 'wcm:civitai:listArchived',
  civitaiListArchivedCards: 'wcm:civitai:listArchivedCards',
  civitaiSearchImages: 'wcm:civitai:searchImages',
  civitaiDownloadImage: 'wcm:civitai:downloadImage',
  civitaiListDownloadedImages: 'wcm:civitai:listDownloadedImages',
  civitaiListDownloadedImageIds: 'wcm:civitai:listDownloadedImageIds',
  civitaiArchiveImage: 'wcm:civitai:archiveImage',
  civitaiArchiveImages: 'wcm:civitai:archiveImages',
  civitaiUnarchiveImage: 'wcm:civitai:unarchiveImage',
  civitaiListArchivedImages: 'wcm:civitai:listArchivedImages',
  civitaiOpenDownloadedImage: 'wcm:civitai:openDownloadedImage',
  civitaiImageDownloadProgress: 'wcm:civitai:imageDownloadProgress',
  civitaiStartImageDownloadAll: 'wcm:civitai:startImageDownloadAll',
  civitaiStopImageDownloadAll: 'wcm:civitai:stopImageDownloadAll',
  civitaiGetImageDownloadAllStatus: 'wcm:civitai:getImageDownloadAllStatus',
  civitaiImageDownloadAllProgress: 'wcm:civitai:imageDownloadAllProgress',
  civitaiEvaluateBrowseCatchUp: 'wcm:civitai:evaluateBrowseCatchUp',
  civitaiNoteBrowseResumeCursor: 'wcm:civitai:noteBrowseResumeCursor',
  civitaiCommitBrowseCatchUp: 'wcm:civitai:commitBrowseCatchUp',
  civitaiSearchVideos: 'wcm:civitai:searchVideos',
  civitaiDownloadVideo: 'wcm:civitai:downloadVideo',
  civitaiListDownloadedVideos: 'wcm:civitai:listDownloadedVideos',
  civitaiListDownloadedVideoIds: 'wcm:civitai:listDownloadedVideoIds',
  civitaiArchiveVideo: 'wcm:civitai:archiveVideo',
  civitaiArchiveVideos: 'wcm:civitai:archiveVideos',
  civitaiUnarchiveVideo: 'wcm:civitai:unarchiveVideo',
  civitaiListArchivedVideos: 'wcm:civitai:listArchivedVideos',
  civitaiOpenDownloadedVideo: 'wcm:civitai:openDownloadedVideo',
  civitaiVideoDownloadProgress: 'wcm:civitai:videoDownloadProgress',
  civitaiStartVideoDownloadAll: 'wcm:civitai:startVideoDownloadAll',
  civitaiStopVideoDownloadAll: 'wcm:civitai:stopVideoDownloadAll',
  civitaiGetVideoDownloadAllStatus: 'wcm:civitai:getVideoDownloadAllStatus',
  civitaiVideoDownloadAllProgress: 'wcm:civitai:videoDownloadAllProgress',
  civitaiMaybeModel: 'wcm:civitai:maybeModel',
  civitaiUnmaybeModel: 'wcm:civitai:unmaybeModel',
  civitaiListMaybe: 'wcm:civitai:listMaybe',
  civitaiListMaybeCards: 'wcm:civitai:listMaybeCards',
  civitaiBlockCreator: 'wcm:civitai:blockCreator',
  civitaiUnblockCreator: 'wcm:civitai:unblockCreator',
  civitaiListBlockedCreators: 'wcm:civitai:listBlockedCreators',
  civitaiListInstalledCards: 'wcm:civitai:listInstalledCards',
  civitaiListShelfSummaries: 'wcm:civitai:listShelfSummaries',
  civitaiMarkInstalled: 'wcm:civitai:markInstalled',
  civitaiMarkVersionInstalled: 'wcm:civitai:markVersionInstalled',
  civitaiUnmarkInstalled: 'wcm:civitai:unmarkInstalled',
  civitaiWatchModel: 'wcm:civitai:watchModel',
  civitaiUnwatchModel: 'wcm:civitai:unwatchModel',
  civitaiListWatchlist: 'wcm:civitai:listWatchlist',
  civitaiRefreshWatchlist: 'wcm:civitai:refreshWatchlist',
  civitaiListRecentlyUnlocked: 'wcm:civitai:listRecentlyUnlocked',
  civitaiDismissRecentlyUnlocked: 'wcm:civitai:dismissRecentlyUnlocked',
  civitaiListDownloadCategories: 'wcm:civitai:listDownloadCategories',
  civitaiCreateDownloadCategory: 'wcm:civitai:createDownloadCategory',
  civitaiDownloadModel: 'wcm:civitai:downloadModel',
  civitaiCheckDownloadDestination: 'wcm:civitai:checkDownloadDestination',
  civitaiDownloadProgress: 'wcm:civitai:downloadProgress',
  civitaiDownloadLog: 'wcm:civitai:downloadLog',
  civitaiDownloadLogList: 'wcm:civitai:downloadLog:list',
  civitaiDownloadLogClear: 'wcm:civitai:downloadLog:clear',
  civitaiDownloadQueueList: 'wcm:civitai:downloadQueue:list',
  civitaiDownloadQueueCancel: 'wcm:civitai:downloadQueue:cancel',
  civitaiDownloadQueueResume: 'wcm:civitai:downloadQueue:resume',
  civitaiDownloadQueuePause: 'wcm:civitai:downloadQueue:pause',
  civitaiEnterBackgroundDownloads: 'wcm:civitai:enterBackgroundDownloads',
  civitaiDownloadQueueMove: 'wcm:civitai:downloadQueue:move',
  civitaiDownloadQueueReorder: 'wcm:civitai:downloadQueue:reorder',
  civitaiDownloadQueueUpdate: 'wcm:civitai:downloadQueue:update',
  loraDownloadCategoriesList: 'wcm:loraDownloadCategories:list',
  loraDownloadCategoriesCreate: 'wcm:loraDownloadCategories:create',
  loraDownloadCategoriesUpdate: 'wcm:loraDownloadCategories:update',
  loraDownloadCategoriesDelete: 'wcm:loraDownloadCategories:delete',
  loraDownloadCategoriesPickFolder: 'wcm:loraDownloadCategories:pickFolder',
  civitaiOpenModelPage: 'wcm:civitai:openModelPage',
  civitaiCachePreview: 'wcm:civitai:cachePreview',
  civitaiRefreshPreview: 'wcm:civitai:refreshPreview',
  civitaiGetCustomPreview: 'wcm:civitai:getCustomPreview',
  civitaiSetCustomPreviewFromClipboard: 'wcm:civitai:setCustomPreviewFromClipboard',
  civitaiOpenBrowser: 'wcm:civitai:openBrowser',
  civitaiDetachBrowser: 'wcm:civitai:detachBrowser',
  civitaiAttachBrowser: 'wcm:civitai:attachBrowser',
  civitaiCloseBrowser: 'wcm:civitai:closeBrowser',
  civitaiOpenAttached: 'wcm:civitai:openAttached',
  /**
   * Open/focus the Civitai browser on a specific model (from a comment URL above
   * a `<lora:…>` tag, etc.).
   */
  civitaiFocusModelInBrowser: 'wcm:civitai:focusModelInBrowser',
  /** Push a model focus request to the active Civitai UI (modal or window). */
  civitaiFocusModel: 'wcm:civitai:focusModel',
  /** Focus main app and select a local model file matched from a Civitai card. */
  civitaiRevealLocalFile: 'wcm:civitai:revealLocalFile',
  watchStart: 'wcm:watch:start',
  watchStop: 'wcm:watch:stop',
  watchChanged: 'wcm:watch:changed',
  /** Internal mutation wrote library files — reload open editors (do not flush drafts). */
  libraryMutated: 'wcm:library:mutated',
} as const;

export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCode =
  | 'missing_file'
  | 'cycle'
  | 'unclosed_wildcard'
  | 'unbalanced_brace'
  | 'unbalanced_paren'
  | 'unbalanced_bracket'
  | 'unbalanced_quote'
  | 'bad_multiselect'
  | 'orphan_pipe'
  | 'empty_file'
  | 'read_error'
  | 'glob_no_match'
  | 'structured_parse_error'
  | 'unsupported_structured_value'
  | 'duplicate_structured_key'
  | 'missing_lora'
  | 'invalid_lora'
  | 'unused_lora'
  | 'duplicate_lora_hash'
  | 'unsupported_wildcard_logic';

export type IssueDto = {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  nodeId?: string;
  line?: number;
  column?: number;
  snippet?: string;
  /** Extra navigable paths (e.g. other LoRAs sharing an AutoV2). */
  relatedPaths?: string[];
  /**
   * Suggested one-click fix. `extend_lora_series` = add missing training steps
   * to an existing `<lora:…>` pick list (Categorize / Update reference).
   */
  fixAction?: 'extend_lora_series';
};

/** Per-file slice of a library-wide wildcard validation run. */
export type WildcardValidationFileDto = {
  relativePath: string;
  key: string;
  errorCount: number;
  warningCount: number;
  issues: IssueDto[];
};

/**
 * Stored result of “Validate all wildcards” — node-level issues only
 * (syntax, missing refs from the file, LoRA tags, platform, cycles).
 * Excludes library-wide unused/duplicate LoRA “All issues”.
 */
export type WildcardValidationReportDto = {
  libraryId: string;
  generatedAt: string;
  status: 'done' | 'cancelled' | 'error';
  fileCount: number;
  filesWithIssues: number;
  errorCount: number;
  warningCount: number;
  files: WildcardValidationFileDto[];
};

/** Live status-bar text for a main-process job (folder scan, etc.). */
export type MainActivityDto = {
  label: string | null;
};

export type WildcardValidationProgressDto = {
  status: 'running' | 'done' | 'cancelled' | 'error';
  libraryId: string;
  done: number;
  total: number;
  relativePath?: string;
  error?: string;
  report?: WildcardValidationReportDto;
};

export type GraphNodeKind = 'file' | 'yamlKey' | 'glob' | 'missing' | 'root';

export type GraphNodeDto = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Absolute path when kind is file/yamlKey and resolved. */
  path?: string;
  /** Relative key from library root, e.g. clothing/hats */
  relativeKey?: string;
  /** Physical file key that owns a nested structured node. */
  hostKey?: string;
  depth: number;
  lineCount?: number;
  outboundCount: number;
  inboundCount: number;
  issues: IssueDto[];
  /** Synthetic Level -1 node representing a file that calls the current root. */
  isCaller?: boolean;
};

export type GraphEdgeDto = {
  id: string;
  from: string;
  to: string;
  line: number;
  column?: number;
  snippet: string;
  isCycle: boolean;
  /** Synthetic edge from a Level -1 caller into the current root. */
  isCallerEdge?: boolean;
};

export type FileEntryDto = {
  relativePath: string;
  name: string;
  ext: '.txt' | '.yaml' | '.yml' | '.json';
  /** Stem path without extension, used as wildcard key. */
  key: string;
};

export type LibrarySnapshotDto = {
  root: string;
  files: FileEntryDto[];
  openedAt: string;
};

export type AnalysisResultDto = {
  root: string;
  rootFile: string;
  rootNodeId: string;
  generatedAt: string;
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  issues: IssueDto[];
  stats: {
    fileCount: number;
    nodeCount: number;
    edgeCount: number;
    missingCount: number;
    cycleCount: number;
    errorCount: number;
    warningCount: number;
  };
};

export type FileContentDto = {
  relativePath: string;
  absolutePath: string;
  text: string;
  /** True when `text` is in RAM only — last disk save is `persistedText`. */
  unsaved?: boolean;
  /** Last text written to disk when `unsaved` is true. */
  persistedText?: string;
};

export type FileRefStatDto = {
  key: string;
  /** Distinct other files that reference this file (parents). */
  inbound: number;
  /** Distinct existing files this file references (children). */
  outbound: number;
  /** Syntax/empty/unresolved-reference issues owned by this file. */
  issueCount: number;
  /** Complete `<lora:…>` tags found in this file (ignores comment lines). */
  loraTagCount: number;
};

/** Companion image/JSON next to a LoRA or checkpoint file (same stem). */
export type ModelSidecarDto = {
  imageRelativePath?: string;
  imageAbsolutePath?: string;
  jsonRelativePath?: string;
  jsonAbsolutePath?: string;
  json?: unknown;
  jsonParseError?: string;
};

export type ModelFileManagerEntryDto = {
  relativePath: string;
  stem: string;
  name: string;
  absolutePath: string;
  autoV2?: string;
  sizeBytes?: number;
  mtimeMs?: number;
  sidecar: ModelSidecarDto;
  /**
   * Local user rating: −1 = unrated, otherwise 0.5…5 in half-star steps.
   * Currently used for checkpoints; LoRAs default to −1.
   */
  rating: number;
  /**
   * Checkpoint files: false when this library lists the path in
   * `ignoredCheckpoints` (`library.json`). Unticked checkpoints stay on disk
   * and are left out of this library’s Generation list and Benchmark.
   * Omitted or true means the file is in use here.
   */
  enabled?: boolean;
  /** Wildcard files that reference this LoRA (LoRA manager only). */
  referenceCount?: number;
  unused?: boolean;
  civitaiModelId?: number;
  civitaiName?: string;
  civitaiPageUrl?: string;
  /** Trigger words from the matched catalog version (for LoRA reference snippets). */
  civitaiTrainedWords?: string[];
  /** True when the Civitai link was set manually (not AutoV2 catalog match). */
  civitaiLinkManual?: boolean;
  previewUrl?: string;
  previewLocalUrl?: string | null;
  /**
   * Hero Checkpoint Benchmark sample (`{benchmarkRoot}/{stem}/WCG*`), when any
   * exist. Legacy field name kept for IPC compatibility.
   */
  masterImageAbsolutePath?: string;
  /** Remaining benchmark samples for the visual gist (up to 9). */
  masterGenImageAbsolutePaths?: string[];
};

export type CheckpointMasterImagesDto = {
  masterAbsolutePath: string;
  genAbsolutePaths: string[];
  /** Checkpoint Benchmark output root (legacy field name). */
  mastersFolder: string;
  resolvedAt: string;
};

export type DeleteCheckpointsResultDto = {
  deleted: string[];
  /** Benchmark samples moved into `{benchmarkRoot}/!Deleted` (not permanently deleted). */
  deletedMasterImages: number;
  archivedCivitaiModelIds: number[];
  errors: Array<{ relativePath: string; message: string }>;
};

export type DeleteLorasResultDto = {
  deleted: string[];
  /** Wildcard files rewritten to drop `<lora:…>` tags for the deleted model(s). */
  editedWildcardFiles: number;
  /** Total `<lora:…>` tag occurrences removed across those files. */
  removedTagOccurrences: number;
  archivedCivitaiModelIds: number[];
  errors: Array<{ relativePath: string; message: string }>;
};

export type ModelManagerListDto = {
  folder: string | null;
  files: ModelFileManagerEntryDto[];
  fileCount: number;
  /** Epoch ms of the last LoRA folder walk; omitted for checkpoints. */
  lastRefreshAt?: number | null;
};

export type LoraIndexRefreshResultDto = {
  refreshed: boolean;
  lastRefreshAt: number | null;
};

export type LoraReverseRefDto = {
  relativePath: string;
  key: string;
  refs: Array<{ raw: string; line: number; column: number }>;
};

/** Documented wildcard `<lora:…>` block preferred for clipboard copy. */
export type DefinedLoraReferenceDto = {
  /** Complete `<lora:…>` tag (no trailing triggers). */
  tag: string;
  /**
   * Preceding `#` comment lines + the full LoRA line (tag + optional prompts).
   */
  block: string;
  relativePath: string;
  line: number;
  hasDocComments: boolean;
};

export type LoraManagerDetailDto = {
  file: ModelFileManagerEntryDto;
  reverseRefs: LoraReverseRefDto[];
  issues: IssueDto[];
};

/** Read-only view of embedded `.safetensors` training metadata. */
export type LoraInspectDto = {
  relativePath: string;
  absolutePath: string;
  stem: string;
  format: 'safetensors' | 'unsupported';
  error?: string;
  /** Promoted Kohya / ModelSpec fields for the summary table. */
  fields: Array<{ label: string; value: string }>;
  /** Tags from `ss_tag_frequency`, sorted by descending count. */
  keywords: Array<{ tag: string; count: number }>;
  /** Trigger / activation words (from tag frequency or fallback fields). */
  triggerWords: string[];
  /**
   * Keywords suitable after `<lora:…>` in a LOCAL wildcard reference
   * (explicit triggers, else highest-frequency training tags).
   */
  promptKeywords: string[];
  /** Remaining `__metadata__` keys not shown in `fields`. */
  otherFields: Array<{ key: string; value: string }>;
  tensorCount: number;
  parameterCount?: number;
  dtypes: Array<{ dtype: string; tensors: number; bytes: number }>;
};

export type CheckpointManagerDetailDto = {
  file: ModelFileManagerEntryDto;
};

/** TEMPORARY one-shot model → catalog match + preview warm. */
export type ModelCatalogPopulateProgressDto = {
  kind: 'LORA' | 'Checkpoint';
  status: 'running' | 'done' | 'error' | 'cancelled';
  done: number;
  total: number;
  matched: number;
  fetchedMatch: number;
  queuedPreviews: number;
  skippedNoHash: number;
  failed: number;
  phase?: 'matching' | 'fetching';
  currentStem?: string;
  error?: string;
};

/** @deprecated Prefer ModelCatalogPopulateProgressDto. */
export type LoraCatalogPopulateProgressDto = ModelCatalogPopulateProgressDto;

export type ConsolidationAffectedFileDto = {
  key: string;
  relativePath: string;
  occurrences: number;
};

export type ConsolidationPreviewDto = {
  canConsolidate: boolean;
  reason?: string;
  sourceKey: string;
  sourceRelativePath: string;
  targetName: string;
  targetExists: boolean;
  affectedFiles: ConsolidationAffectedFileDto[];
  totalOccurrences: number;
  warnings: string[];
};

export type ConsolidationResultDto = {
  deletedRelativePath: string;
  /** Relative path of the target file that references now point at, when it exists. */
  targetRelativePath: string | null;
  editedFiles: number;
  totalOccurrences: number;
  targetName: string;
};

export type AbsorbPreviewDto = {
  canAbsorb: boolean;
  reason?: string;
  sourceKey: string;
  sourceRelativePath: string;
  targetName: string;
  targetKey: string;
  targetRelativePath: string;
  affectedFiles: ConsolidationAffectedFileDto[];
  totalOccurrences: number;
  warnings: string[];
};

export type AbsorbResultDto = {
  keptRelativePath: string;
  deletedRelativePath: string;
  editedFiles: number;
  totalOccurrences: number;
  targetName: string;
};

export type RenamePreviewDto = {
  canRename: boolean;
  reason?: string;
  sourceKey: string;
  sourceRelativePath: string;
  newKey: string;
  newRelativePath: string;
  affectedFiles: ConsolidationAffectedFileDto[];
  totalOccurrences: number;
  warnings: string[];
};

export type RenameResultDto = {
  newRelativePath: string;
  editedFiles: number;
  totalOccurrences: number;
};

export type ConvertToChildPreviewDto = {
  canConvert: boolean;
  reason?: string;
  sourceKey: string;
  sourceRelativePath: string;
  childKey: string;
  childRelativePath: string;
  parentText: string;
  warnings: string[];
};

export type ConvertToChildResultDto = {
  sourceRelativePath: string;
  childRelativePath: string;
  childKey: string;
};

export type CreateDescendantResultDto = {
  parentRelativePath: string;
  childRelativePath: string;
  childKey: string;
};

export type DeleteResultDto = {
  deletedRelativePath: string;
  editedFiles: number;
  totalOccurrences: number;
};

export type ReferenceCleanupResultDto = {
  referenceName: string;
  editedFiles: number;
  totalOccurrences: number;
};

export type CycleFixIssueSeedDto = {
  nodeId?: string;
  line?: number;
  column?: number;
  snippet?: string;
  message?: string;
};

export type CycleFixSuggestionDto = {
  id: string;
  from: string;
  to: string;
  line: number;
  column?: number;
  snippet: string;
  relativePath: string;
  mode: 'token' | 'line';
  score: number;
  impact: 'very_low' | 'low' | 'medium' | 'high';
  summary: string;
  details: string[];
  breaksAllCycles: boolean;
  unreachableFromRoot: string[];
  /** Source file text after applying this suggestion. */
  newText: string;
  /** Current source file text (for diff). */
  oldText: string;
};

export type CycleFixPreviewDto = {
  canResolve: boolean;
  reason?: string;
  groupId: string | null;
  nodeIds: string[];
  paths: string[];
  suggestions: CycleFixSuggestionDto[];
};

export type CycleFixApplyRequestDto = {
  relativePath: string;
  line: number;
  column?: number;
  snippet: string;
};

export type CycleFixResultDto = {
  relativePath: string;
  from: string;
  to: string;
  snippet: string;
};

export type ExpandMode = 'exhaustive' | 'random';

export type PromptFolderNodeDto = {
  name: string;
  relativePath: string;
  hasGenFile: boolean;
  imageCount: number;
  children: PromptFolderNodeDto[];
};

export type PromptTreeDto = {
  root: string | null;
  folders: PromptFolderNodeDto[];
};

export type PromptGenFileDto = {
  relativeFolder: string;
  exists: boolean;
  content: string;
};

export type PromptSampleImageDto = {
  fileName: string;
  relativePath: string;
  url: string;
};

export type GenPromptValidationFileDto = {
  relativeFolder: string;
  relativePath: string;
  issues: IssueDto[];
  errorCount: number;
  warningCount: number;
};

export type GenPromptValidationReportDto = {
  files: GenPromptValidationFileDto[];
  filesWithIssues: number;
  errorCount: number;
  warningCount: number;
};

export type PromptCoverageBucketDto = 'never' | 'rare' | 'normal' | 'hot';

export type PromptCoverageWildcardStatDto = {
  key: string;
  hits: number;
  visits: number;
  reachRate: number;
  bucket: PromptCoverageBucketDto;
  directGenRefs: number;
  byFolder: Record<string, number>;
};

export type PromptCoverageEdgeStatDto = {
  parentKey: string;
  childKey: string;
  visits: number;
  parentShare: number;
};

export type PromptCoverageFolderStatDto = {
  relativeFolder: string;
  lineCount: number;
  walksFromFolder: number;
  topKeys: Array<{ key: string; hits: number }>;
};

export type PromptCoverageReportDto = {
  version: 1;
  libraryId: string;
  generatedAt: string;
  status: 'done' | 'cancelled' | 'error';
  seed: number;
  iterations: number;
  totalWalks: number;
  selection: 'allGenLines';
  promptsRoot?: string;
  summary: {
    genFolders: number;
    genLines: number;
    libraryFiles: number;
    reachedFiles: number;
    /** Never-bucket keys not ignored (cleanup list). */
    neverReachedFiles: number;
    /** Never-bucket keys on the ignore list. */
    ignoredNeverFiles: number;
    hotFiles: number;
    rareFiles: number;
    issueCount: number;
  };
  wildcards: PromptCoverageWildcardStatDto[];
  neverReached: string[];
  /**
   * Hidden from Never Used (tools kept without regular gen use).
   * Survives coverage re-runs.
   */
  ignoredKeys: string[];
  hottest: string[];
  genFolders: PromptCoverageFolderStatDto[];
  edges: PromptCoverageEdgeStatDto[];
  issues: IssueDto[];
};

export type PromptCoverageIgnorePatchDto = {
  add?: string[];
  remove?: string[];
};

export type PromptCoverageStartRequestDto = {
  iterations?: number;
  seed?: number;
};

export type PromptCoverageStartResultDto = {
  started: true;
  totalWalks: number;
  iterations: number;
  seed: number;
};

export type PromptCoverageProgressDto = {
  status: 'running' | 'done' | 'cancelled' | 'error';
  libraryId: string;
  done: number;
  total: number;
  percent: number;
  currentFolder?: string;
  walksPerSec?: number;
  etaSeconds?: number | null;
  error?: string;
  report?: PromptCoverageReportDto;
};

export type PromptCoverageRefreshResultDto = {
  report: PromptCoverageReportDto;
  /** Wildcard keys removed because the file no longer exists. */
  removedMissing: number;
  /** Former Never keys that are now named in a !gen.txt. */
  clearedNeverByGenRef: number;
  changed: boolean;
};

export type ComfyConnectionDto = {
  host: string;
  port: number;
  secure: boolean;
  hasApiKey: boolean;
  apiKeyHeader?: string;
  /**
   * @deprecated Prefer per-style `generationOutput*` on the library.
   * Kept as a Realistic fallback when no style output / prompts folder is set.
   */
  generationFolder: string | null;
  /** Absolute path to a ComfyUI start shortcut (.bat / .cmd / .exe / .lnk). */
  launchPath: string | null;
};

export type LmStudioConnectionDto = {
  host: string;
  port: number;
  secure: boolean;
  model: string;
  hasApiKey: boolean;
};

export type LmStudioConnectionTestDto = {
  ok: boolean;
  latencyMs?: number;
  models: string[];
  errors: string[];
  warnings: string[];
};

export type LmStudioAssistPresetIdDto =
  | 'review'
  | 'find_errors'
  | 'add_variations'
  | 'polish'
  | 'custom';

export type LmStudioAssistRequestDto = {
  relativePath: string;
  currentText: string;
  preset: LmStudioAssistPresetIdDto;
  instruction?: string;
  model?: string;
};

export type LmStudioAssistResultDto = {
  relativePath: string;
  model: string;
  summary: string;
  notes: string;
  /** Full proposed file when hasEdits; null for review-only. */
  proposedText: string | null;
  hasEdits: boolean;
};

export type LmStudioSavedPromptDto = {
  id: string;
  name: string;
  preset: LmStudioAssistPresetIdDto;
  instruction: string;
  updatedAt: string;
};

export type LmStudioPromptSessionDto = {
  preset: LmStudioAssistPresetIdDto;
  instruction: string;
  selectedPromptId: string | null;
};

export type LmStudioPromptLibraryDto = {
  prompts: LmStudioSavedPromptDto[];
  lastSession: LmStudioPromptSessionDto;
};

export type ComfyConnectionTestDto = {
  ok: boolean;
  httpReachable: boolean;
  wsReachable: boolean;
  latencyMs?: number;
  nodeClassCount?: number;
  errors: string[];
  warnings: string[];
};

export type ComfyModelCatalogDto = {
  checkpoints: string[];
  unets: string[];
  vaes: string[];
  clips: string[];
  loras: string[];
  samplers: string[];
  schedulers: string[];
  fetchedAt: string;
};

export type ComfyContractCheckDto = {
  ok: boolean;
  requiredMissing: string[];
  roles: Array<{
    role: string;
    label: string;
    required: boolean;
    resolved: boolean;
    via: string;
    nodeId?: string;
    hint?: string;
  }>;
  usesContractNodes: boolean;
};

export type ComfyWorkflowProfileDto = {
  formatVersion: 1;
  profileId: string;
  name: string;
  workflowHash: string;
  importedAt: string;
  updatedAt: string;
  workflow: Record<string, unknown>;
  /** LiteGraph UI graph for Edit Workflow reload. */
  uiWorkflow?: unknown;
  bindings: Record<string, unknown>;
  saveWarnings?: string[];
  notes?: string;
};

export type ComfySaveWorkflowResultDto = {
  profile: ComfyWorkflowProfileDto;
  warnings: string[];
  contractOk: boolean;
};

export type GenerationModeDto = 'once' | 'infinite';

export type GenerationPromptSourceDto = 'folder' | 'text';

/** Realistic / Hentai / 3D — each profile stores the whole Generation form. */
export type GenerationStyleProfileIdDto = 'realistic' | 'hentai' | '3d';

export const GENERATION_STYLE_PROFILE_IDS: GenerationStyleProfileIdDto[] = [
  'realistic',
  'hentai',
  '3d',
];

export const GENERATION_STYLE_PROFILE_LABELS: Record<
  GenerationStyleProfileIdDto,
  string
> = {
  realistic: 'Realistic',
  hentai: 'Hentai',
  '3d': '3D',
};

export type GenerationStyleProfileDto = {
  relativeFolder: string | null;
  /**
   * When a prompt folder is selected: also randomize among descendant folders
   * that have `!gen.txt`. Ignored when the folder is empty (Randomize all).
   */
  promptFoldersRecursive: boolean;
  checkpoint: string;
  clip: string;
  vae: string;
  seed: number;
  width: number;
  height: number;
  /** Appended to every positive prompt (comma-separated), e.g. style tags. */
  additionalPositivePrompt: string;
  negativePrompt: string;
  /** Typed “Use this prompt” text — kept even when folder mode is selected. */
  promptText: string;
  promptSource: GenerationPromptSourceDto;
};

/** Persisted Generation tab controls (survives reload / restart). */
export type GenerationFormStateDto = {
  /** Which style profile the form is showing and generating with. */
  activeProfile: GenerationStyleProfileIdDto;
  profiles: Record<GenerationStyleProfileIdDto, GenerationStyleProfileDto>;
  /** Active profile, mirrored so older readers and generation use one shape. */
  relativeFolder: string | null;
  promptFoldersRecursive: boolean;
  checkpoint: string;
  clip: string;
  vae: string;
  seed: number;
  width: number;
  height: number;
  additionalPositivePrompt: string;
  negativePrompt: string;
  promptText: string;
  promptSource: GenerationPromptSourceDto;
  /**
   * When true, Generation walks checkpoints into the library Benchmark folder
   * (shared across style profiles).
   */
  benchmark: boolean;
  /** Positive prompt caption for the last finished output (persisted, shared). */
  lastPrompt?: string;
  /** Negative prompt from the last output image metadata (persisted, shared). */
  lastNegativePrompt?: string;
  /**
   * Prompt folder that produced the last output (`portraits/boys`).
   * Not the Generation form selection — Random/Recursive stores the actual pick.
   */
  lastRelativeFolder?: string;
  /** Seed used for the last finished output (persisted with Last output). */
  lastSeed?: number;
  /**
   * Workflow output file to show again next launch.
   * The preview reuses that file — no image bytes are stored in app data.
   */
  lastOutputPath?: string;
};

/** Form fields plus optional restored preview image. */
export type GenerationFormLoadedDto = GenerationFormStateDto & {
  /** `wcm-gen://` URL for `lastOutputPath`. Image bytes are not inlined. */
  lastImageUrl?: string;
};

/**
 * One library rule: when the checkpoint file name contains `modelContains`,
 * replace every exact `find` in the selected prompt with `replace` before
 * wildcards expand.
 */
export type PromptSubstitutionDto = {
  /** Case-insensitive substring of the checkpoint file name (no extension). */
  modelContains: string;
  /** Exact, case-sensitive prompt text. */
  find: string;
  /** Replacement text. May be empty to remove `find`. */
  replace: string;
};

export type GenerationStartRequestDto = {
  mode: GenerationModeDto;
  /** Style profile that owns checkpoints/prompts and the output root. */
  styleProfile?: GenerationStyleProfileIdDto;
  /**
   * `folder` — expand lines from the selected prompts folder `!gen.txt`.
   * `text` — use `promptText` (wildcards still expanded).
   */
  promptSource?: GenerationPromptSourceDto;
  /** Required when promptSource is `folder` (default). */
  relativeFolder?: string;
  /**
   * With a selected folder: include sub-folders that have `!gen.txt`.
   * Default false = that folder only.
   */
  promptFoldersRecursive?: boolean;
  /** Required when promptSource is `text`. */
  promptText?: string;
  /**
   * Checkpoint relative path. Prompt substitutions match its file name
   * before the line is expanded.
   */
  checkpoint: string;
  clip?: string;
  vae?: string;
  /** -1 = random each job. */
  seed: number;
  width: number;
  height: number;
  /** Appended after the main positive with `, ` when non-empty. */
  additionalPositivePrompt?: string;
  negativePrompt?: string;
  /** Walk Checkpoint Benchmark output folders instead of a fixed checkpoint. */
  benchmark?: boolean;
};

export type CheckpointBenchmarkStatusDto = {
  root: string | null;
  targetImagesPerCheckpoint: number;
  nextStem: string | null;
  nextRelativePath: string | null;
  nextImageCount: number;
  completedCheckpoints: number;
  totalCheckpoints: number;
  remainingImages: number;
  fastest: { stem: string; avgDurationMs: number } | null;
  slowest: { stem: string; avgDurationMs: number } | null;
};

/** One checkpoint’s timing row for the Benchmark results chart. */
export type CheckpointBenchmarkResultRowDto = {
  stem: string;
  /** Generation checkpoint dropdown value (root-relative path). */
  relativePath: string;
  imageCount: number;
  runCount: number;
  avgDurationMs: number;
  totalDurationMs: number;
  /** Fastest single run among the five fastest. */
  minDurationMs: number;
  /** Slowest single run among the five fastest. */
  maxDurationMs: number;
  /** Every recorded run duration (ms). The chart draws all of them. */
  runDurationsMs: number[];
  /**
   * `field_rating` from the sample folder’s `mfe_meta` ADS, when that stream
   * exists. Null when the folder has no rating.
   */
  rating: number | null;
};

export type CheckpointBenchmarkResultsDto = {
  root: string | null;
  targetImagesPerCheckpoint: number;
  updatedAt: string | null;
  rows: CheckpointBenchmarkResultRowDto[];
};

export type GenerationProgressDto = {
  status:
    | 'idle'
    | 'starting'
    | 'queued'
    | 'running'
    | 'saving'
    | 'done'
    | 'cancelled'
    | 'error';
  mode: GenerationModeDto | null;
  relativeFolder: string | null;
  jobsCompleted: number;
  lastPrompt?: string;
  lastNegativePrompt?: string;
  /**
   * Folder that produced `lastImageUrl` (survives until the next finished job).
   * Not the in-flight `relativeFolder`.
   */
  lastRelativeFolder?: string | null;
  /** Seed resolved for the in-flight job (set when status becomes `running`). */
  seed?: number | null;
  /** Seed that produced `lastImageUrl` (survives until the next finished job). */
  lastSeed?: number | null;
  /** `wcm-gen://` preview URL. Not a data URL — bytes stream from the output file. */
  lastImageUrl?: string;
  lastImageRelativePath?: string;
  /** Human-readable line while status is `starting` (and optional elsewhere). */
  detail?: string;
  error?: string;
  /** Benchmark: current checkpoint stem being generated. */
  benchmarkStem?: string | null;
  /** Benchmark: images already in the current stem folder before this job. */
  benchmarkImageCount?: number | null;
  /** Benchmark: target images per checkpoint (10). */
  benchmarkTargetImages?: number | null;
  /** Benchmark: checkpoints that already have a full set. */
  benchmarkCompletedCheckpoints?: number | null;
  /** Benchmark: total .safetensors candidates. */
  benchmarkTotalCheckpoints?: number | null;
  /** Benchmark: images still needed across all candidates. */
  benchmarkRemainingImages?: number | null;
};

export type ExpandRequestDto = {
  /**
   * `wildcard` (default) expands a library file. `gen-file` expands the
   * selected Prompts `!gen.txt`. `generation` expands the line Once would queue.
   */
  source?: 'wildcard' | 'gen-file' | 'generation';
  /** Wildcard file. Required for `wildcard`. */
  relativePath?: string;
  /** Prompts folder for `gen-file`, and the selected folder for `generation`. */
  relativeFolder?: string;
  /** Unsaved `!gen.txt` body. When omitted, `gen-file` reads the file on disk. */
  content?: string;
  promptSource?: 'text' | 'folder';
  promptText?: string;
  promptFoldersRecursive?: boolean;
  additionalPositivePrompt?: string;
  /**
   * Generation checkpoint relative path. Substitutions for this library
   * match its file name before the chosen line is expanded.
   */
  checkpoint?: string;
  /**
   * Generation form seed. ≤0 rolls a new seed the way Once does.
   * Wildcard expansion of that chosen line uses the resolved seed.
   */
  generationSeed?: number;
  mode: ExpandMode;
  limit?: number;
  seed?: number;
};

export type ExpandResultDto = {
  mode: ExpandMode;
  rootKey: string;
  samples: string[];
  totalCombinations: number;
  combinationsSaturated: boolean;
  limit: number;
  truncated: boolean;
  seed: number | null;
  issues: IssueDto[];
  /** Short label for where the samples came from. */
  detail?: string;
};

export type SimulateRequestDto = {
  relativePath: string;
  iterations: number;
  seed?: number;
};

export type NodeSimStatDto = {
  key: string;
  hits: number;
  visits: number;
  /** hits / iterations, in [0, 1] — overall reach from the simulation root. */
  reachRate: number;
};

export type SimEdgeStatDto = {
  parentKey: string;
  childKey: string;
  visits: number;
  /** child edge visits / parent visits — share of parent selections. */
  parentShare: number;
};

export type SimulateResultDto = {
  rootKey: string;
  iterations: number;
  seed: number;
  stats: NodeSimStatDto[];
  edges: SimEdgeStatDto[];
  issues: IssueDto[];
};

export type SimulateExportResultDto = {
  saved: boolean;
  filePath?: string;
  lineCount?: number;
  iterations?: number;
  seed?: number;
};

export type HistoryStateDto = {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
};

export type HistoryActionDto = {
  /** Label of the mutation that was undone/redone, or null if none. */
  label: string | null;
  state: HistoryStateDto;
};

/** Persisted session to restore on launch. */
export type StartupDto = {
  /** Last opened library root, or null on first run. */
  lastRoot: string | null;
  /** Last selected file (relative to lastRoot), or null. */
  lastRootFile: string | null;
};

export type LibraryConfigDto = {
  id: string;
  name: string;
  wildcardsRoot: string | null;
  loraFolder: string | null;
  checkpointFolder: string | null;
  imagesFolder: string | null;
  /** Root for Civitai community video downloads (`{baseModel}/file`). */
  videosFolder: string | null;
  mastersFolder: string | null;
  /** Root of local LoRA training datasets (`dataset.json` + preview icons). */
  trainingLibraryFolder: string | null;
  promptsFolder: string | null;
  /**
   * Generation image output roots per style. Folder mode →
   * `{root}/{promptRelative}`, or `{root}/{promptRelative}/New` when
   * Save in New subfolder is on. Typed prompt → `{root}`.
   * Realistic falls back to `promptsFolder` when unset.
   */
  generationOutputRealistic: string | null;
  generationOutputHentai: string | null;
  generationOutput3d: string | null;
  /** Root for Checkpoint Benchmark (`{stem}/` image folders + stats JSON). */
  benchmarkOutputFolder: string | null;
  lastRootFile?: string;
  /** Base-model groups this library may browse/sync. */
  enabledArchitectures: CivitaiArchitectureIdDto[];
  /** SDXL families this library may browse (when SDXL is enabled). */
  enabledSdxlFamilies: CivitaiSdxlFamilyToggleIdDto[];
  /** Civitai model categories this library may browse/sync. */
  enabledCivitaiCategories: CivitaiModelCategoryIdDto[];
  /** Wildcard validation target for this library. */
  validationPlatform: ValidationPlatform;
  /** Civitai site this library browses/downloads from. */
  civitaiOrigin: CivitaiOriginDto;
};

export type LibraryListDto = {
  libraries: LibraryConfigDto[];
  activeLibraryId: string;
};

export type LibraryCreateRequestDto = {
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
  civitaiOrigin?: CivitaiOriginDto;
};

export type LibraryUpdateRequestDto = {
  name?: string;
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
  civitaiOrigin?: CivitaiOriginDto;
};

/** Folder pointer fields remapped by library path migration. */
export type LibraryPathFolderFieldDto =
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
  | 'benchmarkOutputFolder';

export type LibraryPathMigrationRequestDto = {
  libraryId: string;
  oldPrefix: string;
  newPrefix: string;
  folderOverrides?: Partial<
    Record<LibraryPathFolderFieldDto, string | null>
  >;
};

export type LibraryPathMigrationFolderDto = {
  field: LibraryPathFolderFieldDto;
  label: string;
  oldPath: string | null;
  newPath: string | null;
  changed: boolean;
  underPrefix: boolean;
  override: boolean;
  newExists: boolean;
  note?: string;
};

export type LibraryPathMigrationPlanDto = {
  libraryId: string;
  libraryName: string;
  oldPrefix: string;
  newPrefix: string;
  suggestedOldPrefix: string | null;
  folders: LibraryPathMigrationFolderDto[];
  warnings: string[];
  blockingErrors: string[];
  canApply: boolean;
  sidecar: {
    masterImagesPath: string | null;
    masterImagesExists: boolean;
    masterImagesRemapEstimate: number;
    seriesDatasetsPath: string | null;
    seriesDatasetsExists: boolean;
    seriesDatasetsWouldRemap: boolean;
    wildcardsSidecarPath: string | null;
    wildcardsSidecarExists: boolean;
    driveRootSidecarRename: {
      from: string;
      to: string;
      needed: boolean;
      fromExists: boolean;
      toExists: boolean;
    } | null;
    recentRootsRemapEstimate: number;
  };
};

export type LibraryPathMigrationApplyResultDto = {
  libraryId: string;
  applied: boolean;
  backupPath: string | null;
  foldersChanged: number;
  masterImagesRemapped: number;
  seriesDatasetsRemapped: boolean;
  recentRootsRemapped: number;
  driveRootSidecarMoved: boolean;
  warnings: string[];
};

export type LoraSeriesValidationImageDto = {
  fileName: string;
  absolutePath: string;
};

export type LoraSeriesValidationSetDto = {
  index: number;
  label: string;
  prompt: string;
  folderName: string;
  folderAbsolutePath: string;
  images: LoraSeriesValidationImageDto[];
};

/** Resolved training-dataset preview for a multi-step LoRA series. */
export type LoraSeriesDatasetPreviewDto = {
  status: 'ok' | 'no_training_library' | 'no_lora_folder' | 'not_found';
  seriesKey: string;
  datasetAbsolutePath?: string;
  datasetRelativePath?: string;
  previewAbsolutePath?: string | null;
  previewDataUrl?: string | null;
  fromCache?: boolean;
  /** Validation-set image folders under `output/` (one folder per set). */
  validationSets?: LoraSeriesValidationSetDto[];
};

/** Result of switching the active library (may include an opened wildcard root). */
export type LibrarySwitchResultDto = {
  library: LibraryConfigDto;
  /** Present when the library has a wildcardsRoot that was opened. */
  snapshot: LibrarySnapshotDto | null;
};

export const WORKSPACE_TAB_IDS = [
  'prompts',
  'generation',
  'wildcards',
  'loras',
  'checkpoints',
  'search',
] as const;

export type WorkspaceTabId = (typeof WORKSPACE_TAB_IDS)[number];

export type TabPanelWidthsDto = {
  filesPanelWidth: number;
  detailsPanelWidth: number;
};

export const WILDCARD_LIST_FILTER_MODES = [
  'all',
  'roots',
  'leaves',
  'standalone',
  'invalid',
  'errors',
  'lora',
] as const;
export type WildcardListFilterMode = (typeof WILDCARD_LIST_FILTER_MODES)[number];

export const LORA_LIST_FILTER_MODES = [
  'all',
  'used',
  'unused',
  'errors',
  'has-sidecar',
  'has-civitai',
  'unmatched',
  'training-series',
] as const;
export type LoraListFilterMode = (typeof LORA_LIST_FILTER_MODES)[number];

export const CHECKPOINT_LIST_FILTER_MODES = [
  'all',
  'has-sidecar',
  'has-civitai',
  'unmatched',
  'missing-hash',
  'unrated',
  'rating-lte-1',
  'rating-lte-2',
  'rating-lte-3',
  'rating-gte-4',
] as const;
export type CheckpointListFilterMode =
  (typeof CHECKPOINT_LIST_FILTER_MODES)[number];

export type WorkspaceListFilterTab = 'wildcards' | 'loras' | 'checkpoints';

export type WorkspaceListFilterDto<Mode extends string = string> = {
  query: string;
  mode: Mode;
};

export type WorkspaceListFiltersDto = {
  wildcards: WorkspaceListFilterDto<WildcardListFilterMode>;
  loras: WorkspaceListFilterDto<LoraListFilterMode>;
  checkpoints: WorkspaceListFilterDto<CheckpointListFilterMode>;
};

export const DEFAULT_WORKSPACE_LIST_FILTERS: WorkspaceListFiltersDto = {
  wildcards: { query: '', mode: 'all' },
  loras: { query: '', mode: 'all' },
  checkpoints: { query: '', mode: 'all' },
};

/** Geometry for floating in-app windows (Coverage, etc.). */
export type FloatingWindowStateDto = {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
};

export const BENCHMARK_RESULTS_SORTS = [
  'speed-asc',
  'speed-desc',
  'name-asc',
  'name-desc',
  'rating-desc',
  'rating-asc',
  'weight-desc',
  'weight-asc',
] as const;

/** Benchmark results chart order. */
export type BenchmarkResultsSort = (typeof BENCHMARK_RESULTS_SORTS)[number];

/** Remembered name filter and sort for the Benchmark results chart. */
export type BenchmarkResultsViewDto = {
  sort: BenchmarkResultsSort;
  /** Case-insensitive “name contains” filter. Empty shows every name. */
  nameFilter: string;
};

export const DEFAULT_BENCHMARK_RESULTS_VIEW: BenchmarkResultsViewDto = {
  sort: 'speed-asc',
  nameFilter: '',
};

export type UiSettingsDto = {
  /** @deprecated Prefer panelWidthsByTab; kept as wildcards-tab widths. */
  detailsPanelWidth: number;
  /** @deprecated Prefer panelWidthsByTab; kept as wildcards-tab widths. */
  filesPanelWidth: number;
  /** Splitter widths keyed by main workspace tab. */
  panelWidthsByTab: Record<WorkspaceTabId, TabPanelWidthsDto>;
  /**
   * Prompts tab Samples side panel collapsed.
   * `null` when never saved yet (renderer may migrate a legacy localStorage value).
   */
  promptsSamplesCollapsed: boolean | null;
  /**
   * Generation tab Last output side panel collapsed.
   * `null` when never saved yet (renderer may migrate a legacy localStorage value).
   */
  generationPreviewCollapsed: boolean | null;
  /** Additional Positive Prompt box height in px, or null when never resized. */
  generationAdditionalPositiveHeight: number | null;
  /** Negative Prompt box height in px, or null when never resized. */
  generationNegativePromptHeight: number | null;
  /** Prompt Coverage dialog position/size (null = never saved). */
  promptCoverageWindow: FloatingWindowStateDto | null;
  /** Generation prompt-substitutions dialog position/size (null = never saved). */
  promptSubstitutionsWindow: FloatingWindowStateDto | null;
  /** Checkpoint Benchmark results chart position/size (null = never saved). */
  benchmarkResultsWindow: FloatingWindowStateDto | null;
  /** Name filter and sort for the Benchmark results chart. */
  benchmarkResultsView: BenchmarkResultsViewDto;
  simulationIterations: number;
  simulationSeed: number;
  graphLayoutStyle: GraphLayoutStyle;
  /** Remembered list search + dropdown for Wildcards / LoRA / Checkpoint tabs. */
  workspaceListFilters: WorkspaceListFiltersDto;
  /** Absolute path to a LoRA models folder, or null when unset. */
  loraFolder: string | null;
  /** Absolute path to a checkpoint models folder, or null when unset. */
  checkpointFolder: string | null;
  /** Absolute path for Civitai community image downloads, or null when unset. */
  imagesFolder: string | null;
  /** Absolute path for Civitai community video downloads, or null when unset. */
  videosFolder: string | null;
  /** Absolute path to checkpoint master collage JPGs, or null when unset. */
  mastersFolder: string | null;
  /** Absolute path to the LoRA training library root, or null when unset. */
  trainingLibraryFolder: string | null;
  /** Absolute path to a prompts folder (`!gen.txt` trees), or null when unset. */
  promptsFolder: string | null;
  /** Suffix appended when suggesting a convert-to-child key (default `-child`). */
  convertChildSuffix: string;
  civitaiOrigin: CivitaiOriginDto;
  /** True when an API key is stored (value itself is not returned here). */
  hasCivitaiApiKey: boolean;
  activeLibraryId: string;
  libraries: Array<{ id: string; name: string }>;
  /**
   * When true, Chromium software-renders (less GPU contention with Comfy/A1111).
   * Requires app restart to apply.
   */
  disableHardwareAcceleration: boolean;
  /**
   * Folder-mode Generation writes `{prompt folder}/New` when true.
   * Off writes into the prompt folder itself. ComfyUI creates the directory
   * when it saves the image.
   */
  generationSaveInNewSubfolder: boolean;
  /**
   * Folder of electron-builder installers (e.g. this repo’s `release/`).
   * Used by Check for update / Install.
   */
  updateReleaseFolder: string | null;
  /** Running app version (`package.json` / electron-builder). */
  appVersion: string;
};

export type AppUpdateCheckResultDto = {
  currentVersion: string;
  releaseFolder: string | null;
  available: boolean;
  latestVersion: string | null;
  installerPath: string | null;
  installerFileName: string | null;
  message: string;
};

export type GraphLayoutStyle = 'default' | 'optimized' | 'compact';
export type ValidationPlatform = 'comfyui' | 'stable-diffusion';
/** Focus a model card/preview inside the in-app Civitai browser. */
export type CivitaiFocusModelDto = {
  modelId: number;
  pageUrl: string;
  name?: string;
};

export type CivitaiOriginDto = 'https://civitai.com' | 'https://civitai.red';
export type CivitaiModelTypeDto = 'LORA' | 'Checkpoint';
/** Browse content kind — Images/Videos are community gallery, not model weights. */
export type CivitaiBrowseKindDto = CivitaiModelTypeDto | 'Images' | 'Videos';

export type CivitaiArchitectureIdDto =
  | 'sd15'
  | 'sd2'
  | 'sd3'
  | 'sdxl'
  | 'flux'
  | 'krea'
  | 'pixart'
  | 'wan'
  | 'other';

/** Extra local filter when Base Model is SDXL. */
export type CivitaiSdxlFamilyIdDto =
  | 'all'
  | 'sdxl'
  | 'pony'
  | 'illustrious'
  | 'noobai';

export type CivitaiSdxlFamilyToggleIdDto = Exclude<CivitaiSdxlFamilyIdDto, 'all'>;

export type CivitaiModelCategoryIdDto =
  | 'character'
  | 'style'
  | 'concept'
  | 'clothing'
  | 'base model'
  | 'background'
  | 'poses'
  | 'tool'
  | 'assets'
  | 'vehicle'
  | 'buildings'
  | 'objects'
  | 'animal'
  | 'action';

/** Local catalog display order (does not change Civitai API sync). */
export type CivitaiLocalSortDto = 'newest' | 'name' | 'creator';

export type CivitaiBrowseFiltersDto = {
  type: CivitaiModelTypeDto;
  /**
   * Last top-level browser mode (LORA / Checkpoint / Images / Videos).
   * When omitted (legacy saves), falls back to `type`.
   */
  browseKind?: CivitaiBrowseKindDto;
  sort: CivitaiLocalSortDto;
  nsfw: boolean;
  hideInstalled: boolean;
  onlyNew: boolean;
  onlyPotentialDuplicate: boolean;
  includeArchived: boolean;
  includeMaybe: boolean;
  architectures: CivitaiArchitectureIdDto[];
  /** Only applied when architectures includes sdxl; default all. */
  sdxlFamily: CivitaiSdxlFamilyIdDto;
  category: CivitaiModelCategoryIdDto | null;
};

/** Civitai Images tab filters (persisted per library). */
export type CivitaiImageSortDto =
  | 'Newest'
  | 'Most Reactions'
  | 'Most Comments'
  | 'Most Collected';

/** Civitai `/images` `period` — scopes ranked metrics and Newest index windows. */
export type CivitaiImagePeriodDto =
  | 'AllTime'
  | 'Year'
  | 'Month'
  | 'Week'
  | 'Day';

export type CivitaiImageNsfwModeDto = 'sfw' | 'all' | 'nsfw';

export type CivitaiImageToolIdDto =
  | 'any'
  | 'krea'
  | 'comfyui'
  | 'civitai'
  | 'automatic1111'
  | 'forge'
  | 'swarmui'
  | 'fooocus';

export type CivitaiImageTabDto = 'browse' | 'downloaded' | 'archive';

export type CivitaiImageBrowseFiltersDto = {
  sort: CivitaiImageSortDto;
  period: CivitaiImagePeriodDto;
  nsfwMode: CivitaiImageNsfwModeDto;
  tool: CivitaiImageToolIdDto;
  tab: CivitaiImageTabDto;
  /**
   * Images/Videos base-model filter — independent from LORA/Checkpoint
   * `civitaiBrowseFilters.architectures`.
   */
  architecture: CivitaiArchitectureIdDto;
  /** Only applied when architecture is sdxl; default all. */
  sdxlFamily: CivitaiSdxlFamilyIdDto;
};

/** Same shape as Images — Videos gallery filters (persisted per library). */
export type CivitaiVideoBrowseFiltersDto = CivitaiImageBrowseFiltersDto;

/** Hugging Face Hub model search filters (persisted per library). */
export type HfModelTypeDto =
  | 'any'
  | 'lora'
  | 'checkpoint'
  | 'lycoris'
  | 'controlnet'
  | 'textual_inversion'
  | 'ip-adapter';

export type HfModelFamilyDto =
  | 'any'
  | 'sd15'
  | 'sdxl'
  | 'pony'
  | 'illustrious'
  | 'flux'
  | 'sd3'
  | 'krea2'
  | 'qwen-image';

export type HfSortDto =
  | 'downloads'
  | 'likes'
  | 'lastModified'
  | 'trendingScore'
  | 'createdAt';

export type HfBrowseFiltersDto = {
  search: string;
  author: string;
  modelType: HfModelTypeDto;
  modelFamily: HfModelFamilyDto;
  tags: string;
  baseModel: string;
  pipelineTag: string;
  library: string;
  sort: HfSortDto;
  direction: 1 | -1;
  gated: 'any' | 'true' | 'false';
  limit: number;
};

export type HuggingFaceModelHitDto = {
  id: string;
  likes: number;
  downloads: number;
  private: boolean;
  gated: boolean | 'auto' | 'manual' | null;
  pipelineTag: string | null;
  libraryName: string | null;
  tags: string[];
  createdAt: string | null;
  lastModified: string | null;
  trendingScore: number | null;
  pageUrl: string;
};

export type HuggingFaceSearchResultDto = {
  items: HuggingFaceModelHitDto[];
  nextCursor: string | null;
  fetchedCount: number;
};

export type ArchivedHfModelDto = {
  repoId: string;
};

export type HuggingFaceRepoFileDto = {
  path: string;
  size: number | null;
  oid?: string;
};

export type HuggingFaceModelDetailDto = {
  id: string;
  tags: string[];
  pipelineTag: string | null;
  libraryName: string | null;
  gated: boolean | 'auto' | 'manual' | null;
  private: boolean;
  siblings: HuggingFaceRepoFileDto[];
  pageUrl: string;
  suggestedType: 'LORA' | 'Checkpoint' | null;
};

export type HfDownloadTypeDto = 'LORA' | 'Checkpoint';

export type HfDownloadQueueItemDto = {
  jobId: string;
  repoId: string;
  modelName: string;
  filePath: string;
  fileName: string;
  type: HfDownloadTypeDto;
  status: 'active' | 'queued';
  categoryLabel?: string;
};

export type HfDownloadQueueSnapshotDto = {
  phase: 'active' | 'queued' | 'paused' | 'done';
  active: HfDownloadQueueItemDto | null;
  queue: HfDownloadQueueItemDto[];
  queuedCount: number;
  activeRepoId: string | null;
  activeModelName: string | null;
  paused: boolean;
};

export type HfDownloadProgressDto = {
  jobId: string;
  repoId: string;
  filePath: string;
  fileName: string;
  type: HfDownloadTypeDto;
  modelName?: string;
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
  saved?: boolean;
  error?: string;
  statusMessage?: string;
  phase?: 'queued' | 'active' | 'paused' | 'done';
  queuedCount?: number;
  activeRepoId?: string | null;
  activeModelName?: string | null;
};

export type HfModelDownloadOptionsDto = {
  repoId: string;
  revision?: string;
  filePath: string;
  type: HfDownloadTypeDto;
  category?: string;
  loraCategoryId?: string;
  extraLoraCategoryIds?: string[];
  weights?: string;
  extraComment?: string;
  extraPrompt?: string;
  modelName?: string;
  fileName?: string;
};

export type CivitaiSettingsDto = {
  origin: CivitaiOriginDto;
  hasApiKey: boolean;
  /**
   * Minutes between automatic Browse tip-checks while idle.
   * 0 = never auto tip-check (manual refresh still forces a check).
   */
  catalogAutoSyncIntervalMinutes: number;
  loraFolder: string | null;
  checkpointFolder: string | null;
  imagesFolder: string | null;
  videosFolder: string | null;
  browseFilters: CivitaiBrowseFiltersDto;
  /** Left grid pane fraction of the split (0.22–0.7). */
  splitRatio: number;
  /** Card grid min column width in px (zoom). */
  cardMinWidth: number;
  activeLibraryId: string;
  libraries: Array<{ id: string; name: string }>;
};

export type CivitaiStatusTagDto =
  | 'installed'
  | 'archived'
  | 'maybe'
  | 'watching'
  | 'early-access'
  | 'potential-duplicate'
  | 'update-available';

export type ArchivedCivitaiModelDto = {
  origin: CivitaiOriginDto;
  modelId: number;
};

/** Compact shelf row for LoRA/Checkpoint tab badges (no card payload). */
export type CivitaiShelfSummaryDto = {
  id: number;
  type: string;
  tags: string[];
  baseModel?: string;
  /** Per-version base models for architecture chips. */
  versionBaseModels?: string[];
  latestVersionInstalled?: boolean;
};

export type CivitaiShelfSummariesDto = {
  archived: CivitaiShelfSummaryDto[];
  maybe: CivitaiShelfSummaryDto[];
  downloaded: CivitaiShelfSummaryDto[];
};

export type ArchivedCivitaiImageDto = {
  origin: CivitaiOriginDto;
  imageId: number;
};

export type CivitaiImageHitDto = {
  id: number;
  url: string;
  width: number | null;
  height: number | null;
  nsfwLevel: number | null;
  username: string | null;
  baseModel: string | null;
  createdAt: string | null;
  likeCount: number | null;
  commentCount: number | null;
  modelId: number | null;
  modelVersionId: number | null;
  postId: number | null;
};

export type CivitaiImageSearchResultDto = {
  items: CivitaiImageHitDto[];
  nextCursor: string | null;
};

export type CivitaiImageSearchParamsDto = {
  cursor?: string | null;
  limit?: number;
  baseModels?: string[];
  /** Generator tools inferred from image meta (ComfyUI, Civitai, …). */
  tools?: Array<
    | 'krea'
    | 'comfyui'
    | 'civitai'
    | 'automatic1111'
    | 'forge'
    | 'swarmui'
    | 'fooocus'
  >;
  sort?:
    | 'Most Reactions'
    | 'Most Comments'
    | 'Most Collected'
    | 'Newest'
    | 'Oldest';
  /** Time window for `/images` sort metrics / Newest index (API default AllTime). */
  period?: CivitaiImagePeriodDto;
  /**
   * Content filter for `/images` (sent as `browsingLevel` bitmask).
   * - `sfw` — PG|PG13
   * - `all` — all levels
   * - `nsfw` — R|X|XXX only
   * Legacy `nsfw: true` maps to `all`.
   */
  nsfwMode?: 'sfw' | 'all' | 'nsfw';
  /** @deprecated Prefer `nsfwMode`. `true` ⇒ all, `false` ⇒ sfw. */
  nsfw?: boolean;
  username?: string;
  modelId?: number;
  withMeta?: boolean;
};

export type DownloadedCivitaiImageDto = {
  origin: CivitaiOriginDto;
  imageId: number;
  baseModel: string;
  relativePath: string;
  absolutePath: string;
  url: string;
  fileName: string;
  savedAt: string;
  username?: string | null;
};

export type CivitaiImageDownloadResultDto = {
  saved: DownloadedCivitaiImageDto;
  renamed: boolean;
};

export type CivitaiImageDownloadProgressDto = {
  imageId: number;
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
  error?: string;
  statusMessage?: string;
  fileName?: string;
  /** Jobs waiting behind the active download. */
  queuedCount?: number;
  phase?: 'queued' | 'active' | 'done';
};

/** Per-sort insight when Download all exhausts or catches up a feed. */
export type CivitaiImageDownloadAllSortStatsDto = {
  sort: CivitaiImageSortDto;
  outcome: 'exhausted' | 'caught_up' | 'stopped';
  /** Images newly saved during this sort drain. */
  saved: number;
  failed: number;
  skipped: number;
  /** API pages fetched while walking this sort. */
  pagesFetched: number;
  /** Image ids seen on those pages (known + new). */
  imagesSeen: number;
  /** Newest creator upload time among seen hits. */
  newestSeenAt: string | null;
  /** Oldest creator upload time among seen hits (how far back). */
  oldestSeenAt: string | null;
  /** Prior tip watermark used for Newest early-stop, if any. */
  coveredThroughNewestAt: string | null;
  durationMs: number;
  /** Always null — Download all no longer cycles sorts. */
  nextSort: CivitaiImageSortDto | null;
  /** Session totals for this Download all run. */
  sessionSaved: number;
  sessionFailed: number;
  sessionSkipped: number;
  completedAt: string;
};

/** Background “Download all” runner (survives leaving the Images tab). */
export type CivitaiImageDownloadAllStatusDto = {
  active: boolean;
  sort: CivitaiImageSortDto;
  period: CivitaiImagePeriodDto;
  nsfwMode: CivitaiImageNsfwModeDto;
  tool: CivitaiImageToolIdDto;
  baseModels: string[];
  saved: number;
  failed: number;
  skipped: number;
  phase: 'idle' | 'downloading' | 'pausing' | 'switching';
  /** @deprecated Sort cycling removed — always null. */
  pauseEndsAt: number | null;
  statusMessage: string | null;
  lastSavedImageId: number | null;
  /** Latest finished sort drain — shown as the catch-up / exhausted insight panel. */
  lastSortStats: CivitaiImageDownloadAllSortStatsDto | null;
};

export type CivitaiImageDownloadAllRequestDto = {
  sort?: CivitaiImageSortDto;
  period?: CivitaiImagePeriodDto;
  nsfwMode?: CivitaiImageNsfwModeDto;
  tool?: CivitaiImageToolIdDto;
  baseModels?: string[];
};

export type CivitaiBrowseCatchUpHitDto = {
  id: number;
  createdAt: string | null;
};

export type CivitaiBrowseCatchUpKeyPartsDto = {
  sort: CivitaiImageSortDto;
  period: CivitaiImagePeriodDto;
  nsfwMode: CivitaiImageNsfwModeDto;
  tool: CivitaiImageToolIdDto;
  baseModels: string[];
};

export type CivitaiBrowseCatchUpEvaluateRequestDto = {
  media: 'image' | 'video';
  keyParts: CivitaiBrowseCatchUpKeyPartsDto;
  page: CivitaiBrowseCatchUpHitDto[];
  consecutiveDownloadedPages: number;
  append: boolean;
  alreadyJumpedToResume?: boolean;
  /** Skip tip early-stop (Browse “Load older” after catch-up). */
  ignoreEarlyStop?: boolean;
};

export type CivitaiBrowseCatchUpEvaluateResultDto = {
  earlyStop: boolean;
  consecutiveDownloadedPages: number;
  jumpToCursor: string | null;
  /** Tip watermark when earlyStop is true. */
  coveredThroughNewestAt: string | null;
};

export type CivitaiBrowseCatchUpResumeRequestDto = {
  media: 'image' | 'video';
  keyParts: CivitaiBrowseCatchUpKeyPartsDto;
  cursor: string | null;
  /** After first-pass tip catch-up jumped — allow updating the deep resume cursor. */
  alreadyJumpedToResume?: boolean;
};

export type CivitaiBrowseCatchUpCommitRequestDto = {
  media: 'image' | 'video';
  keyParts: CivitaiBrowseCatchUpKeyPartsDto;
  tipHits: CivitaiBrowseCatchUpHitDto[];
  coveredHits: CivitaiBrowseCatchUpHitDto[];
  exhausted: boolean;
};

/** Videos gallery — same DTO shapes as Images (`/images?type=video`). */
export type ArchivedCivitaiVideoDto = ArchivedCivitaiImageDto;
export type CivitaiVideoHitDto = CivitaiImageHitDto;
export type CivitaiVideoSearchResultDto = CivitaiImageSearchResultDto;
export type CivitaiVideoSearchParamsDto = CivitaiImageSearchParamsDto;
export type DownloadedCivitaiVideoDto = DownloadedCivitaiImageDto;
export type CivitaiVideoDownloadResultDto = CivitaiImageDownloadResultDto;
export type CivitaiVideoDownloadProgressDto = CivitaiImageDownloadProgressDto;
export type CivitaiVideoDownloadAllSortStatsDto =
  CivitaiImageDownloadAllSortStatsDto;
export type CivitaiVideoDownloadAllStatusDto = CivitaiImageDownloadAllStatusDto;
export type CivitaiVideoDownloadAllRequestDto =
  CivitaiImageDownloadAllRequestDto;

/** Shortlist ("maybe later") entry — same shape as an archive entry. */
export type MaybeCivitaiModelDto = {
  origin: CivitaiOriginDto;
  modelId: number;
};

/** Creator blocked from Browse for this library / origin. */
export type BlockedCivitaiCreatorDto = {
  origin: CivitaiOriginDto;
  username: string;
  addedAt: string;
};

/** @deprecated Use ArchivedCivitaiModelDto */
export type HiddenCivitaiModelDto = ArchivedCivitaiModelDto;

export type CivitaiLocalMatchDto = {
  relativePath: string;
  stem: string;
  matchKind: 'exact' | 'similar';
};

/** File that currently makes a card count as installed (AutoV2 / stem). */
export type CivitaiLocalInstallMatchDto = {
  relativePath: string;
  absolutePath: string;
  via: 'autoV2';
};

/** Per-version / per-file install state on a Civitai model card (AutoV2-matched). */
export type CivitaiVersionInstallDto = {
  versionId: number;
  versionName: string;
  baseModel?: string;
  fileId?: number;
  fileName?: string;
  /** Short variant label (nf4, fp8, …) when the version has multiple weights. */
  variantLabel?: string;
  autoV2?: string;
  sizeKB?: number;
  installed: boolean;
  /** This version is still early-access gated. */
  earlyAccess: boolean;
  earlyAccessEndsAt?: string;
  localMatches: CivitaiLocalInstallMatchDto[];
};

export type CivitaiModelCardDto = {
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
  fileSizeKB?: number;
  trainedWords: string[];
  previewUrl?: string;
  /** User-set local override preview (`wcm-preview://…`), if any. */
  customPreviewUrl?: string;
  pageUrl: string;
  /**
   * Any known version/file AutoV2 is local, or the model is marked installed.
   * Used for Downloaded membership and Browse “Hide downloaded”.
   */
  installed: boolean;
  /**
   * Newest version id has a local weight (or marked installed). Missing
   * sibling quants of that version do not clear this — they are not updates.
   */
  latestVersionInstalled: boolean;
  /** True when at least one known version/file has no local AutoV2 match. */
  hasUninstalledVersion: boolean;
  /**
   * True when at least one non-early-access weight file is missing locally
   * (including alternate quants). Card-level Download uses this only when
   * `latestVersionInstalled` is false; otherwise use per-variant rows.
   */
  hasDownloadableVersion: boolean;
  /** Per-file AutoV2 install rows (newest version first). */
  versionInstalls: CivitaiVersionInstallDto[];
  /** User confirmed ownership (e.g. possible local match). Counts as installed. */
  markedInstalled: boolean;
  archived: boolean;
  /** On the "maybe later" shortlist (kept out of Browse like archived). */
  maybe: boolean;
  /** @deprecated Use archived */
  hidden?: boolean;
  potentialLocalMatches: CivitaiLocalMatchDto[];
  /**
   * Local files that triggered `installed` via AutoV2 hash match.
   * Empty when only `markedInstalled` (manual) with no hash hit.
   */
  localInstallMatches?: CivitaiLocalInstallMatchDto[];
  statusTags: CivitaiStatusTagDto[];
  /** Latest version is still early-access gated. */
  earlyAccess: boolean;
  earlyAccessEndsAt?: string;
  /** On the local “notify me” watchlist. */
  watching: boolean;
  /** ISO time when first stored in the local catalog. */
  firstSeenAt?: string;
  /**
   * Latest version publish time from Civitai (ISO).
   * Useful when browsing Newest to see how far back you are.
   */
  publishedAt?: string;
};

/** Versions/files available when confirming a Civitai download. */
export type CivitaiModelDownloadFileOptionDto = {
  id: number;
  name: string;
  sizeKB?: number;
  primary: boolean;
  autoV2?: string;
  variantLabel?: string;
  /** True when this file’s AutoV2 is already local. */
  installed?: boolean;
};

export type CivitaiModelDownloadVersionOptionDto = {
  id: number;
  name: string;
  baseModel?: string;
  earlyAccess?: boolean;
  earlyAccessEndsAt?: string;
  files: CivitaiModelDownloadFileOptionDto[];
};

/** Flat version+variant row for the download picker. */
export type CivitaiModelDownloadPickDto = {
  key: string;
  versionId: number;
  versionName: string;
  fileId: number;
  fileName: string;
  autoV2?: string;
  label: string;
  earlyAccess: boolean;
  installed: boolean;
  sizeKB?: number;
};

export type CivitaiModelDownloadOptionsDto = {
  modelId: number;
  modelName: string;
  versions: CivitaiModelDownloadVersionOptionDto[];
  /** Flattened version · variant options (preferred for the UI picker). */
  picks: CivitaiModelDownloadPickDto[];
};

export type WatchedCivitaiModelDto = {
  origin: CivitaiOriginDto;
  modelId: number;
  modelName: string;
  type: CivitaiModelTypeDto;
  versionId?: number;
  earlyAccessEndsAt?: string;
  available: boolean;
  addedAt: string;
  availableAt?: string;
  /** Fresh card when refreshWatchlist fetched details. */
  card?: CivitaiModelCardDto;
};

/** @deprecated Browse uses getCatalogSlice; kept for older callers. */
export type CivitaiSearchResultDto = {
  items: CivitaiModelCardDto[];
  nextCursor: string | null;
};

export type CivitaiCatalogSliceDto = {
  items: CivitaiModelCardDto[];
  sliceKey: string;
  /** Raw id-index size for this type/category/architecture slice (all families). */
  totalCached: number;
  exhausted: boolean;
  lastSyncedAt?: string;
  /**
   * Pass as `offset` on the next getCatalogSlice to continue scanning the id
   * index (after local filters). Not the same as items.length when filters skip.
   */
  nextOffset: number;
  hasMore: boolean;
  /**
   * How many index entries still match Browse filters after `nextOffset`
   * (family, archived, installed, …). Prefer this over `totalCached - nextOffset`
   * for “~N left” — the raw index includes other SDXL families.
   * First-page responses may use an unscanned-id upper bound so the grid is not
   * blocked by a full-slice recount.
   */
  matchRemaining: number;
  /** Total index entries that match Browse filters (entire slice). */
  matchTotal: number;
};

export type CivitaiCatalogSyncProgressDto = {
  sliceKey: string;
  status: 'syncing' | 'done' | 'error' | 'cancelled';
  mode: 'incremental' | 'fill';
  pagesFetched: number;
  totalCached: number;
  addedThisRun: number;
  /** Models returned by the API on the latest page (usually ≤100). */
  lastPageReceived?: number;
  /** How many of those were new to the local index. */
  lastPageAdded?: number;
  exhausted: boolean;
  error?: string;
  /**
   * When status is done — slice lastSyncedAt so the UI can schedule the next
   * tip-check relative to the real last check (not a fixed wall clock).
   */
  lastSyncedAt?: string;
};

export type CivitaiHashWarmProgressDto = {
  kind: 'LORA' | 'Checkpoint';
  status: 'hashing' | 'done' | 'error' | 'cancelled';
  done: number;
  total: number;
  hashedThisRun: number;
  cachedTotal: number;
  /** Still missing from the hash cache (0 when fully warmed). */
  missing?: number;
  /** File currently being hashed (multi‑GB checkpoints can take minutes). */
  currentStem?: string;
  error?: string;
};

/** Catalog AutoV2 backfill (API hashes only — no preview downloads). */
export type CivitaiCatalogAutoV2BackfillProgressDto = {
  status: 'backfilling' | 'done' | 'error' | 'cancelled';
  done: number;
  total: number;
  patchedThisRun: number;
  failedThisRun: number;
  error?: string;
};

/** Expand all version AutoV2 hashes on existing catalog cards (no preview I/O). */
export type CivitaiCatalogVersionHashEnrichProgressDto = {
  status: 'running' | 'done' | 'error' | 'cancelled';
  done: number;
  total: number;
  patchedThisRun: number;
  skippedCharacter: number;
  failedThisRun: number;
  currentName?: string;
  error?: string;
};

export type ModelFileRematchFilenameCandidateDto = {
  civitaiModelId: number;
  civitaiName: string;
  civitaiPageUrl: string;
  previewUrl?: string;
  matchedFileName: string;
  matchKind: 'exact' | 'similar';
};

export type ModelFileRematchResultDto = {
  matched: boolean;
  civitaiModelId?: number;
  civitaiName?: string;
  civitaiPageUrl?: string;
  previewUrl?: string;
  reason?: string;
  /**
   * After a hash miss: filename-based suggestions. Never auto-applied —
   * confirm in the UI before calling setCivitaiLink.
   */
  filenameCandidates?: ModelFileRematchFilenameCandidateDto[];
};

export type CivitaiPreviewWarmProgressDto = {
  status: 'caching' | 'done' | 'error' | 'cancelled';
  done: number;
  total: number;
  fetchedThisRun: number;
  error?: string;
  /** Live strip for the visual preview downloader (3 prev + current + 3 next). */
  strip?: CivitaiPreviewDownloadStripDto;
};

/** One card in the visual preview-download strip. */
export type CivitaiPreviewStripCardDto = {
  id: number;
  name: string;
  creator?: string;
  type: string;
  previewUrl?: string;
  pageUrl: string;
  baseModel?: string;
  tags: string[];
  previewMissing?: boolean;
  role: 'previous' | 'current' | 'next';
};

export type CivitaiPreviewDownloadStripDto = {
  previous: CivitaiPreviewStripCardDto[];
  current: CivitaiPreviewStripCardDto | null;
  next: CivitaiPreviewStripCardDto[];
  done: number;
  total: number;
};

export type CivitaiDownloadQueueItemDto = {
  jobId: string;
  modelId: number;
  modelName: string;
  type: CivitaiModelTypeDto;
  versionId?: number;
  fileId?: number;
  fileName?: string;
  status: 'active' | 'queued';
  categoryLabel: string;
  loraCategoryId?: string;
  /** Extra LoRA categories — wildcard append only (same downloaded file). */
  extraLoraCategoryIds?: string[];
  category?: string;
  weights?: string;
  extraComment?: string;
  extraPrompt?: string;
};

export type CivitaiDownloadQueueSnapshotDto = {
  phase: 'queued' | 'active' | 'paused' | 'done';
  active: CivitaiDownloadQueueItemDto | null;
  queue: CivitaiDownloadQueueItemDto[];
  queuedCount: number;
  activeModelId: number | null;
  activeModelName: string | null;
  /** True when network/transient failure parked the queue for manual/auto resume. */
  paused: boolean;
  pauseReason?: string | null;
};

export type CivitaiDownloadProgressDto = {
  modelId: number;
  versionId: number;
  type: CivitaiModelTypeDto;
  fileName: string;
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
  /**
   * True only after the weight file was renamed onto disk.
   * Cancel/fail may still send `done` + a planned `fileName` — do not treat
   * those as installed without `saved`.
   */
  saved?: boolean;
  error?: string;
  modelName?: string;
  /** Pre-transfer detail (API wait, rate-limit retry, opening URL, …). */
  statusMessage?: string;
  phase?: 'queued' | 'active' | 'paused' | 'done';
  queue?: CivitaiDownloadQueueItemDto[];
  queuedCount?: number;
  activeModelId?: number | null;
  activeModelName?: string | null;
  active?: CivitaiDownloadQueueItemDto | null;
  paused?: boolean;
  pauseReason?: string | null;
};

export type DownloadLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type DownloadLogEntryDto = {
  id: number;
  /** Epoch ms. */
  ts: number;
  level: DownloadLogLevel;
  message: string;
  source?: string;
  modelId?: number;
  modelName?: string;
  detail?: string;
};

export type CivitaiDownloadCategoryDto = {
  categories: string[];
  /** Empty string means the model root folder. */
  lastCategory: string;
  rootFolder: string;
};

export type LoraDownloadCategoryDto = {
  id: string;
  name: string;
  folder: string;
  wildcardRelativePath: string;
  defaultWeights: string;
};

export type LoraDownloadCategoryListDto = {
  categories: LoraDownloadCategoryDto[];
  lastCategoryId: string | null;
  loraRoot: string | null;
  wildcardFiles: string[];
};

export type LibraryMutatedDto = {
  relativePaths: string[];
  history: HistoryStateDto;
  /**
   * True when this mutation came from the in-app editor save/autosave.
   * Renderer should not blindly replace the live buffer (caret jump).
   */
  editorSave?: boolean;
  /** Mutation updated RAM only — disk still has the last save. */
  memoryOnly?: boolean;
  /** Undo/redo (or similar): take memory/disk over the live buffer. */
  authoritative?: boolean;
};

/** Result of an editor write/flush, including the text that actually landed. */
export type LibraryWriteResultDto = HistoryStateDto & {
  writtenText: string;
};

export type CivitaiDownloadResultDto = {
  modelId: number;
  versionId: number;
  type: CivitaiModelTypeDto;
  absolutePath: string;
  fileName: string;
  fileStem: string;
  clipboardText: string | null;
  categoryFolder?: string;
  wildcardRelativePath?: string;
  wildcardAppended?: boolean;
  wildcardAppendError?: string;
};

export type CivitaiDownloadDestinationCheckDto =
  | { ok: true; fileName: string; absolutePath: string }
  | { ok: false; error: string };

export type LoraSearchHitDto = {
  relativePath: string;
  absolutePath: string;
  stem: string;
  exact: boolean;
};

export type LoraSearchResultDto = {
  folder: string;
  fileCount: number;
  hits: LoraSearchHitDto[];
};

export type GlobalSearchScopesDto = {
  wildcards: boolean;
  prompts: boolean;
  loras: boolean;
  checkpoints: boolean;
};

export type GlobalSearchHitDto =
  | {
      kind: 'wildcard-name';
      relativePath: string;
      name: string;
    }
  | {
      kind: 'wildcard-content';
      relativePath: string;
      name: string;
      /** 1-based line number. */
      line: number;
      snippet: string;
    }
  | {
      kind: 'lora';
      relativePath: string;
      absolutePath: string;
      stem: string;
      exact: boolean;
    }
  | {
      kind: 'checkpoint';
      relativePath: string;
      absolutePath: string;
      stem: string;
      exact: boolean;
    }
  | {
      kind: 'prompt-name';
      relativeFolder: string;
      relativePath: string;
    }
  | {
      kind: 'prompt-content';
      relativeFolder: string;
      relativePath: string;
      /** 1-based line number in `!gen.txt`. */
      line: number;
      snippet: string;
    };

export type GlobalSearchResultDto = {
  query: string;
  hits: GlobalSearchHitDto[];
  /** Soft failures (e.g. no LoRA folder configured while that scope is on). */
  warnings: string[];
};

export type RenameLoraPreviewDto = {
  canRename: boolean;
  reason?: string;
  sourceName: string;
  oldRelativePath: string;
  oldAbsolutePath: string;
  newBasename: string;
  newRelativePath: string;
  newAbsolutePath: string;
  affectedFiles: ConsolidationAffectedFileDto[];
  totalOccurrences: number;
  warnings: string[];
};

export type RenameLoraResultDto = {
  oldRelativePath: string;
  newRelativePath: string;
  newAbsolutePath: string;
  editedFiles: number;
  totalOccurrences: number;
  hashCacheMoved: boolean;
};

export type CategorizeUnusedLoraResultDto = {
  moved: Array<{ from: string; to: string }>;
  wildcardRelativePath: string;
  appended: boolean;
  extended: boolean;
  extendSummary?: string;
  snippet: string;
  pickName: string;
};

export type ExtendUnusedLoraSeriesResultDto = {
  editedFiles: number;
  summaries: string[];
};

export type WcmDesktopApi = {
  library: {
    pickRoot(): Promise<string | null>;
    openRoot(root: string): Promise<LibrarySnapshotDto>;
    listFiles(): Promise<FileEntryDto[]>;
    /** All addressable text-file and structured-value wildcard keys. */
    listWildcardKeys(): Promise<string[]>;
    getRecent(): Promise<string[]>;
    getStartup(): Promise<StartupDto>;
    setLastFile(relativePath: string): Promise<void>;
    /** Forget lastRootFile so the next launch only restores the library folder. */
    clearLastFile(): Promise<void>;
    readFile(relativePath: string): Promise<FileContentDto>;
    /** Open a wildcard file with the operating system's default application. */
    openFileExternal(relativePath: string): Promise<void>;
    /** Save edited file content (undoable + backed up). Returns history + written text. */
    writeFile(
      relativePath: string,
      text: string,
      editSessionId?: string,
      basedOn?: string,
    ): Promise<LibraryWriteResultDto>;
    /** Synchronous final flush used only while the application is closing. */
    flushFile(
      relativePath: string,
      text: string,
      editSessionId?: string,
      basedOn?: string,
    ): LibraryWriteResultDto;
    refStats(): Promise<FileRefStatDto[]>;
    listLibraries(): Promise<LibraryListDto>;
    getActiveLibrary(): Promise<LibraryConfigDto>;
    setActiveLibrary(id: string): Promise<LibrarySwitchResultDto>;
    createLibrary(input: LibraryCreateRequestDto): Promise<LibraryConfigDto>;
    updateLibrary(
      id: string,
      patch: LibraryUpdateRequestDto,
    ): Promise<LibraryConfigDto>;
    deleteLibrary(id: string): Promise<LibraryListDto>;
    /** Pick a wildcards folder path without opening it (for library manager). */
    pickWildcardsFolder(): Promise<string | null>;
    /** Suggested common path prefix for a library’s configured folders. */
    suggestPathMigrationPrefix(libraryId: string): Promise<string | null>;
    /** Folder picker for an old/new migration prefix. */
    pickPathMigrationPrefix(): Promise<string | null>;
    /** Dry-run remap of library folder pointers + absolute sidecars. */
    planPathMigration(
      request: LibraryPathMigrationRequestDto,
    ): Promise<LibraryPathMigrationPlanDto>;
    /** Apply a previously previewed path migration (files must already be moved). */
    applyPathMigration(
      request: LibraryPathMigrationRequestDto,
    ): Promise<LibraryPathMigrationApplyResultDto>;
    /**
     * Fired when main applies an undoable mutation (download append, rename,
     * undo, …). Reload any open editors for these paths — do not flush drafts.
     */
    onMutated(cb: (payload: LibraryMutatedDto) => void): () => void;
  };
  analyze: {
    /** Analyze using currently open root + selected relative file. */
    fromFile(relativePath: string): Promise<AnalysisResultDto>;
    /** Analyze unsaved text in memory without changing the file on disk. */
    fromContent(
      relativePath: string,
      text: string,
    ): Promise<AnalysisResultDto>;
    /** Lightweight single-file validation for live editor feedback. */
    validateFile(relativePath: string, text: string): Promise<IssueDto[]>;
    /**
     * Refresh library-wide unused-LoRA warnings. Optional path/text overlays
     * unsaved editor contents for that file.
     */
    refreshUnusedLoras(
      relativePath?: string,
      text?: string,
    ): Promise<IssueDto[]>;
    /**
     * Validate every wildcard for node-level issues (slow on large libraries).
     * Persists a report for the “Files with issues” filter.
     */
    validateAll(): Promise<WildcardValidationReportDto>;
    cancelValidateAll(): Promise<void>;
    /** Last stored/memory report for the active library, or null. */
    getValidationReport(): Promise<WildcardValidationReportDto | null>;
    onValidateAllProgress(
      cb: (progress: WildcardValidationProgressDto) => void,
    ): () => void;
  };
  file: {
    /** Create a new wildcard file (undoable). Returns its relative path. */
    create(relativePath: string, text?: string): Promise<string>;
    /** Rename/move a file and update every reference (undoable). */
    rename(relativePath: string, newKey: string): Promise<RenameResultDto>;
    /** Delete a wildcard file and remove inbound references (undoable). */
    delete(relativePath: string): Promise<DeleteResultDto>;
  };
  expand: {
    /**
     * Expansion preview. Wildcard files, the selected Prompts `!gen.txt`,
     * or the Generation Once pick.
     */
    preview(request: ExpandRequestDto): Promise<ExpandResultDto>;
  };
  simulate: {
    /** Run a Monte Carlo selection-frequency simulation from a root file. */
    run(request: SimulateRequestDto): Promise<SimulateResultDto>;
    /** Save every simulated prompt to a .txt file, blank line between runs. */
    exportLines(request: SimulateRequestDto): Promise<SimulateExportResultDto>;
  };
  refactor: {
    /** Preview consolidating a forwarder file into its target. */
    previewConsolidate(relativePath: string): Promise<ConsolidationPreviewDto>;
    /** Execute consolidation: redirect references, then delete the forwarder. */
    consolidate(relativePath: string): Promise<ConsolidationResultDto>;
    /** Preview absorbing a forwarder's target under the forwarder's name. */
    previewAbsorb(relativePath: string): Promise<AbsorbPreviewDto>;
    /** Absorb target contents onto the forwarder name, then delete the target. */
    absorb(relativePath: string): Promise<AbsorbResultDto>;
    /** Preview renaming a file and updating references. */
    previewRename(relativePath: string, newKey: string): Promise<RenamePreviewDto>;
    /** Preview extracting the file body into a new child forwarder target. */
    previewConvertToChild(
      relativePath: string,
      childKey: string,
    ): Promise<ConvertToChildPreviewDto>;
    /** Move file contents into a new child; leave a single `__child__` reference. */
    convertToChild(
      relativePath: string,
      childKey: string,
    ): Promise<ConvertToChildResultDto>;
    /**
     * Create an empty child file and append `__child__` to the parent
     * (parent contents are kept).
     */
    createDescendant(
      parentRelativePath: string,
      childPath: string,
    ): Promise<CreateDescendantResultDto>;
    /** Remove every occurrence of an unresolved wildcard reference. */
    cleanupMissing(referenceName: string): Promise<ReferenceCleanupResultDto>;
    /** Preview ranked fixes for a cycle issue. */
    previewCycle(
      rootRelativePath: string,
      issue: CycleFixIssueSeedDto,
    ): Promise<CycleFixPreviewDto>;
    /** Apply a cycle-edge removal (undoable). */
    applyCycleFix(request: CycleFixApplyRequestDto): Promise<CycleFixResultDto>;
  };
  history: {
    state(): Promise<HistoryStateDto>;
    undo(): Promise<HistoryActionDto>;
    redo(): Promise<HistoryActionDto>;
  };
  ui: {
    getSettings(): Promise<UiSettingsDto>;
    setDetailsPanelWidth(tab: WorkspaceTabId, width: number): Promise<void>;
    setFilesPanelWidth(tab: WorkspaceTabId, width: number): Promise<void>;
    setPromptsSamplesCollapsed(collapsed: boolean): Promise<void>;
    setGenerationPreviewCollapsed(collapsed: boolean): Promise<void>;
    setGenerationPromptBoxHeights(patch: {
      additionalPositive?: number;
      negative?: number;
    }): Promise<void>;
    setPromptCoverageWindow(
      state: FloatingWindowStateDto,
    ): Promise<FloatingWindowStateDto>;
    setPromptSubstitutionsWindow(
      state: FloatingWindowStateDto,
    ): Promise<FloatingWindowStateDto>;
    setBenchmarkResultsWindow(
      state: FloatingWindowStateDto,
    ): Promise<FloatingWindowStateDto>;
    setBenchmarkResultsView(
      view: BenchmarkResultsViewDto,
    ): Promise<BenchmarkResultsViewDto>;
    setSimulationSettings(iterations: number, seed: number): Promise<void>;
    setGraphLayoutStyle(style: GraphLayoutStyle): Promise<void>;
    setWorkspaceListFilter(
      tab: WorkspaceListFilterTab,
      filter: WorkspaceListFilterDto,
    ): Promise<void>;
    setConvertChildSuffix(suffix: string): Promise<string>;
    openSettingsFolder(): Promise<void>;
    openBackupsFolder(): Promise<void>;
    getUpdateReleaseFolder(): Promise<string | null>;
    pickUpdateReleaseFolder(): Promise<string | null>;
    setUpdateReleaseFolder(folder: string | null): Promise<string | null>;
    clearUpdateReleaseFolder(): Promise<void>;
    checkForAppUpdate(): Promise<AppUpdateCheckResultDto>;
    installAppUpdate(): Promise<AppUpdateCheckResultDto>;
    getLoraFolder(): Promise<string | null>;
    pickLoraFolder(): Promise<string | null>;
    setLoraFolder(folder: string | null): Promise<string | null>;
    clearLoraFolder(): Promise<void>;
    openLoraFolder(): Promise<void>;
    getCheckpointFolder(): Promise<string | null>;
    pickCheckpointFolder(): Promise<string | null>;
    setCheckpointFolder(folder: string | null): Promise<string | null>;
    clearCheckpointFolder(): Promise<void>;
    openCheckpointFolder(): Promise<void>;
    getImagesFolder(): Promise<string | null>;
    pickImagesFolder(): Promise<string | null>;
    setImagesFolder(folder: string | null): Promise<string | null>;
    clearImagesFolder(): Promise<void>;
    openImagesFolder(): Promise<void>;
    getVideosFolder(): Promise<string | null>;
    pickVideosFolder(): Promise<string | null>;
    setVideosFolder(folder: string | null): Promise<string | null>;
    clearVideosFolder(): Promise<void>;
    openVideosFolder(): Promise<void>;
    getMastersFolder(): Promise<string | null>;
    pickMastersFolder(): Promise<string | null>;
    setMastersFolder(folder: string | null): Promise<string | null>;
    clearMastersFolder(): Promise<void>;
    openMastersFolder(): Promise<void>;
    getTrainingLibraryFolder(): Promise<string | null>;
    pickTrainingLibraryFolder(): Promise<string | null>;
    setTrainingLibraryFolder(folder: string | null): Promise<string | null>;
    clearTrainingLibraryFolder(): Promise<void>;
    openTrainingLibraryFolder(): Promise<void>;
    getPromptsFolder(): Promise<string | null>;
    pickPromptsFolder(): Promise<string | null>;
    setPromptsFolder(folder: string | null): Promise<string | null>;
    clearPromptsFolder(): Promise<void>;
    openPromptsFolder(): Promise<void>;
    getCivitaiSettings(): Promise<CivitaiSettingsDto>;
    setCivitaiOrigin(origin: CivitaiOriginDto): Promise<CivitaiOriginDto>;
    setCivitaiApiKey(key: string | null): Promise<boolean>;
    setHuggingFaceToken(token: string | null): Promise<boolean>;
    getHuggingFaceTokenStatus(): Promise<{ hasToken: boolean }>;
    setCivitaiCatalogAutoSyncInterval(minutes: number): Promise<number>;
    setDisableHardwareAcceleration(disable: boolean): Promise<boolean>;
    setGenerationSaveInNewSubfolder(enabled: boolean): Promise<boolean>;
    setCivitaiBrowseFilters(
      filters: CivitaiBrowseFiltersDto,
    ): Promise<CivitaiBrowseFiltersDto>;
    getCivitaiImageBrowseFilters(): Promise<CivitaiImageBrowseFiltersDto>;
    setCivitaiImageBrowseFilters(
      filters: CivitaiImageBrowseFiltersDto,
    ): Promise<CivitaiImageBrowseFiltersDto>;
    getCivitaiVideoBrowseFilters(): Promise<CivitaiVideoBrowseFiltersDto>;
    setCivitaiVideoBrowseFilters(
      filters: CivitaiVideoBrowseFiltersDto,
    ): Promise<CivitaiVideoBrowseFiltersDto>;
    setCivitaiSplitRatio(ratio: number): Promise<number>;
    setCivitaiCardMinWidth(px: number): Promise<number>;
    getHfBrowseFilters(): Promise<HfBrowseFiltersDto>;
    setHfBrowseFilters(filters: HfBrowseFiltersDto): Promise<HfBrowseFiltersDto>;
    clearHfBrowseFilters(): Promise<HfBrowseFiltersDto>;
    /** Suppress unused warning(s) for LoRA(s) used outside wildcard files. */
    ignoreUnusedLora(relativePath: string | string[]): Promise<void>;
    /**
     * Move unused LoRA file(s) into a download category folder and append a
     * `# LOCAL` wildcard reference (pick-list for training-step series).
     */
    categorizeUnusedLora(opts: {
      relativePaths: string[];
      loraCategoryId: string;
      /** Optional `#` comment between `# LOCAL` and `<lora:…>`. */
      extraComment?: string;
      /** Optional prompt text after triggers on the `<lora:…>` line. */
      extraPrompt?: string;
    }): Promise<CategorizeUnusedLoraResultDto>;
    /**
     * Extend existing `<lora:…>` series braces to cover unused training-step
     * files (no folder move / category pick).
     */
    extendUnusedLoraSeries(
      relativePaths: string[],
    ): Promise<ExtendUnusedLoraSeriesResultDto>;
    /**
     * This library’s generation prompt substitutions (`library.json`).
     * Applied to Use this prompt and the selected prompt folder before
     * wildcards expand.
     */
    getPromptSubstitutions(): Promise<PromptSubstitutionDto[]>;
    setPromptSubstitutions(
      rules: PromptSubstitutionDto[],
    ): Promise<PromptSubstitutionDto[]>;
    /** Search the configured LoRA folder by name (cached index; no disk walk). */
    searchLoras(query: string): Promise<LoraSearchResultDto>;
    /** Named main-process work for the status bar. */
    onMainActivity(cb: (activity: MainActivityDto) => void): () => void;
    /**
     * Cross-asset search: wildcard file names + content, LoRA names,
     * checkpoint names (per-scope, case-insensitive substring).
     */
    searchLibrary(
      query: string,
      scopes: GlobalSearchScopesDto,
    ): Promise<GlobalSearchResultDto>;
    /** Preview renaming a LoRA file and rewriting library tags. */
    previewRenameLora(
      sourceName: string,
      newBasename: string,
    ): Promise<RenameLoraPreviewDto>;
    /** Rename LoRA on disk, move hash cache, rewrite tags (tag edits undoable). */
    renameLora(
      sourceName: string,
      newBasename: string,
    ): Promise<RenameLoraResultDto>;
  };
  modelFiles: {
    listLoras(opts?: { force?: boolean }): Promise<ModelManagerListDto>;
    /**
     * Re-walk the LoRA folder only when the last scan is older than
     * `maxAgeMs` (default 3 minutes).
     */
    refreshLoraIndexIfStale(opts?: {
      maxAgeMs?: number;
    }): Promise<LoraIndexRefreshResultDto>;
    onLoraIndexRefreshed(
      cb: (info: { lastRefreshAt: number }) => void,
    ): () => void;
    listCheckpoints(opts?: { force?: boolean }): Promise<ModelManagerListDto>;
    getLoraDetail(relativePath: string): Promise<LoraManagerDetailDto>;
    /**
     * Best documented `<lora:…>` from wildcards for this LoRA (prefer `#`
     * comments + richest weights). Null when unused in the library.
     */
    getDefinedLoraReference(
      relativePath: string,
    ): Promise<DefinedLoraReferenceDto | null>;
    /**
     * Find (and cache) the training-library dataset + preview icon for a
     * multi-step LoRA series.
     */
    resolveLoraSeriesDataset(opts: {
      dir: string;
      seriesBase: string;
      separator: '_' | '-';
      force?: boolean;
    }): Promise<LoraSeriesDatasetPreviewDto>;
    /** Data URL for an image under the training library root. */
    readTrainingLibraryImage(absolutePath: string): Promise<string | null>;
    /** Read embedded safetensors training metadata (header only). */
    inspectLora(relativePath: string): Promise<LoraInspectDto>;
    getCheckpointDetail(
      relativePath: string,
    ): Promise<CheckpointManagerDetailDto>;
    readSidecarImage(absolutePath: string): Promise<string | null>;
    /**
     * Manually attach a Civitai model page URL to a local LoRA/checkpoint
     * (persisted by AutoV2 and/or absolute path).
     */
    setCivitaiLink(opts: {
      absolutePath: string;
      autoV2?: string | null;
      pageUrl: string;
    }): Promise<{
      civitaiModelId: number;
      civitaiName: string;
      civitaiPageUrl: string;
      previewUrl?: string;
    }>;
    clearCivitaiLink(opts: {
      absolutePath: string;
      autoV2?: string | null;
    }): Promise<void>;
    /** Persist a half-star rating (−1 clears / unrated). */
    setRating(opts: {
      absolutePath: string;
      autoV2?: string | null;
      rating: number;
    }): Promise<number>;
    /**
     * Tick = use this checkpoint in the active library’s Generation list and Benchmark.
     * Untick keeps the file and adds it to this library’s `ignoredCheckpoints`.
     */
    setCheckpointEnabled(opts: {
      absolutePath: string;
      enabled: boolean;
    }): Promise<boolean>;
    /** Resolve/cache masters-folder collage JPGs for a checkpoint. */
    resolveMasterImages(opts: {
      absolutePath: string;
      stem: string;
      autoV2?: string | null;
      force?: boolean;
    }): Promise<CheckpointMasterImagesDto | null>;
    /** Data URL for an image under the Checkpoint Benchmark folder. */
    readMasterImage(absolutePath: string): Promise<string | null>;
    /**
     * Delete checkpoint weight files (+ local sidecars), quarantine Benchmark
     * samples, clear rating/hash/link, and archive linked Civitai models.
     */
    deleteCheckpoints(
      relativePaths: string[],
    ): Promise<DeleteCheckpointsResultDto>;
    /**
     * Delete LoRA weight files (+ local sidecars), strip matching `<lora:…>`
     * tags from wildcards, clear rating/hash/link. Archives linked Civitai
     * only when no remaining on-disk copy still owns that model.
     */
    deleteLoras(relativePaths: string[]): Promise<DeleteLorasResultDto>;
    /** Reveal the model file in My File Explorer (`mfe://reveal`). */
    showInFolder(absolutePath: string): Promise<void>;
    /** Open the model file with the OS default handler. */
    openExternal(absolutePath: string): Promise<void>;
    /**
     * One-shot Civitai by-hash rematch for this file’s AutoV2.
     * Expands version hashes on the catalog card; does not re-download
     * an existing cover. On hash miss, may return filenameCandidates for
     * user confirmation (never auto-linked by filename).
     */
    rematchByHash(opts: {
      autoV2: string;
      kind?: 'LORA' | 'Checkpoint';
      /** Local stem or relative path — enables filename fallback candidates. */
      localStem?: string;
    }): Promise<ModelFileRematchResultDto>;
    /** TEMPORARY: match models to catalog + queue covers. */
    startPopulate(opts: {
      kind: 'LORA' | 'Checkpoint';
      force?: boolean;
    }): Promise<void>;
    onPopulateProgress(
      cb: (progress: ModelCatalogPopulateProgressDto) => void,
    ): () => void;
    /** @deprecated Prefer startPopulate({ kind: 'LORA' }). */
    startLoraPopulate(opts?: { force?: boolean }): Promise<void>;
    /** @deprecated Prefer onPopulateProgress. */
    onLoraPopulateProgress(
      cb: (progress: ModelCatalogPopulateProgressDto) => void,
    ): () => void;
  };
  huggingface: {
    searchModels(opts: {
      filters: HfBrowseFiltersDto;
      cursor?: string | null;
    }): Promise<HuggingFaceSearchResultDto>;
    openModelPage(modelId: string): Promise<void>;
    openBrowser(): Promise<{ mode: 'window' }>;
    closeBrowser(): Promise<void>;
    getModelDetail(repoId: string): Promise<HuggingFaceModelDetailDto>;
    archiveModel(repoId: string): Promise<ArchivedHfModelDto[]>;
    unarchiveModel(repoId: string): Promise<ArchivedHfModelDto[]>;
    listArchived(): Promise<ArchivedHfModelDto[]>;
    downloadModel(
      opts: HfModelDownloadOptionsDto,
    ): Promise<HfDownloadQueueSnapshotDto>;
    checkDownloadDestination(opts: {
      type: HfDownloadTypeDto;
      category?: string;
      loraCategoryId?: string;
      fileName: string;
    }): Promise<{
      absolutePath: string;
      exists: boolean;
      folder: string;
      fileName: string;
      renamed: boolean;
    }>;
    listDownloadQueue(): Promise<HfDownloadQueueSnapshotDto>;
    cancelDownloadJob(jobId: string): Promise<HfDownloadQueueSnapshotDto>;
    pauseDownloadQueue(): Promise<HfDownloadQueueSnapshotDto>;
    resumeDownloadQueue(): Promise<HfDownloadQueueSnapshotDto>;
    onDownloadProgress(cb: (progress: HfDownloadProgressDto) => void): () => void;
    onDownloadQueueChanged(
      cb: (snap: HfDownloadQueueSnapshotDto) => void,
    ): () => void;
  };
  civitai: {
    /** @deprecated Prefer getCatalogSlice + syncCatalogSlice. */
    searchModels(params: {
      type: CivitaiModelTypeDto;
      query?: string;
      cursor?: string;
      limit?: number;
      sort?: CivitaiLocalSortDto;
      nsfw?: boolean;
      includeArchived?: boolean;
      hideInstalled?: boolean;
      onlyPotentialDuplicate?: boolean;
      onlyNew?: boolean;
      architectures?: CivitaiArchitectureIdDto[];
      category?: CivitaiModelCategoryIdDto | null;
      includeWatching?: boolean;
    }): Promise<CivitaiSearchResultDto>;
    getCatalogSlice(params: {
      type: CivitaiModelTypeDto;
      query?: string;
      sort?: CivitaiLocalSortDto;
      includeArchived?: boolean;
      includeMaybe?: boolean;
      hideInstalled?: boolean;
      onlyPotentialDuplicate?: boolean;
      onlyNew?: boolean;
      architectures?: CivitaiArchitectureIdDto[];
      /** When Base Model is SDXL — narrow to Illustrious / Pony / etc. */
      sdxlFamily?: CivitaiSdxlFamilyIdDto;
      category?: CivitaiModelCategoryIdDto | null;
      includeWatching?: boolean;
      /** Id-index scan offset (from a prior nextOffset). Default 0. */
      offset?: number;
      /** Max cards to return after filters. Default 200, capped at 200. */
      limit?: number;
    }): Promise<CivitaiCatalogSliceDto>;
    /**
     * Page-enrich EA status for Browse-visible model ids only.
     * No-op when the id list is empty.
     */
    enrichBrowseEarlyAccess(params: {
      modelIds: number[];
      sliceKey?: string;
    }): Promise<number>;
    /** Background Newest sync for the active filter slice. */
    syncCatalogSlice(params: {
      type: CivitaiModelTypeDto;
      query?: string;
      architectures?: CivitaiArchitectureIdDto[];
      category?: CivitaiModelCategoryIdDto | null;
      /**
       * auto: fill only when the slice is empty; otherwise a quick Newest check.
       * fill: walk older pages until exhausted (per-run cap temporarily off).
       * incremental: Newest tip only until known ids.
       */
      mode?: 'auto' | 'incremental' | 'fill';
      /** Bypass the auto-sync interval (manual Refresh). */
      force?: boolean;
    }): Promise<CivitaiCatalogSyncProgressDto>;
    cancelCatalogSync(): Promise<void>;
    onCatalogSyncProgress(
      cb: (progress: CivitaiCatalogSyncProgressDto) => void,
    ): () => void;
    onHashWarmProgress(
      cb: (progress: CivitaiHashWarmProgressDto) => void,
    ): () => void;
    onCatalogAutoV2BackfillProgress(
      cb: (progress: CivitaiCatalogAutoV2BackfillProgressDto) => void,
    ): () => void;
    /**
     * Expand all version AutoV2 hashes on catalog cards that match the active
     * library (local LoRA/checkpoint hashes + marked installed). Skips
     * Character. Metadata only — does not re-download preview images.
     */
    startVersionHashEnrich(opts?: { force?: boolean }): Promise<void>;
    onCatalogVersionHashEnrichProgress(
      cb: (progress: CivitaiCatalogVersionHashEnrichProgressDto) => void,
    ): () => void;
    /**
     * Priority preview queue: on-screen Browse first (grid order), then the
     * active library’s LoRA/checkpoint covers, then catalog-wide backfill.
     * Re-call whenever Browse filters / loaded cards change.
     */
    prioritizePreviews(params: {
      visible: Array<string | { url: string; modelId?: number }>;
      prefetch?: Array<string | { url: string; modelId?: number }>;
    }): Promise<void>;
    /**
     * Drop pending preview jobs for hidden categories (keeps on-disk files).
     * Call when the category-visibility UI closes — not on every checkbox toggle.
     */
    syncPreviewQueueCategories(opts?: {
      reseedEnabled?: boolean;
    }): Promise<CivitaiPreviewWarmProgressDto>;
    /**
     * Background-cache preview images for many catalog URLs (skips hits).
     * @deprecated Prefer prioritizePreviews({ visible }).
     */
    warmPreviews(urls: string[]): Promise<void>;
    onPreviewWarmProgress(
      cb: (progress: CivitaiPreviewWarmProgressDto) => void,
    ): () => void;
    /** Snapshot for the visual preview downloader (3+1+3 cards). */
    getPreviewDownloadStrip(): Promise<CivitaiPreviewDownloadStripDto>;
    getModel(modelId: number): Promise<CivitaiModelCardDto>;
    /** Versions + weight files for the download confirm dialog. */
    listModelDownloadOptions(
      modelId: number,
      opts?: { browseArchitectures?: CivitaiArchitectureIdDto[] },
    ): Promise<CivitaiModelDownloadOptionsDto>;
    /** Fetch full version list + AutoV2 install rows for a model card. */
    refreshModelVersionInstalls(
      modelId: number,
      typeHint?: CivitaiModelTypeDto,
    ): Promise<CivitaiModelCardDto>;
    archiveModel(modelId: number): Promise<ArchivedCivitaiModelDto[]>;
    /** Bulk-archive model ids (one settings write). Returns how many were newly archived. */
    archiveModels(
      modelIds: number[],
    ): Promise<{ archived: ArchivedCivitaiModelDto[]; archivedCount: number }>;
    unarchiveModel(modelId: number): Promise<ArchivedCivitaiModelDto[]>;
    listArchived(): Promise<ArchivedCivitaiModelDto[]>;
    listArchivedCards(): Promise<CivitaiModelCardDto[]>;
    searchImages(
      params: CivitaiImageSearchParamsDto,
    ): Promise<CivitaiImageSearchResultDto>;
    downloadImage(params: {
      imageId: number;
      url: string;
      baseModel?: string | null;
      username?: string | null;
      fileName?: string;
      /** Civitai upload time — stamped onto the saved file’s mtime. */
      createdAt?: string | null;
      width?: number | null;
    }): Promise<CivitaiImageDownloadResultDto>;
    listDownloadedImages(): Promise<DownloadedCivitaiImageDto[]>;
    /** Lightweight id list for O(1) browse skip Sets (preferred at large scale). */
    listDownloadedImageIds(): Promise<number[]>;
    archiveImage(imageId: number): Promise<{ total: number }>;
    archiveImages(
      imageIds: number[],
    ): Promise<{ archivedCount: number; total: number }>;
    unarchiveImage(imageId: number): Promise<{ total: number }>;
    /** Image ids only — never ship 10k+ `{origin,imageId}` objects over IPC. */
    listArchivedImages(): Promise<number[]>;
    openDownloadedImage(absolutePath: string): Promise<void>;
    onImageDownloadProgress(
      cb: (progress: CivitaiImageDownloadProgressDto) => void,
    ): () => void;
    /** Background Download all — continues while on LORA/Checkpoint or modal closed. */
    startImageDownloadAll(
      params?: CivitaiImageDownloadAllRequestDto,
    ): Promise<CivitaiImageDownloadAllStatusDto>;
    stopImageDownloadAll(): Promise<CivitaiImageDownloadAllStatusDto>;
    getImageDownloadAllStatus(): Promise<CivitaiImageDownloadAllStatusDto>;
    onImageDownloadAllProgress(
      cb: (status: CivitaiImageDownloadAllStatusDto) => void,
    ): () => void;
    /**
     * Browse catch-up against the Download-all tip watermark. A few archived
     * pages alone must not stop the walk — only re-entering the recorded tip
     * (or API end) does.
     */
    evaluateBrowseCatchUp(
      request: CivitaiBrowseCatchUpEvaluateRequestDto,
    ): Promise<CivitaiBrowseCatchUpEvaluateResultDto>;
    noteBrowseResumeCursor(
      request: CivitaiBrowseCatchUpResumeRequestDto,
    ): Promise<void>;
    commitBrowseCatchUp(
      request: CivitaiBrowseCatchUpCommitRequestDto,
    ): Promise<void>;
    searchVideos(
      params: CivitaiVideoSearchParamsDto,
    ): Promise<CivitaiVideoSearchResultDto>;
    downloadVideo(params: {
      imageId: number;
      url: string;
      baseModel?: string | null;
      username?: string | null;
      fileName?: string;
      /** Civitai upload time — stamped onto the saved file’s mtime. */
      createdAt?: string | null;
      width?: number | null;
    }): Promise<CivitaiVideoDownloadResultDto>;
    listDownloadedVideos(): Promise<DownloadedCivitaiVideoDto[]>;
    listDownloadedVideoIds(): Promise<number[]>;
    archiveVideo(imageId: number): Promise<{ total: number }>;
    archiveVideos(
      imageIds: number[],
    ): Promise<{ archivedCount: number; total: number }>;
    unarchiveVideo(imageId: number): Promise<{ total: number }>;
    listArchivedVideos(): Promise<number[]>;
    openDownloadedVideo(absolutePath: string): Promise<void>;
    onVideoDownloadProgress(
      cb: (progress: CivitaiVideoDownloadProgressDto) => void,
    ): () => void;
    startVideoDownloadAll(
      params?: CivitaiVideoDownloadAllRequestDto,
    ): Promise<CivitaiVideoDownloadAllStatusDto>;
    stopVideoDownloadAll(): Promise<CivitaiVideoDownloadAllStatusDto>;
    getVideoDownloadAllStatus(): Promise<CivitaiVideoDownloadAllStatusDto>;
    onVideoDownloadAllProgress(
      cb: (status: CivitaiVideoDownloadAllStatusDto) => void,
    ): () => void;
    maybeModel(modelId: number): Promise<MaybeCivitaiModelDto[]>;
    unmaybeModel(modelId: number): Promise<MaybeCivitaiModelDto[]>;
    listMaybe(): Promise<MaybeCivitaiModelDto[]>;
    listMaybeCards(): Promise<CivitaiModelCardDto[]>;
    /** Hide Browse cards from this creator (per library / origin). */
    blockCreator(username: string): Promise<BlockedCivitaiCreatorDto[]>;
    unblockCreator(username: string): Promise<BlockedCivitaiCreatorDto[]>;
    listBlockedCreators(): Promise<BlockedCivitaiCreatorDto[]>;
    /** Cached models that are installed locally (or marked installed). */
    listInstalledCards(): Promise<CivitaiModelCardDto[]>;
    /**
     * Instant Archive / Maybe / Downloaded badge rows from local ids + catalog
     * cache. Does not walk the catalog or call Civitai.
     */
    listShelfSummaries(): Promise<CivitaiShelfSummariesDto>;
    /** Treat a model as installed (e.g. confirm a possible local match). */
    markInstalled(modelId: number): Promise<void>;
    /** Mark one version/file variant as downloaded (download dialog). */
    markVersionInstalled(params: {
      modelId: number;
      versionId: number;
      fileId: number;
      fileName?: string;
    }): Promise<void>;
    unmarkInstalled(modelId: number): Promise<void>;
    watchModel(params: {
      modelId: number;
      modelName: string;
      type: CivitaiModelTypeDto;
      versionId?: number;
      earlyAccessEndsAt?: string;
    }): Promise<WatchedCivitaiModelDto[]>;
    unwatchModel(modelId: number): Promise<WatchedCivitaiModelDto[]>;
    listWatchlist(): Promise<WatchedCivitaiModelDto[]>;
    /** Re-fetch each watched model; mark newly public ones as available. */
    refreshWatchlist(opts?: {
      /** When false, skip model-page scrapes (background poll). Default true. */
      allowPageScrape?: boolean;
    }): Promise<{
      items: WatchedCivitaiModelDto[];
      newlyAvailable: WatchedCivitaiModelDto[];
    }>;
    /** Models that left Notify after unlock — pinned until dismissed. */
    listRecentlyUnlocked(): Promise<WatchedCivitaiModelDto[]>;
    dismissRecentlyUnlocked(modelId: number): Promise<WatchedCivitaiModelDto[]>;
    downloadModel(params: {
      modelId: number;
      versionId?: number;
      /** Specific file on the version (when a version has multiple weights). */
      fileId?: number;
      type: CivitaiModelTypeDto;
      /** Checkpoint / legacy: sub-folder under the model root. Empty = root. */
      category?: string;
      /** LoRA: primary download category id (folder + wildcard + weights). */
      loraCategoryId?: string;
      /**
       * LoRA: additional category ids — append the same `<lora:…>` snippet to
       * each category’s wildcard (file still lands in the primary folder).
       */
      extraLoraCategoryIds?: string[];
      /** LoRA: weight pattern for the `<lora:…>` snippet. */
      weights?: string;
      /** LoRA: optional `#` comment between URL and `<lora:…>`. */
      extraComment?: string;
      /** LoRA: optional prompt text after triggers on the `<lora:…>` line. */
      extraPrompt?: string;
      /** Display name for queue / status UI. */
      modelName?: string;
      /** On-disk file name override (basename; extension optional). */
      fileName?: string;
    }): Promise<CivitaiDownloadResultDto>;
    /**
     * Validate save name (no V1… / optimizer… stems) and ensure the destination
     * path is free. Never auto-renames — caller must pick another name on collision.
     */
    checkDownloadDestination(params: {
      type: CivitaiModelTypeDto;
      fileName: string;
      fallbackFileName?: string;
      category?: string;
      loraCategoryId?: string;
    }): Promise<CivitaiDownloadDestinationCheckDto>;
    listDownloadQueue(): Promise<CivitaiDownloadQueueSnapshotDto>;
    cancelDownloadQueueItem(modelId: number): Promise<CivitaiDownloadQueueSnapshotDto>;
    resumeDownloadQueue(): Promise<CivitaiDownloadQueueSnapshotDto>;
    pauseDownloadQueue(reason?: string): Promise<CivitaiDownloadQueueSnapshotDto>;
    /**
     * Close all UI windows and keep draining the download queue in the
     * system tray (frees VRAM for training).
     */
    enterBackgroundDownloads(): Promise<boolean>;
    moveDownloadQueueItem(
      modelId: number,
      delta: -1 | 1,
    ): Promise<CivitaiDownloadQueueSnapshotDto>;
    reorderDownloadQueue(
      orderedModelIds: number[],
    ): Promise<CivitaiDownloadQueueSnapshotDto>;
    updateDownloadQueueItem(
      modelId: number,
      patch: {
        loraCategoryId?: string;
        extraLoraCategoryIds?: string[];
        category?: string;
        weights?: string;
        extraComment?: string;
        extraPrompt?: string;
        versionId?: number;
        fileId?: number;
        fileName?: string;
      },
    ): Promise<CivitaiDownloadQueueSnapshotDto>;
    listDownloadCategories(
      type: CivitaiModelTypeDto,
    ): Promise<CivitaiDownloadCategoryDto>;
    createDownloadCategory(
      type: CivitaiModelTypeDto,
      name: string,
    ): Promise<CivitaiDownloadCategoryDto>;
    listLoraDownloadCategories(opts?: {
      includeWildcardFiles?: boolean;
    }): Promise<LoraDownloadCategoryListDto>;
    createLoraDownloadCategory(input: {
      name: string;
      folder: string;
      wildcardRelativePath: string;
      defaultWeights?: string;
    }): Promise<LoraDownloadCategoryListDto>;
    updateLoraDownloadCategory(
      id: string,
      input: {
        name: string;
        folder: string;
        wildcardRelativePath: string;
        defaultWeights?: string;
      },
    ): Promise<LoraDownloadCategoryListDto>;
    deleteLoraDownloadCategory(id: string): Promise<LoraDownloadCategoryListDto>;
    /**
     * Open a directory picker under the LoRA root. Returns the relative
     * folder path (may be nested), or null if cancelled.
     */
    pickLoraCategoryFolder(): Promise<string | null>;
    openModelPage(modelId: number, modelName: string): Promise<void>;
    /**
     * Deterministic `wcm-preview://` URL for the on-disk thumbnail of a remote
     * preview (sync, no I/O). Put straight into `<img src>`; on load error the
     * caller downloads once via `cachePreview`.
     */
    localPreviewUrl(url: string): string;
    /**
     * Download a Civitai preview once into the local disk cache and return a
     * `wcm-preview://` URL. Returns null if caching fails.
     */
    cachePreview(url: string): Promise<string | null>;
    /** Delete the cached preview and download it again. */
    refreshPreview(url: string): Promise<string | null>;
    /** Local user override preview for a model, if any. */
    getCustomPreview(modelId: number): Promise<string | null>;
    /** Save clipboard image as this model's preview. Null if clipboard has no image. */
    setCustomPreviewFromClipboard(modelId: number): Promise<string | null>;
    /** Open Civitai using the remembered attach/detach preference. */
    openBrowser(): Promise<{ mode: 'modal' | 'window' }>;
    /**
     * Open the Civitai browser (modal or detached window) and focus a model.
     * Main window should open the modal when `mode` is `'modal'`.
     */
    focusModelInBrowser(
      model: CivitaiFocusModelDto,
    ): Promise<{ mode: 'modal' | 'window' }>;
    /** Detach into a separate OS window (and remember). */
    detachBrowser(): Promise<{ mode: 'window' }>;
    /** Attach back into the main window as a modal (and remember). */
    attachBrowser(): Promise<{ mode: 'modal' }>;
    /** Close the detached Civitai window if open. */
    closeBrowser(): Promise<void>;
    /** Main window: open the attached modal when the detached window attaches. */
    onOpenAttached(cb: () => void): () => void;
    /** Modal or detached window: focus a model from an external request. */
    onFocusModel(cb: (model: CivitaiFocusModelDto) => void): () => void;
    /**
     * Focus the main window and select a local file that matched this Civitai
     * card (LoRA or Checkpoint tab).
     */
    revealLocalFile(params: {
      type: CivitaiModelTypeDto;
      relativePath: string;
    }): Promise<void>;
    /** Main window: handle revealLocalFile from the Civitai modal/window. */
    onRevealLocalFile(
      cb: (params: {
        type: CivitaiModelTypeDto;
        relativePath: string;
      }) => void,
    ): () => void;
    onDownloadProgress(
      cb: (progress: CivitaiDownloadProgressDto) => void,
    ): () => void;
    /** Recent download/API console lines (ring buffer). */
    listDownloadLog(): Promise<DownloadLogEntryDto[]>;
    clearDownloadLog(): Promise<DownloadLogEntryDto[]>;
    onDownloadLog(cb: (entry: DownloadLogEntryDto) => void): () => void;
  };
  prompts: {
    listTree(): Promise<PromptTreeDto>;
    readGen(relativeFolder: string): Promise<PromptGenFileDto>;
    writeGen(relativeFolder: string, content: string): Promise<PromptGenFileDto>;
    createGen(relativeFolder: string): Promise<PromptGenFileDto>;
    /**
     * Create “New folder” under `parentRelativeFolder` ('' = prompts root).
     * Caller should enter inline rename on the returned path.
     */
    createFolder(
      parentRelativeFolder: string,
    ): Promise<{ relativeFolder: string; name: string }>;
    renameFolder(
      relativeFolder: string,
      newName: string,
    ): Promise<{ relativeFolder: string }>;
    /**
     * Native confirm, then permanently delete the folder tree.
     * `deleted: false` when the user cancels.
     */
    deleteFolder(
      relativeFolder: string,
    ): Promise<{ deleted: boolean }>;
    /** Decode !gen.txt into the Generation in-memory prompt list (folder change). */
    loadGenPrompts(
      relativeFolder: string,
    ): Promise<{ relativeFolder: string; count: number }>;
    listSamples(
      relativeFolder: string,
      limit?: number,
      seed?: number,
    ): Promise<PromptSampleImageDto[]>;
    /** Check every `!gen.txt` for missing wildcards and other file issues. */
    validateAll(): Promise<GenPromptValidationReportDto>;
    /** Re-check one folder's `!gen.txt`. Null when that file does not exist. */
    validateFolder(
      relativeFolder: string,
    ): Promise<GenPromptValidationFileDto | null>;
    /** Same checks as `!gen.txt`, for text that is not saved to a file yet. */
    validateText(text: string): Promise<GenPromptValidationFileDto>;
    /** Start background coverage simulation (returns immediately). */
    startCoverage(
      request?: PromptCoverageStartRequestDto,
    ): Promise<PromptCoverageStartResultDto>;
    cancelCoverage(): Promise<void>;
    getCoverageReport(): Promise<PromptCoverageReportDto | null>;
    getCoverageProgress(): Promise<PromptCoverageProgressDto | null>;
    revealCoverageReport(): Promise<void>;
    /**
     * Drop deleted wildcards and re-scan !gen.txt refs so Never Used updates
     * without a full coverage re-run.
     */
    refreshCoverageNeverUsed(): Promise<PromptCoverageRefreshResultDto>;
    /** Add/remove wildcard keys on the Coverage Never Used ignore list. */
    patchCoverageIgnore(
      patch: PromptCoverageIgnorePatchDto,
    ): Promise<PromptCoverageReportDto>;
    onCoverageProgress(
      cb: (progress: PromptCoverageProgressDto) => void,
    ): () => void;
  };
  comfy: {
    getConnection(): Promise<ComfyConnectionDto>;
    setConnection(
      patch: Partial<ComfyConnectionDto> & { apiKey?: string | null },
    ): Promise<ComfyConnectionDto>;
    pickGenerationFolder(): Promise<string | null>;
    pickLaunchPath(): Promise<string | null>;
    testConnection(): Promise<ComfyConnectionTestDto>;
    getModelCatalog(): Promise<ComfyModelCatalogDto>;
    checkContract(
      workflow?: Record<string, unknown>,
    ): Promise<ComfyContractCheckDto>;
    getWorkflowProfile(): Promise<ComfyWorkflowProfileDto | null>;
    saveWorkflowProfile(
      profile: ComfyWorkflowProfileDto,
    ): Promise<ComfySaveWorkflowResultDto>;
    startGeneration(request: GenerationStartRequestDto): Promise<void>;
    cancelGeneration(): Promise<void>;
    onGenerationProgress(cb: (progress: GenerationProgressDto) => void): () => void;
    getGenerationForm(): Promise<GenerationFormLoadedDto>;
    setGenerationForm(
      patch: Partial<GenerationFormStateDto>,
    ): Promise<GenerationFormStateDto>;
    /** Next checkpoint / counts / fastest-slowest from benchmark-stats.json. */
    getCheckpointBenchmarkStatus(): Promise<CheckpointBenchmarkStatusDto>;
    /** Full per-checkpoint avg timings for the Benchmark results chart. */
    getCheckpointBenchmarkResults(): Promise<CheckpointBenchmarkResultsDto>;
    /** Confirm, then delete the Last output image from disk. */
    deleteLastGeneration(): Promise<{ deleted: boolean }>;
    /** Reveal the Last output image in My File Explorer. */
    revealLastGeneration(): Promise<void>;
  };
  lmStudio: {
    getConnection(): Promise<LmStudioConnectionDto>;
    setConnection(
      patch: Partial<LmStudioConnectionDto> & { apiKey?: string | null },
    ): Promise<LmStudioConnectionDto>;
    testConnection(): Promise<LmStudioConnectionTestDto>;
    listModels(): Promise<string[]>;
    /**
     * Propose AI assistance for one wildcard file. Never writes to disk —
     * renderer must preview and confirm before applying.
     */
    assistWildcard(
      request: LmStudioAssistRequestDto,
    ): Promise<LmStudioAssistResultDto>;
    getPromptLibrary(): Promise<LmStudioPromptLibraryDto>;
    setPromptSession(
      session: Partial<LmStudioPromptSessionDto>,
    ): Promise<LmStudioPromptLibraryDto>;
    upsertSavedPrompt(input: {
      id?: string;
      name: string;
      preset: LmStudioAssistPresetIdDto;
      instruction: string;
    }): Promise<LmStudioPromptLibraryDto>;
    renameSavedPrompt(
      id: string,
      name: string,
    ): Promise<LmStudioPromptLibraryDto>;
    deleteSavedPrompt(id: string): Promise<LmStudioPromptLibraryDto>;
  };
  watch: {
    start(): Promise<void>;
    stop(): Promise<void>;
    onChanged(cb: () => void): () => void;
  };
};
