import fs from 'node:fs';
import path from 'node:path';
import {
  forgetFileArtifacts,
  retainFileArtifacts,
} from '../domain/fileArtifactCache.js';
import type { FileEntryDto, LibrarySnapshotDto } from '../shared/contracts.js';
import type { LibraryFile } from '../domain/types.js';
import { isLibraryUtilityDirName } from '../domain/librarySidecarPaths.js';
import { pushRecentRoot } from './settingsStore.js';

const WILDCARD_EXTS = new Set(['.txt', '.yaml', '.yml', '.json']);

let openRoot: string | null = null;

type CachedEntry = {
  file: LibraryFile;
  size: number;
  mtimeMs: number;
  /** Last disk text when `unsavedRels` contains this path. */
  persistedText?: string;
};

type FileCache = {
  root: string;
  byRel: Map<string, CachedEntry>;
  /** Entire tree is in memory; callers must not walk/stat again. */
  complete: boolean;
  /** Watcher saw add/remove / unknown path — next ensure restats the tree. */
  listingStale: boolean;
  /** Paths that must be re-read even if still in `byRel`. */
  dirtyRels: Set<string>;
  /** Paths whose current text is RAM-only (disk still has `persistedText`). */
  unsavedRels: Set<string>;
};

/**
 * In-memory library. After the first hydrate, analyze / search / LoRA refs
 * reuse these texts. Disk is touched only on open, save, watcher, or refresh.
 */
let fileCache: FileCache | null = null;

function emptyCache(root: string): FileCache {
  return {
    root,
    byRel: new Map(),
    complete: false,
    listingStale: true,
    dirtyRels: new Set(),
    unsavedRels: new Set(),
  };
}

function normalizeRel(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function clearFileCache(): void {
  fileCache = null;
  forgetFileArtifacts();
}

function ensureCache(root: string): FileCache {
  if (!fileCache || fileCache.root !== root) {
    fileCache = emptyCache(root);
  }
  return fileCache;
}

function atomicWrite(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, data, 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.renameSync(temp, file);
  }
}

function assertInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = fs.realpathSync(path.resolve(root));
  const resolvedCandidate = path.resolve(candidate);
  let realCandidate = resolvedCandidate;
  try {
    realCandidate = fs.realpathSync(resolvedCandidate);
  } catch {
    // File may not exist yet — still check lexical containment.
  }
  const rel = path.relative(resolvedRoot, realCandidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes authorised library root');
  }
  return realCandidate;
}

function walkFiles(root: string): FileEntryDto[] {
  const out: FileEntryDto[] = [];

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (isLibraryUtilityDirName(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!WILDCARD_EXTS.has(ext)) continue;
      const relativePath = path.relative(root, abs).split(path.sep).join('/');
      const key = relativePath.replace(/\.(txt|ya?ml|json)$/i, '');
      out.push({
        relativePath,
        name: entry.name,
        ext: ext as FileEntryDto['ext'],
        key,
      });
    }
  };

  walk(root);
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function rememberEntry(root: string, file: LibraryFile, size: number, mtimeMs: number): void {
  const cache = ensureCache(root);
  cache.dirtyRels.delete(file.relativePath);
  cache.byRel.set(file.relativePath, {
    file: { ...file, size, mtimeMs },
    size,
    mtimeMs,
  });
}

