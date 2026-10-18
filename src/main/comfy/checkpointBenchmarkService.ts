/**
 * Disk helpers for Checkpoint Benchmark (output folders + stats JSON).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  BENCHMARK_IMAGES_PER_CHECKPOINT,
  BENCHMARK_STATS_FILENAME,
  checkpointBenchmarkStem,
  countBenchmarkImages,
  emptyBenchmarkStats,
  isBenchmarkOutputImageName,
  omitBenchmarkRunsForMissingImages,
  mergeBenchmarkRun,
  parseBenchmarkStats,
  pickNextBenchmarkCheckpoint,
  pruneStaleBenchmarkCheckpoints,
  representativeBenchmarkDurations,
  summarizeBenchmarkStats,
  type CheckpointBenchmarkCandidate,
  type CheckpointBenchmarkStats,
} from '../../domain/checkpointBenchmark.js';
import type {
  CheckpointBenchmarkResultRowDto,
  CheckpointBenchmarkResultsDto,
  CheckpointBenchmarkStatusDto,
} from '../../shared/contracts.js';
import { checkpointEnabledForRelativePath } from '../checkpointEnabled.js';
import { getConfiguredCheckpointIndex } from '../checkpointService.js';
import { readMfeFieldRating } from '../mfeMetaAds.js';
import { getActiveLibrary } from '../settingsStore.js';

export function resolveBenchmarkOutputRoot(): string {
  const root = getActiveLibrary().benchmarkOutputFolder?.trim();
  if (!root) {
    throw new Error(
      'Set Checkpoint Benchmark folder in Library Manager before running Benchmark',
    );
  }
  return path.resolve(root);
}

/** All .safetensors under the configured Checkpoint folder (same pool as Generation). */
export function listBenchmarkCandidates(): CheckpointBenchmarkCandidate[] {
  const index = getConfiguredCheckpointIndex();
  if (!index) return [];
  const out: CheckpointBenchmarkCandidate[] = [];
  for (const file of index.files) {
    if (!file.relativePath.toLowerCase().endsWith('.safetensors')) continue;
    const relativePath = file.relativePath.replaceAll('\\', '/');
    if (!checkpointEnabledForRelativePath(relativePath)) {
      continue;
    }
    out.push({
      stem: checkpointBenchmarkStem(relativePath),
      relativePath,
    });
  }
  return out;
}

function stemFolder(root: string, stem: string): string {
  return path.join(root, stem);
}

export function countBenchmarkImagesOnDisk(
  root: string,
  stem: string,
): number {
  const dir = stemFolder(root, stem);
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return 0;
    return countBenchmarkImages(fs.readdirSync(dir));
  } catch {
    return 0;
  }
}

export function imageCountsByStem(
  root: string,
  candidates: readonly CheckpointBenchmarkCandidate[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const candidate of candidates) {
    map.set(candidate.stem, countBenchmarkImagesOnDisk(root, candidate.stem));
  }
  return map;
}

export function readBenchmarkStats(root: string): CheckpointBenchmarkStats {
  const file = path.join(root, BENCHMARK_STATS_FILENAME);
  try {
    if (!fs.existsSync(file)) return emptyBenchmarkStats();
    return parseBenchmarkStats(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return emptyBenchmarkStats();
  }
}

export function writeBenchmarkStats(
  root: string,
  stats: CheckpointBenchmarkStats,
): void {
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, BENCHMARK_STATS_FILENAME);
  fs.writeFileSync(file, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
}

/**
 * Remove JSON rows for stems that no longer exist in the Checkpoint folder.
 * Persists only when something was dropped. Idempotent.
 */
function benchmarkImageNamesOnDisk(root: string, stem: string): string[] {
  const dir = stemFolder(root, stem);
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
    return fs.readdirSync(dir).filter((name) => isBenchmarkOutputImageName(name));
  } catch {
    return [];
  }
}

export function pruneBenchmarkStatsToCandidates(
  root: string,
  candidates: readonly CheckpointBenchmarkCandidate[],
): CheckpointBenchmarkStats {
  const liveStems = new Set(candidates.map((c) => c.stem));
  const prev = readBenchmarkStats(root);
  const { stats: stemmed, removedStems } = pruneStaleBenchmarkCheckpoints(
    prev,
    liveStems,
  );
  let removedRuns = false;
  const checkpoints: CheckpointBenchmarkStats['checkpoints'] = {};
  for (const [stem, entry] of Object.entries(stemmed.checkpoints)) {
    const next = omitBenchmarkRunsForMissingImages(
      entry,
      benchmarkImageNamesOnDisk(root, stem),
    );
    if (next !== entry) removedRuns = true;
    checkpoints[stem] = next;
  }
  const stats = removedRuns
    ? {
        ...stemmed,
        updatedAt: new Date().toISOString(),
        checkpoints,
      }
    : stemmed;
  if (removedStems.length > 0 || removedRuns) {
    writeBenchmarkStats(root, stats);
  }
  return stats;
}

export function recordBenchmarkRun(input: {
  root: string;
  stem: string;
  relativePath: string;
  durationMs: number;
  seed: number;
  outputFile?: string;
}): CheckpointBenchmarkStats {
  const imageCount = countBenchmarkImagesOnDisk(input.root, input.stem);
  const prev = readBenchmarkStats(input.root);
  const next = mergeBenchmarkRun(prev, {
    stem: input.stem,
    relativePath: input.relativePath,
    imageCount,
    durationMs: input.durationMs,
    seed: input.seed,
    outputFile: input.outputFile,
  });
  writeBenchmarkStats(input.root, next);
  return next;
}

