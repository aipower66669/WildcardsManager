import fs from 'node:fs';
import path from 'node:path';
import {
  legacyWildcardsWcmDir,
  libraryJsonPath,
  wildcardsBackupsDir,
} from '../domain/librarySidecarPaths.js';
import type { LibraryLocalPayload } from './libraryLocalState.js';
import { atomicWriteFile, copyDirRecursive, readJsonFile } from './librarySidecarIo.js';

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

function payloadsInRaw(raw: unknown): LibraryLocalPayload[] {
  if (isV2(raw)) return Object.values(raw.byLibrary).filter(isSlot);
  if (isSlot(raw)) return [raw];
  return [];
}

function extraLibraryJsonCopies(wildcardsRoot: string): LibraryLocalPayload[] {
  const dir = path.dirname(libraryJsonPath(wildcardsRoot));
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found: LibraryLocalPayload[] = [];
  for (const name of names) {
    if (name === 'library.json') continue;
    if (!name.startsWith('library.json')) continue;
    const raw = readJsonFile<unknown>(path.join(dir, name));
    found.push(...payloadsInRaw(raw));
  }
  return found;
}

function readEnvelope(wildcardsRoot: string): Envelope {
  const siblingRaw = readJsonFile<unknown>(libraryJsonPath(wildcardsRoot));
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
  const env = readEnvelope(wildcardsRoot);
  if (env.kind === 'v2') {
    const id = libraryId?.trim();
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
): void {
  const id = libraryId.trim();
  if (!wildcardsRoot.trim() || !id) return;
  const env = readEnvelope(wildcardsRoot);
  const byLibrary = env.kind === 'v2' ? { ...env.byLibrary } : {};
  const current = byLibrary[id];
  const next: LibraryLocalPayload = { ...payload, version: SLOT_VERSION };
  if (
    current &&
    listLen(next.loraDownloadCategories) === 0 &&
    listLen(current.loraDownloadCategories) > 0
  ) {
    next.loraDownloadCategories = current.loraDownloadCategories;
  }
  byLibrary[id] = next;
  writeEnvelope(wildcardsRoot, byLibrary);
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
 * Put back any longer Archive / Maybe / Notify list still sitting in an older
 * library.json (the previous file, a leftover temp write, or the legacy
 * in-tree file). Never replaces a longer list with a shorter one.
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
  const candidates: LibraryLocalPayload[] = [
    ...extraLibraryJsonCopies(wildcardsRoot),
  ];
  if (env.kind === 'v2') candidates.push(...Object.values(env.byLibrary));
  if (env.kind === 'v1') candidates.push(env.payload);
  const legacyRaw = readJsonFile<unknown>(
    path.join(legacyWildcardsWcmDir(wildcardsRoot), 'library.json'),
  );
  candidates.push(...payloadsInRaw(legacyRaw));
  const best = mergeByLongerList(candidates);
  if (!best) return false;
  const byLibrary: Record<string, LibraryLocalPayload> =
    env.kind === 'v2' ? { ...env.byLibrary } : {};
  let changed = false;
  for (const id of ids) {
    const current = byLibrary[id] ?? {
      ...(env.kind === 'v1' ? env.payload : { version: SLOT_VERSION }),
      version: SLOT_VERSION,
    };
    const merged: LibraryLocalPayload = { ...current, version: SLOT_VERSION };
    for (const key of PROTECTED_LIST_KEYS) {
      if (listLen(current[key]) > 0) continue;
      if (listLen(best[key]) === 0) continue;
      (merged as Record<string, unknown>)[key] = best[key];
      changed = true;
    }
    byLibrary[id] = merged;
  }
  if (!changed) return false;
  backupBeforeRewrite(wildcardsRoot, libraryJsonPath(wildcardsRoot), 'library.json');
  writeEnvelope(wildcardsRoot, byLibrary);
  return true;
}
