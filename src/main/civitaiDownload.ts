import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { buildLoraClipboardSnippet, civitaiModelPageUrl } from '../domain/civitaiSnippet.js';
import { extractTriggersFromCivitaiDescription } from '../domain/civitaiTriggerFallback.js';
import {
  DEFAULT_LORA_DOWNLOAD_WEIGHTS,
  normalizeLoraWeights,
  uniqueExtraLoraCategoryIds,
} from '../domain/loraDownloadCategory.js';
import { resolveDownloadSaveFileName } from '../domain/civitaiDownloadFileName.js';
import { pickCivitaiAutoV2, collectAutoV2HashesFromVersions } from '../domain/modelHash.js';
import { IPC } from '../shared/contracts.js';
import {
  getCivitaiModel,
  pickPrimaryFile,
  primaryPreviewUrl,
  type CivitaiModel,
  type CivitaiModelFile,
  type CivitaiModelType,
  type CivitaiModelVersion,
} from './civitaiClient.js';
import { ingestDownloadedModelFile } from './ingestDownloadedModel.js';
import {
  resolveDownloadCategoryDir,
} from './civitaiCategoryService.js';
import {
  getLoraDownloadCategoryById,
} from './loraDownloadCategoryService.js';
import {
  computeFileAutoV2,
  seedCachedFileAutoV2,
} from './modelHashCache.js';
import {
  getCachedModel,
  insertCachedModelsIfAbsent,
  patchCachedModel,
  type CachedCivitaiModel,
} from './civitaiCatalogCache.js';
import { appendLoraSnippetInMemory } from './wildcardMemoryEdit.js';
import {
  getCivitaiApiKey,
  getCivitaiOrigin,
  loadSettings,
} from './settingsStore.js';
import {
  appendDownloadLog,
  formatErrorDetail,
  logDownloadError,
} from './downloadLog.js';
import { readPromptKeywordsFromSafetensors } from './safetensorsInspect.js';

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export type CivitaiDownloadProgress = {
  modelId: number;
  versionId: number;
  type: CivitaiModelType;
  fileName: string;
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
  /** True only after the weight file exists on disk (not cancel/fail). */
  saved?: boolean;
  error?: string;
  modelName?: string;
  /** Pre-transfer detail (API wait, rate-limit retry, opening URL, …). */
  statusMessage?: string;
  phase?: 'queued' | 'active' | 'paused' | 'done';
  queue?: Array<{
    jobId?: string;
    modelId: number;
    modelName: string;
    type: CivitaiModelType;
    versionId?: number;
    status?: 'active' | 'queued';
    categoryLabel?: string;
    loraCategoryId?: string;
    extraLoraCategoryIds?: string[];
    category?: string;
    weights?: string;
  }>;
  queuedCount?: number;
  activeModelId?: number | null;
  activeModelName?: string | null;
  active?: {
    jobId: string;
    modelId: number;
    modelName: string;
    type: CivitaiModelType;
    versionId?: number;
    status: 'active' | 'queued';
    categoryLabel: string;
    loraCategoryId?: string;
    extraLoraCategoryIds?: string[];
    category?: string;
    weights?: string;
  } | null;
  paused?: boolean;
  pauseReason?: string | null;
};

export type CivitaiDownloadResult = {
  modelId: number;
  versionId: number;
  type: CivitaiModelType;
  absolutePath: string;
  fileName: string;
  fileStem: string;
  clipboardText: string | null;
  categoryFolder?: string;
  wildcardRelativePath?: string;
  wildcardAppended?: boolean;
  wildcardAppendError?: string;
};

type ProgressEnricher = (
  payload: CivitaiDownloadProgress,
) => CivitaiDownloadProgress;

let progressEnricher: ProgressEnricher | null = null;

/** Cap progress IPC so the renderer is not flooded (~2/s). */
const PROGRESS_MIN_INTERVAL_MS = 500;
let lastProgressBroadcastAt = 0;
/** Raw (unenriched) payload waiting for the throttle window. */
let pendingProgress: CivitaiDownloadProgress | null = null;
let pendingProgressTimer: ReturnType<typeof setTimeout> | null = null;
/** Skip identical wait/retry status spam (`modelId\\0statusMessage`). */
let lastSentLeanStatusKey = '';

