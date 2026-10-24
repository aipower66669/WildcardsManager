import fs from 'node:fs';
import path from 'node:path';
import { civitaiCatalogDir } from '../domain/librarySidecarPaths.js';
import {
  backupBeforeRewrite,
  migrateLibraryFileToPerLibrary,
  recoverLongerLibraryShelves,
} from './libraryLocalFile.js';
import { copyDirRecursive } from './librarySidecarIo.js';

/** Top-level names of the old shared catalog directory. */
const SHARED_CATALOG_ENTRIES = [
  'meta.json',
  'models',
  'slices',
  'autoV2-index.json',
] as const;

function presentSharedEntries(dir: string): string[] {
  return SHARED_CATALOG_ENTRIES.filter((name) =>
    fs.existsSync(path.join(dir, name)),
  );
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

  if (ids.length === 1) {
    const dest = civitaiCatalogDir(wildcardsRoot, ids[0]!);
    const missing = shared.filter((name) => !fs.existsSync(path.join(dest, name)));
    if (missing.length === shared.length) {
      fs.mkdirSync(dest, { recursive: true });
      for (const name of shared) {
        fs.renameSync(path.join(parent, name), path.join(dest, name));
      }
      return 1;
    }
  }

  let copied = 0;
  for (const id of ids) {
    const dest = civitaiCatalogDir(wildcardsRoot, id);
    const missing = shared.filter(
      (name) => !fs.existsSync(path.join(dest, name)),
    );
    if (missing.length === 0) continue;
    fs.mkdirSync(dest, { recursive: true });
    for (const name of missing) {
      const src = path.join(parent, name);
      const target = path.join(dest, name);
      if (fs.statSync(src).isDirectory()) copyDirRecursive(src, target);
      else fs.copyFileSync(src, target);
    }
    copied += 1;
  }

  const complete = ids.every((id) => {
    const dest = civitaiCatalogDir(wildcardsRoot, id);
    return shared.every((name) => fs.existsSync(path.join(dest, name)));
  });
  if (complete) {
    for (const name of shared) {
      fs.rmSync(path.join(parent, name), { recursive: true, force: true });
    }
  }
  return copied;
}

export function migratePerLibraryCatalogs(
  wildcardsRoot: string | null | undefined,
  libraryIds: readonly string[],
): void {
  migrateLibraryFileToPerLibrary(wildcardsRoot, libraryIds);
  recoverLongerLibraryShelves(wildcardsRoot, libraryIds);
  migrateSharedCatalogToPerLibrary(wildcardsRoot, libraryIds);
}
