import {
  buildLibraryIndex,
  globToRegExp,
  normalizeKey,
} from './resolveWildcard.js';
import type { LibraryFile } from './types.js';

const WILDCARD_RE = /__([^_\n](?:[^_\n]|_(?!_))*)__/g;
const SINGLE_REF_RE = /^__([^_\n](?:[^_\n]|_(?!_))*)__$/;

function toKey(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\.(txt|ya?ml|json)$/i, '');
}

function activeLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

/**
 * A "forwarder" is a file whose only active content is a single `__wildcard__`
 * reference. Returns the inner target name, or null if the file is not a
 * simple forwarder. Globs are not treated as forwarders (ambiguous target).
 */
export function detectForwarderTarget(file: LibraryFile): string | null {
  const lines = activeLines(file.text);
  if (lines.length !== 1) return null;
  const match = SINGLE_REF_RE.exec(lines[0]!);
  if (!match) return null;
  const inner = match[1]!.trim();
  if (!inner || inner.includes('*')) return null;
  return inner;
}

/**
 * Replace every exact `__sourceKey__` reference in `text` with `__targetName__`.
 * Glob references are left untouched. Returns the rewritten text and a count.
 */
export function rewriteReferences(
  text: string,
  sourceKey: string,
  targetName: string,
): { text: string; count: number } {
  let count = 0;
  const source = sourceKey.toLowerCase();
  const out = text.replace(WILDCARD_RE, (whole: string, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed.includes('*')) return whole;
    if (normalizeKey(trimmed).toLowerCase() === source) {
      count += 1;
      return `__${targetName}__`;
    }
    return whole;
  });
  return { text: out, count };
}

export type ConsolidationEdit = {
  key: string;
  relativePath: string;
  newText: string;
  occurrences: number;
};

export type ConsolidationPlan = {
  canConsolidate: boolean;
  reason?: string;
  sourceKey: string;
  sourceRelativePath: string;
  targetName: string;
  targetExists: boolean;
  targetRelativePath: string | null;
  edits: ConsolidationEdit[];
  totalOccurrences: number;
  warnings: string[];
};

export type AbsorbPlan = {
  canAbsorb: boolean;
  reason?: string;
  sourceKey: string;
  sourceRelativePath: string;
  targetName: string;
  targetKey: string;
  targetRelativePath: string;
  /** Target file contents (with target→source rewrites applied) to write onto the forwarder path. */
  absorbedText: string;
  edits: ConsolidationEdit[];
  totalOccurrences: number;
  warnings: string[];
};

/**
 * Plan the consolidation of a forwarder file: redirect every reference to it
 * onto its forward target, then delete the forwarder. Pure — computes edits
 * without touching disk.
 */
export function planConsolidation(
  files: LibraryFile[],
  sourceRelativePath: string,
): ConsolidationPlan {
  const index = buildLibraryIndex(files);
  const lookupKey = toKey(sourceRelativePath);
  const source =
    index.byKey.get(lookupKey) ?? index.byKeyLower.get(lookupKey.toLowerCase());

  const empty: Omit<ConsolidationPlan, 'canConsolidate' | 'reason'> = {
    sourceKey: lookupKey,
    sourceRelativePath,
    targetName: '',
    targetExists: false,
    targetRelativePath: null,
    edits: [],
    totalOccurrences: 0,
    warnings: [],
  };

  if (!source) {
    return {
      ...empty,
      canConsolidate: false,
      reason: `Source file not found: ${sourceRelativePath}`,
    };
  }

  const targetName = detectForwarderTarget(source);
  if (!targetName) {
    return {
      ...empty,
      sourceKey: source.key,
      sourceRelativePath: source.relativePath,
      canConsolidate: false,
      reason:
        'File is not a simple forwarder. Consolidation needs exactly one active line that is a single __wildcard__ reference.',
    };
  }

  const targetKey = normalizeKey(targetName);
  if (targetKey.toLowerCase() === source.key.toLowerCase()) {
    return {
      ...empty,
      sourceKey: source.key,
      sourceRelativePath: source.relativePath,
      targetName,
      canConsolidate: false,
      reason: 'File forwards to itself; nothing to consolidate.',
    };
  }

  const targetFile =
    index.byKey.get(targetKey) ?? index.byKeyLower.get(targetKey.toLowerCase());
  const targetExists = Boolean(targetFile);
  const warnings: string[] = [];
  if (!targetExists) {
    warnings.push(
      `Target __${targetName}__ does not resolve to an existing file; references will point at a missing file.`,
    );
  }

  const edits: ConsolidationEdit[] = [];
  for (const f of files) {
    if (f.key === source.key) continue;
    const { text, count } = rewriteReferences(f.text, source.key, targetName);
    if (count > 0) {
      edits.push({
        key: f.key,
        relativePath: f.relativePath,
        newText: text,
        occurrences: count,
      });
    }
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
      `${globUsers.size} file(s) use a glob that currently matches this file (left untouched): ${[
        ...globUsers,
      ]
        .sort()
        .join(', ')}`,
    );
  }

  const totalOccurrences = edits.reduce((sum, e) => sum + e.occurrences, 0);
  if (totalOccurrences === 0) {
    warnings.push(
      'No other files reference this file; it will simply be deleted.',
    );
  }

  return {
    canConsolidate: true,
    sourceKey: source.key,
    sourceRelativePath: source.relativePath,
    targetName,
    targetExists,
    targetRelativePath: targetFile?.relativePath ?? null,
    edits,
    totalOccurrences,
    warnings,
  };
}

