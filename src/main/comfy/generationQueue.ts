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
import { generationOutputNames } from '../../domain/generationOutputFile.js';
import type { GenerationValues } from './applyBindings.js';
import {
  emptySampleClock,
  noteSampleProgress,
  sampleClockDurationMs,
  type SampleClock,
} from './benchmarkTiming.js';
import { ComfyAdapter } from './adapter.js';
import {
  getComfyConnection,
  readComfyApiKey,
} from './comfySettings.js';
import { ensureComfyRunning } from './ensureComfyRunning.js';
import {
  generationImageOutputFolder,
  resolveGenerationOutputRoot,
} from './generationOutputRoots.js';
import {
  postGenerationPrompt,
  samplerIdsForWorkflow,
} from './promptPostWorkerClient.js';
import { activeWorkflowFamily, statWorkflowProfile } from './workflowStore.js';
import {
  getGenerationSaveInNewSubfolder,
  loadSettings,
} from '../settingsStore.js';
import {
  extractGenerationPromptsFromImage,
  selectLastOutputPrompts,
  type GenerationImagePrompts,
} from '../../domain/generationImagePrompt.js';
import {
  appendAdditionalPositive,
  pickGenerationPrompt,
  resolveGenerationSeed,
} from '../../domain/generationPromptPick.js';
import {
  stripTestingGenTag,
} from '../../domain/genPrompts.js';
import {
  expandGenLine,
  ensureGenPromptFolders,
  getLoadedGenPrompts,
  listGenPromptFolders,
  listGenPromptFoldersUnder,
  loadGenPrompts,
  warmGenerationLibraryIndex,
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
import { applyLibraryPromptSubstitutions } from '../promptSubstitutions.js';
import { setGenerationActive } from '../generationActivity.js';

let cancelled = false;
let running = false;
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

/**
 * Newest image ComfyUI wrote for this job under the LT · Output Folder.
 * Any image whose name starts with the stem counts (`WCG.png`,
 * `WCG_00001_.png`, `WCG_<extra>_00001.png`, …). The newest mtime wins.
 * Numbered files already older than this job are skipped on later polls.
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
  const floor = minMtimeMs != null ? minMtimeMs - 5000 : null;
  let best: { abs: string; mtime: number } | null = null;
  let checked = 0;
  for (const name of generationOutputNames(names, GENERATION_OUTPUT_FILENAME)) {
    const lower = name.toLowerCase();
    const ext = path.extname(lower);
    const exactStem = lower === `${stem}${ext}`;
    if (!exactStem && olderThanJob.has(name)) continue;
    checked += 1;
    if (checked % 48 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
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

const UNTIMED_BENCHMARK =
  'Benchmark did not record a time because ComfyUI never reported the sampler steps from the first step to the last.';

type ExecutionWatch = {
  /** Resolves once the socket is open — queue only after this. */
  opened: Promise<void>;
  /**
   * Sampler step span in ms, or null when the first-to-last step range was
   * never seen. Rejects on cancel, error, or timeout.
   */
  done: Promise<number | null>;
  setPromptId: (id: string) => void;
  dispose: () => void;
};

/**
 * Listen before the prompt is queued. Duration is the sampler step counter
 * from the opening step through the last, not wall time until the file appears.
 */
