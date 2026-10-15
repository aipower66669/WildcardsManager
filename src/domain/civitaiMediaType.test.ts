import { describe, expect, it } from 'vitest';
import {
  bufferLooksLikeVideo,
  civitaiCommunityMediaKind,
  civitaiHitMatchesRequestedMedia,
  isCivitaiImageContentType,
  isCivitaiVideoContentType,
} from './civitaiMediaType.js';

describe('civitaiCommunityMediaKind', () => {
  it('trusts the API type field over the URL', () => {
    expect(
      civitaiCommunityMediaKind({
        type: 'video',
        url: 'https://image.civitai.com/x/width=450/abc.jpeg',
      }),
    ).toBe('video');
    expect(
      civitaiCommunityMediaKind({
        type: 'image',
        url: 'https://image.civitai.com/x/original=true/abc.mp4',
      }),
    ).toBe('image');
  });

  it('infers video from mp4 / video CDN when type is missing', () => {
    expect(
      civitaiCommunityMediaKind({
        url: 'https://image.civitai.com/x/original=true/abc.mp4',
      }),
    ).toBe('video');
    expect(
      civitaiCommunityMediaKind({
        url: 'https://video.civitai.com/clip/123',
      }),
    ).toBe('video');
  });

  it('treats extensionless Civitai stills as unknown', () => {
    expect(
      civitaiCommunityMediaKind({
        url: 'https://image.civitai.com/x/width=450/abc',
      }),
    ).toBe('unknown');
  });
});

describe('civitaiHitMatchesRequestedMedia', () => {
  it('keeps unknown hits on Images and drops them on Videos', () => {
    expect(civitaiHitMatchesRequestedMedia('unknown', 'image')).toBe(true);
    expect(civitaiHitMatchesRequestedMedia('unknown', 'video')).toBe(false);
  });

  it('never mixes image and video', () => {
    expect(civitaiHitMatchesRequestedMedia('video', 'image')).toBe(false);
    expect(civitaiHitMatchesRequestedMedia('image', 'video')).toBe(false);
    expect(civitaiHitMatchesRequestedMedia('video', 'video')).toBe(true);
    expect(civitaiHitMatchesRequestedMedia('image', 'image')).toBe(true);
  });
});

describe('content-type and magic', () => {
  it('detects video and image content types', () => {
    expect(isCivitaiVideoContentType('video/mp4; charset=binary')).toBe(true);
    expect(isCivitaiImageContentType('image/jpeg')).toBe(true);
    expect(isCivitaiVideoContentType('image/jpeg')).toBe(false);
  });

  it('detects mp4 ftyp and webm headers', () => {
    const mp4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 1, 2]);
    expect(bufferLooksLikeVideo(mp4)).toBe(true);
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0]);
    expect(bufferLooksLikeVideo(webm)).toBe(true);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(bufferLooksLikeVideo(jpeg)).toBe(false);
  });
});
