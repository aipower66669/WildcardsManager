import { countLoraTags } from './lora.js';
import { cachedParseFile } from './fileArtifactCache.js';
import {
  hasNoValidationMarker,
  HONOR_NO_VALIDATION_MARKER,
} from './parseRefs.js';
import { wildcardNamesForPlatform } from './dynamicWildcardName.js';
import type { ValidationPlatform } from './platformValidation.js';
import {
  buildLibraryIndex,
  resolveWildcard,
  type LibraryIndex,
} from './resolveWildcard.js';
import type { LibraryFile } from './types.js';

export type FileRefStat = {
  key: string;
  /** Distinct other files that reference this file. */
  inbound: number;
  /** Distinct existing files this file references. */
  outbound: number;
  /** Syntax/empty/unresolved-reference issues owned by this file. */
  issueCount: number;
  /** Complete `<lora:…>` tags found in this file. */
  loraTagCount: number;
};

export type DirectCaller = {
  key: string;
  relativePath: string;
  absolutePath: string;
  line: number;
  column: number;
  snippet: string;
};

/**
 * Resolve a raw wildcard name to the concrete library file key(s) it points at.
 * Globs fan out to every match; YAML/JSON nested keys map to their host file.
 * Missing references return an empty list.
 */
export function refToFileKeys(
  name: string,
  index: LibraryIndex,
  platform: ValidationPlatform = 'comfyui',
): string[] {
  const { names, dynamic } = wildcardNamesForPlatform(name, platform);
  if (dynamic && platform === 'comfyui') return [];

  const keys: string[] = [];
  for (const resolvedName of names) {
    const resolved = resolveWildcard(resolvedName, index);
    if (resolved.kind === 'glob') {
      keys.push(...(resolved.matchedKeys ?? []));
      continue;
    }
    if (resolved.kind === 'missing') continue;
    if (resolved.hostKey) {
      keys.push(resolved.hostKey);
      continue;
    }

    const relativeKey = resolved.relativeKey ?? resolved.id;
    if (index.byKey.has(relativeKey)) {
      keys.push(relativeKey);
      continue;
    }

    // YAML/JSON nested key such as `styles/painting` → host file `styles`.
    const parts = relativeKey.split('/');
    for (let take = parts.length; take >= 1; take--) {
      const fileKey = parts.slice(0, take).join('/');
      const file =
        index.byKey.get(fileKey) ?? index.byKeyLower.get(fileKey.toLowerCase());
      if (file) {
        keys.push(file.key);
        break;
      }
    }
  }
  return [...new Set(keys)];
}

/**
 * Compute per-file parent/child reference counts across the whole library.
 * Self-references are ignored so "root" and "leaf" classification stays useful.
 */
export function computeReferenceStats(
  files: LibraryFile[],
  platform: ValidationPlatform = 'comfyui',
): FileRefStat[] {
  const index = buildLibraryIndex(files);
  const inbound = new Map<string, Set<string>>();
  const outbound = new Map<string, Set<string>>();
  const issueCounts = new Map<string, number>();
  for (const f of files) {
    inbound.set(f.key, new Set());
    outbound.set(f.key, new Set());
    issueCounts.set(f.key, 0);
  }

  for (const f of files) {
    const structured = index.structuredDocuments.get(f.key);
    const parsed = structured
      ? {
          refs: structured.entries.flatMap((entry) => entry.refs),
          issues: structured.issues,
        }
      : cachedParseFile(f);
    let issueCount = parsed.issues.length;
    for (const ref of parsed.refs) {
      const { names, dynamic } = wildcardNamesForPlatform(ref.name, platform);
      if (dynamic && platform === 'comfyui') continue;
      for (const resolvedName of names) {
        const resolved = resolveWildcard(resolvedName, index);
        if (
          !(HONOR_NO_VALIDATION_MARKER && hasNoValidationMarker(f.text)) &&
          resolved.kind === 'missing'
        ) {
          issueCount += resolved.issues.length;
        }
      }
      for (const key of refToFileKeys(ref.name, index, platform)) {
        if (key === f.key) continue;
        outbound.get(f.key)?.add(key);
        inbound.get(key)?.add(f.key);
      }
    }
    issueCounts.set(f.key, issueCount);
  }

  return files
    .map((f) => ({
      key: f.key,
      inbound: inbound.get(f.key)?.size ?? 0,
      outbound: outbound.get(f.key)?.size ?? 0,
      issueCount: issueCounts.get(f.key) ?? 0,
      loraTagCount: countLoraTags(f.text),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Find distinct files that directly reference `targetKey`. */
export function findDirectCallers(
  files: LibraryFile[],
  targetKey: string,
): DirectCaller[] {
  const index = buildLibraryIndex(files);
  const target = targetKey.toLowerCase();
  const callers: DirectCaller[] = [];

  for (const file of files) {
    if (file.key.toLowerCase() === target) continue;
    const structured = index.structuredDocuments.get(file.key);
    const refs = structured
      ? structured.entries.flatMap((entry) => entry.refs)
      : cachedParseFile(file).refs;
    const ref = refs.find((candidate) =>
      refToFileKeys(candidate.name, index, 'stable-diffusion').some(
        (key) => key.toLowerCase() === target,
      ),
    );
    if (!ref) continue;
    callers.push({
      key: file.key,
      relativePath: file.relativePath,
      absolutePath: file.absolutePath,
      line: ref.line,
      column: ref.column,
      snippet: ref.raw,
    });
  }

  return callers.sort((a, b) => a.key.localeCompare(b.key));
}
