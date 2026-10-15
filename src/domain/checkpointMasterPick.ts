/**
 * Pick master = largest jpg; gens = next up to 12 by size desc.
 */
export function pickMasterAndGens(
  hits: Array<{ absolutePath: string; size: number }>,
): { masterAbsolutePath: string; genAbsolutePaths: string[] } | null {
  if (hits.length === 0) return null;
  const sorted = [...hits].sort(
    (a, b) => b.size - a.size || a.absolutePath.localeCompare(b.absolutePath),
  );
  const master = sorted[0]!;
  const gens = sorted.slice(1, 13).map((h) => h.absolutePath);
  return { masterAbsolutePath: master.absolutePath, genAbsolutePaths: gens };
}
