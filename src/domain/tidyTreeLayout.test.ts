import { describe, expect, it } from 'vitest';
import {
  compactRankGaps,
  layoutCompactTree,
  treeChildrenFromParents,
} from './tidyTreeLayout.js';

describe('layoutCompactTree', () => {
  it('packs same-rank siblings with only nodeSep gaps', () => {
    const children = new Map<string, string[]>([
      ['root', ['a', 'b', 'c']],
    ]);
    const size = () => ({ width: 100, height: 40 });
    const pos = layoutCompactTree({
      rootId: 'root',
      children,
      nodeSize: size,
      nodeSep: 20,
      rankSep: 50,
    });

    expect(pos.get('a')!.y).toBe(pos.get('b')!.y);
    const span = pos.get('c')!.x + 100 - pos.get('a')!.x;
    expect(span).toBe(340);
  });

  it('centers a wide child row under its parent (no right lean)', () => {
    const children = new Map<string, string[]>([
      ['root', ['hub']],
      ['hub', ['a', 'b', 'c', 'd']],
    ]);
    const size = () => ({ width: 80, height: 40 });
    const pos = layoutCompactTree({
      rootId: 'root',
      children,
      nodeSize: size,
      nodeSep: 16,
      rankSep: 40,
    });

    const hub = pos.get('hub')!;
    const a = pos.get('a')!;
    const d = pos.get('d')!;
    const hubCenter = hub.x + 40;
    const kidsMid = (a.x + d.x + 80) / 2;
    expect(kidsMid).toBeCloseTo(hubCenter, 5);
    // Root should sit above the hub, not off to the left of a right-leaning fan.
    const root = pos.get('root')!;
    expect(root.x + 40).toBeCloseTo(hubCenter, 5);
  });

  it('keeps a shallow sibling beside a deep one without a huge corridor', () => {
    const children = new Map<string, string[]>([
      ['root', ['left', 'right']],
      ['right', ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']],
    ]);
    const size = () => ({ width: 80, height: 40 });
    const pos = layoutCompactTree({
      rootId: 'root',
      children,
      nodeSize: size,
      nodeSep: 24,
      rankSep: 40,
    });

    const left = pos.get('left')!;
    const right = pos.get('right')!;
    expect(left.y).toBe(right.y);
    const gap = right.x - (left.x + 80);
    expect(gap).toBe(24);
  });
});

describe('compactRankGaps', () => {
  it('closes oversized gaps on a rank', () => {
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 500, y: 0 }],
    ]);
    const dims = new Map([
      ['a', { width: 100, height: 40 }],
      ['b', { width: 100, height: 40 }],
    ]);
    compactRankGaps(positions, dims, 20);
    expect(positions.get('b')!.x).toBe(120);
  });
});

describe('treeChildrenFromParents', () => {
  it('inverts parent links and sorts by label', () => {
    const treeParent = new Map([
      ['b', 'root'],
      ['a', 'root'],
    ]);
    const kids = treeChildrenFromParents(treeParent, ['root', 'a', 'b'], (id) =>
      id === 'a' ? 'Alpha' : id === 'b' ? 'Beta' : id,
    );
    expect(kids.get('root')).toEqual(['a', 'b']);
  });
});
