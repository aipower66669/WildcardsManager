import { describe, expect, it } from 'vitest';
import {
  COMMON_GENERATION_RESOLUTIONS,
  stepGenerationResolution,
  swapGenerationSize,
} from './generationResolution.js';

describe('generation resolution steps', () => {
  it('only lists sizes whose sides are multiples of 16', () => {
    const seen = new Set<string>();
    for (const [w, h] of COMMON_GENERATION_RESOLUTIONS) {
      expect(w % 16).toBe(0);
      expect(h % 16).toBe(0);
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
      const key = `${w}x${h}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('swaps width and height', () => {
    expect(swapGenerationSize(1600, 1200)).toEqual({
      width: 1200,
      height: 1600,
    });
    expect(swapGenerationSize(1200, 1600)).toEqual({
      width: 1600,
      height: 1200,
    });
  });

  it('steps a 4:3 frame along the same shape', () => {
    expect(stepGenerationResolution(1600, 1200, 'down')).toEqual({
      width: 1536,
      height: 1152,
    });
    expect(stepGenerationResolution(1600, 1200, 'up')).toEqual({
      width: 1920,
      height: 1440,
    });
    expect(stepGenerationResolution(1200, 1600, 'down')).toEqual({
      width: 1152,
      height: 1536,
    });
  });

  it('keeps an SDXL portrait on a close ratio instead of a same-megapixel shape', () => {
    expect(stepGenerationResolution(832, 1216, 'down')).toEqual({
      width: 768,
      height: 1152,
    });
    expect(stepGenerationResolution(832, 1216, 'up')).toEqual({
      width: 1024,
      height: 1536,
    });
  });

  it('steps squares to the nearest square', () => {
    expect(stepGenerationResolution(1024, 1024, 'down')).toEqual({
      width: 768,
      height: 768,
    });
    expect(stepGenerationResolution(1024, 1024, 'up')).toEqual({
      width: 1152,
      height: 1152,
    });
  });

  it('does not treat an 8px alignment as a resolution change', () => {
    expect(stepGenerationResolution(1920, 1080, 'up')).toEqual({
      width: 2048,
      height: 1152,
    });
    expect(stepGenerationResolution(1920, 1080, 'down')).toEqual({
      width: 1536,
      height: 864,
    });
  });

  it('stops at the ends of the list', () => {
    expect(stepGenerationResolution(512, 512, 'down')).toBeNull();
    expect(stepGenerationResolution(2048, 2048, 'up')).toBeNull();
  });

  it('may pick a nearer common shape when the aspect is within about 2%', () => {
    expect(stepGenerationResolution(720, 1280, 'up')).toEqual({
      width: 768,
      height: 1344,
    });
    expect(stepGenerationResolution(864, 1536, 'down')).toEqual({
      width: 768,
      height: 1344,
    });
  });

  it('every step stays on the list and moves the pixel count', () => {
    for (const [w, h] of COMMON_GENERATION_RESOLUTIONS) {
      for (const direction of ['down', 'up'] as const) {
        const next = stepGenerationResolution(w, h, direction);
        if (!next) continue;
        expect(next.width % 16).toBe(0);
        expect(next.height % 16).toBe(0);
        const listed = COMMON_GENERATION_RESOLUTIONS.some(
          ([cw, ch]) => cw === next.width && ch === next.height,
        );
        expect(listed).toBe(true);
        const area = w * h;
        const nextArea = next.width * next.height;
        if (direction === 'down') expect(nextArea).toBeLessThan(area);
        else expect(nextArea).toBeGreaterThan(area);
      }
    }
  });
});
