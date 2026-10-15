import { parentPort } from 'node:worker_threads';
import { walkModelFolderEntriesAsync } from './modelFolderWalk.js';

export type ModelFolderWalkWorkerRequest = {
  id: number;
  root: string;
  weightExtensions: string[];
};

export type ModelFolderWalkHit = {
  abs: string;
  rel: string;
};

export type ModelFolderWalkWorkerProgress = {
  id: number;
  type: 'progress';
  files: number;
};

export type ModelFolderWalkWorkerResponse =
  | ModelFolderWalkWorkerProgress
  | {
      id: number;
      type: 'done';
      files: ModelFolderWalkHit[];
    }
  | {
      id: number;
      type: 'error';
      error: string;
    };

if (!parentPort) {
  throw new Error('modelFolderWalkWorker must run as a worker thread');
}

parentPort.on('message', (msg: ModelFolderWalkWorkerRequest) => {
  void (async () => {
    try {
      const files: ModelFolderWalkHit[] = [];
      const weightExtensions = new Set(msg.weightExtensions);
      await walkModelFolderEntriesAsync(
        msg.root,
        msg.root,
        (abs, rel) => {
          files.push({ abs, rel });
        },
        {
          weightExtensions,
          yieldEvery: 64,
          onProgress: (count) => {
            const progress: ModelFolderWalkWorkerProgress = {
              id: msg.id,
              type: 'progress',
              files: count,
            };
            parentPort!.postMessage(progress);
          },
        },
      );
      const response: ModelFolderWalkWorkerResponse = {
        id: msg.id,
        type: 'done',
        files,
      };
      parentPort!.postMessage(response);
    } catch (error) {
      const response: ModelFolderWalkWorkerResponse = {
        id: msg.id,
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
      parentPort!.postMessage(response);
    }
  })();
});
