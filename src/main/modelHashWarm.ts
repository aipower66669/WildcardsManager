import { BrowserWindow } from 'electron';
import type { LoraIndex } from '../domain/lora.js';
import type { CivitaiHashWarmProgressDto } from '../shared/contracts.js';
import { IPC } from '../shared/contracts.js';
import {
  attachCachedAutoV2Hashes,
  countCachedHashEntries,
  indexFullyHashCached,
  warmIndexAutoV2Hashes,
} from './modelHashCache.js';
import {
  rematchLocalModelByHash,
  startModelCatalogPopulate,
} from './modelCatalogPopulate.js';
import { getAutoV2CatalogIndex } from './civitaiCatalogCache.js';
import {
  isModelResolveSettled,
  markModelFolderHashed,
} from './modelResolveState.js';
import { persistModelIndex } from './modelFileIndexCache.js';

type WarmKind = 'LORA' | 'Checkpoint';

let active: {
  kind: WarmKind;
  cancelled: boolean;
  abort: AbortController;
} | null = null;
/**
 * Only set when every file in that folder snapshot has a hash-cache entry.
 * Incomplete runs must NOT set this — otherwise missing multi‑GB checkpoints
 * never get retried.
 */
const fullyWarmedThisSession = new Map<WarmKind, number>();

function preloadAutoV2CatalogIndex(): void {
  setImmediate(() => {
    try {
      getAutoV2CatalogIndex();
    } catch {
      // Catalog may be missing on first launch.
    }
  });
}

function emit(progress: CivitaiHashWarmProgressDto): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(IPC.civitaiHashWarmProgress, progress);
    } catch {
      // Renderer disposed mid-hash — ignore.
    }
  }
}

/**
 * Background-hash local model files missing AUTOV2 ADS.
 * Attaches `index.byAutoV2`, then re-runs catalog matching.
 * SHA-256 runs on a worker thread; results are written to the file's ADS.
 */
export function startModelHashWarm(
  kind: WarmKind,
  getIndex: () => LoraIndex | null,
): void {
  if (active?.kind === kind) return;

  const index = getIndex();
  if (!index || index.files.length === 0) {
    fullyWarmedThisSession.set(kind, 0);
    return;
  }

  const fileCount = index.files.length;
  if (isModelResolveSettled(kind, fileCount)) {
    fullyWarmedThisSession.set(kind, fileCount);
    attachCachedAutoV2Hashes(index);
    preloadAutoV2CatalogIndex();
    return;
  }
  if (
    fullyWarmedThisSession.get(kind) === fileCount &&
    indexFullyHashCached(index)
  ) {
    preloadAutoV2CatalogIndex();
    startModelCatalogPopulate(kind);
    return;
  }

  // Everything already in the persistent cache — attach, rematch only unknowns.
  if (indexFullyHashCached(index)) {
    attachCachedAutoV2Hashes(index);
    persistModelIndex(index);
    fullyWarmedThisSession.set(kind, fileCount);
    markModelFolderHashed(kind, fileCount);
    preloadAutoV2CatalogIndex();
    startModelCatalogPopulate(kind);
    return;
  }

  if (active) {
    active.cancelled = true;
    active.abort.abort();
  }

  const sync = {
    kind,
    cancelled: false,
    abort: new AbortController(),
  };
  active = sync;

  const total = fileCount;
  preloadAutoV2CatalogIndex();

  // Immediate UI so populate’s “awaiting hash” isn’t the only status.
  emit({
    kind,
    status: 'hashing',
    done: 0,
    total,
    hashedThisRun: 0,
    cachedTotal: countCachedHashEntries(),
    missing: total,
  });

  void warmIndexAutoV2Hashes(index, {
    shouldCancel: () => sync.cancelled,
    signal: sync.abort.signal,
    onProgress: (progress) => {
      if (sync.cancelled) return;
      emit({
        kind,
        status: 'hashing',
        done: progress.done,
        total: progress.total,
        hashedThisRun: progress.hashedThisRun,
        cachedTotal: progress.cachedTotal,
        missing: progress.missing,
        currentStem: progress.currentStem,
      });
    },
  })
    .then((result) => {
      if (active === sync) active = null;
      attachCachedAutoV2Hashes(index);
      persistModelIndex(index);
      const fully = indexFullyHashCached(index);
      if (!sync.cancelled && fully) {
        fullyWarmedThisSession.set(kind, fileCount);
        markModelFolderHashed(kind, fileCount);
      } else {
        // Leave unset so the next list/tab open retries the remaining files.
        fullyWarmedThisSession.delete(kind);
      }
      if (!sync.cancelled) {
        // A download should hash that one new file, not rematch the library.
        if (result.hashedThisRun > 0 && result.hashedThisRun <= 4) {
          for (const autoV2 of result.hashedAutoV2s) {
            void rematchLocalModelByHash({ autoV2, kind });
          }
        } else if (result.hashedThisRun > 0) {
          startModelCatalogPopulate(kind, { force: true });
        }
      }
      if (!sync.cancelled) {
        emit({
          kind,
          status: 'done',
          done: result.done,
          total: result.total,
          hashedThisRun: result.hashedThisRun,
          cachedTotal: result.cachedTotal,
          missing: result.missing,
        });
        if (result.missing > 0 || result.failedThisRun > 0) {
          console.warn(
            `[hash] ${kind} warm incomplete: missing=${result.missing} failed=${result.failedThisRun} hashed=${result.hashedThisRun}`,
          );
        }
      }
    })
    .catch((e) => {
      if (active === sync) active = null;
      fullyWarmedThisSession.delete(kind);
      emit({
        kind,
        status: 'error',
        done: 0,
        total,
        hashedThisRun: 0,
        cachedTotal: countCachedHashEntries(),
        error: e instanceof Error ? e.message : String(e),
      });
    });
}

export function cancelModelHashWarm(): void {
  if (!active) return;
  active.cancelled = true;
  active.abort.abort();
}

/** Allow a fresh warm after folder changes (tests / settings). */
export function resetModelHashWarmState(): void {
  if (active) {
    active.cancelled = true;
    active.abort.abort();
  }
  active = null;
  fullyWarmedThisSession.clear();
}
