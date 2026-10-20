/**
 * Workflow contract resolver for Wildcards Manager Generation.
 * Tiered: LT contract nodes → LT: title markers → heuristics (detectBindings).
 *
 * Uses the shared `comfyui-lora-training` pack (same package as LoraTraining).
 */

import type {
  InputBinding,
  OutputBinding,
  WorkflowBindings,
} from '../../shared/comfyWorkflowSchema.js';
import { detectBindings } from './detectBindings.js';
import type { WorkflowGraph, WorkflowNode } from './workflowGraph.js';

export type ContractRole =
  | 'contextImage'
  | 'maskImage'
  | 'positivePrompt'
  | 'negativePrompt'
  | 'seed'
  | 'output'
  | 'checkpoint'
  | 'clip'
  | 'vae'
  | 'width'
  | 'height'
  | 'steps'
  | 'cfg'
  | 'samplerName'
  | 'scheduler'
  | 'denoise'
  | 'outputFolder'
  | 'outputFilename';

export type LocatorSource =
  | 'contract-node'
  | 'title-marker'
  | 'heuristic'
  | 'missing';

/** Shared pack class names (`comfyui-lora-training`). */
export const CONTRACT_CLASSES: Record<ContractRole, string> = {
  contextImage: 'LoraTrainingInputImage',
  maskImage: 'LoraTrainingInputImage',
  positivePrompt: 'LoraTrainingPrompt',
  negativePrompt: 'LoraTrainingNegativePrompt',
  seed: 'LoraTrainingSeed',
  output: 'LoraTrainingSaveOutput',
  checkpoint: 'LoraTrainingModel',
  clip: 'LoraTrainingCLIP',
  vae: 'LoraTrainingVAE',
  width: 'LoraTrainingWidth',
  height: 'LoraTrainingHeight',
  steps: 'LoraTrainingSteps',
  cfg: 'LoraTrainingCfg',
  samplerName: 'LoraTrainingSampler',
  scheduler: 'LoraTrainingScheduler',
  denoise: 'LoraTrainingDenoise',
  outputFolder: 'LoraTrainingOutputFolder',
  outputFilename: 'LoraTrainingOutputFilename',
};

export const TITLE_MARKERS: Record<ContractRole, string> = {
  contextImage: 'LT:CONTEXT',
  maskImage: 'LT:MASK',
  positivePrompt: 'LT:POSITIVE',
  negativePrompt: 'LT:NEGATIVE',
  seed: 'LT:SEED',
  output: 'LT:OUTPUT',
  checkpoint: 'LT:CHECKPOINT',
  clip: 'LT:CLIP',
  vae: 'LT:VAE',
  width: 'LT:WIDTH',
  height: 'LT:HEIGHT',
  steps: 'LT:STEPS',
  cfg: 'LT:CFG',
  samplerName: 'LT:SAMPLER',
  scheduler: 'LT:SCHEDULER',
  denoise: 'LT:DENOISE',
  outputFolder: 'LT:OUTFOLDER',
  outputFilename: 'LT:OUTFILE',
};

/**
 * Hard requirements to queue Generation. Checkpoint/UNET is recommended but
 * optional so Flux-style graphs with a fixed loader can still be saved; when
 * present (LT · Model / UNETLoader / CheckpointLoader) the app can swap it.
 */
const REQUIRED_ROLES: ContractRole[] = [
  'positivePrompt',
  'seed',
  'output',
];

const ALL_ROLES: ContractRole[] = [
  'contextImage',
  'maskImage',
  'positivePrompt',
  'negativePrompt',
  'seed',
  'output',
  'checkpoint',
  'clip',
  'vae',
  'width',
  'height',
  'steps',
  'cfg',
  'samplerName',
  'scheduler',
  'denoise',
  'outputFolder',
  'outputFilename',
];

const ROLE_LABELS: Record<ContractRole, string> = {
  contextImage: 'Context image',
  maskImage: 'Mask',
  positivePrompt: 'Positive prompt',
  negativePrompt: 'Negative prompt',
  seed: 'Seed',
  output: 'Output image',
  checkpoint: 'Checkpoint',
  clip: 'CLIP',
  vae: 'VAE',
  width: 'Width',
  height: 'Height',
  steps: 'Steps',
  cfg: 'CFG',
  samplerName: 'Sampler',
  scheduler: 'Scheduler',
  denoise: 'Denoise',
  outputFolder: 'Output folder',
  outputFilename: 'Output filename',
};

const INPUT_KEYS: Record<Exclude<ContractRole, 'output'>, string[]> = {
  contextImage: ['image_path', 'image'],
  maskImage: ['image_path', 'image'],
  positivePrompt: ['text'],
  negativePrompt: ['text'],
  seed: ['value', 'seed', 'noise_seed'],
  checkpoint: ['model_name', 'ckpt_name', 'unet_name', 'checkpoint'],
  clip: ['clip_name', 'clip_name1'],
  vae: ['vae_name'],
  width: ['value', 'width'],
  height: ['value', 'height'],
  steps: ['value', 'steps'],
  cfg: ['value', 'cfg'],
  samplerName: ['sampler_name', 'value'],
  scheduler: ['scheduler', 'value'],
  denoise: ['value', 'denoise'],
  outputFolder: ['folder'],
  outputFilename: ['filename'],
};

