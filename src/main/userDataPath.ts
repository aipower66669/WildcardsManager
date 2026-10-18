/**
 * Dev (`npm run dev`) and the packaged app must share one userData folder.
 * Electron names that folder from package.json `name`, unless `productName`
 * is set — the Windows installer uses “Wildcards Manager” as its display
 * name, which would otherwise become a second AppData directory.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Folder under `%AppData%/Roaming` (or the platform appData dir). */
export const CANONICAL_USER_DATA_DIR_NAME = 'wildcards-manager';

/**
 * Older packaged builds that followed the installer product name.
 * Missing files are copied in; files already in the canonical folder win.
 */
export const LEGACY_USER_DATA_DIR_NAMES = ['Wildcards Manager'] as const;

/** Chromium runtime dirs and lock files — not app settings. */
const SKIP_ENTRY_NAMES = new Set([
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie',
  'lockfile',
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Local Storage',
  'Session Storage',
  'Shared Dictionary',
  'SharedStorage',
  'blob_storage',
  'Network',
  'Service Worker',
  'IndexedDB',
  'WebStorage',
  'databases',
  'File System',
  'Crashpad',
  'component_crx_cache',
  'extensions_crx_cache',
  'segmentation_platform',
  'VideoDecodeStats',
  'Trust Tokens',
  'OriginTrials',
  'OptimizationHints',
]);

/**
 * Copy files from `fromDir` into `toDir` when the destination path is absent.
 * Existing destination files are left untouched. Returns how many files were
 * copied.
 */
export function copyMissingUserDataEntries(fromDir: string, toDir: string): number {
  if (!fs.existsSync(fromDir)) return 0;
  let copied = 0;

  const walk = (src: string, dest: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(src, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_ENTRY_NAMES.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        walk(from, to);
        continue;
      }
      if (!entry.isFile()) continue;
      if (fs.existsSync(to)) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied += 1;
    }
  };

  walk(fromDir, toDir);
  return copied;
}

/**
 * Point Electron `userData` and `sessionData` at the shared folder, after
 * filling any files that exist only under a legacy product-name folder.
 * Call before `app.ready` and before the first `getPath('userData')`.
 */
export function pinSharedUserData(opts: {
  appDataDir: string;
  mkdir: (dir: string) => void;
  exists: (dir: string) => boolean;
  setPath: (name: 'userData' | 'sessionData', dir: string) => void;
}): string {
  const canonical = path.join(opts.appDataDir, CANONICAL_USER_DATA_DIR_NAME);
  opts.mkdir(canonical);
  const canonicalResolved = path.resolve(canonical);
  for (const name of LEGACY_USER_DATA_DIR_NAMES) {
    const legacy = path.join(opts.appDataDir, name);
    if (path.resolve(legacy) === canonicalResolved) continue;
    if (!opts.exists(legacy)) continue;
    copyMissingUserDataEntries(legacy, canonical);
  }
  opts.setPath('userData', canonical);
  opts.setPath('sessionData', canonical);
  return canonical;
}
