import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  SaveWorkflowProfileResult,
  WorkflowBindings,
  WorkflowProfile,
} from '../../shared/comfyWorkflowSchema.js';
import { isWorkflowGraph, type WorkflowGraph } from './workflowGraph.js';
import { resolveContract, ROLE_LABELS, type ContractRole } from './contract.js';

function profilePath(): string {
  return path.join(app.getPath('userData'), 'comfy-workflow.json');
}

function hashWorkflow(workflow: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(workflow))
    .digest('hex')
    .slice(0, 24);
}

export function loadWorkflowProfile(): WorkflowProfile | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(profilePath(), 'utf8'),
    ) as WorkflowProfile;
    if (raw?.formatVersion !== 1 || !raw.workflow || !raw.bindings) {
      return null;
    }
    if (!isWorkflowGraph(raw.workflow)) return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Always persist the captured graph. Contract gaps become warnings — never a
 * failed save (so a long Edit Workflow session is never thrown away).
 */
export function saveWorkflowProfile(
  input: Partial<WorkflowProfile> & {
    workflow: Record<string, unknown>;
    name?: string;
  },
): SaveWorkflowProfileResult {
  const warnings: string[] = [];

  if (!input.workflow || typeof input.workflow !== 'object') {
    throw new Error('No workflow graph to save');
  }

  const graphOk = isWorkflowGraph(input.workflow);
  if (!graphOk) {
    warnings.push(
      'Graph does not look like a standard Comfy API prompt — saved anyway.',
    );
  }

  const resolved = graphOk
    ? resolveContract(input.workflow as WorkflowGraph)
    : {
        bindings: {} as WorkflowBindings,
        roles: [],
        requiredMissing: [
          'positivePrompt',
          'seed',
          'output',
        ] as ContractRole[],
        usesContractNodes: false,
      };

  for (const role of resolved.requiredMissing) {
    warnings.push(
      `Missing ${ROLE_LABELS[role] ?? role} binding — Generation may not run until the graph includes it.`,
    );
  }
  if (!resolved.bindings.checkpoint) {
    warnings.push(
      'No swappable model binding (LT · Model / UNETLoader / CheckpointLoader) — the graph’s current model will be used as-is.',
    );
  }

  const now = new Date().toISOString();
  const existing = loadWorkflowProfile();
  const uiWorkflow =
    input.uiWorkflow !== undefined
      ? input.uiWorkflow
      : existing?.uiWorkflow;

  const bindings: WorkflowBindings = {
    ...(resolved.bindings.positivePrompt
      ? { positivePrompt: resolved.bindings.positivePrompt }
      : {}),
    ...(resolved.bindings.seed ? { seed: resolved.bindings.seed } : {}),
    ...(resolved.bindings.outputNode
      ? { outputNode: resolved.bindings.outputNode }
      : {}),
    ...(resolved.bindings.negativePrompt
      ? { negativePrompt: resolved.bindings.negativePrompt }
      : {}),
    ...(resolved.bindings.contextImage
      ? { contextImage: resolved.bindings.contextImage }
      : {}),
    ...(resolved.bindings.maskImage
      ? { maskImage: resolved.bindings.maskImage }
      : {}),
    ...(resolved.bindings.checkpoint
      ? { checkpoint: resolved.bindings.checkpoint }
      : {}),
    ...(resolved.bindings.clip1 ? { clip1: resolved.bindings.clip1 } : {}),
    ...(resolved.bindings.vae ? { vae: resolved.bindings.vae } : {}),
    ...(resolved.bindings.width ? { width: resolved.bindings.width } : {}),
    ...(resolved.bindings.height ? { height: resolved.bindings.height } : {}),
    ...(resolved.bindings.steps ? { steps: resolved.bindings.steps } : {}),
    ...(resolved.bindings.cfg ? { cfg: resolved.bindings.cfg } : {}),
    ...(resolved.bindings.denoise
      ? { denoise: resolved.bindings.denoise }
      : {}),
    ...(resolved.bindings.samplerName
      ? { samplerName: resolved.bindings.samplerName }
      : {}),
    ...(resolved.bindings.scheduler
      ? { scheduler: resolved.bindings.scheduler }
      : {}),
    ...(resolved.bindings.outputFolder
      ? { outputFolder: resolved.bindings.outputFolder }
      : {}),
    ...(resolved.bindings.outputFilename
      ? { outputFilename: resolved.bindings.outputFilename }
      : {}),
    loras: resolved.bindings.loras ?? [],
  };

  const profile: WorkflowProfile = {
    formatVersion: 1,
    profileId: existing?.profileId ?? randomUUID(),
    name: (input.name ?? existing?.name ?? 'Default').trim() || 'Default',
    workflowHash: hashWorkflow(input.workflow),
    importedAt: existing?.importedAt ?? now,
    updatedAt: now,
    workflow: input.workflow,
    ...(uiWorkflow !== undefined ? { uiWorkflow } : {}),
    bindings,
    ...(warnings.length ? { saveWarnings: warnings } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  };

  fs.mkdirSync(path.dirname(profilePath()), { recursive: true });
  fs.writeFileSync(
    profilePath(),
    `${JSON.stringify(profile, null, 2)}\n`,
    'utf8',
  );

  return {
    profile,
    warnings,
    contractOk: resolved.requiredMissing.length === 0,
  };
}
