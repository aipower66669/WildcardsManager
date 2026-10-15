import { describe, expect, it } from 'vitest';
import {
  PREVIEW_FULL_TAG,
  PREVIEW_MAX_HEIGHT,
  PREVIEW_MAX_WIDTH,
  PREVIEW_SIZE_TAG,
  civitaiPreviewFileName,
  civitaiPreviewFullFileName,
  civitaiSizedPreviewUrl,
  civitaiVideoPosterUrl,
  hashCivitaiPreviewUrl,
  localCivitaiPreviewUrl,
} from '../shared/civitaiPreviewUrl.js';

describe('civitaiPreviewUrl thumbnails', () => {
  it('uses a 512×768 (2:3) catalog thumb policy', () => {
    expect(PREVIEW_MAX_WIDTH).toBe(512);
    expect(PREVIEW_MAX_HEIGHT).toBe(768);
    expect(PREVIEW_MAX_WIDTH / PREVIEW_MAX_HEIGHT).toBeCloseTo(2 / 3);
    expect(PREVIEW_SIZE_TAG).toBe('w512');
    expect(PREVIEW_FULL_TAG).toBe('full');
  });

  it('names thumb and full files from the same URL hash', () => {
    const url = 'https://image.civitai.com/x/width=450/abc.jpeg';
    const hash = hashCivitaiPreviewUrl(url);
    expect(civitaiPreviewFileName(url)).toBe(`w512-${hash}.jpg`);
    expect(civitaiPreviewFullFileName(url)).toBe(`full-${hash}.jpg`);
    expect(localCivitaiPreviewUrl(url)).toContain(
      encodeURIComponent(`w512-${hash}.jpg`),
    );
  });

  it('rewrites video mp4 URLs to a JPEG still-frame poster', () => {
    const url =
      'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/d312d8af-d8b6-41e4-bb52-8c0265e2a1fb/original=true/d312d8af-d8b6-41e4-bb52-8c0265e2a1fb.mp4';
    expect(civitaiVideoPosterUrl(url, 450)).toBe(
      'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/d312d8af-d8b6-41e4-bb52-8c0265e2a1fb/width=450,anim=false,transcode=true/d312d8af-d8b6-41e4-bb52-8c0265e2a1fb.jpeg',
    );
  });

  it('preserves video poster flags when bumping width for cache fetch', () => {
    const poster =
      'https://image.civitai.com/x/uuid/width=450,anim=false,transcode=true/file.jpeg';
    expect(civitaiSizedPreviewUrl(poster, 1024)).toBe(
      'https://image.civitai.com/x/uuid/width=1024,anim=false,transcode=true/file.jpeg',
    );
  });
});
