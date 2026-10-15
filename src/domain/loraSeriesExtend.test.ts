import { describe, expect, it } from 'vitest';
import {
  extendLoraSeriesStepsInText,
  planExtendUnusedLoraSeriesSteps,
} from './loraSeriesExtend.js';
import type { LoraFileEntry } from './lora.js';

function entry(relative: string): LoraFileEntry {
  const stem = relative.replace(/\.(safetensors|ckpt|pt)$/i, '');
  return {
    relativePath: relative,
    absolutePath: `/models/Lora/${relative}`,
    stem,
  };
}

describe('extendLoraSeriesStepsInText', () => {
  it('adds missing steps into an existing brace pick list', () => {
    const missing = new Map([
      [
        'Styles_FlatLines\0_',
        {
          seriesBase: 'Styles_FlatLines',
          separator: '_' as const,
          steps: new Set(['000002500', '000003000']),
        },
      ],
    ]);
    const result = extendLoraSeriesStepsInText(
      '<lora:Styles_FlatLines_00000{1500|1750|2000}:{0.8|0.9|1|1|1}>',
      missing,
    );
    expect(result.changed).toBe(true);
    expect(result.text).toBe(
      '<lora:Styles_FlatLines_00000{1500|1750|2000|2500|3000}:{0.8|0.9|1|1|1}>',
    );
  });

  it('promotes a single-step tag into a brace pick list', () => {
    const missing = new Map([
      [
        'Melly\0_',
        {
          seriesBase: 'Melly',
          separator: '_' as const,
          steps: new Set(['000000500']),
        },
      ],
    ]);
    const result = extendLoraSeriesStepsInText(
      '# LOCAL\n<lora:Melly_000000250:0.8> trigger',
      missing,
    );
    expect(result.text).toBe(
      '# LOCAL\n<lora:Melly_000000{250|500}:0.8> trigger',
    );
  });

  it('preserves a folder prefix on the LoRA name', () => {
    const missing = new Map([
      [
        'Styles_FlatLines\0_',
        {
          seriesBase: 'Styles_FlatLines',
          separator: '_' as const,
          steps: new Set(['000002500']),
        },
      ],
    ]);
    const result = extendLoraSeriesStepsInText(
      '<lora:MyStyles/Styles_FlatLines_00000{1500|2000}:1>',
      missing,
    );
    expect(result.text).toBe(
      '<lora:MyStyles/Styles_FlatLines_00000{1500|2000|2500}:1>',
    );
  });

  it('does nothing when the tag is a different series', () => {
    const missing = new Map([
      [
        'Other\0_',
        {
          seriesBase: 'Other',
          separator: '_' as const,
          steps: new Set(['000001000']),
        },
      ],
    ]);
    const src = '<lora:Styles_FlatLines_00000{1500|2000}:1>';
    const result = extendLoraSeriesStepsInText(src, missing);
    expect(result.changed).toBe(false);
    expect(result.text).toBe(src);
  });
});

describe('planExtendUnusedLoraSeriesSteps', () => {
  it('plans a rewrite for the wildcard that already references the series', () => {
    const plans = planExtendUnusedLoraSeriesSteps({
      unusedFiles: [
        entry('MyStyles/Styles_FlatLines_000002500.safetensors'),
        entry('MyStyles/Styles_FlatLines_000003000.safetensors'),
      ],
      libraryFiles: [
        {
          relativePath: 'loras.txt',
          text: '<lora:Styles_FlatLines_00000{1500|1750|2000}:{0.8|0.9|1|1|1}>',
        },
        {
          relativePath: 'other.txt',
          text: 'no lora here',
        },
      ],
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.relativePath).toBe('loras.txt');
    expect(plans[0]?.text).toContain(
      'Styles_FlatLines_00000{1500|1750|2000|2500|3000}',
    );
  });
});
