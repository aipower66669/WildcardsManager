/**
 * Checkpoint visual/speed benchmark helpers.
 *
 * Layout under the benchmark root:
 *   {stem}/WCG*.png
 *   benchmark-stats.json
 *
 * Every recorded timing is kept. A timing is the sampler's step counter from
 * the first step through the last (model load and file save are not included).
 * The chart average and min–max range use the five fastest of those runs.
 */

import { GENERATION_OUTPUT_FILENAME } from '../shared/comfy.js';

export const BENCHMARK_IMAGES_PER_CHECKPOINT = 10;
/** Fastest runs used for the chart average and min–max range. */
export const BENCHMARK_REPRESENTATIVE_RUNS = 5;
export const BENCHMARK_STATS_FILENAME = 'benchmark-stats.json';
export const BENCHMARK_STATS_VERSION = 1 as const;
/** A timing this many sample standard deviations from the mean is outside the cluster. */
export const BENCHMARK_OUTLIER_SIGMA = 2;
/** Replacements for dropped timings. Stops a wide cluster from generating forever. */
export const BENCHMARK_MAX_DISCARDED_TIMINGS = 5;

const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;

export type CheckpointBenchmarkCandidate = {
  /** Extensionless stem used as the output subfolder name. */
  stem: string;
  /** Root-relative path with extension (Generation checkpoint value). */
  relativePath: string;
};

export type CheckpointBenchmarkRunStat = {
  at: string;
  durationMs: number;
  seed: number;
  outputFile?: string;
};

export type CheckpointBenchmarkEntryStat = {
  relativePath: string;
  imageCount: number;
  runs: CheckpointBenchmarkRunStat[];
  totalDurationMs: number;
  avgDurationMs: number;
  /** Timings removed for sitting outside the cluster. */
  discardedCount?: number;
};

export type CheckpointBenchmarkStats = {
  version: typeof BENCHMARK_STATS_VERSION;
  updatedAt: string;
  targetImagesPerCheckpoint: number;
  checkpoints: Record<string, CheckpointBenchmarkEntryStat>;
};

/** File stem from a checkpoint relative path (`styles/Foo.safetensors` → `Foo`). */
export function checkpointBenchmarkStem(relativePath: string): string {
  const norm = relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  const base = norm.includes('/') ? norm.slice(norm.lastIndexOf('/') + 1) : norm;
  return base.replace(/\.(safetensors|ckpt|pt|bin|gguf)$/i, '');
}

/** True when a filename is a Generation output for the WCG stem. */
export function isBenchmarkOutputImageName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (!IMAGE_EXT_RE.test(lower)) return false;
  const stem = GENERATION_OUTPUT_FILENAME.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.'));
  return (
    lower === `${stem}${ext}` ||
    lower.startsWith(`${stem}_`) ||
    lower.startsWith(`${stem}.`)
  );
}

/** Count WCG* image files among directory entry names. */
export function countBenchmarkImages(fileNames: readonly string[]): number {
  let n = 0;
  for (const name of fileNames) {
    if (isBenchmarkOutputImageName(name)) n += 1;
  }
  return n;
}

export type CheckpointBenchmarkProgress = {
  /** Next checkpoint to generate, or null when every candidate is complete. */
  next: CheckpointBenchmarkCandidate | null;
  /** Images already present for `next` (0 when next is null). */
  nextImageCount: number;
  /** Checkpoints with at least `target` images. */
  completedCheckpoints: number;
  totalCheckpoints: number;
  /** Sum of missing images across all candidates. */
  remainingImages: number;
};

/**
 * Pick the first candidate whose stem folder has fewer than `target` images.
 * `imageCountsByStem` maps stem → current image count (missing → 0).
 */
