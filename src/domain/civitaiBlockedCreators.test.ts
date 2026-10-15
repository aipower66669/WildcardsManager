import { describe, expect, it } from 'vitest';
import {
  isCivitaiCreatorBlocked,
  normalizeCivitaiCreatorUsername,
} from './civitaiBlockedCreators.js';

describe('normalizeCivitaiCreatorUsername', () => {
  it('trims and lowercases', () => {
    expect(normalizeCivitaiCreatorUsername('  Sarcastic TOFU  ')).toBe(
      'sarcastic tofu',
    );
  });

  it('returns empty for missing', () => {
    expect(normalizeCivitaiCreatorUsername(undefined)).toBe('');
    expect(normalizeCivitaiCreatorUsername(null)).toBe('');
  });
});

describe('isCivitaiCreatorBlocked', () => {
  it('matches case-insensitively against a Set', () => {
    const blocked = new Set(['sarcastic tofu']);
    expect(isCivitaiCreatorBlocked('Sarcastic TOFU', blocked)).toBe(true);
    expect(isCivitaiCreatorBlocked('other', blocked)).toBe(false);
  });

  it('treats blank creator as not blocked', () => {
    expect(isCivitaiCreatorBlocked('', new Set(['x']))).toBe(false);
    expect(isCivitaiCreatorBlocked(undefined, new Set(['x']))).toBe(false);
  });
});
