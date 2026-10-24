import fs from 'node:fs';
import path from 'node:path';
import {
  catalogLibrarySegment,
  civitaiCatalogDir,
  legacyWildcardsWcmDir,
  libraryJsonPath,
  libraryShelfFile,
  wildcardsBackupsDir,
} from '../domain/librarySidecarPaths.js';
import { parseLoraDownloadCategories } from '../domain/loraDownloadCategory.js';
import type { LibraryLocalPayload } from './libraryLocalState.js';
import { atomicWriteFile, copyDirRecursive, readJsonFile } from './librarySidecarIo.js';
import {
  isLibrarySplitPointer,
  libraryShelvesExist,
  modelKindsInCatalog,
  readLibraryShelfSlot,
  readLoraCategoryFile,
  writeLibraryShelfSlot,
  writeLoraCategoryFile,
  LIBRARY_SPLIT_VERSION,
} from './libraryShelfFiles.js';

const SLOT_VERSION = 1;

/** On-disk wrapper. Each library id owns one slot. Slot bodies stay version 1. */
export const LIBRARY_LOCAL_FILE_VERSION = 2 as const;

export type LibraryLocalFileV2 = {
  version: typeof LIBRARY_LOCAL_FILE_VERSION;
  byLibrary: Record<string, LibraryLocalPayload>;
};

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

function isSlot(value: unknown): value is LibraryLocalPayload {
  if (!value || typeof value !== 'object') return false;
  return (value as LibraryLocalPayload).version === SLOT_VERSION;
}

function isV2(value: unknown): value is LibraryLocalFileV2 {
  if (!value || typeof value !== 'object') return false;
  const row = value as LibraryLocalFileV2;
  return row.version === LIBRARY_LOCAL_FILE_VERSION && !!row.byLibrary && typeof row.byLibrary === 'object';
}

type Envelope =
  | { kind: 'v2'; byLibrary: Record<string, LibraryLocalPayload> }
  | { kind: 'v1'; payload: LibraryLocalPayload }
  | { kind: 'empty' };

function mergeByLongerList(
  payloads: readonly LibraryLocalPayload[],
): LibraryLocalPayload | null {
  if (payloads.length === 0) return null;
  const next: LibraryLocalPayload = {
    ...payloads[0]!,
    version: SLOT_VERSION,
  };
  for (const key of PROTECTED_LIST_KEYS) {
    let best = next[key];
    let bestLen = listLen(best);
    for (const payload of payloads) {
      const list = payload[key];
      const len = listLen(list);
      if (len > bestLen) {
        best = list as never;
        bestLen = len;
      }
    }
    if (bestLen > 0) (next as Record<string, unknown>)[key] = best;
  }
  return next;
}

type PayloadBuckets = {
  shared: LibraryLocalPayload[];
  scoped: Map<string, LibraryLocalPayload[]>;
};

function emptyBuckets(): PayloadBuckets {
  return { shared: [], scoped: new Map() };
}

function addBucketPayload(
  buckets: PayloadBuckets,
  libraryId: string | null,
  payload: LibraryLocalPayload,
): void {
  const id = libraryId?.trim() ?? '';
  if (!id) {
    buckets.shared.push(payload);
    return;
  }
  const list = buckets.scoped.get(id) ?? [];
  list.push(payload);
  buckets.scoped.set(id, list);
}

/** A version-2 file stays with its library id. A version-1 file is shared. */
function absorbLibraryRaw(buckets: PayloadBuckets, raw: unknown): void {
  if (isV2(raw)) {
    for (const [id, slot] of Object.entries(raw.byLibrary)) {
      const payload = isSlot(slot) ? slot : payloadFromUnknown(slot);
      if (payload) addBucketPayload(buckets, id, payload);
    }
    return;
  }
  if (isSlot(raw)) addBucketPayload(buckets, null, raw);
}

