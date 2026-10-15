import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isPathEqualOrUnder,
  longestCommonPathPrefix,
  normalizePathPrefix,
  planLibraryPathMigration,
  remapMasterImagesStore,
  remapPathUnderPrefix,
  remapRecentRoots,
  remapTrainingLibraryRoot,
  suggestMigrationOldPrefix,
} from './libraryPathMigrate.js';

const win = process.platform === 'win32';

describe('normalizePathPrefix', () => {
  it('strips trailing separators', () => {
    const base = path.join('D:', 'ComfyUI');
    expect(normalizePathPrefix(base + path.sep)).toBe(normalizePathPrefix(base));
  });
});

describe('isPathEqualOrUnder / remapPathUnderPrefix', () => {
  it('remaps nested paths under a shared prefix', () => {
    const oldPrefix = path.join('D:', 'ComfyUI');
    const newPrefix = path.join('E:', 'AI', 'ComfyUI');
    const oldLora = path.join(oldPrefix, 'models', 'loras');
    const expected = path.join(newPrefix, 'models', 'loras');
    expect(isPathEqualOrUnder(oldLora, oldPrefix)).toBe(true);
    expect(remapPathUnderPrefix(oldLora, oldPrefix, newPrefix)).toBe(expected);
  });

  it('returns null when path is outside the prefix', () => {
    const oldPrefix = path.join('D:', 'ComfyUI');
    const other = path.join('C:', 'Elsewhere', 'loras');
    expect(isPathEqualOrUnder(other, oldPrefix)).toBe(false);
    expect(remapPathUnderPrefix(other, oldPrefix, path.join('E:', 'x'))).toBe(
      null,
    );
  });

  it('remaps the prefix itself', () => {
    const oldPrefix = path.join('D:', 'ComfyUI');
    const newPrefix = path.join('E:', 'ComfyUI');
    expect(remapPathUnderPrefix(oldPrefix, oldPrefix, newPrefix)).toBe(
      newPrefix,
    );
  });

  if (win) {
    it('compares drive letters case-insensitively on Windows', () => {
      const oldPrefix = 'd:\\ComfyUI';
      const abs = 'D:\\ComfyUI\\models\\checkpoints';
      expect(isPathEqualOrUnder(abs, oldPrefix)).toBe(true);
      expect(remapPathUnderPrefix(abs, oldPrefix, 'E:\\ComfyUI')).toBe(
        path.join('E:', 'ComfyUI', 'models', 'checkpoints'),
      );
    });
  }
});

describe('longestCommonPathPrefix', () => {
  it('finds the shared parent of sibling folders', () => {
    const a = path.join('D:', 'ComfyUI', 'models', 'loras');
    const b = path.join('D:', 'ComfyUI', 'models', 'checkpoints');
    const c = path.join('D:', 'ComfyUI', 'wildcards');
    expect(longestCommonPathPrefix([a, b, c])).toBe(
      path.join('D:', 'ComfyUI'),
    );
  });

  it('returns null across different drive roots', () => {
    if (!win) return;
    expect(
      longestCommonPathPrefix([
        path.join('D:', 'ComfyUI', 'loras'),
        path.join('E:', 'ComfyUI', 'loras'),
      ]),
    ).toBe(null);
  });
});

describe('suggestMigrationOldPrefix', () => {
  it('matches LCP when all folders share a tree', () => {
    const a = path.join('D:', 'ComfyUI', 'models', 'loras');
    const b = path.join('D:', 'ComfyUI', 'models', 'checkpoints');
    const c = path.join('D:', 'ComfyUI', 'wildcards');
    expect(suggestMigrationOldPrefix([a, b, c], c)).toBe(
      path.join('D:', 'ComfyUI'),
    );
  });

  it('falls back to the preferred drive when folders span roots', () => {
    if (!win) return;
    const wildcards = path.join('D:', 'ComfyUI', 'wildcards');
    const lora = path.join('E:', 'models', 'loras');
    const ckpt = path.join('D:', 'ComfyUI', 'models', 'checkpoints');
    expect(suggestMigrationOldPrefix([wildcards, lora, ckpt], wildcards)).toBe(
      path.join('D:', 'ComfyUI'),
    );
  });

  it('returns a single configured folder when that is all there is', () => {
    const wildcards = path.join('D:', 'ComfyUI', 'wildcards');
    expect(suggestMigrationOldPrefix([wildcards, null, ''], wildcards)).toBe(
      wildcards,
    );
  });
});

