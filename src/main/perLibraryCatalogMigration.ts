import fs from 'node:fs';
import path from 'node:path';
import {
  catalogLibrarySegment,
  civitaiCatalogDir,
} from '../domain/librarySidecarPaths.js';
import {
  backupBeforeRewrite,
  migrateLibraryFileToPerLibrary,
  migrateLoraCategoryFiles,
  recoverLongerLibraryShelves,
  splitLibraryShelves,
} from './libraryLocalFile.js';
import { atomicWriteFile, copyDirRecursive, readJsonFile } from './librarySidecarIo.js';

/** Top-level names of the old shared catalog directory. */
const SHARED_CATALOG_ENTRIES = [
  'meta.json',
  'models',
  'slices',
  'autoV2-index.json',
] as const;

/** Copied with the catalog when a thin folder is replaced by a fuller one. */
const CATALOG_PAYLOAD_NAMES = [
  ...SHARED_CATALOG_ENTRIES,
  'shelf-summaries.json',
] as const;

/**
 * A fresh sync of an empty folder stays under this many model-page files.
 * A catalog that has been filled for real is at least `FULL_CATALOG_PAGE_FILES`.
 */
const THIN_CATALOG_PAGE_FILES = 15;
const FULL_CATALOG_PAGE_FILES = 40;

/** A path counts only when it contains a file. An empty directory does not. */
function hasContent(target: string): boolean {
  return fileCount(target) > 0;
}

function fileCount(target: string): number {
  if (!fs.existsSync(target)) return 0;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return 0;
  }
  if (stat.isFile()) return stat.size > 0 ? 1 : 0;
  if (!stat.isDirectory()) return 0;
  let count = 0;
  const stack = [target];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
      else if (entry.isFile()) count += 1;
    }
  }
  return count;
}

function presentSharedEntries(dir: string): string[] {
  return SHARED_CATALOG_ENTRIES.filter((name) =>
    hasContent(path.join(dir, name)),
  );
}

function catalogCandidates(
  wildcardsRoot: string,
  libraryIds: readonly string[],
): string[] {
  const out = [civitaiCatalogDir(wildcardsRoot)];
  for (const id of libraryIds) out.push(civitaiCatalogDir(wildcardsRoot, id));
  return out;
}

/**
 * A per-library folder created while the real catalog still lived in the
 * shared directory is not a catalog. Copy the fullest tree still on disk
 * (the shared folder or another library's live catalog) over a
 * folder that is empty or only a short re-download.
 */
function adoptFullerCatalog(
  wildcardsRoot: string,
  libraryId: string,
  libraryIds: readonly string[],
): void {
  const dest = civitaiCatalogDir(wildcardsRoot, libraryId);
  const destCount = fileCount(path.join(dest, 'models'));
  let best = '';
  let bestCount = destCount;
  const destKey = path.resolve(dest).toLowerCase();
  for (const candidate of catalogCandidates(wildcardsRoot, libraryIds)) {
    if (path.resolve(candidate).toLowerCase() === destKey) continue;
    const count = fileCount(path.join(candidate, 'models'));
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  const thin =
    destCount === 0 ||
    (destCount < THIN_CATALOG_PAGE_FILES &&
      bestCount >= FULL_CATALOG_PAGE_FILES);
  if (!best || !thin || bestCount === 0) return;
  if (hasContent(dest)) {
    backupBeforeRewrite(
      wildcardsRoot,
      dest,
      path.join('civitai-catalog', catalogLibrarySegment(libraryId)),
    );
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const name of CATALOG_PAYLOAD_NAMES) {
    const src = path.join(best, name);
    if (!hasContent(src)) continue;
    const target = path.join(dest, name);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    if (fs.statSync(src).isDirectory()) copyDirRecursive(src, target);
    else fs.copyFileSync(src, target);
  }
}

function copyEntryIfDestEmpty(src: string, dest: string): boolean {
  if (!hasContent(src) || hasContent(dest)) return false;
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.statSync(src).isDirectory()) copyDirRecursive(src, dest);
  else fs.copyFileSync(src, dest);
  return true;
}