export type BenchmarkJobSlot = {
  checkpoint: string;
  stem: string;
  imageCount: number;
  completedCheckpoints: number;
  totalCheckpoints: number;
  remainingImages: number;
  outputFolder: string;
};

/**
 * Next incomplete checkpoint slot, or null when every candidate has 10 images.
 */
export function resolveNextBenchmarkSlot(): BenchmarkJobSlot | null {
  const root = resolveBenchmarkOutputRoot();
  const candidates = listBenchmarkCandidates();
  if (candidates.length === 0) {
    const any = getConfiguredCheckpointIndex()?.files.some((file) =>
      file.relativePath.toLowerCase().endsWith('.safetensors'),
    );
    throw new Error(
      any
        ? 'Every checkpoint is unticked, so Benchmark has nothing to run'
        : 'No .safetensors checkpoints in the Checkpoint files folder',
    );
  }
  pruneBenchmarkStatsToCandidates(root, candidates);
  const counts = imageCountsByStem(root, candidates);
  const progress = pickNextBenchmarkCheckpoint(
    candidates,
    counts,
    BENCHMARK_IMAGES_PER_CHECKPOINT,
  );
  if (!progress.next) return null;
  return {
    checkpoint: progress.next.relativePath,
    stem: progress.next.stem,
    imageCount: progress.nextImageCount,
    completedCheckpoints: progress.completedCheckpoints,
    totalCheckpoints: progress.totalCheckpoints,
    remainingImages: progress.remainingImages,
    outputFolder: stemFolder(root, progress.next.stem),
  };
}

/** All timed checkpoints for the Benchmark results chart. */
export function getCheckpointBenchmarkResults(): CheckpointBenchmarkResultsDto {
  const configured = getActiveLibrary().benchmarkOutputFolder?.trim() ?? null;
  const root = configured ? path.resolve(configured) : null;
  const candidates = listBenchmarkCandidates();
  const byStem = new Map(
    candidates.map((c) => [c.stem, c.relativePath] as const),
  );
  if (!root) {
    return {
      root: null,
      targetImagesPerCheckpoint: BENCHMARK_IMAGES_PER_CHECKPOINT,
      updatedAt: null,
      rows: [],
    };
  }
  const stats = pruneBenchmarkStatsToCandidates(root, candidates);
  const counts = imageCountsByStem(root, candidates);
  const rows: CheckpointBenchmarkResultRowDto[] = [];
  for (const [stem, entry] of Object.entries(stats.checkpoints)) {
    if (entry.runs.length === 0) continue;
    if (!byStem.has(stem)) continue;
    const diskCount = counts.get(stem);
    const representative = representativeBenchmarkDurations(
      entry.runs.map((run) => run.durationMs),
    );
    rows.push({
      stem,
      relativePath:
        byStem.get(stem) ||
        entry.relativePath.replaceAll('\\', '/') ||
        `${stem}.safetensors`,
      imageCount:
        typeof diskCount === 'number' ? diskCount : entry.imageCount,
      runCount: entry.runs.length,
      avgDurationMs: representative.avgDurationMs,
      totalDurationMs: entry.totalDurationMs,
      minDurationMs: representative.minDurationMs,
      maxDurationMs: representative.maxDurationMs,
      runDurationsMs: entry.runs.map((r) => r.durationMs),
      rating: readMfeFieldRating(stemFolder(root, stem)),
    });
  }
  return {
    root,
    targetImagesPerCheckpoint: stats.targetImagesPerCheckpoint,
    updatedAt: stats.updatedAt,
    rows,
  };
}

/** Status for the Generation UI (root may be null when unset). */
export function getCheckpointBenchmarkStatus(): CheckpointBenchmarkStatusDto {
  const configured = getActiveLibrary().benchmarkOutputFolder?.trim() ?? null;
  const root = configured ? path.resolve(configured) : null;
  const candidates = listBenchmarkCandidates();
  const empty: CheckpointBenchmarkStatusDto = {
    root,
    targetImagesPerCheckpoint: BENCHMARK_IMAGES_PER_CHECKPOINT,
    nextStem: null,
    nextRelativePath: null,
    nextImageCount: 0,
    completedCheckpoints: 0,
    totalCheckpoints: candidates.length,
    remainingImages: 0,
    fastest: null,
    slowest: null,
  };
  if (!root) return empty;

  const stats = pruneBenchmarkStatsToCandidates(root, candidates);
  const counts = imageCountsByStem(root, candidates);
  const progress = pickNextBenchmarkCheckpoint(
    candidates,
    counts,
    BENCHMARK_IMAGES_PER_CHECKPOINT,
  );
  const summary = summarizeBenchmarkStats(stats);
  return {
    root,
    targetImagesPerCheckpoint: BENCHMARK_IMAGES_PER_CHECKPOINT,
    nextStem: progress.next?.stem ?? null,
    nextRelativePath: progress.next?.relativePath ?? null,
    nextImageCount: progress.nextImageCount,
    completedCheckpoints: progress.completedCheckpoints,
    totalCheckpoints: progress.totalCheckpoints,
    remainingImages: progress.remainingImages,
    fastest: summary.fastest,
    slowest: summary.slowest,
  };
}
