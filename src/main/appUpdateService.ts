import { app, dialog, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareSemver } from '../domain/appSemver.js';
import {
  GITHUB_LATEST_RELEASE_API,
  GITHUB_OWNER,
  GITHUB_REPO,
  INSTALLER_RE,
  githubReleaseApiUrl,
  githubReleaseNotesRawUrl,
  githubReleaseTagCandidates,
  isOfficialDownloadUrl,
  localReleaseNotesSearchDirs,
  pickGithubInstaller,
  type GithubInstallerAsset,
} from '../domain/githubAppUpdate.js';
import {
  IPC,
  type AppReleaseNotesDto,
  type AppUpdateCheckResultDto,
  type AppUpdateDownloadProgressDto,
} from '../shared/contracts.js';
import { quitAppFully } from './backgroundDownloads.js';
import {
  getUpdateReleaseFolder,
  setUpdateReleaseFolder,
} from './settingsStore.js';

export type AppUpdateCheckResult = AppUpdateCheckResultDto;

export { compareSemver };

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'WildcardsManager',
  'X-GitHub-Api-Version': '2022-11-28',
};

type GithubReleaseJson = {
  tag_name?: string;
  name?: string;
  body?: string | null;
  html_url?: string;
  assets?: GithubInstallerAsset[];
};

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
    const match = name.match(INSTALLER_RE);
    if (!match?.[1]) continue;
    const absolutePath = path.join(folder, name);
    try {
      if (!fs.statSync(absolutePath).isFile()) continue;
    } catch {
      continue;
    }
    out.push({ version: match[1], absolutePath, fileName: name });
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

function emptyCheck(
  currentVersion: string,
  sourceKind: AppUpdateCheckResult['sourceKind'],
  releaseFolder: string | null,
  message: string,
  extra?: Partial<AppUpdateCheckResult>,
): AppUpdateCheckResult {
  return {
    currentVersion,
    sourceKind,
    releaseFolder,
    available: false,
    latestVersion: null,
    installerPath: null,
    downloadUrl: null,
    installerFileName: null,
    message,
    ...extra,
  };
}

function checkFolder(
  currentVersion: string,
  folder: string,
): AppUpdateCheckResult {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return emptyCheck(
      currentVersion,
      'folder',
      folder,
      `Update folder is missing or not a directory:\n${folder}`,
    );
  }

  const latest = resolveLatestInstaller(folder);
  if (!latest) {
    return emptyCheck(
      currentVersion,
      'folder',
      folder,
      'No installer found. Expected WildcardsManager-<version>-win-x64.exe (or latest.yml) in that folder.',
    );
  }

  const newer = compareSemver(latest.version, currentVersion) > 0;
  if (!newer) {
    return emptyCheck(currentVersion, 'folder', folder, folderStatusMessage(latest.version, currentVersion), {
      latestVersion: latest.version,
      installerPath: latest.absolutePath,
      installerFileName: latest.fileName,
    });
  }

  return {
    currentVersion,
    sourceKind: 'folder',
    releaseFolder: folder,
    available: true,
    latestVersion: latest.version,
    installerPath: latest.absolutePath,
    downloadUrl: null,
    installerFileName: latest.fileName,
    message: `Update available: ${currentVersion} → ${latest.version}`,
  };
}

function folderStatusMessage(latestVersion: string, currentVersion: string): string {
  return compareSemver(latestVersion, currentVersion) === 0
    ? `You are on the latest version (${currentVersion}).`
    : `Folder has ${latestVersion}, which is older than the running app (${currentVersion}).`;
}

