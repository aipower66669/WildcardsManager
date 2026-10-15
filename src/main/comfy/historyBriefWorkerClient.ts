import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { HistoryBrief } from './historyBrief.js';
import type {
  HistoryBriefWorkerRequest,
  HistoryBriefWorkerResponse,
} from './historyBriefWorker.js';

type Pending = {
  resolve: (brief: HistoryBrief) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function workerScriptPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'historyBriefWorker.js',
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
  w.on('message', (msg: HistoryBriefWorkerResponse) => {
    const item = pending.get(msg.id);
    if (!item) return;
    pending.delete(msg.id);
    if (msg.ok && msg.brief) item.resolve(msg.brief);
    else item.reject(new Error(msg.error ?? 'History worker failed'));
  });
  w.on('error', (err) => {
    disposeWorker();
    failAll(err instanceof Error ? err : new Error(String(err)));
  });
  w.on('exit', (code) => {
    if (worker !== w) return;
    worker = null;
    if (pending.size > 0 && code !== 0) {
      failAll(new Error(`History worker exited (code ${code})`));
    }
  });
  return w;
}

/** Fetch and parse Comfy history off the Electron main thread. */
export function fetchHistoryBriefInWorker(input: {
  url: string;
  headers: Record<string, string>;
  promptId: string;
}): Promise<HistoryBrief> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const req: HistoryBriefWorkerRequest = { id, ...input };
    try {
      ensureWorker().postMessage(req);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function disposeHistoryBriefWorker(): void {
  failAll(new Error('History worker disposed'));
  disposeWorker();
}
