import { describe, expect, it } from 'vitest';
import { categoryIdFromTags } from '../domain/civitaiModelCategories.js';

describe('version hash enrich skip Character', () => {
  it('detects Character tag for skip', () => {
    expect(categoryIdFromTags(['style', 'character'])).toBe('character');
    expect(categoryIdFromTags(['style', 'concept'])).toBe('style');
  });
});
