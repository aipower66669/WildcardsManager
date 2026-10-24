/**
 * SDXL checkpoints carry a VAE. When Generation names a VAE file, that file
 * feeds every VAE socket that was coming from the checkpoint. When the field
 * is blank, those sockets go back to the checkpoint so an empty LT · VAE is
 * not what Comfy loads.
 */

import type { WorkflowGraph } from './workflowGraph.js';

const CHECKPOINT_LOADERS = new Set([
  'CheckpointLoaderSimple',
  'CheckpointLoader',
]);

function isLink(value: unknown): value is [string, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'number'
  );
}

export function applyCheckpointVaeOverride(
  graph: WorkflowGraph,
  vaeName: string | undefined,
): void {
  const name = vaeName?.trim() ?? '';
  const checkpointId = Object.entries(graph).find(([, node]) =>
    CHECKPOINT_LOADERS.has(node.class_type),
  )?.[0];
  if (!checkpointId) return;

  const loaderId = Object.entries(graph).find(
    ([, node]) => node.class_type === 'VAELoader',
  )?.[0];

  if (!name) {
    if (!loaderId) return;
    for (const node of Object.values(graph)) {
      if (node.class_type === 'VAELoader') continue;
      for (const [key, value] of Object.entries(node.inputs)) {
        if (!isLink(value)) continue;
        if (value[0] === loaderId && value[1] === 0) {
          node.inputs[key] = [checkpointId, 2];
        }
      }
    }
    return;
  }

  let targetId = loaderId;
  if (!targetId) {
    targetId = 'wcm_vae_override';
    graph[targetId] = {
      class_type: 'VAELoader',
      inputs: { vae_name: name },
      _meta: { title: 'VAE' },
    };
  } else {
    const current = graph[targetId]!.inputs.vae_name;
    if (!isLink(current)) graph[targetId]!.inputs.vae_name = name;
  }

  for (const node of Object.values(graph)) {
    if (node.class_type === 'VAELoader') continue;
    for (const [key, value] of Object.entries(node.inputs)) {
      if (!isLink(value)) continue;
      if (value[0] === checkpointId && value[1] === 2) {
        node.inputs[key] = [targetId, 0];
      }
    }
  }
}
