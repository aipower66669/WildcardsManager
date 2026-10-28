import { parentPort } from 'node:worker_threads';
import fs from 'node:fs/promises';
import {
  applyBindings,
  type GenerationValues,
} from './applyBindings.js';
import { samplerNodeIds } from './benchmarkTiming.js';
import { applyCheckpointVaeOverride } from './checkpointVaeOverride.js';
import { injectLtSeedValue } from './forceSeeds.js';
import { isWorkflowGraph } from './workflowGraph.js';
import type { WorkflowProfile } from '../../shared/comfyWorkflowSchema.js';

export type PromptProfileStat = {
  path: string;
  mtimeMs: number;
  size: number;
};

export type PromptPostWorkerRequest = PromptProfileStat & {
  id: number;
  op: 'load' | 'post';
  url?: string;
  headers?: Record<string, string>;
  clientId?: string;
  seed?: number;
  values?: GenerationValues;
};

export type PromptPostWorkerResponse = {
  id: number;
  ok: boolean;
  error?: string;
  samplerIds?: string[];
  promptId?: string;
  number?: number;
};

type CachedProfile = PromptProfileStat & { profile: WorkflowProfile };

let cached: CachedProfile | null = null;

if (!parentPort) {
  throw new Error('promptPostWorker must run as a worker thread');
}

const port = parentPort;

async function loadProfile(stat: PromptProfileStat): Promise<WorkflowProfile> {
  if (
    cached &&
    cached.path === stat.path &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.size === stat.size
  ) {
    return cached.profile;
  }
  const raw = JSON.parse(await fs.readFile(stat.path, 'utf8')) as WorkflowProfile;
  if (raw?.formatVersion !== 1 || !raw.workflow || !raw.bindings) {
    throw new Error('Saved workflow profile is invalid');
  }
  if (!isWorkflowGraph(raw.workflow)) {
    throw new Error('Saved workflow profile is invalid');
  }
  cached = { ...stat, profile: raw };
  return raw;
}

function emptyUiWorkflow(): Record<string, unknown> {
  return {
    nodes: [],
    links: [],
    groups: [],
    config: {},
    extra: {},
    version: 0.4,
  };
}

async function handle(msg: PromptPostWorkerRequest): Promise<PromptPostWorkerResponse> {
  const profile = await loadProfile(msg);
  if (!isWorkflowGraph(profile.workflow)) {
    throw new Error('Saved workflow profile is invalid');
  }
  if (msg.op === 'load') {
    return {
      id: msg.id,
      ok: true,
      samplerIds: [...samplerNodeIds(profile.workflow)],
    };
  }
  if (!msg.values || !msg.url || !msg.clientId || msg.seed == null) {
    throw new Error('Prompt post is missing generation values');
  }
  const graph = applyBindings(profile.workflow, profile.bindings, msg.values);
  applyCheckpointVaeOverride(graph, msg.values.vae);
  injectLtSeedValue(graph, msg.seed);
  const ui =
    profile.uiWorkflow && typeof profile.uiWorkflow === 'object'
      ? profile.uiWorkflow
      : emptyUiWorkflow();
  const body = JSON.stringify({
    prompt: graph,
    client_id: msg.clientId,
    extra_data: { extra_pnginfo: { workflow: ui } },
  });
  const res = await fetch(msg.url, {
    method: 'POST',
    headers: msg.headers ?? { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `ComfyUI rejected the prompt (HTTP ${res.status}): ${text.slice(0, 500)}`,
    );
  }
  const json = (await res.json()) as Record<string, unknown>;
  return {
    id: msg.id,
    ok: true,
    promptId: String(json['prompt_id']),
    number: typeof json['number'] === 'number' ? json['number'] : undefined,
  };
}

let chain: Promise<void> = Promise.resolve();

port.on('message', (msg: PromptPostWorkerRequest) => {
  chain = chain.then(async () => {
    try {
      port.postMessage(await handle(msg));
    } catch (error) {
      const response: PromptPostWorkerResponse = {
        id: msg.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      port.postMessage(response);
    }
  });
});
