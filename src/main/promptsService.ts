import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { expandPrompts } from '../domain/expand.js';
import {
  buildLibraryIndex,
  type LibraryIndex,
} from '../domain/resolveWildcard.js';
import { decodeGenPrompts } from '../domain/genPrompts.js';
import { genPromptFoldersUnder } from '../domain/genPromptFoldersUnder.js';
import {
  sanitizePromptFolderName,
  uniqueNewPromptFolderName,
} from '../domain/promptFolderNames.js';
import { isSkippedPromptFolderName } from '../domain/promptFolderSkip.js';
import type {
  PromptFolderNodeDto,
  PromptGenFileDto,
  PromptSampleImageDto,
  PromptTreeDto,
} from '../shared/contracts.js';
import { libraryService } from './libraryService.js';
import { loadSettings } from './settingsStore.js';

const GEN_FILE = '!gen.txt';
/** Staging folder for new generations — hidden in the tree, merged into samples. */
const REVIEW_SUBFOLDER = 'new';
/** Privileged scheme for prompt sample images (file:// is blocked in the renderer). */
export const PROMPT_MEDIA_PROTOCOL = 'wcm-prompt';
const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.avif',
]);

function isReviewSubfolderName(name: string): boolean {
  return name.toLowerCase() === REVIEW_SUBFOLDER;
}

/**
 * Absolute paths of directories Windows has marked Hidden.
 * `!.wcm` is also skipped by name; this covers any other folder the user hid.
 * Cached so a generation job does not rescan the tree. Generation itself
 * uses the `!gen.txt` folder list cache and does not call this per image.
 */
let hiddenDirCache: { root: string; at: number; paths: Set<string> } | null =
  null;
const HIDDEN_DIR_TTL_MS = 60_000;

const HIDDEN_DIR_ARGS = ['/d', '/c', 'chcp 65001>nul & dir /a:hd /b /s'] as const;

function hiddenDirsFromListing(stdout: string): Set<string> {
  const paths = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    paths.add(path.resolve(trimmed).toLowerCase());
  }
  return paths;
}

function hiddenDirCacheHit(root: string): Set<string> | null {
  if (process.platform !== 'win32') return new Set();
  const now = Date.now();
  if (
    hiddenDirCache &&
    hiddenDirCache.root === root &&
    now - hiddenDirCache.at < HIDDEN_DIR_TTL_MS
  ) {
    return hiddenDirCache.paths;
  }
  return null;
}

function windowsHiddenDirectories(root: string): Set<string> {
  const cached = hiddenDirCacheHit(root);
  if (cached) return cached;
  let paths = new Set<string>();
  try {
    const out = execFileSync(process.env.ComSpec ?? 'cmd.exe', [...HIDDEN_DIR_ARGS], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    paths = hiddenDirsFromListing(out);
  } catch {
    // `dir` exits 1 when nothing is hidden.
  }
  hiddenDirCache = { root, at: Date.now(), paths };
  return paths;
}

function windowsHiddenDirectoriesAsync(root: string): Promise<Set<string>> {
  const cached = hiddenDirCacheHit(root);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    execFile(
      process.env.ComSpec ?? 'cmd.exe',
      [...HIDDEN_DIR_ARGS],
      {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout) => {
        const paths = err ? new Set<string>() : hiddenDirsFromListing(stdout);
        hiddenDirCache = { root, at: Date.now(), paths };
        resolve(paths);
      },
    );
  });
}

function isOsHiddenDirectory(abs: string, hidden: Set<string>): boolean {
  return hidden.has(path.resolve(abs).toLowerCase());
}

/** Renderer-safe URL for an image under the prompts root. */
function promptMediaUrl(relativePath: string): string {
  const encoded = relativePath
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  return `${PROMPT_MEDIA_PROTOCOL}://local/${encoded}`;
}

