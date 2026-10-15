import {
  BrowserWindow,
  Menu,
  screen,
  shell,
  type Rectangle,
} from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getHfWindowState,
  setHfWindowState,
  type WindowState,
} from './settingsStore.js';
import { resolveAppIconPath } from './appIcon.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 820;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 560;

let hfWindow: BrowserWindow | null = null;
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

function persistHfWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const normalBounds = win.getNormalBounds();
  setHfWindowState({
    ...normalBounds,
    maximized,
  });
}

function loadHfUrl(win: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const base = process.env.ELECTRON_RENDERER_URL.replace(/\/$/, '');
    void win.loadURL(`${base}/#huggingface`);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: 'huggingface',
    });
  }
}

export function getHuggingFaceBrowserWindow(): BrowserWindow | null {
  if (hfWindow && !hfWindow.isDestroyed()) return hfWindow;
  hfWindow = null;
  return null;
}

export function closeHuggingFaceBrowserWindow(): void {
  const win = getHuggingFaceBrowserWindow();
  if (!win) return;
  win.close();
}

export function openHuggingFaceBrowserWindow(): BrowserWindow {
  const existing = getHuggingFaceBrowserWindow();
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return existing;
  }

  const savedState = getHfWindowState();
  const bounds = restorableBounds(savedState);
  maximized = savedState?.maximized ?? false;

  const icon = resolveAppIconPath();
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'Hugging Face — Wildcards Manager',
    backgroundColor: '#0f1218',
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hfWindow = win;

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
    persistHfWindowState(win);
  });
  win.on('closed', () => {
    if (hfWindow === win) hfWindow = null;
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

  loadHfUrl(win);
  return win;
}

/** Always open as a detached window (HF is window-first). */
export function openHuggingFaceBrowser(): { mode: 'window' } {
  openHuggingFaceBrowserWindow();
  return { mode: 'window' };
}