export type RoleResolution = {
  role: ContractRole;
  label: string;
  required: boolean;
  resolved: boolean;
  via: LocatorSource;
  nodeId?: string;
  hint?: string;
};

export type ContractResolution = {
  bindings: Partial<WorkflowBindings>;
  roles: RoleResolution[];
  requiredMissing: ContractRole[];
  usesContractNodes: boolean;
};

function findByClass(
  graph: WorkflowGraph,
  classType: string,
): [string, WorkflowNode] | undefined {
  return Object.entries(graph).find(([, n]) => n.class_type === classType);
}

function findByTitle(
  graph: WorkflowGraph,
  marker: string,
): [string, WorkflowNode] | undefined {
  const needle = marker.toLowerCase();
  return Object.entries(graph).find(([, n]) =>
    (n._meta?.title ?? '').toLowerCase().includes(needle),
  );
}

function pickInputKey(
  node: WorkflowNode,
  role: Exclude<ContractRole, 'output'>,
): string {
  const prefs = INPUT_KEYS[role];
  const present = prefs.find((k) => k in node.inputs);
  return present ?? prefs[0]!;
}

function valueTypeFor(role: ContractRole): InputBinding['valueType'] {
  if (role === 'steps') return 'integer';
  if (role === 'cfg' || role === 'denoise') return 'number';
  if (role === 'seed' || role === 'width' || role === 'height') {
    return 'integer-string';
  }
  return 'string';
}

function inputBinding(
  nodeId: string,
  key: string,
  role: ContractRole,
): InputBinding {
  return { nodeId, inputPath: ['inputs', key], valueType: valueTypeFor(role) };
}

function roleToBindingKey(
  role: ContractRole,
): keyof WorkflowBindings | null {
  switch (role) {
    case 'output':
      return 'outputNode';
    case 'clip':
      return 'clip1';
    default:
      return role as keyof WorkflowBindings;
  }
}

export function resolveContract(graph: WorkflowGraph): ContractResolution {
  const heuristic = detectBindings(graph).bindings;
  const bindings: Partial<WorkflowBindings> = { ...heuristic };
  const roles: RoleResolution[] = [];

  for (const role of ALL_ROLES) {
    const required = REQUIRED_ROLES.includes(role);
    // Context + mask both map to InputImage — skip duplicate class lookup for mask
    // when the same node would be claimed twice; title markers can still bind mask.
    const contractNode =
      role === 'maskImage'
        ? undefined
        : findByClass(graph, CONTRACT_CLASSES[role]);
    const titleNode = contractNode
      ? undefined
      : findByTitle(graph, TITLE_MARKERS[role]);
    const located = contractNode ?? titleNode;

    if (located) {
      const [nodeId, node] = located;
      const via: LocatorSource = contractNode
        ? 'contract-node'
        : 'title-marker';
      if (role === 'output') {
        const outputBinding: OutputBinding = {
          nodeId,
          outputSelector: { kind: 'first-image' },
        };
        bindings.outputNode = outputBinding;
      } else {
        const key = pickInputKey(node, role);
        const bindingKey = roleToBindingKey(role);
        if (bindingKey && bindingKey !== 'outputNode') {
          (bindings as Record<string, InputBinding>)[bindingKey] = inputBinding(
            nodeId,
            key,
            role,
          );
        }
      }
      roles.push({
        role,
        label: ROLE_LABELS[role],
        required,
        resolved: true,
        via,
        nodeId,
      });
      continue;
    }

    const bindingKey = roleToBindingKey(role);
    const heuristicNodeId =
      role === 'output'
        ? bindings.outputNode?.nodeId
        : bindingKey && bindingKey !== 'outputNode'
          ? (bindings[bindingKey] as InputBinding | undefined)?.nodeId
          : undefined;
    if (heuristicNodeId) {
      roles.push({
        role,
        label: ROLE_LABELS[role],
        required,
        resolved: true,
        via: 'heuristic',
        nodeId: heuristicNodeId,
        hint: 'Detected by guesswork — prefer an LT contract node or LT: title marker.',
      });
    } else {
      roles.push({
        role,
        label: ROLE_LABELS[role],
        required,
        resolved: false,
        via: 'missing',
        ...(required
          ? {
              hint: `Add ${CONTRACT_CLASSES[role]} (or title "${TITLE_MARKERS[role]}").`,
            }
          : {}),
      });
    }
  }

  const requiredMissing = roles
    .filter((r) => r.required && !r.resolved)
    .map((r) => r.role);
  const usesContractNodes = roles.some((r) => r.via === 'contract-node');

  return { bindings, roles, requiredMissing, usesContractNodes };
}

export { ROLE_LABELS, REQUIRED_ROLES, ALL_ROLES };