export function pickNextBenchmarkCheckpoint(
  candidates: readonly CheckpointBenchmarkCandidate[],
  imageCountsByStem: ReadonlyMap<string, number>,
  target: number = BENCHMARK_IMAGES_PER_CHECKPOINT,
): CheckpointBenchmarkProgress {
  let completedCheckpoints = 0;
  let remainingImages = 0;
  let next: CheckpointBenchmarkCandidate | null = null;
  let nextImageCount = 0;

  for (const candidate of candidates) {
    const count = imageCountsByStem.get(candidate.stem) ?? 0;
    if (count >= target) {
      completedCheckpoints += 1;
      continue;
    }
    remainingImages += target - count;
    if (!next) {
      next = candidate;
      nextImageCount = count;
    }
  }

  return {
    next,
    nextImageCount,
    completedCheckpoints,
    totalCheckpoints: candidates.length,
    remainingImages,
  };
}

export function emptyBenchmarkStats(
  target: number = BENCHMARK_IMAGES_PER_CHECKPOINT,
): CheckpointBenchmarkStats {
  return {
    version: BENCHMARK_STATS_VERSION,
    updatedAt: new Date(0).toISOString(),
    targetImagesPerCheckpoint: target,
    checkpoints: {},
  };
}

function discardedCountFrom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function sampleStdev(values: readonly number[], mean: number): number {
  if (values.length < 2) return 0;
  let acc = 0;
  for (const value of values) {
    const delta = value - mean;
    acc += delta * delta;
  }
  return Math.sqrt(acc / (values.length - 1));
}

/**
 * Indexes of timings that sit outside the cluster.
 * Uses the sample mean and standard deviation, then repeats on what remains
 * so one extreme point cannot hide another. `maxDrop` caps how many indexes
 * are returned (farthest first).
 */
export function benchmarkOutlierIndexes(
  durations: readonly number[],
  maxDrop: number = BENCHMARK_MAX_DISCARDED_TIMINGS,
): number[] {
  if (durations.length < 3 || maxDrop <= 0) return [];
  const dropped: number[] = [];
  let active = durations.map((_, index) => index);
  for (let pass = 0; pass < 4 && dropped.length < maxDrop; pass += 1) {
    if (active.length < 3) break;
    const values = active.map((index) => durations[index]!);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const sd = sampleStdev(values, mean);
    if (!(sd > 0)) break;
    const limit = BENCHMARK_OUTLIER_SIGMA * sd;
    const outside = active.filter(
      (index) => Math.abs(durations[index]! - mean) > limit,
    );
    if (outside.length === 0) break;
    outside.sort(
      (a, b) =>
        Math.abs(durations[b]! - mean) - Math.abs(durations[a]! - mean),
    );
    const room = Math.min(maxDrop - dropped.length, 3, active.length - 3);
    const take = outside.slice(0, room);
    if (take.length === 0) break;
    dropped.push(...take);
    const taken = new Set(take);
    active = active.filter((index) => !taken.has(index));
  }
  return dropped;
}

function entryFromRuns(
  entry: CheckpointBenchmarkEntryStat,
  runs: CheckpointBenchmarkRunStat[],
  discardedCount: number,
): CheckpointBenchmarkEntryStat {
  const totalDurationMs = runs.reduce((sum, run) => sum + run.durationMs, 0);
  return {
    relativePath: entry.relativePath,
    imageCount: entry.imageCount,
    runs,
    totalDurationMs,
    avgDurationMs: runs.length > 0 ? Math.round(totalDurationMs / runs.length) : 0,
    ...(discardedCount > 0 ? { discardedCount } : {}),
  };
}

/**
 * When a checkpoint has a full set of timings, drop durations outside the
 * cluster so the average is not set by a cold model load. Fewer than `target`
 * kept timings means more samples are still required.
 */