describe('planLibraryPathMigration', () => {
  it('rewrites folders under the prefix and leaves outsiders alone', () => {
    const oldPrefix = path.join('D:', 'ComfyUI');
    const newPrefix = path.join('E:', 'AI', 'ComfyUI');
    const plan = planLibraryPathMigration({
      oldPrefix,
      newPrefix,
      folders: {
        wildcardsRoot: path.join(oldPrefix, 'wildcards'),
        loraFolder: path.join(oldPrefix, 'models', 'loras'),
        checkpointFolder: path.join(oldPrefix, 'models', 'checkpoints'),
        imagesFolder: path.join(oldPrefix, 'images'),
        videosFolder: path.join(oldPrefix, 'videos'),
        mastersFolder: path.join('F:', 'masters'),
        trainingLibraryFolder: path.join(oldPrefix, 'training'),
        promptsFolder: null,
        generationOutputRealistic: null,
        generationOutputHentai: null,
        generationOutput3d: null,
        benchmarkOutputFolder: null,
      },
    });
    expect(
      plan.folders.find((f) => f.field === 'loraFolder')?.newPath,
    ).toBe(path.join(newPrefix, 'models', 'loras'));
    expect(
      plan.folders.find((f) => f.field === 'mastersFolder')?.changed,
    ).toBe(false);
    expect(
      plan.warnings.some((w) => w.includes('mastersFolder')),
    ).toBe(true);
  });

  it('honors folder overrides', () => {
    const oldPrefix = path.join('D:', 'ComfyUI');
    const newPrefix = path.join('E:', 'ComfyUI');
    const override = path.join('G:', 'masters-new');
    const plan = planLibraryPathMigration({
      oldPrefix,
      newPrefix,
      folders: {
        wildcardsRoot: path.join(oldPrefix, 'wildcards'),
        loraFolder: null,
        checkpointFolder: null,
        imagesFolder: null,
        videosFolder: null,
        mastersFolder: path.join('F:', 'masters'),
        trainingLibraryFolder: null,
        promptsFolder: null,
        generationOutputRealistic: null,
        generationOutputHentai: null,
        generationOutput3d: null,
        benchmarkOutputFolder: null,
      },
      folderOverrides: { mastersFolder: override },
    });
    const masters = plan.folders.find((f) => f.field === 'mastersFolder');
    expect(masters?.newPath).toBe(override);
    expect(masters?.override).toBe(true);
    expect(masters?.changed).toBe(true);
  });
});

describe('remapMasterImagesStore', () => {
  it('rewrites byPath keys and absolute fields', () => {
    const oldPrefix = path.join('D:', 'ComfyUI');
    const newPrefix = path.join('E:', 'ComfyUI');
    const ckpt = path.join(oldPrefix, 'models', 'checkpoints', 'a.safetensors');
    const master = path.join(oldPrefix, 'masters', 'a.jpg');
    const { store, remappedEntries } = remapMasterImagesStore(
      {
        version: 1,
        byPath: {
          [ckpt.toLowerCase()]: {
            masterAbsolutePath: master,
            genAbsolutePaths: [path.join(oldPrefix, 'masters', 'a_01.jpg')],
            mastersFolder: path.join(oldPrefix, 'masters'),
            resolvedAt: '2026-01-01T00:00:00.000Z',
          },
        },
        byAutoV2: {},
      },
      oldPrefix,
      newPrefix,
    );
    expect(remappedEntries).toBeGreaterThan(0);
    const newKey = path
      .join(newPrefix, 'models', 'checkpoints', 'a.safetensors')
      .toLowerCase();
    expect(store.byPath[newKey]?.masterAbsolutePath).toBe(
      path.join(newPrefix, 'masters', 'a.jpg'),
    );
  });
});

describe('remapTrainingLibraryRoot / remapRecentRoots', () => {
  it('remaps training root and recent roots under the prefix', () => {
    const oldPrefix = path.join('D:', 'ComfyUI');
    const newPrefix = path.join('E:', 'ComfyUI');
    const training = path.join(oldPrefix, 'training');
    const { next, changed } = remapTrainingLibraryRoot(
      training,
      oldPrefix,
      newPrefix,
    );
    expect(changed).toBe(true);
    expect(next).toBe(path.join(newPrefix, 'training'));

    const recent = remapRecentRoots(
      [path.join(oldPrefix, 'wildcards'), path.join('C:', 'other')],
      oldPrefix,
      newPrefix,
    );
    expect(recent.remappedCount).toBe(1);
    expect(recent.next[0]).toBe(path.join(newPrefix, 'wildcards'));
    expect(recent.next[1]).toBe(path.join('C:', 'other'));
  });
});
