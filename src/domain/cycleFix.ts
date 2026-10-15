import type { GraphEdge, LibraryFile } from './types.js';

export type CycleEdge = {
  id: string;
  from: string;
  to: string;
  line: number;
  column?: number;
  snippet: string;
};

export type CycleGroup = {
  id: string;
  nodeIds: string[];
  edges: CycleEdge[];
  /** Representative cycle paths found within the group. */
  paths: string[];
};

export type CycleFixMode = 'token' | 'line';

export type CycleFixImpact = 'very_low' | 'low' | 'medium' | 'high';

export type CycleFixSuggestion = {
  id: string;
  edge: CycleEdge;
  relativePath: string;
  mode: CycleFixMode;
  /** Lower is better / safer. */
  score: number;
  impact: CycleFixImpact;
  summary: string;
  details: string[];
  /** Edited source file text after applying this suggestion. */
  newText: string;
  /** True when removing this edge eliminates every cycle in the group. */
  breaksAllCycles: boolean;
  /** Nodes that become unreachable from the analysis root after removal. */
  unreachableFromRoot: string[];
};

export type CycleResolvePlan = {
  canResolve: boolean;
  reason?: string;
  group: CycleGroup | null;
  suggestions: CycleFixSuggestion[];
};

/**
 * Remove one wildcard occurrence at a 1-based line/column.
 * If the line's only active content is the snippet, remove the whole line.
 */
export function removeReferenceAt(
  text: string,
  line: number,
  column: number | undefined,
  snippet: string,
): { text: string; mode: CycleFixMode; ok: boolean; reason?: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (line < 1 || line > lines.length) {
    return { text, mode: 'token', ok: false, reason: `Line ${line} is out of range.` };
  }
  const original = lines[line - 1]!;
  const trimmed = original.trim();
  const needle = snippet.trim();
  if (!needle) {
    return { text, mode: 'token', ok: false, reason: 'Empty snippet.' };
  }

  // Whole-line reference → drop the line.
  if (trimmed === needle) {
    const next = lines.slice();
    next.splice(line - 1, 1);
    return { text: next.join(eol), mode: 'line', ok: true };
  }

  let index = -1;
  if (column && column > 0) {
    const from = Math.max(0, column - 1);
    if (original.slice(from, from + needle.length) === needle) {
      index = from;
    }
  }
  if (index < 0) {
    index = original.indexOf(needle);
  }
  if (index < 0) {
    return {
      text,
      mode: 'token',
      ok: false,
      reason: `Could not find ${needle} on line ${line}.`,
    };
  }

  const replaced =
    original.slice(0, index) + original.slice(index + needle.length);
  // If the line collapses to blank after removal, drop it.
  if (!replaced.trim()) {
    const next = lines.slice();
    next.splice(line - 1, 1);
    return { text: next.join(eol), mode: 'line', ok: true };
  }

  const next = lines.slice();
  next[line - 1] = replaced;
  return { text: next.join(eol), mode: 'token', ok: true };
}

/** Tarjan SCC over directed edges. Returns components with 2+ nodes or a self-loop. */
export function findStronglyConnectedComponents(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
): string[][] {
  const nodes = [...new Set(nodeIds)];
  const adj = new Map<string, string[]>();
  for (const id of nodes) adj.set(id, []);
  for (const e of edges) {
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
  }

  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const components: string[][] = [];

  const strongConnect = (v: string) => {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const comp: string[] = [];
      while (true) {
        const w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      components.push(comp);
    }
  };

  for (const v of nodes) {
    if (!indices.has(v)) strongConnect(v);
  }

  const hasSelfLoop = new Set(
    edges.filter((e) => e.from === e.to).map((e) => e.from),
  );
  return components.filter(
    (comp) => comp.length > 1 || (comp.length === 1 && hasSelfLoop.has(comp[0]!)),
  );
}

function edgeKey(e: { from: string; to: string; line: number; snippet: string }): string {
  return `${e.from}->${e.to}@${e.line}:${e.snippet}`;
}

function buildAdjacency(edges: CycleEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  return adj;
}

