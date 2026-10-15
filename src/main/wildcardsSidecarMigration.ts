/**
 * Move wildcards in-tree `!.wcm` / `!Cache` into sibling `<basename>.wcm/`.
 * Idempotent — safe when already migrated or when legacy dirs are absent.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  legacyWildcardsCacheDir,
  legacyWildcardsWcmDir,
  wildcardsCacheDir,
  wildcardsSidecarRoot,
} from '../domain/librarySidecarPaths.js';
import { removePathRecursive } from './librarySidecarIo.js';

function moveFileNoClobber(from: string, to: string): void {
  if (!fs.existsSync(from)) return;
  if (fs.existsSync(to)) {
    try {
      fs.unlinkSync(from);
    } catch {
      // ignore
    }
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
    try {
      fs.unlinkSync(from);
    } catch {
      // ignore
    }
  }
}

function libraryJsonListScore(file: string): number {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<
      string,
      unknown
    >;
    const keys = [
      'ignoredUnusedLoras',
      'archivedCivitaiModels',
      'archivedCivitaiImages',
      'maybeCivitaiModels',
      'markedInstalledCivitaiModels',
      'markedInstalledCivitaiVersions',
      'civitaiWatchlist',
      'loraDownloadCategories',
    ];
    return keys.reduce(
      (sum, key) => sum + (Array.isArray(raw[key]) ? raw[key].length : 0),
      0,
    );
  } catch {
    return 0;
  }
}

/**
 * Merge-move `src` into `dest`: existing dest files win, except `library.json`
 * where the richer membership payload wins (avoids empty sibling clobber).
 */
function mergeMoveDir(src: string, dest: string): boolean {
  if (!fs.existsSync(src)) return false;
  let touched = false;
  fs.mkdirSync(dest, { recursive: true });
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (mergeMoveDir(from, to)) touched = true;
    } else if (entry.isFile()) {
      if (fs.existsSync(to)) {
        if (
          entry.name === 'library.json' &&
          libraryJsonListScore(from) > libraryJsonListScore(to)
        ) {
          try {
            fs.unlinkSync(to);
          } catch {
            // ignore
          }
          moveFileNoClobber(from, to);
          touched = true;
        } else {
          try {
            fs.unlinkSync(from);
            touched = true;
          } catch {
            // ignore
          }
        }
      } else {
        moveFileNoClobber(from, to);
        if (fs.existsSync(to)) touched = true;
      }
    }
  }
  try {
    if (fs.readdirSync(src).length === 0) {
      fs.rmdirSync(src);
      touched = true;
    }
  } catch {
    // ignore
  }
  return touched;
}

function removeIfEmpty(dir: string): void {
  try {
    if (!fs.existsSync(dir)) return;
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch {
    // ignore
  }
}

/**
 * Relocate legacy in-tree wildcards sidecars to the sibling `.wcm` folder.
 * Returns whether any filesystem change was made.
 */
export function migrateWildcardsInTreeSidecarsToSibling(
  wildcardsRoot: string,
): { moved: boolean } {
  const root = wildcardsRoot?.trim();
  if (!root) return { moved: false };

  const legacyWcm = legacyWildcardsWcmDir(root);
  const legacyCache = legacyWildcardsCacheDir(root);
  const hasLegacyWcm = fs.existsSync(legacyWcm);
  const hasLegacyCache = fs.existsSync(legacyCache);
  if (!hasLegacyWcm && !hasLegacyCache) {
    return { moved: false };
  }

  const dest = wildcardsSidecarRoot(root);
  const destCache = wildcardsCacheDir(root);
  let moved = false;

  fs.mkdirSync(dest, { recursive: true });

  if (hasLegacyWcm) {
    if (mergeMoveDir(legacyWcm, dest)) moved = true;
    removeIfEmpty(legacyWcm);
    // If merge left leftovers that couldn't move, force-copy remaining then wipe.
    if (fs.existsSync(legacyWcm)) {
      try {
        const left = fs.readdirSync(legacyWcm);
        if (left.length === 0) {
          removePathRecursive(legacyWcm);
          moved = true;
        } else {
          // Dest already has conflicting names — remove legacy duplicates only.
          // Any unique leftovers: copy without clobber already done; wipe tree
          // only when every file exists at dest.
          let allMirrored = true;
          for (const name of left) {
            if (!fs.existsSync(path.join(dest, name))) {
              allMirrored = false;
              break;
            }
          }
          if (allMirrored) {
            removePathRecursive(legacyWcm);
            moved = true;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  if (hasLegacyCache) {
    fs.mkdirSync(destCache, { recursive: true });
    if (mergeMoveDir(legacyCache, destCache)) moved = true;
    removeIfEmpty(legacyCache);
    if (fs.existsSync(legacyCache)) {
      try {
        const left = fs.readdirSync(legacyCache);
        if (left.length === 0) {
          removePathRecursive(legacyCache);
          moved = true;
        } else {
          let allMirrored = true;
          for (const name of left) {
            if (!fs.existsSync(path.join(destCache, name))) {
              allMirrored = false;
              break;
            }
          }
          if (allMirrored) {
            removePathRecursive(legacyCache);
            moved = true;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return { moved };
}

/** Run sibling migration for every configured library wildcards root. */
export function migrateAllLibrariesWildcardsSidecarsToSibling(
  wildcardsRoots: Array<string | null | undefined>,
): { migratedLibraries: number } {
  let migratedLibraries = 0;
  const seen = new Set<string>();
  for (const raw of wildcardsRoots) {
    const root = raw?.trim();
    if (!root) continue;
    const key = path.resolve(root).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const { moved } = migrateWildcardsInTreeSidecarsToSibling(root);
    if (moved) migratedLibraries += 1;
  }
  return { migratedLibraries };
}
