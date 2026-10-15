import { describe, expect, it } from 'vitest';
import {
  datasetAncestorRelativePaths,
  loraSeriesDatasetKey,
  orderOutputSetFolders,
  parseDatasetName,
  parseDatasetPreviewRelativePath,
  parseDatasetValidationSets,
  parseOutputSetFolderIndex,
  pickFirstDatasetImageFileName,
  safetensorsFileMatchesSeries,
  trainingLoraIsUnderDatasetOutput,
} from './loraTrainingDataset.js';

describe('loraTrainingDataset', () => {
  it('builds a stable series cache key', () => {
    expect(
      loraSeriesDatasetKey({
        dir: 'MyGirls\\',
        seriesBase: 'Akira',
        separator: '_',
      }),
    ).toBe('mygirls\0akira\0_');
  });

  it('parses preview paths from common dataset.json shapes', () => {
    expect(
      parseDatasetPreviewRelativePath({
        version: 1,
        name: 'Dataset name',
        coverFileName: '0058_141.jpg',
      }),
    ).toBe('0058_141.jpg');
    expect(
      parseDatasetPreviewRelativePath({ preview: 'icon.png' }),
    ).toBe('icon.png');
    expect(
      parseDatasetPreviewRelativePath({
        preview_image: 'sub/cover.jpg',
      }),
    ).toBe('sub/cover.jpg');
    expect(
      parseDatasetPreviewRelativePath({
        preview: { path: 'thumbs\\a.webp' },
      }),
    ).toBe('thumbs/a.webp');
    expect(
      parseDatasetPreviewRelativePath({
        images: [
          { file: 'a.jpg' },
          { file: 'b.jpg', is_preview: true },
        ],
      }),
    ).toBe('b.jpg');
    expect(parseDatasetPreviewRelativePath({ preview: 'readme.txt' })).toBeNull();
  });

  it('picks the first image basename when coverFileName is missing', () => {
    expect(
      pickFirstDatasetImageFileName([
        'dataset.json',
        '0010_2.jpg',
        '0001_1.jpg',
        'notes.txt',
        '.hidden.png',
      ]),
    ).toBe('0001_1.jpg');
    expect(pickFirstDatasetImageFileName(['dataset.json', 'a.txt'])).toBeNull();
  });

  it('parses validationSets and orders output folders', () => {
    const sets = parseDatasetValidationSets({
      validationSets: [
        { prompt: 'one', seed: 1, loraWeight: 1 },
        { prompt: 'two', seed: 2 },
      ],
    });
    expect(sets).toHaveLength(2);
    expect(sets[0]).toMatchObject({ index: 0, prompt: 'one', seed: 1 });
    expect(parseOutputSetFolderIndex('Set 1')).toBe(1);
    expect(parseOutputSetFolderIndex('0')).toBe(0);
    expect(orderOutputSetFolders(['Set 2', 'Set 1'], 2)).toEqual([
      'Set 1',
      'Set 2',
    ]);
    // Sibling folders like the dataset name under output/ must be ignored.
    expect(orderOutputSetFolders(['FluoKawaii', 'Set 1'], 1)).toEqual(['Set 1']);
    expect(orderOutputSetFolders(['Set 1', 'other', 'Set 2'], 2)).toEqual([
      'Set 1',
      'Set 2',
    ]);
    // No set-like folders → still use Set 1..N under output/, not alphabetical junk.
    expect(orderOutputSetFolders(['b', 'a'], 2)).toEqual(['Set 1', 'Set 2']);
  });

  it('matches series safetensors and resolves dataset via output path', () => {
    expect(parseDatasetName({ name: 'Akira' })).toBe('Akira');
    expect(
      safetensorsFileMatchesSeries('FluoKawaii_000001000.safetensors', 'FluoKawaii', '_'),
    ).toBe(true);
    expect(
      safetensorsFileMatchesSeries('FluoKawaii_000001000.safetensors', 'Other', '_'),
    ).toBe(false);
    expect(
      safetensorsFileMatchesSeries('FluoKawaii.safetensors', 'FluoKawaii', '_'),
    ).toBe(false);

    expect(
      trainingLoraIsUnderDatasetOutput(
        'Fashion/DatasetA',
        'Fashion/DatasetA/output/FluoKawaii_000001000.safetensors',
      ),
    ).toBe(true);
    expect(
      trainingLoraIsUnderDatasetOutput(
        'Fashion/DatasetA',
        'Fashion/DatasetA/output/run/FluoKawaii_000001000.safetensors',
      ),
    ).toBe(true);
    expect(
      trainingLoraIsUnderDatasetOutput(
        'Fashion/DatasetA',
        'Fashion/DatasetA/FluoKawaii_000001000.safetensors',
      ),
    ).toBe(false);

    expect(
      datasetAncestorRelativePaths(
        'Fashion/DatasetA/output/FluoKawaii_000001000.safetensors',
      ),
    ).toEqual(['Fashion/DatasetA/output', 'Fashion/DatasetA', 'Fashion', '']);
  });
});
