/** On-disk / in-memory link from a LoRA training series to its dataset folder. */

export type CachedSeriesValidationSet = {
  folderName: string;
  folderMtimeMs?: number;
  /** Image paths relative to the set folder. */
  images: string[];
};

export type SeriesDatasetCacheEntry = {
  datasetRelativePath?: string;
  /** Search already ran and found nothing — do not walk the training tree again. */
  notFound?: boolean;
  previewRelativePath?: string | null;
  previewMtimeMs?: number;
  validationSets?: CachedSeriesValidationSet[];
};

export type CachedSeriesDatasetLink =
  | { kind: 'hit'; relativePath: string }
  | { kind: 'not_found' }
  | { kind: 'miss' };

export function cachedSeriesDatasetLink(
  entry: SeriesDatasetCacheEntry | null | undefined,
): CachedSeriesDatasetLink {
  if (!entry) return { kind: 'miss' };
  if (entry.notFound) return { kind: 'not_found' };
  const rel = entry.datasetRelativePath?.trim().replaceAll('\\', '/');
  if (rel) return { kind: 'hit', relativePath: rel };
  return { kind: 'miss' };
}

export function seriesDatasetNotFoundEntry(): SeriesDatasetCacheEntry {
  return { notFound: true, datasetRelativePath: '' };
}

export function seriesDatasetHitEntry(
  datasetRelativePath: string,
  extras?: Omit<SeriesDatasetCacheEntry, 'datasetRelativePath' | 'notFound'>,
): SeriesDatasetCacheEntry {
  return {
    datasetRelativePath: datasetRelativePath.replaceAll('\\', '/'),
    notFound: false,
    ...extras,
  };
}
