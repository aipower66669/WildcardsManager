import { describe, expect, it } from 'vitest';
import {
  decodeAdsText,
  parseMfeMetaFieldRating,
} from './mfeMeta.js';

describe('parseMfeMetaFieldRating', () => {
  it('reads field_rating from the My File Explorer metadata string', () => {
    const text = JSON.stringify({
      format: 'MyFileExplorer.UserMetadata',
      version: 1,
      updatedAt: '2026-10-17T07:52:18.998Z',
      values: { field_rating: 10 },
    });
    expect(parseMfeMetaFieldRating(text)).toBe(10);
  });

  it('returns null when the stream has no rating', () => {
    expect(parseMfeMetaFieldRating('')).toBeNull();
    expect(parseMfeMetaFieldRating('not json')).toBeNull();
    expect(parseMfeMetaFieldRating('{"values":{}}')).toBeNull();
  });

  it('reads the UTF-8 payload My File Explorer writes (JSON, NUL, CRLF)', () => {
    const json = JSON.stringify({
      format: 'MyFileExplorer.UserMetadata',
      version: 1,
      updatedAt: '2026-10-17T07:58:21.502Z',
      values: { field_rating: 8 },
    });
    const payload = Buffer.from(`${json}\0\r\n`, 'utf8');
    expect(parseMfeMetaFieldRating(decodeAdsText(payload))).toBe(8);
    expect(parseMfeMetaFieldRating(`${json}\0\r\n`)).toBe(8);
  });

  it('reads a UTF-16 LE stream body', () => {
    const json = JSON.stringify({
      format: 'MyFileExplorer.UserMetadata',
      version: 1,
      values: { field_rating: 9 },
    });
    const withBom = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(json, 'utf16le'),
    ]);
    const bare = Buffer.from(json, 'utf16le');
    expect(parseMfeMetaFieldRating(decodeAdsText(withBom))).toBe(9);
    expect(parseMfeMetaFieldRating(decodeAdsText(bare))).toBe(9);
    // A UTF-8 decode of that body is not JSON — that was dropping every rating.
    expect(parseMfeMetaFieldRating(withBom.toString('utf8'))).toBeNull();
  });
});
