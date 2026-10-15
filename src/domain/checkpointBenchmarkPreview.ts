/**
 * Pick which benchmark images to show as a checkpoint “visual gist”.
 */

export type BenchmarkPreviewHit = {
  absolutePath: string;
  size: number;
  mtimeMs: number;
};

/**
 * Newest image first as the hero; remaining (up to 9) as the rest of the gist.
 * Caps at 10 total — same as images-per-checkpoint for Benchmark.
 */
export function pickBenchmarkPreviewImages(
  hits: readonly BenchmarkPreviewHit[],
  maxImages = 10,
): { masterAbsolutePath: string; genAbsolutePaths: string[] } | null {
  if (hits.length === 0) return null;
  const sorted = [...hits].sort(
    (a, b) =>
      b.mtimeMs - a.mtimeMs ||
      b.size - a.size ||
      a.absolutePath.localeCompare(b.absolutePath),
  );
  const limit = Math.max(1, Math.floor(maxImages));
  const master = sorted[0]!;
  const gens = sorted.slice(1, limit).map((h) => h.absolutePath);
  return { masterAbsolutePath: master.absolutePath, genAbsolutePaths: gens };
}