function shelfSummaryFiles(
  wildcardsRoot: string,
  libraryIds: readonly string[],
): Array<{ libraryId: string | null; file: string }> {
  const files: Array<{ libraryId: string | null; file: string }> = [
    {
      libraryId: null,
      file: path.join(civitaiCatalogDir(wildcardsRoot), 'shelf-summaries.json'),
    },
  ];
  for (const id of libraryIds) {
    files.push({
      libraryId: id,
      file: path.join(civitaiCatalogDir(wildcardsRoot, id), 'shelf-summaries.json'),
    });
  }
  return files;
}

/**
 * Archive / Maybe rows cached for the tab badges. The membership lists in
 * library.json are the source of truth; this is only a fallback when those
 * lists were saved empty and a shelf file still has the ids.
 */
function shelfSummaryPayloads(
  wildcardsRoot: string,
  libraryIds: readonly string[],
  buckets: PayloadBuckets,
): void {
  for (const source of shelfSummaryFiles(wildcardsRoot, libraryIds)) {
    const file = source.file;
    const raw = readJsonFile<{
      origin?: string;
      archived?: Array<{ id?: number }>;
      maybe?: Array<{ id?: number }>;
    }>(file);
    if (!raw) continue;
    const origin =
      typeof raw.origin === 'string' && raw.origin.trim()
        ? raw.origin.trim()
        : 'https://civitai.com';
    const entries = (rows: Array<{ id?: number }> | undefined) =>
      (rows ?? [])
        .map((row) => row?.id)
        .filter((id): id is number => typeof id === 'number' && id > 0)
        .map((modelId) => ({ origin, modelId }));
    const archived = entries(raw.archived);
    const maybe = entries(raw.maybe);
    if (archived.length === 0 && maybe.length === 0) continue;
    addBucketPayload(buckets, source.libraryId, {
      version: SLOT_VERSION,
      archivedCivitaiModels: archived,
      maybeCivitaiModels: maybe,
    } as LibraryLocalPayload);
  }
}

/** Marks you set by hand. A short scrap must not block the real list. */
const MANUAL_SHELF_KEYS = [
  'archivedCivitaiModels',
  'archivedCivitaiImages',
  'archivedCivitaiVideos',
  'maybeCivitaiModels',
  'civitaiWatchlist',
] as const satisfies ReadonlyArray<keyof LibraryLocalPayload>;

/**
 * 79 left in a shelf file is not a decision to un-archive thousands of cards.
 * Replace only when the backup is several times longer.
 */
function shouldRestoreManualShelf(currentLen: number, bestLen: number): boolean {
  if (bestLen <= currentLen) return false;
  if (currentLen === 0) return true;
  return bestLen >= currentLen * 5 && bestLen - currentLen >= 200;
}

function absorbLooseSidecars(buckets: PayloadBuckets, wildcardsRoot: string): void {
  const dir = path.dirname(libraryJsonPath(wildcardsRoot));
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const copy = name !== 'library.json' && name.startsWith('library.json');
    const other =
      name.endsWith('.json') &&
      name !== 'library.json' &&
      name !== 'validation.json' &&
      name !== 'prompt-coverage.json';
    if (!copy && !other) continue;
    absorbLibraryRaw(buckets, readJsonFile<unknown>(path.join(dir, name)));
  }
}

function readEnvelope(wildcardsRoot: string): Envelope {
  const siblingRaw = readJsonFile<unknown>(libraryJsonPath(wildcardsRoot));
  if (isLibrarySplitPointer(siblingRaw)) return { kind: 'empty' };
  if (isV2(siblingRaw)) {
    const byLibrary: Record<string, LibraryLocalPayload> = {};
    for (const [id, slot] of Object.entries(siblingRaw.byLibrary)) {
      if (isSlot(slot)) byLibrary[id] = slot;
    }
    return { kind: 'v2', byLibrary };
  }
  const sibling = isSlot(siblingRaw) ? siblingRaw : null;
  const legacyRaw = readJsonFile<unknown>(
    path.join(legacyWildcardsWcmDir(wildcardsRoot), 'library.json'),
  );
  const legacy = isSlot(legacyRaw) ? legacyRaw : null;
  const payload = mergeByLongerList(
    [sibling, legacy].filter((item): item is LibraryLocalPayload => item != null),
  );
  if (!payload) return { kind: 'empty' };
  return { kind: 'v1', payload };
}

