import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_LEVELS,
  buildAdjacency,
  estimateUncappedVisibleCount,
  selectFocusedGraphSlice,
} from './graphView.js';

function starGraph(childCount: number) {
  const edges = Array.from({ length: childCount }, (_, i) => ({
    from: 'root',
    to: `c${String(i).padStart(3, '0')}`,
  }));
  return buildAdjacency(edges);
}

describe('selectFocusedGraphSlice', () => {
  it('includes ancestors and depth-capped descendants', () => {
    const adjacency = buildAdjacency([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
      { from: 'd', to: 'e' },
    ]);
    const slice = selectFocusedGraphSlice(adjacency, {
      focusId: 'b',
      maxLevels: 2,
    });
    expect([...slice.ancLevel.keys()].sort()).toEqual(['a', 'b']);
    expect(slice.descLevel.get('c')).toBe(1);
    expect(slice.descLevel.get('d')).toBe(2);
    expect(slice.descLevel.has('e')).toBe(false);
    expect(slice.truncated.get('d')).toBe(1);
    expect(slice.depthLimited).toBe(true);
  });

  it('caps children per parent with a sibling +N more frontier', () => {
    const adjacency = starGraph(100);
    const slice = selectFocusedGraphSlice(adjacency, {
      focusId: 'root',
      maxLevels: 4,
      maxChildrenPerParent: 40,
      maxVisibleNodes: 250,
    });
    expect(slice.visibleIds.size).toBe(41); // root + 40 children
    expect(slice.truncated.get('root')).toBe(60);
    expect(slice.breadthLimited).toBe(true);
    expect(slice.visibleIds.has('c000')).toBe(true);
    expect(slice.visibleIds.has('c039')).toBe(true);
    expect(slice.visibleIds.has('c040')).toBe(false);
  });

  it('caps total visible nodes across deep fan-out', () => {
    const edges: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < 30; i++) {
      edges.push({ from: 'root', to: `a${i}` });
      for (let j = 0; j < 20; j++) {
        edges.push({ from: `a${i}`, to: `a${i}-b${j}` });
      }
    }
    const adjacency = buildAdjacency(edges);
    const slice = selectFocusedGraphSlice(adjacency, {
      focusId: 'root',
      maxLevels: 4,
      maxChildrenPerParent: 40,
      maxVisibleNodes: 80,
    });
    expect(slice.visibleIds.size).toBeLessThanOrEqual(80);
    expect(slice.breadthLimited).toBe(true);
  });

  it('keeps alphabetically earlier children when breadth-capped', () => {
    const adjacency = buildAdjacency([
      { from: 'root', to: 'zeta' },
      { from: 'root', to: 'alpha' },
      { from: 'root', to: 'middle' },
    ]);
    const slice = selectFocusedGraphSlice(adjacency, {
      focusId: 'root',
      maxChildrenPerParent: 2,
      labelOf: (id) => id,
    });
    expect([...slice.descLevel.keys()].filter((id) => id !== 'root').sort()).toEqual([
      'alpha',
      'middle',
    ]);
    expect(slice.truncated.get('root')).toBe(1);
  });
});

describe('estimateUncappedVisibleCount', () => {
  it('counts the full uncapped cone for wide-root detection', () => {
    const adjacency = starGraph(500);
    expect(
      estimateUncappedVisibleCount(adjacency, 'root', DEFAULT_MAX_LEVELS),
    ).toBe(501);
  });
});
