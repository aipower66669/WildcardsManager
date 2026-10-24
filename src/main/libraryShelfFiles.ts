import fs from 'node:fs';
import path from 'node:path';
import { catalogOriginHost, modelPageIndex } from '../domain/civitaiCatalogLayout.js';
import { parseLoraDownloadCategories } from '../domain/loraDownloadCategory.js';
import { libraryShelfDir, libraryShelfFile } from '../domain/librarySidecarPaths.js';
import type { LibraryLocalPayload } from './libraryLocalState.js';
import { atomicWriteFile, readJsonFile } from './librarySidecarIo.js';

export const LIBRARY_SPLIT_VERSION = 3 as const;

export type ShelfModelKind = 'LORA' | 'Checkpoint';

type ModelRow = {
  origin: string;
  modelId: number;
  modelType?: ShelfModelKind;
  type?: ShelfModelKind | string;
};

type ModelShelfFile = {
  version: 1;
  archived?: ModelRow[];
  maybe?: ModelRow[];
  watchlist?: ModelRow[];
  recentlyUnlocked?: ModelRow[];
  markedInstalled?: ModelRow[];
  markedInstalledVersions?: ModelRow[];
};

const PREF_OMIT = [
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
  'loraDownloadCategories',
  'lastLoraDownloadCategoryId',
] as const satisfies ReadonlyArray<keyof LibraryLocalPayload>;

export type LoraCategoryFile = {
  version: 1;
  loraDownloadCategories: NonNullable<LibraryLocalPayload['loraDownloadCategories']>;
  lastLoraDownloadCategoryId?: string;
};

export function readLoraCategoryFile(
  wildcardsRoot: string,
  libraryId: string,
): LoraCategoryFile | null {
  const raw = readJsonFile<LoraCategoryFile>(
    libraryShelfFile(wildcardsRoot, libraryId, 'categories.json'),
  );
  if (!raw || raw.version !== 1) return null;
  const lastId =
    typeof raw.lastLoraDownloadCategoryId === 'string'
      ? raw.lastLoraDownloadCategoryId.trim()
      : '';
  return {
    version: 1,
    loraDownloadCategories: parseLoraDownloadCategories(raw.loraDownloadCategories),
    ...(lastId ? { lastLoraDownloadCategoryId: lastId } : {}),
  };
}

export function writeLoraCategoryFile(
  wildcardsRoot: string,
  libraryId: string,
  payload: Pick<
    LibraryLocalPayload,
    'loraDownloadCategories' | 'lastLoraDownloadCategoryId'
  >,
): void {
  const lastId = payload.lastLoraDownloadCategoryId?.trim() || '';
  const file: LoraCategoryFile = {
    version: 1,
    loraDownloadCategories: parseLoraDownloadCategories(payload.loraDownloadCategories),
    ...(lastId ? { lastLoraDownloadCategoryId: lastId } : {}),
  };
  fs.mkdirSync(libraryShelfDir(wildcardsRoot, libraryId), { recursive: true });
  writeJsonIfChanged(
    libraryShelfFile(wildcardsRoot, libraryId, 'categories.json'),
    file,
  );
}

export function isLibrarySplitPointer(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const row = value as { version?: unknown; split?: unknown };
  return row.version === LIBRARY_SPLIT_VERSION && row.split === true;
}

export function libraryShelvesExist(
  wildcardsRoot: string,
  libraryId: string,
): boolean {
  return fs.existsSync(libraryShelfFile(wildcardsRoot, libraryId, 'library.json'));
}

function asRows(value: unknown): ModelRow[] {
  return Array.isArray(value) ? (value as ModelRow[]) : [];
}

function readModelShelf(
  wildcardsRoot: string,
  libraryId: string,
  name: 'civitai-loras.json' | 'civitai-checkpoints.json',
): ModelShelfFile {
  return (
    readJsonFile<ModelShelfFile>(libraryShelfFile(wildcardsRoot, libraryId, name)) ?? {
      version: 1,
    }
  );
}

function kindOf(
  row: ModelRow,
  checkpointIds: Set<number>,
): ShelfModelKind {
  if (row.modelType === 'Checkpoint' || row.type === 'Checkpoint') return 'Checkpoint';
  if (row.modelType === 'LORA' || row.type === 'LORA') return 'LORA';
  if (checkpointIds.has(row.modelId)) return 'Checkpoint';
  return 'LORA';
}

