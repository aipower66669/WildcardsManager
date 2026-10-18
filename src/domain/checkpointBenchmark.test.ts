import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_IMAGES_PER_CHECKPOINT,
  benchmarkOutlierIndexes,
  checkpointBenchmarkStem,
  countBenchmarkImages,
  emptyBenchmarkStats,
  isBenchmarkOutputImageName,
  mergeBenchmarkRun,
  omitBenchmarkRunsForMissingImages,
  parseBenchmarkStats,
  pickNextBenchmarkCheckpoint,
  pruneStaleBenchmarkCheckpoints,
  representativeBenchmarkDurations,
  runDurationRange,
  settleBenchmarkOutliers,
  summarizeBenchmarkStats,
} from './checkpointBenchmark.js';

describe('checkpointBenchmarkStem', () => {
  it('uses the basename without extension', () => {
    expect(checkpointBenchmarkStem('styles/Foo.safetensors')).toBe('Foo');
    expect(checkpointBenchmarkStem('Bar.ckpt')).toBe('Bar');
  });
});

describe('countBenchmarkImages', () => {
  it('counts WCG stem images only', () => {
    expect(
      countBenchmarkImages([
        'WCG.png',
        'WCG_00001_.png',
        'WCG.1.png',
        'other.png',
        'notes.txt',
      ]),
    ).toBe(3);
    expect(isBenchmarkOutputImageName('wcg_2.jpg')).toBe(true);
    expect(isBenchmarkOutputImageName('preview.png')).toBe(false);
  });
});

describe('pickNextBenchmarkCheckpoint', () => {
  const candidates = [
    { stem: 'A', relativePath: 'A.safetensors' },
    { stem: 'B', relativePath: 'B.safetensors' },
    { stem: 'C', relativePath: 'sub/C.safetensors' },
  ];

  it('picks the first incomplete stem', () => {
    const counts = new Map([
      ['A', BENCHMARK_IMAGES_PER_CHECKPOINT],
      ['B', 3],
    ]);
    const progress = pickNextBenchmarkCheckpoint(candidates, counts);
    expect(progress.next).toEqual(candidates[1]);
    expect(progress.nextImageCount).toBe(3);
    expect(progress.completedCheckpoints).toBe(1);
    expect(progress.remainingImages).toBe(7 + 10);
  });

  it('returns null when all complete', () => {
    const counts = new Map([
      ['A', 10],
      ['B', 10],
      ['C', 12],
    ]);
    const progress = pickNextBenchmarkCheckpoint(candidates, counts);
    expect(progress.next).toBeNull();
    expect(progress.completedCheckpoints).toBe(3);
    expect(progress.remainingImages).toBe(0);
  });
});

describe('mergeBenchmarkRun / summarizeBenchmarkStats', () => {
  it('appends runs and recomputes averages', () => {
    let stats = emptyBenchmarkStats();
    stats = mergeBenchmarkRun(stats, {
      stem: 'Foo',
      relativePath: 'Foo.safetensors',
      imageCount: 1,
      durationMs: 1000,
      seed: 1,
      at: '2026-01-01T00:00:00.000Z',
    });
    stats = mergeBenchmarkRun(stats, {
      stem: 'Foo',
      relativePath: 'Foo.safetensors',
      imageCount: 2,
      durationMs: 3000,
      seed: 2,
      at: '2026-01-01T00:01:00.000Z',
    });
    expect(stats.checkpoints.Foo?.imageCount).toBe(2);
    expect(stats.checkpoints.Foo?.avgDurationMs).toBe(2000);
    expect(stats.checkpoints.Foo?.runs).toHaveLength(2);
    expect(runDurationRange(stats.checkpoints.Foo!.runs)).toEqual({
      minDurationMs: 1000,
      maxDurationMs: 3000,
    });

    stats = mergeBenchmarkRun(stats, {
      stem: 'Bar',
      relativePath: 'Bar.safetensors',
      imageCount: 10,
      durationMs: 500,
      seed: 3,
    });
    const summary = summarizeBenchmarkStats(stats);
    expect(summary.completedCheckpoints).toBe(1);
    expect(summary.fastest?.stem).toBe('Bar');
    expect(summary.slowest?.stem).toBe('Foo');
  });

  it('round-trips through parseBenchmarkStats', () => {
    const merged = mergeBenchmarkRun(emptyBenchmarkStats(), {
      stem: 'X',
      relativePath: 'X.safetensors',
      imageCount: 1,
      durationMs: 42,
      seed: 9,
    });
    const again = parseBenchmarkStats(JSON.parse(JSON.stringify(merged)));
    expect(again.checkpoints.X?.runs[0]?.durationMs).toBe(42);
    expect(again.checkpoints.X?.avgDurationMs).toBe(42);
  });
});

