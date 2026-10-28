import fs from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { BrowserWindow } from 'electron';
import { IPC } from '../shared/contracts.js';
import { libraryService } from './libraryService.js';
import { isGenerationActive, onGenerationIdle } from './generationActivity.js';

let watcher: FSWatcher | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let suppressUntil = 0;
const pendingPaths = new Set<string>();
let pendingUnknown = false;

function isLibraryContentEvent(relativePath: string): boolean {
  const base = relativePath.split('/').pop() ?? relativePath;
  if (!base || base === '.' || base === '..') return false;
  if (base.startsWith('!')) return false;
  if (/\.(png|jpe?g|webp|gif|bmp|avif|safetensors|ckpt|pt|bin|tmp)$/i.test(base)) {
    return false;
  }
  return true;
}

function broadcast(): void {
  if (isGenerationActive()) return;
  if (pendingUnknown) {
    libraryService.invalidateContentCache();
  } else {
    for (const rel of pendingPaths) {
      libraryService.invalidateContentPath(rel);
    }
  }
  pendingPaths.clear();
  pendingUnknown = false;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.watchChanged);
  }
}

function schedule(filename: string | Buffer | null | undefined): void {
  if (Date.now() < suppressUntil) return;
  if (typeof filename === 'string' && filename.trim()) {
    const rel = filename.replace(/\\/g, '/');
    // Images and weights saved under the library are not wildcard text.
    // Invalidating the whole tree for each of those writes froze generation.
    if (!isLibraryContentEvent(rel)) return;
    pendingPaths.add(rel);
  } else {
    pendingUnknown = true;
  }
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => broadcast(), 250);
}

export const folderWatcher = {
  start(root: string): void {
    this.stop();
    try {
      watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        schedule(filename);
      });
      watcher.on('error', () => {
        // Ignore watcher errors (e.g. root deleted); UI can reopen.
      });
    } catch {
      // recursive watch unsupported on some platforms — fall back non-recursive
      try {
        watcher = fs.watch(root, (_event, filename) => {
          schedule(filename);
        });
      } catch {
        // no-op
      }
    }
  },

  stop(): void {
    if (debounce) {
      clearTimeout(debounce);
      debounce = null;
    }
    pendingPaths.clear();
    pendingUnknown = false;
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
      watcher = null;
    }
  },

  /** Ignore filesystem notifications caused by an internal atomic save. */
  suppressChanges(durationMs = 2500): void {
    suppressUntil = Math.max(suppressUntil, Date.now() + durationMs);
  },
};

onGenerationIdle(() => {
  if (pendingPaths.size === 0 && !pendingUnknown) return;
  broadcast();
});
