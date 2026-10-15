import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import {
  DEFAULT_LORA_DOWNLOAD_WEIGHTS,
  normalizeLoraWeights,
  uniqueExtraLoraCategoryIds,
} from '../domain/loraDownloadCategory.js';
import { resolveDownloadSaveFileName } from '../domain/civitaiDownloadFileName.js';
import { uniqueDestFileName } from '../domain/uniqueDestFileName.js';
import { IPC } from '../shared/contracts.js';
import { resolveDownloadCategoryDir } from './civitaiCategoryService.js';
import { getLoraDownloadCategoryById } from './loraDownloadCategoryService.js';
import { ingestDownloadedModelFile } from './ingestDownloadedModel.js';
import { seedCachedFileAutoV2, computeFileAutoV2 } from './modelHashCache.js';
import { appendLoraSnippetInMemory } from './wildcardMemoryEdit.js';
import { loadSettings } from './settingsStore.js';
import {
  appendDownloadLog,
  formatErrorDetail,
  logDownloadError,
} from './downloadLog.js';
import {
  hfAuthHeaders,
  hfResolveDownloadUrl,
  type HuggingFaceRepoFile,
} from './huggingfaceClient.js';

export type HfDownloadType = 'LORA' | 'Checkpoint';

export type HfDownloadProgress = {
  jobId: string;
  repoId: string;
  filePath: string;
  fileName: string;
  type: HfDownloadType;
  modelName?: string;
  receivedBytes: number;
  totalBytes: number | null;
  done: boolean;
  saved?: boolean;
  error?: string;
  statusMessage?: string;
  phase?: 'queued' | 'active' | 'paused' | 'done';
  queuedCount?: number;
  activeRepoId?: string | null;
  activeModelName?: string | null;
};

export type HfDownloadParams = {
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
  signal?: AbortSignal;
  jobId?: string;
  onProgress?: (p: HfDownloadProgress) => void;
  /** Defer folder-index invalidate when more HF jobs are queued. */
  deferIndexInvalidation?: boolean;
};

const PROGRESS_MIN_INTERVAL_MS = 400;
let lastProgressBroadcastAt = 0;
let pendingProgress: HfDownloadProgress | null = null;
let pendingProgressTimer: ReturnType<typeof setTimeout> | null = null;

function sendProgress(payload: HfDownloadProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(IPC.huggingfaceDownloadProgress, payload);
    } catch {
      // ignore
    }
  }
}

function broadcastProgress(payload: HfDownloadProgress): void {
  const force = payload.done || Boolean(payload.error);
  if (force) {
    pendingProgress = null;
    if (pendingProgressTimer) {
      clearTimeout(pendingProgressTimer);
      pendingProgressTimer = null;
    }
    lastProgressBroadcastAt = Date.now();
    sendProgress(payload);
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
    sendProgress(payload);
    return;
  }
  pendingProgress = payload;
  if (!pendingProgressTimer) {
    pendingProgressTimer = setTimeout(() => {
      pendingProgressTimer = null;
      if (!pendingProgress) return;
      const next = pendingProgress;
      pendingProgress = null;
      lastProgressBroadcastAt = Date.now();
      sendProgress(next);
    }, wait);
  }
}

// Fix type error - HfDownloadProgress doesn't have onProgress
function emit(
  base: Omit<HfDownloadProgress, 'onProgress'>,
  onProgress?: (p: HfDownloadProgress) => void,
): void {
  broadcastProgress(base);
  onProgress?.(base);
}

