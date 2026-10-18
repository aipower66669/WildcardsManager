/**
 * Checkpoints a library keeps on disk but does not use.
 * Stored as `ignoredCheckpoints` in that library’s `library.json`.
 * A missing array means every checkpoint is in use for that library.
 */

/** Lowercase forward-slash path with no leading or trailing slash. */
export function normalizeCheckpointIgnoreKey(value: string): string {
  return value
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '')
    .trim()
    .toLowerCase();
}

function basenameKey(key: string): string {
  return key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key;
}

/**
 * True when `relativePath` is listed in `ignored`.
 * A full path matches only that file. A bare filename matches any checkpoint
 * with that name, so a hand-edited entry like `model.safetensors` works.
 */
export function isCheckpointIgnored(
  relativePath: string,
  ignored: readonly string[],
): boolean {
  const file = normalizeCheckpointIgnoreKey(relativePath);
  if (!file || ignored.length === 0) return false;
  const fileBase = basenameKey(file);
  for (const item of ignored) {
    const key = normalizeCheckpointIgnoreKey(item);
    if (!key) continue;
    if (key.includes('/')) {
      if (key === file) return true;
    } else if (key === fileBase) {
      return true;
    }
  }
  return false;
}

/** Drop blank and duplicate entries. Keeps the first spelling of each key. */
export function normalizeCheckpointIgnored(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.replaceAll('\\', '/').trim();
    const key = normalizeCheckpointIgnoreKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * `enabled` true removes every entry that refers to this file.
 * `enabled` false adds the canonical relative path.
 */
export function withCheckpointEnabled(
  ignored: readonly string[],
  relativePath: string,
  enabled: boolean,
): string[] {
  const file = normalizeCheckpointIgnoreKey(relativePath);
  if (!file) return normalizeCheckpointIgnored(ignored);
  const fileBase = basenameKey(file);
  const next = normalizeCheckpointIgnored(ignored).filter((item) => {
    const key = normalizeCheckpointIgnoreKey(item);
    if (key.includes('/')) return key !== file;
    return key !== fileBase;
  });
  if (!enabled) next.push(file);
  return next;
}