export function omitBenchmarkOutlierRuns(
  entry: CheckpointBenchmarkEntryStat,
  target: number = BENCHMARK_IMAGES_PER_CHECKPOINT,
): CheckpointBenchmarkEntryStat {
  if (entry.runs.length < target) return entry;
  const discardedCount = entry.discardedCount ?? 0;
  const room = BENCHMARK_MAX_DISCARDED_TIMINGS - discardedCount;
  if (room <= 0) return entry;
  const indexes = benchmarkOutlierIndexes(
    entry.runs.map((run) => run.durationMs),
    room,
  );
  if (indexes.length === 0) return entry;
  const drop = new Set(indexes);
  const runs = entry.runs.filter((_, index) => !drop.has(index));
  return entryFromRuns(entry, runs, discardedCount + indexes.length);
}

/** Apply {@link omitBenchmarkOutlierRuns} to every checkpoint that has a full set. */
export function settleBenchmarkOutliers(
  stats: CheckpointBenchmarkStats,
): { stats: CheckpointBenchmarkStats; changed: boolean } {
  let changed = false;
  const checkpoints: Record<string, CheckpointBenchmarkEntryStat> = {};
  for (const [stem, entry] of Object.entries(stats.checkpoints)) {
    const next = omitBenchmarkOutlierRuns(
      entry,
      stats.targetImagesPerCheckpoint,
    );
    if (next !== entry) changed = true;
    checkpoints[stem] = next;
  }
  if (!changed) return { stats, changed: false };
  return {
    changed: true,
    stats: {
      version: BENCHMARK_STATS_VERSION,
      updatedAt: new Date().toISOString(),
      targetImagesPerCheckpoint: stats.targetImagesPerCheckpoint,
      checkpoints,
    },
  };
}

