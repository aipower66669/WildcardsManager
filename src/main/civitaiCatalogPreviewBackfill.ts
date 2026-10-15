/**
 * @deprecated Use seedCatalogPreviewQueue / reseedCatalogPreviewQueue from
 * civitaiPreviewQueue — kept as thin wrappers for existing imports.
 */
export {
  seedCatalogPreviewQueue as startCatalogPreviewBackfill,
  reseedCatalogPreviewQueue as requestCatalogPreviewBackfill,
} from './civitaiPreviewQueue.js';

export function cancelCatalogPreviewBackfill(): void {
  // No-op: unified queue has no separate cancel handle.
}