async function fetchGithubJson(url: string): Promise<GithubReleaseJson> {
  let res: Response;
  try {
    res = await fetch(url, { headers: GITHUB_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach GitHub: ${message}`);
  }
  if (res.status === 404) {
    throw new Error('No GitHub release was found.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = text.replace(/\s+/g, ' ').trim().slice(0, 180);
    throw new Error(
      detail
        ? `GitHub returned ${res.status}: ${detail}`
        : `GitHub returned ${res.status}.`,
    );
  }
  return (await res.json()) as GithubReleaseJson;
}

async function checkGithub(
  currentVersion: string,
): Promise<AppUpdateCheckResult> {
  let release: GithubReleaseJson;
  try {
    release = await fetchGithubJson(GITHUB_LATEST_RELEASE_API);
  } catch (err) {
    return emptyCheck(
      currentVersion,
      'github',
      null,
      err instanceof Error ? err.message : String(err),
    );
  }

  const assets = (release.assets ?? []).flatMap((asset) => {
    const name = asset.name?.trim();
    const browser_download_url = asset.browser_download_url?.trim();
    return name && browser_download_url
      ? [{ name, browser_download_url }]
      : [];
  });
  const picked = pickGithubInstaller(assets, process.platform, process.arch);
  if (!picked) {
    return emptyCheck(
      currentVersion,
      'github',
      null,
      'The latest GitHub release has no installer for this computer.',
    );
  }

  const newer = compareSemver(picked.version, currentVersion) > 0;
  if (!newer) {
    const same = compareSemver(picked.version, currentVersion) === 0;
    return emptyCheck(
      currentVersion,
      'github',
      null,
      same
        ? `You are on the latest version (${currentVersion}).`
        : `GitHub has ${picked.version}, which is older than the running app (${currentVersion}).`,
      {
        latestVersion: picked.version,
        downloadUrl: picked.downloadUrl,
        installerFileName: picked.fileName,
      },
    );
  }

  return {
    currentVersion,
    sourceKind: 'github',
    releaseFolder: null,
    available: true,
    latestVersion: picked.version,
    installerPath: null,
    downloadUrl: picked.downloadUrl,
    installerFileName: picked.fileName,
    message: `Update available: ${currentVersion} → ${picked.version}`,
  };
}

/**
 * Empty update folder checks the public GitHub release. A saved folder
 * overrides that and reads installers from disk.
 */
export async function checkForAppUpdate(
  releaseFolder?: string | null,
): Promise<AppUpdateCheckResult> {
  const currentVersion = app.getVersion();
  const folder =
    (releaseFolder?.trim()
      ? path.resolve(releaseFolder.trim())
      : getUpdateReleaseFolder()) ?? null;

  if (!folder) return checkGithub(currentVersion);
  return checkFolder(currentVersion, folder);
}

function broadcastDownload(progress: AppUpdateDownloadProgressDto): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(IPC.uiAppUpdateDownloadProgress, progress);
  }
}

async function downloadInstaller(
  downloadUrl: string,
  fileName: string,
): Promise<string> {
  if (!isOfficialDownloadUrl(downloadUrl)) {
    throw new Error('Refusing to download an installer from an unexpected address.');
  }
  const safeName = path.basename(fileName);
  if (safeName !== fileName || !INSTALLER_RE.test(safeName)) {
    throw new Error('The release asset is not a Wildcards Manager installer.');
  }

  const dir = path.join(os.tmpdir(), 'WildcardsManager-update');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, safeName);
  const partial = `${dest}.partial`;
  fs.rmSync(partial, { force: true });

  let res: Response;
  try {
    res = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'WildcardsManager',
        Accept: 'application/octet-stream',
      },
      redirect: 'follow',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not download the installer: ${message}`);
  }
  if (!res.ok) {
    throw new Error(`Download failed (HTTP ${res.status}).`);
  }

  const total = Number(res.headers.get('content-length') || 0);
  broadcastDownload({ fileName: safeName, bytesDone: 0, bytesTotal: total });

  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    broadcastDownload({
      fileName: safeName,
      bytesDone: buf.byteLength,
      bytesTotal: total || buf.byteLength,
    });
    return dest;
  }

  const file = fs.createWriteStream(partial);
  let doneBytes = 0;
  let lastReport = 0;
  try {
    const reader = res.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (!file.write(value)) await once(file, 'drain');
      doneBytes += value.byteLength;
      const now = Date.now();
      if (now - lastReport > 200) {
        lastReport = now;
        broadcastDownload({
          fileName: safeName,
          bytesDone: doneBytes,
          bytesTotal: total,
        });
      }
    }
    const finished = once(file, 'finish');
    file.end();
    await finished;
  } catch (err) {
    file.destroy();
    fs.rmSync(partial, { force: true });
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not download the installer: ${message}`);
  }

  if (doneBytes <= 0) {
    fs.rmSync(partial, { force: true });
    throw new Error('The downloaded installer was empty.');
  }

  fs.rmSync(dest, { force: true });
  fs.renameSync(partial, dest);
  broadcastDownload({
    fileName: safeName,
    bytesDone: doneBytes,
    bytesTotal: total || doneBytes,
  });
  return dest;
}

function scheduleInstallerCleanup(filePath: string): void {
  const delaySec = 180;
  if (process.platform === 'win32') {
    const escaped = filePath.replace(/'/g, "''");
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-WindowStyle',
        'Hidden',
        '-Command',
        `Start-Sleep -Seconds ${delaySec}; Remove-Item -LiteralPath '${escaped}' -Force -ErrorAction SilentlyContinue`,
      ],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.unref();
    return;
  }
  const child = spawn(
    'sh',
    ['-c', `sleep ${delaySec}; rm -f ${JSON.stringify(filePath)}`],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
}

function launchInstaller(installerPath: string): void {
  const child = spawn(installerPath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}

/**
 * Download (when the source is GitHub) and launch the newest installer, then
 * quit so NSIS can replace files. The installer UI includes its own “Run” checkbox.
 */
export async function installAppUpdate(opts?: {
  /** Skip the confirm dialog (tests / automation). */
  skipConfirm?: boolean;
}): Promise<AppUpdateCheckResult> {
  const check = await checkForAppUpdate();
  if (!check.available || (!check.installerPath && !check.downloadUrl)) {
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
      detail: check.downloadUrl
        ? 'The installer will download from GitHub. This app will then close and the installer will open. Leave “Run Wildcards Manager” checked at the end of the installer to relaunch.'
        : 'This app will close and the installer will open. Leave “Run Wildcards Manager” checked at the end of the installer to relaunch.',
      noLink: true,
    });
    if (response !== 0) {
      return {
        ...check,
        message: 'Update cancelled.',
      };
    }
  }

  let installerPath = check.installerPath;
  if (!installerPath) {
    if (!check.downloadUrl || !check.installerFileName) {
      throw new Error('No installer download is available.');
    }
    installerPath = await downloadInstaller(
      check.downloadUrl,
      check.installerFileName,
    );
  }

  try {
    launchInstaller(installerPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not launch installer: ${message}`);
  }

  if (check.downloadUrl) scheduleInstallerCleanup(installerPath);

  setTimeout(() => {
    quitAppFully();
  }, 400);

  return {
    ...check,
    installerPath,
    message: `Launching installer ${check.installerFileName}…`,
  };
}