function watchExecution(
  adapter: ComfyAdapter,
  clientId: string,
  samplerIds: ReadonlySet<string>,
): ExecutionWatch {
  let promptId = '';
  let clock: SampleClock = emptySampleClock();
  let settled = false;
  let resolveDone: (durationMs: number | null) => void = () => {};
  let rejectDone: (error: Error) => void = () => {};
  const done = new Promise<number | null>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const finish = (err?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    disposeSocket();
    if (err) rejectDone(err);
    else resolveDone(sampleClockDurationMs(clock));
  };
  const timer = setTimeout(
    () => finish(new Error('ComfyUI execution timed out')),
    10 * 60 * 1000,
  );
  const { dispose: disposeSocket, opened } = adapter.monitor(clientId, (event) => {
    const eventPromptId = 'promptId' in event ? event.promptId : undefined;
    if (promptId && eventPromptId && eventPromptId !== promptId) return;
    if (
      event.type === 'progress' &&
      (event.promptId == null || !promptId || event.promptId === promptId)
    ) {
      clock = noteSampleProgress(clock, event, samplerIds, Date.now());
    }
    if (cancelled) {
      finish(new Error('cancelled'));
      return;
    }
    if (
      event.type === 'execution_error' &&
      (!promptId || event.promptId === promptId)
    ) {
      finish(new Error(event.message || 'ComfyUI execution error'));
      return;
    }
    if (
      (event.type === 'execution_success' &&
        (!promptId || event.promptId === promptId)) ||
      (event.type === 'executing' &&
        event.node === null &&
        (!promptId || event.promptId === promptId))
    ) {
      clearTimeout(timer);
      // Let a last progress frame land, and give save nodes time to flush.
      setTimeout(() => finish(), 300);
    }
  });
  const poll = async () => {
    while (!settled) {
      if (cancelled) {
        finish(new Error('cancelled'));
        return;
      }
      if (promptId) {
        try {
          const hist = await adapter.getHistoryBrief(promptId);
          if (hist.completed) {
            if (hist.statusStr === 'error') {
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
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  };
  void poll();
  // Cleanup can reject `done` after the caller has already moved on.
  void done.catch(() => {});
  return {
    opened,
    done,
    setPromptId: (id: string) => {
      promptId = id;
    },
    dispose: () => {
      if (!settled) finish(new Error('cancelled'));
    },
  };
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

type JobOutcome = 'normal' | 'timed' | 'untimed';

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
): Promise<JobOutcome> {
  const family = activeWorkflowFamily();
  const profileStat = statWorkflowProfile(family);
  if (!profileStat) {
    throw new Error(
      family === 'sdxl'
        ? 'Open WildcardManager-ComfyUI-SDXL-Generation-Workflow.json in ComfyUI, then Save Workflow.'
        : 'Save a Comfy workflow profile first (Edit Workflow → Save Workflow)',
    );
  }
  // Parse the workflow on the worker while the prompt is chosen and expanded.
  const samplerIdsPromise = samplerIdsForWorkflow(profileStat);

  const promptSource = request.promptSource === 'text' ? 'text' : 'folder';
  const styleProfile = resolveStyleProfile(request);
  const outputRoot = resolveGenerationOutputRoot(styleProfile);
  const seed = resolveGenerationSeed(request.seed);
  // Publish the roll before the folder pick. A bad !gen.txt throws before
  // the later progress update, and the next Infinite click must not look
  // like it reused this seed.
  setProgress({ status: 'running', seed, error: undefined });
  const folder = request.relativeFolder?.trim() ?? '';
  if (
    promptSource !== 'text' &&
    (!folder || request.promptFoldersRecursive === true)
  ) {
    await ensureGenPromptFolders();
  }
  const picked = pickGenerationPrompt({
    promptSource,
    promptText: request.promptText ?? '',
    promptSingle: request.promptSingle === true,
    relativeFolder: folder,
    recursive: request.promptFoldersRecursive === true,
    seed,
    listAllFolders: listGenPromptFolders,
    listFoldersUnder: listGenPromptFoldersUnder,
    loadLines: (genFolder) => {
      loadGenPrompts(genFolder);
      return getLoadedGenPrompts(genFolder);
    },
  });
  let line = picked.line;
  /** Relative prompts path used for in-app sample copy (folder mode / _manual). */
  const reviewRelativeFolder = picked.relativeFolder;
  /** Absolute path injected into LT · Output Folder. */
  let ltOutputFolder: string;
  if (promptSource === 'text') {
    // Typed prompt → style output root (replaces the old single Generation folder).
    ltOutputFolder = outputRoot;
  } else {
    const promptsRoot = loadSettings().promptsFolder?.trim();
    if (!promptsRoot) {
      throw new Error('No prompts folder configured for this library');
    }
    // ComfyUI's save node creates this directory when it writes the image.
    ltOutputFolder = generationImageOutputFolder(
      outputRoot,
      picked.relativeFolder,
      getGenerationSaveInNewSubfolder(),
    );
  }

  if (benchmarkSlot) {
    ltOutputFolder = benchmarkSlot.outputFolder;
  }

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
  // Swap generic wildcard calls for this checkpoint before expansion.
  line = applyLibraryPromptSubstitutions(line, request.checkpoint);
  if (!line.trim()) {
    throw new Error('Expanded prompt was empty');
  }

  const expanded = expandGenLine(line, seed);
  if (!expanded.text.trim()) {
    throw new Error('Expanded prompt was empty');
  }
  // Additional Positive is part of this one prompt, Single prompt or not.
  const extraRaw = request.additionalPositivePrompt?.trim() ?? '';
  const extraExpanded = extraRaw ? expandGenLine(extraRaw, seed).text.trim() : '';
  const positivePrompt = appendAdditionalPositive(
    expanded.text,
    extraExpanded || extraRaw,
  );

  const values: GenerationValues = {
    positivePrompt,
    negativePrompt: request.negativePrompt ?? '',
    seed: String(seed),
    checkpoint: request.checkpoint,
    clip: request.clip,
    vae: request.vae,
    width: request.width,
    height: request.height,
    steps: request.steps,
    cfg: request.cfg,
    denoise: request.denoise,
    upscaler: request.upscaler?.trim() || undefined,
    upscaleFactor: request.upscaleFactor,
    hiresDenoise: request.hiresDenoise,
    clipSkip:
      request.clipSkip != null && Number.isFinite(request.clipSkip)
        ? -Math.min(12, Math.max(1, Math.round(Math.abs(request.clipSkip))))
        : undefined,
    samplerName: request.samplerName?.trim() || undefined,
    scheduler: request.scheduler?.trim() || undefined,
    outputFolder: ltOutputFolder,
    outputFilename: GENERATION_OUTPUT_FILENAME,
  };

  const samplerIds = await samplerIdsPromise;
  const clientId = randomUUID();
  const jobStartedMs = Date.now();
  const watch = watchExecution(adapter, clientId, samplerIds);
  let sampleDurationMs: number | null = null;
  let promptId = '';
  try {
    await watch.opened;
    // Bindings, the UI-workflow JSON, and the POST run off this thread.
    const target = adapter.promptPostTarget();
    const queued = await postGenerationPrompt({
      stat: profileStat,
      url: target.url,
      headers: target.headers,
      clientId,
      seed,
      values,
    });
    promptId = queued.promptId;
    watch.setPromptId(promptId);
    sampleDurationMs = await watch.done;
  } finally {
    watch.dispose();
  }

  setProgress({ status: 'saving' });
  const output = await loadGeneratedPreviewUrl(
    adapter,
    promptId,
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

  if (benchmarkSlot && (sampleDurationMs == null || sampleDurationMs <= 0)) {
    // The file would count as one of the 10 images and block a real timing.
    if (output.absolutePath) fs.unlinkSync(output.absolutePath);
    return 'untimed';
  }

  if (benchmarkSlot && sampleDurationMs != null) {
    try {
      const root = resolveBenchmarkOutputRoot();
      recordBenchmarkRun({
        root,
        stem: benchmarkSlot.stem,
        relativePath: request.checkpoint,
        durationMs: sampleDurationMs,
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
  return benchmarkSlot ? 'timed' : 'normal';
}

async function readPromptsFromOutputImage(
  absolutePath: string,
): Promise<GenerationImagePrompts | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const bytes = await fs.promises.readFile(absolutePath);
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
  setGenerationActive(true);
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

  const profileStat = statWorkflowProfile(activeWorkflowFamily());
  if (profileStat) void samplerIdsForWorkflow(profileStat);
  setImmediate(() => {
    try {
      warmGenerationLibraryIndex();
    } catch {
      // The first expand reports a missing library.
    }
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

    let untimedStreak = 0;
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
      let outcome: JobOutcome = 'normal';
      try {
        outcome = await runJob(adapter, jobRequest, benchmarkSlot);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message === 'cancelled' || cancelled) {
          cancelled = true;
          break;
        }
        if (request.mode !== 'infinite') throw e;
        // One bad prompt or Comfy error should not end the run.
        const rolled =
          typeof progress.seed === 'number' && Number.isFinite(progress.seed)
            ? ` (seed ${progress.seed >>> 0})`
            : '';
        setProgress({
          status: 'running',
          error: message.includes('(seed ') ? message : `${message}${rolled}`,
          detail: 'Skipped — next job',
        });
        try {
          await adapter.interrupt();
        } catch {
          // The failed job may already have finished.
        }
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      if (outcome === 'untimed') {
        untimedStreak += 1;
        if (request.mode !== 'infinite' || untimedStreak >= 3) {
          throw new Error(UNTIMED_BENCHMARK);
        }
        continue;
      }
      untimedStreak = 0;
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
    setGenerationActive(false);
  }
}
