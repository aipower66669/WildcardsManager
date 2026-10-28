import { describe, expect, it } from 'vitest';
import { buildLibraryIndex } from './resolveWildcard.js';
import {
  expandPrompts,
  forEachSimulatedPromptLine,
  formatSimulatedLines,
  simulateReach,
} from './expand.js';
import { siblingBalanceScores } from './simulateBalance.js';
import { planRename } from './rename.js';
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

describe('expandPrompts — exhaustive', () => {
  it('expands a simple variant across all options', () => {
    const files = [file('root', 'a {red|green|blue} car')];
    const result = expandPrompts({
      rootRelativePath: 'root.txt',
      files,
      mode: 'exhaustive',
    });
    expect(result.samples.sort()).toEqual(
      ['a blue car', 'a green car', 'a red car'].sort(),
    );
    expect(result.totalCombinations).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('multiplies nested wildcard combinations', () => {
    const files = [
      file('root', '__size__ __color__'),
      file('size', 'small\nbig'),
      file('color', 'red\nblue'),
    ];
    const result = expandPrompts({
      rootRelativePath: 'root.txt',
      files,
      mode: 'exhaustive',
    });
    expect(result.totalCombinations).toBe(4);
    expect(result.samples).toHaveLength(4);
    expect(result.samples).toContain('small red');
    expect(result.samples).toContain('big blue');
  });

  it('honors the limit and reports truncation', () => {
    const files = [file('root', '{a|b|c|d|e}')];
    const result = expandPrompts({
      rootRelativePath: 'root.txt',
      files,
      mode: 'exhaustive',
      limit: 2,
    });
    expect(result.samples).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.totalCombinations).toBe(5);
  });

  it('enumerates multi-select combinations', () => {
    const files = [file('root', '{2$$a|b|c}')];
    const result = expandPrompts({
      rootRelativePath: 'root.txt',
      files,
      mode: 'exhaustive',
    });
    expect(result.samples.sort()).toEqual(['a, b', 'a, c', 'b, c'].sort());
  });

  it('supports a custom multi-select separator', () => {
    const files = [file('root', '{2$$ and $$a|b}')];
    const result = expandPrompts({
      rootRelativePath: 'root.txt',
      files,
      mode: 'exhaustive',
    });
    expect(result.samples).toEqual(['a and b']);
  });

  it('flags missing references but still produces output', () => {
    const files = [file('root', 'x __gone__ y')];
    const result = expandPrompts({
      rootRelativePath: 'root.txt',
      files,
      mode: 'exhaustive',
    });
    expect(result.samples).toEqual(['x __gone__ y']);
    expect(result.issues.some((i) => i.code === 'missing_file')).toBe(true);
  });
});

describe('expandPrompts — random', () => {
  it('keeps every line of one template instead of picking a line', () => {
    const body = 'first paragraph\n\n# keep this line\nsecond paragraph';
    const files = [file('root', 'alpha\nbeta')];
    const result = expandPrompts({
      rootRelativePath: 'root.txt',
      files,
      mode: 'random',
      seed: 1,
      limit: 1,
      countCombinations: false,
      templates: [body],
    });
    expect(result.samples).toEqual([body]);
  });

  it('expands a wildcard inside a multiline template and keeps the other lines', () => {
    const files = [file('root', 'ignored'), file('color', 'red\nblue')];
    const result = expandPrompts({
      rootRelativePath: 'root.txt',
      files,
      mode: 'random',
      seed: 2,
      limit: 1,
      countCombinations: false,
      templates: ['top\n__color__\nbottom'],
    });
    expect(result.samples).toHaveLength(1);
    const sample = result.samples[0] ?? '';
    expect(sample.startsWith('top\n')).toBe(true);
    expect(sample.endsWith('\nbottom')).toBe(true);
    expect(sample === 'top\nred\nbottom' || sample === 'top\nblue\nbottom').toBe(
      true,
    );
  });

  it('expands templates from a prebuilt index without a root file', () => {
    const index = buildLibraryIndex([file('color', 'red')]);
    const result = expandPrompts({
      rootRelativePath: '__wcm_gen_line__.txt',
      files: [],
      index,
      mode: 'random',
      seed: 1,
      limit: 1,
      countCombinations: false,
      templates: ['a __color__ car'],
    });
    expect(result.samples).toEqual(['a red car']);
  });

  it('is deterministic for a fixed seed', () => {
    const files = [
      file('root', '{a|b|c|d} __thing__'),
      file('thing', 'one\ntwo\nthree'),
    ];
    const a = expandPrompts({ rootRelativePath: 'root.txt', files, mode: 'random', seed: 42, limit: 5 });
    const b = expandPrompts({ rootRelativePath: 'root.txt', files, mode: 'random', seed: 42, limit: 5 });
    expect(a.samples).toEqual(b.samples);
    expect(a.seed).toBe(42);
  });

  it('returns one sample without counting the combination space', () => {
    const files = [
      file('root', '{a|b|c} __thing__'),
      file('thing', 'one\ntwo'),
    ];
    const result = expandPrompts({
      rootRelativePath: 'root.txt',
      files,
      mode: 'random',
      seed: 3,
      limit: 1,
      countCombinations: false,
    });
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]?.length).toBeGreaterThan(0);
    expect(result.totalCombinations).toBe(0);
    expect(result.combinationsSaturated).toBe(false);
  });

  it('stops runaway recursion without throwing', () => {
    const files = [file('loop', 'x __loop__')];
    const result = expandPrompts({ rootRelativePath: 'loop.txt', files, mode: 'random', seed: 1, limit: 3 });
    expect(result.samples).toHaveLength(3);
    expect(result.issues.some((i) => i.code === 'cycle')).toBe(true);
  });
});