/** Must be called before app ready. */
export function registerPromptMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PROMPT_MEDIA_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/** Must be called after app ready. */
export function registerPromptMediaProtocolHandler(): void {
  protocol.handle(PROMPT_MEDIA_PROTOCOL, (request) => {
    try {
      const parsed = new URL(request.url);
      const rel = decodeURIComponent(
        parsed.pathname.replace(/^\/+/, '') || '',
      ).replaceAll('\\', '/');
      if (
        !rel ||
        rel.includes('..') ||
        path.isAbsolute(rel) ||
        rel.split('/').some((part) => part === '..')
      ) {
        return new Response('Not found', { status: 404 });
      }
      const root = promptsRoot();
      const abs = assertInsideRoot(root, path.join(root, rel));
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return new Response('Not found', { status: 404 });
      }
      const ext = path.extname(abs).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(abs).href);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
}

function listImageFilesInDir(dir: string): string[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    const abs = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (!IMAGE_EXTS.has(path.extname(name).toLowerCase())) continue;
    out.push(name);
  }
  return out;
}

function countImagesForPromptFolder(dir: string): number {
  const reviewDir = path.join(dir, REVIEW_SUBFOLDER);
  return (
    listImageFilesInDir(dir).length + listImageFilesInDir(reviewDir).length
  );
}

function promptsRoot(): string {
  const root = loadSettings().promptsFolder?.trim();
  if (!root) throw new Error('No prompts folder configured');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error('Configured prompts folder no longer exists');
  }
  return fs.realpathSync(path.resolve(root));
}

function assertInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = root;
  const resolvedCandidate = path.resolve(candidate);
  let realCandidate = resolvedCandidate;
  try {
    realCandidate = fs.realpathSync(resolvedCandidate);
  } catch {
    // May not exist yet.
  }
  const rel = path.relative(resolvedRoot, realCandidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes authorised prompts root');
  }
  return realCandidate;
}

function normalizeRelative(relativeFolder: string): string {
  const cleaned = relativeFolder
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (!cleaned || cleaned.includes('..')) {
    throw new Error('Invalid prompts folder path');
  }
  const parts = cleaned.split('/');
  if (parts.some((part) => isReviewSubfolderName(part))) {
    throw new Error(
      `The "${REVIEW_SUBFOLDER}" folder is reserved for generated review images`,
    );
  }
  return cleaned;
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

function walkPromptTree(
  root: string,
  relative: string,
  hidden: Set<string>,
): PromptFolderNodeDto[] {
  const abs = relative
    ? assertInsideRoot(root, path.join(root, relative))
    : root;
  let names: string[] = [];
  try {
    names = fs.readdirSync(abs);
  } catch {
    return [];
  }
  const children: PromptFolderNodeDto[] = [];
  for (const name of names.sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  )) {
    if (isSkippedPromptFolderName(name)) continue;
    const childAbs = path.join(abs, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(childAbs);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (isOsHiddenDirectory(childAbs, hidden)) continue;
    const childRel = relative ? `${relative}/${name}` : name;
    const genPath = path.join(childAbs, GEN_FILE);
    children.push({
      name,
      relativePath: childRel.replaceAll('\\', '/'),
      hasGenFile: fs.existsSync(genPath) && fs.statSync(genPath).isFile(),
      imageCount: countImagesForPromptFolder(childAbs),
      children: walkPromptTree(root, childRel.replaceAll('\\', '/'), hidden),
    });
  }
  return children;
}

export function listPromptTree(): PromptTreeDto {
  const root = loadSettings().promptsFolder?.trim()
    ? promptsRoot()
    : null;
  if (!root) {
    return { root: null, folders: [] };
  }
  return {
    root,
    folders: walkPromptTree(root, '', windowsHiddenDirectories(root)),
  };
}

/**
 * Relative paths of prompt folders that contain `!gen.txt`.
 * The list is cached. A cold miss still walks on this thread; generation
 * awaits `ensureGenPromptFolders` so later images do not.
 */
let genFolderCache: { root: string; folders: string[]; at: number } | null =
  null;
let genFolderRefresh: Promise<void> | null = null;
const GEN_FOLDER_REFRESH_MS = 60_000;

function readPromptsRoot(): string | null {
  if (!loadSettings().promptsFolder?.trim()) return null;
  try {
    return promptsRoot();
  } catch {
    return null;
  }
}

function walkGenPromptFoldersSync(root: string): string[] {
  const hidden = windowsHiddenDirectories(root);
  const out: string[] = [];
  const walk = (dir: string, relative: string) => {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    if (relative) {
      try {
        if (fs.statSync(path.join(dir, GEN_FILE)).isFile()) out.push(relative);
      } catch {
        // no !gen.txt in this folder
      }
    }
    for (const name of names) {
      if (isSkippedPromptFolderName(name)) continue;
      const abs = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (isOsHiddenDirectory(abs, hidden)) continue;
      const childRel = relative ? `${relative}/${name}` : name;
      walk(abs, childRel.replaceAll('\\', '/'));
    }
  };
  walk(root, '');
  return out;
}

async function walkGenPromptFoldersAsync(root: string): Promise<string[]> {
  const hidden = await windowsHiddenDirectoriesAsync(root);
  const out: string[] = [];
  const walk = async (dir: string, relative: string) => {
    let names: string[] = [];
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      return;
    }
    if (relative) {
      try {
        const st = await fs.promises.stat(path.join(dir, GEN_FILE));
        if (st.isFile()) out.push(relative);
      } catch {
        // no !gen.txt in this folder
      }
    }
    for (const name of names) {
      if (isSkippedPromptFolderName(name)) continue;
      const abs = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = await fs.promises.stat(abs);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (isOsHiddenDirectory(abs, hidden)) continue;
      const childRel = relative ? `${relative}/${name}` : name;
      await walk(abs, childRel.replaceAll('\\', '/'));
    }
  };
  await walk(root, '');
  return out;
}