/** Parse stats JSON; returns empty stats when invalid. */
export function parseBenchmarkStats(raw: unknown): CheckpointBenchmarkStats {
  const empty = emptyBenchmarkStats();
  if (!raw || typeof raw !== 'object') return empty;
  const row = raw as Record<string, unknown>;
  const target =
    typeof row.targetImagesPerCheckpoint === 'number' &&
    Number.isFinite(row.targetImagesPerCheckpoint)
      ? Math.max(1, Math.floor(row.targetImagesPerCheckpoint))
      : BENCHMARK_IMAGES_PER_CHECKPOINT;
  const checkpoints: Record<string, CheckpointBenchmarkEntryStat> = {};
  const bag =
    row.checkpoints && typeof row.checkpoints === 'object'
      ? (row.checkpoints as Record<string, unknown>)
      : {};
  for (const [stem, value] of Object.entries(bag)) {
    if (!stem.trim() || !value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    const runsRaw = Array.isArray(entry.runs) ? entry.runs : [];
    const runs: CheckpointBenchmarkRunStat[] = [];
    for (const run of runsRaw) {
      if (!run || typeof run !== 'object') continue;
      const r = run as Record<string, unknown>;
      const durationMs =
        typeof r.durationMs === 'number' && Number.isFinite(r.durationMs)
          ? Math.max(0, Math.round(r.durationMs))
          : null;
      const seed =
        typeof r.seed === 'number' && Number.isFinite(r.seed)
          ? Math.floor(r.seed) >>> 0
          : null;
      if (durationMs == null || seed == null) continue;
      runs.push({
        at:
          typeof r.at === 'string' && r.at.trim()
            ? r.at.trim()
            : new Date(0).toISOString(),
        durationMs,
        seed,
        ...(typeof r.outputFile === 'string' && r.outputFile.trim()
          ? { outputFile: r.outputFile.trim() }
          : {}),
      });
    }
    const totalDurationMs = runs.reduce((sum, r) => sum + r.durationMs, 0);
    const discardedCount = discardedCountFrom(entry.discardedCount);
    checkpoints[stem] = {
      relativePath:
        typeof entry.relativePath === 'string' ? entry.relativePath : '',
      imageCount:
        typeof entry.imageCount === 'number' && Number.isFinite(entry.imageCount)
          ? Math.max(0, Math.floor(entry.imageCount))
          : 0,
      runs,
      totalDurationMs,
      avgDurationMs:
        runs.length > 0 ? Math.round(totalDurationMs / runs.length) : 0,
      ...(discardedCount > 0 ? { discardedCount } : {}),
    };
  }
  return {
    version: BENCHMARK_STATS_VERSION,
    updatedAt:
      typeof row.updatedAt === 'string' && row.updatedAt.trim()
        ? row.updatedAt.trim()
        : empty.updatedAt,
    targetImagesPerCheckpoint: target,
    checkpoints,
  };
}

/**
 * Append one successful run and refresh imageCount / averages for that stem.
 */
export function mergeBenchmarkRun(
  stats: CheckpointBenchmarkStats,
  input: {
    stem: string;
    relativePath: string;
    imageCount: number;
    durationMs: number;
    seed: number;
    outputFile?: string;
    at?: string;
  },
): CheckpointBenchmarkStats {
  const stem = input.stem.trim();
  if (!stem) return stats;
  const prev = stats.checkpoints[stem];
  const run: CheckpointBenchmarkRunStat = {
    at: input.at ?? new Date().toISOString(),
    durationMs: Math.max(0, Math.round(input.durationMs)),
    seed: Math.floor(input.seed) >>> 0,
    ...(input.outputFile?.trim()
      ? { outputFile: input.outputFile.trim() }
      : {}),
  };
  const runs = [...(prev?.runs ?? []), run];
  const totalDurationMs = runs.reduce((sum, r) => sum + r.durationMs, 0);
  const discardedCount = prev?.discardedCount ?? 0;
  return {
    version: BENCHMARK_STATS_VERSION,
    updatedAt: run.at,
    targetImagesPerCheckpoint: stats.targetImagesPerCheckpoint,
    checkpoints: {
      ...stats.checkpoints,
      [stem]: {
        relativePath: input.relativePath.replaceAll('\\', '/'),
        imageCount: Math.max(0, Math.floor(input.imageCount)),
        runs,
        totalDurationMs,
        avgDurationMs: Math.round(totalDurationMs / runs.length),
        ...(discardedCount > 0 ? { discardedCount } : {}),
      },
    },
  };
}

/**
 * Drop stats for stems that are no longer among live checkpoint candidates
 * (e.g. user deleted a .safetensors after benchmarking it).
 */
export function pruneStaleBenchmarkCheckpoints(
  stats: CheckpointBenchmarkStats,
  liveStems: ReadonlySet<string>,
): { stats: CheckpointBenchmarkStats; removedStems: string[] } {
  const removedStems: string[] = [];
  const checkpoints: Record<string, CheckpointBenchmarkEntryStat> = {};
  for (const [stem, entry] of Object.entries(stats.checkpoints)) {
    if (liveStems.has(stem)) {
      checkpoints[stem] = entry;
    } else {
      removedStems.push(stem);
    }
  }
  if (removedStems.length === 0) {
    return { stats, removedStems };
  }
  return {
    removedStems,
    stats: {
      version: BENCHMARK_STATS_VERSION,
      updatedAt: new Date().toISOString(),
      targetImagesPerCheckpoint: stats.targetImagesPerCheckpoint,
      checkpoints,
    },
  };
}

/**
 * Drop timings whose image file is gone, and set `imageCount` to the files
 * still in the folder. A later benchmark run fills the hole back to 10.
 * Timings saved without a filename are trimmed oldest-first when they
 * outnumber the remaining images.
 */
export function omitBenchmarkRunsForMissingImages(
  entry: CheckpointBenchmarkEntryStat,
  imageNames: readonly string[],
): CheckpointBenchmarkEntryStat {
  const present = new Set(
    imageNames
      .filter((name) => isBenchmarkOutputImageName(name))
      .map((name) => name.toLowerCase()),
  );
  const imageCount = present.size;
  let runs = entry.runs.filter((run) => {
    const file = run.outputFile?.trim();
    if (!file) return true;
    return present.has(file.toLowerCase());
  });
  if (runs.length > imageCount) {
    let extra = runs.length - imageCount;
    const kept: CheckpointBenchmarkRunStat[] = [];
    for (const run of runs) {
      if (extra > 0 && !run.outputFile?.trim()) {
        extra -= 1;
        continue;
      }
      kept.push(run);
    }
    runs = kept;
  }
  if (runs.length > imageCount) {
    runs = runs.slice(runs.length - imageCount);
  }
  if (
    runs.length === entry.runs.length &&
    runs.every((run, index) => run === entry.runs[index]) &&
    entry.imageCount === imageCount
  ) {
    return entry;
  }
  const totalDurationMs = runs.reduce((sum, run) => sum + run.durationMs, 0);
  const discardedCount = entry.discardedCount ?? 0;
  return {
    relativePath: entry.relativePath,
    imageCount,
    runs,
    totalDurationMs,
    avgDurationMs: runs.length > 0 ? Math.round(totalDurationMs / runs.length) : 0,
    ...(discardedCount > 0 ? { discardedCount } : {}),
  };
}

/** Min/max duration across runs (0/0 when empty). */
export function runDurationRange(
  runs: readonly CheckpointBenchmarkRunStat[],
): { minDurationMs: number; maxDurationMs: number } {
  if (runs.length === 0) {
    return { minDurationMs: 0, maxDurationMs: 0 };
  }
  let min = runs[0]!.durationMs;
  let max = min;
  for (let i = 1; i < runs.length; i += 1) {
    const d = runs[i]!.durationMs;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { minDurationMs: min, maxDurationMs: max };
}

/**
 * Average and min/max of the fastest runs. Slow outliers stay in the raw
 * sample list; they do not move the summary.
 */
export function representativeBenchmarkDurations(
  durations: readonly number[],
  count: number = BENCHMARK_REPRESENTATIVE_RUNS,
): { avgDurationMs: number; minDurationMs: number; maxDurationMs: number } {
  if (durations.length === 0) {
    return { avgDurationMs: 0, minDurationMs: 0, maxDurationMs: 0 };
  }
  const take = Math.max(1, Math.floor(count));
  const fastest = [...durations]
    .sort((a, b) => a - b)
    .slice(0, Math.min(take, durations.length));
  const total = fastest.reduce((sum, value) => sum + value, 0);
  return {
    avgDurationMs: Math.round(total / fastest.length),
    minDurationMs: fastest[0]!,
    maxDurationMs: fastest[fastest.length - 1]!,
  };
}

/** Summary for UI: completed count + fastest/slowest by average duration. */
export function summarizeBenchmarkStats(stats: CheckpointBenchmarkStats): {
  completedCheckpoints: number;
  trackedCheckpoints: number;
  fastest: { stem: string; avgDurationMs: number } | null;
  slowest: { stem: string; avgDurationMs: number } | null;
} {
  const target = stats.targetImagesPerCheckpoint;
  const entries = Object.entries(stats.checkpoints);
  let completedCheckpoints = 0;
  let fastest: { stem: string; avgDurationMs: number } | null = null;
  let slowest: { stem: string; avgDurationMs: number } | null = null;
  for (const [stem, entry] of entries) {
    if (entry.imageCount >= target) completedCheckpoints += 1;
    if (entry.runs.length === 0) continue;
    const avg = representativeBenchmarkDurations(
      entry.runs.map((run) => run.durationMs),
    ).avgDurationMs;
    if (!fastest || avg < fastest.avgDurationMs) {
      fastest = { stem, avgDurationMs: avg };
    }
    if (!slowest || avg > slowest.avgDurationMs) {
      slowest = { stem, avgDurationMs: avg };
    }
  }
  return {
    completedCheckpoints,
    trackedCheckpoints: entries.length,
    fastest,
    slowest,
  };
}
