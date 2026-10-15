import { describe, expect, it } from 'vitest';
import { pickBenchmarkPreviewImages } from './checkpointBenchmarkPreview.js';

describe('pickBenchmarkPreviewImages', () => {
  it('picks newest as master and keeps up to 9 gens', () => {
    const hits = Array.from({ length: 12 }, (_, i) => ({
      absolutePath: `/b/WCG_${i}.png`,
      size: 1000,
      mtimeMs: i * 1000,
    }));
    const result = pickBenchmarkPreviewImages(hits);
    expect(result?.masterAbsolutePath).toBe('/b/WCG_11.png');
    expect(result?.genAbsolutePaths).toHaveLength(9);
    expect(result?.genAbsolutePaths[0]).toBe('/b/WCG_10.png');
  });

  it('returns null when empty', () => {
    expect(pickBenchmarkPreviewImages([])).toBeNull();
  });
});
