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
import type { GenerationFamily } from '../../shared/contracts.js';
import { getActiveLibrary } from '../settingsStore.js';
import { resolveContract, ROLE_LABELS, type ContractRole } from './contract.js';

export function activeWorkflowFamily(): GenerationFamily {
  try {
    return getActiveLibrary().generationFamily === 'sdxl' ? 'sdxl' : 'krea2';
  } catch {
    return 'krea2';
  }
}

function profilePath(family: GenerationFamily): string {
  return path.join(app.getPath('userData'), `comfy-workflow-${family}.json`);
}

/** First load copies the old single file into the Krea slot and leaves it there. */
function migrateLegacyKreaWorkflow(): void {
  const dir = app.getPath('userData');
  const legacy = path.join(dir, 'comfy-workflow.json');
  const krea = profilePath('krea2');
  if (fs.existsSync(krea) || !fs.existsSync(legacy)) return;
  fs.copyFileSync(legacy, krea);
}

function hashWorkflow(workflow: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(workflow))
    .digest('hex')
    .slice(0, 24);
}

export function loadWorkflowProfile(
  family: GenerationFamily = activeWorkflowFamily(),
): WorkflowProfile | null {
  try {
    migrateLegacyKreaWorkflow();
    const raw = JSON.parse(
      fs.readFileSync(profilePath(family), 'utf8'),
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
  family: GenerationFamily = activeWorkflowFamily(),
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
  const existing = loadWorkflowProfile(family);
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
    ...(resolved.bindings.upscaler
      ? { upscaler: resolved.bindings.upscaler }
      : {}),
    ...(resolved.bindings.upscaleFactor
      ? { upscaleFactor: resolved.bindings.upscaleFactor }
      : {}),
    ...(resolved.bindings.hiresDenoise
      ? { hiresDenoise: resolved.bindings.hiresDenoise }
      : {}),
    ...(resolved.bindings.clipSkip
      ? { clipSkip: resolved.bindings.clipSkip }
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

  const file = profilePath(family);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');

  return {
    profile,
    warnings,
    contractOk: resolved.requiredMissing.length === 0,
  };
}
