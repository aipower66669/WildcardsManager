/**
 * Sibling wildcards sidecar migration — synthetic temp roots only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CACHE_DIR,
  WCM_DIR,
  WILDCARDS_SIDECAR_SUFFIX,
  civitaiCatalogDir,
  configureWildcardsSidecarAppDataDir,
  libraryJsonPath,
  wildcardsSidecarRoot,
} from '../domain/librarySidecarPaths.js';
import { migrateWildcardsInTreeSidecarsToSibling } from './wildcardsSidecarMigration.js';

describe('migrateWildcardsInTreeSidecarsToSibling', () => {
  let tmpRoot: string;
  let wildcardsRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-sibling-'));
    wildcardsRoot = path.join(tmpRoot, 'wildcards');
    fs.mkdirSync(wildcardsRoot, { recursive: true });
    fs.writeFileSync(path.join(wildcardsRoot, '0main.txt'), 'hello\n');
    configureWildcardsSidecarAppDataDir(path.join(tmpRoot, 'libraries'));
  });

  afterEach(() => {
    configureWildcardsSidecarAppDataDir(null);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('moves !.wcm and !Cache into sibling wildcards.wcm', () => {
    const legacyWcm = path.join(wildcardsRoot, WCM_DIR);
    const legacyCache = path.join(wildcardsRoot, CACHE_DIR);
    fs.mkdirSync(legacyWcm, { recursive: true });
    fs.mkdirSync(path.join(legacyCache, 'civitai-catalog'), { recursive: true });
    fs.writeFileSync(
      path.join(legacyWcm, 'library.json'),
      JSON.stringify({ version: 1, lastRootFile: '0main.txt' }),
    );
    fs.writeFileSync(
      path.join(legacyCache, 'civitai-catalog', 'meta.json'),
      '{"ok":true}\n',
    );

    const first = migrateWildcardsInTreeSidecarsToSibling(wildcardsRoot);
    expect(first.moved).toBe(true);

    const sibling = wildcardsSidecarRoot(wildcardsRoot);
    expect(sibling).toBe(
      path.join(tmpRoot, `wildcards${WILDCARDS_SIDECAR_SUFFIX}`),
    );
    expect(fs.existsSync(libraryJsonPath(wildcardsRoot))).toBe(true);
    expect(fs.existsSync(path.join(civitaiCatalogDir(wildcardsRoot), 'meta.json'))).toBe(
      true,
    );
    expect(fs.existsSync(legacyWcm)).toBe(false);
    expect(fs.existsSync(legacyCache)).toBe(false);
    // Content tree stays clean for ComfyUI DP.
    expect(fs.readdirSync(wildcardsRoot)).toEqual(['0main.txt']);

    const second = migrateWildcardsInTreeSidecarsToSibling(wildcardsRoot);
    expect(second.moved).toBe(false);
  });

  it('does not clobber existing sibling files when merging', () => {
    const legacyWcm = path.join(wildcardsRoot, WCM_DIR);
    fs.mkdirSync(legacyWcm, { recursive: true });
    fs.writeFileSync(path.join(legacyWcm, 'library.json'), '{"legacy":true}\n');

    const sibling = wildcardsSidecarRoot(wildcardsRoot);
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(libraryJsonPath(wildcardsRoot), '{"dest":true}\n');

    migrateWildcardsInTreeSidecarsToSibling(wildcardsRoot);
    const raw = fs.readFileSync(libraryJsonPath(wildcardsRoot), 'utf8');
    expect(raw).toContain('"dest":true');
    expect(fs.existsSync(legacyWcm)).toBe(false);
  });

  it('prefers richer legacy library.json over empty sibling', () => {
    const legacyWcm = path.join(wildcardsRoot, WCM_DIR);
    fs.mkdirSync(legacyWcm, { recursive: true });
    fs.writeFileSync(
      path.join(legacyWcm, 'library.json'),
      JSON.stringify({
        version: 1,
        maybeCivitaiModels: [{ origin: 'https://civitai.com', modelId: 1 }],
        loraDownloadCategories: [
          { id: 'a', name: 'A', folder: 'a', wildcardRelativePath: 'a.txt' },
        ],
      }),
    );
    fs.mkdirSync(wildcardsSidecarRoot(wildcardsRoot), { recursive: true });
    fs.writeFileSync(
      libraryJsonPath(wildcardsRoot),
      JSON.stringify({
        version: 1,
        maybeCivitaiModels: [],
        loraDownloadCategories: [],
      }),
    );

    migrateWildcardsInTreeSidecarsToSibling(wildcardsRoot);
    const raw = JSON.parse(
      fs.readFileSync(libraryJsonPath(wildcardsRoot), 'utf8'),
    ) as { maybeCivitaiModels: unknown[] };
    expect(raw.maybeCivitaiModels).toHaveLength(1);
    expect(fs.existsSync(legacyWcm)).toBe(false);
  });
});