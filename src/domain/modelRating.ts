/** Sentinel: never rated. Rated values are 0.5 … 5 in half-star steps. */
export const UNRATED = -1;

/** Clamp to −1 or 0.5…5 in half-star steps. */
export function normalizeModelRating(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return UNRATED;
  if (raw < 0) return UNRATED;
  const stepped = Math.round(raw * 2) / 2;
  if (stepped < 0.5) return UNRATED;
  if (stepped > 5) return 5;
  return stepped;
}

export function isUnrated(rating: number | undefined | null): boolean {
  return rating == null || rating < 0;
}
