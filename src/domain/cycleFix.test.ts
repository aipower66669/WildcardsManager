import { describe, expect, it } from 'vitest';
import { analyzeWildcardTree } from './analyze.js';
import {
  buildCycleGroups,
  planCycleFixFromIssue,
  removeReferenceAt,
} from './cycleFix.js';
import type { LibraryFile } from './types.js';

function file(key: string, text: string): LibraryFile {
  return {
    relativePath: `${key}.txt`,
    absolutePath: `/lib/${key}.txt`,
    name: `${key.split('/').pop()}.txt`,
    ext: '.txt',
    key,
    text,
  };
}

describe('removeReferenceAt', () => {
  it('removes a whole standalone reference line', () => {
    const { text, mode, ok } = removeReferenceAt(
      'keep\n__loop__\nkeep2\n',
      2,
      1,
      '__loop__',
    );
    expect(ok).toBe(true);
    expect(mode).toBe('line');
    expect(text).toBe('keep\nkeep2\n');
  });

  it('removes an embedded token and keeps the rest of the line', () => {
    const { text, mode, ok } = removeReferenceAt(
      'hello __loop__ world',
      1,
      7,
      '__loop__',
    );
    expect(ok).toBe(true);
    expect(mode).toBe('token');
    expect(text).toBe('hello  world');
  });
});

describe('cycle resolver planning', () => {
  it('ranks a self-loop removal as a top suggestion', () => {
    const files = [file('loop', 'hello __loop__')];
    const analysis = analyzeWildcardTree({
      rootRelativePath: 'loop.txt',
      files,
    });
    const cycleIssue = analysis.issues.find((i) => i.code === 'cycle');
    expect(cycleIssue).toBeTruthy();

    const plan = planCycleFixFromIssue(
      files,
      analysis.rootNodeId,
      analysis.edges,
      cycleIssue!,
    );
    expect(plan.canResolve).toBe(true);
    expect(plan.suggestions[0]?.edge.from).toBe('loop');
    expect(plan.suggestions[0]?.edge.to).toBe('loop');
    expect(plan.suggestions[0]?.breaksAllCycles).toBe(true);
    expect(plan.suggestions[0]?.newText).toBe('hello ');
  });

  it('groups a multi-file cycle and prefers a fix that breaks all loops', () => {
    const files = [
      file('a', '__b__'),
      file('b', '__c__'),
      file('c', '__a__'),
    ];
    const analysis = analyzeWildcardTree({
      rootRelativePath: 'a.txt',
      files,
    });
    const groups = buildCycleGroups(analysis.edges);
    expect(groups.length).toBe(1);
    expect(groups[0]!.nodeIds.sort()).toEqual(['a', 'b', 'c']);

    const cycleIssue = analysis.issues.find((i) => i.code === 'cycle');
    const plan = planCycleFixFromIssue(
      files,
      analysis.rootNodeId,
      analysis.edges,
      cycleIssue!,
    );
    expect(plan.canResolve).toBe(true);
    expect(plan.suggestions.length).toBeGreaterThan(0);
    expect(plan.suggestions.some((s) => s.breaksAllCycles)).toBe(true);
    // Best suggestion should break all cycles.
    expect(plan.suggestions[0]!.breaksAllCycles).toBe(true);
  });

  it('prefers removing a redundant back-edge over a unique forward edge', () => {
    // a → b → c → a, and also a → c. Removing c→a breaks the cycle while
    // keeping a→b→c reachable from root.
    const files = [
      file('a', '__b__\n__c__'),
      file('b', '__c__'),
      file('c', '__a__'),
    ];
    const analysis = analyzeWildcardTree({
      rootRelativePath: 'a.txt',
      files,
    });
    const cycleIssue = analysis.issues.find((i) => i.code === 'cycle');
    const plan = planCycleFixFromIssue(
      files,
      analysis.rootNodeId,
      analysis.edges,
      cycleIssue!,
    );
    expect(plan.canResolve).toBe(true);
    const best = plan.suggestions[0]!;
    expect(best.breaksAllCycles).toBe(true);
    // The back-edge c→a is the classic feedback arc.
    expect(best.edge.from).toBe('c');
    expect(best.edge.to).toBe('a');
  });

  it('stays responsive on a dense SCC (no combinatorial path explosion)', () => {
    const n = 28;
    const edges = [];
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        edges.push({
          id: `${i}->${j}`,
          from: `n${i}`,
          to: `n${j}`,
          line: 1,
          snippet: `__n${j}__`,
          isCycle: true,
        });
      }
    }
    const started = Date.now();
    const groups = buildCycleGroups(edges);
    const elapsed = Date.now() - started;
    expect(groups.length).toBe(1);
    expect(groups[0]!.nodeIds).toHaveLength(n);
    expect(groups[0]!.paths.length).toBeGreaterThan(0);
    expect(groups[0]!.paths.length).toBeLessThanOrEqual(8);
    // Unbounded DFS over simple paths in K_28 hangs for minutes; BFS must finish quickly.
    expect(elapsed).toBeLessThan(2_000);
  });
});
