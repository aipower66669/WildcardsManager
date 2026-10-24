import { describe, expect, it } from 'vitest';
import { parseModelCatalog } from './adapter.js';

describe('parseModelCatalog', () => {
  it('reads legacy combo option arrays', () => {
    const catalog = parseModelCatalog({
      VAELoader: {
        input: {
          required: {
            vae_name: [['ae.safetensors', 'vae-ft-mse.safetensors'], {}],
          },
        },
      },
      CLIPLoader: {
        input: {
          required: {
            clip_name: [['clip_l.safetensors'], { default: 'clip_l.safetensors' }],
          },
        },
      },
    });
    expect(catalog.vaes).toEqual(['ae.safetensors', 'vae-ft-mse.safetensors']);
    expect(catalog.clips).toEqual(['clip_l.safetensors']);
  });

  it('reads COMBO v2 options objects', () => {
    const catalog = parseModelCatalog({
      VAELoader: {
        input: {
          required: {
            vae_name: ['COMBO', { options: ['ae.safetensors', 'other.safetensors'] }],
          },
        },
      },
      DualCLIPLoader: {
        input: {
          required: {
            clip_name1: ['COMBO', { options: ['clip_l.safetensors'] }],
            clip_name2: ['COMBO', { options: ['t5xxl.safetensors'] }],
          },
        },
      },
    });
    expect(catalog.vaes).toEqual(['ae.safetensors', 'other.safetensors']);
    expect(catalog.clips).toEqual(['clip_l.safetensors', 't5xxl.safetensors']);
  });

  it('reads upscalers from UpscaleModelLoader only', () => {
    const catalog = parseModelCatalog({
      UpscaleModelLoader: {
        input: {
          required: {
            model_name: [['4x_foolhardy_Remacri.pth', '4x-UltraSharp.pth']],
          },
        },
      },
      SomeOtherLoader: {
        input: {
          required: {
            model_name: [['not-an-upscaler.safetensors']],
          },
        },
      },
    });
    expect(catalog.upscalers).toEqual([
      '4x_foolhardy_Remacri.pth',
      '4x-UltraSharp.pth',
    ]);
  });
});
