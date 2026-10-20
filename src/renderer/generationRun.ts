import type { GenerationStartRequestDto } from '../shared/contracts';

export type GenerationRunMode = 'once' | 'infinite';

export type GenerationRunHandle = {
  /** Returns an error message, or null when the job was accepted. */
  start: (
    mode: GenerationRunMode,
    folderOverride?: string,
  ) => Promise<string | null>;
};

const ACTIVE = new Set(['starting', 'queued', 'running', 'saving']);

let running = false;
const listeners = new Set<(active: boolean) => void>();

export function isGenerationRunning(): boolean {
  return running;
}

export function noteGenerationStatus(status: string | undefined): void {
  const next = ACTIVE.has(status ?? '');
  if (next === running) return;
  running = next;
  for (const listener of listeners) listener(running);
}

export function subscribeGenerationRunning(
  listener: (active: boolean) => void,
): () => void {
  listeners.add(listener);
  listener(running);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Queue the open Prompts folder when Generation has not been opened yet.
 * Uses the saved form for style, checkpoint, seed, and Recursive.
 */
export async function startPromptFolderGeneration(
  mode: GenerationRunMode,
  relativeFolder: string,
): Promise<string | null> {
  const profile = await window.wcm.comfy.getWorkflowProfile();
  if (!profile) {
    return 'Save a workflow first (Edit Workflow → Save Workflow).';
  }
  await window.wcm.comfy.setGenerationForm({
    relativeFolder,
    promptSource: 'folder',
  });
  const form = await window.wcm.comfy.getGenerationForm();
  if (form.benchmark) {
    const status = await window.wcm.comfy.getCheckpointBenchmarkStatus();
    if (!status.root) {
      return 'Set Checkpoint Benchmark folder in Library Manager';
    }
  } else if (!form.checkpoint) {
    return 'Select a checkpoint';
  }
  const request: GenerationStartRequestDto = {
    mode,
    styleProfile: form.activeProfile,
    promptSource: 'folder',
    relativeFolder,
    promptFoldersRecursive: form.promptFoldersRecursive === true,
    checkpoint: form.benchmark ? form.checkpoint || '' : form.checkpoint,
    clip: form.clip || undefined,
    vae: form.vae || undefined,
    steps: form.steps,
    cfg: form.cfg,
    samplerName: form.samplerName.trim() || undefined,
    scheduler: form.scheduler.trim() || undefined,
    denoise: form.denoise,
    seed: form.seed,
    width: form.width,
    height: form.height,
    additionalPositivePrompt: form.additionalPositivePrompt || undefined,
    negativePrompt: form.negativePrompt || undefined,
    benchmark: form.benchmark || undefined,
  };
  await window.wcm.comfy.startGeneration(request);
  return null;
}
