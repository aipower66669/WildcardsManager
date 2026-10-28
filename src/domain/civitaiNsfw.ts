/**
 * Civitai model `nsfwLevel` bits. PG=1, PG-13=2, R=4, X=8, XXX=16.
 * Level 60 (the only tier that still sets `nsfw: true`) also sets bit 32.
 */
const CIVITAI_MATURE_NSFW_LEVEL_MASK = 4 | 8 | 16 | 32;

/**
 * civitai.red Browse keeps mature models. PG and PG-13 stay out.
 * The `nsfw` boolean is only true for the top tier now, so R/X models with
 * `nsfw: false` must still be kept or Newest drops most of the website list.
 */
export function civitaiRedKeepsModel(
  nsfw: boolean,
  nsfwLevel?: number | null,
): boolean {
  if (typeof nsfwLevel === 'number' && Number.isFinite(nsfwLevel)) {
    return (Math.round(nsfwLevel) & CIVITAI_MATURE_NSFW_LEVEL_MASK) !== 0;
  }
  return nsfw === true;
}

/** How many Newest pages with nothing new to store before a tip-check stops. */
export const CIVITAI_NEWEST_QUIET_PAGE_STREAK = 4;

/** Safety cap so a first repair does not walk the whole catalog. */
export const CIVITAI_NEWEST_TIP_PAGE_CAP = 15;

/**
 * Stored on a catalog slice after a Newest tip walk finishes.
 * A slice that does not have this value is walked once even inside the
 * auto-sync interval, so a keep-rule change is not skipped until tomorrow.
 */
export const CIVITAI_BROWSE_TIP_RULE = 1;
