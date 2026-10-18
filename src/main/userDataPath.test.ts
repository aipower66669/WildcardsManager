import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CANONICAL_USER_DATA_DIR_NAME,
  copyMissingUserDataEntries,
  pinSharedUserData,
} from './userDataPath.js';

const temps: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-userdata-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('copyMissingUserDataEntries', () => {
  it('copies files the destination lacks and leaves existing files', () => {
    const root = tempDir();
    const from = path.join(root, 'from');
    const to = path.join(root, 'to');
    fs.mkdirSync(path.join(from, 'libraries'), { recursive: true });
    fs.mkdirSync(to, { recursive: true });
    fs.writeFileSync(path.join(from, 'settings.json'), '{"from":true}\n');
    fs.writeFileSync(path.join(to, 'settings.json'), '{"to":true}\n');
    fs.writeFileSync(path.join(from, 'generation-form.json'), '{"seed":1}\n');
    fs.writeFileSync(
      path.join(from, 'libraries', 'extra.json'),
      '{"ok":true}\n',
    );
    fs.writeFileSync(path.join(from, 'SingletonLock'), 'lock');
    fs.mkdirSync(path.join(from, 'Cache'), { recursive: true });
    fs.writeFileSync(path.join(from, 'Cache', 'data'), 'cache');

    const copied = copyMissingUserDataEntries(from, to);

    expect(copied).toBe(2);
    expect(fs.readFileSync(path.join(to, 'settings.json'), 'utf8')).toBe(
      '{"to":true}\n',
    );
    expect(fs.readFileSync(path.join(to, 'generation-form.json'), 'utf8')).toBe(
      '{"seed":1}\n',
    );
    expect(
      fs.readFileSync(path.join(to, 'libraries', 'extra.json'), 'utf8'),
    ).toBe('{"ok":true}\n');
    expect(fs.existsSync(path.join(to, 'SingletonLock'))).toBe(false);
    expect(fs.existsSync(path.join(to, 'Cache'))).toBe(false);
  });
});

describe('pinSharedUserData', () => {
  it('pins both paths and imports only missing legacy files', () => {
    const appData = tempDir();
    const legacy = path.join(appData, 'Wildcards Manager');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'comfy-workflow.json'), '{"legacy":1}\n');
    fs.writeFileSync(path.join(legacy, 'settings.json'), '{"legacy":true}\n');
    const canonical = path.join(appData, CANONICAL_USER_DATA_DIR_NAME);
    fs.mkdirSync(canonical, { recursive: true });
    fs.writeFileSync(path.join(canonical, 'settings.json'), '{"dev":true}\n');

    const set: string[] = [];
    const pinned = pinSharedUserData({
      appDataDir: appData,
      mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
      exists: (dir) => fs.existsSync(dir),
      setPath: (name, dir) => {
        set.push(`${name}=${path.basename(dir)}`);
      },
    });

    expect(pinned).toBe(canonical);
    expect(set).toEqual([
      `userData=${CANONICAL_USER_DATA_DIR_NAME}`,
      `sessionData=${CANONICAL_USER_DATA_DIR_NAME}`,
    ]);
    expect(fs.readFileSync(path.join(canonical, 'settings.json'), 'utf8')).toBe(
      '{"dev":true}\n',
    );
    expect(
      fs.readFileSync(path.join(canonical, 'comfy-workflow.json'), 'utf8'),
    ).toBe('{"legacy":1}\n');
  });
});
