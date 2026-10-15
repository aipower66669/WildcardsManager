import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  nativeImage,
  type NativeImage,
} from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  onDownloadProgressBroadcast,
  type CivitaiDownloadProgress,
} from './civitaiDownload.js';
import {
  getModelDownloadQueueSnapshot,
  hasPendingModelDownloads,
  pauseModelDownloadQueue,
  resumeModelDownloadQueue,
} from './civitaiModelDownloadQueue.js';
import { closeCivitaiBrowserWindow } from './civitaiWindow.js';
import { closeHuggingFaceBrowserWindow } from './huggingfaceWindow.js';

/**
 * Background overnight downloads: close all UI windows (free VRAM) while the
 * Electron main process keeps draining the model download queue via a tray icon.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let backgroundDownloadsActive = false;
/** User chose Quit from the close dialog or tray — allow windows to close fully. */
let forceQuit = false;
let tray: Tray | null = null;
let lastProgressLabel = 'Wildcards Manager — downloads';
let unsubProgress: (() => void) | null = null;
/** Set by index.ts so tray "Open" can recreate the main window. */
let openMainWindow: (() => void) | null = null;
/** Prevents re-entrant close prompts. */
let closePromptOpen = false;

export function isBackgroundDownloadsActive(): boolean {
  return backgroundDownloadsActive;
}

export function isForceQuitRequested(): boolean {
  return forceQuit;
}

export function setOpenMainWindowHandler(handler: () => void): void {
  openMainWindow = handler;
}

function trayIcon(): NativeImage {
  const candidates = [
    path.join(process.resourcesPath, 'tray-icon.png'),
    path.join(__dirname, '../../resources/tray-icon.png'),
    path.join(app.getAppPath(), 'resources/tray-icon.png'),
    path.join(process.resourcesPath, 'icon.png'),
    path.join(__dirname, '../../resources/icon.png'),
  ];
  for (const file of candidates) {
    try {
      const image = nativeImage.createFromPath(file);
      if (!image.isEmpty()) {
        // Tray icons should stay small on Windows.
        if (process.platform === 'win32' && image.getSize().width > 32) {
          return image.resize({ width: 16, height: 16 });
        }
        return image;
      }
    } catch {
      // try next
    }
  }
  return nativeImage.createEmpty();
}

function formatProgressTooltip(p: CivitaiDownloadProgress): string {
  const name =
    p.activeModelName?.trim() ||
    p.modelName?.trim() ||
    (p.activeModelId != null ? `Model ${p.activeModelId}` : null);
  const queued = p.queuedCount ?? 0;
  if (p.paused) {
    return `Paused${name ? ` — ${name}` : ''}${queued > 0 ? ` · ${queued} waiting` : ''}`;
  }
  if (!name && queued === 0 && !p.activeModelId) {
    return 'Wildcards Manager — download queue idle';
  }
  let pct = '';
  if (
    typeof p.receivedBytes === 'number' &&
    typeof p.totalBytes === 'number' &&
    p.totalBytes > 0
  ) {
    pct = ` · ${Math.min(100, Math.round((p.receivedBytes / p.totalBytes) * 100))}%`;
  } else if (p.statusMessage) {
    pct = ` · ${p.statusMessage}`;
  }
  const wait = queued > 0 ? ` · ${queued} waiting` : '';
  return `${name ?? 'Downloading'}${pct}${wait}`;
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const snap = getModelDownloadQueueSnapshot();
  const paused = snap.paused;
  const hasJobs = Boolean(snap.active) || snap.queuedCount > 0;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: lastProgressLabel.slice(0, 120),
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Open Wildcards Manager',
        click: () => {
          leaveBackgroundDownloads();
        },
      },
      {
        label: paused ? 'Resume downloads' : 'Pause downloads',
        enabled: hasJobs || paused,
        click: () => {
          if (paused) {
            resumeModelDownloadQueue();
            lastProgressLabel = 'Resuming downloads…';
          } else {
            pauseModelDownloadQueue('Paused from tray');
            lastProgressLabel = 'Paused — downloads';
          }
          tray?.setToolTip(lastProgressLabel);
          rebuildTrayMenu();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit (stop downloads)',
        click: () => {
          quitFromBackground();
        },
      },
    ]),
  );
}

