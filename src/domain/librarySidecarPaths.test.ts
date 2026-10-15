import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CACHE_DIR,
  THUMBNAILS_DIR,
  WCM_DIR,
  WILDCARDS_CACHE_SUBDIR,
  WILDCARDS_SIDECAR_SUFFIX,
  civitaiCatalogDir,
  configureWildcardsSidecarAppDataDir,
  hashMissesPath,
  isFilesystemRootPath,
  isLibraryUtilityDirName,
  legacyWildcardsCacheDir,
  legacyWildcardsWcmDir,
  libraryJsonPath,
  modelFileIndexPath,
  pathHasLibraryUtilitySegment,
  stableWildcardsSidecarId,
  promptCoverageJsonPath,
  validationJsonPath,
  wildcardsBackupsDir,
  wildcardsCacheDir,
  wildcardsSidecarRoot,
} from './librarySidecarPaths.js';

describe('librarySidecarPaths', () => {
  afterEach(() => {
    configureWildcardsSidecarAppDataDir(null);
  });

  it('places model file-index under !.wcm', () => {
    const root = path.join('D:', 'models', 'Lora');
    expect(modelFileIndexPath(root)).toBe(
      path.join(root, WCM_DIR, 'file-index.json'),
    );
  });

  it('recognizes utility dir names', () => {
    expect(isLibraryUtilityDirName(WCM_DIR)).toBe(true);
    expect(isLibraryUtilityDirName(CACHE_DIR)).toBe(true);
    expect(isLibraryUtilityDirName(THUMBNAILS_DIR)).toBe(true);
    expect(isLibraryUtilityDirName('styles')).toBe(false);
    expect(isLibraryUtilityDirName('!Deleted')).toBe(false);
  });

  it('detects utility segments in relative paths', () => {
    expect(pathHasLibraryUtilitySegment('!.wcm/library.json')).toBe(true);
    expect(pathHasLibraryUtilitySegment('!Thumbnails/w512-abc.jpg')).toBe(true);
    expect(pathHasLibraryUtilitySegment('artists/foo.txt')).toBe(false);
  });

  it('places wildcards sidecars in a sibling <basename>.wcm folder', () => {
    const root = path.join('D:', 'ComfyUI', 'wildcards');
    const resolved = path.resolve(root);
    const sidecar = path.join(
      path.dirname(resolved),
      `wildcards${WILDCARDS_SIDECAR_SUFFIX}`,
    );
    expect(wildcardsSidecarRoot(root)).toBe(sidecar);
    expect(libraryJsonPath(root)).toBe(path.join(sidecar, 'library.json'));
    expect(validationJsonPath(root)).toBe(path.join(sidecar, 'validation.json'));
    expect(promptCoverageJsonPath(root)).toBe(
      path.join(sidecar, 'prompt-coverage.json'),
    );
    expect(wildcardsBackupsDir(root)).toBe(path.join(sidecar, 'backups'));
    expect(wildcardsCacheDir(root)).toBe(
      path.join(sidecar, WILDCARDS_CACHE_SUBDIR),
    );
    expect(civitaiCatalogDir(root)).toBe(
      path.join(sidecar, WILDCARDS_CACHE_SUBDIR, 'civitai-catalog'),
    );
    expect(hashMissesPath(root)).toBe(
      path.join(sidecar, WILDCARDS_CACHE_SUBDIR, 'model-hash-misses.json'),
    );
    expect(legacyWildcardsWcmDir(root)).toBe(path.join(path.resolve(root), WCM_DIR));
    expect(legacyWildcardsCacheDir(root)).toBe(
      path.join(path.resolve(root), CACHE_DIR),
    );
  });

  it('falls back to AppData libraries id when wildcards root is a drive root', () => {
    const drive = path.parse(process.cwd()).root;
    expect(isFilesystemRootPath(drive)).toBe(true);
    const appDataLibs = path.resolve(path.join('C:', 'AppData', 'libraries'));
    configureWildcardsSidecarAppDataDir(appDataLibs);
    const id = stableWildcardsSidecarId(drive);
    expect(wildcardsSidecarRoot(drive)).toBe(path.join(appDataLibs, id));
  });
});
