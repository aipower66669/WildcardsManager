import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  direntIsDirectory,
  direntIsFile,
  isPathInsideRoot,
  walkModelFolderEntries,
  walkModelFolderEntriesAsync,
} from './modelFolderWalk.js';

const temps: string[] = [];

function makeTemp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-walk-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('modelFolderWalk', () => {
  it('treats extended-length Windows paths as inside the same root', () => {
    if (process.platform !== 'win32') return;
    expect(
      isPathInsideRoot(
        'C:\\Temp\\models',
        '\\\\?\\C:\\Temp\\models\\a\\two.safetensors',
      ),
    ).toBe(true);
  });

  it('treats regular files as files without needing a junction stat', () => {
    const root = makeTemp();
    const file = path.join(root, 'a.safetensors');
    fs.writeFileSync(file, 'x');
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const entry = entries.find((e) => e.name === 'a.safetensors');
    expect(entry).toBeTruthy();
    expect(direntIsDirectory(file, entry!)).toBe(false);
    expect(direntIsFile(file, entry!)).toBe(true);
  });

  it('walks nested weight files and skips !.wcm', () => {
    const root = makeTemp();
    fs.mkdirSync(path.join(root, 'sub'));
    fs.mkdirSync(path.join(root, '!.wcm'));
    fs.writeFileSync(path.join(root, 'sub', 'one.safetensors'), 'x');
    fs.writeFileSync(path.join(root, '!.wcm', 'hidden.safetensors'), 'x');
    const found: string[] = [];
    walkModelFolderEntries(root, root, (_abs, rel) => {
      found.push(rel);
    });
    expect(found).toEqual(['sub/one.safetensors']);
  });

  it('async walk reports file counts while yielding', async () => {
    const root = makeTemp();
    fs.mkdirSync(path.join(root, 'a'));
    fs.writeFileSync(path.join(root, 'a', 'one.safetensors'), 'x');
    fs.writeFileSync(path.join(root, 'a', 'two.safetensors'), 'x');
    const counts: number[] = [];
    await walkModelFolderEntriesAsync(root, root, () => {}, {
      yieldEvery: 1,
      onProgress: (files) => counts.push(files),
    });
    expect(counts.at(-1)).toBe(2);
  });

  it('async walk finds files under a mixed-case directory', async () => {
    const parent = makeTemp();
    const root = path.join(parent, 'MiXeD');
    fs.mkdirSync(path.join(root, 'a'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a', 'two.safetensors'), 'x');
    const found: string[] = [];
    await walkModelFolderEntriesAsync(root, root, (_abs, rel) => {
      found.push(rel);
    });
    expect(found).toEqual(['a/two.safetensors']);
  });

  it('async walk finds the same files and yields', async () => {
    const root = makeTemp();
    fs.mkdirSync(path.join(root, 'a'));
    fs.writeFileSync(path.join(root, 'a', 'two.safetensors'), 'x');
    const found: string[] = [];
    await walkModelFolderEntriesAsync(root, root, (_abs, rel) => {
      found.push(rel);
    }, { yieldEvery: 1 });
    expect(found).toEqual(['a/two.safetensors']);
  });

  it('skips previews and txt sidecars without treating them as files', () => {
    const root = makeTemp();
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'one.safetensors'), 'x');
    fs.writeFileSync(path.join(root, 'sub', 'one.png'), 'x');
    fs.writeFileSync(path.join(root, 'sub', 'one.txt'), 'x');
    fs.writeFileSync(path.join(root, 'sub', 'one.json'), 'x');
    const found: string[] = [];
    walkModelFolderEntries(root, root, (_abs, rel) => {
      found.push(rel);
    });
    expect(found).toEqual(['sub/one.safetensors']);
  });

  it('does not follow a junction / symlink that escapes the root', () => {
    const outside = makeTemp();
    fs.writeFileSync(path.join(outside, 'escaped.safetensors'), 'x');
    const root = makeTemp();
    fs.writeFileSync(path.join(root, 'inside.safetensors'), 'x');
    const link = path.join(root, 'escaped');
    try {
      fs.symlinkSync(
        outside,
        link,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch {
      return;
    }
    const found: string[] = [];
    walkModelFolderEntries(root, root, (_abs, rel) => {
      found.push(rel);
    });
    expect(found).toEqual(['inside.safetensors']);
    expect(isPathInsideRoot(root, outside)).toBe(false);
  });
});
