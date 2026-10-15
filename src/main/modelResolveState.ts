/**
 * Per-library snapshot: folder file count is fully hashed and catalog-resolved.
 * Lets restart skip AutoV2 ADS scans and 50k-file populate walks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getCatalogCacheRootDir } from './civitaiCatalogCache.js';

export type ModelResolveKind = 'LORA' | 'Checkpoint';

type KindState = {
  fileCount: number;
  hashed: boolean;
  resolved: boolean;
};

type DiskState = {
  version: 1;
  LORA: KindState;
  Checkpoint: KindState;
};

const FILE_NAME = 'model-resolve-state.json';

function emptyKind(): KindState {
  return { fileCount: 0, hashed: false, resolved: false };
}

function emptyState(): DiskState {
  return { version: 1, LORA: emptyKind(), Checkpoint: emptyKind() };
}

function storePath(): string {
  return path.join(getCatalogCacheRootDir(), FILE_NAME);
}

function readState(): DiskState {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as DiskState;
    if (raw?.version !== 1) return emptyState();
    return {
      version: 1,
      LORA: {
        fileCount: Number(raw.LORA?.fileCount) || 0,
        hashed: raw.LORA?.hashed === true,
        resolved: raw.LORA?.resolved === true,
      },
      Checkpoint: {
        fileCount: Number(raw.Checkpoint?.fileCount) || 0,
        hashed: raw.Checkpoint?.hashed === true,
        resolved: raw.Checkpoint?.resolved === true,
      },
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: DiskState): void {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state)}\n`, 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.renameSync(temp, file);
  }
}

/** True when this folder snapshot was fully hashed + matched last time. */
export function isModelResolveSettled(
  kind: ModelResolveKind,
  fileCount: number,
): boolean {
  if (fileCount < 0) return false;
  const row = readState()[kind];
  return (
    row.hashed &&
    row.resolved &&
    row.fileCount === fileCount
  );
}

export function markModelFolderHashed(
  kind: ModelResolveKind,
  fileCount: number,
): void {
  const state = readState();
  state[kind] = {
    ...state[kind],
    fileCount,
    hashed: true,
  };
  writeState(state);
}

export function markModelFolderResolved(
  kind: ModelResolveKind,
  fileCount: number,
): void {
  const state = readState();
  state[kind] = {
    fileCount,
    hashed: true,
    resolved: true,
  };
  writeState(state);
}

/** One new on-disk file that was rematched at download time. */
export function noteResolvedFileIngested(kind: ModelResolveKind): void {
  const state = readState();
  const row = state[kind];
  if (!row.hashed || !row.resolved) return;
  row.fileCount += 1;
  writeState(state);
}
