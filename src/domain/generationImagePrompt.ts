/**
 * Last-output caption from image metadata — same rules as My File Explorer:
 * read A1111-style `parameters` / `comment` (PNG tEXt, JPEG COM, EXIF), never
 * Comfy’s embedded `prompt` JSON (that still has pre–Dynamic Prompts text).
 */

import { inflateSync } from 'node:zlib';

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const SETTINGS_LINE = /^\s*Steps:\s*\d+/i;
const NEGATIVE_MARKER = /^Negative prompt:\s?/im;

export type A1111Parameters = {
  prompt: string;
  negative: string | null;
  raw: string;
};

/** Positive + optional negative from generation image metadata. */
export type GenerationImagePrompts = {
  positive: string;
  negative: string | null;
};

/** Extract prompts My File Explorer would show under Generation. */
export function extractGenerationPromptsFromImage(
  bytes: Uint8Array,
): GenerationImagePrompts | null {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const paramsText = resolveGenerationParametersText(buf);
  if (!paramsText) return null;
  const parsed = parseA1111Parameters(paramsText);
  if (parsed?.prompt) {
    return {
      positive: parsed.prompt,
      negative: parsed.negative?.trim() || null,
    };
  }
  // Non-A1111 blob that still looks like a plain prompt (no JSON workflow).
  const trimmed = paramsText.trim();
  if (trimmed && !looksLikeJson(trimmed) && !hasUnresolvedWildcards(trimmed)) {
    return { positive: trimmed, negative: null };
  }
  return null;
}

/** @deprecated prefer extractGenerationPromptsFromImage */
export function extractGenerationPromptFromImage(
  bytes: Uint8Array,
): string | null {
  return extractGenerationPromptsFromImage(bytes)?.positive ?? null;
}

/**
 * Prefer file metadata whenever extraction succeeded.
 * Fall back to the constructed positive / request negative when missing.
 */
export function selectLastOutputPrompts(
  fromImage: GenerationImagePrompts | null | undefined,
  constructedPositive: string,
  constructedNegative?: string | null,
): GenerationImagePrompts {
  if (fromImage?.positive.trim()) {
    return {
      positive: fromImage.positive.trim(),
      negative: fromImage.negative?.trim() || null,
    };
  }
  const neg = constructedNegative?.trim() || null;
  return {
    positive: constructedPositive.trim(),
    negative: neg,
  };
}

/** @deprecated prefer selectLastOutputPrompts */
export function selectLastOutputCaption(
  fromImage: string | null | undefined,
  constructed: string,
): string {
  const image = fromImage?.trim() || '';
  if (image) return image;
  return constructed.trim();
}

export function hasUnresolvedWildcards(text: string): boolean {
  return /__[^_\n](?:[^_\n]|_(?!_))*__/.test(text);
}

/**
 * Parse an A1111 / Forge / Comfy-saver "parameters" block
 * (same algorithm as My File Explorer `parseA1111Parameters`).
 */
export function parseA1111Parameters(raw: string): A1111Parameters | null {
  if (!raw || raw.trim().length === 0) return null;
  const text = raw.replace(/\r\n/g, '\n').trim();
  const lines = text.split('\n');

  let settingsLineIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (SETTINGS_LINE.test(lines[i]!)) {
      settingsLineIdx = i;
      break;
    }
  }

  const negativeMatch = NEGATIVE_MARKER.exec(text);
  if (settingsLineIdx === -1 && !negativeMatch) return null;

  const beforeSettings =
    settingsLineIdx >= 0 ? lines.slice(0, settingsLineIdx).join('\n') : text;

  let prompt = beforeSettings;
  let negative: string | null = null;
  const negIdx = beforeSettings.search(NEGATIVE_MARKER);
  if (negIdx >= 0) {
    prompt = beforeSettings.slice(0, negIdx);
    negative = beforeSettings.slice(negIdx).replace(NEGATIVE_MARKER, '').trim();
  }

  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) return null;

  return {
    prompt: trimmedPrompt,
    negative,
    raw: text,
  };
}

/** Collect parameter candidates, then pick the first that parses as A1111. */
export function resolveGenerationParametersText(buf: Buffer): string | null {
  const candidates = collectGenerationParameterCandidates(buf);
  for (const c of candidates) {
    if (parseA1111Parameters(c) !== null) return c;
  }
  return null;
}

/**
 * Same sources as My File Explorer `collectGenerationParameterCandidates`:
 * PNG `parameters` / `comment`, JPEG COM, EXIF UserComment / description.
 */
