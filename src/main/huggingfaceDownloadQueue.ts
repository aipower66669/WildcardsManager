import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { BrowserWindow } from 'electron';
import { hfDownloadQueueJsonPath } from '../domain/librarySidecarPaths.js';
import { IPC } from '../shared/contracts.js';
import {
  downloadHuggingFaceFile,
  type HfDownloadProgress,
  type HfDownloadType,
} from './huggingfaceDownload.js';
import { flushDeferredCheckpointIndexInvalidation } from './checkpointService.js';
import { flushDeferredLoraIndexInvalidation } from './loraService.js';
import {
  getActiveLibrary,
  getActiveLibraryId,
  loadSettings,
} from './settingsStore.js';
import { appendDownloadLog, formatErrorDetail } from './downloadLog.js';
import { rememberLoraDownloadCategory } from './loraDownloadCategoryService.js';
import { atomicWriteFile } from './librarySidecarIo.js';

export type HfQueueJobParams = {
  repoId: string;
  revision?: string;
  filePath: string;
  type: HfDownloadType;
  category?: string;
  loraCategoryId?: string;
  extraLoraCategoryIds?: string[];
  weights?: string;
  extraComment?: string;
  extraPrompt?: string;
  modelName?: string;
  fileName?: string;
};

type Job = {
  id: string;
  params: HfQueueJobParams;
};

type PersistedJob = HfQueueJobParams & { id: string };

type PersistedQueueFile = {
  version: 1;
  libraryId: string;
  jobs: PersistedJob[];
  paused?: boolean;
};

const STORE_VERSION = 1 as const;

let active: Job | null = null;
let pending: Job[] = [];
let paused = false;
let running = false;
let abortController: AbortController | null = null;

function toQueueItem(
  job: Job,
  status: 'active' | 'queued',
): {
  jobId: string;
  repoId: string;
  modelName: string;
  filePath: string;
  fileName: string;
  type: HfDownloadType;
  status: 'active' | 'queued';
  categoryLabel?: string;
} {
  return {
    jobId: job.id,
    repoId: job.params.repoId,
    modelName: job.params.modelName?.trim() || job.params.repoId,
    filePath: job.params.filePath,
    fileName:
      job.params.fileName?.trim() ||
      job.params.filePath.split('/').pop() ||
      job.params.filePath,
    type: job.params.type,
    status,
    categoryLabel:
      job.params.type === 'LORA'
        ? job.params.loraCategoryId
        : job.params.category,
  };
}

export type HfDownloadQueueSnapshot = {
  phase: 'active' | 'queued' | 'paused' | 'done';
  active: ReturnType<typeof toQueueItem> | null;
  queue: Array<ReturnType<typeof toQueueItem>>;
  queuedCount: number;
  activeRepoId: string | null;
  activeModelName: string | null;
  paused: boolean;
};

export function getHfDownloadQueueSnapshot(): HfDownloadQueueSnapshot {
  const phase: HfDownloadQueueSnapshot['phase'] = paused
    ? 'paused'
    : active
      ? 'active'
      : pending.length > 0
        ? 'queued'
        : 'done';
  return {
    phase,
    active: active ? toQueueItem(active, 'active') : null,
    queue: pending.map((j) => toQueueItem(j, 'queued')),
    queuedCount: pending.length,
    activeRepoId: active?.params.repoId ?? null,
    activeModelName: active
      ? active.params.modelName?.trim() || active.params.repoId
      : null,
    paused,
  };
}

function broadcastQueueSnapshot(): void {
  const snap = getHfDownloadQueueSnapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(IPC.huggingfaceDownloadQueueChanged, snap);
    } catch {
      // ignore
    }
  }
}

function queueStorePathForType(type: HfDownloadType): string | null {
  const lib = getActiveLibrary();
  const root = type === 'LORA' ? lib.loraFolder : lib.checkpointFolder;
  if (!root?.trim()) return null;
  return hfDownloadQueueJsonPath(root);
}

function persistQueueState(libraryId = getActiveLibraryId()): void {
  try {
    const jobs: PersistedJob[] = [];
    if (active) jobs.push({ id: active.id, ...active.params });
    for (const job of pending) jobs.push({ id: job.id, ...job.params });

    const byType: Record<HfDownloadType, PersistedJob[]> = {
      LORA: [],
      Checkpoint: [],
    };
    for (const job of jobs) byType[job.type].push(job);

    for (const type of ['LORA', 'Checkpoint'] as const) {
      const file = queueStorePathForType(type);
      if (!file) continue;
      const typeJobs = byType[type];
      if (typeJobs.length === 0) {
        try {
          if (fs.existsSync(file)) fs.unlinkSync(file);
        } catch {
          // ignore
        }
        continue;
      }
      const payload: PersistedQueueFile = {
        version: STORE_VERSION,
        libraryId,
        jobs: typeJobs,
        paused: paused || undefined,
      };
      atomicWriteFile(file, `${JSON.stringify(payload, null, 2)}\n`);
    }
  } catch {
    // Persistence must not break downloads.
  }
}

