import { LOCAL_SYNTAX_ISSUE_CODES } from './parseRefs.js';

/**
 * Graph issues that should stay on screen while one file is being fixed.
 * A finished live check replaces that file's own rows. It does not clear
 * every other row.
 */

/** Issue codes a single-file check can add or remove. Cycles and unused LoRAs are not in this set. */
export const FILE_CHECK_ISSUE_CODES = new Set<string>([
  ...LOCAL_SYNTAX_ISSUE_CODES,
  'missing_file',
  'glob_no_match',
  'missing_lora',
  'unsupported_wildcard_logic',
  'structured_parse_error',
  'unsupported_structured_value',
  'duplicate_structured_key',
]);

export type GraphIssueIdentity = {
  code: string;
  nodeId?: string;
  line?: number;
  column?: number;
  message: string;
  snippet?: string;
};

export function issueIdentity(issue: GraphIssueIdentity): string {
  return [
    issue.code,
    issue.nodeId ?? '',
    String(issue.line ?? ''),
    String(issue.column ?? ''),
    issue.message,
    issue.snippet ?? '',
  ].join('\u0000');
}

export function nodeIdsForFile(
  nodes: readonly { id: string; relativeKey?: string; hostKey?: string }[],
  fileKey: string,
): Set<string> {
  const ids = new Set<string>([fileKey, `structured-file:${fileKey}`]);
  for (const node of nodes) {
    if (
      node.id === fileKey ||
      node.relativeKey === fileKey ||
      node.hostKey === fileKey ||
      node.id === `structured-file:${fileKey}`
    ) {
      ids.add(node.id);
      if (node.relativeKey) ids.add(node.relativeKey);
      if (node.hostKey) ids.add(node.hostKey);
    }
  }
  return ids;
}

function issueOwnedByFile<T extends GraphIssueIdentity>(
  issue: T,
  opts: {
    openNodeIds: ReadonlySet<string>;
    edges: readonly { from: string; to: string; line?: number; snippet?: string }[];
  },
): boolean {
  if (issue.nodeId && opts.openNodeIds.has(issue.nodeId)) return true;
  for (const edge of opts.edges) {
    if (!opts.openNodeIds.has(edge.from)) continue;
    if (issue.line == null || edge.line !== issue.line) continue;
    if (issue.nodeId && issue.nodeId === edge.to) return true;
    if (issue.snippet && edge.snippet && issue.snippet === edge.snippet) {
      return true;
    }
  }
  return false;
}

/**
 * Replace the open file's rows with the latest check.
 * `codes` limits the replacement to those issue codes (local syntax).
 * Rows from other files stay.
 */
export function issuesAfterFileEdit<T extends GraphIssueIdentity>(
  graphIssues: readonly T[],
  liveIssues: readonly T[],
  opts: {
    openNodeIds: ReadonlySet<string>;
    edges: readonly { from: string; to: string; line?: number; snippet?: string }[];
    codes?: ReadonlySet<string>;
    /** Node ids already in the graph. A live row whose node is not here was added by the editor. */
    knownNodeIds?: ReadonlySet<string>;
  },
): T[] {
  const replaces = (issue: T) => {
    if (opts.codes && !opts.codes.has(issue.code)) return false;
    // The editor's instant syntax rows have no node id. A finished check
    // replaces them. Leaving them in place kept a fixed error until Refresh.
    if (!issue.nodeId) return opts.codes != null;
    if (issueOwnedByFile(issue, opts)) return true;
    if (
      opts.knownNodeIds &&
      !opts.knownNodeIds.has(issue.nodeId) &&
      !opts.openNodeIds.has(issue.nodeId)
    ) {
      return true;
    }
    return false;
  };
  const liveRelevant = opts.codes
    ? liveIssues.filter((issue) => opts.codes!.has(issue.code))
    : liveIssues;
  const liveIds = new Set(liveRelevant.map(issueIdentity));
  const kept = graphIssues.filter(
    (issue) => !replaces(issue) || liveIds.has(issueIdentity(issue)),
  );
  const keptIds = new Set(kept.map(issueIdentity));
  return [
    ...kept,
    ...liveRelevant.filter((issue) => !keptIds.has(issueIdentity(issue))),
  ];
}