export function collectGenerationParameterCandidates(buf: Buffer): string[] {
  const candidates: string[] = [];
  const push = (s: string | null | undefined): void => {
    const t = s?.trim();
    if (t && !candidates.includes(t)) candidates.push(t);
  };

  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) {
    for (const c of extractPngTextChunks(buf)) {
      const k = c.keyword.toLowerCase();
      if (k === 'parameters' || k === 'comment') push(c.text);
    }
    const exif = readPngExifBuffer(buf);
    if (exif) {
      for (const c of extractExifTextCandidates(exif)) push(c);
    }
  } else if (isJpeg(buf)) {
    for (const c of extractJpegComComments(buf)) push(c);
    // APP1 Exif is handled inside extractJpegComComments walk below for COM;
    // also pull EXIF from APP1.
    for (const c of extractJpegExifCandidates(buf)) push(c);
  }

  return candidates;
}

export type PngTextChunk = { keyword: string; text: string };

/** PNG tEXt / zTXt / iTXt (My File Explorer `extractPngTextChunks`). */
export function extractPngTextChunks(buf: Buffer): PngTextChunk[] {
  const out: PngTextChunk[] = [];
  if (buf.length < PNG_SIG.length + 8) return out;
  if (!buf.subarray(0, 8).equals(PNG_SIG)) return out;

  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (length > buf.length || dataEnd + 4 > buf.length) break;
    if (type === 'IEND') break;

    if (
      length <= MAX_TEXT_BYTES &&
      (type === 'tEXt' || type === 'zTXt' || type === 'iTXt')
    ) {
      const data = buf.subarray(dataStart, dataEnd);
      const chunk = parseTextChunk(type, data);
      if (chunk) out.push(chunk);
    }
    offset = dataEnd + 4;
  }
  return out;
}

/** @deprecated use extractPngTextChunks — kept for older tests */
export function readPngTextChunks(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of extractPngTextChunks(buf)) {
    if (!(c.keyword in out)) out[c.keyword] = c.text;
  }
  return out;
}

function parseTextChunk(type: string, data: Buffer): PngTextChunk | null {
  try {
    const nul = data.indexOf(0);
    if (nul <= 0 || nul > 79) return null;
    const keyword = data.toString('latin1', 0, nul);

    if (type === 'tEXt') {
      return { keyword, text: data.toString('latin1', nul + 1) };
    }

    if (type === 'zTXt') {
      const method = data[nul + 1];
      if (method !== 0) return null;
      const inflated = inflateSync(data.subarray(nul + 2), {
        maxOutputLength: MAX_TEXT_BYTES,
      });
      return { keyword, text: inflated.toString('latin1') };
    }

    const compressed = data[nul + 1] === 1;
    let p = nul + 3;
    const langEnd = data.indexOf(0, p);
    if (langEnd < 0) return null;
    p = langEnd + 1;
    const translatedEnd = data.indexOf(0, p);
    if (translatedEnd < 0) return null;
    p = translatedEnd + 1;
    const body = data.subarray(p);
    const text = compressed
      ? inflateSync(body, { maxOutputLength: MAX_TEXT_BYTES }).toString('utf8')
      : body.toString('utf8');
    return { keyword, text };
  } catch {
    return null;
  }
}

function readPngExifBuffer(buf: Buffer): Buffer | null {
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    if (length < 0 || offset + 12 + length > buf.length) break;
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === 'eXIf') return Buffer.from(buf.subarray(dataStart, dataEnd));
    if (type === 'IEND') break;
    offset = dataEnd + 4;
  }
  return null;
}

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8;
}

function extractJpegComComments(buf: Buffer): string[] {
  const out: string[] = [];
  if (!isJpeg(buf)) return out;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    while (i < buf.length && buf[i] === 0xff) i++;
    if (i >= buf.length) break;
    const marker = buf[i++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (i + 2 > buf.length) break;
    const len = buf.readUInt16BE(i);
    if (len < 2 || i + len > buf.length) break;
    if (marker === 0xfe) {
      const payload = buf.subarray(i + 2, i + len);
      const text = decodeLatin1OrUtf8(payload).replace(/\0+$/g, '').trim();
      if (text) out.push(text);
    }
    i += len;
  }
  return out;
}

function extractJpegExifCandidates(buf: Buffer): string[] {
  const out: string[] = [];
  if (!isJpeg(buf)) return out;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    while (i < buf.length && buf[i] === 0xff) i++;
    if (i >= buf.length) break;
    const marker = buf[i++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (i + 2 > buf.length) break;
    const len = buf.readUInt16BE(i);
    if (len < 2 || i + len > buf.length) break;
    if (marker === 0xe1) {
      const payload = buf.subarray(i + 2, i + len);
      if (
        payload.length >= 6 &&
        payload.subarray(0, 4).toString('ascii') === 'Exif'
      ) {
        for (const c of extractExifTextCandidates(payload)) out.push(c);
      }
    }
    i += len;
  }
  return out;
}

function decodeLatin1OrUtf8(buf: Buffer): string {
  const asUtf8 = buf.toString('utf8');
  if (asUtf8.includes('\uFFFD') && buf.some((b) => b >= 0x80)) {
    return buf.toString('latin1');
  }
  return asUtf8;
}

