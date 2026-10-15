import { BrowserWindow } from 'electron';
import { pickCivitaiAutoV2 } from '../domain/modelHash.js';
import type { CivitaiCatalogAutoV2BackfillProgressDto } from '../shared/contracts.js';
import { IPC } from '../shared/contracts.js';
import {
  getCivitaiModel,
  getCivitaiModelVersion,
  pickPrimaryFile,
} from './civitaiClient.js';
import {
  listCachedModelsMissingAutoV2,
  patchCachedModel,
  flushDirtyModelPagesSync,
} from './civitaiCatalogCache.js';
import { getCivitaiOrigin } from './settingsStore.js';

let active: { cancelled: boolean } | null = null;
let ranThisSession = false;

function emit(progress: CivitaiCatalogAutoV2BackfillProgressDto): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(IPC.civitaiCatalogAutoV2BackfillProgress, progress);
    } catch {
      // ignore
    }
  }
}

function isPermanentCivitaiMiss(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  // Deleted / forbidden / gone — no point retrying every launch.
  return /\(\s*(404|410|403)\s*\)/.test(msg);
}

/**
 * Fill missing AutoV2 on cached catalog models via Civitai API only.
 * Does not touch preview cache / image downloads.
 */
export function startCatalogAutoV2Backfill(opts?: {
  force?: boolean;
  types?: string[];
}): void {
  if (active) return;
  if (ranThisSession && !opts?.force) return;

  const origin = getCivitaiOrigin();
  const missing = listCachedModelsMissingAutoV2(origin, {
    types: opts?.types ?? ['LORA', 'Checkpoint'],
  });
  if (missing.length === 0) {
    ranThisSession = true;
    return;
  }

  const sync = { cancelled: false };
  active = sync;
  ranThisSession = true;

  const total = missing.length;
  let done = 0;
  let patched = 0;
  let failed = 0;

  void (async () => {
    for (const entry of missing) {
      if (sync.cancelled) break;
      try {
        let autoV2: string | null = null;
        let fileName: string | undefined;

        if (entry.versionId) {
          try {
            const version = await getCivitaiModelVersion(entry.versionId);
            const file = pickPrimaryFile(version);
            autoV2 = pickCivitaiAutoV2(file?.hashes);
            fileName = file?.name;
          } catch (e) {
            if (!isPermanentCivitaiMiss(e)) {
              // Transient version error — still try model detail.
            }
            // Permanent version miss — still try model detail once.
          }
        }

        if (!autoV2) {
          try {
            const model = await getCivitaiModel(entry.id);
            const version = model.modelVersions?.[0];
            const file = pickPrimaryFile(version);
            autoV2 = pickCivitaiAutoV2(file?.hashes);
            fileName = file?.name ?? fileName;
          } catch (e) {
            if (isPermanentCivitaiMiss(e)) {
              patchCachedModel(origin, entry.id, {
                autoV2CheckedAt: new Date().toISOString(),
              });
              failed += 1;
              done += 1;
              if (done === 1 || done === total || done % 10 === 0) {
                emit({
                  status: 'backfilling',
                  done,
                  total,
                  patchedThisRun: patched,
                  failedThisRun: failed,
                });
              }
              continue;
            }
            throw e;
          }
        }

        if (autoV2) {
          patchCachedModel(origin, entry.id, {
            autoV2,
            autoV2Hashes: [autoV2],
            ...(fileName ? { fileName } : {}),
          });
          patched += 1;
        } else {
          // API returned a file payload with no AutoV2/SHA256.
          patchCachedModel(origin, entry.id, {
            autoV2CheckedAt: new Date().toISOString(),
          });
          failed += 1;
        }
      } catch (e) {
        if (isPermanentCivitaiMiss(e)) {
          patchCachedModel(origin, entry.id, {
            autoV2CheckedAt: new Date().toISOString(),
          });
        }
        // Transient errors (429/5xx/network) stay unchecked for a later session.
        failed += 1;
      }

      done += 1;
      // Skip the initial 0/N flash — same pattern as local hash warm.
      if (done === 1 || done === total || done % 10 === 0) {
        emit({
          status: 'backfilling',
          done,
          total,
          patchedThisRun: patched,
          failedThisRun: failed,
        });
      }
    }

    active = null;
    flushDirtyModelPagesSync();
    emit({
      status: sync.cancelled ? 'cancelled' : 'done',
      done,
      total,
      patchedThisRun: patched,
      failedThisRun: failed,
    });
  })().catch((e) => {
    active = null;
    flushDirtyModelPagesSync();
    emit({
      status: 'error',
      done,
      total,
      patchedThisRun: patched,
      failedThisRun: failed,
      error: e instanceof Error ? e.message : String(e),
    });
  });
}

export function cancelCatalogAutoV2Backfill(): void {
  if (active) active.cancelled = true;
}
