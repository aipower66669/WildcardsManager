import { parentPort } from 'node:worker_threads';
import { resolveFileAutoV2 } from './modelHashCompute.js';

export type ModelHashWorkerRequest = {
  id: number;
  absolutePath: string;
};

export type ModelHashWorkerResponse = {
  id: number;
  autoV2: string | null;
  size: number;
  mtimeMs: number;
  error?: string;
};

if (!parentPort) {
  throw new Error('modelHashWorker must run as a worker thread');
}

parentPort.on('message', (msg: ModelHashWorkerRequest) => {
  void (async () => {
    try {
      const resolved = await resolveFileAutoV2(msg.absolutePath);
      const response: ModelHashWorkerResponse = {
        id: msg.id,
        autoV2: resolved.autoV2,
        size: resolved.size,
        mtimeMs: resolved.mtimeMs,
      };
      parentPort!.postMessage(response);
    } catch (e) {
      const response: ModelHashWorkerResponse = {
        id: msg.id,
        autoV2: null,
        size: 0,
        mtimeMs: 0,
        error: e instanceof Error ? e.message : String(e),
      };
      parentPort!.postMessage(response);
    }
  })();
});