/** Best-effort TIFF/EXIF text tags (MFE `extractExifTextCandidates`). */
export function extractExifTextCandidates(exifBuf: Buffer): string[] {
  const out: string[] = [];
  if (exifBuf.length < 12) return out;

  let tiffStart = 0;
  if (
    exifBuf.length >= 6 &&
    exifBuf.subarray(0, 4).toString('ascii') === 'Exif' &&
    exifBuf[4] === 0 &&
    exifBuf[5] === 0
  ) {
    tiffStart = 6;
  }

  const tiff = exifBuf.subarray(tiffStart);
  if (tiff.length < 8) return out;
  const le = tiff.subarray(0, 2).toString('ascii') === 'II';
  const be = tiff.subarray(0, 2).toString('ascii') === 'MM';
  if (!le && !be) return out;
  const readU16 = (off: number): number =>
    le ? tiff.readUInt16LE(off) : tiff.readUInt16BE(off);
  const readU32 = (off: number): number =>
    le ? tiff.readUInt32LE(off) : tiff.readUInt32BE(off);

  type ExifEntry = {
    tag: number;
    type: number;
    count: number;
    valueOffset: number;
  };

  const visited = new Set<number>();
  const queue: number[] = [readU32(4)];

  const readEntries = (ifdOffset: number): ExifEntry[] => {
    if (ifdOffset < 0 || ifdOffset + 2 > tiff.length) return [];
    const n = readU16(ifdOffset);
    const entries: ExifEntry[] = [];
    for (let i = 0; i < n; i++) {
      const base = ifdOffset + 2 + i * 12;
      if (base + 12 > tiff.length) break;
      entries.push({
        tag: readU16(base),
        type: readU16(base + 2),
        count: readU32(base + 4),
        valueOffset: readU32(base + 8),
      });
    }
    return entries;
  };

  const typeSize = (type: number): number => {
    switch (type) {
      case 1:
      case 2:
      case 6:
      case 7:
        return 1;
      case 3:
      case 8:
        return 2;
      case 4:
      case 9:
      case 11:
        return 4;
      case 5:
      case 10:
      case 12:
        return 8;
      default:
        return 1;
    }
  };

  const readValueBytes = (e: ExifEntry): Buffer | null => {
    const size = typeSize(e.type) * e.count;
    if (size <= 0 || size > 2_000_000) return null;
    if (size <= 4) {
      const inline = Buffer.alloc(4);
      if (le) inline.writeUInt32LE(e.valueOffset, 0);
      else inline.writeUInt32BE(e.valueOffset, 0);
      return inline.subarray(0, size);
    }
    if (e.valueOffset + size > tiff.length) return null;
    return tiff.subarray(e.valueOffset, e.valueOffset + size);
  };

  const decodeAscii = (bytes: Buffer): string =>
    bytes.toString('utf8').replace(/\0+$/g, '').trim();

  const decodeUserComment = (bytes: Buffer): string => {
    if (bytes.length <= 8) return decodeAscii(bytes);
    const charset = bytes.subarray(0, 8).toString('ascii').replace(/\0+$/g, '');
    const payload = bytes.subarray(8);
    if (/^UNICODE$/i.test(charset)) {
      const payloadLe = le ? payload : Buffer.from(payload).swap16();
      return payloadLe.toString('utf16le').replace(/\0+$/g, '').trim();
    }
    if (/^ASCII$/i.test(charset) || charset === '') {
      return decodeAscii(payload);
    }
    return decodeLatin1OrUtf8(payload).replace(/\0+$/g, '').trim();
  };

  const decodeXp = (bytes: Buffer): string =>
    bytes.toString('utf16le').replace(/\0+$/g, '').trim();

  while (queue.length > 0) {
    const off = queue.shift()!;
    if (visited.has(off) || off < 0 || off >= tiff.length) continue;
    visited.add(off);
    const entries = readEntries(off);
    for (const e of entries) {
      if (e.tag === 0x8769 && e.type === 4 && e.count === 1) {
        queue.push(e.valueOffset);
        continue;
      }
      const bytes = readValueBytes(e);
      if (!bytes) continue;
      let text = '';
      if (e.tag === 0x010e && (e.type === 2 || e.type === 1)) {
        text = decodeAscii(bytes);
      } else if (e.tag === 0x9286) {
        text = decodeUserComment(bytes);
      } else if (e.tag === 0x9c9c && (e.type === 1 || e.type === 7)) {
        text = decodeXp(bytes);
      }
      if (text) out.push(text);
    }
    const n = readU16(off);
    const nextOff = off + 2 + n * 12;
    if (nextOff + 4 <= tiff.length) {
      const next = readU32(nextOff);
      if (next) queue.push(next);
    }
  }

  return out;
}

function looksLikeJson(value: string): boolean {
  const t = value.trim();
  return t.startsWith('{') || t.startsWith('[');
}
