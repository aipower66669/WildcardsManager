import { BrowserWindow } from 'electron';
import { IPC } from '../shared/contracts.js';

const jobs = new Map<string, string>();
let lastSent: string | null = null;
let lastSentAt = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const MIN_INTERVAL_MS = 200;

function compose(): string | null {
  if (jobs.size === 0) return null;
  return [...jobs.values()].join(' · ');
}

function send(label: string | null): void {
  lastSent = label;
  lastSentAt = Date.now();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(IPC.uiMainActivity, { label });
  }
}

function broadcast(force: boolean): void {
  const label = compose();
  const now = Date.now();
  if (force || now - lastSentAt >= MIN_INTERVAL_MS) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (force || label !== lastSent) send(label);
    return;
  }
  if (label === lastSent || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    send(compose());
  }, MIN_INTERVAL_MS - (now - lastSentAt));
}

/** Announce or clear a named main-process job. `null` removes that job. */
export function setMainActivityJob(id: string, label: string | null): void {
  if (label) jobs.set(id, label);
  else jobs.delete(id);
  broadcast(label === null || jobs.size === 0);
}
