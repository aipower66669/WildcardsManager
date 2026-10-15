/**
 * Compact tree layout: depth layers + minimum-gap horizontal packing.
 *
 * Gaps exist only to avoid overlap. Each parent's children are packed into a
 * block and centered under that parent — not left-aligned (which caused the
 * whole tree to lean right as deeper ranks cascaded).
 */

export type TidyNodeSize = { width: number; height: number };

export type CompactTreeLayoutOptions = {
  rootId: string;
  /** Ordered children for the spanning tree (missing → leaf). */
  children: ReadonlyMap<string, readonly string[]>;
  nodeSize: (id: string) => TidyNodeSize;
  /** Minimum horizontal gap between non-overlapping boxes. */
  nodeSep?: number;
  /** Vertical gap between parent bottom and child top. */
  rankSep?: number;
};

/**
 * Close horizontal gaps on each rank down to `maxGap`.
 * Preserves left-to-right order; shifts nodes left when the gap is larger.
 */
export function compactRankGaps(
  positions: Map<string, { x: number; y: number }>,
  dimensions: ReadonlyMap<string, { width: number; height: number }>,
  maxGap: number,
): void {
  const byRank = new Map<number, string[]>();
  for (const [id, p] of positions) {
    const key = Math.round(p.y);
    const list = byRank.get(key);
    if (list) list.push(id);
    else byRank.set(key, [id]);
  }

  for (const ids of byRank.values()) {
    ids.sort((a, b) => positions.get(a)!.x - positions.get(b)!.x);
    for (let i = 1; i < ids.length; i++) {
      const prev = ids[i - 1]!;
      const cur = ids[i]!;
      const prevPos = positions.get(prev)!;
      const curPos = positions.get(cur)!;
      const prevW = dimensions.get(prev)?.width ?? 160;
      const gap = curPos.x - (prevPos.x + prevW);
      if (gap <= maxGap) continue;
      const shift = gap - maxGap;
      for (let j = i; j < ids.length; j++) {
        const id = ids[j]!;
        const p = positions.get(id)!;
        positions.set(id, { x: p.x - shift, y: p.y });
      }
    }
  }
}

function normalizeOrigin(positions: Map<string, { x: number; y: number }>): void {
  let minX = Infinity;
  let minY = Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
  for (const [id, p] of positions) {
    positions.set(id, { x: p.x - minX, y: p.y - minY });
  }
}

type SiblingGroup = {
  parentId: string;
  kids: string[];
  left: number;
  right: number;
};

/**
 * Pack each parent's children as a contiguous block centered on the parent,
 * then shift whole groups right only when neighboring groups would overlap.
 */
function placeRankCenteredUnderParents(
  ids: readonly string[],
  y: number,
  parentOf: ReadonlyMap<string, string>,
  children: ReadonlyMap<string, readonly string[]>,
  positions: Map<string, { x: number; y: number }>,
  nodeSize: (id: string) => TidyNodeSize,
  nodeSep: number,
): void {
  if (ids.length === 0) return;

  const byParent = new Map<string, string[]>();
  for (const id of ids) {
    const parent = parentOf.get(id) ?? '';
    const list = byParent.get(parent);
    if (list) list.push(id);
    else byParent.set(parent, [id]);
  }

  // Preserve declared sibling order from the children map.
  for (const [parent, kids] of byParent) {
    const order = children.get(parent);
    if (!order) continue;
    kids.sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }

  const groups: SiblingGroup[] = [...byParent.entries()]
    .map(([parentId, kids]) => {
      let blockW = 0;
      for (let i = 0; i < kids.length; i++) {
        if (i > 0) blockW += nodeSep;
        blockW += nodeSize(kids[i]!).width;
      }
      const parentPos = positions.get(parentId);
      const parentSz = parentId ? nodeSize(parentId) : { width: 0, height: 0 };
      const parentCenter = parentPos
        ? parentPos.x + parentSz.width / 2
        : blockW / 2;
      const left = parentCenter - blockW / 2;
      return { parentId, kids, left, right: left + blockW };
    })
    .sort((a, b) => a.left - b.left || a.parentId.localeCompare(b.parentId));

  // Resolve group overlaps — shift later groups right only as needed.
  for (let i = 1; i < groups.length; i++) {
    const prev = groups[i - 1]!;
    const cur = groups[i]!;
    const minLeft = prev.right + nodeSep;
    if (cur.left >= minLeft) continue;
    const shift = minLeft - cur.left;
    cur.left += shift;
    cur.right += shift;
  }

  for (const group of groups) {
    let x = group.left;
    for (const id of group.kids) {
      const size = nodeSize(id);
      positions.set(id, { x, y });
      x += size.width + nodeSep;
    }
  }
}

/**
 * Layered compact layout from `rootId`.
 * Children hug their parent’s center; gaps only appear to prevent overlap.
 */
export function layoutCompactTree(
  opts: CompactTreeLayoutOptions,
): Map<string, { x: number; y: number }> {
  const nodeSep = opts.nodeSep ?? 24;
  const rankSep = opts.rankSep ?? 64;
  const { rootId, children, nodeSize } = opts;

  const parentOf = new Map<string, string>();
  for (const [p, kids] of children) {
    for (const k of kids) parentOf.set(k, p);
  }

  const depth = new Map<string, number>();
  const queue = [rootId];
  depth.set(rootId, 0);
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi]!;
    const d = depth.get(id)!;
    for (const kid of children.get(id) ?? []) {
      if (depth.has(kid)) continue;
      depth.set(kid, d + 1);
      queue.push(kid);
    }
  }

  const byDepth = new Map<number, string[]>();
  for (const id of queue) {
    const d = depth.get(id)!;
    const list = byDepth.get(d);
    if (list) list.push(id);
    else byDepth.set(d, [id]);
  }

  const rootSize = nodeSize(rootId);
  const positions = new Map<string, { x: number; y: number }>();
  positions.set(rootId, { x: 0, y: 0 });

  const maxDepth = Math.max(0, ...depth.values());
  for (let d = 1; d <= maxDepth; d++) {
    const ids = byDepth.get(d) ?? [];
    const y = d * (rootSize.height + rankSep);
    placeRankCenteredUnderParents(
      ids,
      y,
      parentOf,
      children,
      positions,
      nodeSize,
      nodeSep,
    );
  }

  normalizeOrigin(positions);
  return positions;
}

/** @deprecated Alias — Compact mode uses {@link layoutCompactTree}. */
export function layoutTidyTree(
  opts: CompactTreeLayoutOptions,
): Map<string, { x: number; y: number }> {
  return layoutCompactTree(opts);
}

/**
 * Invert parent→child tree links into an ordered children map.
 * `orderOf` breaks ties for stable packing.
 */
export function treeChildrenFromParents(
  treeParent: ReadonlyMap<string, string>,
  nodeIds: Iterable<string>,
  orderOf?: (id: string) => string,
): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const id of nodeIds) {
    const parent = treeParent.get(id);
    if (!parent) continue;
    const list = children.get(parent);
    if (list) list.push(id);
    else children.set(parent, [id]);
  }
  for (const [parent, kids] of children) {
    kids.sort((a, b) => {
      const la = orderOf?.(a) ?? a;
      const lb = orderOf?.(b) ?? b;
      const cmp = la.localeCompare(lb);
      return cmp !== 0 ? cmp : a.localeCompare(b);
    });
    children.set(parent, kids);
  }
  return children;
}
