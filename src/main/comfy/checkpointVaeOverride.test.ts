import { describe, expect, it } from 'vitest';
import { applyCheckpointVaeOverride } from './checkpointVaeOverride.js';
import type { WorkflowGraph } from './workflowGraph.js';

function graph(): WorkflowGraph {
  return {
    '107': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'pony.safetensors' },
    },
    '90': {
      class_type: 'VAEDecode',
      inputs: { samples: ['101', 0], vae: ['107', 2] },
    },
    '166': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['165', 0], vae: ['107', 2] },
    },
  };
}

describe('applyCheckpointVaeOverride', () => {
  it('leaves the checkpoint VAE when no file is chosen', () => {
    const next = graph();
    applyCheckpointVaeOverride(next, '');
    expect(next['90']!.inputs.vae).toEqual(['107', 2]);
    expect(next.wcm_vae_override).toBeUndefined();
  });

  it('points decode and encode at the chosen VAE file', () => {
    const next = graph();
    applyCheckpointVaeOverride(next, 'sdxl_vae.safetensors');
    expect(next.wcm_vae_override!.inputs.vae_name).toBe('sdxl_vae.safetensors');
    expect(next['90']!.inputs.vae).toEqual(['wcm_vae_override', 0]);
    expect(next['166']!.inputs.vae).toEqual(['wcm_vae_override', 0]);
    expect(next['107']!.inputs.ckpt_name).toBe('pony.safetensors');
  });

  it('keeps an LT · VAE link and moves checkpoint VAE sockets onto that loader', () => {
    const next = graph();
    next['115'] = {
      class_type: 'LoraTrainingVAE',
      inputs: { vae_name: 'sdxl_vae.safetensors' },
    };
    next['85'] = {
      class_type: 'VAELoader',
      inputs: { vae_name: ['115', 0] },
    };
    applyCheckpointVaeOverride(next, 'sdxl_vae.safetensors');
    expect(next['85']!.inputs.vae_name).toEqual(['115', 0]);
    expect(next['90']!.inputs.vae).toEqual(['85', 0]);
    expect(next['166']!.inputs.vae).toEqual(['85', 0]);
  });

  it('uses the checkpoint VAE again when the field is cleared', () => {
    const next = graph();
    next['85'] = {
      class_type: 'VAELoader',
      inputs: { vae_name: ['115', 0] },
    };
    next['90']!.inputs.vae = ['85', 0];
    next['166']!.inputs.vae = ['85', 0];
    applyCheckpointVaeOverride(next, '');
    expect(next['90']!.inputs.vae).toEqual(['107', 2]);
    expect(next['166']!.inputs.vae).toEqual(['107', 2]);
  });
});