export function listGenPromptFolders(): string[] {
  const root = readPromptsRoot();
  if (!root) return [];
  if (genFolderCache?.root === root) return genFolderCache.folders;
  const folders = walkGenPromptFoldersSync(root);
  genFolderCache = { root, folders, at: Date.now() };
  return folders;
}

/** Refresh the `!gen.txt` folder list without blocking the main thread. */
export async function refreshGenPromptFolders(): Promise<void> {
  if (genFolderRefresh) {
    await genFolderRefresh;
    return;
  }
  const root = readPromptsRoot();
  if (!root) {
    genFolderCache = null;
    return;
  }
  const job = walkGenPromptFoldersAsync(root)
    .then((folders) => {
      if (readPromptsRoot() === root) {
        genFolderCache = { root, folders, at: Date.now() };
      }
    })
    .finally(() => {
      if (genFolderRefresh === job) genFolderRefresh = null;
    });
  genFolderRefresh = job;
  await job;
}

/**
 * Folder list for a generation pick. Returns the cache immediately and
 * refreshes it in the background when it is older than a minute.
 */
export async function ensureGenPromptFolders(): Promise<string[]> {
  const root = readPromptsRoot();
  if (!root) return [];
  if (!genFolderCache || genFolderCache.root !== root) {
    await refreshGenPromptFolders();
  } else if (Date.now() - genFolderCache.at > GEN_FOLDER_REFRESH_MS) {
    void refreshGenPromptFolders();
  }
  return genFolderCache?.root === root ? genFolderCache.folders : [];
}

/**
 * `!gen.txt` folders under `parentRelative` (inclusive), or all when parent
 * is empty. Used by Generation Recursive mode.
 */
export function listGenPromptFoldersUnder(parentRelative: string): string[] {
  return genPromptFoldersUnder(listGenPromptFolders(), parentRelative);
}

/** Every `!gen.txt` under the prompts folder, with its folder path. */
export function listGenFiles(): { relativeFolder: string; content: string }[] {
  const rootSetting = loadSettings().promptsFolder?.trim();
  if (!rootSetting) return [];
  let root: string;
  try {
    root = promptsRoot();
  } catch {
    return [];
  }
  const hidden = windowsHiddenDirectories(root);
  const out: { relativeFolder: string; content: string }[] = [];
  const walk = (dir: string) => {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (isSkippedPromptFolderName(name)) continue;
      const abs = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (isOsHiddenDirectory(abs, hidden)) continue;
        walk(abs);
        continue;
      }
      if (!st.isFile() || name !== GEN_FILE) continue;
      const relativeFolder = path.relative(root, dir).replaceAll('\\', '/');
      try {
        out.push({
          relativeFolder: relativeFolder === '.' ? '' : relativeFolder,
          content: fs.readFileSync(abs, 'utf8'),
        });
      } catch {
        // skip unreadable
      }
    }
  };
  walk(root);
  return out;
}

