import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { AnalyzeCoreInput, AnalyzeCoreResult } from '../domain/analyzeCore.js';
import type {
  AnalyzeWorkerRequest,
  AnalyzeWorkerResponse,
} from './analyzeWorker.js';

type Pending = {
  resolve: (result: AnalyzeCoreResult) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function workerScriptPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'analyzeWorker.js',
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
  w.on('message', (msg: AnalyzeWorkerResponse) => {
    const item = pending.get(msg.id);
    if (!item) return;
    pending.delete(msg.id);
    if (msg.ok && msg.result) item.resolve(msg.result);
    else item.reject(new Error(msg.error ?? 'Analyze worker failed'));
  });
  w.on('error', (err) => {
    disposeWorker();
    failAll(err instanceof Error ? err : new Error(String(err)));
  });
  w.on('exit', (code) => {
    if (worker !== w) return;
    worker = null;
    if (pending.size > 0 && code !== 0) {
      failAll(new Error(`Analyze worker exited (code ${code})`));
    }
  });
  return w;
}

/** Graph analysis off the Electron main thread. */
export function analyzeCoreInWorker(
  input: AnalyzeCoreInput,
): Promise<AnalyzeCoreResult> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const req: AnalyzeWorkerRequest = { id, input };
    try {
      ensureWorker().postMessage(req);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function disposeAnalyzeWorker(): void {
  failAll(new Error('Analyze worker disposed'));
  disposeWorker();
}