export async function downloadHuggingFaceFile(
  opts: HfDownloadParams,
): Promise<{ dest: string; fileName: string }> {
  const jobId = opts.jobId ?? `hf-${Date.now()}`;
  const displayName = opts.modelName?.trim() || opts.repoId;
  const logCtx = {
    source: 'hf-download',
    modelName: displayName,
  };

  const settings = loadSettings();
  const targetFolder =
    opts.type === 'LORA' ? settings.loraFolder : settings.checkpointFolder;
  if (!targetFolder?.trim()) {
    throw new Error(
      opts.type === 'LORA'
        ? 'No LoRA folder configured'
        : 'No checkpoint folder configured',
    );
  }

  let categoryFolder = opts.category ?? '';
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
      if (!extra) throw new Error(`LoRA download category not found (${id})`);
      if (!seenPaths.has(extra.wildcardRelativePath)) {
        seenPaths.add(extra.wildcardRelativePath);
        extraWildcardPaths.push(extra.wildcardRelativePath);
      }
    }
  }

  const downloadDir = resolveDownloadCategoryDir(targetFolder, categoryFolder);
  fs.mkdirSync(downloadDir, { recursive: true });

  const remoteName = path.posix.basename(opts.filePath.replace(/\\/g, '/'));
  const saveResolved = resolveDownloadSaveFileName(
    opts.fileName ?? '',
    remoteName,
  );
  if (!saveResolved.ok) {
    throw new Error(saveResolved.error);
  }
  const unique = uniqueDestFileName(downloadDir, saveResolved.fileName, (p) =>
    fs.existsSync(p),
  );
  const saveName = unique.fileName;
  const dest = unique.absolutePath;

  const progressBase = {
    jobId,
    repoId: opts.repoId,
    filePath: opts.filePath,
    fileName: saveName,
    type: opts.type,
    modelName: displayName,
  };

  const push = (
    partial: Partial<HfDownloadProgress> & {
      receivedBytes: number;
      done: boolean;
    },
  ) => {
    emit(
      {
        ...progressBase,
        totalBytes: partial.totalBytes ?? null,
        statusMessage: partial.statusMessage,
        error: partial.error,
        saved: partial.saved,
        phase: partial.phase,
        queuedCount: partial.queuedCount,
        activeRepoId: partial.activeRepoId,
        activeModelName: partial.activeModelName,
        receivedBytes: partial.receivedBytes,
        done: partial.done,
      },
      opts.onProgress,
    );
  };

  push({
    receivedBytes: 0,
    totalBytes: null,
    done: false,
    statusMessage: 'Opening Hugging Face download…',
    phase: 'active',
  });

  appendDownloadLog('info', `Starting HF download ${opts.repoId}/${opts.filePath}`, logCtx);

  const url = hfResolveDownloadUrl(opts.repoId, opts.filePath, opts.revision);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        ...hfAuthHeaders(),
        'User-Agent': 'WildcardsManager/1.0 (Hugging Face download)',
      },
      redirect: 'follow',
      signal: opts.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw new Error('Download cancelled');
    const detail = formatErrorDetail(e);
    logDownloadError('HF download failed', e, logCtx);
    push({
      receivedBytes: 0,
      done: true,
      error: detail,
    });
    throw e;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const msg = `Hugging Face download failed (${response.status})${
      body ? `: ${body.slice(0, 200)}` : ''
    }`;
    appendDownloadLog('error', msg, logCtx);
    push({ receivedBytes: 0, done: true, error: msg });
    throw new Error(msg);
  }

  const totalBytes = Number(response.headers.get('content-length') ?? 0) || null;
  const temp = `${dest}.partial`;
  try {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  } catch {
    // ignore
  }

  if (!response.body) {
    throw new Error('Hugging Face download returned an empty body');
  }

  let receivedBytes = 0;
  push({
    receivedBytes: 0,
    totalBytes,
    done: false,
    statusMessage: 'Receiving file…',
    phase: 'active',
  });

  const nodeStream = Readable.fromWeb(
    response.body as import('node:stream/web').ReadableStream,
  );
  nodeStream.on('data', (chunk: Buffer | string) => {
    const n = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    receivedBytes += n;
    push({
      receivedBytes,
      totalBytes,
      done: false,
      phase: 'active',
    });
  });

  try {
    await pipeline(nodeStream, createWriteStream(temp));
  } catch (e) {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // ignore
    }
    if (opts.signal?.aborted) throw new Error('Download cancelled');
    const detail = formatErrorDetail(e);
    push({ receivedBytes, totalBytes, done: true, error: detail });
    throw e;
  }

  try {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  } catch {
    // ignore
  }
  fs.renameSync(temp, dest);

  ingestDownloadedModelFile(dest);
  void computeFileAutoV2(dest).then((hash) => {
    if (!hash) return;
    seedCachedFileAutoV2(dest, hash);
    ingestDownloadedModelFile(dest, { notify: false });
  });

  // Wildcard append for LoRA categories.
  if (opts.type === 'LORA' && wildcardRelativePath) {
    const stem = path.basename(saveName, path.extname(saveName));
    const w = weights ?? DEFAULT_LORA_DOWNLOAD_WEIGHTS;
    const lines = [`# https://huggingface.co/${opts.repoId}`];
    const comment = opts.extraComment?.trim();
    if (comment) {
      for (const line of comment.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        lines.push(t.startsWith('#') ? t : `# ${t}`);
      }
    }
    const extra = opts.extraPrompt?.trim();
    lines.push(`<lora:${stem}:${w}>${extra ? ` ${extra}` : ''}`);
    const snippet = `${lines.join('\n')}\n`;
    const paths = [wildcardRelativePath, ...extraWildcardPaths];
    for (const rel of paths) {
      try {
        const result = await appendLoraSnippetInMemory(
          rel,
          snippet,
          stem,
          `Add HF LoRA reference to ${rel}`,
        );
        if (result.error) {
          throw new Error(result.error);
        }
      } catch (e) {
        appendDownloadLog(
          'warn',
          `Wildcard append failed for ${rel}: ${formatErrorDetail(e)}`,
          logCtx,
        );
      }
    }
  }

  appendDownloadLog('info', `Saved ${saveName}`, logCtx);
  push({
    receivedBytes,
    totalBytes: totalBytes ?? receivedBytes,
    done: true,
    saved: true,
    phase: 'done',
  });

  return { dest, fileName: saveName };
}

/** Used by confirm UI — collisions auto-rename at download time. */
export function resolveHfDownloadDestination(opts: {
  type: HfDownloadType;
  category?: string;
  loraCategoryId?: string;
  fileName: string;
}): {
  absolutePath: string;
  exists: boolean;
  folder: string;
  fileName: string;
  renamed: boolean;
} {
  const settings = loadSettings();
  const targetFolder =
    opts.type === 'LORA' ? settings.loraFolder : settings.checkpointFolder;
  if (!targetFolder?.trim()) {
    throw new Error(
      opts.type === 'LORA'
        ? 'No LoRA folder configured'
        : 'No checkpoint folder configured',
    );
  }
  let categoryFolder = opts.category ?? '';
  if (opts.type === 'LORA' && opts.loraCategoryId) {
    const cat = getLoraDownloadCategoryById(opts.loraCategoryId);
    if (!cat) throw new Error('LoRA download category not found');
    categoryFolder = cat.folder;
  }
  const folder = resolveDownloadCategoryDir(targetFolder, categoryFolder);
  const saveResolved = resolveDownloadSaveFileName(opts.fileName, opts.fileName);
  if (!saveResolved.ok) {
    throw new Error(saveResolved.error);
  }
  const unique = uniqueDestFileName(folder, saveResolved.fileName, (p) =>
    fs.existsSync(p),
  );
  return {
    absolutePath: unique.absolutePath,
    folder,
    fileName: unique.fileName,
    renamed: unique.renamed,
    // Never block the confirm UI — download will auto-rename.
    exists: false,
  };
}

export type { HuggingFaceRepoFile };