/** All `!gen.txt` bodies under the prompts folder (for LoRA reference scans). */
export function listAllGenFileContents(): string[] {
  return listGenFiles().map((file) => file.content);
}

export function readGenFile(relativeFolder: string): PromptGenFileDto {
  const root = promptsRoot();
  const rel = normalizeRelative(relativeFolder);
  const dir = assertInsideRoot(root, path.join(root, rel));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('Prompt folder not found');
  }
  const genAbs = path.join(dir, GEN_FILE);
  if (!fs.existsSync(genAbs) || !fs.statSync(genAbs).isFile()) {
    return {
      relativeFolder: rel,
      exists: false,
      content: '',
    };
  }
  return {
    relativeFolder: rel,
    exists: true,
    content: fs.readFileSync(genAbs, 'utf8'),
  };
}

export function writeGenFile(
  relativeFolder: string,
  content: string,
): PromptGenFileDto {
  if (typeof content !== 'string') throw new Error('Invalid gen file content');
  const root = promptsRoot();
  const rel = normalizeRelative(relativeFolder);
  const dir = assertInsideRoot(root, path.join(root, rel));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('Prompt folder not found');
  }
  const genAbs = path.join(dir, GEN_FILE);
  atomicWrite(genAbs, content);
  invalidateGenPromptsCache(rel);
  return {
    relativeFolder: rel,
    exists: true,
    content,
  };
}

export function createGenFile(relativeFolder: string): PromptGenFileDto {
  const existing = readGenFile(relativeFolder);
  if (existing.exists) return existing;
  return writeGenFile(relativeFolder, '');
}

function parentDirAbs(root: string, parentRelative: string): string {
  const parentRel = parentRelative.trim()
    ? normalizeRelative(parentRelative)
    : '';
  if (!parentRel) return root;
  const abs = assertInsideRoot(root, path.join(root, parentRel));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error('Parent prompt folder not found');
  }
  return abs;
}

function listChildDirNames(dir: string): string[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    try {
      if (fs.statSync(path.join(dir, name)).isDirectory()) out.push(name);
    } catch {
      // skip
    }
  }
  return out;
}

/**
 * Create an Explorer-style “New folder” under `parentRelative` ('' = prompts root).
 * Caller should immediately enter rename mode on the returned path.
 */
export function createPromptSubfolder(parentRelativeFolder: string): {
  relativeFolder: string;
  name: string;
} {
  const root = promptsRoot();
  const parentRel = parentRelativeFolder.trim()
    ? normalizeRelative(parentRelativeFolder)
    : '';
  const parentAbs = parentDirAbs(root, parentRel);
  const name = uniqueNewPromptFolderName(listChildDirNames(parentAbs));
  const abs = assertInsideRoot(root, path.join(parentAbs, name));
  if (fs.existsSync(abs)) {
    throw new Error('A folder with that name already exists');
  }
  fs.mkdirSync(abs);
  return {
    relativeFolder: parentRel ? `${parentRel}/${name}` : name,
    name,
  };
}

/** Rename a prompt folder (single path segment). */
export function renamePromptFolder(
  relativeFolder: string,
  newName: string,
): { relativeFolder: string } {
  const root = promptsRoot();
  const rel = normalizeRelative(relativeFolder);
  const safeName = sanitizePromptFolderName(newName);
  const oldAbs = assertInsideRoot(root, path.join(root, rel));
  if (!fs.existsSync(oldAbs) || !fs.statSync(oldAbs).isDirectory()) {
    throw new Error('Prompt folder not found');
  }
  if (path.resolve(oldAbs) === path.resolve(root)) {
    throw new Error('Cannot rename the prompts root');
  }
  const parentAbs = path.dirname(oldAbs);
  const newAbs = assertInsideRoot(root, path.join(parentAbs, safeName));
  const sameInsensitive =
    path.resolve(oldAbs).toLowerCase() === path.resolve(newAbs).toLowerCase();
  if (sameInsensitive && path.basename(oldAbs) === safeName) {
    return { relativeFolder: rel };
  }
  if (sameInsensitive) {
    // Windows case-only rename needs a two-step dance.
    const tempAbs = path.join(
      parentAbs,
      `.wcm-rename-${process.pid}-${Date.now()}`,
    );
    fs.renameSync(oldAbs, tempAbs);
    try {
      fs.renameSync(tempAbs, newAbs);
    } catch (err) {
      try {
        fs.renameSync(tempAbs, oldAbs);
      } catch {
        // best-effort restore
      }
      throw err;
    }
  } else {
    if (fs.existsSync(newAbs)) {
      throw new Error('A folder with that name already exists');
    }
    fs.renameSync(oldAbs, newAbs);
  }
  invalidateGenPromptsCache();
  const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  return {
    relativeFolder: parentRel ? `${parentRel}/${safeName}` : safeName,
  };
}