async function fetchReleaseByTag(tag: string): Promise<GithubReleaseJson | null> {
  let res: Response;
  try {
    res = await fetch(githubReleaseApiUrl(tag), { headers: GITHUB_HEADERS });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  return (await res.json()) as GithubReleaseJson;
}

function readLocalReleaseNotes(): string | null {
  const dirs = localReleaseNotesSearchDirs(getUpdateReleaseFolder(), [
    app.getAppPath(),
    process.cwd(),
    process.resourcesPath,
  ]);
  for (const dir of dirs) {
    const file = path.join(dir, 'RELEASE_NOTES.md');
    try {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (text.trim()) return text;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchRawReleaseNotes(tag: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(githubReleaseNotesRawUrl(tag), {
      headers: { 'User-Agent': 'WildcardsManager' },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed || /^404[:\s]/i.test(trimmed)) return null;
  return text;
}

/** Release notes for a version, from the GitHub release body or RELEASE_NOTES.md. */
export async function fetchAppReleaseNotes(
  version: string,
): Promise<AppReleaseNotesDto> {
  const tags = githubReleaseTagCandidates(version);
  for (const tag of tags) {
    const json = await fetchReleaseByTag(tag);
    const body = json?.body?.trim() ?? '';
    const markdown = body || (await fetchRawReleaseNotes(tag)) || '';
    if (!markdown.trim()) continue;
    return {
      version,
      title: json?.name?.trim() || `What's new in ${version}`,
      markdown,
      htmlUrl:
        json?.html_url?.trim() ||
        `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/${tag}`,
    };
  }

  const local = readLocalReleaseNotes();
  if (local) {
    return {
      version,
      title: `What's new in ${version}`,
      markdown: local,
      htmlUrl: null,
    };
  }

  return {
    version,
    title: `What's new in ${version}`,
    markdown: `Release notes for ${version} are not on GitHub yet.\n\nThey show up here after that version is published.`,
    htmlUrl: null,
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