/**
 * Copy a file or directory into `backups/pre-migrate-<timestamp>/` before a
 * format change. Throws if the copy does not land. Does not read the bytes.
 */
export function backupBeforeRewrite(
  wildcardsRoot: string,
  source: string,
  relativeName: string,
): void {
  if (!fs.existsSync(source)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(
    wildcardsBackupsDir(wildcardsRoot),
    `pre-migrate-${stamp}`,
    relativeName,
  );
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.statSync(source).isDirectory()) copyDirRecursive(source, dest);
  else fs.copyFileSync(source, dest);
  if (!fs.existsSync(dest)) {
    throw new Error(
      `Refusing to rewrite ${relativeName} because the pre-migrate backup copy failed`,
    );
  }
}

function writeEnvelope(
  wildcardsRoot: string,
  byLibrary: Record<string, LibraryLocalPayload>,
): void {
  const file: LibraryLocalFileV2 = {
    version: LIBRARY_LOCAL_FILE_VERSION,
    byLibrary,
  };
  atomicWriteFile(libraryJsonPath(wildcardsRoot), `${JSON.stringify(file)}\n`);
}

/**
 * Read one library's slot.
 * A version-1 file (one shared payload) is returned for any id until
 * `migrateLibraryFileToPerLibrary` splits it.
 */
export function readLibrarySlot(
  wildcardsRoot: string | null | undefined,
  libraryId?: string | null,
): LibraryLocalPayload | null {
  if (!wildcardsRoot?.trim()) return null;
  const id = libraryId?.trim();
  if (id && libraryShelvesExist(wildcardsRoot, id)) {
    return readLibraryShelfSlot(wildcardsRoot, id);
  }
  const env = readEnvelope(wildcardsRoot);
  if (env.kind === 'v2') {
    if (!id) return null;
    return env.byLibrary[id] ?? null;
  }
  if (env.kind === 'v1') return env.payload;
  return null;
}

/** Replace one library's slot. Other libraries in the file stay as they are. */
export function writeLibrarySlot(
  wildcardsRoot: string,
  libraryId: string,
  payload: LibraryLocalPayload,
  opts?: { replaceManualShelves?: boolean },
): void {
  const id = libraryId.trim();
  if (!wildcardsRoot.trim() || !id) return;
  const env = readEnvelope(wildcardsRoot);
  const fromEnvelope =
    env.kind === 'v2' ? env.byLibrary[id] : env.kind === 'v1' ? env.payload : null;
  const existing = libraryShelvesExist(wildcardsRoot, id)
    ? readLibraryShelfSlot(wildcardsRoot, id)
    : fromEnvelope;
  const next: LibraryLocalPayload = { ...payload, version: SLOT_VERSION };
  if (existing) {
    if (
      listLen(next.loraDownloadCategories) === 0 &&
      listLen(existing.loraDownloadCategories) > 0
    ) {
      next.loraDownloadCategories = existing.loraDownloadCategories;
      if (!next.lastLoraDownloadCategoryId?.trim()) {
        next.lastLoraDownloadCategoryId = existing.lastLoraDownloadCategoryId;
      }
    }
    if (!opts?.replaceManualShelves) {
      for (const key of MANUAL_SHELF_KEYS) {
        if (shouldRestoreManualShelf(listLen(next[key]), listLen(existing[key]))) {
          (next as Record<string, unknown>)[key] = existing[key];
        }
      }
    }
  }
  const prefsFile = libraryShelfFile(wildcardsRoot, id, 'library.json');
  if (prefsEmbedCategories(prefsFile)) {
    backupBeforeRewrite(
      wildcardsRoot,
      prefsFile,
      path.join('libraries', catalogLibrarySegment(id), 'library.json'),
    );
  }
  writeLibraryShelfSlot(wildcardsRoot, id, next);
}

/**
 * Copy a shared version-1 `library.json` onto every library that uses that
 * wildcards folder, then store the slots separately. Already-split files
 * are left alone. Safe to run again.
 */
