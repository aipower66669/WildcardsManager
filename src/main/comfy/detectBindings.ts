/**
 * Legacy best-effort binding detection for stock Comfy nodes.
 * Prefer LT contract nodes (`comfyui-lora-training`) or LT: title markers.
 */

import type {
  InputBinding,
  WorkflowBindings,
} from '../../shared/comfyWorkflowSchema.js';
import type { WorkflowGraph } from './workflowGraph.js';

function stringBinding(nodeId: string, key: string): InputBinding {
  return { nodeId, inputPath: ['inputs', key], valueType: 'string' };
}

function intBinding(nodeId: string, key: string): InputBinding {
  return {
    nodeId,
    inputPath: ['inputs', key],
    valueType: 'integer-string',
  };
}

function hasInput(inputs: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(inputs, key);
}

export function detectBindings(graph: WorkflowGraph): {
  bindings: Partial<WorkflowBindings>;
} {
  const bindings: Partial<WorkflowBindings> = {};

  for (const [nodeId, node] of Object.entries(graph)) {
    const cls = node.class_type;
    const inputs = node.inputs;

    // Bind CLIP text encoders even when `text` is currently a link (array) —
    // Generation overwrites that input on queue.
    if (
      (cls.includes('CLIPTextEncode') || cls === 'CLIPTextEncode') &&
      hasInput(inputs, 'text')
    ) {
      if (!bindings.positivePrompt) {
        bindings.positivePrompt = stringBinding(nodeId, 'text');
      } else if (!bindings.negativePrompt) {
        bindings.negativePrompt = stringBinding(nodeId, 'text');
      }
    }

    if (
      (hasInput(inputs, 'seed') || hasInput(inputs, 'noise_seed')) &&
      !bindings.seed &&
      (cls.includes('Sampler') ||
        cls.includes('Seed') ||
        cls.includes('Noise'))
    ) {
      const key = hasInput(inputs, 'seed') ? 'seed' : 'noise_seed';
      bindings.seed = intBinding(nodeId, key);
    }

    // CheckpointLoader *or* UNETLoader / Load Diffusion Model (Flux, Z-Image, …).
    if (!bindings.checkpoint) {
      if (
        (cls === 'CheckpointLoaderSimple' ||
          cls.includes('CheckpointLoader')) &&
        hasInput(inputs, 'ckpt_name')
      ) {
        bindings.checkpoint = stringBinding(nodeId, 'ckpt_name');
      } else if (
        (cls === 'UNETLoader' ||
          cls.includes('UNETLoader') ||
          cls.includes('DiffusionModel')) &&
        hasInput(inputs, 'unet_name')
      ) {
        bindings.checkpoint = stringBinding(nodeId, 'unet_name');
      }
    }

    if (
      (cls.includes('VAELoader') || cls === 'VAELoader') &&
      hasInput(inputs, 'vae_name') &&
      !bindings.vae
    ) {
      bindings.vae = stringBinding(nodeId, 'vae_name');
    }

    if (
      (cls.includes('CLIPLoader') || cls === 'CLIPLoader') &&
      (hasInput(inputs, 'clip_name') || hasInput(inputs, 'clip_name1')) &&
      !bindings.clip1
    ) {
      const key = hasInput(inputs, 'clip_name') ? 'clip_name' : 'clip_name1';
      bindings.clip1 = stringBinding(nodeId, key);
    }

    if (
      (cls === 'EmptyLatentImage' ||
        cls.includes('EmptyLatent') ||
        cls.includes('EmptySD3Latent')) &&
      hasInput(inputs, 'width') &&
      hasInput(inputs, 'height')
    ) {
      if (!bindings.width) bindings.width = intBinding(nodeId, 'width');
      if (!bindings.height) bindings.height = intBinding(nodeId, 'height');
    }

    if (
      (cls.includes('SaveImage') ||
        cls === 'SaveImage' ||
        cls === 'LoraTrainingSaveOutput') &&
      !bindings.outputNode
    ) {
      bindings.outputNode = {
        nodeId,
        outputSelector: { kind: 'first-image' },
      };
    }

    if (cls === 'LoraTrainingOutputFolder' && hasInput(inputs, 'folder')) {
      if (!bindings.outputFolder) {
        bindings.outputFolder = stringBinding(nodeId, 'folder');
      }
    }

    if (cls === 'LoraTrainingOutputFilename' && hasInput(inputs, 'filename')) {
      if (!bindings.outputFilename) {
        bindings.outputFilename = stringBinding(nodeId, 'filename');
      }
    }
  }

  return { bindings };
}