function listFromCache(cache: FileCache): FileEntryDto[] {
  return [...cache.byRel.values()]
    .map(({ file }) => ({
      relativePath: file.relativePath,
      name: file.name,
      ext: file.ext,
      key: file.key,
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function filesFromCache(cache: FileCache): LibraryFile[] {
  return [...cache.byRel.values()]
    .map((entry) => entry.file)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function readOneFromDisk(root: string, entry: FileEntryDto): CachedEntry | null {
  const abs = path.join(root, entry.relativePath);
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    const text = fs.readFileSync(abs, 'utf8');
    forgetFileArtifacts(entry.relativePath);
    const file: LibraryFile = {
      relativePath: entry.relativePath,
      absolutePath: abs,
      name: entry.name,
      ext: entry.ext,
      key: entry.key,
      text,
      size: st.size,
      mtimeMs: st.mtimeMs,
    };
    return { file, size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/** Walk once: reuse in-memory text when size+mtime still match. */
function hydrateFromDisk(root: string): FileCache {
  const prev = fileCache?.root === root ? fileCache.byRel : null;
  const prevUnsaved = fileCache?.root === root ? fileCache.unsavedRels : null;
  const next = new Map<string, CachedEntry>();
  const nextUnsaved = new Set<string>();
  for (const entry of walkFiles(root)) {
    const abs = path.join(root, entry.relativePath);
    try {
      if (prevUnsaved?.has(entry.relativePath)) {
        const kept = prev?.get(entry.relativePath);
        if (kept) {
          next.set(entry.relativePath, kept);
          nextUnsaved.add(entry.relativePath);
          continue;
        }
      }
      const st = fs.statSync(abs);
      const cached = prev?.get(entry.relativePath);
      if (
        cached &&
        cached.size === st.size &&
        cached.mtimeMs === st.mtimeMs
      ) {
        next.set(entry.relativePath, cached);
        continue;
      }
      const loaded = readOneFromDisk(root, entry);
      if (loaded) next.set(entry.relativePath, loaded);
    } catch {
      // skip unreadable
    }
  }
  const cache: FileCache = {
    root,
    byRel: next,
    complete: true,
    listingStale: false,
    dirtyRels: new Set(),
    unsavedRels: nextUnsaved,
  };
  fileCache = cache;
  retainFileArtifacts(next.keys());
  return cache;
}

function reloadDirtyOnly(cache: FileCache): void {
  const root = cache.root;
  for (const rel of cache.dirtyRels) {
    const prev = cache.byRel.get(rel);
    const name = prev?.file.name ?? path.basename(rel);
    const ext = (prev?.file.ext ??
      path.extname(rel).toLowerCase()) as FileEntryDto['ext'];
    const key =
      prev?.file.key ?? rel.replace(/\.(txt|ya?ml|json)$/i, '');
    if (!WILDCARD_EXTS.has(ext)) {
      cache.byRel.delete(rel);
      forgetFileArtifacts(rel);
      continue;
    }
    const loaded = readOneFromDisk(root, {
      relativePath: rel,
      name,
      ext,
      key,
    });
    if (!loaded) {
      cache.byRel.delete(rel);
      forgetFileArtifacts(rel);
      continue;
    }
    cache.byRel.set(rel, loaded);
  }
  cache.dirtyRels.clear();
}

function ensureMemoryCurrent(opts?: { refresh?: boolean }): FileCache {
  const root = libraryService.requireRoot();
  const cache = ensureCache(root);
  if (opts?.refresh) cache.listingStale = true;
  if (!cache.complete || cache.listingStale) {
    return hydrateFromDisk(root);
  }
  if (cache.dirtyRels.size > 0) reloadDirtyOnly(cache);
  return cache;
}

export const libraryService = {
  getRoot(): string | null {
    return openRoot;
  },

  requireRoot(): string {
    if (!openRoot) throw new Error('No wildcard library open');
    return openRoot;
  },

  openRoot(root: string): LibrarySnapshotDto {
    const resolved = path.resolve(root);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('Wildcard root is not a directory');
    }
    openRoot = fs.realpathSync(resolved);
    clearFileCache();
    pushRecentRoot(openRoot);
    const cache = hydrateFromDisk(openRoot);
    return {
      root: openRoot,
      files: listFromCache(cache),
      openedAt: new Date().toISOString(),
    };
  },

  /** Clear the in-memory open root (e.g. switching to a library with no wildcards path). */
  closeRoot(): void {
    openRoot = null;
    clearFileCache();
  },

  /** Drop all cached texts (unknown-path watcher event). Next load re-reads. */
  invalidateContentCache(): void {
    if (!fileCache) return;
    fileCache.complete = false;
    fileCache.listingStale = true;
    fileCache.dirtyRels.clear();
    forgetFileArtifacts();
  },

  /** Drop one path (and children) so the next load re-reads even if mtime is stale. */
  invalidateContentPath(relativePath: string): void {
    const norm = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!norm || !fileCache) return;
    let droppedChild = false;
    if (fileCache.unsavedRels.has(norm)) {
      // In-memory edit is authoritative until save — do not reload disk.
      return;
    }
    fileCache.dirtyRels.add(norm);
    forgetFileArtifacts(norm);
    for (const key of [...fileCache.byRel.keys()]) {
      if (key === norm || key.startsWith(`${norm}/`)) {
        if (fileCache.unsavedRels.has(key)) continue;
        if (key !== norm) droppedChild = true;
        fileCache.byRel.delete(key);
        fileCache.dirtyRels.add(key);
        forgetFileArtifacts(key);
      }
    }
    if (droppedChild) fileCache.listingStale = true;
  },

  listFiles(opts?: { refresh?: boolean }): FileEntryDto[] {
    return listFromCache(ensureMemoryCurrent(opts));
  },

  /**
   * Fingerprint of the last `loadAllFiles()` snapshot (path + size + mtime).
   * Empty when nothing is cached.
   */
  getContentFingerprint(): string {
    if (!fileCache || fileCache.root !== openRoot) return '';
    return [...fileCache.byRel.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([rel, entry]) => {
        const unsaved = fileCache!.unsavedRels.has(rel)
          ? `\0unsaved\0${entry.file.text}`
          : '';
        return `${rel}\0${entry.size}\0${entry.mtimeMs}${unsaved}`;
      })
      .join('\n');
  },

  hasUnsavedMemory(relativePath: string): boolean {
    return fileCache?.unsavedRels.has(normalizeRel(relativePath)) ?? false;
  },

  /**
   * Replace cached text without touching disk. Marks the path unsaved until
   * `writeFileText` (save) or the text is restored to the last persisted value.
   */
  replaceMemoryText(relativePath: string, text: string): void {
    const root = this.requireRoot();
    const normalized = normalizeRel(relativePath);
    const cache = ensureCache(root);
    let prev = cache.byRel.get(normalized);
    if (!prev) {
      this.readFile(normalized);
      prev = cache.byRel.get(normalized);
      if (!prev) throw new Error('File not found');
    }
    if (prev.file.text === text && !cache.unsavedRels.has(normalized)) return;

    const persistedText = cache.unsavedRels.has(normalized)
      ? (prev.persistedText ?? prev.file.text)
      : prev.file.text;

    if (text === persistedText) {
      cache.unsavedRels.delete(normalized);
      cache.byRel.set(normalized, {
        file: { ...prev.file, text },
        size: prev.size,
        mtimeMs: prev.mtimeMs,
      });
      forgetFileArtifacts(normalized);
      return;
    }

    cache.unsavedRels.add(normalized);
    cache.byRel.set(normalized, {
      file: { ...prev.file, text },
      size: prev.size,
      mtimeMs: prev.mtimeMs,
      persistedText,
    });
    forgetFileArtifacts(normalized);
  },

  readFile(relativePath: string): {
    relativePath: string;
    absolutePath: string;
    text: string;
    unsaved?: boolean;
    persistedText?: string;
  } {
    const root = this.requireRoot();
    const normalized = relativePath.split(path.sep).join('/');
    const cache = fileCache?.root === root ? fileCache : null;
    if (cache && !cache.dirtyRels.has(normalized)) {
      const hit = cache.byRel.get(normalized);
      if (hit) {
        const unsaved = cache.unsavedRels.has(normalized);
        return {
          relativePath: normalized,
          absolutePath: hit.file.absolutePath,
          text: hit.file.text,
          ...(unsaved
            ? { unsaved: true, persistedText: hit.persistedText ?? undefined }
            : {}),
        };
      }
    }
    const abs = assertInsideRoot(root, path.join(root, relativePath));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error('File not found');
    }
    const st = fs.statSync(abs);
    const text = fs.readFileSync(abs, 'utf8');
    const ext = path.extname(abs).toLowerCase() as LibraryFile['ext'];
    const name = path.basename(abs);
    const key = normalized.replace(/\.(txt|ya?ml|json)$/i, '');
    rememberEntry(
      root,
      {
        relativePath: normalized,
        absolutePath: abs,
        name,
        ext,
        key,
        text,
        size: st.size,
        mtimeMs: st.mtimeMs,
      },
      st.size,
      st.mtimeMs,
    );
    forgetFileArtifacts(normalized);
    return {
      relativePath: normalized,
      absolutePath: abs,
      text,
    };
  },

  writeFileText(relativePath: string, text: string): void {
    const root = this.requireRoot();
    const abs = assertInsideRoot(root, path.join(root, relativePath));
    const ext = path.extname(abs).toLowerCase();
    if (!WILDCARD_EXTS.has(ext)) {
      throw new Error(`Refusing to write non-wildcard file: ${relativePath}`);
    }
    atomicWrite(abs, text);
    const st = fs.statSync(abs);
    const normalized = relativePath.split(path.sep).join('/');
    const name = path.basename(abs);
    const key = normalized.replace(/\.(txt|ya?ml|json)$/i, '');
    rememberEntry(
      root,
      {
        relativePath: normalized,
        absolutePath: abs,
        name,
        ext: ext as LibraryFile['ext'],
        key,
        text,
        size: st.size,
        mtimeMs: st.mtimeMs,
      },
      st.size,
      st.mtimeMs,
    );
    fileCache?.unsavedRels.delete(normalized);
    forgetFileArtifacts(normalized);
  },

  deleteFile(relativePath: string): void {
    const root = this.requireRoot();
    const abs = assertInsideRoot(root, path.join(root, relativePath));
    const ext = path.extname(abs).toLowerCase();
    if (!WILDCARD_EXTS.has(ext)) {
      throw new Error(`Refusing to delete non-wildcard file: ${relativePath}`);
    }
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    const normalized = relativePath.split(path.sep).join('/');
    fileCache?.byRel.delete(normalized);
    fileCache?.unsavedRels.delete(normalized);
    forgetFileArtifacts(normalized);
  },

  loadAllFiles(opts?: { refresh?: boolean }): LibraryFile[] {
    return filesFromCache(ensureMemoryCurrent(opts));
  },
};
