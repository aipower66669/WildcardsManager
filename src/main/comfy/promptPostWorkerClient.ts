import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { GenerationValues } from './applyBindings.js';
import type {
  PromptPostWorkerRequest,
  PromptPostWorkerResponse,
  PromptProfileStat,
} from './promptPostWorker.js';

type Pending = {
  resolve: (msg: PromptPostWorkerResponse) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

let samplerCache: { token: string; ids: Set<string> } | null = null;
let samplerInflight: { token: string; promise: Promise<Set<string>> } | null =
  null;

function workerScriptPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'promptPostWorker.js',
  );
}

function profileToken(stat: PromptProfileStat): string {
  return `${stat.path}\0${stat.mtimeMs}\0${stat.size}`;
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
  w.on('message', (msg: PromptPostWorkerResponse) => {
    const item = pending.get(msg.id);
    if (!item) return;
    pending.delete(msg.id);
    if (msg.ok) item.resolve(msg);
    else item.reject(new Error(msg.error ?? 'Prompt worker failed'));
  });
  w.on('error', (err) => {
    disposeWorker();
    failAll(err instanceof Error ? err : new Error(String(err)));
  });
  w.on('exit', (code) => {
    if (worker !== w) return;
    worker = null;
    if (pending.size > 0 && code !== 0) {
      failAll(new Error(`Prompt worker exited (code ${code})`));
    }
  });
  return w;
}

function callWorker(
  msg: Omit<PromptPostWorkerRequest, 'id'>,
): Promise<PromptPostWorkerResponse> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    try {
      ensureWorker().postMessage({ ...msg, id });
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Parse the workflow off the main thread and remember which nodes are samplers.
 * Later images with the same file stamp skip the parse.
 */
export function samplerIdsForWorkflow(
  stat: PromptProfileStat,
): Promise<Set<string>> {
  const token = profileToken(stat);
  if (samplerCache?.token === token) return Promise.resolve(samplerCache.ids);
  if (samplerInflight?.token === token) return samplerInflight.promise;
  const promise = callWorker({ op: 'load', ...stat }).then((msg) => {
    const ids = new Set(msg.samplerIds ?? []);
    samplerCache = { token, ids };
    return ids;
  });
  samplerInflight = { token, promise };
  void promise.finally(() => {
    if (samplerInflight?.promise === promise) samplerInflight = null;
  });
  return promise;
}

/** Clone, bind, and POST the prompt on the worker. The UI workflow stays there. */
export async function postGenerationPrompt(input: {
  stat: PromptProfileStat;
  url: string;
  headers: Record<string, string>;
  clientId: string;
  seed: number;
  values: GenerationValues;
}): Promise<{ promptId: string; number?: number }> {
  const msg = await callWorker({
    op: 'post',
    ...input.stat,
    url: input.url,
    headers: input.headers,
    clientId: input.clientId,
    seed: input.seed,
    values: input.values,
  });
  if (!msg.promptId) throw new Error('ComfyUI did not return a prompt id');
  return { promptId: msg.promptId, number: msg.number };
}

export function disposePromptPostWorker(): void {
  samplerCache = null;
  samplerInflight = null;
  failAll(new Error('Prompt worker disposed'));
  disposeWorker();
}