function ensureTray(): void {
  if (tray) {
    rebuildTrayMenu();
    return;
  }
  tray = new Tray(trayIcon());
  tray.setToolTip(lastProgressLabel);
  tray.on('double-click', () => {
    leaveBackgroundDownloads();
  });
  rebuildTrayMenu();
  if (!unsubProgress) {
    unsubProgress = onDownloadProgressBroadcast((p) => {
      if (!backgroundDownloadsActive) return;
      lastProgressLabel = formatProgressTooltip(p);
      tray?.setToolTip(lastProgressLabel);
      // Only rebuild on milestones — lean status/byte ticks always carry phase.
      if (p.done || p.error || p.paused || p.phase === 'queued') {
        rebuildTrayMenu();
      }
    });
  }
}

function destroyTray(): void {
  if (unsubProgress) {
    unsubProgress();
    unsubProgress = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

/**
 * Close all windows, show tray, keep downloading.
 * Returns false if there is nothing to download.
 */
export function enterBackgroundDownloads(): boolean {
  if (!hasPendingModelDownloads()) {
    return false;
  }
  backgroundDownloadsActive = true;
  forceQuit = false;
  const snap = getModelDownloadQueueSnapshot();
  lastProgressLabel = snap.paused
    ? `Paused${snap.activeModelName ? ` — ${snap.activeModelName}` : ''}`
    : snap.activeModelName
      ? `Downloading ${snap.activeModelName}`
      : `Queue · ${snap.queuedCount} waiting`;
  ensureTray();
  tray?.setToolTip(lastProgressLabel);
  rebuildTrayMenu();

  closeCivitaiBrowserWindow();
  closeHuggingFaceBrowserWindow();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.close();
  }
  return true;
}

/** Recreate the main UI and leave tray-only mode. */
export function leaveBackgroundDownloads(): void {
  backgroundDownloadsActive = false;
  destroyTray();
  if (BrowserWindow.getAllWindows().length === 0) {
    openMainWindow?.();
  } else {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  }
}

function quitFromBackground(): void {
  backgroundDownloadsActive = false;
  forceQuit = true;
  destroyTray();
  app.quit();
}

/** Quit for in-app update / explicit full exit (ignores tray background mode). */
export function quitAppFully(): void {
  quitFromBackground();
}

/**
 * Prompt after main-window close was already preventDefault'd because the
 * download queue is non-empty.
 */
export async function handleMainWindowCloseEvent(
  _event: { preventDefault: () => void },
  win: BrowserWindow,
): Promise<void> {
  if (forceQuit || backgroundDownloadsActive) {
    return;
  }
  if (!hasPendingModelDownloads()) return;
  if (closePromptOpen) return;

  closePromptOpen = true;
  try {
    const snap = getModelDownloadQueueSnapshot();
    const count = (snap.active ? 1 : 0) + snap.queuedCount;
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: [
        'Keep downloading (close UI)',
        'Quit and stop downloads',
        'Cancel',
      ],
      defaultId: 0,
      cancelId: 2,
      title: 'Downloads in progress',
      message: `${count} download${count === 1 ? '' : 's'} still in the queue.`,
      detail:
        'Closing the UI frees VRAM for training while downloads continue in the system tray. Quitting stops transfers (large files restart from the beginning next launch).',
      noLink: true,
    });
    if (response === 0) {
      enterBackgroundDownloads();
      return;
    }
    if (response === 1) {
      forceQuit = true;
      app.quit();
    }
  } finally {
    closePromptOpen = false;
  }
}
