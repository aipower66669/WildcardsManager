import { wildcardNamesForPlatform } from './dynamicWildcardName.js';
import {
  cachedParseFile,
  cachedStructuredDocument,
} from './fileArtifactCache.js';
import type { LoraIndex } from './lora.js';
import { validateLoraRefs } from './lora.js';
import {
  hasNoValidationMarker,
  HONOR_NO_VALIDATION_MARKER,
} from './parseRefs.js';
import {
  validatePlatformWildcardSyntax,
  type ValidationPlatform,
} from './platformValidation.js';
import {
  buildLibraryIndex,
  resolveWildcard,
  type LibraryIndex,
} from './resolveWildcard.js';
import { isStructuredFile } from './structured.js';
import type { Issue, LibraryFile } from './types.js';

export type FileValidationResult = {
  relativePath: string;
  key: string;
  issues: Issue[];
  errorCount: number;
  warningCount: number;
};

/**
 * Issues that belong on a file when it is selected / live-validated
 * (syntax, missing refs from this file, LoRA tags, platform). Does not include
 * library-wide unused/duplicate LoRA scans.
 */
export function collectFileNodeIssues(
  file: LibraryFile,
  libraryIndex: LibraryIndex,
  platform: ValidationPlatform,
  loraIndex: LoraIndex | null,
): Issue[] {
  if (HONOR_NO_VALIDATION_MARKER && hasNoValidationMarker(file.text)) {
    return [];
  }

  const issues: Issue[] = [];
  const nodeId = file.key;

  const resolveRefIssues = (ref: {
    name: string;
    line: number;
    column: number;
    raw: string;
  }) => {
    const { names, dynamic } = wildcardNamesForPlatform(ref.name, platform);
    if (dynamic && platform === 'comfyui') return;
    for (const resolvedName of names) {
      const resolved = resolveWildcard(resolvedName, libraryIndex);
      for (const issue of resolved.issues) {
        issues.push({
          ...issue,
          nodeId: issue.nodeId ?? resolved.id,
          line: issue.line ?? ref.line,
          column: issue.column ?? ref.column,
          snippet: issue.snippet ?? ref.raw,
        });
      }
    }
  };

  if (isStructuredFile(file)) {
    const document = cachedStructuredDocument(file);
    if (document) {
      for (const issue of document.issues) {
        issues.push({ ...issue, nodeId: issue.nodeId ?? nodeId });
      }
      for (const entry of document.entries) {
        for (const issue of entry.issues) {
          issues.push({ ...issue, nodeId: issue.nodeId ?? entry.key });
        }
        for (const ref of entry.refs) {
          resolveRefIssues(ref);
        }
      }
    }
  } else {
    const parsed = cachedParseFile(file);
    for (const issue of parsed.issues) {
      issues.push({ ...issue, nodeId: issue.nodeId ?? nodeId });
    }
    for (const ref of parsed.refs) {
      resolveRefIssues(ref);
    }
  }

  issues.push(
    ...validateLoraRefs(file.text, loraIndex, nodeId),
    ...validatePlatformWildcardSyntax(file.text, platform, nodeId),
  );

  return issues;
}

/** Outbound file→file edges (self-refs included). */
export function buildFileReferenceGraph(
  files: LibraryFile[],
  platform: ValidationPlatform,
): Map<string, Set<string>> {
  const index = buildLibraryIndex(files);
  const graph = new Map<string, Set<string>>();
  for (const f of files) graph.set(f.key, new Set());

  for (const f of files) {
    if (HONOR_NO_VALIDATION_MARKER && hasNoValidationMarker(f.text)) continue;
    const structured = index.structuredDocuments.get(f.key);
    const refs = structured
      ? structured.entries.flatMap((entry) => entry.refs)
      : cachedParseFile(f).refs;

    for (const ref of refs) {
      const { names, dynamic } = wildcardNamesForPlatform(ref.name, platform);
      if (dynamic && platform === 'comfyui') continue;
      for (const resolvedName of names) {
        const resolved = resolveWildcard(resolvedName, index);
        const targets: string[] = [];
        if (resolved.kind === 'file' || resolved.kind === 'yamlKey') {
          if (resolved.hostKey) targets.push(resolved.hostKey);
          else if (resolved.relativeKey) targets.push(resolved.relativeKey);
        } else if (resolved.kind === 'glob' && resolved.matchedKeys) {
          for (const key of resolved.matchedKeys) {
            const matched = index.byKey.get(key);
            if (matched) targets.push(matched.key);
          }
        }
        for (const target of targets) {
          if (graph.has(target) || target === f.key) {
            graph.get(f.key)?.add(target);
          }
        }
      }
    }
  }

  return graph;
}

