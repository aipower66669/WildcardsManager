/** Prefix for dashed "+N more" drill-in ghost nodes in the focused graph. */
export const GHOST_PREFIX = '__more__';

export const DEFAULT_MAX_LEVELS = 4;
/** Max direct children shown under any one parent before a sibling frontier. */
export const DEFAULT_MAX_CHILDREN_PER_PARENT = 40;
/** Hard cap on real (non-ghost) nodes drawn for a focus cone. */
export const DEFAULT_MAX_VISIBLE_NODES = 250;
/**
 * If an uncapped 4-level cone would exceed this many nodes, the UI starts at
 * one descendant level until the user drills in.
 */
export const WIDE_GRAPH_UNCAPPED_THRESHOLD = 400;
/** Skip expensive layered/tidy layout when the visible set is at least this large. */
export const DAGRE_NODE_THRESHOLD = 150;
/** Hide the minimap when the visible set is at least this large. */
export const MINIMAP_NODE_THRESHOLD = 150;

export type GraphAdjacency = {
  children: Map<string, string[]>;
  parents: Map<string, string[]>;
};

export type GraphSliceOptions = {
  focusId: string;
  maxLevels?: number;
  maxChildrenPerParent?: number;
  maxVisibleNodes?: number;
  /** Stable sort key for which children are kept when breadth-capped. */
  labelOf?: (id: string) => string;
};

export type GraphSlice = {
  focusId: string;
  maxLevels: number;
  ancLevel: Map<string, number>;
  descLevel: Map<string, number>;
  treeParent: Map<string, string>;
  visibleIds: Set<string>;
  /** parentId → count of hidden direct children (breadth and/or depth). */
  truncated: Map<string, number>;
  breadthLimited: boolean;
  depthLimited: boolean;
  hasAncestors: boolean;
};

function pushTo(map: Map<string, string[]>, key: string, value: string): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

/** Build parent/child adjacency from directed edges. */
export function buildAdjacency(
  edges: ReadonlyArray<{ from: string; to: string }>,
): GraphAdjacency {
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    pushTo(children, edge.from, edge.to);
    pushTo(parents, edge.to, edge.from);
  }
  return { children, parents };
}

function sortIds(
  ids: string[],
  labelOf: ((id: string) => string) | undefined,
): string[] {
  return [...ids].sort((a, b) => {
    const la = labelOf?.(a) ?? a;
    const lb = labelOf?.(b) ?? b;
    const cmp = la.localeCompare(lb);
    return cmp !== 0 ? cmp : a.localeCompare(b);
  });
}

/**
 * Count nodes in the uncapped focus cone (all ancestors + all descendants
 * within maxLevels). Used to decide soft depth collapse for wide roots.
 */
export function estimateUncappedVisibleCount(
  adjacency: GraphAdjacency,
  focusId: string,
  maxLevels = DEFAULT_MAX_LEVELS,
): number {
  const { children, parents } = adjacency;
  const seen = new Set<string>([focusId]);

  const upQueue = [focusId];
  while (upQueue.length) {
    const u = upQueue.shift()!;
    for (const p of parents.get(u) ?? []) {
      if (seen.has(p)) continue;
      seen.add(p);
      upQueue.push(p);
    }
  }

  const descLevel = new Map<string, number>([[focusId, 0]]);
  const downQueue = [focusId];
  while (downQueue.length) {
    const u = downQueue.shift()!;
    const d = descLevel.get(u)!;
    if (d >= maxLevels) continue;
    for (const v of children.get(u) ?? []) {
      if (descLevel.has(v)) continue;
      descLevel.set(v, d + 1);
      seen.add(v);
      downQueue.push(v);
    }
  }

  return seen.size;
}

/**
 * Focus-centered slice: full ancestor path + breadth/depth-capped descendants.
 * Hidden children are reported on their parent via `truncated` for "+N more" ghosts.
 */
export function selectFocusedGraphSlice(
  adjacency: GraphAdjacency,
  opts: GraphSliceOptions,
): GraphSlice {
  const maxLevels = opts.maxLevels ?? DEFAULT_MAX_LEVELS;
  const maxChildren = opts.maxChildrenPerParent ?? DEFAULT_MAX_CHILDREN_PER_PARENT;
  const maxVisible = opts.maxVisibleNodes ?? DEFAULT_MAX_VISIBLE_NODES;
  const labelOf = opts.labelOf;
  const focusId = opts.focusId;
  const { children, parents } = adjacency;

  const treeParent = new Map<string, string>();
  const ancLevel = new Map<string, number>([[focusId, 0]]);
  const upQueue: string[] = [focusId];
  while (upQueue.length) {
    const u = upQueue.shift()!;
    const d = ancLevel.get(u)!;
    for (const p of parents.get(u) ?? []) {
      if (!ancLevel.has(p)) {
        ancLevel.set(p, d + 1);
        upQueue.push(p);
      }
      if (!treeParent.has(u)) treeParent.set(u, p);
    }
  }

  const descLevel = new Map<string, number>([[focusId, 0]]);
  const visibleIds = new Set<string>(ancLevel.keys());
  const truncated = new Map<string, number>();
  let breadthLimited = false;
  let depthLimited = false;

  const downQueue: string[] = [focusId];
  while (downQueue.length) {
    const u = downQueue.shift()!;
    const d = descLevel.get(u)!;
    if (d >= maxLevels) continue;

    const kids = sortIds(children.get(u) ?? [], labelOf);
    let shown = 0;
    let hidden = 0;

    for (const v of kids) {
      if (descLevel.has(v) || visibleIds.has(v)) continue;

      const atChildCap = shown >= maxChildren;
      const atTotalCap = visibleIds.size >= maxVisible;
      if (atChildCap || atTotalCap) {
        hidden += 1;
        breadthLimited = true;
        continue;
      }

      descLevel.set(v, d + 1);
      visibleIds.add(v);
      treeParent.set(v, u);
      downQueue.push(v);
      shown += 1;
    }

    if (hidden > 0) {
      truncated.set(u, (truncated.get(u) ?? 0) + hidden);
    }
  }

  // Depth frontier: nodes at the cut that still have undisplayed children.
  for (const [id, lvl] of descLevel) {
    if (lvl !== maxLevels) continue;
    const hidden = new Set(
      (children.get(id) ?? []).filter((k) => !visibleIds.has(k)),
    );
    if (hidden.size === 0) continue;
    depthLimited = true;
    truncated.set(id, Math.max(truncated.get(id) ?? 0, hidden.size));
  }

  return {
    focusId,
    maxLevels,
    ancLevel,
    descLevel,
    treeParent,
    visibleIds,
    truncated,
    breadthLimited,
    depthLimited,
    hasAncestors: ancLevel.size > 1,
  };
}
