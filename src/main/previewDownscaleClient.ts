import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PREVIEW_MAX_HEIGHT,
  PREVIEW_MAX_WIDTH,
} from '../shared/civitaiPreviewUrl.js';
import type {
  PreviewDownscaleRequest,
  PreviewDownscaleResponse,
} from './previewDownscaleCompute.js';
import { downscalePreviewCover } from './previewDownscaleCompute.js';

const JPEG_QUALITY = 82;

type Pending = {
  resolve: (jpeg: Buffer | null) => void;
  reject: (error: Error) => void;
};

let child: ChildProcess | null = null;
let childReady = false;
let nextId = 1;
const pending = new Map<number, Pending>();
const queue: number[] = [];
let inFlightId: number | null = null;
/** Buffers for queued/in-flight jobs (kept out of the Worker message until send). */
const payloads = new Map<number, Uint8Array>();

function processScriptPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'previewDownscaleProcess.js',
  );
}

function failAll(error: Error): void {
  const waiting = [...pending.values()];
  pending.clear();
  queue.length = 0;
  payloads.clear();
  inFlightId = null;
  for (const item of waiting) item.reject(error);
}

function disposeChild(): void {
  if (!child) return;
  const c = child;
  child = null;
  childReady = false;
  c.removeAllListeners();
  try {
    c.kill();
  } catch {
    // ignore
  }
}

function ensureChild(): ChildProcess {
  if (child && !child.killed) return child;
  childReady = false;
  // Fork Electron itself with this script as the app entry so nativeImage works.
  // (utilityProcess / ELECTRON_RUN_AS_NODE cannot use nativeImage.)
  const c = fork(process.execPath, [processScriptPath()], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: {
      ...process.env,
      ELECTRON_PREVIEW_DOWNSCALE: '1',
    },
  });
  child = c;
  c.on('message', (msg: PreviewDownscaleResponse) => {
    if (msg.id === -1) {
      childReady = true;
      pump();
      return;
    }
    const item = pending.get(msg.id);
    if (!item) {
      if (inFlightId === msg.id) inFlightId = null;
      pump();
      return;
    }
    pending.delete(msg.id);
    payloads.delete(msg.id);
    if (inFlightId === msg.id) inFlightId = null;
    item.resolve(msg.jpeg ? Buffer.from(msg.jpeg) : null);
    pump();
  });
  c.on('error', (err) => {
    disposeChild();
    failAll(err instanceof Error ? err : new Error(String(err)));
  });
  c.on('exit', () => {
    if (child !== c) return;
    child = null;
    childReady = false;
    if (inFlightId != null) {
      const item = pending.get(inFlightId);
      pending.delete(inFlightId);
      payloads.delete(inFlightId);
      item?.resolve(null);
      inFlightId = null;
    }
    if (pending.size > 0) {
      // Unexpected death — fall back on main for remaining jobs.
      const left = [...pending.entries()];
      pending.clear();
      queue.length = 0;
      for (const [id, item] of left) {
        const buf = payloads.get(id);
        payloads.delete(id);
        if (!buf) {
          item.resolve(null);
          continue;
        }
        item.resolve(
          downscalePreviewCover(
            buf,
            PREVIEW_MAX_WIDTH,
            PREVIEW_MAX_HEIGHT,
            JPEG_QUALITY,
          ),
        );
      }
    }
  });
  return c;
}

function pump(): void {
  if (inFlightId != null || !childReady) return;
  const id = queue.shift();
  if (id == null) return;
  const item = pending.get(id);
  const buffer = payloads.get(id);
  if (!item || !buffer) {
    pump();
    return;
  }
  inFlightId = id;
  const req: PreviewDownscaleRequest = {
    id,
    buffer,
    targetW: PREVIEW_MAX_WIDTH,
    targetH: PREVIEW_MAX_HEIGHT,
    quality: JPEG_QUALITY,
  };
  try {
    ensureChild().send?.(req);
  } catch (e) {
    pending.delete(id);
    payloads.delete(id);
    inFlightId = null;
    // Last resort: sync on main so previews still appear.
    item.resolve(
      downscalePreviewCover(
        buffer,
        PREVIEW_MAX_WIDTH,
        PREVIEW_MAX_HEIGHT,
        JPEG_QUALITY,
      ),
    );
    pump();
  }
}

/**
 * Cover-crop to catalog thumb size on a dedicated Electron child process.
 * Falls back to main-thread nativeImage if the child is unavailable.
 */
export function downscalePreviewOffMain(
  buffer: Buffer,
): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    try {
      ensureChild();
    } catch {
      resolve(
        downscalePreviewCover(
          buffer,
          PREVIEW_MAX_WIDTH,
          PREVIEW_MAX_HEIGHT,
          JPEG_QUALITY,
        ),
      );
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    payloads.set(id, new Uint8Array(buffer));
    queue.push(id);
    if (childReady) pump();
  });
}

export function disposePreviewDownscaleChild(): void {
  const waiting = [...pending.values()];
  pending.clear();
  queue.length = 0;
  payloads.clear();
  inFlightId = null;
  for (const item of waiting) item.resolve(null);
  disposeChild();
}