/** Let the download queue attach queue snapshot fields to progress events. */
export function setDownloadProgressEnricher(
  enricher: ProgressEnricher | null,
): void {
  progressEnricher = enricher;
}

function sendProgressToWindows(payload: CivitaiDownloadProgress): void {
  // Enrich only on the way out — never per chunk before the throttle gate.
  const full = progressEnricher ? progressEnricher(payload) : payload;
  if (
    !full.done &&
    !full.error &&
    full.statusMessage &&
    full.receivedBytes === 0
  ) {
    const key = `${full.modelId}\0${full.statusMessage}`;
    if (key === lastSentLeanStatusKey) return;
    lastSentLeanStatusKey = key;
  } else if (full.done || full.error || full.receivedBytes > 0) {
    lastSentLeanStatusKey = '';
  }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.civitaiDownloadProgress, full);
  }
  for (const listener of progressBroadcastListeners) {
    try {
      listener(full);
    } catch {
      // ignore listener errors
    }
  }
}

const progressBroadcastListeners = new Set<
  (payload: CivitaiDownloadProgress) => void
>();

/** Subscribe to every progress broadcast (including when no BrowserWindows). */
export function onDownloadProgressBroadcast(
  listener: (payload: CivitaiDownloadProgress) => void,
): () => void {
  progressBroadcastListeners.add(listener);
  return () => {
    progressBroadcastListeners.delete(listener);
  };
}

function flushPendingProgress(): void {
  if (pendingProgressTimer) {
    clearTimeout(pendingProgressTimer);
    pendingProgressTimer = null;
  }
  if (!pendingProgress) return;
  const payload = pendingProgress;
  pendingProgress = null;
  lastProgressBroadcastAt = Date.now();
  sendProgressToWindows(payload);
}

function broadcastProgress(payload: CivitaiDownloadProgress): void {
  // Flush only true milestones immediately. Wait/retry status text used to
  // force a full IPC fan-out on every civitaiGet attempt and made Browse janky.
  const force = payload.done || Boolean(payload.error);
  if (force) {
    pendingProgress = null;
    if (pendingProgressTimer) {
      clearTimeout(pendingProgressTimer);
      pendingProgressTimer = null;
    }
    lastProgressBroadcastAt = Date.now();
    sendProgressToWindows(payload);
    return;
  }

  const now = Date.now();
  const wait = PROGRESS_MIN_INTERVAL_MS - (now - lastProgressBroadcastAt);
  if (wait <= 0) {
    pendingProgress = null;
    if (pendingProgressTimer) {
      clearTimeout(pendingProgressTimer);
      pendingProgressTimer = null;
    }
    lastProgressBroadcastAt = now;
    sendProgressToWindows(payload);
    return;
  }

  pendingProgress = payload;
  if (!pendingProgressTimer) {
    pendingProgressTimer = setTimeout(() => {
      pendingProgressTimer = null;
      flushPendingProgress();
    }, wait);
  }
}

function fileStemOf(fileName: string): string {
  return path.basename(fileName).replace(/\.(safetensors|ckpt|pt)$/i, '');
}

/**
 * Resolve the on-disk destination for a download and reject collisions /
 * forbidden names. Never invents “name (1)” — the user must pick a free name.
 */
