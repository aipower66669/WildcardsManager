import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => path.join(os.tmpdir(), 'wcm-libsvc-settings') },
}));

import { libraryService } from './libraryService.js';

const temps: string[] = [];

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-lib-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  libraryService.closeRoot();
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('libraryService in-memory library', () => {
  it('reuses file text when size and mtime match', () => {
    const root = makeRoot();
    const file = path.join(root, 'hats.txt');
    fs.writeFileSync(file, 'beanie\n');
    libraryService.openRoot(root);
    const first = libraryService.loadAllFiles();
    const second = libraryService.loadAllFiles();
    expect(second).toHaveLength(1);
    expect(second[0]!.text).toBe(first[0]!.text);
    expect(second[0]!).toBe(first[0]!);
  });

  it('keeps serving memory until an explicit refresh', () => {
    const root = makeRoot();
    const file = path.join(root, 'hats.txt');
    fs.writeFileSync(file, 'beanie\n');
    libraryService.openRoot(root);
    libraryService.loadAllFiles();
    const later = new Date(Date.now() + 5_000);
    fs.writeFileSync(file, 'fedora\n');
    fs.utimesSync(file, later, later);
    expect(libraryService.loadAllFiles()[0]!.text).toBe('beanie\n');
    expect(libraryService.loadAllFiles({ refresh: true })[0]!.text).toBe(
      'fedora\n',
    );
  });

  it('invalidateContentPath forces a reread of that file', () => {
    const root = makeRoot();
    const file = path.join(root, 'hats.txt');
    fs.writeFileSync(file, 'beanie\n');
    libraryService.openRoot(root);
    const first = libraryService.loadAllFiles();
    fs.writeFileSync(file, 'changed\n');
    // Preserve mtime so a naive fingerprint would keep the old text.
    const st = fs.statSync(file);
    fs.utimesSync(file, new Date(st.atimeMs), new Date(first[0]!.mtimeMs ?? st.mtimeMs));
    libraryService.invalidateContentPath('hats.txt');
    const next = libraryService.loadAllFiles();
    expect(next[0]!.text).toBe('changed\n');
  });

  it('serves readFile from memory after openRoot', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, 'hats.txt'), 'beanie\n');
    libraryService.openRoot(root);
    expect(libraryService.readFile('hats.txt').text).toBe('beanie\n');
    fs.writeFileSync(path.join(root, 'hats.txt'), 'disk\n');
    expect(libraryService.readFile('hats.txt').text).toBe('beanie\n');
  });

  it('replaceMemoryText updates RAM without touching disk', () => {
    const root = makeRoot();
    const file = path.join(root, 'hats.txt');
    fs.writeFileSync(file, 'beanie\n');
    libraryService.openRoot(root);
    libraryService.replaceMemoryText('hats.txt', 'beanie\n\n<lora:Foo:1>\n');
    expect(libraryService.readFile('hats.txt').text).toBe(
      'beanie\n\n<lora:Foo:1>\n',
    );
    expect(libraryService.readFile('hats.txt').unsaved).toBe(true);
    expect(libraryService.readFile('hats.txt').persistedText).toBe('beanie\n');
    expect(fs.readFileSync(file, 'utf8')).toBe('beanie\n');
    expect(libraryService.loadAllFiles({ refresh: true })[0]!.text).toBe(
      'beanie\n\n<lora:Foo:1>\n',
    );
    expect(fs.readFileSync(file, 'utf8')).toBe('beanie\n');
  });

  it('writeFileText persists and clears unsaved', () => {
    const root = makeRoot();
    const file = path.join(root, 'hats.txt');
    fs.writeFileSync(file, 'beanie\n');
    libraryService.openRoot(root);
    libraryService.replaceMemoryText('hats.txt', 'fedora\n');
    libraryService.writeFileText('hats.txt', 'fedora\n');
    expect(fs.readFileSync(file, 'utf8')).toBe('fedora\n');
    expect(libraryService.hasUnsavedMemory('hats.txt')).toBe(false);
    expect(libraryService.readFile('hats.txt').unsaved).toBeUndefined();
  });

  it('invalidateContentPath does not reload an unsaved memory edit', () => {
    const root = makeRoot();
    const file = path.join(root, 'hats.txt');
    fs.writeFileSync(file, 'beanie\n');
    libraryService.openRoot(root);
    libraryService.replaceMemoryText('hats.txt', 'fedora\n');
    libraryService.invalidateContentPath('hats.txt');
    expect(libraryService.readFile('hats.txt').text).toBe('fedora\n');
  });
});
