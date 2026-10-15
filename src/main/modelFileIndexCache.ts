/**
 * Last-known weight file list under a LoRA/checkpoint root.
 * Lives in `!.wcm/file-index.json` so a restart does not walk the tree.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  addLoraFile,
  type LoraFileEntry,
  type LoraIndex,
} from '../domain/lora.js';
import { modelFileIndexPath } from '../domain/librarySidecarPaths.js';

const STORE_VERSION = 1 as const;

export type ModelFileIndexRow = {
  /** Root-relative posix path. */
  r: string;
  /** AutoV2 when last known. */
  h?: string;
};

export type ModelFileIndexStore = {
  version: typeof STORE_VERSION;
  root: string;
  savedAt: number;
  files: ModelFileIndexRow[];
};

function emptyIndex(root: string): LoraIndex {
  return {
    root: path.resolve(root),
    aliases: new Map(),
    files: [],
    fileCount: 0,
  };
}

export function loadModelFileIndex(modelRoot: string): ModelFileIndexStore | null {
  const resolved = path.resolve(modelRoot);
  try {
    const raw = JSON.parse(
      fs.readFileSync(modelFileIndexPath(resolved), 'utf8'),
    ) as ModelFileIndexStore;
    if (raw?.version !== STORE_VERSION || !Array.isArray(raw.files)) {
      return null;
    }
    if (path.resolve(raw.root).toLowerCase() !== resolved.toLowerCase()) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function saveModelFileIndex(
  modelRoot: string,
  files: ModelFileIndexRow[],
): void {
  const resolved = path.resolve(modelRoot);
  const file = modelFileIndexPath(resolved);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const store: ModelFileIndexStore = {
    version: STORE_VERSION,
    root: resolved,
    savedAt: Date.now(),
    files,
  };
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(store)}\n`, 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch {
    try {
      fs.writeFileSync(file, `${JSON.stringify(store)}\n`, 'utf8');
      fs.unlinkSync(temp);
    } catch {
      // ignore
    }
  }
}

export function snapshotFromIndex(index: LoraIndex): ModelFileIndexRow[] {
  return index.files.map((file) => {
    const row: ModelFileIndexRow = {
      r: file.relativePath.replace(/\\/g, '/'),
    };
    if (file.autoV2) row.h = file.autoV2;
    return row;
  });
}

export function persistModelIndex(index: LoraIndex): void {
  try {
    saveModelFileIndex(index.root, snapshotFromIndex(index));
  } catch {
    // ignore — next walk retries
  }
}

export function hydrateModelIndex(modelRoot: string): LoraIndex | null {
  const store = loadModelFileIndex(modelRoot);
  if (!store) return null;
  const index = emptyIndex(modelRoot);
  const byAutoV2 = new Map<string, string>();
  for (const row of store.files) {
    const rel = row?.r?.replace(/\\/g, '/').trim();
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const abs = path.join(index.root, ...rel.split('/'));
    addLoraFile(index, rel, abs);
    if (row.h) {
      const file = index.files[index.files.length - 1]!;
      file.autoV2 = row.h;
      if (!byAutoV2.has(row.h)) byAutoV2.set(row.h, abs);
    }
  }
  if (byAutoV2.size > 0) index.byAutoV2 = byAutoV2;
  return index;
}

export function modelIndexFingerprint(files: LoraFileEntry[]): string {
  return files
    .map((file) => file.relativePath.replace(/\\/g, '/').toLowerCase())
    .sort()
    .join('\n');
}

export function modelIndexFilesEqual(a: LoraIndex, b: LoraIndex): boolean {
  if (a.fileCount !== b.fileCount) return false;
  return modelIndexFingerprint(a.files) === modelIndexFingerprint(b.files);
}
