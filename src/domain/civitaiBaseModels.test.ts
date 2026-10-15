import { describe, expect, it } from 'vitest';
import {
  architectureIdsForBaseModel,
  baseModelsNamedInText,
  expandArchitectureApiValues,
  matchesArchitectureFilter,
  matchesEnabledLibraryBaseModel,
  matchesEnabledLibraryVersion,
  matchesEnabledSdxlFamilies,
  matchesSdxlFamily,
  matchesVersionArchitectureFilter,
  resolveVersionBaseModel,
  sdxlFamilyBadgeId,
  sdxlFamilyBadgeLabel,
} from './civitaiBaseModels.js';

describe('civitai architecture filters', () => {
  it('maps Krea chip to Civitai “Krea 2” base model', () => {
    expect(expandArchitectureApiValues(['krea'])).toEqual(['Krea 2']);
  });

  it('matches official baseModel enum values only', () => {
    expect(matchesArchitectureFilter('Krea 2', ['krea'])).toBe(true);
    expect(matchesArchitectureFilter('krea 2', ['krea'])).toBe(true);
    expect(matchesArchitectureFilter('Flux.1 D', ['krea'])).toBe(false);
    expect(matchesArchitectureFilter('Flux.1 D', ['flux'])).toBe(true);
    // Flux.1 Krea is a Flux enum value, not Krea 2.
    expect(matchesArchitectureFilter('Flux.1 Krea', ['flux'])).toBe(true);
    expect(matchesArchitectureFilter('Flux.1 Krea', ['krea'])).toBe(false);
    // Version titles are not the baseModel field.
    expect(matchesArchitectureFilter('v1.0 K2', ['krea'])).toBe(false);
    expect(matchesArchitectureFilter('v2.0 Flux', ['flux'])).toBe(false);
  });

  it('scopes multi-arch cards by each version’s baseModel enum', () => {
    const krea = { baseModel: 'Krea 2', versionName: 'v1.0 K2' };
    const flux = {
      baseModel: 'Flux.1 D',
      versionName: 'v2.0 Flux',
      fileName: 'Brand_Krea2_Flux.safetensors',
    };
    const pony = { baseModel: 'Pony', versionName: 'v3.0 Pony' };
    const ideogram = {
      baseModel: 'Ideogram 4.0',
      versionName: 'v1.0 Ideogram4',
    };
    const anima = { baseModel: 'Anima', versionName: 'v1 Anima' };

    expect(matchesVersionArchitectureFilter(krea, ['krea'])).toBe(true);
    expect(matchesVersionArchitectureFilter(flux, ['krea'])).toBe(false);
    expect(matchesVersionArchitectureFilter(pony, ['krea'])).toBe(false);
    expect(matchesVersionArchitectureFilter(ideogram, ['krea'])).toBe(false);
    expect(matchesVersionArchitectureFilter(anima, ['krea'])).toBe(false);

    expect(matchesEnabledLibraryVersion(flux, { architectures: ['krea'] })).toBe(
      false,
    );
    expect(matchesEnabledLibraryVersion(krea, { architectures: ['krea'] })).toBe(
      true,
    );
    expect(
      matchesEnabledLibraryVersion(ideogram, { architectures: ['other'] }),
    ).toBe(true);
  });

  it('library model set keeps only enabled architectures', () => {
    expect(
      matchesEnabledLibraryBaseModel('Krea 2', { architectures: ['krea'] }),
    ).toBe(true);
    expect(
      matchesEnabledLibraryBaseModel('Flux.1 D', { architectures: ['krea'] }),
    ).toBe(false);
    expect(
      matchesEnabledLibraryBaseModel('Anima', { architectures: ['krea'] }),
    ).toBe(false);
    expect(
      matchesEnabledLibraryBaseModel('Anima', {
        architectures: ['krea', 'other'],
      }),
    ).toBe(true);
  });

  it('maps baseModel enums to architecture ids', () => {
    expect(architectureIdsForBaseModel('Krea 2')).toEqual(['krea']);
    expect(architectureIdsForBaseModel('Flux.1 D')).toEqual(['flux']);
    expect(architectureIdsForBaseModel('Pony')).toEqual(['sdxl']);
    expect(architectureIdsForBaseModel('Anima')).toEqual(['other']);
  });

  it('narrows SDXL families', () => {
    expect(matchesSdxlFamily('Pony', 'pony')).toBe(true);
    expect(matchesSdxlFamily('Illustrious', 'illustrious')).toBe(true);
    expect(matchesSdxlFamily('NoobAI', 'noobai')).toBe(true);
    expect(matchesSdxlFamily('SDXL 1.0', 'sdxl')).toBe(true);
    expect(matchesSdxlFamily('Pony', 'sdxl')).toBe(false);
    expect(matchesSdxlFamily('Pony', 'all')).toBe(true);
  });

  it('limits SDXL sync apiValues by enabled families', () => {
    expect(
      expandArchitectureApiValues(['sdxl'], {
        sdxlFamilies: ['pony', 'illustrious'],
      }),
    ).toEqual(['Pony', 'Pony V7', 'Illustrious']);
  });

  it('filters by enabled SDXL family set', () => {
    expect(matchesEnabledSdxlFamilies('Pony', ['pony', 'illustrious'])).toBe(
      true,
    );
    expect(matchesEnabledSdxlFamilies('NoobAI', ['pony', 'illustrious'])).toBe(
      false,
    );
    expect(matchesEnabledSdxlFamilies('SDXL 1.0', ['sdxl'])).toBe(true);
  });

  it('labels SDXL family badges', () => {
    expect(sdxlFamilyBadgeId('Pony')).toBe('pony');
    expect(sdxlFamilyBadgeId('Illustrious')).toBe('illustrious');
    expect(sdxlFamilyBadgeId('NoobAI')).toBe('noobai');
    expect(sdxlFamilyBadgeId('SDXL 1.0')).toBe('sdxl');
    expect(sdxlFamilyBadgeLabel('SDXL 1.0')).toBe('SDXL');
    expect(sdxlFamilyBadgeId('SD 1.5')).toBeNull();
  });
});

describe('resolveVersionBaseModel', () => {
  it('reads a single base model from the version title when the field is missing', () => {
    expect(baseModelsNamedInText('v1.0 Krea 2')).toEqual(['Krea 2']);
    expect(baseModelsNamedInText('v1.0 Illustrious')).toEqual(['Illustrious']);
    expect(
      resolveVersionBaseModel({ versionName: 'v1.0 Krea 2' }),
    ).toBe('Krea 2');
  });

  it('keeps the official field when the title agrees', () => {
    expect(
      resolveVersionBaseModel({
        baseModel: 'Krea 2',
        versionName: 'v1.0 Krea 2',
      }),
    ).toBe('Krea 2');
  });

  it('uses the title when it names a different architecture than the stored field', () => {
    expect(
      resolveVersionBaseModel({
        baseModel: 'Krea 2',
        versionName: 'v1.0 Illustrious',
      }),
    ).toBe('Illustrious');
    expect(
      matchesArchitectureFilter(
        resolveVersionBaseModel({
          baseModel: 'Krea 2',
          versionName: 'v1.0 Illustrious',
        }),
        ['krea'],
      ),
    ).toBe(false);
  });

  it('does not override when the title names two architectures', () => {
    expect(
      resolveVersionBaseModel({
        baseModel: 'Krea 2',
        versionName: 'v1.0 Krea 2 Illustrious',
      }),
    ).toBe('Krea 2');
  });
});
