import { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { downloadQueueJsonPath } from '../domain/librarySidecarPaths.js';
import { IPC, type CivitaiModelTypeDto } from '../shared/contracts.js';
import {
  checkCivitaiDownloadDestination,
  downloadCivitaiModel,
  setDownloadProgressEnricher,
  type CivitaiDownloadProgress,
  type CivitaiDownloadResult,
} from './civitaiDownload.js';
import { rememberDownloadCategory } from './civitaiCategoryService.js';
import {
  getLoraDownloadCategoryById,
  rememberLoraDownloadCategory,
} from './loraDownloadCategoryService.js';
import { uniqueExtraLoraCategoryIds } from '../domain/loraDownloadCategory.js';
import { flushDeferredCheckpointIndexInvalidation } from './checkpointService.js';
import { flushDeferredLoraIndexInvalidation } from './loraService.js';
import { getActiveLibrary, getActiveLibraryId } from './settingsStore.js';
import {
  appendDownloadLog,
  formatErrorDetail,
  logDownloadError,
} from './downloadLog.js';
import { atomicWriteFile } from './librarySidecarIo.js';

type CivitaiModelType = 'LORA' | 'Checkpoint';

export type ModelDownloadParams = {
  modelId: number;
  versionId?: number;
  fileId?: number;
  type: CivitaiModelType;
  category?: string;
  loraCategoryId?: string;
  /** Extra LoRA categories — wildcard append only. */
  extraLoraCategoryIds?: string[];
  weights?: string;
  /** Optional `#` comment line(s) between URL and `<lora:…>`. */
  extraComment?: string;
  /** Optional prompt text after triggers on the `<lora:…>` line. */
  extraPrompt?: string;
  /** Display name for queue / status UI. */
  modelName?: string;
  /** Override on-disk file name (basename with extension). */
  fileName?: string;
};

export type ModelDownloadQueueItem = {
  jobId: string;
  modelId: number;
  modelName: string;
  type: CivitaiModelTypeDto;
  versionId?: number;
  fileId?: number;
  fileName?: string;
  status: 'active' | 'queued';
  /** Human label: LoRA category name, `<Multiple>`, or checkpoint folder. */
  categoryLabel: string;
  loraCategoryId?: string;
  extraLoraCategoryIds?: string[];
  category?: string;
  weights?: string;
  extraComment?: string;
  extraPrompt?: string;
};

export type ModelDownloadQueueSnapshot = {
  phase: 'queued' | 'active' | 'paused' | 'done';
  active: ModelDownloadQueueItem | null;
  queue: ModelDownloadQueueItem[];
  queuedCount: number;
  activeModelId: number | null;
  activeModelName: string | null;
  paused: boolean;
  pauseReason: string | null;
};

type Job = {
  id: string;
  params: ModelDownloadParams;
  resolve: (result: CivitaiDownloadResult) => void;
  reject: (error: unknown) => void;
  /** Set when the user cancels the active transfer (abort may lag). */
  cancelRequested?: boolean;
};

type PersistedJob = {
  id: string;
  modelId: number;
  versionId?: number;
  fileId?: number;
  type: CivitaiModelType;
  category?: string;
  loraCategoryId?: string;
  extraLoraCategoryIds?: string[];
  weights?: string;
  extraComment?: string;
  extraPrompt?: string;
  modelName?: string;
  fileName?: string;
};

type PersistedQueueFile = {
  version: 1;
  libraryId: string;
  /** Active job first (if any), then pending FIFO. */
  jobs: PersistedJob[];
  /** Network failure parked the queue; resume manually or via auto-retry. */
  paused?: boolean;
  pauseReason?: string;
};

const STORE_VERSION = 1 as const;

const pending: Job[] = [];
let active: Job | null = null;
let activeAbort: AbortController | null = null;
let draining = false;
let restoreAttempted = false;
/** Skip disk writes while tearing down for a library switch. */
let suppressPersist = false;
/** Parked after a transient/network failure — jobs stay on disk. */
let paused = false;
let pauseReason: string | null = null;
let autoResumeTimer: ReturnType<typeof setTimeout> | null = null;

/** Quiet auto-wake while paused (manual Resume is immediate). */
const AUTO_RESUME_INTERVAL_MS = 60_000;

function clearAutoResumeTimer(): void {
  if (autoResumeTimer) {
    clearTimeout(autoResumeTimer);
    autoResumeTimer = null;
  }
}

function scheduleAutoResume(): void {
  clearAutoResumeTimer();
  if (!paused || suppressPersist) return;
  if (pending.length === 0 && !active) return;
  autoResumeTimer = setTimeout(() => {
    autoResumeTimer = null;
    if (!paused || suppressPersist) return;
    if (pending.length === 0 && !active) return;
    resumeModelDownloadQueue({ auto: true });
  }, AUTO_RESUME_INTERVAL_MS);
}

function pauseQueueForConnection(message: string): void {
  paused = true;
  pauseReason = message;
  persistQueueState();
  scheduleAutoResume();
}

/**
 * User/tray pause — stops starting new jobs after the active transfer finishes.
 * Does not schedule auto-resume (unlike connection pause).
 */
export function pauseModelDownloadQueue(
  reason = 'Paused',
): ModelDownloadQueueSnapshot {
  paused = true;
  pauseReason = reason.trim() || 'Paused';
  clearAutoResumeTimer();
  persistQueueState();
  appendDownloadLog('warn', `Queue paused: ${pauseReason}`, { source: 'queue' });
  const head = active ?? pending[0];
  if (head) {
    broadcastQueueSnapshot(
      head.params.modelId,
      head.params.type,
      'paused',
      { error: pauseReason },
    );
  }
  return getModelDownloadQueueSnapshot();
}

/** True when there is an active or queued download job. */
export function hasPendingModelDownloads(): boolean {
  return Boolean(active) || pending.length > 0;
}

/** True when another job is waiting behind the active download. */
export function hasQueuedModelDownloads(): boolean {
  return pending.length > 0;
}

/** True when the user (or library switch) aborted the transfer. */
export function isUserCancelledDownloadError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error && error.name === 'AbortError') return true;
  // undici often wraps AbortError as `fetch failed` + cause.
  if (error instanceof Error && error.cause instanceof Error) {
    if (error.cause.name === 'AbortError') return true;
    const cause = error.cause.message.toLowerCase();
    if (
      cause.includes('abort') ||
      cause.includes('the operation was aborted')
    ) {
      return true;
    }
  }
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg === 'download cancelled' ||
    msg.includes('download cancelled') ||
    msg.includes('the operation was aborted') ||
    msg.includes('this operation was aborted') ||
    msg.includes('requester aborted') ||
    (msg.includes('abort') && !msg.includes('aborted by peer'))
  );
}

