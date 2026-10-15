/** On-disk paging for the Civitai catalog cache (v1). */
export const CATALOG_PAGE_SIZE = 1000;
export const CATALOG_CACHE_VERSION = 1 as const;

/**
 * Older builds briefly stamped meta as version 2 for the same layout.
 * Still readable; new writes use CATALOG_CACHE_VERSION.
 */
export const CATALOG_CACHE_LEGACY_VERSIONS = [2] as const;

/** Model card page index: ids 0–999 → 0, 1000–1999 → 1, … */
export function modelPageIndex(modelId: number): number {
  const id = Math.floor(modelId);
  if (!Number.isFinite(id) || id < 0) return 0;
  return Math.floor(id / CATALOG_PAGE_SIZE);
}

/** Split an ordered id list into chunks of `CATALOG_PAGE_SIZE`. */
export function chunkModelIds(
  ids: number[],
  pageSize = CATALOG_PAGE_SIZE,
): number[][] {
  if (ids.length === 0) return [];
  const size = Math.max(1, pageSize);
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

/** Filesystem-safe host segment from a Civitai origin URL. */
export function catalogOriginHost(origin: string): string {
  try {
    const host = new URL(origin).host;
    return host.replace(/[^a-zA-Z0-9.-]/g, '_') || 'unknown';
  } catch {
    return origin.replace(/[^a-zA-Z0-9.-]/g, '_') || 'unknown';
  }
}

/** Stable short dir name for a slice key (may contain `|` / `:`). */
export function catalogSliceDirName(sliceKey: string): string {
  // FNV-1a 32-bit → hex (no node:crypto dependency in domain tests).
  let hash = 0x811c9dc5;
  for (let i = 0; i < sliceKey.length; i += 1) {
    hash ^= sliceKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const a = (hash >>> 0).toString(16).padStart(8, '0');
  // Second pass with seed offset for more bits.
  let hash2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < sliceKey.length; i += 1) {
    hash2 ^= sliceKey.charCodeAt(i);
    hash2 = Math.imul(hash2, 0x01000193);
  }
  const b = (hash2 >>> 0).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

export function idChunkFileName(chunkIndex: number): string {
  return `ids-${String(Math.max(0, Math.floor(chunkIndex))).padStart(4, '0')}.json`;
}

/**
 * Prepend `fresh` (newest-first) onto chunked id lists. Returns new chunks.
 * Cascades overflow into following chunks.
 */
export function prependIdsIntoChunks(
  chunks: number[][],
  fresh: number[],
  pageSize = CATALOG_PAGE_SIZE,
): number[][] {
  if (fresh.length === 0) return chunks.map((c) => [...c]);
  const size = Math.max(1, pageSize);
  const result: number[][] = [];
  let carry = [...fresh];
  let i = 0;
  while (carry.length > 0 || i < chunks.length) {
    const old = i < chunks.length ? chunks[i]! : [];
    const merged = carry.length ? [...carry, ...old] : [...old];
    if (merged.length === 0) break;
    result.push(merged.slice(0, size));
    carry = merged.slice(size);
    i += 1;
  }
  return result;
}

/** Append ids onto the last chunk, spilling new chunks as needed. */
export function appendIdsIntoChunks(
  chunks: number[][],
  more: number[],
  pageSize = CATALOG_PAGE_SIZE,
): number[][] {
  if (more.length === 0) return chunks.map((c) => [...c]);
  const size = Math.max(1, pageSize);
  const result = chunks.map((c) => [...c]);
  let pending = [...more];
  if (result.length === 0) {
    return chunkModelIds(pending, size);
  }
  const last = result[result.length - 1]!;
  const room = size - last.length;
  if (room > 0) {
    last.push(...pending.slice(0, room));
    pending = pending.slice(room);
  }
  while (pending.length > 0) {
    result.push(pending.slice(0, size));
    pending = pending.slice(size);
  }
  return result;
}
