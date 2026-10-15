import { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  GenerationProgressDto,
  GenerationStartRequestDto,
  GenerationStyleProfileIdDto,
} from '../../shared/contracts.js';
import { IPC } from '../../shared/contracts.js';
import { GENERATION_OUTPUT_FILENAME } from '../../shared/comfy.js';
import { applyBindings } from './applyBindings.js';
import { ComfyAdapter } from './adapter.js';
import {
  getComfyConnection,
  readComfyApiKey,
} from './comfySettings.js';
import { ensureComfyRunning } from './ensureComfyRunning.js';
import { forceFixedSeeds, patchUiWorkflowSeed } from './forceSeeds.js';
import { resolveGenerationOutputRoot } from './generationOutputRoots.js';
import { loadWorkflowProfile } from './workflowStore.js';
import { isWorkflowGraph } from './workflowGraph.js';
import { loadSettings } from '../settingsStore.js';
import {
  extractGenerationPromptsFromImage,
  selectLastOutputPrompts,
  type GenerationImagePrompts,
} from '../../domain/generationImagePrompt.js';
import {
  chooseGenPrompt,
  createMulberry32,
  pickGenPrompt,
  stripTestingGenTag,
} from '../../domain/genPrompts.js';
import { GenFolderDeck } from '../../domain/genFolderDeck.js';
import {
  expandGenLine,
  getLoadedGenPrompts,
  listGenPromptFolders,
  listGenPromptFoldersUnder,
  loadGenPrompts,
} from '../promptsService.js';
import { ensureCheckpointIndex } from '../checkpointService.js';
import {
  recordBenchmarkRun,
  resolveBenchmarkOutputRoot,
  resolveNextBenchmarkSlot,
} from './checkpointBenchmarkService.js';
import {
  assertGenerationRequest,
  canRunGenerationRequest,
  generationRequestFromForm,
  loadGenerationForm,
  saveGenerationPreview,
} from './generationFormStore.js';
import {
  generationPreviewUrlForBytes,
  generationPreviewUrlForFile,
} from './generationPreview.js';
import { BENCHMARK_IMAGES_PER_CHECKPOINT } from '../../domain/checkpointBenchmark.js';

let cancelled = false;
let running = false;
/** Shuffled !gen.txt folders for the current Once / Infinite run. */
const genFolderDeck = new GenFolderDeck();
let progress: GenerationProgressDto = {
  status: 'idle',
  mode: null,
  relativeFolder: null,
  jobsCompleted: 0,
};

function emit(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(IPC.comfyGenerationProgress, progress);
    } catch {
      // ignore
    }
  }
}

function setProgress(patch: Partial<GenerationProgressDto>): void {
  progress = { ...progress, ...patch };
  emit();
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/**
 * UI seed → job seed. ≤0 (and non-finite) means random per job — same contract
 * as LT · Seed’s docs. Always a uint32 suitable for the node’s `value` input.
 */
function resolveJobSeed(uiSeed: unknown): number {
  const n = typeof uiSeed === 'number' ? uiSeed : Number(uiSeed);
  if (!Number.isFinite(n) || n <= 0) return randomSeed();
  return Math.floor(n) >>> 0;
}

/** Write the job seed into every LT · Seed node (`value` input — not `seed`). */
function injectLtSeedValue(
  graph: { [id: string]: { class_type: string; inputs: Record<string, unknown> } },
  seed: number,
): void {
  for (const node of Object.values(graph)) {
    if (node.class_type !== 'LoraTrainingSeed') continue;
    node.inputs.value = seed >>> 0;
  }
}

const IMAGE_FILE_RE = /\.(png|jpe?g|webp)$/i;

/**
 * Newest image written for this job under the LT · Output Folder.
 * Only the generation stem (`WCG.png`, `WCG_00001_.png`, …) is considered.
 * Numbered files already older than this job are skipped on later polls so a
 * large output folder is not stat'd in full every tick.
 */
async function findNewestOutputFile(
  dir: string,
  minMtimeMs: number | undefined,
  olderThanJob: Set<string>,
): Promise<string | null> {
  if (!dir) return null;
  let names: string[] = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return null;
  }
  const stem = GENERATION_OUTPUT_FILENAME.toLowerCase();
  const preferred = names.filter((n) => {
    const lower = n.toLowerCase();
    return (
      IMAGE_FILE_RE.test(lower) &&
      (lower === `${stem}${path.extname(lower)}` ||
        lower.startsWith(`${stem}_`) ||
        lower.startsWith(`${stem}.`))
    );
  });
  const floor = minMtimeMs != null ? minMtimeMs - 5000 : null;
  let best: { abs: string; mtime: number } | null = null;
  for (const name of preferred) {
    const lower = name.toLowerCase();
    const ext = path.extname(lower);
    const exactStem = lower === `${stem}${ext}`;
    if (!exactStem && olderThanJob.has(name)) continue;
    const abs = path.join(dir, name);
    try {
      const st = await fs.promises.stat(abs);
      if (!st.isFile()) continue;
      if (floor != null && st.mtimeMs < floor) {
        if (!exactStem) olderThanJob.add(name);
        continue;
      }
      if (!best || st.mtimeMs > best.mtime) {
        best = { abs, mtime: st.mtimeMs };
      }
    } catch {
      // skip
    }
  }
  return best?.abs ?? null;
}