export function migrateLibraryFileToPerLibrary(
  wildcardsRoot: string | null | undefined,
  libraryIds: readonly string[],
): boolean {
  if (!wildcardsRoot?.trim()) return false;
  const ids = [...new Set(libraryIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return false;
  const env = readEnvelope(wildcardsRoot);
  if (env.kind !== 'v1') return false;
  backupBeforeRewrite(wildcardsRoot, libraryJsonPath(wildcardsRoot), 'library.json');
  const byLibrary: Record<string, LibraryLocalPayload> = {};
  for (const id of ids) {
    byLibrary[id] = { ...env.payload, version: SLOT_VERSION };
  }
  writeEnvelope(wildcardsRoot, byLibrary);
  return true;
}

/**
 * Put back a longer Archive / Maybe / Notify list still in the live sidecar
 * or the legacy in-tree file. Copies under `backups/` are not read.
 * Never replaces a longer list with a shorter one.
 * The app runs this. Callers do not print the lists.
 */
export function recoverLongerLibraryShelves(
  wildcardsRoot: string | null | undefined,
  libraryIds: readonly string[],
): boolean {
  if (!wildcardsRoot?.trim()) return false;
  const ids = [...new Set(libraryIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return false;
  const env = readEnvelope(wildcardsRoot);
  const buckets = emptyBuckets();
  absorbLooseSidecars(buckets, wildcardsRoot);
  if (env.kind === 'v2') absorbLibraryRaw(buckets, { version: 2, byLibrary: env.byLibrary });
  if (env.kind === 'v1') addBucketPayload(buckets, null, env.payload);
  shelfSummaryPayloads(wildcardsRoot, ids, buckets);
  absorbLibraryRaw(
    buckets,
    readJsonFile<unknown>(path.join(legacyWildcardsWcmDir(wildcardsRoot), 'library.json')),
  );
  const byLibrary: Record<string, LibraryLocalPayload> =
    env.kind === 'v2' ? { ...env.byLibrary } : {};
  let changed = false;
  for (const id of ids) {
    const best = mergeByLongerList([
      ...(buckets.scoped.get(id) ?? []),
      ...buckets.shared,
    ]);
    if (!best) continue;
    const fromShelves = libraryShelvesExist(wildcardsRoot, id)
      ? readLibraryShelfSlot(wildcardsRoot, id)
      : null;
    const current = fromShelves ?? byLibrary[id] ?? {
      ...(env.kind === 'v1' ? env.payload : { version: SLOT_VERSION }),
      version: SLOT_VERSION,
    };
    const merged: LibraryLocalPayload = { ...current, version: SLOT_VERSION };
    for (const key of PROTECTED_LIST_KEYS) {
      const currentLen = listLen(current[key]);
      const bestLen = listLen(best[key]);
      const manual = (MANUAL_SHELF_KEYS as readonly string[]).includes(key);
      if (manual) {
        if (!shouldRestoreManualShelf(currentLen, bestLen)) continue;
      } else if (currentLen > 0 || bestLen === 0) {
        continue;
      }
      (merged as Record<string, unknown>)[key] = best[key];
      changed = true;
    }
    byLibrary[id] = merged;
  }
  if (!changed) return false;
  backupBeforeRewrite(wildcardsRoot, libraryJsonPath(wildcardsRoot), 'library.json');
  for (const id of ids) {
    const slot = byLibrary[id];
    if (slot) writeLibrarySlot(wildcardsRoot, id, slot);
  }
  return true;
}

function payloadFromUnknown(value: unknown): LibraryLocalPayload | null {
  if (isSlot(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.version === LIBRARY_LOCAL_FILE_VERSION ||
    row.version === LIBRARY_SPLIT_VERSION ||
    row.split === true
  ) {
    return null;
  }
  const hasList = PROTECTED_LIST_KEYS.some((key) => listLen(row[key]) > 0);
  if (!hasList) return null;
  return { ...(value as LibraryLocalPayload), version: SLOT_VERSION };
}

function preferLongerSlot(
  left: LibraryLocalPayload | null,
  right: LibraryLocalPayload | null,
): LibraryLocalPayload | null {
  if (!left) return right;
  if (!right) return left;
  const next: LibraryLocalPayload = { ...left, version: SLOT_VERSION };
  for (const key of PROTECTED_LIST_KEYS) {
    if (listLen(right[key]) > listLen(next[key])) {
      (next as Record<string, unknown>)[key] = right[key];
    }
  }
  return next;
}

/**
 * Upgrade a combined `library.json` into per-library shelf files and leave a
 * pointer behind. The first launch of this build runs it. A pointer means it
 * already ran. Safe to run again.
 */
export function splitLibraryShelves(
  wildcardsRoot: string | null | undefined,
  libraryIds: readonly string[],
): boolean {
  if (!wildcardsRoot?.trim()) return false;
  const ids = [...new Set(libraryIds.map((id) => id.trim()).filter(Boolean))];
  const file = libraryJsonPath(wildcardsRoot);
  const raw = readJsonFile<unknown>(file);
  if (isV2(raw)) {
    for (const id of Object.keys(raw.byLibrary)) {
      const trimmed = id.trim();
      if (trimmed && !ids.includes(trimmed)) ids.push(trimmed);
    }
  }
  if (ids.length === 0) return false;
  if (isLibrarySplitPointer(raw)) return false;
  const required = new Set<string>();
  if (isV2(raw)) {
    for (const [id, slot] of Object.entries(raw.byLibrary)) {
      if (payloadFromUnknown(slot)) required.add(id.trim());
    }
  } else if (payloadFromUnknown(raw)) {
    for (const id of ids) required.add(id);
  }
  if (fs.existsSync(file)) {
    backupBeforeRewrite(wildcardsRoot, file, 'library.json');
  }
  const written = new Set<string>();
  for (const id of ids) {
    const fromEnvelope = isV2(raw)
      ? payloadFromUnknown(raw.byLibrary[id])
      : payloadFromUnknown(raw);
    const fromShelves = libraryShelvesExist(wildcardsRoot, id)
      ? readLibraryShelfSlot(wildcardsRoot, id)
      : null;
    const slot = preferLongerSlot(fromEnvelope, fromShelves);
    if (!slot) continue;
    const wanted = new Set<number>();
    for (const row of [
      ...(slot.archivedCivitaiModels ?? []),
      ...(slot.maybeCivitaiModels ?? []),
      ...(slot.markedInstalledCivitaiModels ?? []),
      ...(slot.civitaiWatchlist ?? []),
      ...(slot.civitaiRecentlyUnlocked ?? []),
    ]) {
      if (row.modelId > 0) wanted.add(row.modelId);
    }
    const origin = slot.civitaiOrigin?.trim() || 'https://civitai.com';
    const catalog = civitaiCatalogDir(wildcardsRoot, id);
    const kinds = modelKindsInCatalog(catalog, origin, wanted);
    if (kinds.size === 0) {
      const other =
        origin === 'https://civitai.red' ? 'https://civitai.com' : 'https://civitai.red';
      for (const [modelId, kind] of modelKindsInCatalog(catalog, other, wanted)) {
        kinds.set(modelId, kind);
      }
    }
    const checkpoints = new Set<number>();
    for (const [modelId, kind] of kinds) {
      if (kind === 'Checkpoint') checkpoints.add(modelId);
    }
    writeLibraryShelfSlot(wildcardsRoot, id, slot, checkpoints);
    written.add(id);
  }
  if ([...required].some((id) => !written.has(id))) return written.size > 0;
  if (written.size === 0) return false;
  atomicWriteFile(
    file,
    `${JSON.stringify({ version: LIBRARY_SPLIT_VERSION, split: true })}\n`,
  );
  console.log(`[library] split shelf files for ${written.size} libraries`);
  return true;
}

type CategorySnap = {
  categories: NonNullable<LibraryLocalPayload['loraDownloadCategories']>;
  lastId?: string;
};

function categorySnapOf(value: unknown): CategorySnap | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as LibraryLocalPayload;
  const categories = parseLoraDownloadCategories(row.loraDownloadCategories);
  const lastId =
    typeof row.lastLoraDownloadCategoryId === 'string'
      ? row.lastLoraDownloadCategoryId.trim()
      : '';
  if (categories.length === 0 && !lastId) return null;
  return { categories, ...(lastId ? { lastId } : {}) };
}

function preferLongerCategories(best: CategorySnap, snap: CategorySnap | null): CategorySnap {
  if (!snap) return best;
  if (snap.categories.length > best.categories.length) return snap;
  if (best.categories.length === 0 && snap.lastId && !best.lastId) return snap;
  return best;
}

function categorySnapForLibrary(
  raw: unknown,
  libraryId: string,
  allowShared: boolean,
): CategorySnap | null {
  if (isV2(raw)) return categorySnapOf(raw.byLibrary[libraryId]);
  if (!allowShared || isLibrarySplitPointer(raw)) return null;
  return categorySnapOf(raw);
}

function prefsEmbedCategories(file: string): boolean {
  const raw = readJsonFile<Record<string, unknown>>(file);
  if (!raw) return false;
  return (
    Object.prototype.hasOwnProperty.call(raw, 'loraDownloadCategories') ||
    Object.prototype.hasOwnProperty.call(raw, 'lastLoraDownloadCategoryId')
  );
}

/**
 * Move LoRA categories out of each library's prefs `library.json` into
 * `categories.json`. A missing file is filled from that library's live
 * preferences file or combined `library.json`. Copies under `backups/` are
 * not read. An existing file stays as it is. Safe to run again.
 */
export function migrateLoraCategoryFiles(
  wildcardsRoot: string | null | undefined,
  libraryIds: readonly string[],
): void {
  if (!wildcardsRoot?.trim()) return;
  const ids = [...new Set(libraryIds.map((id) => id.trim()).filter(Boolean))];
  const envelope = readJsonFile<unknown>(libraryJsonPath(wildcardsRoot));
  if (isV2(envelope)) {
    for (const id of Object.keys(envelope.byLibrary)) {
      const trimmed = id.trim();
      if (trimmed && !ids.includes(trimmed)) ids.push(trimmed);
    }
  }
  for (const id of ids) {
    const prefsFile = libraryShelfFile(wildcardsRoot, id, 'library.json');
    const current = readLoraCategoryFile(wildcardsRoot, id);
    const fromPrefs = categorySnapOf(readJsonFile<unknown>(prefsFile));
    const needsSource =
      !current || (current.loraDownloadCategories.length === 0 && fromPrefs);
    if (needsSource) {
      let best: CategorySnap = {
        categories: current?.loraDownloadCategories ?? [],
        ...(current?.lastLoraDownloadCategoryId
          ? { lastId: current.lastLoraDownloadCategoryId }
          : {}),
      };
      best = preferLongerCategories(best, fromPrefs);
      best = preferLongerCategories(
        best,
        categorySnapForLibrary(envelope, id, best.categories.length === 0),
      );
      if (best.categories.length === 0) {
        best = preferLongerCategories(
          best,
          categorySnapForLibrary(envelope, id, true),
        );
      }
      writeLoraCategoryFile(wildcardsRoot, id, {
        loraDownloadCategories: best.categories,
        lastLoraDownloadCategoryId: best.lastId,
      });
      if (best.categories.length > 0) {
        console.log(
          `[library] ${best.categories.length} LoRA categories in categories.json`,
        );
      }
    }
    if (!prefsEmbedCategories(prefsFile)) continue;
    backupBeforeRewrite(
      wildcardsRoot,
      prefsFile,
      path.join('libraries', catalogLibrarySegment(id), 'library.json'),
    );
    const raw = readJsonFile<Record<string, unknown>>(prefsFile);
    if (!raw) continue;
    delete raw.loraDownloadCategories;
    delete raw.lastLoraDownloadCategoryId;
    atomicWriteFile(prefsFile, `${JSON.stringify(raw)}\n`);
  }
}
