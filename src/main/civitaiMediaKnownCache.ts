/**
 * Generation counters so Browse catch-up can reuse archived/downloaded Sets
 * instead of rebuilding 10k+ id Sets on every page (main-thread hitch).
 */

let imageGen = 0;
let videoGen = 0;

export function invalidateCivitaiMediaKnown(
  media?: 'image' | 'video',
): void {
  if (!media || media === 'image') imageGen += 1;
  if (!media || media === 'video') videoGen += 1;
}

export function civitaiMediaKnownGeneration(
  media: 'image' | 'video',
): number {
  return media === 'video' ? videoGen : imageGen;
}
