import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type {
  ModelFolderWalkHit,
  ModelFolderWalkWorkerRequest,
  ModelFolderWalkWorkerResponse,
} from './modelFolderWalkWorker.js';

type Pending = {
  resolve: (files: ModelFolderWalkHit[]) => void;
  reject: (error: Error) => void;
  onProgress?: (files: number) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function workerScriptPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'modelFolderWalkWorker.js',
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
  w.on('message', (msg: ModelFolderWalkWorkerResponse) => {
    const item = pending.get(msg.id);
    if (!item) return;
    if (msg.type === 'progress') {
      item.onProgress?.(msg.files);
      return;
    }
    pending.delete(msg.id);
    if (msg.type === 'done') item.resolve(msg.files);
    else item.reject(new Error(msg.error ?? 'Model folder walk failed'));
  });
  w.on('error', (err) => {
    disposeWorker();
    failAll(err instanceof Error ? err : new Error(String(err)));
  });
  w.on('exit', (code) => {
    if (worker !== w) return;
    worker = null;
    if (pending.size > 0 && code !== 0) {
      failAll(new Error(`Model folder walk worker exited (code ${code})`));
    }
  });
  return w;
}

/** Recurse a model root off the Electron main thread. */
export function walkModelFolderInWorker(
  root: string,
  weightExtensions: readonly string[],
  opts?: { onProgress?: (files: number) => void },
): Promise<ModelFolderWalkHit[]> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress: opts?.onProgress });
    const req: ModelFolderWalkWorkerRequest = {
      id,
      root,
      weightExtensions: [...weightExtensions],
    };
    try {
      ensureWorker().postMessage(req);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function disposeModelFolderWalkWorker(): void {
  failAll(new Error('Model folder walk worker disposed'));
  disposeWorker();
}
