/**
 * Sibling-balance colour score for Monte Carlo simulation overlays.
 *
 * Within each parent→children group, score = parentShare / max(sibling shares),
 * where parentShare is how often that child is selected when the parent expands.
 * Equal siblings → all 1 (green). A rare sibling next to common ones → near 0 (red).
 * Nodes that appear under multiple parents take the worst (minimum) score.
 */

export type BalanceEdge = { from: string; to: string };

export type BalanceNode = {
  id: string;
  /** File/wildcard key used to look up simulation edge shares. */
  key: string;
};

export type ParentShareEdge = {
  parentKey: string;
  childKey: string;
  /** Share of parent selections that chose this child (can exceed 1). */
  parentShare: number;
};

/**
 * @returns Map of node id → balance score in [0, 1].
 * Root (and any node with no siblings) → 1.
 */
export function siblingBalanceScores(
  nodes: BalanceNode[],
  edges: BalanceEdge[],
  parentShares: ParentShareEdge[],
  rootId: string,
): Map<string, number> {
  const keyById = new Map(nodes.map((n) => [n.id, n.key] as const));
  const shareByPair = new Map<string, number>();
  for (const e of parentShares) {
    shareByPair.set(`${e.parentKey}\0${e.childKey}`, e.parentShare);
  }

  const children = new Map<string, string[]>();
  for (const edge of edges) {
    const arr = children.get(edge.from);
    if (arr) {
      if (!arr.includes(edge.to)) arr.push(edge.to);
    } else {
      children.set(edge.from, [edge.to]);
    }
  }

  const scores = new Map<string, number>();
  scores.set(rootId, 1);

  for (const [parentId, kids] of children) {
    if (kids.length === 0) continue;
    const parentKey = keyById.get(parentId) ?? parentId;
    const rates = kids.map((id) => {
      const childKey = keyById.get(id) ?? id;
      return {
        id,
        rate: shareByPair.get(`${parentKey}\0${childKey}`) ?? 0,
      };
    });
    const max = Math.max(...rates.map((r) => r.rate), 0);
    for (const { id, rate } of rates) {
      if (id === rootId) continue;
      const score = max <= 0 ? 0 : rate / max;
      const prev = scores.get(id);
      scores.set(id, prev === undefined ? score : Math.min(prev, score));
    }
  }

  for (const node of nodes) {
    if (!scores.has(node.id)) scores.set(node.id, 1);
  }

  return scores;
}

/** Look up parentShare for a graph parent→child pair (by file keys). */
export function parentShareOf(
  parentShares: ParentShareEdge[],
  parentKey: string,
  childKey: string,
): number | undefined {
  const hit = parentShares.find(
    (e) => e.parentKey === parentKey && e.childKey === childKey,
  );
  return hit?.parentShare;
}
