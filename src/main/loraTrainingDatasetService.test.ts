import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const folders = vi.hoisted(() => ({
  training: '',
  lora: '',
}));

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}));

vi.mock('./settingsStore.js', () => ({
  getActiveLibrary: () => ({
    trainingLibraryFolder: folders.training,
    loraFolder: folders.lora,
  }),
}));

import {
  resetLoraSeriesDatasetMemory,
  resolveLoraSeriesDatasetPreview,
} from './loraTrainingDatasetService.js';

const temps: string[] = [];

function makeTemp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-series-ds-'));
  temps.push(dir);
  return dir;
}

function writeDataset(training: string, seriesBase: string): void {
  const dataset = path.join(training, 'AkiraSet');
  const output = path.join(dataset, 'output', 'Set 1');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(dataset, 'dataset.json'),
    JSON.stringify({
      name: 'Akira',
      coverFileName: 'cover.jpg',
      validationSets: [{ prompt: 'test', seed: 1, loraWeight: 1 }],
    }),
  );
  fs.writeFileSync(path.join(dataset, 'cover.jpg'), 'fake-jpg');
  fs.writeFileSync(path.join(output, 'val.png'), 'fake-png');
  fs.writeFileSync(
    path.join(output, `${seriesBase}_0001000.safetensors`),
    'x',
  );
}

afterEach(() => {
  resetLoraSeriesDatasetMemory();
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveLoraSeriesDatasetPreview cache', () => {
  beforeEach(() => {
    folders.training = makeTemp();
    folders.lora = makeTemp();
  });

  it('reuses the dataset folder after the matching training file is gone', () => {
    writeDataset(folders.training, 'Akira');
    const first = resolveLoraSeriesDatasetPreview({
      dir: '',
      seriesBase: 'Akira',
      separator: '_',
    });
    expect(first.status).toBe('ok');
    expect(first.fromCache).toBe(false);
    expect(first.datasetRelativePath).toBe('AkiraSet');
    expect(first.validationSets?.[0]?.images[0]?.fileName).toBe('val.png');

    fs.rmSync(
      path.join(
        folders.training,
        'AkiraSet',
        'output',
        'Set 1',
        'Akira_0001000.safetensors',
      ),
    );
    resetLoraSeriesDatasetMemory();

    const second = resolveLoraSeriesDatasetPreview({
      dir: '',
      seriesBase: 'Akira',
      separator: '_',
    });
    expect(second.status).toBe('ok');
    expect(second.fromCache).toBe(true);
    expect(second.datasetRelativePath).toBe('AkiraSet');
  });

  it('does not search the training tree again after a not-found miss', () => {
    const miss = resolveLoraSeriesDatasetPreview({
      dir: '',
      seriesBase: 'Missing',
      separator: '_',
    });
    expect(miss.status).toBe('not_found');
    expect(miss.fromCache).toBe(false);

    writeDataset(folders.training, 'Missing');
    resetLoraSeriesDatasetMemory();

    const cached = resolveLoraSeriesDatasetPreview({
      dir: '',
      seriesBase: 'Missing',
      separator: '_',
    });
    expect(cached.status).toBe('not_found');
    expect(cached.fromCache).toBe(true);

    const rematch = resolveLoraSeriesDatasetPreview(
      { dir: '', seriesBase: 'Missing', separator: '_' },
      { force: true },
    );
    expect(rematch.status).toBe('ok');
    expect(rematch.datasetRelativePath).toBe('AkiraSet');
  });
});
