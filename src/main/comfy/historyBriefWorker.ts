import { parentPort } from 'node:worker_threads';
import {
  historyBriefFromJson,
  type HistoryBrief,
} from './historyBrief.js';

export type HistoryBriefWorkerRequest = {
  id: number;
  url: string;
  headers: Record<string, string>;
  promptId: string;
};

export type HistoryBriefWorkerResponse = {
  id: number;
  ok: boolean;
  brief?: HistoryBrief;
  error?: string;
};

if (!parentPort) {
  throw new Error('historyBriefWorker must run as a worker thread');
}

parentPort.on('message', (msg: HistoryBriefWorkerRequest) => {
  void (async () => {
    try {
      const res = await fetch(msg.url, { headers: msg.headers });
      if (!res.ok) {
        const response: HistoryBriefWorkerResponse = {
          id: msg.id,
          ok: true,
          brief: { completed: false, statusStr: null, image: null },
        };
        parentPort!.postMessage(response);
        return;
      }
      const json: unknown = await res.json();
      const response: HistoryBriefWorkerResponse = {
        id: msg.id,
        ok: true,
        brief: historyBriefFromJson(json, msg.promptId),
      };
      parentPort!.postMessage(response);
    } catch (error) {
      const response: HistoryBriefWorkerResponse = {
        id: msg.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      parentPort!.postMessage(response);
    }
  })();
});