/**
 * Transient failures (offline, DNS, 5xx, rate limit) must keep the job in the
 * persisted queue and retry — never flush the rest of the queue.
 */
export function isRetryableDownloadError(error: unknown): boolean {
  if (isUserCancelledDownloadError(error)) return false;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (
    /fetch failed|network|econnreset|econnrefused|enotfound|etimedout|esockettimedout|eai_again|socket|offline|unable to connect|networkerror|err_network|err_internet_disconnected|err_name_not_resolved|getaddrinfo|ssl|tls|und_err|cert|handshake|temporarily unavailable|connection reset|connection refused|broken pipe|terminated|other side closed|und_err_socket/.test(
      msg,
    )
  ) {
    return true;
  }
  // Status embedded in our download / API error messages.
  if (/\b(408|429|500|502|503|504)\b/.test(msg)) return true;
  if (/download failed \(0\)/.test(msg)) return true;
  // Node undici often wraps the real code on `error.cause`.
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : error instanceof Error && error.cause
        ? String(error.cause)
        : '';
  if (cause && isRetryableDownloadError(new Error(cause))) return true;
  return false;
}

function queueStorePathForType(type: CivitaiModelType): string | null {
  const lib = getActiveLibrary();
  const root =
    type === 'LORA' ? lib.loraFolder : lib.checkpointFolder;
  if (!root?.trim()) return null;
  return downloadQueueJsonPath(root);
}

function atomicWrite(file: string, data: string): void {
  atomicWriteFile(file, data);
}

function jobToPersisted(job: Job): PersistedJob {
  return {
    id: job.id,
    modelId: job.params.modelId,
    versionId: job.params.versionId,
    fileId: job.params.fileId,
    type: job.params.type,
    category: job.params.category,
    loraCategoryId: job.params.loraCategoryId,
    extraLoraCategoryIds: job.params.extraLoraCategoryIds,
    weights: job.params.weights,
    extraComment: job.params.extraComment,
    extraPrompt: job.params.extraPrompt,
    modelName: job.params.modelName,
    fileName: job.params.fileName,
  };
}

/** Cheap header for progress ticks — does not map every queued job. */
function queueProgressHeader(): Pick<
  ModelDownloadQueueSnapshot,
  | 'phase'
  | 'queuedCount'
  | 'activeModelId'
  | 'activeModelName'
  | 'paused'
  | 'pauseReason'
