import { isSkippedPromptFolderName } from './promptFolderSkip.js';

const INVALID_SEGMENT = /[<>:"/\\|?*\u0000]/;

/**
 * Validate a single prompt-folder name segment (not a path).
 * Rejects empty names, traversal, reserved app folders, and Windows-illegal chars.
 */
export function sanitizePromptFolderName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new Error('Folder name is required');
  if (name === '.' || name === '..') {
    throw new Error('Invalid folder name');
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new Error('Folder name cannot contain path separators');
  }
  if (INVALID_SEGMENT.test(name)) {
    throw new Error('Folder name contains invalid characters');
  }
  if (isSkippedPromptFolderName(name)) {
    throw new Error(`“${name}” is reserved and cannot be used`);
  }
  if (/^[.]/.test(name)) {
    throw new Error('Folder name cannot start with a dot');
  }
  return name;
}

/** Explorer-style default name that does not collide with `existing` (case-insensitive). */
export function uniqueNewPromptFolderName(existing: Iterable<string>): string {
  const taken = new Set(
    [...existing].map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
  const base = 'New folder';
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error('Could not find a free folder name');
}

/** Map a selection path after its ancestor folder was renamed. */
export function remapPromptFolderPath(
  selected: string | null,
  fromRelative: string,
  toRelative: string,
): string | null {
  if (!selected) return null;
  if (selected === fromRelative) return toRelative;
  const prefix = `${fromRelative}/`;
  if (selected.startsWith(prefix)) {
    return `${toRelative}/${selected.slice(prefix.length)}`;
  }
  return selected;
}