describe('simulateReach', () => {
  it('reports ~100% reach for an always-selected reference', () => {
    const files = [file('root', 'a __always__ b'), file('always', 'x\ny')];
    const r = simulateReach({
      rootRelativePath: 'root.txt',
      files,
      iterations: 500,
      seed: 7,
    });
    const always = r.stats.find((s) => s.key === 'always');
    expect(always?.reachRate).toBe(1);
  });

  it('splits reach across a top-level choice roughly evenly', () => {
    const files = [
      file('root', '{__left__|__right__}'),
      file('left', 'a'),
      file('right', 'b'),
    ];
    const r = simulateReach({
      rootRelativePath: 'root.txt',
      files,
      iterations: 4000,
      seed: 3,
    });
    const left = r.stats.find((s) => s.key === 'left')?.reachRate ?? 0;
    const right = r.stats.find((s) => s.key === 'right')?.reachRate ?? 0;
    expect(left).toBeGreaterThan(0.35);
    expect(left).toBeLessThan(0.65);
    expect(left + right).toBeGreaterThan(0.98);
  });

  it('flags a rarely reached deep path with a low reach rate', () => {
    const lines = Array.from({ length: 20 }, (_, i) =>
      i === 0 ? '__rare__' : `plain-${i}`,
    ).join('\n');
    const files = [
      file('root', '__pool__'),
      file('pool', lines),
      file('rare', 'gold'),
    ];
    const r = simulateReach({
      rootRelativePath: 'root.txt',
      files,
      iterations: 4000,
      seed: 11,
    });
    const rare = r.stats.find((s) => s.key === 'rare')?.reachRate ?? 0;
    expect(rare).toBeGreaterThan(0.01);
    expect(rare).toBeLessThan(0.12);
  });

  it('is deterministic for a fixed seed', () => {
    const files = [file('root', '{a|__x__|__y__}'), file('x', '1'), file('y', '2')];
    const a = simulateReach({ rootRelativePath: 'root.txt', files, iterations: 300, seed: 99 });
    const b = simulateReach({ rootRelativePath: 'root.txt', files, iterations: 300, seed: 99 });
    expect(a.stats).toEqual(b.stats);
  });

  it('counts the root as 100% reach', () => {
    const files = [file('root', '__child__'), file('child', 'x')];
    const r = simulateReach({
      rootRelativePath: 'root.txt',
      files,
      iterations: 50,
      seed: 1,
    });
    expect(r.stats.find((s) => s.key === 'root')?.reachRate).toBe(1);
  });

  it('attributes glob matches through the intermediate glob node', () => {
    const files = [
      file('root', '__artists/*__'),
      file('artists/ink', 'ink'),
      file('artists/paint', 'paint'),
      file('artists/photo', 'photo'),
    ];
    const r = simulateReach({
      rootRelativePath: 'root.txt',
      files,
      iterations: 3000,
      seed: 5,
    });
    const globId = 'glob:artists/*';
    expect(r.stats.find((s) => s.key === globId)?.reachRate).toBe(1);
    const edgeShares = ['artists/ink', 'artists/paint', 'artists/photo'].map(
      (child) =>
        r.edges.find((e) => e.parentKey === globId && e.childKey === child)
          ?.parentShare ?? 0,
    );
    for (const share of edgeShares) {
      expect(share).toBeGreaterThan(0.2);
      expect(share).toBeLessThan(0.45);
    }
    expect(edgeShares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
  });
});

describe('siblingBalanceScores', () => {
  it('marks equal siblings as fully balanced (green)', () => {
    const scores = siblingBalanceScores(
      [
        { id: 'root', key: 'root' },
        { id: 'a', key: 'a' },
        { id: 'b', key: 'b' },
        { id: 'c', key: 'c' },
      ],
      [
        { from: 'root', to: 'a' },
        { from: 'root', to: 'b' },
        { from: 'root', to: 'c' },
      ],
      [
        { parentKey: 'root', childKey: 'a', parentShare: 0.33 },
        { parentKey: 'root', childKey: 'b', parentShare: 0.33 },
        { parentKey: 'root', childKey: 'c', parentShare: 0.34 },
      ],
      'root',
    );
    expect(scores.get('a')).toBeCloseTo(0.33 / 0.34, 5);
    expect(scores.get('b')).toBeCloseTo(0.33 / 0.34, 5);
    expect(scores.get('c')).toBe(1);
    expect(scores.get('root')).toBe(1);
  });

  it('flags the rare sibling as red while common ones stay near green', () => {
    const scores = siblingBalanceScores(
      [
        { id: 'root', key: 'root' },
        { id: 'hot', key: 'hot' },
        { id: 'warm', key: 'warm' },
        { id: 'cold', key: 'cold' },
      ],
      [
        { from: 'root', to: 'hot' },
        { from: 'root', to: 'warm' },
        { from: 'root', to: 'cold' },
      ],
      [
        { parentKey: 'root', childKey: 'hot', parentShare: 0.5 },
        { parentKey: 'root', childKey: 'warm', parentShare: 0.45 },
        { parentKey: 'root', childKey: 'cold', parentShare: 0.05 },
      ],
      'root',
    );
    expect(scores.get('hot')).toBe(1);
    expect(scores.get('warm')).toBeCloseTo(0.9, 5);
    expect(scores.get('cold')).toBeCloseTo(0.1, 5);
  });
});

describe('simulated prompt lines', () => {
  it('matches the choices counted by simulateReach and separates runs with a blank line', () => {
    const files = [
      file('root', '{__left__|__right__}'),
      file('left', 'LEFT'),
      file('right', 'RIGHT'),
    ];
    const iterations = 200;
    const seed = 3;
    const sim = simulateReach({
      rootRelativePath: 'root.txt',
      files,
      iterations,
      seed,
    });
    const lines: string[] = [];
    const meta = forEachSimulatedPromptLine(
      { rootRelativePath: 'root.txt', files, iterations, seed },
      (line) => lines.push(line),
    );
    expect(meta.found).toBe(true);
    expect(meta.lineCount).toBe(iterations);
    expect(lines.filter((line) => line === 'LEFT')).toHaveLength(
      sim.stats.find((stat) => stat.key === 'left')?.hits ?? -1,
    );
    expect(lines.filter((line) => line === 'RIGHT')).toHaveLength(
      sim.stats.find((stat) => stat.key === 'right')?.hits ?? -1,
    );
    expect(formatSimulatedLines(lines.slice(0, 2))).toBe(
      `${lines[0]}\n\n${lines[1]}\n`,
    );
  });
});

describe('simulateReach — parent shares', () => {
  it('reports child share relative to the parent, not the root', () => {
    // Root hits gate on only 1 of 10 lines (~10%). Gate then picks rare ~50% of the time.
    // Absolute reach of rare ≈ 5%, but parentShare(gate→rare) ≈ 50%.
    const rootLines = [
      '__gate__',
      ...Array.from({ length: 9 }, (_, i) => `plain-${i}`),
    ].join('\n');
    const files = [
      file('root', rootLines),
      file('gate', '{__rare__|noop}'),
      file('rare', 'gold'),
    ];
    const r = simulateReach({
      rootRelativePath: 'root.txt',
      files,
      iterations: 5000,
      seed: 5,
    });
    const edge = r.edges.find(
      (e) => e.parentKey === 'gate' && e.childKey === 'rare',
    );
    const rareAbs = r.stats.find((s) => s.key === 'rare')?.reachRate ?? 0;
    expect(edge).toBeTruthy();
    expect(edge!.parentShare).toBeGreaterThan(0.35);
    expect(edge!.parentShare).toBeLessThan(0.65);
    expect(rareAbs).toBeLessThan(0.12);
    expect(edge!.parentShare).toBeGreaterThan(rareAbs * 3);
  });
});

describe('planRename', () => {
  const files = [
    file('old-name', 'alpha\nbeta'),
    file('caller', 'uses __old-name__ twice: __old-name__'),
    file('other', 'nothing'),
  ];

  it('rewrites references and moves the file', () => {
    const plan = planRename(files, 'old-name.txt', 'new/name');
    expect(plan.canRename).toBe(true);
    expect(plan.newRelativePath).toBe('new/name.txt');
    expect(plan.totalOccurrences).toBe(2);
    expect(plan.edits[0]!.newText).toBe('uses __new/name__ twice: __new/name__');
  });

  it('rejects a name collision', () => {
    const plan = planRename(files, 'old-name.txt', 'other');
    expect(plan.canRename).toBe(false);
    expect(plan.reason).toMatch(/already exists/i);
  });

  it('rejects invalid characters', () => {
    const plan = planRename(files, 'old-name.txt', 'bad*name');
    expect(plan.canRename).toBe(false);
  });
});