> {
  const phase: ModelDownloadQueueSnapshot['phase'] = paused
    ? 'paused'
    : active
      ? 'active'
      : pending.length > 0
        ? 'queued'
        : 'done';
  return {
    phase,
    queuedCount: pending.length,
    activeModelId: active?.params.modelId ?? null,
    activeModelName: active
      ? active.params.modelName?.trim() || `Model ${active.params.modelId}`
      : null,
    paused,
    pauseReason,
  };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistLibraryId: string | undefined;

function persistQueueState(libraryId = getActiveLibraryId()): void {
  persistLibraryId = libraryId;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const id = persistLibraryId ?? getActiveLibraryId();
    persistLibraryId = undefined;
    writeQueueState(id);
  }, 0);
}

function writeQueueState(libraryId = getActiveLibraryId()): void {
  if (suppressPersist) return;
  try {
    const jobs: PersistedJob[] = [];
    if (active) jobs.push(jobToPersisted(active));
    for (const job of pending) jobs.push(jobToPersisted(job));

    const byType: Record<CivitaiModelType, PersistedJob[]> = {
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
        pauseReason: paused && pauseReason ? pauseReason : undefined,
      };
      atomicWrite(file, `${JSON.stringify(payload, null, 2)}\n`);
    }

    if (jobs.length === 0) {
      paused = false;
      pauseReason = null;
      clearAutoResumeTimer();
    }
  } catch {
    // Persistence must not break downloads.
  }
}

function loadPersistedQueue(libraryId: string): PersistedQueueFile | null {
  try {
    const jobs: PersistedJob[] = [];
    let pausedFlag = false;
    let pauseReasonVal: string | undefined;
    for (const type of ['LORA', 'Checkpoint'] as const) {
      const file = queueStorePathForType(type);
      if (!file || !fs.existsSync(file)) continue;
      const raw = JSON.parse(
        fs.readFileSync(file, 'utf8'),
      ) as PersistedQueueFile;
      if (raw?.version !== STORE_VERSION || !Array.isArray(raw.jobs)) continue;
      if (raw.paused) pausedFlag = true;
      if (typeof raw.pauseReason === 'string') pauseReasonVal = raw.pauseReason;
      for (const job of raw.jobs) {
        if (
          !!job &&
          typeof job.id === 'string' &&
          typeof job.modelId === 'number' &&
          Number.isFinite(job.modelId) &&
          (job.type === 'LORA' || job.type === 'Checkpoint')
        ) {
          jobs.push(job);
        }
      }
    }
    if (jobs.length === 0 && !pausedFlag) return null;
    return {
      version: STORE_VERSION,
      libraryId,
      jobs,
      paused: pausedFlag,
      pauseReason: pauseReasonVal,
    };
  } catch {
    return null;
  }
}

function categoryLabelFor(params: ModelDownloadParams): string {
  if (params.type === 'LORA' && params.loraCategoryId) {
    const extras = uniqueExtraLoraCategoryIds(
      params.loraCategoryId,
      params.extraLoraCategoryIds,
    );
    if (extras.length > 0) return '<Multiple>';
    const cat = getLoraDownloadCategoryById(params.loraCategoryId);
    if (cat) return cat.name;
  }
  const folder = (params.category ?? '').trim();
  return folder || '(root)';
}

function toQueueItem(
  job: Job,
  status: 'active' | 'queued',
): ModelDownloadQueueItem {
  const extras = uniqueExtraLoraCategoryIds(
    job.params.loraCategoryId,
    job.params.extraLoraCategoryIds,
  );
  return {
    jobId: job.id,
    modelId: job.params.modelId,
    modelName: job.params.modelName?.trim() || `Model ${job.params.modelId}`,
    type: job.params.type,
    versionId: job.params.versionId,
    fileId: job.params.fileId,
    fileName: job.params.fileName,
    status,
    categoryLabel: categoryLabelFor(job.params),
    loraCategoryId: job.params.loraCategoryId,
    extraLoraCategoryIds: extras.length > 0 ? extras : undefined,
    category: job.params.category,
    weights: job.params.weights,
    extraComment: job.params.extraComment,
    extraPrompt: job.params.extraPrompt,
  };
}

function queueItems(): ModelDownloadQueueItem[] {
  return pending.map((job) => toQueueItem(job, 'queued'));
}