function canReach(
  adj: Map<string, string[]>,
  from: string,
  to: string,
  blocked?: { from: string; to: string; line: number; snippet: string },
  allEdges?: CycleEdge[],
): boolean {
  // Rebuild adjacency excluding blocked edge when provided.
  let graph = adj;
  if (blocked && allEdges) {
    graph = new Map();
    for (const e of allEdges) {
      if (
        e.from === blocked.from &&
        e.to === blocked.to &&
        e.line === blocked.line &&
        e.snippet === blocked.snippet
      ) {
        continue;
      }
      if (!graph.has(e.from)) graph.set(e.from, []);
      graph.get(e.from)!.push(e.to);
    }
  }
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of graph.get(cur) ?? []) stack.push(next);
  }
  return false;
}

function hasCycleIn(
  nodeIds: string[],
  edges: CycleEdge[],
  excluded?: CycleEdge,
): boolean {
  const remaining = excluded
    ? edges.filter(
        (e) =>
          !(
            e.from === excluded.from &&
            e.to === excluded.to &&
            e.line === excluded.line &&
            e.snippet === excluded.snippet
          ),
      )
    : edges;
  const comps = findStronglyConnectedComponents(nodeIds, remaining);
  return comps.length > 0;
}

/**
 * Shortest node path from `from` to `to` (inclusive), or null.
 * Used to reconstruct a cycle through a single back-edge without enumerating
 * every simple path in the SCC (which is combinatorial and can freeze the UI).
 */
function bfsNodePath(
  adj: Map<string, string[]>,
  from: string,
  to: string,
): string[] | null {
  if (from === to) return [from];
  const parent = new Map<string, string | null>();
  parent.set(from, null);
  const queue = [from];
  for (let i = 0; i < queue.length; i += 1) {
    const cur = queue[i]!;
    for (const next of adj.get(cur) ?? []) {
      if (parent.has(next)) continue;
      parent.set(next, cur);
      if (next === to) {
        const path = [to];
        let walk: string | null = to;
        while (walk !== from) {
          walk = parent.get(walk!) ?? null;
          if (walk == null) return null;
          path.push(walk);
        }
        path.reverse();
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * Collect a few representative cycle path strings for UI display.
 * Bounded: never DFS-enumerates all simple paths (dense SCCs hang the app).
 */
function collectPaths(
  nodeIds: string[],
  edges: CycleEdge[],
  limit = 8,
): string[] {
  const set = new Set(nodeIds);
  const relevant = edges.filter((e) => set.has(e.from) && set.has(e.to));
  if (relevant.length === 0) return [];

  const adj = buildAdjacency(relevant);
  const paths: string[] = [];
  const seenPath = new Set<string>();

  const pushPath = (nodes: string[]) => {
    if (paths.length >= limit || nodes.length < 2) return;
    const full = nodes.join(' → ');
    if (seenPath.has(full)) return;
    seenPath.add(full);
    paths.push(full);
  };

  // Prefer short cycles reconstructed via each edge (BFS back to the source).
  for (const edge of relevant) {
    if (paths.length >= limit) break;
    if (edge.from === edge.to) {
      pushPath([edge.from, edge.from]);
      continue;
    }
    const back = bfsNodePath(adj, edge.to, edge.from);
    if (!back || back[0] !== edge.to) continue;
    pushPath([edge.from, ...back]);
  }

  return paths;
}

function unreachableFrom(
  rootId: string,
  nodeIds: string[],
  edges: CycleEdge[],
  excluded: CycleEdge,
): string[] {
  const remaining = edges.filter(
    (e) =>
      !(
        e.from === excluded.from &&
        e.to === excluded.to &&
        e.line === excluded.line &&
        e.snippet === excluded.snippet
      ),
  );
  const adj = buildAdjacency(remaining);
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }
  return nodeIds.filter((id) => id !== rootId && !seen.has(id)).sort();
}

function fileForNode(
  files: LibraryFile[],
  nodeId: string,
): LibraryFile | undefined {
  return (
    files.find((f) => f.key === nodeId) ??
    files.find((f) => f.key.toLowerCase() === nodeId.toLowerCase())
  );
}

function impactFromScore(
  score: number,
  unreachable: number,
  breaksAll: boolean,
): CycleFixImpact {
  if (breaksAll && unreachable === 0 && score <= 10) return 'very_low';
  if (breaksAll && unreachable === 0) return 'low';
  if (unreachable <= 1) return 'medium';
  return 'high';
}

/**
 * Build cycle groups (SCCs) from analysis edges.
 * Computes SCCs over the full graph, then keeps components that contain at
 * least one edge marked `isCycle` (or a self-loop).
 */
export function buildCycleGroups(edges: GraphEdge[]): CycleGroup[] {
  const cycleEdgeKeys = new Set(
    edges.filter((e) => e.isCycle).map((e) => edgeKey(e)),
  );
  if (cycleEdgeKeys.size === 0) return [];

  const nodeIds = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  const allCycleEdges: CycleEdge[] = edges.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    line: e.line,
    column: e.column,
    snippet: e.snippet,
  }));

  const comps = findStronglyConnectedComponents(nodeIds, allCycleEdges);
  return comps
    .map((nodes, i) => {
      const set = new Set(nodes);
      const groupEdges = allCycleEdges.filter(
        (e) => set.has(e.from) && set.has(e.to),
      );
      const hasMarkedCycle = groupEdges.some((e) => cycleEdgeKeys.has(edgeKey(e)));
      const hasSelfLoop = groupEdges.some((e) => e.from === e.to);
      if (!hasMarkedCycle && !hasSelfLoop) return null;
      const sortedNodes = [...nodes].sort();
      return {
        id: `cycle-group:${sortedNodes.join('|') || i}`,
        nodeIds: sortedNodes,
        edges: groupEdges,
        paths: collectPaths(sortedNodes, groupEdges),
      } satisfies CycleGroup;
    })
    .filter((g): g is CycleGroup => g != null)
    .sort(
      (a, b) =>
        b.nodeIds.length - a.nodeIds.length || a.id.localeCompare(b.id),
    );
}