export function checkCivitaiDownloadDestination(opts: {
  type: CivitaiModelType;
  fileName: string;
  /** Sanitize fallback when `fileName` has no extension. */
  fallbackFileName?: string;
  category?: string;
  loraCategoryId?: string;
}):
  | { ok: true; fileName: string; absolutePath: string }
  | { ok: false; error: string } {
  const settings = loadSettings();
  const targetFolder =
    opts.type === 'LORA' ? settings.loraFolder : settings.checkpointFolder;
  if (!targetFolder) {
    return {
      ok: false,
      error:
        opts.type === 'LORA'
          ? 'No LoRA folder configured'
          : 'No checkpoint folder configured',
    };
  }

  let categoryFolder = opts.category;
  if (opts.type === 'LORA' && opts.loraCategoryId) {
    const cat = getLoraDownloadCategoryById(opts.loraCategoryId);
    if (!cat) return { ok: false, error: 'LoRA download category not found' };
    categoryFolder = cat.folder;
  }

  const resolved = resolveDownloadSaveFileName(
    opts.fileName,
    opts.fallbackFileName?.trim() || opts.fileName,
  );
  if (!resolved.ok) return resolved;

  const downloadDir = resolveDownloadCategoryDir(targetFolder, categoryFolder);
  const absolutePath = path.join(downloadDir, resolved.fileName);
  if (fs.existsSync(absolutePath)) {
    return {
      ok: false,
      error:
        `A file named “${resolved.fileName}” already exists in ${downloadDir}. ` +
        'Choose a different name — downloads never auto-rename.',
    };
  }
  return { ok: true, fileName: resolved.fileName, absolutePath };
}

async function appendSnippetToWildcard(
  relativePath: string,
  snippet: string,
  fileStem: string,
): Promise<{ appended: boolean; error?: string }> {
  const result = await appendLoraSnippetInMemory(
    relativePath,
    snippet,
    fileStem,
    `Add LoRA reference to ${relativePath}`,
  );
  return { appended: result.changed, error: result.error };
}