export function getModelDownloadQueueSnapshot(): ModelDownloadQueueSnapshot {
  const phase: ModelDownloadQueueSnapshot['phase'] = paused
    ? 'paused'
    : active
      ? 'active'
      : pending.length > 0
        ? 'queued'
        : 'done';
  return {
    phase,
    active: active ? toQueueItem(active, 'active') : null,
    queue: queueItems(),
    queuedCount: pending.length,
    activeModelId: active?.params.modelId ?? null,
    activeModelName: active
      ? active.params.modelName?.trim() || `Model ${active.params.modelId}`
      : null,
    paused,
    pauseReason,
  };
}

/** Full queue view for the manage panel (active + pending). */
export function listModelDownloadQueue(): ModelDownloadQueueSnapshot {
  return getModelDownloadQueueSnapshot();
}

function enrichProgress(
  payload: CivitaiDownloadProgress,
): CivitaiDownloadProgress {
  // Never attach the full queue here. Byte ticks, API retries, and errors are
  // frequent; mapping every job (and cloning it into the renderer) froze Browse.
  // Queue-panel rows go out only from broadcastQueueSnapshot.
  const snap = queueProgressHeader();
  const phase = payload.done
    ? 'done'
    : snap.paused
      ? 'paused'
      : payload.phase === 'queued'
        ? 'queued'
        : 'active';
  const modelName =
    payload.modelName ??
    (payload.modelId === snap.activeModelId
      ? (snap.activeModelName ?? undefined)
      : undefined);
  return {
    ...payload,
    phase,
    queuedCount: snap.queuedCount,
    activeModelId: snap.activeModelId,
    activeModelName: snap.activeModelName,
    paused: snap.paused,
    pauseReason: snap.pauseReason,
    modelName,
  };
}

setDownloadProgressEnricher(enrichProgress);

function broadcastQueueSnapshot(
  modelId: number,
  type: CivitaiModelType,
  phase: 'queued' | 'active' | 'paused' | 'done',
  extra?: {
    error?: string;
    done?: boolean;
    saved?: boolean;
    fileName?: string;
    modelName?: string;
  },
): void {
  const snap = getModelDownloadQueueSnapshot();
  const payload: CivitaiDownloadProgress = {
    modelId,
    versionId: 0,
    type,
    // Always send a filename on active so the UI drops the previous job's
    // 100% bar immediately (empty filename used to leave stale progress).
    fileName:
      extra?.fileName ??
      (phase === 'active' ? 'Starting…' : ''),
    receivedBytes: 0,
    totalBytes: null,
    done: extra?.done ?? false,
    saved: extra?.saved,
    error: extra?.error,
    phase: snap.paused ? 'paused' : phase,
    queue: snap.queue,
    queuedCount: snap.queuedCount,
    activeModelId: snap.activeModelId,
    activeModelName: snap.activeModelName,
    active: snap.active,
    paused: snap.paused,
    pauseReason: snap.pauseReason,
    modelName:
      extra?.modelName ??
      snap.activeModelName ??
      snap.queue.find((item) => item.modelId === modelId)?.modelName,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.civitaiDownloadProgress, payload);
  }
}

function downloadJobKey(params: {
  modelId: number;
  versionId?: number;
  fileId?: number;
}): string {
  return `${params.modelId}:${params.versionId ?? 0}:${params.fileId ?? 0}`;
}

function hasDownloadJob(params: {
  modelId: number;
  versionId?: number;
  fileId?: number;
}): boolean {
  const key = downloadJobKey(params);
  if (active && downloadJobKey(active.params) === key) return true;
  return pending.some((job) => downloadJobKey(job.params) === key);
}

function findPendingIndex(modelId: number): number {
  return pending.findIndex((job) => job.params.modelId === modelId);
}

