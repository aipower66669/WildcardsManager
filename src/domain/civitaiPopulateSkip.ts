/**
 * A local AutoV2 is done when it already maps to a catalog model or a
 * persistent Civitai miss. Populate must not reload those cards.
 */
export function hashNeedsCatalogMatch(
  autoV2: string | undefined,
  catalogIndex: ReadonlyMap<string, unknown>,
  isKnownMiss: (hash: string) => boolean,
): boolean {
  const key = String(autoV2 ?? '')
    .trim()
    .toUpperCase();
  if (!key) return false;
  if (catalogIndex.has(key)) return false;
  if (isKnownMiss(key)) return false;
  return true;
}

export function listHashesNeedingCatalogMatch(
  hashes: Iterable<string | undefined>,
  catalogIndex: ReadonlyMap<string, unknown>,
  isKnownMiss: (hash: string) => boolean,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of hashes) {
    const key = String(raw ?? '')
      .trim()
      .toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (hashNeedsCatalogMatch(key, catalogIndex, isKnownMiss)) out.push(key);
  }
  return out;
}
