/** Parse `1.2.3`, `v1.2`, or `v1.2.3` → tuple. A missing patch is 0. */
export function parseSemver(value: string): [number, number, number] | null {
  const m = value
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0];
}

/** Positive when `a` is newer than `b`. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! - pb[i]!;
  }
  return 0;
}
