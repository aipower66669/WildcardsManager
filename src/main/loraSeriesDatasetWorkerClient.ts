import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { LoraSeriesDatasetKeyParts } from '../domain/loraTrainingDataset.js';
import type {
  LoraSeriesDatasetPreviewResult,
} from './loraTrainingDatasetResolve.js';
import type {
  LoraSeriesDatasetWorkerRequest,
  LoraSeriesDatasetWorkerResponse,
} from './loraSeriesDatasetWorker.js';

type Pending = {
  resolve: (msg: LoraSeriesDatasetWorkerResponse) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function workerScriptPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'loraSeriesDatasetWorker.js',
  );
}

function disposeWorker(): void {
  if (!worker) return;
  const w = worker;
  worker = null;
  w.removeAllListeners();
  void w.terminate().catch(() => {
    // ignore
  });
}

function failAll(error: Error): void {
  const waiting = [...pending.values()];
  pending.clear();
  for (const item of waiting) item.reject(error);
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(workerScriptPath());
  worker = w;
  w.on('message', (msg: LoraSeriesDatasetWorkerResponse) => {
    const item = pending.get(msg.id);
    if (!item) return;
    pending.delete(msg.id);
    if (msg.ok) item.resolve(msg);
    else item.reject(new Error(msg.error ?? 'LoRA series dataset lookup failed'));
  });
  w.on('error', (err) => {
    disposeWorker();
    failAll(err instanceof Error ? err : new Error(String(err)));
  });
  w.on('exit', (code) => {
    if (worker !== w) return;
    worker = null;
    if (pending.size > 0 && code !== 0) {
      failAll(new Error(`LoRA series dataset worker exited (code ${code})`));
    }
  });
  return w;
}

function post(req: LoraSeriesDatasetWorkerRequest): Promise<LoraSeriesDatasetWorkerResponse> {
  return new Promise((resolve, reject) => {
    pending.set(req.id, { resolve, reject });
    try {
      ensureWorker().postMessage(req);
    } catch (error) {
      pending.delete(req.id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Training-folder walk, validation image listing, and cover encode.
 * Runs off the Electron main thread so the LoRA card stays clickable.
 */
export function resolveLoraSeriesDatasetOffThread(
  parts: LoraSeriesDatasetKeyParts,
  opts: {
    trainingRoot: string | null;
    loraRoot: string | null;
    force?: boolean;
    knownPreviewPath?: string | null;
  },
): Promise<LoraSeriesDatasetPreviewResult> {
  const id = nextId++;
  const req: LoraSeriesDatasetWorkerRequest = {
    id,
    op: 'resolve',
    parts,
    trainingRoot: opts.trainingRoot,
    loraRoot: opts.loraRoot,
    force: opts.force === true,
    knownPreviewPath: opts.knownPreviewPath ?? null,
  };
  return post(req).then((msg) => {
    if (!msg.result) throw new Error('LoRA series dataset lookup returned nothing');
    return msg.result;
  });
}

/** Read one training-library image off the Electron main thread. */
export function readTrainingLibraryImageOffThread(
  trainingRoot: string | null,
  absolutePath: string,
): Promise<string | null> {
  const id = nextId++;
  const req: LoraSeriesDatasetWorkerRequest = {
    id,
    op: 'readImage',
    trainingRoot,
    absolutePath,
  };
  return post(req).then((msg) => msg.dataUrl ?? null);
}

export function disposeLoraSeriesDatasetWorker(): void {
  failAll(new Error('LoRA series dataset worker disposed'));
  disposeWorker();
}