function stamp<T extends ModelRow>(row: T, kind: ShelfModelKind): T {
  if (kind === 'Checkpoint') return { ...row, modelType: 'Checkpoint' };
  if (row.modelType === 'LORA' || row.type === 'LORA') {
    return { ...row, modelType: 'LORA' };
  }
  return row;
}

function partitionModels<T extends ModelRow>(
  rows: T[] | undefined,
  checkpointIds: Set<number>,
): { lora: T[]; checkpoint: T[] } {
  const lora: T[] = [];
  const checkpoint: T[] = [];
  for (const row of rows ?? []) {
    const kind = kindOf(row, checkpointIds);
    const stamped = stamp(row, kind);
    if (kind === 'Checkpoint') checkpoint.push(stamped);
    else lora.push(stamped);
  }
  return { lora, checkpoint };
}

function checkpointIdsFrom(
  wildcardsRoot: string,
  libraryId: string,
): Set<number> {
  const file = readModelShelf(wildcardsRoot, libraryId, 'civitai-checkpoints.json');
  const ids = new Set<number>();
  for (const list of [
    file.archived,
    file.maybe,
    file.watchlist,
    file.recentlyUnlocked,
    file.markedInstalled,
    file.markedInstalledVersions,
  ]) {
    for (const row of asRows(list)) {
      if (typeof row?.modelId === 'number') ids.add(row.modelId);
    }
  }
  return ids;
}

export function readLibraryShelfSlot(
  wildcardsRoot: string,
  libraryId: string,
): LibraryLocalPayload | null {
  if (!libraryShelvesExist(wildcardsRoot, libraryId)) return null;
  const prefs =
    readJsonFile<LibraryLocalPayload>(
      libraryShelfFile(wildcardsRoot, libraryId, 'library.json'),
    ) ?? ({ version: 1 } as LibraryLocalPayload);
  const loras = readModelShelf(wildcardsRoot, libraryId, 'civitai-loras.json');
  const checkpoints = readModelShelf(
    wildcardsRoot,
    libraryId,
    'civitai-checkpoints.json',
  );
  const images = readJsonFile<{ archived?: LibraryLocalPayload['archivedCivitaiImages'] }>(
    libraryShelfFile(wildcardsRoot, libraryId, 'civitai-images.json'),
  );
  const videos = readJsonFile<{ archived?: LibraryLocalPayload['archivedCivitaiVideos'] }>(
    libraryShelfFile(wildcardsRoot, libraryId, 'civitai-videos.json'),
  );
  const hf = readJsonFile<{
    archived?: LibraryLocalPayload['archivedHfModels'];
    downloaded?: LibraryLocalPayload['downloadedHfModels'];
  }>(libraryShelfFile(wildcardsRoot, libraryId, 'huggingface.json'));
  const categories = readLoraCategoryFile(wildcardsRoot, libraryId);
  const merge = <T>(left: T[] | undefined, right: T[] | undefined): T[] => [
    ...(left ?? []),
    ...(right ?? []),
  ];
  return {
    ...prefs,
    version: 1,
    archivedCivitaiModels: merge(loras.archived, checkpoints.archived) as LibraryLocalPayload['archivedCivitaiModels'],
    maybeCivitaiModels: merge(loras.maybe, checkpoints.maybe) as LibraryLocalPayload['maybeCivitaiModels'],
    civitaiWatchlist: merge(loras.watchlist, checkpoints.watchlist) as LibraryLocalPayload['civitaiWatchlist'],
    civitaiRecentlyUnlocked: merge(
      loras.recentlyUnlocked,
      checkpoints.recentlyUnlocked,
    ) as LibraryLocalPayload['civitaiRecentlyUnlocked'],
    markedInstalledCivitaiModels: merge(
      loras.markedInstalled,
      checkpoints.markedInstalled,
    ) as LibraryLocalPayload['markedInstalledCivitaiModels'],
    markedInstalledCivitaiVersions: merge(
      loras.markedInstalledVersions,
      checkpoints.markedInstalledVersions,
    ) as LibraryLocalPayload['markedInstalledCivitaiVersions'],
    archivedCivitaiImages: images?.archived ?? [],
    archivedCivitaiVideos: videos?.archived ?? [],
    archivedHfModels: hf?.archived ?? [],
    downloadedHfModels: hf?.downloaded ?? [],
    loraDownloadCategories: categories
      ? categories.loraDownloadCategories
      : prefs.loraDownloadCategories,
    lastLoraDownloadCategoryId: categories
      ? categories.lastLoraDownloadCategoryId
      : prefs.lastLoraDownloadCategoryId,
  };
}

