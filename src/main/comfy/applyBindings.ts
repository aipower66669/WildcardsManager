/**
 * Apply semantic bindings to a cloned workflow graph before submission.
 */

import type {
  InputBinding,
  WorkflowBindings,
} from '../../shared/comfyWorkflowSchema.js';
import { setByPath, type WorkflowGraph } from './workflowGraph.js';

export type GenerationValues = {
  positivePrompt: string;
  negativePrompt?: string;
  /** Seed as a decimal string; large seeds stay exact. */
  seed: string;
  contextFilename?: string;
  maskFilename?: string;
  checkpoint?: string;
  clip?: string;
  vae?: string;
  steps?: number;
  cfg?: number;
  denoise?: number;
  width?: number;
  height?: number;
  /** Absolute path for LT · Output Folder. */
  outputFolder?: string;
  /** Stem for LT · Output Filename (e.g. WCG). */
  outputFilename?: string;
};

function coerce(
  binding: InputBinding,
  value: string | number,
): string | number | boolean {
  switch (binding.valueType) {
    case 'string':
      return String(value);
    case 'integer-string': {
      try {
        const bi = BigInt(String(value).trim());
        const asNum = Number(bi);
        if (Number.isSafeInteger(asNum)) return asNum;
        return Number(bi & 0xffffffffn);
      } catch {
        return String(value);
      }
    }
    case 'integer':
      return Math.trunc(Number(value));
    case 'number':
      return Number(value);
    case 'boolean':
      return Boolean(value);
    default:
      return value;
  }
}

export function validateBindingsAgainstGraph(
  graph: WorkflowGraph,
  bindings: WorkflowBindings,
): string[] {
  const errors: string[] = [];
  const checkInput = (role: string, binding: InputBinding | undefined) => {
    if (!binding) return;
    const node = graph[binding.nodeId];
    if (!node) {
      errors.push(`${role}: node ${binding.nodeId} no longer exists.`);
      return;
    }
    const key = binding.inputPath[binding.inputPath.length - 1];
    if (key && binding.inputPath[0] === 'inputs' && !(key in node.inputs)) {
      errors.push(
        `${role}: input "${key}" is missing on node ${binding.nodeId}.`,
      );
    }
  };
  checkInput('positivePrompt', bindings.positivePrompt);
  checkInput('negativePrompt', bindings.negativePrompt);
  checkInput('seed', bindings.seed);
  checkInput('contextImage', bindings.contextImage);
  checkInput('maskImage', bindings.maskImage);
  checkInput('checkpoint', bindings.checkpoint);
  checkInput('clip1', bindings.clip1);
  checkInput('vae', bindings.vae);
  checkInput('steps', bindings.steps);
  checkInput('cfg', bindings.cfg);
  checkInput('denoise', bindings.denoise);
  checkInput('width', bindings.width);
  checkInput('height', bindings.height);
  checkInput('outputFolder', bindings.outputFolder);
  checkInput('outputFilename', bindings.outputFilename);
  if (bindings.outputNode && !graph[bindings.outputNode.nodeId]) {
    errors.push(
      `outputNode: node ${bindings.outputNode.nodeId} no longer exists.`,
    );
  }
  if (!bindings.positivePrompt) {
    errors.push('positivePrompt: not bound — add LT · Prompt or CLIPTextEncode.');
  }
  if (!bindings.seed) {
    errors.push('seed: not bound — add LT · Seed or a sampler with seed.');
  }
  // History preview needs a Save Image / LT · Save Output; disk preview only
  // needs LT · Output Folder (LoraTraining-style absolute save).
  if (!bindings.outputNode && !bindings.outputFolder) {
    errors.push(
      'output: not bound — add LT · Output Folder (and a save node), or LT · Save Output / Save Image.',
    );
  }
  return errors;
}

export function applyBindings(
  graph: WorkflowGraph,
  bindings: WorkflowBindings,
  values: GenerationValues,
): WorkflowGraph {
  const errors = validateBindingsAgainstGraph(graph, bindings);
  if (errors.length > 0) {
    throw new Error(
      `Workflow bindings invalid: ${errors.slice(0, 3).join(' ')}`,
    );
  }

  const clone = structuredClone(graph);
  const apply = (
    binding: InputBinding | undefined,
    value: string | number | undefined,
  ) => {
    if (!binding || value === undefined) return;
    const node = clone[binding.nodeId];
    if (node) setByPath(node, binding.inputPath, coerce(binding, value));
  };

  apply(bindings.positivePrompt, values.positivePrompt);
  apply(bindings.negativePrompt, values.negativePrompt);
  apply(bindings.seed, values.seed);
  apply(bindings.contextImage, values.contextFilename);
  apply(bindings.maskImage, values.maskFilename);
  apply(bindings.checkpoint, values.checkpoint);
  apply(bindings.clip1, values.clip);
  apply(bindings.vae, values.vae);
  apply(bindings.width, values.width);
  apply(bindings.height, values.height);
  apply(bindings.steps, values.steps);
  apply(bindings.cfg, values.cfg);
  apply(bindings.denoise, values.denoise);
  apply(bindings.outputFolder, values.outputFolder);
  apply(bindings.outputFilename, values.outputFilename);

  return clone;
}
