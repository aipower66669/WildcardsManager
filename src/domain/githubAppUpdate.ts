import path from 'node:path';
import { compareSemver, parseSemver } from './appSemver.js';

export const GITHUB_OWNER = 'aipower66669';
export const GITHUB_REPO = 'WildcardsManager';

export const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

export const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

/** electron-builder artifact: WildcardsManager-0.8.0-win-x64.exe */
export const INSTALLER_RE =
  /^WildcardsManager-(\d+\.\d+\.\d+)(?:-[^.]+)*\.(exe|dmg|AppImage)$/i;

export type GithubInstallerAsset = {
  name: string;
  browser_download_url: string;
};

export type PickedInstaller = {
  fileName: string;
  version: string;
  downloadUrl: string;
};

export function installerExtForPlatform(
  platform: string,
): 'exe' | 'dmg' | 'AppImage' | null {
  if (platform === 'win32') return 'exe';
  if (platform === 'darwin') return 'dmg';
  if (platform === 'linux') return 'AppImage';
  return null;
}

/** Only the public GitHub release asset URL. Redirects after this are fine. */
export function isOfficialDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    return (
      parsed.hostname === 'github.com' &&
      parsed.pathname.startsWith(
        `/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/`,
      )
    );
  } catch {
    return false;
  }
}

/**
 * Tag names to try for a package version. `0.7.0` also tries `v0.7`, because
 * the public v0.7 release used a two-part tag.
 */
export function githubReleaseTagCandidates(version: string): string[] {
  const parsed = parseSemver(version);
  if (!parsed) {
    const bare = version.trim().replace(/^v/i, '');
    return bare ? [`v${bare}`, bare] : [];
  }
  const full = `${parsed[0]}.${parsed[1]}.${parsed[2]}`;
  const tags = [`v${full}`, full];
  if (parsed[2] === 0) {
    const short = `${parsed[0]}.${parsed[1]}`;
    tags.push(`v${short}`, short);
  }
  return tags;
}

export function githubReleaseApiUrl(tag: string): string {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${encodeURIComponent(tag)}`;
}

export function githubReleaseNotesRawUrl(tag: string): string {
  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${encodeURIComponent(tag)}/RELEASE_NOTES.md`;
}

/**
 * Directories that may hold RELEASE_NOTES.md for a build that is not on GitHub
 * yet: the update folder, the folder above it (the repo when the folder is
 * `release/`), then any extra app directories.
 */
export function localReleaseNotesSearchDirs(
  updateFolder: string | null | undefined,
  extraDirs: Array<string | null | undefined> = [],
): string[] {
  const dirs: string[] = [];
  const add = (dir: string | null | undefined) => {
    const trimmed = dir?.trim();
    if (!trimmed) return;
    const resolved = path.resolve(trimmed);
    if (
      dirs.some((existing) => existing.toLowerCase() === resolved.toLowerCase())
    ) {
      return;
    }
    dirs.push(resolved);
  };
  if (updateFolder?.trim()) {
    const folder = path.resolve(updateFolder.trim());
    add(folder);
    add(path.dirname(folder));
  }
  for (const extra of extraDirs) add(extra);
  return dirs;
}

function archScore(fileName: string, arch: string): number {
  const lower = fileName.toLowerCase();
  const token = arch.toLowerCase();
  if (!token) return 0;
  if (lower.includes(`-${token}.`) || lower.includes(`-${token}-`)) return 2;
  if (lower.includes(token)) return 1;
  return 0;
}

/** Newest installer for this OS, preferring the current CPU architecture. */
export function pickGithubInstaller(
  assets: GithubInstallerAsset[],
  platform: string,
  arch: string,
): PickedInstaller | null {
  const ext = installerExtForPlatform(platform);
  if (!ext) return null;
  const matches: PickedInstaller[] = [];
  for (const asset of assets) {
    const name = asset.name?.trim();
    const downloadUrl = asset.browser_download_url?.trim();
    if (!name || !downloadUrl) continue;
    if (!isOfficialDownloadUrl(downloadUrl)) continue;
    const match = name.match(INSTALLER_RE);
    const fileExt = match?.[2]?.toLowerCase();
    if (!match?.[1] || fileExt !== ext.toLowerCase()) continue;
    matches.push({
      fileName: name,
      version: match[1],
      downloadUrl,
    });
  }
  matches.sort((a, b) => {
    const byVersion = compareSemver(b.version, a.version);
    if (byVersion !== 0) return byVersion;
    return archScore(b.fileName, arch) - archScore(a.fileName, arch);
  });
  return matches[0] ?? null;
}
