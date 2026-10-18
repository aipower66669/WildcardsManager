/**
 * My File Explorer user-metadata stream (`mfe_meta`).
 * The stream body is a JSON string:
 * `{ "format": "MyFileExplorer.UserMetadata", "version": 1, "values": { "field_rating": 10 } }`
 */

export const MFE_META_ADS_NAME = 'mfe_meta';
export const MFE_META_FORMAT = 'MyFileExplorer.UserMetadata';

/**
 * My File Explorer saves a stream as UTF-8 text, then a NUL, then CRLF
 * (`writeStreamText`). Cut at the first NUL and drop the trailing CR/LF,
 * same as `normalizeLoadedAdsText`. A NUL left in the string is not JSON.
 */
export function normalizeLoadedAdsText(raw: string): string {
  let s = raw;
  const idx0 = s.indexOf('\0');
  if (idx0 >= 0) s = s.slice(0, idx0);
  while (s.endsWith('\r') || s.endsWith('\n')) s = s.slice(0, -1);
  return s;
}

/**
 * Turn an NTFS stream body into text. The usual `mfe_meta` body is UTF-8.
 * UTF-16 LE (with or without a BOM) is accepted too.
 */
export function decodeAdsText(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let text: string;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = Buffer.from(bytes.subarray(2)).toString('utf16le');
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.alloc(bytes.length - 2);
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      swapped[i] = bytes[i + 3]!;
      swapped[i + 1] = bytes[i + 2]!;
    }
    text = swapped.toString('utf16le');
  } else if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    text = Buffer.from(bytes.subarray(3)).toString('utf8');
  } else if (looksLikeUtf16Le(bytes)) {
    text = Buffer.from(bytes).toString('utf16le');
  } else {
    text = Buffer.from(bytes).toString('utf8');
  }
  return normalizeLoadedAdsText(text.replace(/^\uFEFF/, ''));
}

/** ASCII JSON stored as UTF-16 LE has a 0 in every high byte. */
function looksLikeUtf16Le(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || bytes.length % 2 !== 0) return false;
  const sample = Math.min(bytes.length, 64);
  let zeros = 0;
  for (let i = 1; i < sample; i += 2) {
    if (bytes[i] === 0) zeros += 1;
  }
  return zeros >= sample / 4;
}

function ratingFromValues(values: object): number | null {
  const rating = (values as { field_rating?: unknown }).field_rating;
  if (typeof rating === 'number' && Number.isFinite(rating)) return rating;
  if (typeof rating === 'string' && rating.trim()) {
    const parsed = Number(rating);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** `field_rating` from an `mfe_meta` JSON string, or null when absent. */
export function parseMfeMetaFieldRating(text: string): number | null {
  const body = normalizeLoadedAdsText(text.replace(/^\uFEFF/, '')).trim();
  if (!body) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const values = (raw as { values?: unknown }).values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  return ratingFromValues(values);
}
