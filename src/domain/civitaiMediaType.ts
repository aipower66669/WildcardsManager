/**
 * Community `/images` items are stills or videos. Civitai’s `type=image`
 * query is not always enough — responses still include `type: "video"` rows
 * and `.mp4` edge URLs. Keep Images and Videos downloads on their own media.
 */

export type CivitaiCommunityMediaKind = 'image' | 'video' | 'audio' | 'unknown';

const VIDEO_PATH = /\.(mp4|webm|mov|m4v)$/i;
const IMAGE_PATH = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;

export class CivitaiMediaTypeMismatchError extends Error {
  readonly requested: 'image' | 'video';

  constructor(requested: 'image' | 'video', detail: string) {
    super(detail);
    this.name = 'CivitaiMediaTypeMismatchError';
    this.requested = requested;
  }
}

export function civitaiCommunityMediaKind(input: {
  type?: string | null;
  url?: string | null;
}): CivitaiCommunityMediaKind {
  const declared = input.type?.trim().toLowerCase();
  if (declared === 'video' || declared === 'image' || declared === 'audio') {
    return declared;
  }

  const url = input.url?.trim() ?? '';
  if (!url) return 'unknown';
  if (/video\.civitai\.com/i.test(url)) return 'video';

  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // use the raw string
  }
  if (VIDEO_PATH.test(pathname)) return 'video';
  if (IMAGE_PATH.test(pathname)) return 'image';
  return 'unknown';
}

/** Images keep untyped stills (Civitai often omits `type` and extensions). */
export function civitaiHitMatchesRequestedMedia(
  kind: CivitaiCommunityMediaKind,
  requested: 'image' | 'video',
): boolean {
  if (kind === 'audio') return false;
  if (kind === 'unknown') return requested === 'image';
  return kind === requested;
}

export function isCivitaiVideoContentType(contentType: string | null | undefined): boolean {
  return /^video\//i.test(contentType?.split(';')[0]?.trim() ?? '');
}

export function isCivitaiImageContentType(contentType: string | null | undefined): boolean {
  return /^image\//i.test(contentType?.split(';')[0]?.trim() ?? '');
}

/** MP4/MOV (`ftyp`) or WebM/Matroska — Civitai sometimes labels these as JPEG. */
export function bufferLooksLikeVideo(bytes: Uint8Array): boolean {
  if (bytes.length >= 8) {
    const brand = String.fromCharCode(
      bytes[4]!,
      bytes[5]!,
      bytes[6]!,
      bytes[7]!,
    );
    if (brand === 'ftyp') return true;
  }
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  );
}
