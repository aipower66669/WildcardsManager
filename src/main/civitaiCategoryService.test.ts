import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'wcm-cat-unused'),
  },
}));

import { listDownloadCategoryDirNames } from './civitaiCategoryService.js';

const temps: string[] = [];

function makeTemp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-dlcat-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('listDownloadCategoryDirNames', () => {
  it('lists real folders and junctions, and skips utility dirs', () => {
    const root = makeTemp();
    const elsewhere = makeTemp();
    fs.mkdirSync(path.join(root, 'People'));
    fs.mkdirSync(path.join(root, '!.wcm'));
    fs.mkdirSync(path.join(root, '!Thumbnails'));
    fs.writeFileSync(path.join(root, 'model.safetensors'), 'x');
    const link = path.join(root, 'Styles');
    try {
      fs.symlinkSync(
        elsewhere,
        link,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch {
      return;
    }
    expect(listDownloadCategoryDirNames(root)).toEqual(['People', 'Styles']);
  });
});
