import { describe, expect, it } from 'vitest';
import {
  generationSamplerOptions,
  matchUpscaler,
  samplerLabel,
  schedulerLabel,
} from './generationFamily.js';

describe('generationSamplerOptions', () => {
  const catalog = [
    'euler',
    'euler_ancestral',
    'dpmpp_2m',
    'dpmpp_2m_sde',
    'ddim',
    'uni_pc',
    'exp_heun_2_x0',
  ];

  it('keeps the full list for Krea 2', () => {
    expect(generationSamplerOptions('krea2', catalog, '')).toEqual(catalog);
  });

  it('keeps every Comfy sampler for SDXL, including LCM, and a saved name', () => {
    expect(generationSamplerOptions('sdxl', catalog, 'lcm')).toEqual([
      'lcm',
      ...catalog,
    ]);
  });
});

describe('samplerLabel', () => {
  it('keeps the Comfy id, including underscores', () => {
    expect(samplerLabel('lcm')).toBe('lcm');
    expect(samplerLabel('euler_ancestral')).toBe('euler_ancestral');
    expect(samplerLabel('dpmpp_2m_sde')).toBe('dpmpp_2m_sde');
    expect(samplerLabel('exp_heun_2_x0')).toBe('exp_heun_2_x0');
  });
});

describe('schedulerLabel', () => {
  it('keeps the Comfy id, including underscores and mixed case', () => {
    expect(schedulerLabel('sgm_uniform')).toBe('sgm_uniform');
    expect(schedulerLabel('karras')).toBe('karras');
    expect(schedulerLabel('kl_optimal')).toBe('kl_optimal');
    expect(schedulerLabel('AYS')).toBe('AYS');
    expect(schedulerLabel('Beta57')).toBe('Beta57');
  });
});

describe('matchUpscaler', () => {
  it('matches the same stem', () => {
    expect(
      matchUpscaler('4x_foolhardy_Remacri', [
        '4x_foolhardy_Remacri.pth',
        '4x-UltraSharp.pth',
      ]),
    ).toBe('4x_foolhardy_Remacri.pth');
  });
});
