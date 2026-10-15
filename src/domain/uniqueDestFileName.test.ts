import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  safeBaseModelDirName,
  uniqueDestFileName,
} from './uniqueDestFileName.js';

describe('uniqueDestFileName', () => {
  it('keeps the name when free', () => {
    const r = uniqueDestFileName('/img', 'photo.jpg', () => false);
    expect(r.fileName).toBe('photo.jpg');
    expect(r.renamed).toBe(false);
  });

  it('appends (n) on collision', () => {
    const folder = path.join('D:', 'img');
    const taken = new Set([
      path.join(folder, 'photo.jpg'),
      path.join(folder, 'photo (1).jpg'),
    ]);
    const r = uniqueDestFileName(folder, 'photo.jpg', (p) => taken.has(p));
    expect(r.fileName).toBe('photo (2).jpg');
    expect(r.renamed).toBe(true);
  });
});

describe('safeBaseModelDirName', () => {
  it('falls back to _unknown', () => {
    expect(safeBaseModelDirName('')).toBe('_unknown');
    expect(safeBaseModelDirName(null)).toBe('_unknown');
  });

  it('strips path separators', () => {
    expect(safeBaseModelDirName('SDXL 1.0/foo')).toBe('SDXL 1.0-foo');
  });
});
