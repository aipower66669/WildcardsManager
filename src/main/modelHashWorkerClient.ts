import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type {
  ModelHashWorkerRequest,
  ModelHashWorkerResponse,
} from './modelHashWorker.js';

export type ModelHashWorkerResult = {
  autoV2: string | null;
  size: number;
  mtimeMs: number;
};

type Pending = {
  absolutePath: string;
  resolve: (result: ModelHashWorkerResult) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
/** FIFO of ids waiting to be sent (at most one hash in flight on the worker). */
const queue: number[] = [];
let inFlightId: number | null = null;

function workerScriptPath(): string {
  // Bundled sibling of this module (`out/main/modelHashWorker.js`).
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'modelHashWorker.js',
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

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(workerScriptPath());
  worker = w;
  w.on('message', (msg: ModelHashWorkerResponse) => {
    const item = pending.get(msg.id);
    if (!item) {
      if (inFlightId === msg.id) inFlightId = null;
      pump();
      return;
    }
    pending.delete(msg.id);
    if (item.onAbort && item.signal) {
      item.signal.removeEventListener('abort', item.onAbort);
    }
    if (inFlightId === msg.id) inFlightId = null;
    item.resolve({
      autoV2: msg.autoV2,
      size: msg.size ?? 0,
      mtimeMs: msg.mtimeMs ?? 0,
    });
    pump();
  });
  w.on('error', (err) => {
    disposeWorker();
    failAll(err instanceof Error ? err : new Error(String(err)));
  });
  w.on('exit', (code) => {
    if (worker !== w) return;
    worker = null;
    // In-flight job died with the worker (cancel mid-hash). Others stay queued.
    if (inFlightId != null) {
      const item = pending.get(inFlightId);
      pending.delete(inFlightId);
      if (item?.onAbort && item.signal) {
        item.signal.removeEventListener('abort', item.onAbort);
      }
      item?.resolve({ autoV2: null, size: 0, mtimeMs: 0 });
      inFlightId = null;
    }
    if (pending.size > 0 && code !== 0) {
      // Unexpected exit — fail remaining so callers can retry later.
      failAll(new Error(`Model hash worker exited (code ${code})`));
      return;
    }
    pump();
  });
  return w;
}

function failAll(error: Error): void {
  const waiting = [...pending.entries()];
  pending.clear();
  queue.length = 0;
  inFlightId = null;
  for (const [, item] of waiting) {
    if (item.onAbort && item.signal) {
      item.signal.removeEventListener('abort', item.onAbort);
    }
    item.reject(error);
  }
}

function cancelJob(id: number): void {
  const item = pending.get(id);
  if (!item) return;
  pending.delete(id);
  if (item.onAbort && item.signal) {
    item.signal.removeEventListener('abort', item.onAbort);
  }
  const qi = queue.indexOf(id);
  if (qi >= 0) queue.splice(qi, 1);
  item.resolve({ autoV2: null, size: 0, mtimeMs: 0 });
  if (inFlightId === id) {
    inFlightId = null;
    // Kill the CPU-bound hash; a new worker is created on the next job.
    disposeWorker();
    pump();
  }
}

function pump(): void {
  if (inFlightId != null) return;
  const id = queue.shift();
  if (id == null) return;
  const item = pending.get(id);
  if (!item) {
    pump();
    return;
  }
  if (item.signal?.aborted) {
    pending.delete(id);
    item.resolve({ autoV2: null, size: 0, mtimeMs: 0 });
    pump();
    return;
  }
  inFlightId = id;
  const req: ModelHashWorkerRequest = {
    id,
    absolutePath: item.absolutePath,
  };
  try {
    ensureWorker().postMessage(req);
  } catch (e) {
    pending.delete(id);
    inFlightId = null;
    item.reject(e instanceof Error ? e : new Error(String(e)));
    pump();
  }
}

/**
 * Hash a model file on a dedicated worker thread so SHA-256 of multi‑GB
 * weights does not stall the Electron main process / UI IPC.
 */
export function computeFileAutoV2InWorker(
  absolutePath: string,
  signal?: AbortSignal,
): Promise<ModelHashWorkerResult> {
  if (signal?.aborted) {
    return Promise.resolve({ autoV2: null, size: 0, mtimeMs: 0 });
  }

  return new Promise((resolve, reject) => {
    const id = nextId++;
    const onAbort = () => cancelJob(id);
    pending.set(id, { absolutePath, resolve, reject, signal, onAbort });
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    queue.push(id);
    pump();
  });
}

/** Reject waiters and stop the worker (app quit / tests). */
export function disposeModelHashWorker(): void {
  failAll(new Error('Hash worker disposed'));
  disposeWorker();
}