export function analysisAfterFileEdit<
  TIssue extends GraphIssueIdentity & { severity?: string },
  TNode extends {
    id: string;
    relativeKey?: string;
    hostKey?: string;
    issues: readonly TIssue[];
  },
  TAnalysis extends {
    nodes: readonly TNode[];
    edges: readonly { from: string; to: string; line?: number; snippet?: string }[];
    issues: readonly TIssue[];
    stats: { errorCount: number; warningCount: number };
  },
>(
  current: TAnalysis,
  fileKey: string,
  liveIssues: readonly TIssue[],
  codes?: ReadonlySet<string>,
): TAnalysis {
  const openNodeIds = nodeIdsForFile(current.nodes, fileKey);
  const issues = issuesAfterFileEdit(current.issues, liveIssues, {
    openNodeIds,
    edges: current.edges,
    codes,
    knownNodeIds: new Set(current.nodes.map((node) => node.id)),
  });
  if (
    issues.length === current.issues.length &&
    issues.every((issue, index) => issue === current.issues[index])
  ) {
    return current;
  }
  const ids = new Set(issues.map(issueIdentity));
  return {
    ...current,
    issues,
    nodes: current.nodes.map((node) => {
      const kept = node.issues.filter((issue) => ids.has(issueIdentity(issue)));
      const extras = issues.filter(
        (issue) =>
          issue.nodeId === node.id &&
          !kept.some((existing) => issueIdentity(existing) === issueIdentity(issue)),
      );
      if (extras.length === 0 && kept.length === node.issues.length) return node;
      return { ...node, issues: [...kept, ...extras] };
    }),
    stats: {
      ...current.stats,
      errorCount: issues.filter((issue) => issue.severity === 'error').length,
      warningCount: issues.filter((issue) => issue.severity === 'warning').length,
    },
  };
}

export function remainingGraphIssues<T extends GraphIssueIdentity>(
  graphIssues: readonly T[],
  opts: {
    shownIdentities: ReadonlySet<string>;
    /**
     * True only after a finished validation of the open file.
     * Until then, that file's existing rows stay visible.
     */
    liveFileReady: boolean;
    openNodeIds: ReadonlySet<string>;
    /** Every node that belongs to the open file, including nested keys. */
    fileNodeIds?: ReadonlySet<string>;
    edges?: readonly { from: string; to: string; line?: number; snippet?: string }[];
    /**
     * Identities the open file's finished check still reports.
     * Owned file-check rows missing from this set leave the list.
     */
    resolvedIdentities?: ReadonlySet<string>;
  },
): T[] {
  return graphIssues.filter((issue) => {
    if (opts.shownIdentities.has(issueIdentity(issue))) return false;
    // Instant editor rows carry no node id. The node list shows the live
    // copy. This graph copy must not stay behind after the line is fixed.
    if (!issue.nodeId && FILE_CHECK_ISSUE_CODES.has(issue.code)) {
      return false;
    }
    if (
      opts.liveFileReady &&
      issue.nodeId &&
      opts.openNodeIds.has(issue.nodeId)
    ) {
      return false;
    }
    if (
      opts.liveFileReady &&
      opts.resolvedIdentities &&
      opts.fileNodeIds &&
      opts.edges &&
      FILE_CHECK_ISSUE_CODES.has(issue.code) &&
      issueOwnedByFile(issue, {
        openNodeIds: opts.fileNodeIds,
        edges: opts.edges,
      }) &&
      !opts.resolvedIdentities.has(issueIdentity(issue))
    ) {
      return false;
    }
    return true;
  });
}
