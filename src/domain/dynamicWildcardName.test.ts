import { describe, expect, it } from 'vitest';
import {
  expandDynamicWildcardName,
  hasDynamicWildcardLogic,
  wildcardNamesForPlatform,
} from './dynamicWildcardName.js';

describe('expandDynamicWildcardName', () => {
  it('expands brace suffix variants like A1111 Dynamic Prompts', () => {
    expect(expandDynamicWildcardName('where{|-indoor}')).toEqual([
      'where',
      'where-indoor',
    ]);
  });

  it('expands paren suffix variants (remapped delimiters)', () => {
    expect(expandDynamicWildcardName('color(|-basic)')).toEqual([
      'color',
      'color-basic',
    ]);
  });

  it('expands cartesian products of multiple groups', () => {
    expect(expandDynamicWildcardName('foo{a|b}{c|d}')).toEqual([
      'fooac',
      'fooad',
      'foobc',
      'foobd',
    ]);
  });

  it('leaves parameterized templates literal', () => {
    expect(expandDynamicWildcardName('season_clothes(season=winter)')).toEqual([
      'season_clothes(season=winter)',
    ]);
  });

  it('leaves plain names alone', () => {
    expect(expandDynamicWildcardName('color')).toEqual(['color']);
    expect(hasDynamicWildcardLogic('color')).toBe(false);
  });
});

describe('wildcardNamesForPlatform', () => {
  it('expands for Stable Diffusion and keeps literal for ComfyUI', () => {
    expect(
      wildcardNamesForPlatform('color(|-basic)', 'stable-diffusion'),
    ).toEqual({
      names: ['color', 'color-basic'],
      dynamic: true,
    });
    expect(wildcardNamesForPlatform('color(|-basic)', 'comfyui')).toEqual({
      names: ['color(|-basic)'],
      dynamic: true,
    });
  });
});