/**
 * Copy the shared `cache/civitai-catalog` tree into each library's own
 * directory, then remove the shared files. A library that already has its
 * catalog is left as it is. Safe to run again.
 */
export function migrateSharedCatalogToPerLibrary(
  wildcardsRoot: string | null | undefined,
  libraryIds: readonly string[],
): number {
  if (!wildcardsRoot?.trim()) return 0;
  const ids = [...new Set(libraryIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return 0;
  for (const id of ids) adoptFullerCatalog(wildcardsRoot, id, ids);

  const parent = civitaiCatalogDir(wildcardsRoot);
  const shared = presentSharedEntries(parent);
  if (shared.length === 0) return 0;
  for (const name of shared) {
    backupBeforeRewrite(
      wildcardsRoot,
      path.join(parent, name),
      path.join('civitai-catalog', name),
    );
  }

  let copied = 0;
  for (const id of ids) {
    const dest = civitaiCatalogDir(wildcardsRoot, id);
    fs.mkdirSync(dest, { recursive: true });
    let wrote = false;
    for (const name of shared) {
      if (
        copyEntryIfDestEmpty(
          path.join(parent, name),
          path.join(dest, name),
        )
      ) {
        wrote = true;
      }
    }
    if (wrote) copied += 1;
  }

  for (const name of shared) {
    const ready = ids.every((id) =>
      hasContent(path.join(civitaiCatalogDir(wildcardsRoot, id), name)),
    );
    if (!ready) continue;
    fs.rmSync(path.join(parent, name), { recursive: true, force: true });
  }
  return copied;
}

/**
 * The Downloaded badge is this array plus hash matches. A rebuilt catalog
 * matches fewer files and used to overwrite the longer array. Put the
 * longest copy back.
 */
function restoreLongerDownloadedSummaries(
  wildcardsRoot: string,
  libraryIds: readonly string[],
): void {
  let best: unknown[] | null = null;
  let bestOrigin = '';
  for (const dir of catalogCandidates(wildcardsRoot, libraryIds)) {
    const raw = readJsonFile<{ origin?: string; downloaded?: unknown[] }>(
      path.join(dir, 'shelf-summaries.json'),
    );
    const rows = Array.isArray(raw?.downloaded) ? raw.downloaded : [];
    if (!best || rows.length > best.length) {
      best = rows;
      bestOrigin = typeof raw?.origin === 'string' ? raw.origin : '';
    }
  }
  if (!best || best.length === 0) return;
  for (const id of libraryIds) {
    const destDir = civitaiCatalogDir(wildcardsRoot, id);
    const dest = path.join(destDir, 'shelf-summaries.json');
    const current = readJsonFile<{
      version?: number;
      origin?: string;
      downloaded?: unknown[];
      archived?: unknown[];
      maybe?: unknown[];
    }>(dest);
    const currentRows = Array.isArray(current?.downloaded)
      ? current.downloaded
      : [];
    if (currentRows.length >= best.length) continue;
    if (fs.existsSync(dest)) {
      backupBeforeRewrite(
        wildcardsRoot,
        dest,
        path.join(
          'civitai-catalog',
          catalogLibrarySegment(id),
          'shelf-summaries.json',
        ),
      );
    }
    fs.mkdirSync(destDir, { recursive: true });
    atomicWriteFile(
      dest,
      `${JSON.stringify({
        version: 1,
        origin: current?.origin || bestOrigin,
        downloaded: best,
        archived: current?.archived ?? [],
        maybe: current?.maybe ?? [],
      })}\n`,
    );
  }
}

export function migratePerLibraryCatalogs(
  wildcardsRoot: string | null | undefined,
  libraryIds: readonly string[],
): void {
  migrateLibraryFileToPerLibrary(wildcardsRoot, libraryIds);
  recoverLongerLibraryShelves(wildcardsRoot, libraryIds);
  migrateSharedCatalogToPerLibrary(wildcardsRoot, libraryIds);
  restoreLongerDownloadedSummaries(wildcardsRoot, libraryIds);
  splitLibraryShelves(wildcardsRoot, libraryIds);
  migrateLoraCategoryFiles(wildcardsRoot, libraryIds);
}
