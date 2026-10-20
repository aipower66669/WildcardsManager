import { describe, expect, it } from 'vitest';
import {
  hfRepoSaveFileName,
  pickPreferredHfWeight,
} from './huggingfaceWeightPick.js';

describe('pickPreferredHfWeight', () => {
  it('picks the safetensors file ahead of optimizer.bin', () => {
    const picked = pickPreferredHfWeight([
      { path: 'checkpoint-1000/optimizer.bin', size: 12 },
      { path: 'pytorch_lora_weights.safetensors', size: 192_000_000 },
      { path: 'checkpoint-500/pytorch_model.bin', size: 80 },
    ]);
    expect(picked?.path).toBe('pytorch_lora_weights.safetensors');
  });

  it('skips a checkpoint snapshot when a root weight exists', () => {
    const picked = pickPreferredHfWeight([
      { path: 'checkpoint-1000/model.safetensors', size: 10 },
      { path: 'pytorch_lora_weights.safetensors', size: 9 },
    ]);
    expect(picked?.path).toBe('pytorch_lora_weights.safetensors');
  });

  it('falls back to a bin only when no safetensors file exists', () => {
    const picked = pickPreferredHfWeight([
      { path: 'optimizer.bin', size: 4 },
      { path: 'pytorch_model.bin', size: 20 },
    ]);
    expect(picked?.path).toBe('pytorch_model.bin');
  });
});

describe('hfRepoSaveFileName', () => {
  it('replaces the repo slash and keeps the safetensors extension', () => {
    expect(
      hfRepoSaveFileName(
        'misapapa71/model-rinka-krea2',
        'pytorch_lora_weights.safetensors',
      ),
    ).toBe('misapapa71-model-rinka-krea2.safetensors');
  });

  it('keeps a bin extension when that is the file being saved', () => {
    expect(hfRepoSaveFileName('org/name', 'pytorch_model.bin')).toBe(
      'org-name.bin',
    );
  });
});
