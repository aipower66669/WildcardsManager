import { collapseStackedUnderscores } from './lora.js';

/**
 * Sanitize / validate a user-chosen save name for a Civitai model download.
 * Keeps basename only, strips Windows-illegal characters, collapses stacked
 * underscores (`__` → `_`, Dynamic Prompts-safe), and ensures a model
 * extension (from `fallback` when missing).
 *
 * Downloads never auto-rename on collision — callers must reject existing
 * destinations and require a manual name change.
 */

/**
 * Stem prefixes that must never be used (case-insensitive):
 * Civitai’s generic “V1” grief, and trainer leftovers like `optimizer.bin`.
 */
export const FORBIDDEN_DOWNLOAD_STEM_PREFIXES = ['V1', 'optimizer'] as const;

export function downloadFileStem(fileName: string): string {
  return fileName
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(safetensors|ckpt|pt)$/i, '');
}

function matchingForbiddenStemPrefix(fileName: string): string | null {
  const stem = downloadFileStem(fileName);
  if (!stem) return null;
  const lower = stem.toLowerCase();
  for (const prefix of FORBIDDEN_DOWNLOAD_STEM_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) return prefix;
  }
  return null;
}

/**
 * True when the basename stem starts with a forbidden prefix, e.g.
 * `V1`, `v1_foo`, `optimizer.bin`, `Optimizer.safetensors`.
 */
export function isForbiddenDownloadFileName(fileName: string): boolean {
  return matchingForbiddenStemPrefix(fileName) != null;
}

export function forbiddenDownloadFileNameReason(
  fileName: string,
): string | null {
  const prefix = matchingForbiddenStemPrefix(fileName);
  if (!prefix) return null;
  return (
    `File names starting with “${prefix}” are not allowed — choose a ` +
    'descriptive name for your catalog.'
  );
}

export function sanitizeDownloadFileName(
  raw: string,
  fallback: string,
): string | null {
  const fallbackBase = (fallback.trim().split(/[/\\]/).pop() || '').trim();
  const fallbackName = fallbackBase || 'model.safetensors';
  const fallbackExtMatch = fallbackName.match(/\.(safetensors|ckpt|pt)$/i);
  const fallbackExt = fallbackExtMatch?.[0] ?? '.safetensors';

  let name = raw.trim().replace(/\\/g, '/');
  const slash = name.lastIndexOf('/');
  if (slash >= 0) name = name.slice(slash + 1);
  name = name.replace(/[<>:"|?*\u0000-\u001f]/g, '').replace(/\.+$/g, '').trim();
  if (!name || name === '.' || name === '..') return null;

  if (!/\.(safetensors|ckpt|pt)$/i.test(name)) {
    name = `${name}${fallbackExt}`;
  }
  const extMatch = name.match(/\.(safetensors|ckpt|pt)$/i);
  const ext = extMatch?.[0] ?? '';
  const stem = ext ? name.slice(0, -ext.length) : name;
  name = `${collapseStackedUnderscores(stem)}${ext}`;
  if (!name || name === ext) return null;
  return name;
}

export type DownloadSaveFileNameResult =
  | { ok: true; fileName: string }
  | { ok: false; error: string };

/**
 * Sanitize + reject forbidden stems (V1…, optimizer…). Does not check disk collision.
 */
export function resolveDownloadSaveFileName(
  raw: string,
  fallback: string,
): DownloadSaveFileNameResult {
  const fileName = sanitizeDownloadFileName(raw, fallback);
  if (!fileName) {
    return {
      ok: false,
      error: 'Enter a valid file name (extension optional).',
    };
  }
  const banned = forbiddenDownloadFileNameReason(fileName);
  if (banned) return { ok: false, error: banned };
  return { ok: true, fileName };
}

/** Sanitized name to show in the download dialog (underscores already collapsed). */
export function proposeDownloadSaveFileName(
  raw: string,
  fallback: string,
): string {
  return sanitizeDownloadFileName(raw, fallback) ?? raw.trim();
}
