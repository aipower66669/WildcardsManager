import type { Issue, LibraryFile, ResolveResult } from './types.js';
import { cachedStructuredDocument } from './fileArtifactCache.js';
import {
  isStructuredFile,
  type StructuredDocument,
  type StructuredEntry,
} from './structured.js';

export function normalizeKey(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.txt$/i, '').replace(/\.ya?ml$/i, '').replace(/\.json$/i, '');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert a Dynamic Prompts glob pattern to a RegExp over normalized keys.
 * `*` → one path segment-ish; `**` → any depth.
 */
export function globToRegExp(pattern: string): RegExp {
  const norm = normalizeKey(pattern);
  let re = '^';
  for (let i = 0; i < norm.length; i++) {
    if (norm[i] === '*' && norm[i + 1] === '*') {
      re += '.*';
      i += 1;
      if (norm[i + 1] === '/') i += 1; // consume trailing slash after **
      continue;
    }
    if (norm[i] === '*') {
      re += '[^/]*';
      continue;
    }
    re += escapeRegExp(norm[i]!);
  }
  re += '$';
  return new RegExp(re, 'i');
}

export type LibraryIndex = {
  /** key (no ext, forward slashes) → file */
  byKey: Map<string, LibraryFile>;
  /** lowercase key → file */
  byKeyLower: Map<string, LibraryFile>;
  /** Canonical host/path key → parsed structured entry. */
  structuredByKey: Map<string, StructuredEntry>;
  /** Lowercase canonical host/path key → parsed structured entry. */
  structuredByKeyLower: Map<string, StructuredEntry>;
  structuredDocuments: Map<string, StructuredDocument>;
  files: LibraryFile[];
};

function cloneStructuredDocument(
  document: StructuredDocument,
): StructuredDocument {
  return {
    ...document,
    issues: document.issues.slice(),
    entries: document.entries.map((entry) => ({
      ...entry,
      issues: entry.issues.slice(),
    })),
  };
}

export function buildLibraryIndex(files: LibraryFile[]): LibraryIndex {
  const byKey = new Map<string, LibraryFile>();
  const byKeyLower = new Map<string, LibraryFile>();
  const structuredByKey = new Map<string, StructuredEntry>();
  const structuredByKeyLower = new Map<string, StructuredEntry>();
  const structuredDocuments = new Map<string, StructuredDocument>();
  for (const f of files) {
    byKey.set(f.key, f);
    byKeyLower.set(f.key.toLowerCase(), f);
    if (isStructuredFile(f)) {
      const cached = cachedStructuredDocument(f);
      if (!cached) continue;
      const parsed = cloneStructuredDocument(cached);
      structuredDocuments.set(f.key, parsed);
      for (const entry of parsed.entries) {
        const existing = structuredByKeyLower.get(entry.key.toLowerCase());
        if (existing) {
          const issue: Issue = {
            severity: 'error',
            code: 'duplicate_structured_key',
            message: `Structured wildcard key \`${entry.key}\` is also defined by \`${existing.hostKey}\``,
            nodeId: entry.key,
            line: entry.line,
            column: entry.column,
          };
          parsed.issues.push(issue);
          const existingDocument = structuredDocuments.get(existing.hostKey);
          existingDocument?.issues.push({
            ...issue,
            message: `Structured wildcard key \`${existing.key}\` is also defined by \`${entry.hostKey}\``,
            line: existing.line,
            column: existing.column,
          });
          continue;
        }
        structuredByKey.set(entry.key, entry);
        structuredByKeyLower.set(entry.key.toLowerCase(), entry);
      }
    }
  }
  for (const entry of structuredByKey.values()) {
    const textFile =
      byKey.get(entry.key) ?? byKeyLower.get(entry.key.toLowerCase());
    if (textFile?.ext !== '.txt') continue;
    structuredDocuments.get(entry.hostKey)?.issues.push({
      severity: 'error',
      code: 'duplicate_structured_key',
      message: `Structured wildcard key \`${entry.key}\` conflicts with text file \`${textFile.relativePath}\``,
      nodeId: entry.key,
      line: entry.line,
      column: entry.column,
    });
  }
  return {
    byKey,
    byKeyLower,
    structuredByKey,
    structuredByKeyLower,
    structuredDocuments,
    files,
  };
}

/**
 * Resolve `__name__` against the library root index.
 * Supports nested paths, case-insensitive exact match, and globbing.
 */
export function resolveWildcard(
  rawName: string,
  index: LibraryIndex,
): ResolveResult {
  const name = normalizeKey(rawName);
  const issues: Issue[] = [];

  const isGlob = name.includes('*');
  if (isGlob) {
    const re = globToRegExp(name);
    const matched = [
      ...index.files
        .filter((f) => f.ext === '.txt' && re.test(f.key))
        .map((f) => f.key),
      ...[...index.structuredByKey.values()]
        .filter((entry) => entry.values.length > 0 && re.test(entry.key))
        .map((entry) => entry.key),
    ];
    if (matched.length === 0) {
      issues.push({
        severity: 'error',
        code: 'glob_no_match',
        message: `Glob \`__${rawName}__\` matched no files`,
      });
      return {
        kind: 'missing',
        id: `missing:glob:${name}`,
        label: `__${rawName}__`,
        issues,
      };
    }
    return {
      kind: 'glob',
      id: `glob:${name}`,
      label: `__${rawName}__`,
      matchedKeys: matched.sort(),
      issues,
    };
  }

  const structured =
    index.structuredByKey.get(name) ??
    index.structuredByKeyLower.get(name.toLowerCase());
  if (structured) {
    const file =
      index.byKey.get(structured.hostKey) ??
      index.byKeyLower.get(structured.hostKey.toLowerCase());
    const structuredIssues =
      index.structuredDocuments
        .get(structured.hostKey)
        ?.issues.filter(
          (issue) =>
            issue.nodeId === structured.key &&
            issue.code === 'duplicate_structured_key',
        ) ?? [];
    return {
      kind: 'yamlKey',
      id: structured.key,
      label: structured.key,
      absolutePath: file?.absolutePath,
      relativeKey: structured.key,
      hostKey: structured.hostKey,
      issues: structuredIssues,
    };
  }

  const exact = index.byKey.get(name) ?? index.byKeyLower.get(name.toLowerCase());
  if (exact?.ext === '.txt') {
    return {
      kind: 'file',
      id: exact.key,
      label: exact.key,
      absolutePath: exact.absolutePath,
      relativeKey: exact.key,
      hostKey: exact.key,
      issues,
    };
  }

  issues.push({
    severity: 'error',
    code: 'missing_file',
    message: `Missing wildcard file for \`__${rawName}__\``,
  });

  return {
    kind: 'missing',
    id: `missing:${name}`,
    label: `__${rawName}__`,
    relativeKey: name,
    issues,
  };
}
