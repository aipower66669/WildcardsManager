import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  LIBRARY_PATH_FOLDER_FIELDS,
  normalizePathPrefix,
  planLibraryPathMigration,
  suggestMigrationOldPrefix,
  remapMasterImagesStore,
  remapRecentRoots,
  remapTrainingLibraryRoot,
  type LibraryPathFolderField,
  type LibraryPathMigrationPlan,
  type MasterImagesStoreLike,
} from '../domain/libraryPathMigrate.js';
import {
  getWildcardsSidecarAppDataDir,
  isFilesystemRootPath,
  masterImagesJsonPath,
  modelsJsonPath,
  wildcardsSidecarRoot,
} from '../domain/librarySidecarPaths.js';
import type {
  LibraryPathMigrationApplyResultDto,
  LibraryPathMigrationFolderDto,
  LibraryPathMigrationPlanDto,
  LibraryPathMigrationRequestDto,
} from '../shared/contracts.js';
import { atomicWriteFile, readJsonFile } from './librarySidecarIo.js';
import { bindActiveLibraryDataRoots } from './libraryDataMigration.js';
import { invalidateCheckpointIndexCache } from './checkpointService.js';
import { invalidateLoraIndexCache } from './loraService.js';
import { prepareModelDownloadQueueLibrarySwitch } from './civitaiModelDownloadQueue.js';
import {
  getActiveLibraryId,
  listLibraryConfigs,
  loadSettings,
  saveSettings,
  updateLibraryConfig,
  type LibraryConfig,
} from './settingsStore.js';

const FOLDER_LABELS: Record<LibraryPathFolderField, string> = {
  wildcardsRoot: 'Wildcards folder',
  loraFolder: 'LoRA folder',
  checkpointFolder: 'Checkpoint folder',
  imagesFolder: 'Images folder',
  videosFolder: 'Videos folder',
  mastersFolder: 'Checkpoint masters folder',
  trainingLibraryFolder: 'LoRA training library',
  promptsFolder: 'Prompts folder',
  generationOutputRealistic: 'Generation output (Realistic)',
  generationOutputHentai: 'Generation output (Hentai)',
  generationOutput3d: 'Generation output (3D)',
  benchmarkOutputFolder: 'Checkpoint Benchmark folder',
};

function settingsJsonPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function dirExists(p: string | null | undefined): boolean {
  if (!p?.trim()) return false;
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(p: string | null | undefined): boolean {
  if (!p?.trim()) return false;
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function foldersSnapshot(lib: LibraryConfig) {
  return {
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
  };
}

function getLibraryOrThrow(libraryId: string): LibraryConfig {
  const lib = listLibraryConfigs().find((row) => row.id === libraryId);
  if (!lib) throw new Error('Library not found');
  return lib;
}

export function suggestLibraryPathMigrationPrefix(
  libraryId: string,
): string | null {
  const lib = getLibraryOrThrow(libraryId);
  return suggestMigrationOldPrefix(
    Object.values(foldersSnapshot(lib)),
    lib.wildcardsRoot,
  );
}

function estimateMasterImagesRemap(
  checkpointFolder: string | null,
  oldPrefix: string,
  newPrefix: string,
): { path: string | null; exists: boolean; estimate: number } {
  if (!checkpointFolder?.trim()) {
    return { path: null, exists: false, estimate: 0 };
  }
  const file = masterImagesJsonPath(checkpointFolder);
  if (!fileExists(file)) {
    return { path: file, exists: false, estimate: 0 };
  }
  const raw = readJsonFile<MasterImagesStoreLike>(file);
  if (!raw) return { path: file, exists: true, estimate: 0 };
  const { remappedEntries } = remapMasterImagesStore(
    raw,
    oldPrefix,
    newPrefix,
  );
  return { path: file, exists: true, estimate: remappedEntries };
}

function seriesDatasetsInfo(
  loraFolder: string | null,
  oldPrefix: string,
  newPrefix: string,
): { path: string | null; exists: boolean; wouldRemap: boolean } {
  if (!loraFolder?.trim()) {
    return { path: null, exists: false, wouldRemap: false };
  }
  const file = path.join(
    path.resolve(loraFolder),
    '!.wcm',
    'series-datasets.json',
  );
  if (!fileExists(file)) {
    return { path: file, exists: false, wouldRemap: false };
  }
  const raw = readJsonFile<{ trainingLibraryRoot?: string }>(file);
  const root =
    typeof raw?.trainingLibraryRoot === 'string'
      ? raw.trainingLibraryRoot
      : '';
  const { changed } = remapTrainingLibraryRoot(root, oldPrefix, newPrefix);
  return { path: file, exists: true, wouldRemap: changed };
}

function driveRootSidecarPlan(
  oldWildcards: string | null,
  newWildcards: string | null,
): NonNullable<
  LibraryPathMigrationPlanDto['sidecar']['driveRootSidecarRename']
> | null {
  const appDataLibs = getWildcardsSidecarAppDataDir();
  if (!appDataLibs || !oldWildcards?.trim() || !newWildcards?.trim()) {
    return null;
  }
  const oldRes = path.resolve(oldWildcards);
  const newRes = path.resolve(newWildcards);
  if (!isFilesystemRootPath(oldRes) && !isFilesystemRootPath(newRes)) {
    return null;
  }
  const from = wildcardsSidecarRoot(oldRes);
  const to = wildcardsSidecarRoot(newRes);
  if (path.resolve(from).toLowerCase() === path.resolve(to).toLowerCase()) {
    return {
      from,
      to,
      needed: false,
      fromExists: dirExists(from),
      toExists: dirExists(to),
    };
  }
  // Only AppData libraries/<id> renames are handled here.
  const underAppData = (p: string) =>
    path.resolve(p).toLowerCase().startsWith(
      path.resolve(appDataLibs).toLowerCase() + path.sep,
    );
  if (!underAppData(from) && !underAppData(to)) return null;
  return {
    from,
    to,
    needed: true,
    fromExists: dirExists(from),
    toExists: dirExists(to),
  };
}

function folderNote(
  field: LibraryPathFolderField,
  newPath: string | null,
  newExists: boolean,
): string | undefined {
  if (!newPath || !newExists) return undefined;
  if (field === 'wildcardsRoot') {
    const sidecar = wildcardsSidecarRoot(newPath);
    if (!dirExists(sidecar)) {
      return `Wildcards sidecar missing next to new root (${path.basename(sidecar)}). Move it with the wildcards folder.`;
    }
  }
  if (field === 'loraFolder' || field === 'checkpointFolder') {
    const models = modelsJsonPath(newPath);
    if (!fileExists(models) && !dirExists(path.dirname(models))) {
      return `No !.wcm under new ${field === 'loraFolder' ? 'LoRA' : 'checkpoint'} folder — hashes/ratings may need a rebuild if you did not move sidecars.`;
    }
  }
  return undefined;
}

function buildPlanDto(
  lib: LibraryConfig,
  pure: LibraryPathMigrationPlan,
): LibraryPathMigrationPlanDto {
  const folders: LibraryPathMigrationFolderDto[] = pure.folders.map((row) => {
    const newExists = dirExists(row.newPath);
    return {
      field: row.field,
      label: FOLDER_LABELS[row.field],
      oldPath: row.oldPath,
      newPath: row.newPath,
      changed: row.changed,
      underPrefix: row.underPrefix,
      override: row.override,
      newExists,
      note: folderNote(row.field, row.newPath, newExists),
    };
  });

  const warnings = [...pure.warnings];
  for (const row of folders) {
    if (row.note) warnings.push(row.note);
  }

  const blockingErrors: string[] = [];
  if (!pure.oldPrefix) blockingErrors.push('Old path prefix is required.');
  if (!pure.newPrefix) blockingErrors.push('New path prefix is required.');

  const requiredFields: LibraryPathFolderField[] = [
    'wildcardsRoot',
    'loraFolder',
    'checkpointFolder',
  ];
  for (const field of requiredFields) {
    const row = folders.find((f) => f.field === field);
    if (!row?.oldPath) continue;
    if (!row.newPath) {
      blockingErrors.push(`${FOLDER_LABELS[field]} would become empty.`);
      continue;
    }
    if (!row.newExists) {
      blockingErrors.push(
        `${FOLDER_LABELS[field]} does not exist at the new path. Move the folder first, then apply.`,
      );
    }
  }

  const newCheckpoint =
    folders.find((f) => f.field === 'checkpointFolder')?.newPath ?? null;
  const newLora = folders.find((f) => f.field === 'loraFolder')?.newPath ?? null;
  const oldWildcards = lib.wildcardsRoot;
  const newWildcards =
    folders.find((f) => f.field === 'wildcardsRoot')?.newPath ?? null;

  const masters = estimateMasterImagesRemap(
    newCheckpoint,
    pure.oldPrefix,
    pure.newPrefix,
  );
  const series = seriesDatasetsInfo(newLora, pure.oldPrefix, pure.newPrefix);
  const drive = driveRootSidecarPlan(oldWildcards, newWildcards);
  if (drive?.needed && drive.fromExists && drive.toExists) {
    warnings.push(
      'Drive-root wildcards sidecar already exists at the new AppData id; the old sidecar will not be overwritten.',
    );
  } else if (drive?.needed && !drive.fromExists && isFilesystemRootPath(path.resolve(oldWildcards ?? ''))) {
    warnings.push(
      'Drive-root wildcards sidecar not found at the old AppData id — library.json / catalog may be missing after remap.',
    );
  }

  const settings = loadSettings();
  const recent = remapRecentRoots(
    settings.recentRoots ?? [],
    pure.oldPrefix,
    pure.newPrefix,
  );

  const wildcardsSidecarPath = newWildcards
    ? wildcardsSidecarRoot(newWildcards)
    : null;

  if (!folders.some((f) => f.changed) && !drive?.needed) {
    if (!blockingErrors.length) {
      warnings.push('Nothing to apply for this library.');
    }
  }

  const canApply =
    blockingErrors.length === 0 &&
    (folders.some((f) => f.changed) ||
      Boolean(drive?.needed && drive.fromExists && !drive.toExists) ||
      masters.estimate > 0 ||
      series.wouldRemap ||
      recent.remappedCount > 0);

  return {
    libraryId: lib.id,
    libraryName: lib.name,
    oldPrefix: pure.oldPrefix,
    newPrefix: pure.newPrefix,
    suggestedOldPrefix: suggestLibraryPathMigrationPrefix(lib.id),
    folders,
    warnings,
    blockingErrors,
    canApply,
    sidecar: {
      masterImagesPath: masters.path,
      masterImagesExists: masters.exists,
      masterImagesRemapEstimate: masters.estimate,
      seriesDatasetsPath: series.path,
      seriesDatasetsExists: series.exists,
      seriesDatasetsWouldRemap: series.wouldRemap,
      wildcardsSidecarPath,
      wildcardsSidecarExists: dirExists(wildcardsSidecarPath),
      driveRootSidecarRename: drive,
      recentRootsRemapEstimate: recent.remappedCount,
    },
  };
}

/** Dry-run path migration for a library. */
export function planLibraryPathMigrationForLibrary(
  req: LibraryPathMigrationRequestDto,
): LibraryPathMigrationPlanDto {
  const lib = getLibraryOrThrow(req.libraryId.trim());
  const pure = planLibraryPathMigration({
    folders: foldersSnapshot(lib),
    oldPrefix: req.oldPrefix,
    newPrefix: req.newPrefix,
    folderOverrides: req.folderOverrides,
  });
  return buildPlanDto(lib, pure);
}

function backupSettingsJson(): string | null {
  const src = settingsJsonPath();
  if (!fs.existsSync(src)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(
    app.getPath('userData'),
    `settings.pre-migrate-${stamp}.json`,
  );
  fs.copyFileSync(src, dest);
  return dest;
}

function rewriteMasterImagesAt(
  checkpointFolder: string,
  oldPrefix: string,
  newPrefix: string,
): number {
  const file = masterImagesJsonPath(checkpointFolder);
  if (!fileExists(file)) return 0;
  const raw = readJsonFile<MasterImagesStoreLike>(file);
  if (!raw) return 0;
  const { store, remappedEntries } = remapMasterImagesStore(
    raw,
    oldPrefix,
    newPrefix,
  );
  if (remappedEntries === 0) return 0;
  atomicWriteFile(
    file,
    `${JSON.stringify(
      {
        version: store.version ?? 1,
        byPath: store.byPath,
        byAutoV2: store.byAutoV2,
      },
      null,
      2,
    )}\n`,
  );
  return remappedEntries;
}

function rewriteSeriesDatasetsAt(
  loraFolder: string,
  oldPrefix: string,
  newPrefix: string,
): boolean {
  const file = path.join(
    path.resolve(loraFolder),
    '!.wcm',
    'series-datasets.json',
  );
  if (!fileExists(file)) return false;
  const raw = readJsonFile<{
    version?: number;
    trainingLibraryRoot?: string;
    bySeriesKey?: Record<string, { datasetRelativePath: string }>;
  }>(file);
  if (!raw || typeof raw !== 'object') return false;
  const root =
    typeof raw.trainingLibraryRoot === 'string' ? raw.trainingLibraryRoot : '';
  const { next, changed } = remapTrainingLibraryRoot(
    root,
    oldPrefix,
    newPrefix,
  );
  if (!changed) return false;
  atomicWriteFile(
    file,
    `${JSON.stringify(
      {
        version: raw.version ?? 2,
        trainingLibraryRoot: next,
        bySeriesKey: raw.bySeriesKey ?? {},
      },
      null,
      2,
    )}\n`,
  );
  return true;
}

function relocateDriveRootSidecar(
  plan: NonNullable<
    LibraryPathMigrationPlanDto['sidecar']['driveRootSidecarRename']
  >,
  warnings: string[],
): boolean {
  if (!plan.needed) return false;
  if (!plan.fromExists) return false;
  if (plan.toExists) {
    warnings.push(
      'Skipped moving drive-root wildcards sidecar — destination already exists.',
    );
    return false;
  }
  fs.mkdirSync(path.dirname(plan.to), { recursive: true });
  fs.renameSync(plan.from, plan.to);
  return true;
}

/** Apply path migration after the user has moved files on disk. */
export function applyLibraryPathMigration(
  req: LibraryPathMigrationRequestDto,
): LibraryPathMigrationApplyResultDto {
  const plan = planLibraryPathMigrationForLibrary(req);
  if (!plan.canApply) {
    throw new Error(
      plan.blockingErrors[0] ??
        plan.warnings[0] ??
        'Migration cannot be applied',
    );
  }

  const lib = getLibraryOrThrow(req.libraryId.trim());
  const warnings = [...plan.warnings];
  const wasActive = getActiveLibraryId() === lib.id;

  if (wasActive) {
    try {
      prepareModelDownloadQueueLibrarySwitch();
    } catch {
      // ignore
    }
  }

  const backupPath = backupSettingsJson();
  const oldPrefix = plan.oldPrefix;
  const newPrefix = plan.newPrefix;

  // Sidecars live at the *new* roots (user already moved the tree).
  const newCheckpoint =
    plan.folders.find((f) => f.field === 'checkpointFolder')?.newPath ?? null;
  const newLora =
    plan.folders.find((f) => f.field === 'loraFolder')?.newPath ?? null;

  let masterImagesRemapped = 0;
  if (newCheckpoint) {
    masterImagesRemapped = rewriteMasterImagesAt(
      newCheckpoint,
      oldPrefix,
      newPrefix,
    );
  }

  let seriesDatasetsRemapped = false;
  if (newLora) {
    seriesDatasetsRemapped = rewriteSeriesDatasetsAt(
      newLora,
      oldPrefix,
      newPrefix,
    );
  }

  let driveRootSidecarMoved = false;
  if (plan.sidecar.driveRootSidecarRename) {
    driveRootSidecarMoved = relocateDriveRootSidecar(
      plan.sidecar.driveRootSidecarRename,
      warnings,
    );
  }

  const patch: Partial<
    Pick<
      LibraryConfig,
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
      | 'benchmarkOutputFolder'
    >
  > = {};
  let foldersChanged = 0;
  for (const field of LIBRARY_PATH_FOLDER_FIELDS) {
    const row = plan.folders.find((f) => f.field === field);
    if (!row?.changed) continue;
    patch[field] = row.newPath;
    foldersChanged += 1;
  }
  if (foldersChanged > 0) {
    updateLibraryConfig(lib.id, patch);
  }

  const settings = loadSettings();
  const recent = remapRecentRoots(
    settings.recentRoots ?? [],
    oldPrefix,
    newPrefix,
  );
  let recentRootsRemapped = recent.remappedCount;
  const settingsPatch: {
    recentRoots?: string[];
    lastRoot?: string;
  } = {};
  if (recentRootsRemapped > 0) {
    settingsPatch.recentRoots = recent.next;
  }
  if (
    typeof settings.lastRoot === 'string' &&
    settings.lastRoot.trim()
  ) {
    const remappedLast = remapRecentRoots(
      [settings.lastRoot],
      oldPrefix,
      newPrefix,
    );
    if (remappedLast.remappedCount > 0) {
      settingsPatch.lastRoot = remappedLast.next[0];
      recentRootsRemapped += remappedLast.remappedCount;
    }
  }
  if (Object.keys(settingsPatch).length > 0) {
    saveSettings(settingsPatch);
  }

  if (wasActive) {
    invalidateLoraIndexCache();
    invalidateCheckpointIndexCache();
    try {
      bindActiveLibraryDataRoots();
    } catch {
      // ignore
    }
  }

  return {
    libraryId: lib.id,
    applied: true,
    backupPath,
    foldersChanged,
    masterImagesRemapped,
    seriesDatasetsRemapped,
    recentRootsRemapped,
    driveRootSidecarMoved,
    warnings,
  };
}

export function defaultOldPrefixForLibrary(libraryId: string): string {
  return suggestLibraryPathMigrationPrefix(libraryId) ?? '';
}
