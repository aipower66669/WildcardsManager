import { describe, expect, it } from 'vitest';
import {
  isCivitaiMediaMovedNotFound,
  rewriteCivitaiOriginalTrueFallback,
} from './civitaiMediaOriginRetry.js';

describe('rewriteCivitaiOriginalTrueFallback', () => {
  it('replaces original=true with width= on image.civitai.com', () => {
    expect(
      rewriteCivitaiOriginalTrueFallback(
        'https://image.civitai.com/x/d950e43f-7f21-4541-b0ef-15296eee45dd/original=true/file.jpeg',
        1248,
      ),
    ).toBe(
      'https://image.civitai.com/x/d950e43f-7f21-4541-b0ef-15296eee45dd/width=1248/file.jpeg',
    );
  });

  it('defaults to width=4096 when pixel size is unknown', () => {
    expect(
      rewriteCivitaiOriginalTrueFallback(
        'https://image.civitai.com/x/uuid/original=true/file.mp4',
      ),
    ).toBe('https://image.civitai.com/x/uuid/width=4096/file.mp4');
  });

  it('does not invent image.civitai.red', () => {
    const next = rewriteCivitaiOriginalTrueFallback(
      'https://image.civitai.com/x/uuid/original=true/file.jpeg',
    );
    expect(next).toContain('image.civitai.com');
    expect(next).not.toContain('civitai.red');
  });

  it('leaves already-sized URLs alone', () => {
    expect(
      rewriteCivitaiOriginalTrueFallback(
        'https://image.civitai.com/x/uuid/width=450/file.jpeg',
      ),
    ).toBeNull();
  });
});

describe('isCivitaiMediaMovedNotFound', () => {
  it('matches the CDN 404 JSON', () => {
    expect(
      isCivitaiMediaMovedNotFound({
        status: 404,
        body: '{"code":"not_found","message":"File with such name does not exist.","status":404}',
      }),
    ).toBe(true);
  });

  it('does not retry other HTTP errors', () => {
    expect(
      isCivitaiMediaMovedNotFound({
        status: 403,
        body: '{"code":"forbidden"}',
      }),
    ).toBe(false);
  });
});
