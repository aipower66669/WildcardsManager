/**
 * Composite benchmark score. Higher is a better mix of speed and rating.
 *
 * Among checkpoints that have a rating and a positive average time:
 *   speed  = fastestAverage / thisAverage     (1 = fastest)
 *   rating = thisRating / highestRating       (1 = top rated; 0 when rating ≤ 0)
 *   weight = round(100 × √(speed × rating))
 *
 * 100 means this checkpoint is both the fastest and the highest rated.
 * A fast low-rated checkpoint and a slow top-rated one both land lower,
 * because either factor can pull the geometric mean down.
 */

export type BenchmarkWeightInput = {
  key: string;
  avgDurationMs: number;
  rating: number | null;
};

/** My File Explorer `field_rating` is a 10-point score. */
export const BENCHMARK_ADS_RATING_MAX = 10;
/** Checkpoint-tab ratings are half-stars from 0.5 to 5. */
export const BENCHMARK_CATALOG_RATING_MAX = 5;

export type BenchmarkRatingSource = 'ads' | 'catalog';

/**
 * Comparable 0–1 score. ADS 10 and a 5-star catalog rating are both 1.
 * Missing or non-positive ratings are unset.
 */
export function benchmarkRatingScore(
  rating: number | null,
  source: BenchmarkRatingSource | null,
): number | null {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return null;
  if (source === 'ads') return rating / BENCHMARK_ADS_RATING_MAX;
  if (source === 'catalog') return rating / BENCHMARK_CATALOG_RATING_MAX;
  return null;
}

export function benchmarkWeightByKey(
  rows: readonly BenchmarkWeightInput[],
): Map<string, number> {
  let fastest = Infinity;
  let bestRating = 0;
  const eligible: BenchmarkWeightInput[] = [];
  for (const row of rows) {
    if (row.rating == null || !Number.isFinite(row.rating)) continue;
    if (!Number.isFinite(row.avgDurationMs) || row.avgDurationMs <= 0) continue;
    eligible.push(row);
    if (row.avgDurationMs < fastest) fastest = row.avgDurationMs;
    if (row.rating > bestRating) bestRating = row.rating;
  }
  const out = new Map<string, number>();
  for (const row of eligible) {
    const speed = fastest / row.avgDurationMs;
    const quality =
      bestRating > 0 ? Math.max(0, row.rating as number) / bestRating : 0;
    const weight = Math.round(100 * Math.sqrt(speed * quality));
    out.set(row.key, Math.min(100, Math.max(0, weight)));
  }
  return out;
}
