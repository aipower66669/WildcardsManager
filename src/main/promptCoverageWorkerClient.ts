import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { PromptCoverageInput, PromptCoverageReport } from '../domain/promptCoverage.js';
import type {
  PromptCoverageWorkerIn,
  PromptCoverageWorkerOut,
} from './promptCoverageWorker.js';

export type PromptCoverageWorkerHandlers = {
  onProgress: (info: {
    done: number;
    total: number;
    currentFolder: string;
    walksPerSec: number;
  }) => void;
  onDone: (report: PromptCoverageReport) => void;
  onCancelled: (report: PromptCoverageReport) => void;
  onError: (error: string) => void;
};

let worker: Worker | null = null;
let handlers: PromptCoverageWorkerHandlers | null = null;

function workerScriptPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'promptCoverageWorker.js',
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
  w.on('message', (msg: PromptCoverageWorkerOut) => {
    const h = handlers;
    if (!h) return;
    if (msg.type === 'progress') {
      h.onProgress({
        done: msg.done,
        total: msg.total,
        currentFolder: msg.currentFolder,
        walksPerSec: msg.walksPerSec,
      });
      return;
    }
    if (msg.type === 'done') {
      h.onDone(msg.report);
      return;
    }
    if (msg.type === 'cancelled') {
      h.onCancelled(msg.report);
      return;
    }
    if (msg.type === 'error') {
      h.onError(msg.error);
    }
  });
  w.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    handlers?.onError(message);
    disposeWorker();
  });
  w.on('exit', (code) => {
    if (worker !== w) return;
    worker = null;
    if (code !== 0 && handlers) {
      handlers.onError(`Coverage worker exited (code ${code})`);
    }
  });
  return w;
}

export function startPromptCoverageInWorker(
  input: PromptCoverageInput,
  nextHandlers: PromptCoverageWorkerHandlers,
): void {
  disposeWorker();
  handlers = nextHandlers;
  const msg: PromptCoverageWorkerIn = { type: 'run', input };
  ensureWorker().postMessage(msg);
}

export function cancelPromptCoverageInWorker(): void {
  if (!worker) return;
  const msg: PromptCoverageWorkerIn = { type: 'cancel' };
  try {
    worker.postMessage(msg);
  } catch {
    disposeWorker();
  }
}

export function disposePromptCoverageWorker(): void {
  handlers = null;
  disposeWorker();
}
