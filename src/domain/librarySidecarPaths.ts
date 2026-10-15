import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Paths for library-owned sidecars.
 *
 * Wildcards datasets live in a **sibling** `<basename>.wcm/` folder so ComfyUI
 * Dynamic Prompts (which scans the wildcards tree) never sees them.
 * LoRA / checkpoint roots still use in-tree `!.wcm` / `!Thumbnails`.
 */

/** In-tree utility dirs (model roots + legacy wildcards locations). */
export const WCM_DIR = '!.wcm';
export const CACHE_DIR = '!Cache';
export const THUMBNAILS_DIR = '!Thumbnails';

/** Sibling folder suffix: `<wildcardsBasename>.wcm`. */
export const WILDCARDS_SIDECAR_SUFFIX = '.wcm';

/** Cache subfolder under the wildcards sibling sidecar. */
export const WILDCARDS_CACHE_SUBDIR = 'cache';

/** Utility folders the app writes under library roots — never scan as content. */
export const LIBRARY_UTILITY_DIR_NAMES = new Set([
  WCM_DIR,
  CACHE_DIR,
  THUMBNAILS_DIR,
]);

/**
 * Optional AppData `libraries/` dir for drive-root wildcards (no parent for a
 * sibling). Configured by main at startup.
 */
let appDataLibrariesDir: string | null = null;

export function configureWildcardsSidecarAppDataDir(
  dir: string | null | undefined,
): void {
  appDataLibrariesDir = dir?.trim() ? path.resolve(dir.trim()) : null;
}

export function getWildcardsSidecarAppDataDir(): string | null {
  return appDataLibrariesDir;
}

export function isLibraryUtilityDirName(name: string): boolean {
  return LIBRARY_UTILITY_DIR_NAMES.has(name);
}

/** True if any path segment is a known utility dir (posix or platform seps). */
export function pathHasLibraryUtilitySegment(relativePath: string): boolean {
  const parts = relativePath.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.some((p) => isLibraryUtilityDirName(p));
}

/** True when `dir` is a filesystem root (e.g. `D:\` or `/`). */
export function isFilesystemRootPath(dir: string): boolean {
  const resolved = path.resolve(dir);
  return path.dirname(resolved) === resolved;
}

/** Stable short id for AppData fallback when wildcards root is a drive root. */
export function stableWildcardsSidecarId(wildcardsRoot: string): string {
  const normalized = path
    .resolve(wildcardsRoot)
    .replaceAll('\\', '/')
    .toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Wildcards app-data root: sibling `<basename>.wcm` next to the content folder.
 * Drive-root libraries use `appDataLibrariesDir/<id>` when configured.
 */
export function wildcardsSidecarRoot(wildcardsRoot: string): string {
  const resolved = path.resolve(wildcardsRoot);
  if (isFilesystemRootPath(resolved)) {
    if (appDataLibrariesDir) {
      return path.join(
        appDataLibrariesDir,
        stableWildcardsSidecarId(resolved),
      );
    }
    // Last resort without AppData config — still outside typical DP content
    // layouts is impossible on a drive root; keep a named folder (rare).
    return path.join(resolved, `_wcm${WILDCARDS_SIDECAR_SUFFIX}`);
  }
  const base = path.basename(resolved);
  return path.join(
    path.dirname(resolved),
    `${base}${WILDCARDS_SIDECAR_SUFFIX}`,
  );
}

/** @deprecated Prefer wildcardsSidecarRoot — alias for callers. */
export function wildcardsWcmDir(wildcardsRoot: string): string {
  return wildcardsSidecarRoot(wildcardsRoot);
}

/** Legacy in-tree `!.wcm` (pre-sibling migration). */
export function legacyWildcardsWcmDir(wildcardsRoot: string): string {
  return path.join(path.resolve(wildcardsRoot), WCM_DIR);
}

/** Legacy in-tree `!Cache` (pre-sibling migration). */
export function legacyWildcardsCacheDir(wildcardsRoot: string): string {
  return path.join(path.resolve(wildcardsRoot), CACHE_DIR);
}

export function libraryJsonPath(wildcardsRoot: string): string {
  return path.join(wildcardsSidecarRoot(wildcardsRoot), 'library.json');
}

export function validationJsonPath(wildcardsRoot: string): string {
  return path.join(wildcardsSidecarRoot(wildcardsRoot), 'validation.json');
}

/** Prompt-library coverage report (gens × wildcard Monte Carlo). */
export function promptCoverageJsonPath(wildcardsRoot: string): string {
  return path.join(wildcardsSidecarRoot(wildcardsRoot), 'prompt-coverage.json');
}

export function wildcardsBackupsDir(wildcardsRoot: string): string {
  return path.join(wildcardsSidecarRoot(wildcardsRoot), 'backups');
}

export function wildcardsCacheDir(wildcardsRoot: string): string {
  return path.join(wildcardsSidecarRoot(wildcardsRoot), WILDCARDS_CACHE_SUBDIR);
}

export function civitaiCatalogDir(wildcardsRoot: string): string {
  return path.join(wildcardsCacheDir(wildcardsRoot), 'civitai-catalog');
}

export function hashMissesPath(wildcardsRoot: string): string {
  return path.join(wildcardsCacheDir(wildcardsRoot), 'model-hash-misses.json');
}

export function modelRootWcmDir(modelRoot: string): string {
  return path.join(modelRoot, WCM_DIR);
}

export function modelsJsonPath(modelRoot: string): string {
  return path.join(modelRoot, WCM_DIR, 'models.json');
}

/** Snapshot of weight files under a LoRA/checkpoint root (`!.wcm/file-index.json`). */
export function modelFileIndexPath(modelRoot: string): string {
  return path.join(modelRoot, WCM_DIR, 'file-index.json');
}

export function downloadQueueJsonPath(modelRoot: string): string {
  return path.join(modelRoot, WCM_DIR, 'download-queue.json');
}

export function hfDownloadQueueJsonPath(modelRoot: string): string {
  return path.join(modelRoot, WCM_DIR, 'hf-download-queue.json');
}

export function masterImagesJsonPath(checkpointRoot: string): string {
  return path.join(checkpointRoot, WCM_DIR, 'master-images.json');
}

/**
 * Legacy on-disk path under an images root (`!.wcm/downloaded-images.json`).
 * Canonical registry is Electron userData `downloaded-civitai-images.json`
 * (see main `civitaiImageDownload` + migrate on startup).
 */
export function downloadedImagesJsonPath(imagesRoot: string): string {
  return path.join(imagesRoot, WCM_DIR, 'downloaded-images.json');
}

/** Legacy on-disk path under a videos root (`!.wcm/downloaded-videos.json`). */
export function downloadedVideosJsonPath(videosRoot: string): string {
  return path.join(videosRoot, WCM_DIR, 'downloaded-videos.json');
}

export function thumbnailsDir(modelRoot: string): string {
  return path.join(modelRoot, THUMBNAILS_DIR);
}

/** Whether `absolutePath` is inside `root` (lexical, case-insensitive on win). */
export function isPathInsideRoot(
  absolutePath: string,
  root: string | null | undefined,
): boolean {
  if (!root?.trim()) return false;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(absolutePath);
  const rel = path.relative(resolvedRoot, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return true;
}

/** Root-relative posix key for stable JSON maps. */
export function rootRelativePosixKey(
  absolutePath: string,
  root: string,
): string {
  return path
    .relative(path.resolve(root), path.resolve(absolutePath))
    .split(path.sep)
    .join('/')
    .toLowerCase();
}
