/**
 * Read My File Explorer `mfe_meta` from a file or folder (NTFS ADS).
 * Missing stream, non-NTFS, or no `field_rating` → null.
 */
import fs from 'node:fs';
import {
  decodeAdsText,
  MFE_META_ADS_NAME,
  parseMfeMetaFieldRating,
} from '../domain/mfeMeta.js';
import { buildStreamPath } from '../shared/ads/paths.js';

export function readMfeFieldRating(absolutePath: string): number | null {
  const host = absolutePath.trim().replace(/[\\/]+$/, '');
  if (!host) return null;
  try {
    const buf = fs.readFileSync(buildStreamPath(host, MFE_META_ADS_NAME));
    return parseMfeMetaFieldRating(decodeAdsText(buf));
  } catch {
    return null;
  }
}
