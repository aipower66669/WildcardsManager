import { describe, expect, it } from 'vitest';
import {
  extractTriggersFromCivitaiDescription,
  stripHtmlToPlainText,
} from './civitaiTriggerFallback.js';

describe('stripHtmlToPlainText', () => {
  it('turns breaks into newlines', () => {
    expect(stripHtmlToPlainText('a<br>b</p>c')).toContain('a');
    expect(stripHtmlToPlainText('<p>Trigger: melly</p>')).toContain(
      'Trigger: melly',
    );
  });
});

describe('extractTriggersFromCivitaiDescription', () => {
  it('reads a labeled Trigger line', () => {
    expect(
      extractTriggersFromCivitaiDescription(
        '<p>A cool LoRA.</p><p><strong>Trigger:</strong> melly, smile</p>',
      ),
    ).toEqual(['melly', 'smile']);
  });

  it('reads Trigger words / Activation variants', () => {
    expect(
      extractTriggersFromCivitaiDescription('Trigger words: foo | bar'),
    ).toEqual(['foo', 'bar']);
    expect(
      extractTriggersFromCivitaiDescription('Activation word: charactername'),
    ).toEqual(['charactername']);
  });

  it('returns empty when no labeled trigger line exists', () => {
    expect(
      extractTriggersFromCivitaiDescription(
        'This LoRA makes nice portraits with soft lighting.',
      ),
    ).toEqual([]);
  });
});