export async function downloadCivitaiModel(opts: {
  modelId: number;
  versionId?: number;
  type: CivitaiModelType;
  /** Checkpoint (and legacy LoRA): subfolder name under model root. */
  category?: string;
  /** LoRA download category id (folder + wildcard + weights). */
  loraCategoryId?: string;
  /**
   * Extra LoRA categories — same file, append snippet to each wildcard.
   * Primary `loraCategoryId` still owns the download folder.
   */
  extraLoraCategoryIds?: string[];
  /** Override weights for the LoRA snippet. */
  weights?: string;
  /** Optional `#` comment line(s) between URL and `<lora:…>`. */
  extraComment?: string;
  /** Optional prompt text after triggers on the `<lora:…>` line. */
  extraPrompt?: string;
  /** Display name for progress / queue UI. */
  modelName?: string;
  /** Override on-disk file name (basename; extension optional). */
  fileName?: string;
  /** Specific file on the version (when a version has multiple weights). */
  fileId?: number;
  /** Abort in-flight HTTP transfer (queue cancel). */
  signal?: AbortSignal;
  /**
   * When true, mark the LoRA/checkpoint folder index dirty instead of
   * invalidating immediately (avoids a sync tree walk before the next queue job).
   */
  deferIndexInvalidation?: boolean;
}): Promise<CivitaiDownloadResult> {
  const settings = loadSettings();
  const targetFolder =
    opts.type === 'LORA' ? settings.loraFolder : settings.checkpointFolder;
  if (!targetFolder) {
    throw new Error(
      opts.type === 'LORA'
        ? 'No LoRA folder configured'
        : 'No checkpoint folder configured',
    );
  }

  const displayName =
    opts.modelName?.trim() || `Model ${opts.modelId}`;
  const logCtx = {
    source: 'download',
    modelId: opts.modelId,
    modelName: displayName,
  };
  const emitStarting = (statusMessage: string) => {
    broadcastProgress({
      modelId: opts.modelId,
      versionId: opts.versionId ?? 0,
      type: opts.type,
      fileName: opts.fileName?.trim() || 'Starting…',
      modelName: displayName,
      statusMessage,
      receivedBytes: 0,
      totalBytes: null,
      done: false,
    });
  };

  appendDownloadLog('info', `Starting ${opts.type} download`, logCtx);

  // Clear any previous job's 100% bar before API/metadata work.
  emitStarting('Looking up model on Civitai…');

  let categoryFolder = opts.category;
  let wildcardRelativePath: string | undefined;
  const extraWildcardPaths: string[] = [];
  const weightsRaw = (opts.weights ?? '').trim();
  let weights = normalizeLoraWeights(weightsRaw) ?? undefined;

  if (weightsRaw && !weights) {
    throw new Error(
      `Invalid LoRA weights "${weightsRaw}". Use a number or pick-list, e.g. 0.8 or {0.8|0.9|1|1}.`,
    );
  }

  if (opts.type === 'LORA' && opts.loraCategoryId) {
    const cat = getLoraDownloadCategoryById(opts.loraCategoryId);
    if (!cat) throw new Error('LoRA download category not found');
    categoryFolder = cat.folder;
    wildcardRelativePath = cat.wildcardRelativePath;
    if (!weights) weights = DEFAULT_LORA_DOWNLOAD_WEIGHTS;

    const extraIds = uniqueExtraLoraCategoryIds(
      opts.loraCategoryId,
      opts.extraLoraCategoryIds,
    );
    const seenPaths = new Set<string>(
      wildcardRelativePath ? [wildcardRelativePath] : [],
    );
    for (const id of extraIds) {
      const extra = getLoraDownloadCategoryById(id);
      if (!extra) {
        throw new Error(`LoRA download category not found (${id})`);
      }
      if (!seenPaths.has(extra.wildcardRelativePath)) {
        seenPaths.add(extra.wildcardRelativePath);
        extraWildcardPaths.push(extra.wildcardRelativePath);
      }
    }
  }

  const downloadDir = resolveDownloadCategoryDir(targetFolder, categoryFolder);
  fs.mkdirSync(downloadDir, { recursive: true });

  // Interactive lane: don't sit behind catalog backfill / hash enrich GETs.
  const model = await getCivitaiModel(opts.modelId, {
    lane: 'interactive',
    signal: opts.signal,
    onStatus: emitStarting,
  });
  const expected = opts.type.toLowerCase();
  if (model.type.toLowerCase() !== expected) {
    throw new Error(
      `Model ${opts.modelId} is type ${model.type}, expected ${opts.type}`,
    );
  }

  const versions = model.modelVersions ?? [];
  const version =
    (opts.versionId
      ? versions.find((v) => v.id === opts.versionId)
      : versions[0]) ?? null;
  if (!version) {
    throw new Error('Model version not found');
  }

  const file =
    (typeof opts.fileId === 'number' && Number.isFinite(opts.fileId)
      ? (version.files ?? []).find((f) => f.id === opts.fileId)
      : null) ?? pickPrimaryFile(version);
  if (!file?.name) {
    throw new Error('No downloadable model file on this version');
  }

  let downloadUrl =
    file.downloadUrl ||
    version.downloadUrl ||
    `${getCivitaiOrigin()}/api/download/models/${version.id}`;
  const apiKey = getCivitaiApiKey();
  if (apiKey && !/[?&]token=/.test(downloadUrl)) {
    downloadUrl += downloadUrl.includes('?')
      ? `&token=${encodeURIComponent(apiKey)}`
      : `?token=${encodeURIComponent(apiKey)}`;
  }

  const headers: HeadersInit = {
    Accept: '*/*',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  const saveResolved = resolveDownloadSaveFileName(
    opts.fileName ?? '',
    file.name,
  );
  if (!saveResolved.ok) {
    throw new Error(saveResolved.error);
  }
  const destCheck = checkCivitaiDownloadDestination({
    type: opts.type,
    fileName: saveResolved.fileName,
    fallbackFileName: file.name,
    category: categoryFolder,
    loraCategoryId: opts.loraCategoryId,
  });
  if (!destCheck.ok) {
    throw new Error(destCheck.error);
  }
  const dest = destCheck.absolutePath;
  const fileStem = fileStemOf(path.basename(dest));
  let clipboardText: string | null = null;
  let wildcardAppended: boolean | undefined;
  let wildcardAppendError: string | undefined;
  const apiTrainedWords = (version.trainedWords ?? [])
    .map((w) => w.trim())
    .filter(Boolean);

  const buildLoraSnippet = (trainedWords: string[]) =>
    buildLoraClipboardSnippet({
      origin: getCivitaiOrigin(),
      modelId: model.id,
      modelName: model.name,
      fileStem,
      trainedWords,
      weights,
      extraComment: opts.extraComment,
      extraPrompt: opts.extraPrompt,
    });

  // Build the LoRA snippet for optional wildcard append only — never copy to
  // the system clipboard (Civitai downloads used to overwrite the user's paste).
  if (opts.type === 'LORA') {
    clipboardText = buildLoraSnippet(apiTrainedWords);
  }

  emitStarting('Opening download from Civitai…');
  appendDownloadLog(
    'info',
    `GET file ${path.basename(dest)} (${file.sizeKB ? formatBytes(file.sizeKB * 1024) : 'size unknown'})`,
    logCtx,
  );
  const connectTimeoutMs = 60_000;
  const connectAc = new AbortController();
  const connectTimer = setTimeout(() => connectAc.abort(), connectTimeoutMs);
  let response: Response;
  try {
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, connectAc.signal])
      : connectAc.signal;
    response = await fetch(downloadUrl, {
      headers,
      redirect: 'follow',
      signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) {
      throw new Error('Download cancelled');
    }
    if (connectAc.signal.aborted) {
      const msg = `Download timed out waiting for Civitai (no response in ${connectTimeoutMs / 1000}s)`;
      logDownloadError(msg, e, logCtx);
      throw new Error(msg);
    }
    const msg = logDownloadError('Download connection failed', e, logCtx);
    throw new Error(msg, { cause: e instanceof Error ? e : undefined });
  } finally {
    clearTimeout(connectTimer);
  }
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '');
    const msg = `Download failed (${response.status}): ${body.slice(0, 200) || response.statusText}`;
    appendDownloadLog('error', msg, logCtx);
    throw new Error(msg);
  }
  appendDownloadLog(
    'info',
    `Transfer started → HTTP ${response.status}${
      response.headers.get('content-length')
        ? ` · ${formatBytes(Number(response.headers.get('content-length')))}`
        : ''
    }`,
    logCtx,
  );

  const totalHeader = response.headers.get('content-length');
  const totalBytes = totalHeader ? Number(totalHeader) : null;
  const temp = `${dest}.partial`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // Interrupted / prior attempts leave `.partial` files; always restart clean
  // (no HTTP Range resume — Civitai URLs are not reliably resumable).
  try {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  } catch {
    // ignore
  }

  let receivedBytes = 0;
  const emitProgress = (
    patch: Partial<
      Pick<
        CivitaiDownloadProgress,
        'receivedBytes' | 'totalBytes' | 'done' | 'saved' | 'error' | 'statusMessage'
      >
    >,
  ) => {
    broadcastProgress({
      modelId: model.id,
      versionId: version.id,
      type: opts.type,
      fileName: path.basename(dest),
      modelName: opts.modelName?.trim() || model.name,
      receivedBytes,
      totalBytes: Number.isFinite(totalBytes) ? totalBytes : null,
      done: false,
      ...patch,
    });
  };

  emitProgress({ receivedBytes: 0, statusMessage: 'Receiving file…' });

  const nodeStream = Readable.fromWeb(
    response.body as import('node:stream/web').ReadableStream,
  );
  const destroyOnAbort = () => {
    try {
      nodeStream.destroy(new Error('Download cancelled'));
    } catch {
      // ignore
    }
  };
  if (opts.signal?.aborted) {
    destroyOnAbort();
  } else {
    opts.signal?.addEventListener('abort', destroyOnAbort, { once: true });
  }
  /** Log at most 25/50/75% — never per-chunk spam. */
  let nextMilestonePct = 25;
  /** Do not call broadcast on every chunk — coalesce to the IPC interval. */
  let byteEmitTimer: ReturnType<typeof setTimeout> | null = null;
  let lastByteEmitAt = 0;
  const flushByteProgress = () => {
    byteEmitTimer = null;
    lastByteEmitAt = Date.now();
    emitProgress({ statusMessage: undefined });
  };
  const scheduleByteProgress = () => {
    const now = Date.now();
    const wait = PROGRESS_MIN_INTERVAL_MS - (now - lastByteEmitAt);
    if (wait <= 0) {
      if (byteEmitTimer) {
        clearTimeout(byteEmitTimer);
        byteEmitTimer = null;
      }
      flushByteProgress();
      return;
    }
    if (!byteEmitTimer) {
      byteEmitTimer = setTimeout(flushByteProgress, wait);
    }
  };
  nodeStream.on('data', (chunk: Buffer | string) => {
    const size =
      typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    receivedBytes += size;
    scheduleByteProgress();
    const total = Number.isFinite(totalBytes) ? totalBytes : null;
    if (total && total > 0 && nextMilestonePct <= 75) {
      const pct = Math.floor((receivedBytes / total) * 100);
      while (nextMilestonePct <= 75 && pct >= nextMilestonePct) {
        appendDownloadLog(
          'debug',
          `Transfer ${nextMilestonePct}% (${formatBytes(receivedBytes)} / ${formatBytes(total)})`,
          logCtx,
        );
        nextMilestonePct += 25;
      }
    }
  });

  try {
    await pipeline(nodeStream, createWriteStream(temp));
    if (byteEmitTimer) {
      clearTimeout(byteEmitTimer);
      byteEmitTimer = null;
    }
    opts.signal?.removeEventListener('abort', destroyOnAbort);
    fs.renameSync(temp, dest);
  } catch (err) {
    if (byteEmitTimer) {
      clearTimeout(byteEmitTimer);
      byteEmitTimer = null;
    }
    opts.signal?.removeEventListener('abort', destroyOnAbort);
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // ignore cleanup errors
    }
    if (opts.signal?.aborted) {
      const cancelled = new Error('Download cancelled');
      appendDownloadLog('warn', 'Download cancelled', logCtx);
      emitProgress({ done: true, error: cancelled.message });
      throw cancelled;
    }
    const message = logDownloadError(
      `Transfer failed at ${formatBytes(receivedBytes)}${
        Number.isFinite(totalBytes) && totalBytes
          ? ` / ${formatBytes(totalBytes)}`
          : ''
      }`,
      err,
      logCtx,
    );
    emitProgress({ done: true, error: message });
    throw new Error(message, { cause: err instanceof Error ? err : undefined });
  }

  // Wildcard append after the file is on disk. When Civitai omits
  // trainedWords, fall back to safetensors metadata, then description text.
  if (opts.type === 'LORA') {
    let trainedWords = apiTrainedWords;
    if (trainedWords.length === 0) {
      const fromFile = readPromptKeywordsFromSafetensors(dest, fileStem);
      if (fromFile.length > 0) {
        trainedWords = fromFile;
        appendDownloadLog(
          'info',
          `No Civitai trainedWords — using file keywords: ${fromFile.join(', ')}`,
          logCtx,
        );
      } else {
        const fromDescription = extractTriggersFromCivitaiDescription(
          model.description,
        );
        if (fromDescription.length > 0) {
          trainedWords = fromDescription;
          appendDownloadLog(
            'info',
            `No Civitai trainedWords — using description triggers: ${fromDescription.join(', ')}`,
            logCtx,
          );
        } else {
          appendDownloadLog(
            'debug',
            'No Civitai trainedWords, file keywords, or description triggers',
            logCtx,
          );
        }
      }
      if (trainedWords.length > 0) {
        clipboardText = buildLoraSnippet(trainedWords);
      }
    }

    if (clipboardText) {
      const appendPaths = [
        ...(wildcardRelativePath ? [wildcardRelativePath] : []),
        ...extraWildcardPaths,
      ];
      const appended: string[] = [];
      const already: string[] = [];
      const errors: string[] = [];
      for (const rel of appendPaths) {
        const result = await appendSnippetToWildcard(
          rel,
          clipboardText,
          fileStem,
        );
        if (result.error) {
          errors.push(`${rel}: ${result.error}`);
        } else if (result.appended) {
          appended.push(rel);
        } else {
          already.push(rel);
        }
      }
      if (appendPaths.length > 0) {
        wildcardRelativePath = appendPaths.join(', ');
        wildcardAppended = appended.length > 0;
        if (errors.length > 0) {
          wildcardAppendError = errors.join('; ');
        } else if (appended.length === 0 && already.length > 0) {
          wildcardAppended = false;
        }
      }
    }
  }

  emitProgress({
    done: true,
    saved: true,
    totalBytes: Number.isFinite(totalBytes) ? totalBytes : receivedBytes,
  });
  appendDownloadLog(
    'info',
    `Saved ${path.basename(dest)} (${formatBytes(receivedBytes)})`,
    logCtx,
  );

  // Hash/catalog bookkeeping after the transfer is reported done so a slow
  // hash never leaves the UI stuck at 100% on this job.
  try {
    await rememberDownloadedAutoV2({
      dest,
      model,
      version,
      file,
    });
  } catch (e) {
    appendDownloadLog(
      'warn',
      `Post-download hash/catalog update failed: ${formatErrorDetail(e)}`,
      logCtx,
    );
  }
  // One file into the live index — never wipe/rebuild the whole library.
  ingestDownloadedModelFile(dest);

  return {
    modelId: model.id,
    versionId: version.id,
    type: opts.type,
    absolutePath: dest,
    fileName: path.basename(dest),
    fileStem,
    clipboardText,
    categoryFolder: categoryFolder || undefined,
    wildcardRelativePath,
    wildcardAppended,
    wildcardAppendError,
  };
}

