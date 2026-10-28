/**
 * Ensure every seed widget uses the resolved job seed (LoraTraining pattern).
 * Binding only LT · Seed is not enough — KSampler often keeps a leftover numeric seed.
 */

import type { WorkflowGraph } from './workflowGraph.js';

const DYNAMIC_PROMPTS_CLASSES = new Set([
  'DPRandomGenerator',
  'DPCombinatorialGenerator',
  'DPFeelingLucky',
  'DPJinja',
  'DPMagicPrompt',
]);

/** Force plain seed widgets + disable randomize-after-generate. Links are left alone. */
export function forceFixedSeeds(graph: WorkflowGraph, seed: number): void {
  for (const node of Object.values(graph)) {
    const inputs = node.inputs;
    if (!inputs) continue;
    if (typeof inputs.seed === 'number') inputs.seed = seed;
    if (typeof inputs.noise_seed === 'number') inputs.noise_seed = seed;
    if (
      typeof inputs.value === 'number' &&
      node.class_type === 'LoraTrainingSeed'
    ) {
      inputs.value = seed;
    }
    if (node.class_type === 'LoraTrainingSeed') {
      inputs.value = seed;
      delete inputs.seed;
      delete inputs.control_after_generate;
      delete inputs.control_before_generate;
    }
    if (typeof inputs.control_after_generate === 'string') {
      inputs.control_after_generate = 'fixed';
    }
    if (typeof inputs.control_before_generate === 'string') {
      inputs.control_before_generate = 'fixed';
    }
    if (DYNAMIC_PROMPTS_CLASSES.has(node.class_type)) {
      if (typeof inputs.autorefresh === 'string') {
        inputs.autorefresh = 'No';
      }
    }
  }
}

/** Patch litegraph uiWorkflow metadata so extra_pnginfo matches the API seed. */
export function patchUiWorkflowSeed(uiWorkflow: unknown, seed: number): unknown {
  if (!uiWorkflow || typeof uiWorkflow !== 'object') return uiWorkflow;
  const doc = structuredClone(uiWorkflow) as {
    nodes?: Array<{
      type?: string;
      widgets_values?: unknown[];
      title?: string;
    }>;
  };
  if (!Array.isArray(doc.nodes)) return doc;

  for (const node of doc.nodes) {
    const type = node.type ?? '';
    const title = node.title ?? '';
    const isLtSeed =
      type === 'LoraTrainingSeed' ||
      title === 'LT · Seed' ||
      title.endsWith('LT · Seed');
    const wv = node.widgets_values;
    if (DYNAMIC_PROMPTS_CLASSES.has(type) && Array.isArray(wv)) {
      const arIdx = wv.findIndex(
        (v) => typeof v === 'string' && (v === 'Yes' || v === 'No'),
      );
      if (arIdx >= 0) wv[arIdx] = 'No';
    }
    if (!isLtSeed) continue;
    if (!Array.isArray(wv) || wv.length === 0) {
      node.widgets_values = [seed];
      continue;
    }
    let seedIdx = wv.findIndex((v) => typeof v === 'number');
    if (seedIdx < 0) seedIdx = 0;
    wv[seedIdx] = seed;
    const controlIdx = wv.findIndex(
      (v) =>
        typeof v === 'string' &&
        ['fixed', 'randomize', 'increment', 'decrement'].includes(
          v.toLowerCase(),
        ),
    );
    if (controlIdx >= 0) wv[controlIdx] = 'fixed';
  }
  return doc;
}

/** Write the job seed into every LT · Seed node (`value` input — not `seed`). */
export function injectLtSeedValue(
  graph: { [id: string]: { class_type: string; inputs: Record<string, unknown> } },
  seed: number,
): void {
  for (const node of Object.values(graph)) {
    if (node.class_type !== 'LoraTrainingSeed') continue;
    node.inputs.value = seed >>> 0;
  }
}
