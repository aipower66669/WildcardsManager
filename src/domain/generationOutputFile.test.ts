import { describe, expect, it } from 'vitest';
import {
  generationOutputNames,
  isGenerationOutputName,
} from './generationOutputFile.js';

describe('isGenerationOutputName', () => {
  it('accepts the stem and any image that continues it', () => {
    expect(isGenerationOutputName('WCG.png', 'WCG')).toBe(true);
    expect(isGenerationOutputName('WCG_00001_.png', 'WCG')).toBe(true);
    expect(isGenerationOutputName('WCG_extra_00001.png', 'WCG')).toBe(true);
    expect(isGenerationOutputName('wcg_00010_.jpeg', 'WCG')).toBe(true);
    expect(isGenerationOutputName('WCG.preview.webp', 'WCG')).toBe(true);
    expect(isGenerationOutputName('other.png', 'WCG')).toBe(false);
    expect(isGenerationOutputName('WCG.txt', 'WCG')).toBe(false);
  });
});

describe('generationOutputNames', () => {
  it('keeps every stem image, not only the highest counter', () => {
    expect(
      generationOutputNames(
        [
          'notes.txt',
          'other.png',
          'WCG_00001_.png',
          'WCG_extra_00003.png',
          'WCG.png',
        ],
        'WCG',
      ),
    ).toEqual(['WCG_00001_.png', 'WCG_extra_00003.png', 'WCG.png']);
  });
});
