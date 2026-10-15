import { BrowserWindow } from 'electron';
import { IPC, type DownloadLogEntryDto, type DownloadLogLevel } from '../shared/contracts.js';

const MAX_ENTRIES = 500;
let nextId = 1;
const entries: DownloadLogEntryDto[] = [];

function broadcast(entry: DownloadLogEntryDto): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.civitaiDownloadLog, entry);
  }
}

/** Format Error (and nested `cause`) for status bar / console. */
export function formatErrorDetail(error: unknown): string {
  if (error == null) return 'Unknown error';
  if (typeof error === 'string') return error.trim() || 'Unknown error';
  if (!(error instanceof Error)) return String(error);

  const parts: string[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current instanceof Error && depth < 4) {
    const msg = current.message.trim() || current.name || 'Error';
    if (!parts.includes(msg)) parts.push(msg);
    current = current.cause;
    depth += 1;
  }
  if (current != null && !(current instanceof Error)) {
    const extra = String(current).trim();
    if (extra && !parts.includes(extra)) parts.push(extra);
  }
  return parts.join(' — ') || 'Unknown error';
}

export function appendDownloadLog(
  level: DownloadLogLevel,
  message: string,
  opts?: {
    source?: string;
    modelId?: number;
    modelName?: string;
    detail?: string;
  },
): DownloadLogEntryDto {
  const entry: DownloadLogEntryDto = {
    id: nextId++,
    ts: Date.now(),
    level,
    message: message.trim() || '(empty)',
    source: opts?.source,
    modelId: opts?.modelId,
    modelName: opts?.modelName?.trim() || undefined,
    detail: opts?.detail?.trim() || undefined,
  };
  entries.push(entry);
  while (entries.length > MAX_ENTRIES) entries.shift();
  broadcast(entry);
  return entry;
}

export function listDownloadLog(): DownloadLogEntryDto[] {
  return [...entries];
}

export function clearDownloadLog(): void {
  entries.length = 0;
}

/** Log an error with cause unwrapped; returns the formatted message. */
export function logDownloadError(
  message: string,
  error?: unknown,
  opts?: {
    source?: string;
    modelId?: number;
    modelName?: string;
  },
): string {
  const detail = error !== undefined ? formatErrorDetail(error) : undefined;
  const full =
    detail && detail !== message.trim()
      ? `${message.trim()}: ${detail}`
      : message.trim() || detail || 'Error';
  appendDownloadLog('error', full, {
    ...opts,
    detail: detail && detail !== full ? detail : undefined,
  });
  return full;
}
