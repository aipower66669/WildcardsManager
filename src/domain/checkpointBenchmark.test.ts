import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_IMAGES_PER_CHECKPOINT,
  checkpointBenchmarkStem,
  countBenchmarkImages,
  emptyBenchmarkStats,
  isBenchmarkOutputImageName,
  mergeBenchmarkRun,
  parseBenchmarkStats,
  pickNextBenchmarkCheckpoint,
  pruneStaleBenchmarkCheckpoints,
  runDurationRange,
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
