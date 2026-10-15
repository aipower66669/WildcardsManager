import { describe, expect, it } from 'vitest';
import {
  buildCompactLoraSeriesPickName,
  buildLocalLoraSeriesSnippet,
  buildUnusedLoraLocalSnippet,
  groupUnusedLoraFiles,
  parseLoraTrainingStep,
  unusedLoraIssuesFromFiles,
} from './loraSeries.js';
import type { LoraFileEntry } from './lora.js';

function entry(relative: string): LoraFileEntry {
  const stem = relative.replace(/\.(safetensors|ckpt|pt)$/i, '');
  return {
    relativePath: relative,
    absolutePath: `/models/Lora/${relative}`,
    stem,
  };
}

describe('parseLoraTrainingStep', () => {
  it('parses underscore and hyphen step suffixes', () => {
    expect(parseLoraTrainingStep('Melly_000000250')).toEqual({
      seriesBase: 'Melly',
      separator: '_',
      stepDigits: '000000250',
    });
    expect(parseLoraTrainingStep('LORANAME-000001000')).toEqual({
      seriesBase: 'LORANAME',
      separator: '-',
      stepDigits: '000001000',
    });
  });

  it('rejects non-step names', () => {
    expect(parseLoraTrainingStep('detail_slider')).toBeNull();
    expect(parseLoraTrainingStep('Melly_ab')).toBeNull();
    expect(parseLoraTrainingStep('Melly_12')).toBeNull();
  });
});

describe('buildCompactLoraSeriesPickName', () => {
  it('shares the longest common digit prefix when widths match', () => {
    expect(
      buildCompactLoraSeriesPickName('loraname', '_', [
        '0001',
        '0002',
        '0010',
      ]),
    ).toBe('loraname_00{01|02|10}');
  });

  it('uses full digit runs when widths differ', () => {
    expect(
      buildCompactLoraSeriesPickName('Melly', '_', [
        '000000250',
        '000000500',
        '0000001000',
      ]),
    ).toBe('Melly_{000000250|000000500|0000001000}');
  });

  it('preserves hyphen separators', () => {
    expect(
      buildCompactLoraSeriesPickName('LORANAME', '-', ['000001000', '000002000']),
    ).toBe('LORANAME-00000{1000|2000}');
  });
});

describe('buildLocalLoraSeriesSnippet', () => {
  it('prefixes the pick-list tag with # LOCAL', () => {
    expect(
      buildLocalLoraSeriesSnippet({
        seriesBase: 'loraname',
        separator: '_',
        stepDigitsList: ['0001', '0002', '0010'],
        weights: '0.8',
      }),
    ).toBe('# LOCAL\n<lora:loraname_00{01|02|10}:0.8>');
  });

  it('appends prompt keywords after the LoRA tag', () => {
    expect(
      buildLocalLoraSeriesSnippet({
        seriesBase: 'loraname',
        separator: '_',
        stepDigitsList: ['0001', '0150'],
        weights: '1',
        keywords: ['keyword1', 'keyword2'],
      }),
    ).toBe('# LOCAL\n<lora:loraname_0{001|150}:1> keyword1, keyword2');
  });

  it('inserts optional extra comment and prompt', () => {
    expect(
      buildLocalLoraSeriesSnippet({
        seriesBase: 'loraname',
        separator: '_',
        stepDigitsList: ['0001'],
        weights: '0.8',
        keywords: ['trigger'],
        extraComment: 'Value range −10…+10',
        extraPrompt: 'atmospheric, bokeh',
      }),
    ).toBe(
      '# LOCAL\n# Value range −10…+10\n<lora:loraname_0001:0.8> trigger, atmospheric, bokeh',
    );
  });
});

describe('buildUnusedLoraLocalSnippet', () => {
  it('builds a series LOCAL block from training-step paths', () => {
    expect(
      buildUnusedLoraLocalSnippet({
        relativePaths: [
          '!Testing/Melly_000000250.safetensors',
          '!Testing/Melly_000000500.safetensors',
        ],
        weights: '0.8',
        keywords: ['melly'],
      }),
    ).toBe('# LOCAL\n<lora:Melly_000000{250|500}:0.8> melly');
  });

  it('builds a single-file LOCAL block', () => {
    expect(
      buildUnusedLoraLocalSnippet({
        relativePaths: ['styles/orphan.safetensors'],
        weights: '{0.8|0.9|1|1}',
      }),
    ).toBe('# LOCAL\n<lora:orphan:{0.8|0.9|1|1}>');
  });
});

describe('groupUnusedLoraFiles / unusedLoraIssuesFromFiles', () => {
  it('collapses same-folder training steps into one issue', () => {
    const files = [
      entry('!Testing/Melly_000000250.safetensors'),
      entry('!Testing/Melly_000000500.safetensors'),
      entry('!Testing/Melly_000000750.safetensors'),
      entry('styles/orphan.safetensors'),
    ];
    const grouped = groupUnusedLoraFiles(files);
    expect(grouped.filter((g) => g.kind === 'series')).toHaveLength(1);
    expect(grouped.filter((g) => g.kind === 'single')).toHaveLength(1);

    const issues = unusedLoraIssuesFromFiles(files);
    expect(issues).toHaveLength(2);
    const series = issues.find((i) => i.relatedPaths?.length);
    expect(series).toMatchObject({
      code: 'unused_lora',
      snippet: '!Testing/Melly_000000250.safetensors',
      message: expect.stringContaining('!Testing/Melly_*'),
    });
    expect(series?.relatedPaths).toEqual([
      '!Testing/Melly_000000500.safetensors',
      '!Testing/Melly_000000750.safetensors',
    ]);
  });

  it('does not merge series across folders', () => {
    const files = [
      entry('a/Melly_000000250.safetensors'),
      entry('b/Melly_000000500.safetensors'),
    ];
    const issues = unusedLoraIssuesFromFiles(files);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => !i.relatedPaths?.length)).toBe(true);
  });
});