/** Wait until Comfy finishes the prompt (success or error). */
async function waitForExecutionComplete(
  adapter: ComfyAdapter,
  clientId: string,
  promptId: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      dispose();
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error('ComfyUI execution timed out')),
      10 * 60 * 1000,
    );
    const dispose = adapter.monitor(clientId, (event) => {
      if (cancelled) {
        clearTimeout(timer);
        finish(new Error('cancelled'));
        return;
      }
      if (event.type === 'execution_error' && event.promptId === promptId) {
        clearTimeout(timer);
        finish(new Error(event.message || 'ComfyUI execution error'));
        return;
      }
      if (
        (event.type === 'execution_success' && event.promptId === promptId) ||
        (event.type === 'executing' &&
          event.promptId === promptId &&
          event.node === null)
      ) {
        clearTimeout(timer);
        // Small delay so save nodes can flush to disk / history.
        setTimeout(() => finish(), 300);
      }
    });
    const poll = async () => {
      while (!settled) {
        if (cancelled) {
          clearTimeout(timer);
          finish(new Error('cancelled'));
          return;
        }
        try {
          const hist = await adapter.getHistoryBrief(promptId);
          if (hist.completed) {
            if (hist.statusStr === 'error') {
              clearTimeout(timer);
              finish(new Error('ComfyUI execution failed'));
              return;
            }
            if (hist.statusStr === 'success') {
              clearTimeout(timer);
              setTimeout(() => finish(), 300);
              return;
            }
          }
        } catch {
          // retry
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    };
    void poll();
  });
}

/**
 * Prefer the LT output folder on disk (how LoraTraining gets previews).
 * Fall back to Comfy /history + /view when the save node reports UI images.
 */
