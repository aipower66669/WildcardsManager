import {
  app,
  BrowserWindow,
  Menu,
  screen,
  shell,
  type Rectangle,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Must be before ready — large catalog / preview work needs headroom.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');

/**
 * Soft-render Chromium when the discrete GPU is busy (Comfy / A1111 / etc.).
 * Must run before `app.whenReady()`. Default ON when the setting is unset so
 * shared-GPU setups stay responsive; turn off in Settings if you prefer GPU UI.
 */
function applyHardwareAccelerationPreference(): void {
  let disable = true;
  try {
    const file = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        disableHardwareAcceleration?: unknown;
      };
      if (typeof raw.disableHardwareAcceleration === 'boolean') {
        disable = raw.disableHardwareAcceleration;
      }
    }
  } catch {
    // keep default
  }
  if (disable) {
    app.disableHardwareAcceleration();
  }
}
applyHardwareAccelerationPreference();

import { resolveAppIconPath } from './appIcon.js';
import { registerIpc } from './ipc.js';
import { startMainStallWatchdog } from './mainStallWatchdog.js';
import {
  closeCivitaiBrowserWindow,
  getCivitaiBrowserWindow,
} from './civitaiWindow.js';
import {
  registerPreviewProtocolHandler,
  registerPreviewScheme,
} from './civitaiPreviewCache.js';
import {
  flushModelDownloadQueuePersist,
  hasPendingModelDownloads,
  restorePersistedModelDownloadQueue,
} from './civitaiModelDownloadQueue.js';
import {
  enterBackgroundDownloads,
  handleMainWindowCloseEvent,
  isBackgroundDownloadsActive,
  isForceQuitRequested,
  leaveBackgroundDownloads,
  setOpenMainWindowHandler,
} from './backgroundDownloads.js';
import {
  registerGenerationPreviewProtocolHandler,
  registerGenerationPreviewScheme,
} from './comfy/generationPreview.js';
import {
  registerPromptMediaProtocolHandler,
  registerPromptMediaScheme,
} from './promptsService.js';
import {
  flushSettingsSync,
  loadSettings,
  migrateArchiveToMaybe,
  setWindowState,
  type WindowState,
} from './settingsStore.js';
import { flushAutoV2IndexSync } from './civitaiCatalogCache.js';
import { flushHashCachePersist } from './modelHashCache.js';
import { migrateModelHashesToAds } from './modelHashAdsMigration.js';
import { disposeAnalyzeWorker } from './analyzeWorkerClient.js';
import { disposeHistoryBriefWorker } from './comfy/historyBriefWorkerClient.js';
import { disposeModelFolderWalkWorker } from './modelFolderWalkWorkerClient.js';
import { disposeModelHashWorker } from './modelHashWorkerClient.js';
import { disposePreviewDownscaleChild } from './previewDownscaleClient.js';
import {
  bindActiveLibraryDataRoots,
  migrateWildcardsSidecarsForAllLibraries,
  runLibraryDataMigration,
} from './libraryDataMigration.js';
import { migrateDownloadedCivitaiImagesRegistry, flushDownloadedImagesRegistrySync } from './civitaiImageDownload.js';
import { flushImageFeedFrontiersSync } from './civitaiImageFeedFrontier.js';
import { isCivitaiImageDownloadAllActive } from './civitaiImageDownloadAll.js';
import { migrateDownloadedCivitaiVideosRegistry, flushDownloadedVideosRegistrySync } from './civitaiVideoDownload.js';
import { flushVideoFeedFrontiersSync } from './civitaiVideoFeedFrontier.js';
import { isCivitaiVideoDownloadAllActive } from './civitaiVideoDownloadAll.js';
import { folderWatcher } from './watcher.js';

registerPreviewScheme();
registerPromptMediaScheme();
registerGenerationPreviewScheme();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 920;
const MIN_WIDTH = 960;
const MIN_HEIGHT = 640;

let mainWindow: BrowserWindow | null = null;

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

  // If the remembered monitor is disconnected, let Electron center the window
  // on the current primary display while retaining its useful size.
  return isVisible
    ? bounds
    : { width: bounds.width, height: bounds.height };
}

function buildAppMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Close UI & keep downloading',
          accelerator: isMac ? 'Cmd+Shift+W' : 'Ctrl+Shift+W',
          click: () => {
            if (
              !hasPendingModelDownloads() &&
              !isCivitaiImageDownloadAllActive() &&
              !isCivitaiVideoDownloadAllActive()
            ) {
              // No queue — just close normally via quit path.
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.close();
              }
              return;
            }
            if (!enterBackgroundDownloads()) {
              // ignore
            }
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  const savedState = loadSettings().windowState;
  const bounds = restorableBounds(savedState);
  const icon = resolveAppIconPath();
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'Wildcards Manager',
    backgroundColor: '#0f1218',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  mainWindow = win;

  let maximized = savedState?.maximized ?? false;
  if (maximized) win.maximize();
  win.on('maximize', () => {
    maximized = true;
  });
  win.on('unmaximize', () => {
    maximized = false;
  });
  win.on('close', (event) => {
    if (win.isDestroyed()) return;
    const normalBounds = win.getNormalBounds();
    setWindowState({
      ...normalBounds,
      maximized,
    });

    // Closing the main app must tear down the detached Civitai window
    // (unless we are only entering tray background mode).
    if (!isBackgroundDownloadsActive()) {
      const civitai = getCivitaiBrowserWindow();
      if (civitai && !civitai.isDestroyed()) {
        closeCivitaiBrowserWindow();
      }
    }

    if (isForceQuitRequested() || isBackgroundDownloadsActive()) {
      return;
    }
    if (
      hasPendingModelDownloads() ||
      isCivitaiImageDownloadAllActive() ||
      isCivitaiVideoDownloadAllActive()
    ) {
      // preventDefault must be synchronous; dialog is async.
      event.preventDefault();
      if (hasPendingModelDownloads()) {
        void handleMainWindowCloseEvent(event, win);
      } else {
        // Image/Video Download all only — keep main process alive (hide UI).
        win.hide();
      }
    }
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    folderWatcher.stop();
    // Stay alive in tray background mode so the queue can finish overnight.
    if (isBackgroundDownloadsActive()) return;
    if (isCivitaiImageDownloadAllActive()) return;
    if (isCivitaiVideoDownloadAllActive()) return;
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Electron has no default context menu. Offer a native edit menu for
  // ordinary inputs; CodeMirror uses its own renderer menu instead
  // (contenteditable + drawn selections confuse Chromium's editFlags).
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

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  // Windows taskbar / notifications: match electron-builder appId so the
  // custom icon groups correctly instead of the generic Electron one.
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.wildcardsmanager.app');
  }
  // Move wildcards !.wcm/!Cache to sibling .wcm before any settings hydrate/flush
  // can write an empty sibling library.json over legacy data.
  try {
    migrateWildcardsSidecarsForAllLibraries();
  } catch (err) {
    console.error('[wildcards-sidecar-migration]', err);
  }
  migrateArchiveToMaybe();
  try {
    runLibraryDataMigration();
  } catch (err) {
    console.error('[library-data-migration]', err);
    bindActiveLibraryDataRoots();
  }
  try {
    migrateDownloadedCivitaiImagesRegistry();
  } catch (err) {
    console.error('[downloaded-images-registry-migration]', err);
  }
  try {
    migrateDownloadedCivitaiVideosRegistry();
  } catch (err) {
    console.error('[downloaded-videos-registry-migration]', err);
  }
  registerPreviewProtocolHandler();
  registerPromptMediaProtocolHandler();
  registerGenerationPreviewProtocolHandler();
  registerIpc();
  startMainStallWatchdog();
  buildAppMenu();
  setOpenMainWindowHandler(() => {
    createWindow();
  });
  createWindow();
  // After the window exists — never block first paint on a LoRA-tree walk.
  setImmediate(() => {
    try {
      const ads = migrateModelHashesToAds();
      if (ads.written > 0 || ads.clearedEntries > 0) {
        console.info(
          `[hash-ads-migration] written=${ads.written} rematchedBasename=${ads.rematchedByBasename} skipped=${ads.skippedExisting} missing=${ads.missingFiles} failed=${ads.failedWrites} clearedJson=${ads.clearedEntries}`,
        );
      }
    } catch (err) {
      console.error('[hash-ads-migration]', err);
    }
  });
  // Resume unfinished model downloads after the window exists so progress
  // events can reach the renderer. Leftover `.partial` files are deleted and
  // those transfers restart from scratch.
  try {
    restorePersistedModelDownloadQueue();
  } catch {
    // ignore
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (isBackgroundDownloadsActive()) {
        leaveBackgroundDownloads();
      } else {
        createWindow();
      }
    }
  });
});

app.on('before-quit', () => {
  flushModelDownloadQueuePersist();
  flushAutoV2IndexSync();
  flushSettingsSync();
  flushHashCachePersist();
  flushDownloadedImagesRegistrySync();
  flushDownloadedVideosRegistrySync();
  flushImageFeedFrontiersSync();
  flushVideoFeedFrontiersSync();
  disposeModelHashWorker();
  disposeAnalyzeWorker();
  disposeHistoryBriefWorker();
  disposeModelFolderWalkWorker();
  disposePreviewDownscaleChild();
});

app.on('window-all-closed', () => {
  folderWatcher.stop();
  flushModelDownloadQueuePersist();
  flushSettingsSync();
  flushDownloadedImagesRegistrySync();
  flushDownloadedVideosRegistrySync();
  flushImageFeedFrontiersSync();
  flushVideoFeedFrontiersSync();
  // Tray-only overnight downloads: do not quit while background mode is on.
  if (isBackgroundDownloadsActive()) return;
  if (isCivitaiImageDownloadAllActive()) return;
  if (isCivitaiVideoDownloadAllActive()) return;
  if (process.platform !== 'darwin') app.quit();
});
