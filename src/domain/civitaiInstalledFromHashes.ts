/** Catalog AutoV2 → model id (same shape as the persisted v2 hash index). */
export type CatalogHashRef = {
  origin: string;
  id: number;
};

/**
 * Map local file AutoV2 hashes to catalog model ids.
 * O(local hashes) — never walk the catalog.
 */
export function collectInstalledModelIdsFromHashes(opts: {
  hashes: Iterable<string>;
  catalogIndex: ReadonlyMap<string, CatalogHashRef>;
}): number[] {
  const ids = new Set<number>();
  for (const raw of opts.hashes) {
    const key = String(raw ?? '')
      .trim()
      .toUpperCase();
    if (!key) continue;
    const ref = opts.catalogIndex.get(key);
    if (!ref || !Number.isFinite(ref.id) || ref.id <= 0) continue;
    ids.add(ref.id);
  }
  return [...ids];
}

/**
 * Union persist ∪ live. Only shrink to `live` when that scan is complete
 * (folder index hashed). An empty/partial live scan must not wipe the library.
 */
export function mergePersistedInstalledIds(
  persisted: readonly number[],
  live: readonly number[],
  canShrink: boolean,
): number[] {
  const out = new Set<number>();
  if (!canShrink || live.length === 0) {
    for (const id of persisted) {
      if (Number.isFinite(id) && id > 0) out.add(id);
    }
  }
  for (const id of live) {
    if (Number.isFinite(id) && id > 0) out.add(id);
  }
  return [...out];
}
