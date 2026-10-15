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

function withTxtExtension(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.?\//, '');
  return /\.(txt|ya?ml|json)$/i.test(normalized)
    ? normalized
    : `${normalized}.txt`;
}

/** Append `__childKey__` as a new line on the parent, preserving existing content. */
export function appendWildcardReference(
  parentText: string,
  childKey: string,
): string {
  const ref = `__${childKey}__`;
  const normalized = parentText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized) return `${ref}\n`;
  if (normalized.endsWith('\n')) return `${normalized}${ref}\n`;
  return `${normalized}\n${ref}\n`;
}

export type CreateDescendantPlan = {
  canCreate: boolean;
  reason?: string;
  parentKey: string;
  parentRelativePath: string;
  childKey: string;
  childRelativePath: string;
  childText: string;
  parentText: string;
  warnings: string[];
};

/**
 * Plan creating an empty child file and inserting `__childKey__` into the parent.
 * Unlike convert-to-child, the parent's existing contents are kept.
 */
export function planCreateDescendant(
  files: LibraryFile[],
  parentRelativePath: string,
  rawChildPath: string,
): CreateDescendantPlan {
  const index = buildLibraryIndex(files);
  const lookupKey = toKey(parentRelativePath);
  const parent =
    index.byKey.get(lookupKey) ?? index.byKeyLower.get(lookupKey.toLowerCase());

  const childRelativePath = withTxtExtension((rawChildPath ?? '').trim());
  const childKey = normalizeKey(toKey(childRelativePath));

  const empty: Omit<CreateDescendantPlan, 'canCreate' | 'reason'> = {
    parentKey: lookupKey,
    parentRelativePath,
    childKey,
    childRelativePath,
    childText: '',
    parentText: '',
    warnings: [],
  };

  if (!parent) {
    return {
      ...empty,
      canCreate: false,
      reason: `Parent file not found: ${parentRelativePath}`,
    };
  }

  const base = {
    ...empty,
    parentKey: parent.key,
    parentRelativePath: parent.relativePath,
  };

  if (
    parent.ext === '.yaml' ||
    parent.ext === '.yml' ||
    parent.ext === '.json'
  ) {
    return {
      ...base,
      canCreate: false,
      reason:
        'Structured YAML/JSON files cannot receive a plain wildcard reference line.',
    };
  }

  if (!childKey) {
    return { ...base, canCreate: false, reason: 'Descendant name is empty.' };
  }
  if (!/^[A-Za-z0-9 _./-]+$/.test(childKey)) {
    return {
      ...base,
      canCreate: false,
      reason:
        'Descendant name may only contain letters, numbers, spaces, and _ . / -',
    };
  }
  if (childKey.toLowerCase() === parent.key.toLowerCase()) {
    return {
      ...base,
      canCreate: false,
      reason: 'Descendant name must differ from the current file.',
    };
  }

  // Force .txt for the new child (create-new UX).
  const finalChildPath = `${childKey}.txt`;
  const collision =
    index.byKey.get(childKey) ?? index.byKeyLower.get(childKey.toLowerCase());
  if (collision) {
    return {
      ...base,
      childRelativePath: finalChildPath,
      canCreate: false,
      reason: `A file already exists at ${childKey}.`,
    };
  }

  const warnings: string[] = [];
  const ref = `__${childKey}__`;
  const alreadyHas = parent.text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .some((line) => line.trim() === ref);
  if (alreadyHas) {
    warnings.push(
      `Parent already contains ${ref}; the new file will still be created.`,
    );
  }

  return {
    ...base,
    childKey,
    childRelativePath: finalChildPath,
    childText: '',
    parentText: alreadyHas
      ? parent.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      : appendWildcardReference(parent.text, childKey),
    warnings,
    canCreate: true,
  };
}