function writeJsonIfChanged(file: string, value: unknown): void {
  const text = `${JSON.stringify(value)}\n`;
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
  } catch {
    // Rewrite when the current file cannot be read.
  }
  atomicWriteFile(file, text);
}

export function writeLibraryShelfSlot(
  wildcardsRoot: string,
  libraryId: string,
  payload: LibraryLocalPayload,
  extraCheckpointIds?: ReadonlySet<number>,
): void {
  const checkpointIds = checkpointIdsFrom(wildcardsRoot, libraryId);
  if (extraCheckpointIds) {
    for (const id of extraCheckpointIds) checkpointIds.add(id);
  }
  const archived = partitionModels(payload.archivedCivitaiModels, checkpointIds);
  const maybe = partitionModels(payload.maybeCivitaiModels, checkpointIds);
  const watch = partitionModels(payload.civitaiWatchlist, checkpointIds);
  const unlocked = partitionModels(payload.civitaiRecentlyUnlocked, checkpointIds);
  const marked = partitionModels(payload.markedInstalledCivitaiModels, checkpointIds);
  const markedVersions = partitionModels(
    payload.markedInstalledCivitaiVersions,
    checkpointIds,
  );
  const prefs: LibraryLocalPayload = { ...payload, version: 1 };
  for (const key of PREF_OMIT) delete prefs[key];
  fs.mkdirSync(libraryShelfDir(wildcardsRoot, libraryId), { recursive: true });
  writeLoraCategoryFile(wildcardsRoot, libraryId, payload);
  writeJsonIfChanged(libraryShelfFile(wildcardsRoot, libraryId, 'library.json'), prefs);
  writeJsonIfChanged(libraryShelfFile(wildcardsRoot, libraryId, 'civitai-loras.json'), {
    version: 1,
    archived: archived.lora,
    maybe: maybe.lora,
    watchlist: watch.lora,
    recentlyUnlocked: unlocked.lora,
    markedInstalled: marked.lora,
    markedInstalledVersions: markedVersions.lora,
  });
  writeJsonIfChanged(
    libraryShelfFile(wildcardsRoot, libraryId, 'civitai-checkpoints.json'),
    {
      version: 1,
      archived: archived.checkpoint,
      maybe: maybe.checkpoint,
      watchlist: watch.checkpoint,
      recentlyUnlocked: unlocked.checkpoint,
      markedInstalled: marked.checkpoint,
      markedInstalledVersions: markedVersions.checkpoint,
    },
  );
  writeJsonIfChanged(libraryShelfFile(wildcardsRoot, libraryId, 'civitai-images.json'), {
    version: 1,
    archived: payload.archivedCivitaiImages ?? [],
  });
  writeJsonIfChanged(libraryShelfFile(wildcardsRoot, libraryId, 'civitai-videos.json'), {
    version: 1,
    archived: payload.archivedCivitaiVideos ?? [],
  });
  writeJsonIfChanged(libraryShelfFile(wildcardsRoot, libraryId, 'huggingface.json'), {
    version: 1,
    archived: payload.archivedHfModels ?? [],
    downloaded: payload.downloadedHfModels ?? [],
  });
}

/** Model id → shelf, from catalog pages. Unknown ids stay out of the map. */
export function modelKindsInCatalog(
  catalogDir: string,
  origin: string,
  ids: ReadonlySet<number>,
): Map<number, ShelfModelKind> {
  const out = new Map<number, ShelfModelKind>();
  if (ids.size === 0) return out;
  const hostDir = path.join(catalogDir, 'models', catalogOriginHost(origin));
  const pages = new Map<number, number[]>();
  for (const id of ids) {
    const page = modelPageIndex(id);
    const list = pages.get(page);
    if (list) list.push(id);
    else pages.set(page, [id]);
  }
  for (const [page, pageIds] of pages) {
    const raw = readJsonFile<Record<string, { id?: number; type?: string }>>(
      path.join(hostDir, `${page}.json`),
    );
    if (!raw) continue;
    const wanted = new Set(pageIds);
    for (const model of Object.values(raw)) {
      if (typeof model?.id !== 'number' || !wanted.has(model.id)) continue;
      const type = (model.type ?? '').trim().toLowerCase();
      if (type === 'checkpoint') out.set(model.id, 'Checkpoint');
      else if (type === 'lora' || type === 'locon' || type === 'dora' || type === 'lycoris') {
        out.set(model.id, 'LORA');
      }
    }
  }
  return out;
}