async function drain(): Promise<void> {
  if (draining || paused) return;
  draining = true;
  try {
    while (pending.length > 0) {
      if (suppressPersist || paused) break;

      const job = pending.shift()!;
      active = job;
      const jobAbort = new AbortController();
      activeAbort = jobAbort;
      const signal = jobAbort.signal;
      persistQueueState();
      const jobName =
        job.params.modelName?.trim() || `Model ${job.params.modelId}`;
      broadcastQueueSnapshot(job.params.modelId, job.params.type, 'active', {
        fileName: job.params.fileName?.trim() || 'Starting…',
        modelName: jobName,
      });
      appendDownloadLog('info', `Queue: active — ${jobName}`, {
        source: 'queue',
        modelId: job.params.modelId,
        modelName: jobName,
      });

      let outcome: 'ok' | 'cancel' | 'retry' | 'fail' = 'fail';
      let doneError: string | undefined;
      let doneFileName: string | undefined;
      try {
        const result = await downloadCivitaiModel({
          modelId: job.params.modelId,
          versionId: job.params.versionId,
          fileId: job.params.fileId,
          type: job.params.type,
          category: job.params.category,
          loraCategoryId: job.params.loraCategoryId,
          extraLoraCategoryIds: job.params.extraLoraCategoryIds,
          weights: job.params.weights,
          extraComment: job.params.extraComment,
          extraPrompt: job.params.extraPrompt,
          modelName: job.params.modelName,
          fileName: job.params.fileName,
          signal,
          deferIndexInvalidation: pending.length > 0,
        });
        if (job.cancelRequested || signal.aborted) {
          // Finished racing a cancel click — do not treat as success.
          throw new Error('Download cancelled');
        }
        job.resolve(result);
        outcome = 'ok';
        doneFileName = result.fileName;
        if (result.wildcardAppendError) {
          doneError = `Downloaded ${result.fileName}, but wildcard append failed: ${result.wildcardAppendError}`;
          appendDownloadLog('warn', doneError, {
            source: 'queue',
            modelId: job.params.modelId,
            modelName: jobName,
          });
        } else if (result.wildcardAppended === false && result.wildcardRelativePath) {
          // Already present — not an error; leave quiet.
        }
      } catch (error) {
        const cancelled =
          job.cancelRequested ||
          signal.aborted ||
          isUserCancelledDownloadError(error);
        if (cancelled) {
          job.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
          outcome = 'cancel';
          doneError = 'Download cancelled';
          appendDownloadLog('warn', 'Queue: cancelled', {
            source: 'queue',
            modelId: job.params.modelId,
            modelName: jobName,
          });
        } else if (isRetryableDownloadError(error)) {
          outcome = 'retry';
        } else {
          job.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
          outcome = 'fail';
          logDownloadError('Queue: failed', error, {
            source: 'queue',
            modelId: job.params.modelId,
            modelName: jobName,
          });
        }

        if (outcome === 'retry') {
          const message = formatErrorDetail(error);
          // Keep the whole queue: put this job back, pause for manual/auto resume.
          pending.unshift(job);
          if (active === job) {
            active = null;
          }
          if (activeAbort === jobAbort) {
            activeAbort = null;
          }
          pauseQueueForConnection(message);
          appendDownloadLog(
            'warn',
            `Queue paused (connection) — auto-retry every ${Math.round(AUTO_RESUME_INTERVAL_MS / 1000)}s: ${message}`,
            {
              source: 'queue',
              modelId: job.params.modelId,
              modelName: jobName,
            },
          );
          broadcastQueueSnapshot(job.params.modelId, job.params.type, 'paused', {
            error: `Connection issue — queue paused. Resume anytime (auto-retry every ${Math.round(AUTO_RESUME_INTERVAL_MS / 1000)}s): ${message}`,
          });
          break;
        }
      } finally {
        if (active === job) {
          active = null;
        }
        if (activeAbort === jobAbort) {
          activeAbort = null;
        }
      }

      if (!suppressPersist) persistQueueState();
      broadcastQueueSnapshot(job.params.modelId, job.params.type, 'done', {
        done: true,
        // Only mark saved when the weight actually landed — cancel/fail must
        // not promote the card into Downloaded in the renderer.
        saved: outcome === 'ok' && Boolean(doneFileName),
        error: doneError,
        fileName: doneFileName,
        modelName: job.params.modelName,
      });
      // Apply any deferred folder-index invalidation once the queue is idle.
      if (pending.length === 0) {
        flushDeferredLoraIndexInvalidation();
        flushDeferredCheckpointIndexInvalidation();
      }
    }
  } finally {
    draining = false;
    if (pending.length === 0) {
      flushDeferredLoraIndexInvalidation();
      flushDeferredCheckpointIndexInvalidation();
    }
    if (pending.length > 0 && !suppressPersist && !paused) void drain();
  }
}

/**
 * Enqueue a model file download. Resolves when that job finishes (not when
 * earlier jobs finish). Rejects immediately if the same modelId+version+file
 * is already queued or active.
 *
 * Remembers the last LoRA download category at queue time (not weights —
 * the confirm dialog always starts from the global default pattern).
 */