/**
 * Plan absorbing a forwarder's target under the forwarder's name:
 * rewrite every `__target__` → `__forwarder__`, replace the forwarder file with
 * the target's contents, then delete the target. Pure — no disk I/O.
 */
export function planAbsorbConsolidation(
  files: LibraryFile[],
  sourceRelativePath: string,
): AbsorbPlan {
  const index = buildLibraryIndex(files);
  const lookupKey = toKey(sourceRelativePath);
  const source =
    index.byKey.get(lookupKey) ?? index.byKeyLower.get(lookupKey.toLowerCase());

  const empty: Omit<AbsorbPlan, 'canAbsorb' | 'reason'> = {
    sourceKey: lookupKey,
    sourceRelativePath,
    targetName: '',
    targetKey: '',
    targetRelativePath: '',
    absorbedText: '',
    edits: [],
    totalOccurrences: 0,
    warnings: [],
  };

  if (!source) {
    return {
      ...empty,
      canAbsorb: false,
      reason: `Source file not found: ${sourceRelativePath}`,
    };
  }

  const base = {
    ...empty,
    sourceKey: source.key,
    sourceRelativePath: source.relativePath,
  };

  const targetName = detectForwarderTarget(source);
  if (!targetName) {
    return {
      ...base,
      canAbsorb: false,
      reason:
        'File is not a simple forwarder. Absorb needs exactly one active line that is a single __wildcard__ reference.',
    };
  }

  const targetKey = normalizeKey(targetName);
  if (targetKey.toLowerCase() === source.key.toLowerCase()) {
    return {
      ...base,
      targetName,
      targetKey,
      canAbsorb: false,
      reason: 'File forwards to itself; nothing to absorb.',
    };
  }

  const targetFile =
    index.byKey.get(targetKey) ?? index.byKeyLower.get(targetKey.toLowerCase());
  if (!targetFile) {
    return {
      ...base,
      targetName,
      targetKey,
      canAbsorb: false,
      reason: `Target __${targetName}__ does not resolve to an existing file.`,
    };
  }

  const warnings: string[] = [];
  const absorbed = rewriteReferences(targetFile.text, targetKey, source.key);

  const edits: ConsolidationEdit[] = [];
  for (const f of files) {
    if (f.key === source.key) continue;
    if (f.key === targetFile.key) continue;
    const { text, count } = rewriteReferences(f.text, targetKey, source.key);
    if (count > 0) {
      edits.push({
        key: f.key,
        relativePath: f.relativePath,
        newText: text,
        occurrences: count,
      });
    }
  }

  const globUsers = new Set<string>();
  for (const f of files) {
    if (f.key === source.key || f.key === targetFile.key) continue;
    WILDCARD_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WILDCARD_RE.exec(f.text)) !== null) {
      const inner = match[1]!.trim();
      if (inner.includes('*') && globToRegExp(inner).test(targetKey)) {
        globUsers.add(f.key);
        break;
      }
    }
  }
  if (globUsers.size > 0) {
    warnings.push(
      `${globUsers.size} file(s) use a glob that currently matches the target (left untouched): ${[
        ...globUsers,
      ]
        .sort()
        .join(', ')}`,
    );
  }

  const totalOccurrences =
    edits.reduce((sum, e) => sum + e.occurrences, 0) + absorbed.count;
  if (totalOccurrences === 0) {
    warnings.push(
      'No other files reference the target; it will simply be renamed onto this file.',
    );
  }

  return {
    canAbsorb: true,
    sourceKey: source.key,
    sourceRelativePath: source.relativePath,
    targetName,
    targetKey: targetFile.key,
    targetRelativePath: targetFile.relativePath,
    absorbedText: absorbed.text,
    edits,
    totalOccurrences,
    warnings,
  };
}
