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
import { isStructuredFile, type StructuredEntry } from './structured.js';
import type {
  AnalysisGraph,
  GraphEdge,
  GraphNode,
  Issue,
  LibraryFile,
  WildcardRef,
} from './types.js';

export type BuildGraphOptions = {
  /** Relative key or path of the root file (with or without extension). */
  rootRelativePath: string;
  files: LibraryFile[];
  /** Max nodes to visit (safety for huge libraries). */
  maxNodes?: number;
  /**
   * Target runtime. Stable Diffusion expands variant-in-wildcard names;
   * ComfyUI treats them as unsupported (skip file resolve).
   */
  validationPlatform?: ValidationPlatform;
};

function toKey(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\.(txt|ya?ml|json)$/i, '');
}

function ensureNode(
  nodes: Map<string, GraphNode>,
  id: string,
  init: Omit<GraphNode, 'outboundCount' | 'inboundCount' | 'issues'> & {
    issues?: Issue[];
  },
): GraphNode {
  const existing = nodes.get(id);
  if (existing) return existing;
  const node: GraphNode = {
    ...init,
    outboundCount: 0,
    inboundCount: 0,
    issues: init.issues ?? [],
  };
  nodes.set(id, node);
  return node;
}

/**
 * Build a dependency graph from a root wildcard file.
 * Uses a path stack for true cycle detection (not a global seen-set).
 */
