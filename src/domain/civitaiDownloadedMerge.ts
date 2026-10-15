/** Cards that belong on the Civitai Downloaded tab. */
export type DownloadedMergeCard = {
  id: number;
  installed?: boolean;
  markedInstalled?: boolean;
};

/**
 * Fold a catalog install scan into the list already on screen.
 * Never drops an existing card just because this scan missed it (index
 * mid-walk / hashes not attached yet). Only adds or updates installed rows.
 */
export function mergeDownloadedCatalogCards<T extends DownloadedMergeCard>(
  prev: T[],
  scanned: T[],
): T[] {
  const byId = new Map<number, T>();
  for (const card of prev) {
    byId.set(card.id, card);
  }
  for (const card of scanned) {
    if (!card.installed && !card.markedInstalled) continue;
    const existing = byId.get(card.id);
    byId.set(card.id, existing ? { ...existing, ...card } : card);
  }
  return [...byId.values()];
}