async function pump(): Promise<void> {
  if (running || paused) return;
  if (!active && pending.length === 0) {
    broadcastQueueSnapshot();
    return;
  }
  if (!active) {
    active = pending.shift() ?? null;
    if (!active) {
      broadcastQueueSnapshot();
      return;
    }
    persistQueueState();
    broadcastQueueSnapshot();
  }

  const job = active;
  running = true;
  abortController = new AbortController();
  try {
    await downloadHuggingFaceFile({
      ...job.params,
      jobId: job.id,
      signal: abortController.signal,
      deferIndexInvalidation: pending.length > 0,
      onProgress: (p: HfDownloadProgress) => {
        const snap = getHfDownloadQueueSnapshot();
        for (const win of BrowserWindow.getAllWindows()) {
          try {
            if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
            win.webContents.send(IPC.huggingfaceDownloadProgress, {
              ...p,
              phase: paused ? 'paused' : p.phase,
              queuedCount: snap.queuedCount,
              activeRepoId: snap.activeRepoId,
              activeModelName: snap.activeModelName,
            });
          } catch {
            // ignore
          }
        }
      },
    });
  } catch (e) {
    const msg = formatErrorDetail(e);
    if (!/cancelled/i.test(msg)) {
      appendDownloadLog('error', `HF queue job failed: ${msg}`, {
        source: 'hf-queue',
        modelName: job.params.modelName ?? job.params.repoId,
      });
    }
  } finally {
    if (active?.id === job.id) active = null;
    abortController = null;
    running = false;
    persistQueueState();
    broadcastQueueSnapshot();
    if (pending.length === 0 && !active) {
      flushDeferredLoraIndexInvalidation();
      flushDeferredCheckpointIndexInvalidation();
    }
    void pump();
  }
}

export function enqueueHfDownload(params: HfQueueJobParams): HfDownloadQueueSnapshot {
  if (params.type === 'LORA' && params.loraCategoryId) {
    rememberLoraDownloadCategory(params.loraCategoryId);
  }
  const job: Job = { id: randomUUID(), params: { ...params } };
  pending.push(job);
  persistQueueState();
  broadcastQueueSnapshot();
  void pump();
  return getHfDownloadQueueSnapshot();
}

export function listHfDownloadQueue(): HfDownloadQueueSnapshot {
  return getHfDownloadQueueSnapshot();
}

export function cancelHfDownloadJob(jobId: string): HfDownloadQueueSnapshot {
  if (active?.id === jobId) {
    abortController?.abort();
  } else {
    pending = pending.filter((j) => j.id !== jobId);
    persistQueueState();
    broadcastQueueSnapshot();
  }
  return getHfDownloadQueueSnapshot();
}

export function pauseHfDownloadQueue(): HfDownloadQueueSnapshot {
  paused = true;
  abortController?.abort();
  persistQueueState();
  broadcastQueueSnapshot();
  return getHfDownloadQueueSnapshot();
}

export function resumeHfDownloadQueue(): HfDownloadQueueSnapshot {
  paused = false;
  persistQueueState();
  broadcastQueueSnapshot();
  void pump();
  return getHfDownloadQueueSnapshot();
}

export function hasPendingHfDownloads(): boolean {
  return Boolean(active || pending.length > 0);
}

/** Load persisted jobs for the active library (call after library switch). */
export function restoreHfDownloadQueue(): void {
  const libraryId = getActiveLibraryId();
  const jobs: Job[] = [];
  let pausedFlag = false;
  for (const type of ['LORA', 'Checkpoint'] as const) {
    const file = queueStorePathForType(type);
    if (!file || !fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as PersistedQueueFile;
      if (raw?.version !== STORE_VERSION || !Array.isArray(raw.jobs)) continue;
      if (raw.libraryId && raw.libraryId !== libraryId) continue;
      if (raw.paused) pausedFlag = true;
      for (const row of raw.jobs) {
        if (!row?.id || !row.repoId || !row.filePath) continue;
        jobs.push({
          id: row.id,
          params: {
            repoId: row.repoId,
            revision: row.revision,
            filePath: row.filePath,
            type: row.type === 'Checkpoint' ? 'Checkpoint' : 'LORA',
            category: row.category,
            loraCategoryId: row.loraCategoryId,
            extraLoraCategoryIds: row.extraLoraCategoryIds,
            weights: row.weights,
            extraComment: row.extraComment,
            extraPrompt: row.extraPrompt,
            modelName: row.modelName,
            fileName: row.fileName,
          },
        });
      }
    } catch {
      // ignore corrupt
    }
  }
  pending = jobs;
  active = null;
  paused = pausedFlag;
  broadcastQueueSnapshot();
  if (!paused && pending.length > 0) void pump();
}

// Touch loadSettings so folder resolution stays consistent with active lib.
void loadSettings;