export function enqueueModelDownload(
  params: ModelDownloadParams,
): Promise<CivitaiDownloadResult> {
  suppressPersist = false;
  if (hasDownloadJob(params)) {
    return Promise.reject(
      new Error(
        `Model ${params.modelName?.trim() || params.modelId} is already downloading or queued`,
      ),
    );
  }

  if (params.fileName?.trim()) {
    const dest = checkCivitaiDownloadDestination({
      type: params.type,
      fileName: params.fileName,
      fallbackFileName: params.fileName,
      category: params.category,
      loraCategoryId: params.loraCategoryId,
    });
    if (!dest.ok) {
      return Promise.reject(new Error(dest.error));
    }
  }

  if (params.type === 'LORA' && params.loraCategoryId) {
    rememberLoraDownloadCategory(params.loraCategoryId);
  } else {
    rememberDownloadCategory(params.type, params.category);
  }

  const normalized: ModelDownloadParams =
    params.type === 'LORA'
      ? {
          ...params,
          extraLoraCategoryIds: (() => {
            const extras = uniqueExtraLoraCategoryIds(
              params.loraCategoryId,
              params.extraLoraCategoryIds,
            );
            return extras.length > 0 ? extras : undefined;
          })(),
        }
      : { ...params, extraLoraCategoryIds: undefined };

  return new Promise<CivitaiDownloadResult>((resolve, reject) => {
    pending.push({
      id: randomUUID(),
      params: normalized,
      resolve,
      reject,
    });
    const name = normalized.modelName?.trim() || `Model ${normalized.modelId}`;
    appendDownloadLog(
      'info',
      paused
        ? `Queue: enqueued (paused) — ${name}`
        : `Queue: enqueued — ${name}`,
      {
        source: 'queue',
        modelId: normalized.modelId,
        modelName: name,
      },
    );
    persistQueueState();
    broadcastQueueSnapshot(
      normalized.modelId,
      normalized.type,
      paused ? 'paused' : 'queued',
    );
    void drain();
  });
}

/**
 * Clear connection pause and continue draining the persisted queue.
 * Auto-resume uses the same path every ~60s while still paused.
 */
export function resumeModelDownloadQueue(_opts?: {
  auto?: boolean;
}): ModelDownloadQueueSnapshot {
  if (pending.length === 0 && !active) {
    paused = false;
    pauseReason = null;
    clearAutoResumeTimer();
    persistQueueState();
    return getModelDownloadQueueSnapshot();
  }
  paused = false;
  pauseReason = null;
  clearAutoResumeTimer();
  persistQueueState();
  appendDownloadLog(
    'info',
    _opts?.auto ? 'Queue auto-resumed' : 'Queue resumed',
    { source: 'queue' },
  );
  const head = active ?? pending[0]!;
  broadcastQueueSnapshot(
    head.params.modelId,
    head.params.type,
    active ? 'active' : 'queued',
  );
  void drain();
  return getModelDownloadQueueSnapshot();
}

/** Remove a pending job, or abort the active transfer. */
export function cancelModelDownload(modelId: number): ModelDownloadQueueSnapshot {
  const idx = findPendingIndex(modelId);
  if (idx >= 0) {
    const [job] = pending.splice(idx, 1);
    job!.reject(new Error('Download cancelled'));
    persistQueueState();
    broadcastQueueSnapshot(modelId, job!.params.type, 'done', {
      done: true,
      error: 'Download cancelled',
    });
    return getModelDownloadQueueSnapshot();
  }
  if (active?.params.modelId === modelId) {
    const job = active;
    job.cancelRequested = true;
    activeAbort?.abort();
    // Drop from the public "active" slot immediately so Cancel cannot leave a
    // zombie Downloading row / block the rest of the queue in the UI while the
    // in-flight abort settles. Drain still owns `job` until await returns.
    if (active === job) {
      active = null;
    }
    persistQueueState();
    const head = pending[0];
    // Always attribute the cancel to the cancelled modelId (not the next head)
    // so the renderer can drop a false Downloaded settle for the right card.
    broadcastQueueSnapshot(
      modelId,
      job.params.type,
      head ? 'queued' : 'done',
      { done: true, error: 'Download cancelled' },
    );
    return getModelDownloadQueueSnapshot();
  }
  throw new Error('Model is not in the download queue');
}

/**
 * Reorder pending jobs. `orderedModelIds` must be a permutation of the current
 * pending model ids (active job is not included).
 */
export function reorderModelDownloadQueue(
  orderedModelIds: number[],
): ModelDownloadQueueSnapshot {
  if (orderedModelIds.length !== pending.length) {
    throw new Error('Reorder list must include every queued model exactly once');
  }
  const byId = new Map(pending.map((job) => [job.params.modelId, job]));
  const next: Job[] = [];
  const seen = new Set<number>();
  for (const id of orderedModelIds) {
    if (seen.has(id)) throw new Error(`Duplicate model id in reorder: ${id}`);
    const job = byId.get(id);
    if (!job) throw new Error(`Model ${id} is not queued`);
    seen.add(id);
    next.push(job);
  }
  pending.splice(0, pending.length, ...next);
  persistQueueState();
  const head = pending[0] ?? active;
  broadcastQueueSnapshot(
    head?.params.modelId ?? 0,
    head?.params.type ?? 'LORA',
    active ? 'active' : pending.length > 0 ? 'queued' : 'done',
  );
  return getModelDownloadQueueSnapshot();
}