async function loadGeneratedPreviewUrl(
  adapter: ComfyAdapter,
  promptId: string,
  ltOutputFolder: string,
  jobStartedMs: number,
): Promise<{
  absolutePath: string | null;
  previewUrl: string;
  /** File bytes when known (history fallback) — used for caption metadata. */
  bytes?: Buffer;
}> {
  const deadline = Date.now() + 45_000;
  const olderThanJob = new Set<string>();
  let lastHistoryAt = 0;
  while (Date.now() < deadline) {
    if (cancelled) throw new Error('cancelled');

    const fromDisk = await findNewestOutputFile(
      ltOutputFolder,
      jobStartedMs,
      olderThanJob,
    );
    if (fromDisk) {
      return {
        absolutePath: fromDisk,
        previewUrl: generationPreviewUrlForFile(fromDisk),
      };
    }

    const now = Date.now();
    if (now - lastHistoryAt >= 2_000) {
      lastHistoryAt = now;
      try {
        const hist = await adapter.getHistoryBrief(promptId);
        const ref = hist.image;
        if (ref) {
          try {
            const bytes = await adapter.getImage(ref);
            const ext = path.extname(ref.filename).toLowerCase() || '.png';
            return {
              absolutePath: null,
              previewUrl: await generationPreviewUrlForBytes(bytes, ext),
              bytes,
            };
          } catch {
            // keep polling disk
          }
        }
      } catch {
        // retry — Comfy HTTP is often busy while a model is loading
      }
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error(
    `No output image found in “${ltOutputFolder}” (or Comfy history). Check that the workflow saves via LT · Output Folder / Filename (stem ${GENERATION_OUTPUT_FILENAME}).`,
  );
}

/** Fallback prompts-folder relative path for free-text generations. */
const MANUAL_OUTPUT_FOLDER = '_manual';

function resolveStyleProfile(
  request: GenerationStartRequestDto,
): GenerationStyleProfileIdDto {
  const fromRequest = request.styleProfile;
  if (
    fromRequest === 'realistic' ||
    fromRequest === 'hentai' ||
    fromRequest === '3d'
  ) {
    return fromRequest;
  }
  return loadGenerationForm().activeProfile;
}

async function runJob(
  adapter: ComfyAdapter,
  request: GenerationStartRequestDto,
  benchmarkSlot?: {
    stem: string;
    outputFolder: string;
    imageCount: number;
    completedCheckpoints: number;
    totalCheckpoints: number;
    remainingImages: number;
  } | null,
): Promise<void> {
  const profile = loadWorkflowProfile();
  if (!profile) throw new Error('Save a Comfy workflow profile first (Edit Workflow → Save Workflow)');
  if (!isWorkflowGraph(profile.workflow)) {
    throw new Error('Saved workflow profile is invalid');
  }

  const promptSource = request.promptSource === 'text' ? 'text' : 'folder';
  const styleProfile = resolveStyleProfile(request);
  const outputRoot = resolveGenerationOutputRoot(styleProfile);
  let line: string;
  /** Relative prompts path used for in-app sample copy (folder mode / _manual). */
  let reviewRelativeFolder: string;
  /** Absolute path injected into LT · Output Folder. */
  let ltOutputFolder: string;

  // Resolve seed before picking/expanding so folder-mode selection is reproducible.
  const seed = resolveJobSeed(request.seed);

  if (promptSource === 'text') {
    try {
      line = chooseGenPrompt(request.promptText ?? '', seed);
    } catch {
      throw new Error('Enter a prompt');
    }
    // Typed prompt → style output root (replaces the old single Generation folder).
    ltOutputFolder = outputRoot;
    reviewRelativeFolder =
      request.relativeFolder?.trim() || MANUAL_OUTPUT_FOLDER;
  } else {
    let folder = request.relativeFolder?.trim() ?? '';
    const recursive = request.promptFoldersRecursive === true;
    if (!folder) {
      const choices = listGenPromptFolders();
      if (choices.length === 0) {
        throw new Error('No prompt folders with !gen.txt to randomize');
      }
      folder = genFolderDeck.next(() => choices);
    } else if (recursive) {
      const choices = listGenPromptFoldersUnder(folder);
      if (choices.length === 0) {
        throw new Error(
          `No !gen.txt under “${folder}” (enable Recursive only when this folder or a sub-folder has prompts)`,
        );
      }
      folder = genFolderDeck.next(() => choices);
    }
    const promptsRoot = loadSettings().promptsFolder?.trim();
    if (!promptsRoot) {
      throw new Error('No prompts folder configured for this library');
    }
    loadGenPrompts(folder);
    const prompts = getLoadedGenPrompts(folder);
    line = pickGenPrompt(prompts, seed);
    reviewRelativeFolder = folder;
    // Selected prompt folder → `{styleOutputRoot}/{selected}/New`
    ltOutputFolder = path.resolve(outputRoot, folder, 'New');
  }

  if (benchmarkSlot) {
    ltOutputFolder = benchmarkSlot.outputFolder;
  }

  fs.mkdirSync(ltOutputFolder, { recursive: true });

  setProgress({
    status: 'running',
    relativeFolder: reviewRelativeFolder,
    seed,
    error: undefined,
    ...(benchmarkSlot
      ? {
          detail: `Benchmark: ${benchmarkSlot.stem} (${benchmarkSlot.imageCount}/${BENCHMARK_IMAGES_PER_CHECKPOINT})`,
          benchmarkStem: benchmarkSlot.stem,
          benchmarkImageCount: benchmarkSlot.imageCount,
          benchmarkTargetImages: BENCHMARK_IMAGES_PER_CHECKPOINT,
          benchmarkCompletedCheckpoints: benchmarkSlot.completedCheckpoints,
          benchmarkTotalCheckpoints: benchmarkSlot.totalCheckpoints,
          benchmarkRemainingImages: benchmarkSlot.remainingImages,
        }
      : {
          benchmarkStem: null,
          benchmarkImageCount: null,
          benchmarkTargetImages: null,
          benchmarkCompletedCheckpoints: null,
          benchmarkTotalCheckpoints: null,
          benchmarkRemainingImages: null,
        }),
  });
  // Paint "running" before sync wildcard expansion. The prompt POST is what
  // makes ComfyUI print "Model Initializing"; that wait itself stays async.
  await new Promise((resolve) => setImmediate(resolve));

  // Never send `[TESTING]` to Comfy — pick already strips it; belt-and-suspenders here.
  line = stripTestingGenTag(line).trim();
  if (!line) {
    throw new Error('Expanded prompt was empty');
  }

  const expanded = expandGenLine(line, seed);
  if (!expanded.text.trim()) {
    throw new Error('Expanded prompt was empty');
  }
  // Expand Additional Positive here too — Comfy Dynamic Prompts does it in the
  // graph, but PNG metadata usually still stores the pre-expansion LT · Prompt
  // text (CLIP gets a node link, not the resolved string).
  const extraRaw = request.additionalPositivePrompt?.trim() ?? '';
  const extraPositive = extraRaw
    ? expandGenLine(extraRaw, seed).text.trim()
    : '';
  const positivePrompt = extraPositive
    ? `${expanded.text.trim()}, ${extraPositive}`
    : expanded.text.trim();

  const graph = applyBindings(profile.workflow, profile.bindings, {
    positivePrompt,
    negativePrompt: request.negativePrompt ?? '',
    seed: String(seed),
    checkpoint: request.checkpoint,
    clip: request.clip,
    vae: request.vae,
    width: request.width,
    height: request.height,
    outputFolder: ltOutputFolder,
    outputFilename: GENERATION_OUTPUT_FILENAME,
  });
  // LT · Seed reads `value` (not `seed`). Always set it explicitly so a stale
  // binding path or leftover widget key cannot leave a fixed seed in place.
  injectLtSeedValue(graph, seed);

  const clientId = randomUUID();
  const jobStartedMs = Date.now();
  const queued = await adapter.queuePrompt(graph, clientId, {
    uiWorkflow: profile.uiWorkflow,
  });
  await waitForExecutionComplete(adapter, clientId, queued.promptId);

  setProgress({ status: 'saving' });
  const output = await loadGeneratedPreviewUrl(
    adapter,
    queued.promptId,
    ltOutputFolder,
    jobStartedMs,
  );

  // Short preview URL. Bytes stay in the workflow file and stream via wcm-gen://.
  const lastImageUrl = output.previewUrl;
  // Same metadata path as My File Explorer (parameters / comment), with a short
  // retry — savers sometimes finish the PNG text chunks a tick after the file appears.
  const fromImage = output.absolutePath
    ? await readPromptsFromOutputImage(output.absolutePath)
    : output.bytes
      ? extractGenerationPromptsFromImage(output.bytes)
      : null;
  const captions = selectLastOutputPrompts(
    fromImage,
    positivePrompt,
    request.negativePrompt,
  );

  if (benchmarkSlot) {
    try {
      const root = resolveBenchmarkOutputRoot();
      recordBenchmarkRun({
        root,
        stem: benchmarkSlot.stem,
        relativePath: request.checkpoint,
        durationMs: Date.now() - jobStartedMs,
        seed,
        outputFile: output.absolutePath
          ? path.basename(output.absolutePath)
          : undefined,
      });
    } catch {
      // Stats are best-effort; the image already landed.
    }
  }

  const lastRelativeFolder =
    reviewRelativeFolder.trim() && reviewRelativeFolder !== MANUAL_OUTPUT_FOLDER
      ? reviewRelativeFolder
      : null;
  setProgress({
    status: request.mode === 'once' ? 'done' : 'running',
    jobsCompleted: progress.jobsCompleted + 1,
    lastPrompt: captions.positive,
    lastNegativePrompt: captions.negative ?? undefined,
    lastRelativeFolder,
    lastSeed: seed,
    lastImageUrl,
    error: undefined,
    detail: undefined,
  });
  try {
    if (output.absolutePath) {
      saveGenerationPreview(
        captions.positive,
        output.absolutePath,
        captions.negative,
        reviewRelativeFolder,
        seed,
      );
    }
  } catch {
    // Preview restore is best-effort.
  }
}

async function readPromptsFromOutputImage(
  absolutePath: string,
): Promise<GenerationImagePrompts | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const bytes = fs.readFileSync(absolutePath);
      const prompts = extractGenerationPromptsFromImage(bytes);
      if (prompts) return prompts;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

export function getGenerationProgress(): GenerationProgressDto {
  return progress;
}

/** Drop Last output from live progress after the file is deleted. */
export function clearLastGenerationPreviewProgress(): void {
  setProgress({
    lastImageUrl: undefined,
    lastPrompt: undefined,
    lastNegativePrompt: undefined,
    lastRelativeFolder: null,
    lastSeed: null,
  });
}

export function cancelGeneration(): void {
  cancelled = true;
  const conn = getComfyConnection();
  const adapter = new ComfyAdapter(conn, {
    apiKey: readComfyApiKey(),
    apiKeyHeader: conn.apiKeyHeader,
  });
  void adapter.interrupt();
  if (running) {
    setProgress({ status: 'cancelled' });
  }
}

export async function startGeneration(
  request: GenerationStartRequestDto,
): Promise<void> {
  if (running) throw new Error('A generation job is already running');
  assertGenerationRequest(request);
  cancelled = false;
  running = true;
  // Fixed seed → deterministic folder shuffle for Randomize / Recursive.
  // Seed ≤ 0 (Random) keeps Math.random so infinite runs still vary.
  const uiSeed =
    typeof request.seed === 'number' ? request.seed : Number(request.seed);
  if (Number.isFinite(uiSeed) && uiSeed > 0) {
    genFolderDeck.reseed(createMulberry32(Math.floor(uiSeed) >>> 0));
  } else {
    genFolderDeck.reseed(Math.random);
  }
  const promptSource = request.promptSource === 'text' ? 'text' : 'folder';
  // Keep lastImageUrl / lastPrompt until this job finishes — do not blank the
  // Last output preview while the next generation is still running.
  setProgress({
    status: 'queued',
    mode: request.mode,
    relativeFolder:
      request.relativeFolder?.trim() ||
      (promptSource === 'text' ? MANUAL_OUTPUT_FOLDER : null),
    jobsCompleted: 0,
    error: undefined,
    detail: request.benchmark ? 'Benchmark…' : undefined,
  });

  const conn = getComfyConnection();
  const adapter = new ComfyAdapter(conn, {
    apiKey: readComfyApiKey(),
    apiKeyHeader: conn.apiKeyHeader,
  });

  try {
    await ensureComfyRunning({
      shouldCancel: () => cancelled,
      onStatus: (label) => {
        setProgress({ status: 'starting', detail: label, error: undefined });
      },
    });
    if (cancelled) {
      setProgress({ status: 'cancelled', detail: undefined });
      return;
    }
    setProgress({ status: 'queued', detail: undefined });

    if (request.benchmark) {
      resolveBenchmarkOutputRoot();
      await ensureCheckpointIndex();
      const firstSlot = resolveNextBenchmarkSlot();
      if (!firstSlot) {
        throw new Error(
          'Benchmark already complete — every checkpoint has 10 images',
        );
      }
    }

    do {
      if (cancelled) break;
      let jobRequest =
        request.mode === 'infinite'
          ? generationRequestFromForm(request.mode)
          : request;
      if (!canRunGenerationRequest(jobRequest)) {
        if (request.mode === 'infinite' && progress.jobsCompleted > 0) {
          break;
        }
        assertGenerationRequest(jobRequest);
      }
      let benchmarkSlot: {
        stem: string;
        outputFolder: string;
        imageCount: number;
        completedCheckpoints: number;
        totalCheckpoints: number;
        remainingImages: number;
      } | null = null;
      if (jobRequest.benchmark) {
        const slot = resolveNextBenchmarkSlot();
        if (!slot) {
          setProgress({
            detail: 'Benchmark complete',
            benchmarkStem: null,
            benchmarkRemainingImages: 0,
          });
          break;
        }
        jobRequest = { ...jobRequest, checkpoint: slot.checkpoint };
        benchmarkSlot = {
          stem: slot.stem,
          outputFolder: slot.outputFolder,
          imageCount: slot.imageCount,
          completedCheckpoints: slot.completedCheckpoints,
          totalCheckpoints: slot.totalCheckpoints,
          remainingImages: slot.remainingImages,
        };
      }
      try {
        await runJob(adapter, jobRequest, benchmarkSlot);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message === 'cancelled' || cancelled) {
          cancelled = true;
          break;
        }
        if (request.mode !== 'infinite') throw e;
        // One bad prompt or Comfy error should not end the run.
        setProgress({
          status: 'running',
          error: message,
          detail: 'Skipped — next job',
        });
        try {
          await adapter.interrupt();
        } catch {
          // The failed job may already have finished.
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      if (request.mode === 'once') break;
    } while (!cancelled);

    if (cancelled) {
      setProgress({ status: 'cancelled' });
    } else if (progress.status !== 'error') {
      setProgress({ status: 'done' });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === 'cancelled' || cancelled) {
      setProgress({ status: 'cancelled' });
    } else {
      setProgress({ status: 'error', error: message });
    }
  } finally {
    running = false;
  }
}
