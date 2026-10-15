/**
 * Persist Civitai AutoV2 on the model file itself via NTFS ADS `AUTOV2`.
 * Follows the file across moves/renames on the same NTFS volume.
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeAutoV2 } from '../domain/modelHash.js';
import { AUTOV2_ADS_NAME, buildStreamPath } from '../shared/ads/paths.js';
import { withPreservedHostTimesSync } from '../shared/ads/preserveHostTimes.js';

/** Re-export for callers that imported the stream name from this module. */
export { AUTOV2_ADS_NAME };
/** Process-lifetime cache so browse paths avoid re-reading ADS every call. */
const sessionByPath = new Map<string, string>();

function cacheKey(absolutePath: string): string {
  return path.resolve(absolutePath).toLowerCase();
}

function adsPath(modelAbsolutePath: string): string {
  return buildStreamPath(modelAbsolutePath, AUTOV2_ADS_NAME);
}

export function rememberSessionAutoV2(
  modelAbsolutePath: string,
  autoV2Raw: string,
): void {
  const autoV2 = normalizeAutoV2(autoV2Raw);
  if (!autoV2) return;
  sessionByPath.set(cacheKey(modelAbsolutePath), autoV2);
}

export function forgetSessionAutoV2(modelAbsolutePath: string): void {
  sessionByPath.delete(cacheKey(modelAbsolutePath));
}

export function moveSessionAutoV2(
  oldAbsolutePath: string,
  newAbsolutePath: string,
): void {
  const key = cacheKey(oldAbsolutePath);
  const hash = sessionByPath.get(key);
  sessionByPath.delete(key);
  if (hash) sessionByPath.set(cacheKey(newAbsolutePath), hash);
}

export function sessionAutoV2Count(): number {
  return sessionByPath.size;
}

export function getSessionAutoV2(modelAbsolutePath: string): string | null {
  return sessionByPath.get(cacheKey(modelAbsolutePath)) ?? null;
}

/** Read AutoV2 from session cache or the file's `AUTOV2` ADS (NTFS). */
export function readAutoV2Ads(modelAbsolutePath: string): string | null {
  if (!modelAbsolutePath?.trim()) return null;
  const cached = sessionByPath.get(cacheKey(modelAbsolutePath));
  if (cached) return cached;
  try {
    const text = fs.readFileSync(adsPath(modelAbsolutePath), 'utf8');
    const autoV2 = normalizeAutoV2(text);
    if (autoV2) sessionByPath.set(cacheKey(modelAbsolutePath), autoV2);
    return autoV2;
  } catch {
    return null;
  }
}

/**
 * Write AutoV2 into the file's `AUTOV2` ADS. Returns false when the volume
 * does not support ADS (non-NTFS) or the host file is missing.
 * Always updates the session cache when the hash is valid.
 * Host atime/mtime are restored — $DATA is not modified.
 */
export function writeAutoV2Ads(
  modelAbsolutePath: string,
  autoV2Raw: string,
): boolean {
  const autoV2 = normalizeAutoV2(autoV2Raw);
  if (!autoV2 || !modelAbsolutePath?.trim()) return false;
  sessionByPath.set(cacheKey(modelAbsolutePath), autoV2);
  try {
    return withPreservedHostTimesSync(modelAbsolutePath, () => {
      fs.writeFileSync(adsPath(modelAbsolutePath), autoV2, 'utf8');
      return true;
    });
  } catch {
    return false;
  }
}

/** Delete the `AUTOV2` stream if present (model file itself is untouched). */
export function deleteAutoV2Ads(modelAbsolutePath: string): boolean {
  if (!modelAbsolutePath?.trim()) return false;
  sessionByPath.delete(cacheKey(modelAbsolutePath));
  try {
    return withPreservedHostTimesSync(modelAbsolutePath, () => {
      fs.unlinkSync(adsPath(modelAbsolutePath));
      return true;
    });
  } catch {
    return false;
  }
}

/**
 * Copy AUTOV2 from one path to another (app-driven copy/rename when ADS may
 * not follow automatically).
 */
export function copyAutoV2Ads(
  fromAbsolutePath: string,
  toAbsolutePath: string,
): boolean {
  const hash =
    getSessionAutoV2(fromAbsolutePath) ?? readAutoV2Ads(fromAbsolutePath);
  if (!hash) return false;
  return writeAutoV2Ads(toAbsolutePath, hash);
}
