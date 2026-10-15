import { describe, expect, it } from 'vitest';
import { detectBindings } from './detectBindings.js';
import type { WorkflowGraph } from './workflowGraph.js';

describe('detectBindings', () => {
  it('binds Z-Image / Flux style graphs (CLIPTextEncode + UNETLoader + SaveImage)', () => {
    const graph: WorkflowGraph = {
      '9': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'ComfyUI', images: ['65', 0] },
      },
      '66': {
        class_type: 'UNETLoader',
        inputs: {
          unet_name: 'z_image_turbo_bf16.safetensors',
          weight_dtype: 'default',
        },
      },
      '67': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'a cat', clip: ['62', 0] },
      },
      '70': {
        class_type: 'KSampler',
        inputs: {
          seed: 42,
          steps: 8,
          cfg: 1,
          sampler_name: 'res_multistep',
          scheduler: 'simple',
          denoise: 1,
          model: ['69', 0],
          positive: ['67', 0],
          negative: ['71', 0],
          latent_image: ['68', 0],
        },
      },
      '71': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'blurry', clip: ['62', 0] },
      },
    };

    const { bindings } = detectBindings(graph);
    expect(bindings.positivePrompt?.nodeId).toBe('67');
    expect(bindings.negativePrompt?.nodeId).toBe('71');
    expect(bindings.seed?.nodeId).toBe('70');
    expect(bindings.outputNode?.nodeId).toBe('9');
    expect(bindings.checkpoint?.nodeId).toBe('66');
    expect(bindings.checkpoint?.inputPath).toEqual(['inputs', 'unet_name']);
  });

  it('binds CLIPTextEncode when text is currently a link array', () => {
    const graph: WorkflowGraph = {
      '1': {
        class_type: 'CLIPTextEncode',
        inputs: { text: ['2', 0], clip: ['3', 0] },
      },
      '4': {
        class_type: 'KSampler',
        inputs: { seed: 1, model: ['5', 0] },
      },
      '6': {
        class_type: 'SaveImage',
        inputs: { images: ['7', 0] },
      },
    };
    const { bindings } = detectBindings(graph);
    expect(bindings.positivePrompt?.nodeId).toBe('1');
  });
});