/** Move a pending job up (-1) or down (+1) in the queue. */
export function moveModelDownloadInQueue(
  modelId: number,
  delta: -1 | 1,
): ModelDownloadQueueSnapshot {
  const idx = findPendingIndex(modelId);
  if (idx < 0) throw new Error('Model is not queued (active downloads cannot be reordered)');
  const target = idx + delta;
  if (target < 0 || target >= pending.length) {
    return getModelDownloadQueueSnapshot();
  }
  const copy = pending.slice();
  const [job] = copy.splice(idx, 1);
  copy.splice(target, 0, job!);
  pending.splice(0, pending.length, ...copy);
  persistQueueState();
  broadcastQueueSnapshot(modelId, job!.params.type, 'queued');
  return getModelDownloadQueueSnapshot();
}

export type UpdateQueuedDownloadInput = {
  loraCategoryId?: string;
  extraLoraCategoryIds?: string[];
  category?: string;
  weights?: string;
  extraComment?: string;
  extraPrompt?: string;
  versionId?: number;
  fileId?: number;
  fileName?: string;
};

/**
 * Change destination / snippet options for a pending job (not the active
 * transfer). Folder destination is applied when that job starts.
 */
export function updateQueuedModelDownload(
  modelId: number,
  patch: UpdateQueuedDownloadInput,
): ModelDownloadQueueSnapshot {
  const idx = findPendingIndex(modelId);
  if (idx < 0) {
    throw new Error(
      'Only queued downloads can change category (not the one currently transferring)',
    );
  }
  const job = pending[idx]!;
  if (job.params.type === 'LORA') {
    const loraCategoryId =
      typeof patch.loraCategoryId === 'string'
        ? patch.loraCategoryId.trim()
        : job.params.loraCategoryId;
    if (!loraCategoryId) throw new Error('LoRA category is required');
    const cat = getLoraDownloadCategoryById(loraCategoryId);
    if (!cat) throw new Error('LoRA download category not found');

    const extrasSource =
      patch.extraLoraCategoryIds !== undefined
        ? patch.extraLoraCategoryIds
        : job.params.extraLoraCategoryIds;
    const extraLoraCategoryIds = uniqueExtraLoraCategoryIds(
      loraCategoryId,
      extrasSource,
    );
    for (const id of extraLoraCategoryIds) {
      if (!getLoraDownloadCategoryById(id)) {
        throw new Error(`LoRA download category not found (${id})`);
      }
    }

    const weights =
      typeof patch.weights === 'string' ? patch.weights : job.params.weights;
    const next: ModelDownloadParams = {
      ...job.params,
      loraCategoryId,
      extraLoraCategoryIds:
        extraLoraCategoryIds.length > 0 ? extraLoraCategoryIds : undefined,
      category: undefined,
      weights,
    };
    if (typeof patch.extraComment === 'string') {
      next.extraComment = patch.extraComment.trim() || undefined;
    }
    if (typeof patch.extraPrompt === 'string') {
      next.extraPrompt = patch.extraPrompt.trim() || undefined;
    }
    if (
      typeof patch.versionId === 'number' &&
      Number.isFinite(patch.versionId)
    ) {
      next.versionId = patch.versionId;
    }
    if (typeof patch.fileId === 'number' && Number.isFinite(patch.fileId)) {
      next.fileId = patch.fileId;
    }
    if (typeof patch.fileName === 'string') {
      next.fileName = patch.fileName.trim() || undefined;
    }
    const destCheck = checkCivitaiDownloadDestination({
      type: 'LORA',
      fileName: next.fileName?.trim() || 'model.safetensors',
      fallbackFileName: next.fileName?.trim() || 'model.safetensors',
      loraCategoryId,
    });
    if (!destCheck.ok) throw new Error(destCheck.error);
    job.params = next;
    rememberLoraDownloadCategory(loraCategoryId);
  } else {
    const category =
      typeof patch.category === 'string' ? patch.category : job.params.category;
    const next: ModelDownloadParams = {
      ...job.params,
      category,
      loraCategoryId: undefined,
      extraLoraCategoryIds: undefined,
      weights: undefined,
      extraComment: undefined,
      extraPrompt: undefined,
    };
    if (
      typeof patch.versionId === 'number' &&
      Number.isFinite(patch.versionId)
    ) {
      next.versionId = patch.versionId;
    }
    if (typeof patch.fileId === 'number' && Number.isFinite(patch.fileId)) {
      next.fileId = patch.fileId;
    }
    if (typeof patch.fileName === 'string') {
      next.fileName = patch.fileName.trim() || undefined;
    }
    const destCheck = checkCivitaiDownloadDestination({
      type: 'Checkpoint',
      fileName: next.fileName?.trim() || 'model.safetensors',
      fallbackFileName: next.fileName?.trim() || 'model.safetensors',
      category,
    });
    if (!destCheck.ok) throw new Error(destCheck.error);
    job.params = next;
    rememberDownloadCategory('Checkpoint', category);
  }
  persistQueueState();
  broadcastQueueSnapshot(modelId, job.params.type, 'queued');
  return getModelDownloadQueueSnapshot();
}

