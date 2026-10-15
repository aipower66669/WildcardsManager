import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addLoraFile, type LoraIndex } from '../domain/lora.js';
import { modelFileIndexPath } from '../domain/librarySidecarPaths.js';
import {
  hydrateModelIndex,
  persistModelIndex,
  snapshotFromIndex,
} from './modelFileIndexCache.js';

const temps: string[] = [];

function makeTemp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-file-index-'));
  temps.push(dir);
  return dir;
}

function emptyIndex(root: string): LoraIndex {
  return {
    root: path.resolve(root),
    aliases: new Map(),
    files: [],
    fileCount: 0,
  };
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('modelFileIndexCache', () => {
  it('round-trips relative paths and AutoV2', () => {
    const root = makeTemp();
    const index = emptyIndex(root);
    addLoraFile(index, 'sub/one.safetensors', path.join(root, 'sub', 'one.safetensors'));
    index.files[0]!.autoV2 = 'AABBCCDDEE';
    persistModelIndex(index);
    expect(fs.existsSync(modelFileIndexPath(root))).toBe(true);

    const loaded = hydrateModelIndex(root);
    expect(loaded).toBeTruthy();
    expect(loaded!.fileCount).toBe(1);
    expect(loaded!.files[0]!.relativePath).toBe('sub/one.safetensors');
    expect(loaded!.files[0]!.autoV2).toBe('AABBCCDDEE');
    expect(loaded!.byAutoV2?.get('AABBCCDDEE')).toBe(
      path.join(root, 'sub', 'one.safetensors'),
    );
  });

  it('rejects a snapshot from a different root', () => {
    const root = makeTemp();
    const other = makeTemp();
    const index = emptyIndex(other);
    addLoraFile(index, 'a.safetensors', path.join(other, 'a.safetensors'));
    persistModelIndex(index);
    fs.mkdirSync(path.dirname(modelFileIndexPath(root)), { recursive: true });
    fs.copyFileSync(modelFileIndexPath(other), modelFileIndexPath(root));
    expect(hydrateModelIndex(root)).toBeNull();
  });

  it('snapshot omits empty hashes', () => {
    const root = makeTemp();
    const index = emptyIndex(root);
    addLoraFile(index, 'a.safetensors', path.join(root, 'a.safetensors'));
    expect(snapshotFromIndex(index)).toEqual([{ r: 'a.safetensors' }]);
  });
});
