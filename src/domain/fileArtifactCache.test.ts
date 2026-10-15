import { afterEach, describe, expect, it } from 'vitest';
import {
  cachedParseFile,
  fileContentIdentity,
  forgetFileArtifacts,
  libraryFilesFingerprint,
} from './fileArtifactCache.js';
import type { LibraryFile } from './types.js';

function txt(relativePath: string, text: string, extra?: Partial<LibraryFile>): LibraryFile {
  return {
    relativePath,
    absolutePath: `/lib/${relativePath}`,
    name: relativePath.split('/').pop() ?? relativePath,
    ext: '.txt',
    key: relativePath.replace(/\.txt$/i, ''),
    text,
    ...extra,
  };
}

afterEach(() => {
  forgetFileArtifacts();
});

describe('fileArtifactCache', () => {
  it('reuses parse results when size+mtime identity matches', () => {
    const file = txt('hats.txt', '__color__\n', { size: 10, mtimeMs: 100 });
    const first = cachedParseFile(file);
    const second = cachedParseFile({ ...file, text: '__color__\n' });
    expect(second).toBe(first);
    expect(first.refs.map((r) => r.name)).toEqual(['color']);
  });

  it('reparses when mtime changes', () => {
    const file = txt('hats.txt', '__color__\n', { size: 10, mtimeMs: 100 });
    const first = cachedParseFile(file);
    const second = cachedParseFile({
      ...file,
      text: '__mood__\n',
      mtimeMs: 200,
      size: 11,
    });
    expect(second).not.toBe(first);
    expect(second.refs.map((r) => r.name)).toEqual(['mood']);
  });

  it('fingerprints a library by path + identity', () => {
    const files = [
      txt('b.txt', 'x', { size: 1, mtimeMs: 2 }),
      txt('a.txt', 'y', { size: 3, mtimeMs: 4 }),
    ];
    expect(libraryFilesFingerprint(files)).toBe(
      `a.txt\0${fileContentIdentity(files[1]!)}\nb.txt\0${fileContentIdentity(files[0]!)}`,
    );
  });
});