/**
 * After a successful transfer: cache the file's AutoV2 and merge it onto the
 * catalog card so installed detection and LoRA-files reverse match agree.
 * Never block the download IPC on multi‑GB SHA-256 — hash on the worker later.
 */
async function rememberDownloadedAutoV2(opts: {
  dest: string;
  model: CivitaiModel;
  version: CivitaiModelVersion;
  file: CivitaiModelFile;
}): Promise<void> {
  const apply = (autoV2: string): void => {
    seedCachedFileAutoV2(opts.dest, autoV2);

    const origin = getCivitaiOrigin();
    const versionHashes = collectAutoV2HashesFromVersions(opts.model.modelVersions);
    const hashes = versionHashes.includes(autoV2)
      ? versionHashes
      : [...versionHashes, autoV2];

    const existing = getCachedModel(origin, opts.model.id);
    if (existing) {
      patchCachedModel(origin, opts.model.id, {
        autoV2: existing.autoV2 ?? autoV2,
        autoV2Hashes: hashes,
        fileName: existing.fileName ?? opts.file.name,
      });
      return;
    }

    const now = new Date().toISOString();
    const stub: CachedCivitaiModel = {
      id: opts.model.id,
      origin,
      name: opts.model.name,
      type: opts.model.type,
      nsfw: Boolean(opts.model.nsfw),
      creator: opts.model.creator?.username,
      tags: Array.isArray(opts.model.tags) ? opts.model.tags : [],
      baseModel: opts.version.baseModel,
      versionId: opts.version.id,
      versionName: opts.version.name,
      fileName: opts.file.name,
      fileSizeKB: opts.file.sizeKB,
      trainedWords: opts.version.trainedWords ?? [],
      previewUrl: primaryPreviewUrl(opts.model) ?? undefined,
      pageUrl: civitaiModelPageUrl(origin, opts.model.id, opts.model.name),
      earlyAccess: false,
      autoV2,
      autoV2Hashes: hashes,
      firstSeenAt: now,
      updatedAt: now,
    };
    insertCachedModelsIfAbsent([stub]);
  };

  const fromCivitai = pickCivitaiAutoV2(opts.file.hashes);
  if (fromCivitai) {
    apply(fromCivitai);
    return;
  }

  void computeFileAutoV2(opts.dest).then((hash) => {
    if (!hash) return;
    apply(hash);
    ingestDownloadedModelFile(opts.dest, { notify: false });
  });
}
