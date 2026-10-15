import { refToFileKeys } from './references.js';
import {
  buildLibraryIndex,
  globToRegExp,
  normalizeKey,
  type LibraryIndex,
} from './resolveWildcard.js';
import type { LibraryFile } from './types.js';

const WILDCARD_RE = /__([^_\n](?:[^_\n]|_(?!_))*)__/g;

function toKey(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\.(txt|ya?ml|json)$/i, '');
}

export type DeleteEdit = {
  key: string;
  relativePath: string;
  newText: string;
  occurrences: number;
};

export type DeletePlan = {
  canDelete: boolean;
  reason?: string;
  sourceKey: string;
  sourceRelativePath: string;
  edits: DeleteEdit[];
  totalOccurrences: number;
  warnings: string[];
};

export type ReferenceCleanupPlan = {
  canClean: boolean;
  reason?: string;
  referenceName: string;
  edits: DeleteEdit[];
  totalOccurrences: number;
};

/**
 * Remove every non-glob `__…__` token in `text` that resolves to `sourceKey`
 * (exact file key or nested YAML/JSON host). Globs are left untouched.
 */
export function removeReferences(
  text: string,
  sourceKey: string,
  index: LibraryIndex,
): { text: string; count: number } {
  let count = 0;
  const target = sourceKey.toLowerCase();
  const out = text.replace(WILDCARD_RE, (whole: string, inner: string) => {
    const trimmed = inner.trim();
    if (!trimmed || trimmed.includes('*')) return whole;
    const keys = refToFileKeys(trimmed, index);
    if (keys.some((key) => key.toLowerCase() === target)) {
      count += 1;
      return '';
    }
    return whole;
  });
  return { text: out, count };
}

/** Remove every wildcard token whose normalized name matches `referenceName`. */
export function removeReferencesByName(
  text: string,
  referenceName: string,
): { text: string; count: number } {
  let count = 0;
  const target = normalizeKey(referenceName.trim()).toLowerCase();
  const out = text.replace(WILDCARD_RE, (whole: string, inner: string) => {
    if (normalizeKey(inner.trim()).toLowerCase() !== target) return whole;
    count += 1;
    return '';
  });
  return { text: out, count };
}

/**
 * Plan removing an unresolved wildcard reference from every file in the
 * library. Unlike file deletion, this matches by name because no target file
 * exists to resolve against.
 */
export function planReferenceCleanup(
  files: LibraryFile[],
  referenceName: string,
): ReferenceCleanupPlan {
  const normalizedName = normalizeKey(referenceName.trim());
  if (!normalizedName) {
    return {
      canClean: false,
      reason: 'Reference name is empty.',
      referenceName: '',
      edits: [],
      totalOccurrences: 0,
    };
  }

  const edits: DeleteEdit[] = [];
  for (const file of files) {
    const { text, count } = removeReferencesByName(file.text, normalizedName);
    if (count > 0) {
      edits.push({
        key: file.key,
        relativePath: file.relativePath,
        newText: text,
        occurrences: count,
      });
    }
  }

  const totalOccurrences = edits.reduce(
    (sum, edit) => sum + edit.occurrences,
    0,
  );
  if (totalOccurrences === 0) {
    return {
      canClean: false,
      reason: `No references to __${normalizedName}__ were found.`,
      referenceName: normalizedName,
      edits,
      totalOccurrences,
    };
  }

  return {
    canClean: true,
    referenceName: normalizedName,
    edits,
    totalOccurrences,
  };
}

/**
 * Plan deleting a wildcard file and stripping every inbound exact/nested
 * reference across the library. Pure — no disk I/O. Glob references that
 * currently match the file are left untouched (with a warning).
 */
export function planDelete(
  files: LibraryFile[],
  sourceRelativePath: string,
): DeletePlan {
  const index = buildLibraryIndex(files);
  const lookupKey = toKey(sourceRelativePath);
  const source =
    index.byKey.get(lookupKey) ?? index.byKeyLower.get(lookupKey.toLowerCase());

  const empty: Omit<DeletePlan, 'canDelete' | 'reason'> = {
    sourceKey: lookupKey,
    sourceRelativePath,
    edits: [],
    totalOccurrences: 0,
    warnings: [],
  };

  if (!source) {
    return {
      ...empty,
      canDelete: false,
      reason: `Source file not found: ${sourceRelativePath}`,
    };
  }

  const edits: DeleteEdit[] = [];
  for (const f of files) {
    if (f.key === source.key) continue;
    const { text, count } = removeReferences(f.text, source.key, index);
    if (count > 0) {
      edits.push({
        key: f.key,
        relativePath: f.relativePath,
        newText: text,
        occurrences: count,
      });
    }
  }

  const warnings: string[] = [];
  const globUsers = new Set<string>();
  for (const f of files) {
    if (f.key === source.key) continue;
    WILDCARD_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WILDCARD_RE.exec(f.text)) !== null) {
      const inner = match[1]!.trim();
      if (inner.includes('*') && globToRegExp(inner).test(source.key)) {
        globUsers.add(f.key);
        break;
      }
    }
  }
  if (globUsers.size > 0) {
    warnings.push(
      `${globUsers.size} file(s) use a glob matching this file (left untouched): ${[
        ...globUsers,
      ]
        .sort()
        .join(', ')}`,
    );
  }

  return {
    canDelete: true,
    sourceKey: source.key,
    sourceRelativePath: source.relativePath,
    edits,
    totalOccurrences: edits.reduce((sum, e) => sum + e.occurrences, 0),
    warnings,
  };
}