/** Permanently delete a prompt folder and everything inside it. */
export function deletePromptFolder(relativeFolder: string): void {
  const root = promptsRoot();
  const rel = normalizeRelative(relativeFolder);
  const abs = assertInsideRoot(root, path.join(root, rel));
  if (path.resolve(abs) === path.resolve(root)) {
    throw new Error('Cannot delete the prompts root');
  }
  if (!fs.existsSync(abs)) return;
  if (!fs.statSync(abs).isDirectory()) {
    throw new Error('Prompt folder not found');
  }
  fs.rmSync(abs, { recursive: true, force: true });
  invalidateGenPromptsCache();
}

function shuffleInPlace<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function listSampleImages(
  relativeFolder: string,
  limit = 12,
  seed?: number,
): PromptSampleImageDto[] {
  const root = promptsRoot();
  const rel = normalizeRelative(relativeFolder);
  const dir = assertInsideRoot(root, path.join(root, rel));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('Prompt folder not found');
  }
  const max = Math.min(48, Math.max(1, Math.floor(limit)));
  const reviewDir = path.join(dir, REVIEW_SUBFOLDER);

  type Candidate = { fileName: string; abs: string; relativePath: string };
  const candidates: Candidate[] = [];
  for (const name of listImageFilesInDir(dir)) {
    candidates.push({
      fileName: name,
      abs: path.join(dir, name),
      relativePath: `${rel}/${name}`.replaceAll('\\', '/'),
    });
  }
  for (const name of listImageFilesInDir(reviewDir)) {
    candidates.push({
      fileName: name,
      abs: path.join(reviewDir, name),
      relativePath: `${rel}/${REVIEW_SUBFOLDER}/${name}`.replaceAll('\\', '/'),
    });
  }

  const rng = mulberry32(
    typeof seed === 'number' && Number.isFinite(seed)
      ? seed
      : (Date.now() ^ candidates.length) >>> 0,
  );
  shuffleInPlace(candidates, rng);
  return candidates.slice(0, max).map((item) => ({
    fileName: item.fileName,
    relativePath: item.relativePath,
    url: promptMediaUrl(item.relativePath),
  }));
}

/**
 * Decoded prompts from a folder's `!gen.txt` (always reads disk).
 * Comma-leading lines continue the previous prompt (see `decodeGenPrompts`).
 */
export function listGenLines(relativeFolder: string): string[] {
  const file = readGenFile(relativeFolder);
  if (!file.exists) return [];
  return decodeGenPrompts(file.content);
}

/** In-memory decoded prompts for the Generation tab (not re-read every job). */
let genPromptsCache: { relativeFolder: string; prompts: string[] } | null =
  null;

export function invalidateGenPromptsCache(relativeFolder?: string): void {
  if (!genPromptsCache) return;
  if (!relativeFolder) {
    genPromptsCache = null;
    return;
  }
  try {
    if (genPromptsCache.relativeFolder === normalizeRelative(relativeFolder)) {
      genPromptsCache = null;
    }
  } catch {
    genPromptsCache = null;
  }
}

/**
 * Read + decode `!gen.txt` into the Generation cache (call on folder change).
 */