/**
 * Strongly connected components (Tarjan). Returns components with a cycle
 * (size > 1 or a self-loop).
 */
export function findCyclicComponents(
  graph: Map<string, Set<string>>,
): string[][] {
  let indexCounter = 0;
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  const strongConnect = (v: string) => {
    index.set(v, indexCounter);
    lowlink.set(v, indexCounter);
    indexCounter += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }

    if (lowlink.get(v) === index.get(v)) {
      const comp: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      const selfLoop = comp.length === 1 && (graph.get(comp[0]!)?.has(comp[0]!) ?? false);
      if (comp.length > 1 || selfLoop) {
        components.push(comp.sort((a, b) => a.localeCompare(b)));
      }
    }
  };

  for (const v of graph.keys()) {
    if (!index.has(v)) strongConnect(v);
  }

  return components;
}

/** Attach one cycle issue per file that participates in a cyclic component. */
export function cycleIssuesForComponents(
  components: string[][],
): Map<string, Issue[]> {
  const byKey = new Map<string, Issue[]>();
  for (const comp of components) {
    const pathLabel = [...comp, comp[0]!].join(' → ');
    const message =
      comp.length === 1
        ? `Recursive loop detected: ${comp[0]} → ${comp[0]}`
        : `Recursive loop detected: ${pathLabel}`;
    for (const key of comp) {
      const issue: Issue = {
        severity: 'error',
        code: 'cycle',
        message,
        nodeId: key,
      };
      const list = byKey.get(key) ?? [];
      list.push(issue);
      byKey.set(key, list);
    }
  }
  return byKey;
}

export function summarizeIssues(issues: Issue[]): {
  errorCount: number;
  warningCount: number;
} {
  let errorCount = 0;
  let warningCount = 0;
  for (const issue of issues) {
    if (issue.severity === 'error') errorCount += 1;
    else if (issue.severity === 'warning') warningCount += 1;
  }
  return { errorCount, warningCount };
}

/**
 * Validate every library file for node-level issues + library cycle membership.
 */
export function validateAllLibraryFiles(
  files: LibraryFile[],
  platform: ValidationPlatform,
  loraIndex: LoraIndex | null,
  opts?: {
    shouldCancel?: () => boolean;
    onFile?: (done: number, total: number, relativePath: string) => void;
  },
): FileValidationResult[] {
  const libraryIndex = buildLibraryIndex(files);
  const cycleByKey = cycleIssuesForComponents(
    findCyclicComponents(buildFileReferenceGraph(files, platform)),
  );

  const results: FileValidationResult[] = [];
  const total = files.length;
  for (let i = 0; i < files.length; i++) {
    if (opts?.shouldCancel?.()) break;
    const file = files[i]!;
    opts?.onFile?.(i + 1, total, file.relativePath);

    const issues = [
      ...collectFileNodeIssues(file, libraryIndex, platform, loraIndex),
      ...(cycleByKey.get(file.key) ?? []),
    ];
    const { errorCount, warningCount } = summarizeIssues(issues);
    results.push({
      relativePath: file.relativePath,
      key: file.key,
      issues,
      errorCount,
      warningCount,
    });
  }
  return results;
}
