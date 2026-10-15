import { describe, expect, it } from 'vitest';
import {
  civitaiMediaKnownGeneration,
  invalidateCivitaiMediaKnown,
} from './civitaiMediaKnownCache.js';

describe('civitaiMediaKnownCache', () => {
  it('bumps only the requested media generation', () => {
    const imageBefore = civitaiMediaKnownGeneration('image');
    const videoBefore = civitaiMediaKnownGeneration('video');
    invalidateCivitaiMediaKnown('image');
    expect(civitaiMediaKnownGeneration('image')).toBe(imageBefore + 1);
    expect(civitaiMediaKnownGeneration('video')).toBe(videoBefore);
    invalidateCivitaiMediaKnown('video');
    expect(civitaiMediaKnownGeneration('video')).toBe(videoBefore + 1);
  });
});
