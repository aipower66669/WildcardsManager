import {
  buildLibraryIndex,
  normalizeKey,
} from './resolveWildcard.js';
import type { LibraryFile } from './types.js';

function toKey(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\.(txt|ya?ml|json)$/i, '');
}

export type ConvertToChildPlan = {
  canConvert: boolean;
  reason?: string;
  sourceKey: string;
  sourceRelativePath: string;
  sourceText: string;
  childKey: string;
  childRelativePath: string;
  /** Text left in the parent after conversion. */
  parentText: string;
  warnings: string[];
};

/** Default suffix appended when suggesting a convert-to-child key. */
export const DEFAULT_CONVERT_CHILD_SUFFIX = '-child';

/**
 * Normalize a user-configured suffix. Empty/whitespace falls back to the default.
 * The value is appended to the source key as-is (e.g. `-child` → `colors-child`).
 */
export function normalizeConvertChildSuffix(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  return trimmed || DEFAULT_CONVERT_CHILD_SUFFIX;
}

/** Default child key suggestion for a source file key (sibling, not a subfolder). */
export function defaultConvertChildKey(
  sourceKey: string,
  suffix: string = DEFAULT_CONVERT_CHILD_SUFFIX,
): string {
  return `${sourceKey}${normalizeConvertChildSuffix(suffix)}`;
}

/**
 * Plan converting a file into a one-level forwarder:
 * move its contents into a new child file, leave `__childKey__` in the parent.
 * Pure — no disk I/O. Callers of the parent are left unchanged.
 */
export function planConvertToChild(
  files: LibraryFile[],
  sourceRelativePath: string,
  rawChildKey: string,
): ConvertToChildPlan {
  const index = buildLibraryIndex(files);
  const lookupKey = toKey(sourceRelativePath);
  const source =
    index.byKey.get(lookupKey) ?? index.byKeyLower.get(lookupKey.toLowerCase());
  const childKey = normalizeKey((rawChildKey ?? '').trim());

  const empty: Omit<ConvertToChildPlan, 'canConvert' | 'reason'> = {
    sourceKey: lookupKey,
    sourceRelativePath,
    sourceText: '',
    childKey,
    childRelativePath: '',
    parentText: '',
    warnings: [],
  };

  if (!source) {
    return {
      ...empty,
      canConvert: false,
      reason: `Source file not found: ${sourceRelativePath}`,
    };
  }

  const base = {
    ...empty,
    sourceKey: source.key,
    sourceRelativePath: source.relativePath,
    sourceText: source.text,
  };

  if (
    source.ext === '.yaml' ||
    source.ext === '.yml' ||
    source.ext === '.json'
  ) {
    return {
      ...base,
      canConvert: false,
      reason:
        'Structured YAML/JSON files cannot be converted to a text forwarder without destroying nested keys.',
    };
  }

  if (!childKey) {
    return { ...base, canConvert: false, reason: 'Child name is empty.' };
  }
  if (!/^[A-Za-z0-9 _./-]+$/.test(childKey)) {
    return {
      ...base,
      canConvert: false,
      reason: 'Child name may only contain letters, numbers, spaces, and _ . / -',
    };
  }
  if (childKey.toLowerCase() === source.key.toLowerCase()) {
    return {
      ...base,
      canConvert: false,
      reason: 'Child name must differ from the current file.',
    };
  }

  const childRelativePath = `${childKey}${source.ext}`;
  const collision =
    index.byKey.get(childKey) ?? index.byKeyLower.get(childKey.toLowerCase());
  if (collision) {
    return {
      ...base,
      childRelativePath,
      canConvert: false,
      reason: `A file already exists at ${childKey}.`,
    };
  }

  const warnings: string[] = [];
  const active = source.text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (active.length === 1 && /^__[^_\n](?:[^_\n]|_(?!_))*__$/.test(active[0]!)) {
    warnings.push(
      'This file is already a simple forwarder — converting adds another nesting level.',
    );
  }
  if (!active.length) {
    warnings.push('Source file has no active lines; the new child will be empty.');
  }

  return {
    ...base,
    childKey,
    childRelativePath,
    parentText: `__${childKey}__\n`,
    warnings,
    canConvert: true,
  };
}