export function loadGenPrompts(relativeFolder: string): {
  relativeFolder: string;
  count: number;
} {
  const rel = normalizeRelative(relativeFolder);
  const prompts = listGenLines(rel);
  genPromptsCache = { relativeFolder: rel, prompts };
  return { relativeFolder: rel, count: prompts.length };
}

/**
 * Prompts for Generation: cached list if loaded for this folder, else load once.
 */
export function getLoadedGenPrompts(relativeFolder: string): string[] {
  const rel = normalizeRelative(relativeFolder);
  if (genPromptsCache?.relativeFolder === rel) {
    return genPromptsCache.prompts;
  }
  loadGenPrompts(rel);
  return genPromptsCache!.prompts;
}

const GEN_EXPAND_PATH = '__wcm_gen_line__.txt';

let generationIndex: { root: string; epoch: number; index: LibraryIndex } | null =
  null;

/** One library index per content epoch. Rebuilding it per image froze the UI. */
function indexForGeneration(): LibraryIndex {
  const root = libraryService.getRoot() ?? '';
  const epoch = libraryService.getContentEpoch();
  if (
    generationIndex &&
    generationIndex.root === root &&
    generationIndex.epoch === epoch
  ) {
    return generationIndex.index;
  }
  const files = libraryService.loadAllFiles();
  const afterRoot = libraryService.getRoot() ?? root;
  const afterEpoch = libraryService.getContentEpoch();
  const index = buildLibraryIndex(files);
  generationIndex = { root: afterRoot, epoch: afterEpoch, index };
  return index;
}

/** Build the generation index ahead of the first image. */
export function warmGenerationLibraryIndex(): void {
  if (!libraryService.getRoot()) return;
  indexForGeneration();
}

/** Shared index for generation and preview expansion. */
export function libraryIndexForExpand(): LibraryIndex {
  return indexForGeneration();
}

/**
 * Expand prompt templates against the active wildcards library.
 * Each entry is already one prompt. A line break inside an entry stays in
 * that prompt, so Single prompt is not split into a random line.
 */
export function expandPromptTemplates(
  lines: string[],
  options: {
    mode: 'random' | 'exhaustive';
    limit: number;
    seed?: number;
    countCombinations?: boolean;
  },
): ReturnType<typeof expandPrompts> {
  return expandPrompts({
    rootRelativePath: GEN_EXPAND_PATH,
    files: [],
    index: indexForGeneration(),
    mode: options.mode,
    limit: options.limit,
    seed: options.seed,
    countCombinations: options.countCombinations,
    templates: lines,
  });
}

/**
 * Expand one Dynamic Prompts line against the active wildcards library.
 */
export function expandGenLine(
  line: string,
  seed: number,
): { text: string; issues: string[] } {
  const trimmed = line.trim();
  if (!trimmed) return { text: '', issues: ['Empty prompt line'] };
  const result = expandPromptTemplates([trimmed], {
    mode: 'random',
    limit: 1,
    seed: seed >>> 0,
    countCombinations: false,
  });
  return {
    text: result.samples[0] ?? trimmed,
    issues: result.issues.map((issue) => issue.message),
  };
}

export function writeGeneratedImage(
  relativeFolder: string,
  fileName: string,
  bytes: Buffer,
): PromptSampleImageDto {
  const root = promptsRoot();
  const rel = normalizeRelative(relativeFolder);
  const dir = assertInsideRoot(root, path.join(root, rel));
  fs.mkdirSync(dir, { recursive: true });
  const reviewDir = assertInsideRoot(root, path.join(dir, REVIEW_SUBFOLDER));
  fs.mkdirSync(reviewDir, { recursive: true });
  const safeName = path.basename(fileName).replace(/[<>:"/\\|?*\u0000]/g, '_');
  if (!safeName.toLowerCase().endsWith('.png')) {
    throw new Error('Generated image must be a .png file');
  }
  const abs = assertInsideRoot(root, path.join(reviewDir, safeName));
  fs.writeFileSync(abs, bytes);
  const relativePath = `${rel}/${REVIEW_SUBFOLDER}/${safeName}`.replaceAll(
    '\\',
    '/',
  );
  return {
    fileName: safeName,
    relativePath,
    url: promptMediaUrl(relativePath),
  };
}