describe('omitBenchmarkRunsForMissingImages', () => {
  it('drops the timing for a deleted image and keeps the rest', () => {
    let stats = emptyBenchmarkStats();
    stats = mergeBenchmarkRun(stats, {
      stem: 'M',
      relativePath: 'M.safetensors',
      imageCount: 2,
      durationMs: 40000,
      seed: 1,
      outputFile: 'WCG_00001_.png',
    });
    stats = mergeBenchmarkRun(stats, {
      stem: 'M',
      relativePath: 'M.safetensors',
      imageCount: 2,
      durationMs: 18000,
      seed: 2,
      outputFile: 'WCG_00002_.png',
    });
    const next = omitBenchmarkRunsForMissingImages(stats.checkpoints.M!, [
      'WCG_00001_.png',
      'notes.txt',
    ]);
    expect(next.imageCount).toBe(1);
    expect(next.runs.map((run) => run.durationMs)).toEqual([40000]);
  });

  it('leaves the entry alone when every image is still there', () => {
    let stats = emptyBenchmarkStats();
    stats = mergeBenchmarkRun(stats, {
      stem: 'M',
      relativePath: 'M.safetensors',
      imageCount: 1,
      durationMs: 40000,
      seed: 1,
      outputFile: 'WCG.png',
    });
    const entry = stats.checkpoints.M!;
    expect(
      omitBenchmarkRunsForMissingImages(entry, ['WCG.png']),
    ).toBe(entry);
  });
});

describe('pruneStaleBenchmarkCheckpoints', () => {
  it('removes stems not in the live set and leaves others', () => {
    let stats = emptyBenchmarkStats();
    stats = mergeBenchmarkRun(stats, {
      stem: 'Keep',
      relativePath: 'Keep.safetensors',
      imageCount: 1,
      durationMs: 100,
      seed: 1,
    });
    stats = mergeBenchmarkRun(stats, {
      stem: 'Gone',
      relativePath: 'Gone.safetensors',
      imageCount: 2,
      durationMs: 200,
      seed: 2,
    });
    const { stats: next, removedStems } = pruneStaleBenchmarkCheckpoints(
      stats,
      new Set(['Keep']),
    );
    expect(removedStems).toEqual(['Gone']);
    expect(next.checkpoints.Keep).toBeTruthy();
    expect(next.checkpoints.Gone).toBeUndefined();
  });

  it('is a no-op when every stem is live', () => {
    const stats = mergeBenchmarkRun(emptyBenchmarkStats(), {
      stem: 'Only',
      relativePath: 'Only.safetensors',
      imageCount: 1,
      durationMs: 50,
      seed: 1,
    });
    const { stats: next, removedStems } = pruneStaleBenchmarkCheckpoints(
      stats,
      new Set(['Only']),
    );
    expect(removedStems).toEqual([]);
    expect(next).toBe(stats);
  });
});

describe('representativeBenchmarkDurations', () => {
  it('averages and spans only the five fastest runs', () => {
    const summary = representativeBenchmarkDurations([
      71000, 40000, 41000, 39000, 42000, 40500, 0, 80000, 39500, 43000,
    ]);
    expect(summary.minDurationMs).toBe(0);
    expect(summary.maxDurationMs).toBe(40500);
    expect(summary.avgDurationMs).toBe(
      Math.round((0 + 39000 + 39500 + 40000 + 40500) / 5),
    );
  });

  it('uses every run when fewer than five exist', () => {
    expect(representativeBenchmarkDurations([3000, 1000])).toEqual({
      avgDurationMs: 2000,
      minDurationMs: 1000,
      maxDurationMs: 3000,
    });
  });
});

describe('benchmark outliers', () => {
  const cluster = [10000, 10100, 9900, 10200, 9800, 10050, 9950, 10150, 9850];

  it('drops a cold first sample once 10 timings exist', () => {
    const durations = [40000, ...cluster];
    const indexes = benchmarkOutlierIndexes(durations);
    expect(indexes).toEqual([0]);
  });

  it('keeps a tight cluster', () => {
    expect(benchmarkOutlierIndexes([...cluster, 10020])).toEqual([]);
  });

  it('does not judge a partial set', () => {
    let stats = emptyBenchmarkStats();
    for (let i = 0; i < 9; i += 1) {
      stats = mergeBenchmarkRun(stats, {
        stem: 'M',
        relativePath: 'M.safetensors',
        imageCount: i + 1,
        durationMs: i === 0 ? 40000 : 10000,
        seed: i + 1,
      });
    }
    const { stats: settled, changed } = settleBenchmarkOutliers(stats);
    expect(changed).toBe(false);
    expect(settled.checkpoints.M?.runs).toHaveLength(9);
  });

  it('removes the outlier from the average and asks for a replacement', () => {
    let stats = emptyBenchmarkStats();
    const durations = [40000, ...cluster];
    for (let i = 0; i < durations.length; i += 1) {
      stats = mergeBenchmarkRun(stats, {
        stem: 'M',
        relativePath: 'M.safetensors',
        imageCount: i + 1,
        durationMs: durations[i]!,
        seed: i + 1,
      });
    }
    const { stats: settled, changed } = settleBenchmarkOutliers(stats);
    expect(changed).toBe(true);
    const entry = settled.checkpoints.M!;
    expect(entry.runs).toHaveLength(9);
    expect(entry.runs.some((run) => run.durationMs === 40000)).toBe(false);
    expect(entry.avgDurationMs).toBeGreaterThan(9800);
    expect(entry.avgDurationMs).toBeLessThan(10300);
    expect(entry.discardedCount).toBe(1);
    const progress = pickNextBenchmarkCheckpoint(
      [{ stem: 'M', relativePath: 'M.safetensors' }],
      new Map([['M', entry.runs.length]]),
    );
    expect(progress.next?.stem).toBe('M');
    expect(progress.remainingImages).toBe(1);
  });
});
