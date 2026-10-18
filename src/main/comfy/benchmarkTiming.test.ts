import { describe, expect, it } from 'vitest';
import {
  emptySampleClock,
  isGenerationSamplerClass,
  noteSampleProgress,
  sampleClockDurationMs,
  samplerNodeIds,
} from './benchmarkTiming.js';

describe('isGenerationSamplerClass', () => {
  it('recognizes the denoising loop and ignores loaders and pickers', () => {
    expect(isGenerationSamplerClass('KSampler')).toBe(true);
    expect(isGenerationSamplerClass('KSamplerAdvanced')).toBe(true);
    expect(isGenerationSamplerClass('SamplerCustomAdvanced')).toBe(true);
    expect(isGenerationSamplerClass('UNETLoader')).toBe(false);
    expect(isGenerationSamplerClass('CheckpointLoaderSimple')).toBe(false);
    expect(isGenerationSamplerClass('LoraTrainingSeed')).toBe(false);
    expect(isGenerationSamplerClass('KSamplerSelect')).toBe(false);
    expect(isGenerationSamplerClass('VAEDecode')).toBe(false);
  });
});

describe('sample step clock', () => {
  const samplers = samplerNodeIds({
    '3': { class_type: 'UNETLoader' },
    '7': { class_type: 'KSampler' },
    '9': { class_type: 'VAEDecode' },
  });

  function feed(
    events: Array<{ value: number; max: number; node?: string | null; at: number }>,
  ) {
    let clock = emptySampleClock();
    for (const event of events) {
      clock = noteSampleProgress(
        clock,
        { type: 'progress', value: event.value, max: event.max, node: event.node },
        samplers,
        event.at,
      );
    }
    return clock;
  }

  it('times the first step through the last and includes the opening step', () => {
    // Callback for step 1 arrives at 4s; step 10 at 40s. Nine gaps cover
    // steps 2–10, so the span is scaled back up to all ten steps.
    const clock = feed([
      { node: '3', value: 1, max: 20, at: 1000 },
      { node: '7', value: 1, max: 10, at: 4000 },
      { node: '7', value: 5, max: 10, at: 20000 },
      { node: '7', value: 10, max: 10, at: 40000 },
    ]);
    expect(sampleClockDurationMs(clock)).toBe(Math.round(36000 * (10 / 9)));
  });

  it('does not time a loop joined after the first step', () => {
    const clock = feed([
      { node: '7', value: 8, max: 10, at: 30000 },
      { node: '7', value: 10, max: 10, at: 40000 },
    ]);
    expect(sampleClockDurationMs(clock)).toBeNull();
  });

  it('ignores a loader bar and untagged progress when the sampler is known', () => {
    const clock = feed([
      { node: '3', value: 1, max: 100, at: 1000 },
      { node: null, value: 1, max: 10, at: 1500 },
      { node: '7', value: 1, max: 4, at: 5000 },
      { node: '7', value: 4, max: 4, at: 9000 },
    ]);
    expect(sampleClockDurationMs(clock)).toBe(Math.round(4000 * (4 / 3)));
  });

  it('uses an untagged step bar when the graph has no recognizable sampler', () => {
    let clock = emptySampleClock();
    clock = noteSampleProgress(
      clock,
      { type: 'progress', value: 0, max: 5, node: null },
      new Set(),
      1000,
    );
    clock = noteSampleProgress(
      clock,
      { type: 'progress', value: 5, max: 5, node: null },
      new Set(),
      6000,
    );
    expect(sampleClockDurationMs(clock)).toBe(5000);
  });
});
