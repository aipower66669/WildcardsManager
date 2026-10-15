import { rewriteReferences } from './consolidate.js';
import {
  buildLibraryIndex,
  globToRegExp,
  normalizeKey,
} from './resolveWildcard.js';
import type { LibraryFile } from './types.js';

const WILDCARD_RE = /__([^_\n](?:[^_\n]|_(?!_))*)__/g;

function toKey(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\.(txt|ya?ml|json)$/i, '');
}

export type RenameEdit = {
  key: string;
  relativePath: string;
  newText: string;
  occurrences: number;
};

export type RenamePlan = {
  canRename: boolean;
  reason?: string;
  sourceKey: string;
  sourceRelativePath: string;
  sourceText: string;
  newKey: string;
  newRelativePath: string;
  edits: RenameEdit[];
  totalOccurrences: number;
  warnings: string[];
};

/**
 * Plan renaming (or moving) a wildcard file to a new key/path, updating every
 * `__oldKey__` reference across the library to `__newKey__`. Pure — no disk I/O.
 * Moving is just a rename to a key with a different folder prefix.
 */
export function planRename(
  files: LibraryFile[],
  sourceRelativePath: string,
  rawNewKey: string,
): RenamePlan {
  const index = buildLibraryIndex(files);
  const lookupKey = toKey(sourceRelativePath);
  const source =
    index.byKey.get(lookupKey) ?? index.byKeyLower.get(lookupKey.toLowerCase());
  const newKey = normalizeKey((rawNewKey ?? '').trim());

  const empty: Omit<RenamePlan, 'canRename' | 'reason'> = {
    sourceKey: lookupKey,
    sourceRelativePath,
    sourceText: '',
    newKey,
    newRelativePath: '',
    edits: [],
    totalOccurrences: 0,
    warnings: [],
  };

  if (!source) {
    return { ...empty, canRename: false, reason: `Source file not found: ${sourceRelativePath}` };
  }
  const base = {
    ...empty,
    sourceKey: source.key,
    sourceRelativePath: source.relativePath,
    sourceText: source.text,
  };
  if (!newKey) {
    return { ...base, canRename: false, reason: 'New name is empty.' };
  }
  if (!/^[A-Za-z0-9 _./-]+$/.test(newKey)) {
    return {
      ...base,
      canRename: false,
      reason: 'New name may only contain letters, numbers, spaces, and _ . / -',
    };
  }
  if (newKey.toLowerCase() === source.key.toLowerCase()) {
    return { ...base, canRename: false, reason: 'New name matches the current name.' };
  }

  const newRelativePath = `${newKey}${source.ext}`;
  const collision =
    index.byKey.get(newKey) ?? index.byKeyLower.get(newKey.toLowerCase());
  if (collision) {
    return {
      ...base,
      newRelativePath,
      canRename: false,
      reason: `A file already exists at ${newKey}.`,
    };
  }

  const isStructured =
    source.ext === '.yaml' || source.ext === '.yml' || source.ext === '.json';
  const rewrite = (text: string) =>
    isStructured
      ? { text, count: 0 }
      : rewriteReferences(text, source.key, newKey);
  const sourceRewrite = rewrite(source.text);
  const edits: RenameEdit[] = [];
  for (const f of files) {
    if (f.key === source.key) continue;
    const { text, count } = rewrite(f.text);
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
  if (isStructured) {
    warnings.push(
      'Structured wildcard keys come from document mappings, so renaming the host file does not rename or rewrite nested keys.',
    );
  }
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
      `${globUsers.size} file(s) use a glob matching the old name (left untouched): ${[
        ...globUsers,
      ]
        .sort()
        .join(', ')}`,
    );
  }

  return {
    ...base,
    sourceText: sourceRewrite.text,
    newRelativePath,
    canRename: true,
    edits,
    totalOccurrences:
      sourceRewrite.count +
      edits.reduce((sum, e) => sum + e.occurrences, 0),
    warnings,
  };
}
