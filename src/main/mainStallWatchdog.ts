/**
 * Detect Electron main-thread stalls. A blocked event loop freezes every
 * window (clicks, IPC, animations) with no UI explanation.
 */

import { setMainActivityJob } from './mainActivity.js';

const TICK_MS = 50;
const STALL_MS = 80;

let started = false;
let lastTick = 0;

export function startMainStallWatchdog(): void {
  if (started) return;
  started = true;
  lastTick = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    if (gap >= STALL_MS + TICK_MS) {
      const stalled = gap - TICK_MS;
      console.warn(`[main] event loop stalled ${stalled}ms`);
    }
  }, TICK_MS);
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
}

/** Run CPU/disk work with a status label; log if it blocks the loop. */
export function noteBlockingWork<T>(label: string, fn: () => T): T {
  setMainActivityJob('blocking', label);
  const t0 = Date.now();
  try {
    return fn();
  } finally {
    const ms = Date.now() - t0;
    setMainActivityJob('blocking', null);
    if (ms >= STALL_MS) {
      console.warn(`[main] ${label} blocked ${ms}ms`);
    }
  }
}
