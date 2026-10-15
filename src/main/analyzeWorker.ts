import { parentPort } from 'node:worker_threads';
import { analyzeCore, type AnalyzeCoreInput } from '../domain/analyzeCore.js';

export type AnalyzeWorkerRequest = {
  id: number;
  input: AnalyzeCoreInput;
};

export type AnalyzeWorkerResponse = {
  id: number;
  ok: boolean;
  result?: ReturnType<typeof analyzeCore>;
  error?: string;
};

if (!parentPort) {
  throw new Error('analyzeWorker must run as a worker thread');
}

parentPort.on('message', (msg: AnalyzeWorkerRequest) => {
  try {
    const result = analyzeCore(msg.input);
    const response: AnalyzeWorkerResponse = { id: msg.id, ok: true, result };
    parentPort!.postMessage(response);
  } catch (error) {
    const response: AnalyzeWorkerResponse = {
      id: msg.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    parentPort!.postMessage(response);
  }
});
