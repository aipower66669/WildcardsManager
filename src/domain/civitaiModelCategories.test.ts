import { describe, expect, it } from 'vitest';
import {
  CIVITAI_MODEL_CATEGORY_PRESETS,
  DEFAULT_ENABLED_CIVITAI_CATEGORIES,
  categoryIdFromTags,
  categoryLabelFromTags,
  modelCategoryIsEnabled,
  modelCategoryTag,
  modelHasCategoryTag,
  normalizeEnabledCivitaiCategories,
} from './civitaiModelCategories.js';

describe('civitai model categories', () => {
  it('covers the main site category chips', () => {
    expect(CIVITAI_MODEL_CATEGORY_PRESETS.map((p) => p.id)).toEqual(
      expect.arrayContaining(['character', 'style', 'concept', 'poses']),
    );
  });

  it('maps category ids to API tag values', () => {
    expect(modelCategoryTag('character')).toBe('character');
    expect(modelCategoryTag('base model')).toBe('base model');
    expect(modelCategoryTag(null)).toBeUndefined();
  });

  it('resolves a display label from model tags', () => {
    expect(categoryIdFromTags(['foo', 'animal', 'bar'])).toBe('animal');
    expect(categoryLabelFromTags(['Style'])).toBe('Style');
    expect(categoryLabelFromTags(['unrelated'])).toBeNull();
  });

  it('defaults enabled categories to the full preset list', () => {
    expect(normalizeEnabledCivitaiCategories(undefined)).toEqual(
      DEFAULT_ENABLED_CIVITAI_CATEGORIES,
    );
    expect(normalizeEnabledCivitaiCategories([])).toEqual(
      DEFAULT_ENABLED_CIVITAI_CATEGORIES,
    );
    expect(normalizeEnabledCivitaiCategories(['vehicle', 'nope'])).toEqual([
      'vehicle',
    ]);
  });

  it('matches category chips by tag membership (not sync-slice membership)', () => {
    expect(modelHasCategoryTag(['style', 'character'], 'character')).toBe(true);
    expect(modelHasCategoryTag(['style', 'character'], 'style')).toBe(true);
    expect(modelHasCategoryTag(['style'], 'character')).toBe(false);
    expect(modelHasCategoryTag(['Character'], 'character')).toBe(true);
  });

  it('treats uncategorized models as enabled', () => {
    expect(modelCategoryIsEnabled(['unrelated'], ['character'])).toBe(true);
    expect(modelCategoryIsEnabled(['vehicle'], ['character'])).toBe(false);
    expect(modelCategoryIsEnabled(['character'], ['character'])).toBe(true);
  });
});
