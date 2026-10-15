/**
 * Helpers for API-format ComfyUI workflow graphs.
 */

import type { WorkflowNodeInfo } from '../../shared/comfyWorkflowSchema.js';

export type WorkflowGraph = Record<string, WorkflowNode>;

export interface WorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

/** True when the value looks like an API-format workflow graph. */
export function isWorkflowGraph(value: unknown): value is WorkflowGraph {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.values(value as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every((node) => {
    if (typeof node !== 'object' || node === null) return false;
    const n = node as Record<string, unknown>;
    return (
      typeof n['class_type'] === 'string' &&
      typeof n['inputs'] === 'object' &&
      n['inputs'] !== null
    );
  });
}

export function listNodes(graph: WorkflowGraph): WorkflowNodeInfo[] {
  return Object.entries(graph).map(([nodeId, node]) => ({
    nodeId,
    classType: node.class_type,
    ...(node._meta?.title ? { title: node._meta.title } : {}),
    inputKeys: Object.keys(node.inputs),
  }));
}

/** Set a value at inputPath (e.g. ["inputs", "text"]) within a node. */
export function setByPath(
  node: WorkflowNode,
  inputPath: string[],
  value: unknown,
): boolean {
  if (inputPath.length === 0) return false;
  let cursor: Record<string, unknown> = node as unknown as Record<
    string,
    unknown
  >;
  for (let i = 0; i < inputPath.length - 1; i += 1) {
    const key = inputPath[i]!;
    const next = cursor[key];
    if (typeof next !== 'object' || next === null) return false;
    cursor = next as Record<string, unknown>;
  }
  cursor[inputPath[inputPath.length - 1]!] = value;
  return true;
}

export function cloneGraph(graph: WorkflowGraph): WorkflowGraph {
  return structuredClone(graph);
}