export function findCycleGroupForIssue(
  groups: CycleGroup[],
  issue: {
    nodeId?: string;
    line?: number;
    snippet?: string;
    message?: string;
  },
): CycleGroup | null {
  if (groups.length === 0) return null;

  // Prefer group containing an edge matching the issue line/snippet.
  if (issue.line != null && issue.snippet) {
    for (const g of groups) {
      const hit = g.edges.find(
        (e) =>
          e.line === issue.line &&
          e.snippet === issue.snippet &&
          (!issue.nodeId || e.to === issue.nodeId || e.from === issue.nodeId),
      );
      if (hit) return g;
    }
  }

  if (issue.nodeId) {
    const hit = groups.find((g) => g.nodeIds.includes(issue.nodeId!));
    if (hit) return hit;
  }

  // Parse path from "Recursive loop detected: a → b → a"
  const pathMatch = issue.message?.match(/:\s*(.+)$/);
  if (pathMatch) {
    const parts = pathMatch[1]!.split(/\s*→\s*/).map((p) => p.trim());
    for (const g of groups) {
      if (parts.every((p) => g.nodeIds.includes(p))) return g;
    }
  }

  return groups[0] ?? null;
}

/**
 * Rank single-edge removal suggestions for a cycle group.
 * `allEdges` is the full analysis graph (used for root reachability impact).
 */
