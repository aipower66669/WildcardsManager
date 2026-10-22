import { parentPort } from 'node:worker_threads';
import {
  createPromptCoverageRun,
  type PromptCoverageInput,
  type PromptCoverageReport,
} from '../domain/promptCoverage.js';

export type PromptCoverageWorkerRunMessage = {
  type: 'run';
  input: PromptCoverageInput;
};

export type PromptCoverageWorkerCancelMessage = {
  type: 'cancel';
};

export type PromptCoverageWorkerIn =
  | PromptCoverageWorkerRunMessage
  | PromptCoverageWorkerCancelMessage;

export type PromptCoverageWorkerProgressMessage = {
  type: 'progress';
  done: number;
  total: number;
  currentFolder: string;
  walksPerSec: number;
};

export type PromptCoverageWorkerDoneMessage = {
  type: 'done';
  report: PromptCoverageReport;
};

export type PromptCoverageWorkerCancelledMessage = {
  type: 'cancelled';
  report: PromptCoverageReport;
};

export type PromptCoverageWorkerErrorMessage = {
  type: 'error';
  error: string;
};

export type PromptCoverageWorkerOut =
  | PromptCoverageWorkerProgressMessage
  | PromptCoverageWorkerDoneMessage
  | PromptCoverageWorkerCancelledMessage
  | PromptCoverageWorkerErrorMessage;

if (!parentPort) {
  throw new Error('promptCoverageWorker must run as a worker thread');
}

const CHUNK = 200;
let cancelRequested = false;

/** Let the worker event loop deliver a cancel message between chunks. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function executeRun(input: PromptCoverageInput): Promise<void> {
  const run = createPromptCoverageRun(input);
  if (run.total === 0) {
    const report = run.buildReport('done');
    const out: PromptCoverageWorkerDoneMessage = { type: 'done', report };
    parentPort!.postMessage(out);
    return;
  }

  let lastEmit = 0;
  const emitProgress = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastEmit < 200) return;
    lastEmit = now;
    // walksPerSec is filled by the main process from elapsed/done.
    const out: PromptCoverageWorkerProgressMessage = {
      type: 'progress',
      done: run.done,
      total: run.total,
      currentFolder: run.currentFolder,
      walksPerSec: 0,
    };
    parentPort!.postMessage(out);
  };

  emitProgress(true);
  while (run.runChunk(CHUNK, () => cancelRequested)) {
    emitProgress(false);
    await yieldToEventLoop();
  }
  emitProgress(true);

  if (run.cancelled || cancelRequested) {
    const report = run.buildReport('cancelled');
    const out: PromptCoverageWorkerCancelledMessage = {
      type: 'cancelled',
      report,
    };
    parentPort!.postMessage(out);
    return;
  }

  const report = run.buildReport('done');
  const out: PromptCoverageWorkerDoneMessage = { type: 'done', report };
  parentPort!.postMessage(out);
}

parentPort.on('message', (msg: PromptCoverageWorkerIn) => {
  if (msg.type === 'cancel') {
    cancelRequested = true;
    return;
  }
  if (msg.type !== 'run') return;

  cancelRequested = false;
  void executeRun(msg.input).catch((error: unknown) => {
    const out: PromptCoverageWorkerErrorMessage = {
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
    parentPort!.postMessage(out);
  });
});
