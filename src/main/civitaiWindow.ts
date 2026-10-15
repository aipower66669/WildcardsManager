import {
  BrowserWindow,
  Menu,
  screen,
  shell,
  type Rectangle,
} from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC } from '../shared/contracts.js';
import {
  getCivitaiWindowState,
  isCivitaiBrowserDetached,
  setCivitaiBrowserDetached,
  setCivitaiWindowState,
  type WindowState,
} from './settingsStore.js';
import { resolveAppIconPath } from './appIcon.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 820;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 560;

let civitaiWindow: BrowserWindow | null = null;
let maximized = false;

function intersectionSize(a: Rectangle, b: Rectangle): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(
      0,
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    ),
    height: Math.max(
      0,
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
    ),
  };
}

function restorableBounds(state?: WindowState): Partial<Rectangle> {
  if (!state) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };

  const bounds = {
    x: state.x,
    y: state.y,
    width: Math.max(MIN_WIDTH, state.width),
    height: Math.max(MIN_HEIGHT, state.height),
  };
  const titleBar = { ...bounds, height: Math.min(40, bounds.height) };
  const isVisible = screen.getAllDisplays().some((display) => {
    const overlap = intersectionSize(titleBar, display.workArea);
    return overlap.width >= 100 && overlap.height >= 24;
  });

  return isVisible
    ? bounds
    : { width: bounds.width, height: bounds.height };
}

function persistCivitaiWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const normalBounds = win.getNormalBounds();
  setCivitaiWindowState({
    ...normalBounds,
    maximized,
  });
}

function notifyMainWindows(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (civitaiWindow && win.id === civitaiWindow.id) continue;
    win.webContents.send(channel, payload);
  }
}

/** Focus the main app window and ask it to select a local model file. */
export function revealLocalFileInMainApp(payload: {
  type: 'LORA' | 'Checkpoint';
  relativePath: string;
}): void {
  notifyMainWindows(IPC.civitaiRevealLocalFile, payload);
  for (const win of BrowserWindow.getAllWindows()) {
    if (civitaiWindow && win.id === civitaiWindow.id) continue;
    if (win.isMinimized()) win.restore();
    win.focus();
    break;
  }
}

function loadCivitaiUrl(win: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const base = process.env.ELECTRON_RENDERER_URL.replace(/\/$/, '');
    void win.loadURL(`${base}/#civitai`);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: 'civitai',
    });
  }
}

export function getCivitaiBrowserWindow(): BrowserWindow | null {
  if (civitaiWindow && !civitaiWindow.isDestroyed()) return civitaiWindow;
  civitaiWindow = null;
  return null;
}

export function closeCivitaiBrowserWindow(): void {
  const win = getCivitaiBrowserWindow();
  if (!win) return;
  win.close();
}

export function openCivitaiBrowserWindow(): BrowserWindow {
  const existing = getCivitaiBrowserWindow();
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return existing;
  }

  const savedState = getCivitaiWindowState();
  const bounds = restorableBounds(savedState);
  maximized = savedState?.maximized ?? false;

  const icon = resolveAppIconPath();
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'Civitai browser — Wildcards Manager',
    backgroundColor: '#0f1218',
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  civitaiWindow = win;

  if (maximized) win.maximize();
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });

  win.on('maximize', () => {
    maximized = true;
  });
  win.on('unmaximize', () => {
    maximized = false;
  });
  win.on('close', () => {
    persistCivitaiWindowState(win);
  });
  win.on('closed', () => {
    if (civitaiWindow === win) civitaiWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('context-menu', (_event, params) => {
    const isPlainField =
      params.isEditable &&
      (params.formControlType === 'text-area' ||
        params.formControlType.startsWith('input-'));
    if (!isPlainField) return;

    const { editFlags } = params;
    Menu.buildFromTemplate([
      { role: 'cut', enabled: editFlags.canCut },
      { role: 'copy', enabled: editFlags.canCopy },
      { role: 'paste', enabled: editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: editFlags.canSelectAll },
    ]).popup({
      window: win,
      frame: params.frame ?? undefined,
    });
  });

  loadCivitaiUrl(win);
  return win;
}

/** Open according to the remembered attach/detach preference. */
export function openCivitaiBrowser(): { mode: 'modal' | 'window' } {
  if (isCivitaiBrowserDetached()) {
    openCivitaiBrowserWindow();
    return { mode: 'window' };
  }
  return { mode: 'modal' };
}

export type CivitaiFocusModelPayload = {
  modelId: number;
  pageUrl: string;
  name?: string;
};

/**
 * Open the preferred Civitai UI and ask it to show a specific model.
 * Detached window receives an IPC event; modal mode is handled by the main renderer.
 */
export function focusModelInCivitaiBrowser(
  payload: CivitaiFocusModelPayload,
): { mode: 'modal' | 'window' } {
  if (isCivitaiBrowserDetached()) {
    const win = openCivitaiBrowserWindow();
    const send = () => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.civitaiFocusModel, payload);
      }
    };
    if (win.webContents.isLoadingMainFrame()) {
      win.webContents.once('did-finish-load', send);
    } else {
      send();
    }
    if (!win.isDestroyed()) win.focus();
    return { mode: 'window' };
  }
  return { mode: 'modal' };
}

/** Switch from modal → detached window and remember the preference. */
export function detachCivitaiBrowser(): { mode: 'window' } {
  setCivitaiBrowserDetached(true);
  openCivitaiBrowserWindow();
  return { mode: 'window' };
}

/**
 * Switch from detached window → modal in the main app and remember.
 * Closes the Civitai window after notifying main windows.
 */
export function attachCivitaiBrowser(): { mode: 'modal' } {
  setCivitaiBrowserDetached(false);
  notifyMainWindows(IPC.civitaiOpenAttached);
  const win = getCivitaiBrowserWindow();
  if (win) {
    persistCivitaiWindowState(win);
    // Avoid re-entrancy issues: destroy after notifying.
    win.destroy();
    civitaiWindow = null;
  }
  return { mode: 'modal' };
}