export function planCycleResolutions(
  files: LibraryFile[],
  rootNodeId: string,
  group: CycleGroup,
  allEdges: GraphEdge[] = [],
): CycleResolvePlan {
  if (group.edges.length === 0) {
    return {
      canResolve: false,
      reason: 'No edges found in this cycle group.',
      group,
      suggestions: [],
    };
  }

  const reachEdges: CycleEdge[] =
    allEdges.length > 0
      ? allEdges.map((e) => ({
          id: e.id,
          from: e.from,
          to: e.to,
          line: e.line,
          column: e.column,
          snippet: e.snippet,
        }))
      : group.edges;

  // Nodes currently reachable from the root (before any fix).
  const currentlyReachable = new Set<string>([rootNodeId]);
  {
    const adj = buildAdjacency(reachEdges);
    const stack = [rootNodeId];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const next of adj.get(cur) ?? []) {
        if (currentlyReachable.has(next)) continue;
        currentlyReachable.add(next);
        stack.push(next);
      }
    }
  }

  const suggestions: CycleFixSuggestion[] = [];
  const adj = buildAdjacency(group.edges);

  for (const edge of group.edges) {
    const file = fileForNode(files, edge.from);
    if (!file) continue;

    const removal = removeReferenceAt(
      file.text,
      edge.line,
      edge.column,
      edge.snippet,
    );
    if (!removal.ok) continue;

    const breaksAll = !hasCycleIn(group.nodeIds, group.edges, edge);
    const unreachableAfter = unreachableFrom(
      rootNodeId,
      [...currentlyReachable],
      reachEdges,
      edge,
    );
    // Only count newly-lost nodes that were reachable before.
    const unreachableInGroup = unreachableAfter.filter((id) =>
      group.nodeIds.includes(id),
    );

    const isSelfLoop = edge.from === edge.to;
    const alternatePath =
      !isSelfLoop && canReach(adj, edge.from, edge.to, edge, group.edges);

    let score = 50;
    const details: string[] = [];

    if (breaksAll) {
      score -= 35;
      details.push('Removes every cycle in this group');
    } else {
      score += 25;
      details.push('Some cycles would remain — may need another fix');
    }

    if (isSelfLoop) {
      score -= 20;
      details.push('Direct self-reference');
    }

    if (removal.mode === 'line') {
      score -= 10;
      details.push('Reference is the only content on its line');
    } else {
      details.push('Removes the token, keeps the rest of the line');
    }

    if (unreachableAfter.length === 0) {
      score -= 15;
      details.push('Nothing becomes newly unreachable from the current root');
    } else {
      score += unreachableAfter.length * 8;
      details.push(
        `${unreachableAfter.length} node(s) would become unreachable from the root: ${unreachableAfter.slice(0, 6).join(', ')}${unreachableAfter.length > 6 ? '…' : ''}`,
      );
    }

    if (alternatePath) {
      score -= 8;
      details.push('Another path still connects these nodes');
    }

    const outbound = group.edges.filter((e) => e.from === edge.from).length;
    if (outbound === 1) {
      score -= 3;
      details.push('Only cycle edge leaving this file in the group');
    }

    score = Math.max(0, score);
    const impact = impactFromScore(
      score,
      unreachableAfter.length,
      breaksAll,
    );

    const summary = isSelfLoop
      ? `Remove self-reference ${edge.snippet} in ${edge.from}`
      : `Remove ${edge.snippet} from ${edge.from} → ${edge.to}`;

    suggestions.push({
      id: edgeKey(edge),
      edge,
      relativePath: file.relativePath,
      mode: removal.mode,
      score,
      impact,
      summary,
      details,
      newText: removal.text,
      breaksAllCycles: breaksAll,
      unreachableFromRoot: unreachableInGroup,
    });
  }

  suggestions.sort(
    (a, b) =>
      a.score - b.score ||
      Number(b.breaksAllCycles) - Number(a.breaksAllCycles) ||
      a.unreachableFromRoot.length - b.unreachableFromRoot.length ||
      a.edge.from.localeCompare(b.edge.from),
  );

  if (suggestions.length === 0) {
    return {
      canResolve: false,
      reason:
        'Could not build an automatic fix for this cycle. Open the referring file and edit manually.',
      group,
      suggestions: [],
    };
  }

  return {
    canResolve: true,
    group,
    suggestions,
  };
}

/**
 * Plan cycle resolutions starting from a clicked cycle issue.
 */
export function planCycleFixFromIssue(
  files: LibraryFile[],
  rootNodeId: string,
  edges: GraphEdge[],
  issue: {
    nodeId?: string;
    line?: number;
    column?: number;
    snippet?: string;
    message?: string;
  },
): CycleResolvePlan {
  const groups = buildCycleGroups(edges);
  const group = findCycleGroupForIssue(groups, issue);
  if (!group) {
    return {
      canResolve: false,
      reason: 'No cycle group found for this issue.',
      group: null,
      suggestions: [],
    };
  }
  return planCycleResolutions(files, rootNodeId, group, edges);
}

/** Verify a suggestion still applies and return the file edit. */
export function applyCycleSuggestionText(
  files: LibraryFile[],
  suggestion: Pick<
    CycleFixSuggestion,
    'edge' | 'relativePath' | 'newText'
  >,
): { relativePath: string; text: string } {
  const file =
    files.find((f) => f.relativePath === suggestion.relativePath) ??
    fileForNode(files, suggestion.edge.from);
  if (!file) {
    throw new Error(`Source file not found: ${suggestion.relativePath}`);
  }
  const check = removeReferenceAt(
    file.text,
    suggestion.edge.line,
    suggestion.edge.column,
    suggestion.edge.snippet,
  );
  if (!check.ok) {
    throw new Error(check.reason ?? 'Cycle fix no longer applies');
  }
  return { relativePath: file.relativePath, text: check.text };
}