export function buildDependencyGraph(opts: BuildGraphOptions): AnalysisGraph {
  const maxNodes = opts.maxNodes ?? 5_000;
  const platform = opts.validationPlatform ?? 'comfyui';
  const index: LibraryIndex = buildLibraryIndex(opts.files);
  const rootKey = toKey(opts.rootRelativePath);
  const rootFile =
    index.byKey.get(rootKey) ?? index.byKeyLower.get(rootKey.toLowerCase());

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const issues: Issue[] = [];
  const edgeKeys = new Set<string>();

  if (!rootFile) {
    const missingId = `missing:${rootKey}`;
    ensureNode(nodes, missingId, {
      id: missingId,
      kind: 'missing',
      label: rootKey,
      relativeKey: rootKey,
      depth: 0,
      issues: [
        {
          severity: 'error',
          code: 'missing_file',
          message: `Root file not found: ${opts.rootRelativePath}`,
          nodeId: missingId,
        },
      ],
    });
    issues.push({
      severity: 'error',
      code: 'missing_file',
      message: `Root file not found: ${opts.rootRelativePath}`,
      nodeId: missingId,
    });
    return { rootNodeId: missingId, nodes: [...nodes.values()], edges, issues };
  }

  const rootId = isStructuredFile(rootFile)
    ? `structured-file:${rootFile.key}`
    : rootFile.key;
  ensureNode(nodes, rootId, {
    id: rootId,
    kind: 'root',
    label: rootFile.key,
    path: rootFile.absolutePath,
    relativeKey: rootFile.key,
    hostKey: rootFile.key,
    depth: 0,
    lineCount: rootFile.text.split(/\r?\n/).length,
  });

  type Frame = {
    nodeId: string;
    file: LibraryFile;
    entry?: StructuredEntry;
    depth: number;
    path: string[];
  };
  const stack: Frame[] = [{ nodeId: rootId, file: rootFile, depth: 0, path: [rootId] }];
  const fullyExpanded = new Set<string>();

  while (stack.length > 0) {
    if (nodes.size > maxNodes) {
      issues.push({
        severity: 'warning',
        code: 'read_error',
        message: `Graph truncated at ${maxNodes} nodes`,
      });
      break;
    }

    const frame = stack.pop()!;
    if (fullyExpanded.has(frame.nodeId)) continue;

    const node = nodes.get(frame.nodeId)!;
    const skipValidation =
      !frame.entry &&
      !isStructuredFile(frame.file) &&
      HONOR_NO_VALIDATION_MARKER &&
      hasNoValidationMarker(frame.file.text);
    let refs: WildcardRef[];
    let frameIssues: Issue[];
    let childEntries: StructuredEntry[] = [];

    if (frame.entry) {
      refs = frame.entry.refs;
      frameIssues = frame.entry.issues;
      node.lineCount = frame.entry.values.length;
      childEntries = frame.entry.childKeys
        .map((key) => index.structuredByKey.get(key))
        .filter((entry): entry is StructuredEntry => Boolean(entry));
    } else if (isStructuredFile(frame.file)) {
      const document = index.structuredDocuments.get(frame.file.key);
      refs = [];
      const entryIssues = new Set(
        document?.entries.flatMap((entry) => entry.issues) ?? [],
      );
      frameIssues =
        document?.issues.filter((issue) => !entryIssues.has(issue)) ?? [];
      node.lineCount = frame.file.text.split(/\r?\n/).length;
      childEntries = (document?.rootKeys ?? [])
        .map((key) => index.structuredByKey.get(key))
        .filter((entry): entry is StructuredEntry => Boolean(entry));
    } else {
      const parsed = cachedParseFile(frame.file);
      refs = parsed.refs;
      frameIssues = parsed.issues;
      node.lineCount = parsed.lines.length;
    }

    // Keep no-validation files in the tree; only skip reporting issues.
    for (const issue of frameIssues) {
      const withNode = { ...issue, nodeId: issue.nodeId ?? frame.nodeId };
      node.issues.push(withNode);
      issues.push(withNode);
    }

    for (const childEntry of childEntries) {
      const childId = childEntry.key;
      ensureNode(nodes, childId, {
        id: childId,
        kind: 'yamlKey',
        label: childId,
        path: frame.file.absolutePath,
        relativeKey: childId,
        hostKey: childEntry.hostKey,
        depth: frame.depth + 1,
        lineCount: childEntry.values.length,
      });
      const edgeId = `${frame.nodeId}->${childId}@${childEntry.line}:${childEntry.column}`;
      if (!edgeKeys.has(edgeId)) {
        edgeKeys.add(edgeId);
        edges.push({
          id: edgeId,
          from: frame.nodeId,
          to: childId,
          line: childEntry.line,
          column: childEntry.column,
          snippet: childEntry.path.at(-1) ?? childEntry.hostKey,
          isCycle: false,
        });
      }
      if (!fullyExpanded.has(childId)) {
        stack.push({
          nodeId: childId,
          file: frame.file,
          entry: childEntry,
          depth: frame.depth + 1,
          path: [...frame.path, childId],
        });
      }
    }

    for (const ref of refs) {
      const { names, dynamic } = wildcardNamesForPlatform(ref.name, platform);
      // ComfyUI cannot resolve Dynamic Prompt logic inside `__…__`; platform
      // validation reports that separately — do not invent a missing file.
      if (dynamic && platform === 'comfyui') continue;

      for (const resolvedName of names) {
      const resolved = resolveWildcard(resolvedName, index);

      // A no-validation file's unresolved references are intentional — do not
      // surface them as missing/glob-no-match nodes, edges, or issues at all.
      if (skipValidation && resolved.kind === 'missing') continue;

      // Glob → expand to each matched file as children
      const targets =
        resolved.kind === 'glob' && resolved.matchedKeys
          ? resolved.matchedKeys.map((k) => {
              const r = resolveWildcard(k, index);
              return r;
            })
          : [resolved];

      if (resolved.kind === 'glob') {
        ensureNode(nodes, resolved.id, {
          id: resolved.id,
          kind: 'glob',
          label: resolved.label,
          depth: frame.depth + 1,
          issues: skipValidation ? [] : resolved.issues,
        });
        if (!skipValidation) {
          for (const iss of resolved.issues) {
            const withNode = { ...iss, nodeId: resolved.id, line: ref.line };
            issues.push(withNode);
          }
        }
        const edgeId = `${frame.nodeId}->${resolved.id}@${ref.line}:${ref.column}`;
        if (!edgeKeys.has(edgeId)) {
          edgeKeys.add(edgeId);
          const isCycle = frame.path.includes(resolved.id);
          edges.push({
            id: edgeId,
            from: frame.nodeId,
            to: resolved.id,
            line: ref.line,
            column: ref.column,
            snippet: ref.raw,
            isCycle: skipValidation ? false : isCycle,
          });
        }
      }

      for (const target of targets) {
        // Skip intentionally-unresolved targets from no-validation files.
        if (skipValidation && target.kind === 'missing') continue;

        const sourceNodeId =
          resolved.kind === 'glob' ? resolved.id : frame.nodeId;
        const targetDepth =
          frame.depth + (resolved.kind === 'glob' ? 2 : 1);

        const cycleOnPath = frame.path.includes(target.id);
        ensureNode(nodes, target.id, {
          id: target.id,
          kind: target.kind === 'missing' ? 'missing' : target.kind,
          label: target.label,
          path: target.absolutePath,
          relativeKey: target.relativeKey,
          hostKey: target.hostKey,
          depth: targetDepth,
          issues: [],
        });

        if (!skipValidation) {
          for (const iss of target.issues) {
            const withNode = {
              ...iss,
              nodeId: target.id,
              line: ref.line,
              column: ref.column,
              snippet: ref.raw,
            };
            issues.push(withNode);
            nodes.get(target.id)?.issues.push(withNode);
          }
        }

        const edgeId = `${sourceNodeId}->${target.id}@${ref.line}:${ref.column}`;
        if (!edgeKeys.has(edgeId)) {
          edgeKeys.add(edgeId);
          edges.push({
            id: edgeId,
            from: sourceNodeId,
            to: target.id,
            line: ref.line,
            column: ref.column,
            snippet: ref.raw,
            isCycle: skipValidation ? false : cycleOnPath,
          });
        }

        if (cycleOnPath) {
          if (!skipValidation) {
            const cyclePath = [...frame.path, target.id].join(' → ');
            const cycleIssue: Issue = {
              severity: 'error',
              code: 'cycle',
              message: `Recursive loop detected: ${cyclePath}`,
              nodeId: target.id,
              line: ref.line,
              column: ref.column,
              snippet: ref.raw,
            };
            issues.push(cycleIssue);
            nodes.get(target.id)?.issues.push(cycleIssue);
            nodes.get(frame.nodeId)?.issues.push(cycleIssue);
          }
          continue;
        }

        if (
          (target.kind === 'file' || target.kind === 'yamlKey') &&
          target.relativeKey &&
          !fullyExpanded.has(target.id)
        ) {
          const structuredEntry =
            index.structuredByKey.get(target.relativeKey) ??
            index.structuredByKeyLower.get(target.relativeKey.toLowerCase());
          if (structuredEntry && structuredEntry.path.length > 0) {
            const childFile =
              index.byKey.get(structuredEntry.hostKey) ??
              index.byKeyLower.get(structuredEntry.hostKey.toLowerCase());
            if (childFile) {
              stack.push({
                nodeId: target.id,
                file: childFile,
                entry: structuredEntry,
                depth: targetDepth,
                path: [...frame.path, target.id],
              });
            }
          } else {
            const childFile =
              index.byKey.get(target.relativeKey) ??
              index.byKeyLower.get(target.relativeKey.toLowerCase());
            if (childFile) {
              stack.push({
                nodeId: target.id,
                file: childFile,
                depth: targetDepth,
                path: [...frame.path, target.id],
              });
            }
          }
        }
      }
      }
    }

    fullyExpanded.add(frame.nodeId);
  }

  // Compute inbound/outbound counts
  for (const edge of edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from) from.outboundCount += 1;
    if (to) to.inboundCount += 1;
  }

  // Prefer shallower depth if node reached multiple ways
  for (const edge of edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from && to && to.depth > from.depth + 1) {
      to.depth = from.depth + 1;
    }
  }

  return {
    rootNodeId: rootId,
    nodes: [...nodes.values()].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id)),
    edges,
    issues,
  };
}
