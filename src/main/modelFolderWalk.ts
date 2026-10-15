import fs from 'node:fs';
import path from 'node:path';
import { isLibraryUtilityDirName } from '../domain/librarySidecarPaths.js';
import {
  classifyModelWalkName,
  defaultWeightExtensionSet,
} from '../domain/modelWalkName.js';

/**
 * Resolve whether a dirent is a real directory after following symlinks /
 * Windows directory junctions. `Dirent.isDirectory()` is false for those.
 *
 * Regular files must not pay a `statSync` — that froze the UI on large LoRA
 * trees (one extra syscall per weight file, plus Defender).
 */
export function direntIsDirectory(abs: string, entry: fs.Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (entry.isFile()) return false;
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/** Same for files that may be symlinks to models on another volume. */
export function direntIsFile(abs: string, entry: fs.Dirent): boolean {
  if (entry.isFile()) return true;
  if (entry.isDirectory()) return false;
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

/**
 * `fs.promises.realpath` on Windows is the native call and may return a
 * `\\?\` path. `fs.realpathSync` does not. Strip the prefix so both compare.
 */
function stripExtendedPathPrefix(p: string): string {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\UNC\\')) return `\\\\${p.slice('\\\\?\\UNC\\'.length)}`;
  if (p.startsWith('\\\\?\\')) return p.slice('\\\\?\\'.length);
  return p;
}

export function isPathInsideRoot(rootReal: string, candidateReal: string): boolean {
  const rel = path.relative(
    path.resolve(stripExtendedPathPrefix(rootReal)),
    path.resolve(stripExtendedPathPrefix(candidateReal)),
  );
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Windows paths compare case-insensitively. Linux paths do not. */
function fsPathKey(p: string): string {
  const resolved = stripExtendedPathPrefix(path.resolve(p));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function rootRealKey(root: string): string {
  const resolved = path.resolve(root);
  try {
    return fsPathKey(fs.realpathSync(resolved));
  } catch {
    return fsPathKey(resolved);
  }
}

function rememberVisited(visited: Set<string>, abs: string, real: string): boolean {
  const key = fsPathKey(abs);
  const realKey = fsPathKey(real);
  if (visited.has(key) || visited.has(realKey)) return false;
  visited.add(key);
  visited.add(realKey);
  return true;
}

/**
 * True when `abs` is a directory we may recurse into. Junctions / symlinks
 * that resolve outside `rootReal` are skipped so a link cannot pull in
 * another drive or the parent models tree.
 */
export function isSafeWalkDirectory(
  abs: string,
  rootReal: string,
  visited: Set<string>,
): boolean {
  let lst: fs.Stats;
  try {
    lst = fs.lstatSync(abs);
  } catch {
    return false;
  }
  if (!lst.isDirectory() && !lst.isSymbolicLink()) return false;
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return false;
  }
  if (!isPathInsideRoot(rootReal, real)) return false;
  try {
    if (!fs.statSync(real).isDirectory()) return false;
  } catch {
    return false;
  }
  return !visited.has(fsPathKey(real));
}

function enterDir(abs: string, rootReal: string, visited: Set<string>): boolean {
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    real = path.resolve(abs);
  }
  if (!isPathInsideRoot(rootReal, real)) return false;
  return rememberVisited(visited, abs, real);
}

export type ModelFolderWalkOpts = {
  yieldEvery?: number;
  visited?: Set<string>;
  onProgress?: (files: number) => void;
  /** Defaults to LoRA + checkpoint weight extensions. */
  weightExtensions?: ReadonlySet<string>;
};

function visitDirSync(
  root: string,
  dir: string,
  onFile: (absolutePath: string, relativePosix: string) => void,
  visited: Set<string>,
  rootReal: string,
  weightExts: ReadonlySet<string>,
): void {
  if (!enterDir(dir, rootReal, visited)) return;

  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }

  for (const name of names) {
    if (name.startsWith('.')) continue;
    if (isLibraryUtilityDirName(name)) continue;
    const kind = classifyModelWalkName(name, weightExts);
    if (kind === 'skip') continue;
    const abs = path.join(dir, name);
    if (kind === 'weight') {
      const relative = path.relative(root, abs).split(path.sep).join('/');
      onFile(abs, relative);
      continue;
    }
    if (isSafeWalkDirectory(abs, rootReal, visited)) {
      visitDirSync(root, abs, onFile, visited, rootReal, weightExts);
    }
  }
}

/**
 * Recursively visit weight files under `root`.
 * Does not follow junctions/symlinks that escape `root`.
 * Sidecar previews / `.txt` / `.json` are skipped by name (no stat).
 */
export function walkModelFolderEntries(
  root: string,
  dir: string,
  onFile: (absolutePath: string, relativePosix: string) => void,
  visited: Set<string> = new Set(),
  opts?: Pick<ModelFolderWalkOpts, 'weightExtensions'>,
): void {
  const weightExts = opts?.weightExtensions ?? defaultWeightExtensionSet();
  visitDirSync(root, dir, onFile, visited, rootRealKey(root), weightExts);
}

const DEFAULT_YIELD_EVERY = 32;

/**
 * Same walk as `walkModelFolderEntries`, yielding between weight files so
 * Electron IPC / the editor stay responsive during a large folder scan.
 *
 * Listing and directory checks stay on the sync walker. `fs.promises.realpath`
 * is the native Windows call and can return a `\\?\` path (or a different
 * symlink target) than `fs.realpathSync`, which made this walk skip every
 * subdirectory on CI while the sync walk succeeded.
 */
export async function walkModelFolderEntriesAsync(
  root: string,
  dir: string,
  onFile: (absolutePath: string, relativePosix: string) => void,
  opts?: ModelFolderWalkOpts,
): Promise<void> {
  const yieldEvery = Math.max(1, opts?.yieldEvery ?? DEFAULT_YIELD_EVERY);
  const visited = opts?.visited ?? new Set<string>();
  const weightExts = opts?.weightExtensions ?? defaultWeightExtensionSet();
  const rootReal = rootRealKey(root);
  let sinceYield = 0;
  let files = 0;

  const visit = async (current: string): Promise<void> => {
    if (!enterDir(current, rootReal, visited)) return;

    let names: string[];
    try {
      names = fs.readdirSync(current);
    } catch {
      return;
    }

    for (const name of names) {
      if (name.startsWith('.')) continue;
      if (isLibraryUtilityDirName(name)) continue;
      const kind = classifyModelWalkName(name, weightExts);
      if (kind === 'skip') continue;
      const abs = path.join(current, name);
      if (kind === 'weight') {
        const relative = path.relative(root, abs).split(path.sep).join('/');
        files += 1;
        onFile(abs, relative);
        sinceYield += 1;
        if (sinceYield >= yieldEvery) {
          sinceYield = 0;
          opts?.onProgress?.(files);
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        continue;
      }
      if (isSafeWalkDirectory(abs, rootReal, visited)) {
        await visit(abs);
      }
    }
  };

  await visit(dir);
  opts?.onProgress?.(files);
}
