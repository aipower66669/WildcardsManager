import { describe, expect, it } from 'vitest';
import { compareSemver } from './appSemver.js';
import path from 'node:path';
import {
  githubReleaseTagCandidates,
  isOfficialDownloadUrl,
  localReleaseNotesSearchDirs,
  pickGithubInstaller,
} from './githubAppUpdate.js';

const exe = (version: string, arch = 'x64') => ({
  name: `WildcardsManager-${version}-win-${arch}.exe`,
  browser_download_url: `https://github.com/aipower66669/WildcardsManager/releases/download/v${version}/WildcardsManager-${version}-win-${arch}.exe`,
});

describe('compareSemver two-part tags', () => {
  it('treats a missing patch as 0', () => {
    expect(compareSemver('0.7', '0.7.0')).toBe(0);
    expect(compareSemver('v0.7', '0.6.9')).toBeGreaterThan(0);
    expect(compareSemver('0.8.0', 'v0.7')).toBeGreaterThan(0);
  });
});

describe('githubReleaseTagCandidates', () => {
  it('tries the two-part tag when the patch is 0', () => {
    expect(githubReleaseTagCandidates('0.7.0')).toEqual([
      'v0.7.0',
      '0.7.0',
      'v0.7',
      '0.7',
    ]);
  });

  it('keeps a non-zero patch on the three-part tag', () => {
    expect(githubReleaseTagCandidates('0.8.1')).toEqual(['v0.8.1', '0.8.1']);
  });
});

describe('localReleaseNotesSearchDirs', () => {
  it('checks the update folder and its parent before other directories', () => {
    const dirs = localReleaseNotesSearchDirs(
      path.join('F:', 'repo', 'release'),
      [path.join('F:', 'repo'), path.join('F:', 'repo', 'release')],
    );
    expect(dirs.map((dir) => dir.toLowerCase())).toEqual([
      path.resolve(path.join('F:', 'repo', 'release')).toLowerCase(),
      path.resolve(path.join('F:', 'repo')).toLowerCase(),
    ]);
  });
});

describe('isOfficialDownloadUrl', () => {
  it('accepts this repo’s release asset URLs only', () => {
    expect(
      isOfficialDownloadUrl(
        'https://github.com/aipower66669/WildcardsManager/releases/download/v0.8.0/WildcardsManager-0.8.0-win-x64.exe',
      ),
    ).toBe(true);
    expect(
      isOfficialDownloadUrl(
        'https://github.com/other/WildcardsManager/releases/download/v0.8.0/WildcardsManager-0.8.0-win-x64.exe',
      ),
    ).toBe(false);
    expect(
      isOfficialDownloadUrl('http://github.com/aipower66669/WildcardsManager/releases/download/v0.8.0/a.exe'),
    ).toBe(false);
  });
});

describe('pickGithubInstaller', () => {
  it('picks the newest Windows exe for the current arch and ignores other assets', () => {
    const picked = pickGithubInstaller(
      [
        {
          name: 'WildcardsManager-0.7.0-win-x64.exe.blockmap',
          browser_download_url:
            'https://github.com/aipower66669/WildcardsManager/releases/download/v0.7/WildcardsManager-0.7.0-win-x64.exe.blockmap',
        },
        exe('0.7.0', 'arm64'),
        exe('0.8.0', 'arm64'),
        exe('0.8.0', 'x64'),
        exe('0.7.0', 'x64'),
        {
          name: 'comfyui-lora-training.zip',
          browser_download_url:
            'https://github.com/aipower66669/WildcardsManager/releases/download/v0.8.0/comfyui-lora-training.zip',
        },
      ],
      'win32',
      'x64',
    );
    expect(picked?.fileName).toBe('WildcardsManager-0.8.0-win-x64.exe');
    expect(picked?.version).toBe('0.8.0');
  });

  it('picks a dmg on macOS', () => {
    const picked = pickGithubInstaller(
      [
        exe('0.8.0'),
        {
          name: 'WildcardsManager-0.8.0-mac-arm64.dmg',
          browser_download_url:
            'https://github.com/aipower66669/WildcardsManager/releases/download/v0.8.0/WildcardsManager-0.8.0-mac-arm64.dmg',
        },
      ],
      'darwin',
      'arm64',
    );
    expect(picked?.fileName).toBe('WildcardsManager-0.8.0-mac-arm64.dmg');
  });

  it('rejects an asset whose URL is not this repo', () => {
    const picked = pickGithubInstaller(
      [
        {
          name: 'WildcardsManager-0.8.0-win-x64.exe',
          browser_download_url: 'https://example.com/WildcardsManager-0.8.0-win-x64.exe',
        },
      ],
      'win32',
      'x64',
    );
    expect(picked).toBeNull();
  });
});
