import { createHash } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  autoV2FromSha256,
  normalizeAutoV2,
  parseAutoV2FromHashSidecarText,
} from '../domain/modelHash.js';
import { buildStreamPath, AUTOV2_ADS_NAME } from '../shared/ads/paths.js';
import { withPreservedHostTimes } from '../shared/ads/preserveHostTimes.js';

export type ResolvedFileAutoV2 = {
  autoV2: string | null;
  size: number;
  mtimeMs: number;
};

/**
 * Stream a model file and return Civitai AutoV2 (SHA-256 prefix).
 * Safe to run inside a worker thread — does not touch Electron APIs.
 */
export async function hashFileAutoV2(
  absolutePath: string,
): Promise<string | null> {
  try {
    const hash = createHash('sha256');
    // Small chunks — default highWaterMark can retain large buffers while
    // hashing multi‑GB safetensors overnight.
    await pipeline(
      createReadStream(absolutePath, { highWaterMark: 64 * 1024 }),
      hash,
    );
    return autoV2FromSha256(hash.digest('hex'));
  } catch {
    return null;
  }
}

async function readAdsAutoV2(absolutePath: string): Promise<string | null> {
  try {
    const text = await fsp.readFile(
      buildStreamPath(absolutePath, AUTOV2_ADS_NAME),
      'utf8',
    );
    return normalizeAutoV2(text);
  } catch {
    return null;
  }
}

async function writeAdsAutoV2(
  absolutePath: string,
  autoV2: string,
): Promise<void> {
  try {
    await withPreservedHostTimes(absolutePath, async () => {
      await fsp.writeFile(
        buildStreamPath(absolutePath, AUTOV2_ADS_NAME),
        autoV2,
        'utf8',
      );
    });
  } catch {
    /* non-NTFS / permission — caller still has the hash in memory */
  }
}

/**
 * Prefer AUTOV2 ADS, then sibling hash `.txt`, else SHA-256 the weights.
 * Newly resolved hashes are written back to ADS so they follow the file.
 * ADS write restores the host file’s atime/mtime ($DATA is not modified).
 */
export async function resolveFileAutoV2(
  absolutePath: string,
): Promise<ResolvedFileAutoV2> {
  try {
    const st = await fsp.stat(absolutePath);
    if (!st.isFile()) return { autoV2: null, size: 0, mtimeMs: 0 };

    const fromAds = await readAdsAutoV2(absolutePath);
    if (fromAds) {
      return { autoV2: fromAds, size: st.size, mtimeMs: st.mtimeMs };
    }

    const dir = path.dirname(absolutePath);
    const stem = path.basename(absolutePath, path.extname(absolutePath));
    const sidecar = path.join(dir, `${stem}.txt`);
    try {
      const tst = await fsp.stat(sidecar);
      if (tst.isFile() && tst.size > 0 && tst.size <= 256 * 1024) {
        const text = await fsp.readFile(sidecar, 'utf8');
        const fromSidecar = parseAutoV2FromHashSidecarText(text);
        if (fromSidecar) {
          await writeAdsAutoV2(absolutePath, fromSidecar);
          return {
            autoV2: fromSidecar,
            size: st.size,
            mtimeMs: st.mtimeMs,
          };
        }
      }
    } catch {
      /* no usable sidecar */
    }

    const autoV2 = await hashFileAutoV2(absolutePath);
    if (autoV2) await writeAdsAutoV2(absolutePath, autoV2);
    return { autoV2, size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return { autoV2: null, size: 0, mtimeMs: 0 };
  }
}