/**
 * Flush queue to disk (e.g. before quit). Active transfer is saved as the
 * first job so the next launch can restart it after removing any `.partial`.
 */
export function flushModelDownloadQueuePersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  suppressPersist = false;
  writeQueueState(persistLibraryId);
  persistLibraryId = undefined;
}

/**
 * Call while the *current* library is still active, before switching.
 * Saves this library's queue, aborts the in-flight transfer, and clears
 * memory without deleting the saved file.
 */
export function prepareModelDownloadQueueLibrarySwitch(): void {
  const libraryId = getActiveLibraryId();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  writeQueueState(libraryId);
  persistLibraryId = undefined;
  suppressPersist = true;
  clearAutoResumeTimer();
  paused = false;
  pauseReason = null;
  const waiting = pending.splice(0, pending.length);
  for (const job of waiting) {
    job.reject(new Error('Download cancelled'));
  }
  if (activeAbort) {
    activeAbort.abort();
  }
  active = null;
  activeAbort = null;
  broadcastQueueSnapshot(0, 'LORA', 'done');
}

/**
 * Reload unfinished downloads from disk for the active library and start
 * draining. Interrupted transfers restart from scratch (leftover `.partial`
 * files are deleted when the download begins).
 *
 * Returns how many jobs were restored.
 */
export function restorePersistedModelDownloadQueue(): number {
  suppressPersist = false;
  if (active || pending.length > 0) return 0;
  const libraryId = getActiveLibraryId();
  const stored = loadPersistedQueue(libraryId);
  restoreAttempted = true;
  if (!stored || stored.jobs.length === 0) return 0;

  const seen = new Set<string>();
  for (const row of stored.jobs) {
    const key = downloadJobKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push({
      id: row.id || randomUUID(),
      params: {
        modelId: row.modelId,
        versionId: row.versionId,
        fileId: row.fileId,
        type: row.type,
        category: row.category,
        loraCategoryId: row.loraCategoryId,
        extraLoraCategoryIds: (() => {
          const extras = uniqueExtraLoraCategoryIds(
            row.loraCategoryId,
            Array.isArray(row.extraLoraCategoryIds)
              ? row.extraLoraCategoryIds.filter(
                  (id): id is string => typeof id === 'string',
                )
              : undefined,
          );
          return extras.length > 0 ? extras : undefined;
        })(),
        weights: row.weights,
        extraComment:
          typeof row.extraComment === 'string' ? row.extraComment : undefined,
        extraPrompt:
          typeof row.extraPrompt === 'string' ? row.extraPrompt : undefined,
        modelName: row.modelName,
        fileName: row.fileName,
      },
      resolve: () => {
        // Restored jobs have no waiting IPC caller.
      },
      reject: () => {
        // Errors still surface via progress events.
      },
    });
  }

  if (pending.length === 0) return 0;

  paused = Boolean(stored.paused);
  pauseReason = paused
    ? stored.pauseReason?.trim() || 'Connection issue — queue paused'
    : null;

  persistQueueState(libraryId);
  const head = pending[0]!;
  broadcastQueueSnapshot(
    head.params.modelId,
    head.params.type,
    paused ? 'paused' : 'queued',
    paused
      ? {
          error: `Queue restored paused — resume anytime (auto-retry every ${Math.round(AUTO_RESUME_INTERVAL_MS / 1000)}s)${pauseReason ? `: ${pauseReason}` : ''}`,
        }
      : undefined,
  );
  if (paused) {
    scheduleAutoResume();
  } else {
    void drain();
  }
  return pending.length;
}

/** Whether startup restore has been attempted at least once. */
export function didAttemptModelDownloadQueueRestore(): boolean {
  return restoreAttempted;
}
