import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { hashMissesPath } from '../domain/librarySidecarPaths.js';
import { normalizeAutoV2 } from '../domain/modelHash.js';
import { getActiveLibrary } from './settingsStore.js';

/**
 * Persistent set of AutoV2 hashes that returned a permanent miss from Civitai
 * by-hash (404/410/403). Populate skips these forever so unmatched locals are
 * not re-queried every rematch.
 */

type MissFile = {
  version: 1;
  /** Uppercase AutoV2 → ISO checked-at. */
  hashes: Record<string, string>;
};

const STORE_VERSION = 1 as const;

let rootOverride: string | null = null;
let memory: MissFile | null = null;
let dirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Test helper — write under an isolated directory. */
export function configureModelHashMissCacheRoot(dir: string | null): void {
  flushModelHashMissCacheSync();
  rootOverride = dir;
  memory = null;
  dirty = false;
}

function storePath(): string {
  if (rootOverride) return path.join(rootOverride, 'model-hash-misses.json');
  const wildcards = getActiveLibrary().wildcardsRoot;
  if (wildcards?.trim()) {
    return hashMissesPath(wildcards);
  }
  return path.join(app.getPath('userData'), 'model-hash-misses-unbound.json');
}

function emptyStore(): MissFile {
  return { version: STORE_VERSION, hashes: {} };
}

function loadStore(): MissFile {
  if (memory) return memory;
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as MissFile;
    if (raw?.version !== STORE_VERSION || typeof raw.hashes !== 'object') {
      memory = emptyStore();
      return memory;
    }
    memory = { version: STORE_VERSION, hashes: { ...raw.hashes } };
    return memory;
  } catch {
    memory = emptyStore();
    return memory;
  }
}

function scheduleSave(): void {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushModelHashMissCacheSync();
  }, 400);
}

export function flushModelHashMissCacheSync(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!dirty || !memory) return;
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(memory)}\n`, 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.renameSync(temp, file);
  }
  dirty = false;
}

export function isKnownModelHashMiss(autoV2: string): boolean {
  const key = normalizeAutoV2(autoV2);
  if (!key) return false;
  return Boolean(loadStore().hashes[key]);
}

/** Record a permanent by-hash miss (404/410/403). */
export function rememberModelHashMiss(autoV2: string): void {
  const key = normalizeAutoV2(autoV2);
  if (!key) return;
  const store = loadStore();
  if (store.hashes[key]) return;
  store.hashes[key] = new Date().toISOString();
  scheduleSave();
}

/** Allow a manual Rematch to retry a previously failed hash. */
export function clearModelHashMiss(autoV2: string): void {
  const key = normalizeAutoV2(autoV2);
  if (!key) return;
  const store = loadStore();
  if (!store.hashes[key]) return;
  delete store.hashes[key];
  scheduleSave();
}

export function isPermanentCivitaiHashMiss(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /\(\s*(404|410|403)\s*\)/.test(msg);
}
