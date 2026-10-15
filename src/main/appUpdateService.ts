import { app, dialog, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { compareSemver } from '../domain/appSemver.js';
import { quitAppFully } from './backgroundDownloads.js';
import {
  getUpdateReleaseFolder,
  setUpdateReleaseFolder,
} from './settingsStore.js';

export type AppUpdateCheckResult = {
  currentVersion: string;
  releaseFolder: string | null;
  available: boolean;
  latestVersion: string | null;
  installerPath: string | null;
  installerFileName: string | null;
  message: string;
};

const INSTALLER_RE =
  /^WildcardsManager-(\d+\.\d+\.\d+)(?:-[^.]+)*\.(?:exe|dmg|AppImage)$/i;

export { compareSemver };

function readLatestYml(
  folder: string,
): { version: string; fileName: string } | null {
  const file = path.join(folder, 'latest.yml');
  if (!fs.existsSync(file)) return null;
  try {
    const text = fs.readFileSync(file, 'utf8');
    const versionMatch = text.match(/^\s*version:\s*['"]?([^\s'"]+)/m);
    const pathMatch = text.match(/^\s*path:\s*['"]?([^\s'"]+)/m);
    const version = versionMatch?.[1]?.trim();
    const fileName = pathMatch?.[1]?.trim();
    if (!version || !fileName) return null;
    return { version, fileName };
  } catch {
    return null;
  }
}

function scanInstallers(
  folder: string,
): Array<{ version: string; absolutePath: string; fileName: string }> {
  let names: string[] = [];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return [];
  }
  const out: Array<{ version: string; absolutePath: string; fileName: string }> =
    [];
  for (const name of names) {
    const m = name.match(INSTALLER_RE);
    if (!m?.[1]) continue;
    const absolutePath = path.join(folder, name);
    try {
      if (!fs.statSync(absolutePath).isFile()) continue;
    } catch {
      continue;
    }
    out.push({ version: m[1], absolutePath, fileName: name });
  }
  out.sort((a, b) => compareSemver(b.version, a.version));
  return out;
}

function resolveLatestInstaller(folder: string): {
  version: string;
  absolutePath: string;
  fileName: string;
} | null {
  const fromYml = readLatestYml(folder);
  if (fromYml) {
    const absolutePath = path.join(folder, fromYml.fileName);
    if (fs.existsSync(absolutePath)) {
      return {
        version: fromYml.version,
        absolutePath,
        fileName: fromYml.fileName,
      };
    }
  }
  return scanInstallers(folder)[0] ?? null;
}

export function checkForAppUpdate(
  releaseFolder?: string | null,
): AppUpdateCheckResult {
  const currentVersion = app.getVersion();
  const folder =
    (releaseFolder?.trim()
      ? path.resolve(releaseFolder.trim())
      : getUpdateReleaseFolder()) ?? null;

  if (!folder) {
    return {
      currentVersion,
      releaseFolder: null,
      available: false,
      latestVersion: null,
      installerPath: null,
      installerFileName: null,
      message:
        'Set an update folder in Settings (point it at your electron-builder release folder).',
    };
  }

  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return {
      currentVersion,
      releaseFolder: folder,
      available: false,
      latestVersion: null,
      installerPath: null,
      installerFileName: null,
      message: `Update folder is missing or not a directory:\n${folder}`,
    };
  }

  const latest = resolveLatestInstaller(folder);
  if (!latest) {
    return {
      currentVersion,
      releaseFolder: folder,
      available: false,
      latestVersion: null,
      installerPath: null,
      installerFileName: null,
      message:
        'No installer found. Expected WildcardsManager-<version>-win-x64.exe (or latest.yml) in that folder.',
    };
  }

  const newer = compareSemver(latest.version, currentVersion) > 0;
  if (!newer) {
    return {
      currentVersion,
      releaseFolder: folder,
      available: false,
      latestVersion: latest.version,
      installerPath: latest.absolutePath,
      installerFileName: latest.fileName,
      message:
        compareSemver(latest.version, currentVersion) === 0
          ? `You are on the latest version (${currentVersion}).`
          : `Folder has ${latest.version}, which is older than the running app (${currentVersion}).`,
    };
  }

  return {
    currentVersion,
    releaseFolder: folder,
    available: true,
    latestVersion: latest.version,
    installerPath: latest.absolutePath,
    installerFileName: latest.fileName,
    message: `Update available: ${currentVersion} → ${latest.version}`,
  };
}

/**
 * Launch the newest installer from the update folder, then quit this app so
 * NSIS can replace files. The installer UI includes its own “Run” checkbox.
 */
export async function installAppUpdate(opts?: {
  /** Skip the confirm dialog (tests / automation). */
  skipConfirm?: boolean;
}): Promise<AppUpdateCheckResult> {
  const check = checkForAppUpdate();
  if (!check.available || !check.installerPath) {
    return check;
  }

  if (!opts?.skipConfirm) {
    const win = BrowserWindow.getFocusedWindow();
    const { response } = await dialog.showMessageBox(win ?? undefined!, {
      type: 'question',
      buttons: ['Install and restart', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Install update',
      message: `Install Wildcards Manager ${check.latestVersion}?`,
      detail:
        'This app will close and the installer will open. Leave “Run Wildcards Manager” checked at the end of the installer to relaunch.',
      noLink: true,
    });
    if (response !== 0) {
      return {
        ...check,
        message: 'Update cancelled.',
      };
    }
  }

  const installerPath = check.installerPath;
  try {
    const child = spawn(installerPath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not launch installer: ${message}`);
  }

  // Let the installer process detach before we tear down Electron.
  setTimeout(() => {
    quitAppFully();
  }, 400);

  return {
    ...check,
    message: `Launching installer ${check.installerFileName}…`,
  };
}

export async function pickUpdateReleaseFolder(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow();
  const current = getUpdateReleaseFolder();
  const result = await dialog.showOpenDialog(win ?? undefined!, {
    title: 'Select update / release folder',
    properties: ['openDirectory'],
    defaultPath: current || undefined,
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const folder = result.filePaths[0] ?? null;
  if (!folder) return null;
  return setUpdateReleaseFolder(folder);
}
