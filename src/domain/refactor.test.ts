import { describe, expect, it } from 'vitest';
import { HONOR_NO_VALIDATION_MARKER } from './parseRefs.js';
import {
  computeReferenceStats,
  findDirectCallers,
} from './references.js';
import {
  detectForwarderTarget,
  planAbsorbConsolidation,
  planConsolidation,
  rewriteReferences,
} from './consolidate.js';
import {
  defaultConvertChildKey,
  planConvertToChild,
} from './convertToChild.js';
import {
  planDelete,
  planReferenceCleanup,
  removeReferences,
  removeReferencesByName,
} from './delete.js';
import { buildLibraryIndex } from './resolveWildcard.js';
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

describe('computeReferenceStats', () => {
  const files = [
    file('root', '__people__\n__colors__'),
    file('people', '__asia__'),
    file('asia', 'Japanese\nKorean'),
    file('colors', 'red\nblue'),
    file('orphan', 'unused line'),
  ];

  it('marks roots as files with no parents', () => {
    const stats = computeReferenceStats(files);
    const roots = stats.filter((s) => s.inbound === 0).map((s) => s.key).sort();
    expect(roots).toEqual(['orphan', 'root']);
  });

  it('marks leaves as files that reference nothing', () => {
    const stats = computeReferenceStats(files);
    const leaves = stats.filter((s) => s.outbound === 0).map((s) => s.key).sort();
    expect(leaves).toEqual(['asia', 'colors', 'orphan']);
  });

  it('counts distinct parents and children', () => {
    const stats = computeReferenceStats(files);
    const root = stats.find((s) => s.key === 'root')!;
    expect(root.outbound).toBe(2);
    const asia = stats.find((s) => s.key === 'asia')!;
    expect(asia.inbound).toBe(1);
  });

  it('counts empty, syntax, and unresolved-reference issues per file', () => {
    const stats = computeReferenceStats([
      file('empty', '# comments only'),
      file('broken', '{a|b'),
      file('missing', '__gone__'),
      file('ignored', '# NO VALIDATION\n{a|b\n__also-gone__'),
      file('valid', 'plain text'),
    ]);
    expect(stats.find((s) => s.key === 'empty')?.issueCount).toBeGreaterThan(0);
    expect(stats.find((s) => s.key === 'broken')?.issueCount).toBeGreaterThan(0);
    expect(stats.find((s) => s.key === 'missing')?.issueCount).toBeGreaterThan(0);
    if (HONOR_NO_VALIDATION_MARKER) {
      expect(stats.find((s) => s.key === 'ignored')?.issueCount).toBe(0);
    } else {
      expect(
        stats.find((s) => s.key === 'ignored')?.issueCount,
      ).toBeGreaterThan(0);
    }
    expect(stats.find((s) => s.key === 'valid')?.issueCount).toBe(0);
  });
});

describe('findDirectCallers', () => {
  it('returns distinct direct callers with reference locations', () => {
    const files = [
      file('top', '__middle__ and __middle__'),
      file('other', '__middle__'),
      file('middle', '__leaf__'),
      file('leaf', 'value'),
    ];
    const callers = findDirectCallers(files, 'middle');
    expect(callers.map((caller) => caller.key)).toEqual(['other', 'top']);
    expect(callers.find((caller) => caller.key === 'top')?.line).toBe(1);
    expect(callers.find((caller) => caller.key === 'top')?.snippet).toBe(
      '__middle__',
    );
  });

  it('does not include the target as its own caller', () => {
    const callers = findDirectCallers(
      [file('loop', '__loop__'), file('top', '__loop__')],
      'loop',
    );
    expect(callers.map((caller) => caller.key)).toEqual(['top']);
  });
});

describe('detectForwarderTarget', () => {
  it('detects a single-reference forwarder', () => {
    expect(detectForwarderTarget(file('wcfile', '__wc-next__'))).toBe('wc-next');
  });

  it('ignores comments and blank lines around the reference', () => {
    expect(
      detectForwarderTarget(file('wcfile', '# alias\n\n__wc-next__\n')),
    ).toBe('wc-next');
  });

  it('rejects files with extra content', () => {
    expect(detectForwarderTarget(file('wcfile', '__wc-next__ extra'))).toBeNull();
    expect(detectForwarderTarget(file('wcfile', '__a__\n__b__'))).toBeNull();
    expect(detectForwarderTarget(file('wcfile', 'plain text'))).toBeNull();
  });

  it('rejects glob forwarders', () => {
    expect(detectForwarderTarget(file('wcfile', '__wc-*__'))).toBeNull();
  });
});

describe('rewriteReferences', () => {
  it('replaces exact references and counts them', () => {
    const { text, count } = rewriteReferences(
      'a __wcfile__ and __wcfile__ plus __other__',
      'wcfile',
      'wc-next',
    );
    expect(count).toBe(2);
    expect(text).toBe('a __wc-next__ and __wc-next__ plus __other__');
  });

  it('is case-insensitive on the key but leaves globs alone', () => {
    const { text, count } = rewriteReferences('__WcFile__ __wc*__', 'wcfile', 'wc-next');
    expect(count).toBe(1);
    expect(text).toBe('__wc-next__ __wc*__');
  });
});

describe('planConsolidation', () => {
  const files = [
    file('wcfile', '__wc-next__'),
    file('wc-next', 'alpha\nbeta'),
    file('caller-a', 'prefix __wcfile__ suffix'),
    file('caller-b', '__wcfile__ and __wcfile__'),
    file('unrelated', 'nothing here'),
  ];

  it('plans a forwarder consolidation with edits', () => {
    const plan = planConsolidation(files, 'wcfile.txt');
    expect(plan.canConsolidate).toBe(true);
    expect(plan.targetName).toBe('wc-next');
    expect(plan.targetExists).toBe(true);
    expect(plan.totalOccurrences).toBe(3);
    expect(plan.edits.map((e) => e.key).sort()).toEqual(['caller-a', 'caller-b']);
    const b = plan.edits.find((e) => e.key === 'caller-b')!;
    expect(b.newText).toBe('__wc-next__ and __wc-next__');
  });

  it('refuses non-forwarder files', () => {
    const plan = planConsolidation(files, 'wc-next.txt');
    expect(plan.canConsolidate).toBe(false);
    expect(plan.reason).toMatch(/not a simple forwarder/i);
  });

  it('warns when the target does not exist', () => {
    const orphanFwd = [file('wcfile', '__gone__'), file('caller', '__wcfile__')];
    const plan = planConsolidation(orphanFwd, 'wcfile.txt');
    expect(plan.canConsolidate).toBe(true);
    expect(plan.warnings.some((w) => /does not resolve/i.test(w))).toBe(true);
  });
});

describe('planAbsorbConsolidation', () => {
  const files = [
    file('wcfile', '__wc-next__'),
    file('wc-next', 'alpha\nbeta __wc-next__'),
    file('caller-a', 'prefix __wc-next__ suffix'),
    file('caller-b', '__wcfile__ stays'),
    file('unrelated', 'nothing here'),
  ];

  it('plans absorbing the target under the forwarder name', () => {
    const plan = planAbsorbConsolidation(files, 'wcfile.txt');
    expect(plan.canAbsorb).toBe(true);
    expect(plan.targetKey).toBe('wc-next');
    expect(plan.targetRelativePath).toBe('wc-next.txt');
    expect(plan.absorbedText).toBe('alpha\nbeta __wcfile__');
    expect(plan.edits.map((e) => e.key)).toEqual(['caller-a']);
    expect(plan.edits[0]!.newText).toBe('prefix __wcfile__ suffix');
    // caller-a (1) + rewrite inside absorbed target content (1)
    expect(plan.totalOccurrences).toBe(2);
  });

  it('refuses when the target file is missing', () => {
    const plan = planAbsorbConsolidation(
      [file('wcfile', '__gone__'), file('caller', '__wcfile__')],
      'wcfile.txt',
    );
    expect(plan.canAbsorb).toBe(false);
    expect(plan.reason).toMatch(/does not resolve/i);
  });

  it('refuses non-forwarder files', () => {
    const plan = planAbsorbConsolidation(files, 'wc-next.txt');
    expect(plan.canAbsorb).toBe(false);
  });
});

describe('removeReferences', () => {
  it('strips exact references and counts them', () => {
    const index = buildLibraryIndex([
      file('colors', 'red'),
      file('other', 'x'),
    ]);
    const { text, count } = removeReferences(
      'a __colors__ and __colors__ plus __other__',
      'colors',
      index,
    );
    expect(count).toBe(2);
    expect(text).toBe('a  and  plus __other__');
  });

  it('strips nested YAML/JSON host references', () => {
    const styles: LibraryFile = {
      relativePath: 'collections.yaml',
      absolutePath: '/lib/collections.yaml',
      name: 'collections.yaml',
      ext: '.yaml',
      key: 'collections',
      text: 'styles:\n  painting: oil\n  sketch: pencil',
    };
    const index = buildLibraryIndex([styles, file('caller', '')]);
    const { text, count } = removeReferences(
      '__styles__ and __styles/painting__ keep __other__',
      'collections',
      index,
    );
    expect(count).toBe(2);
    expect(text).toBe(' and  keep __other__');
  });

  it('leaves globs untouched', () => {
    const index = buildLibraryIndex([file('colors', 'red')]);
    const { text, count } = removeReferences(
      '__colors__ __colors*__',
      'colors',
      index,
    );
    expect(count).toBe(1);
    expect(text).toBe(' __colors*__');
  });
});

describe('planDelete', () => {
  const files = [
    file('colors', 'red\nblue'),
    file('caller-a', 'prefix __colors__ suffix'),
    file('caller-b', '__colors__ and __Colors__'),
    file('globber', '__colors*__'),
    file('unrelated', 'nothing here'),
  ];

  it('plans deletion with reference removals', () => {
    const plan = planDelete(files, 'colors.txt');
    expect(plan.canDelete).toBe(true);
    expect(plan.totalOccurrences).toBe(3);
    expect(plan.edits.map((e) => e.key).sort()).toEqual(['caller-a', 'caller-b']);
    expect(plan.edits.find((e) => e.key === 'caller-a')!.newText).toBe(
      'prefix  suffix',
    );
    expect(plan.edits.find((e) => e.key === 'caller-b')!.newText).toBe(
      ' and ',
    );
    expect(plan.warnings.some((w) => /glob/i.test(w))).toBe(true);
  });

  it('allows deleting a file with no inbound references', () => {
    const plan = planDelete(files, 'unrelated.txt');
    expect(plan.canDelete).toBe(true);
    expect(plan.totalOccurrences).toBe(0);
    expect(plan.edits).toEqual([]);
  });

  it('refuses when the source file is missing', () => {
    const plan = planDelete(files, 'gone.txt');
    expect(plan.canDelete).toBe(false);
    expect(plan.reason).toMatch(/not found/i);
  });
});

describe('missing reference cleanup', () => {
  it('removes matching unresolved references case-insensitively', () => {
    const { text, count } = removeReferencesByName(
      '__gone__ and __Gone__ keep __other__',
      'gone',
    );
    expect(count).toBe(2);
    expect(text).toBe(' and  keep __other__');
  });

  it('plans removal across every caller file', () => {
    const plan = planReferenceCleanup(
      [
        file('caller-a', '__gone__ and __other__'),
        file('caller-b', '__GONE__ twice __gone__'),
        file('unrelated', 'nothing here'),
      ],
      'gone',
    );
    expect(plan.canClean).toBe(true);
    expect(plan.totalOccurrences).toBe(3);
    expect(plan.edits.map((edit) => edit.key)).toEqual([
      'caller-a',
      'caller-b',
    ]);
  });

  it('refuses a cleanup with no matching references', () => {
    const plan = planReferenceCleanup([file('caller', '__other__')], 'gone');
    expect(plan.canClean).toBe(false);
    expect(plan.reason).toMatch(/no references/i);
  });
});

describe('planCreateDescendant', () => {
  it('creates an empty child and appends a reference to the parent', async () => {
    const { planCreateDescendant } = await import('./createDescendant.js');
    const plan = planCreateDescendant(
      [file('colors', 'red\nblue\n'), file('root', '__colors__')],
      'colors.txt',
      'colors/extra',
    );
    expect(plan.canCreate).toBe(true);
    expect(plan.childKey).toBe('colors/extra');
    expect(plan.childRelativePath).toBe('colors/extra.txt');
    expect(plan.childText).toBe('');
    expect(plan.parentText).toBe('red\nblue\n__colors/extra__\n');
  });

  it('keeps parent text when the reference line already exists', async () => {
    const { planCreateDescendant } = await import('./createDescendant.js');
    const plan = planCreateDescendant(
      [file('colors', 'red\n__colors-child__\n')],
      'colors.txt',
      'colors-child',
    );
    expect(plan.canCreate).toBe(true);
    expect(plan.parentText).toBe('red\n__colors-child__\n');
    expect(plan.warnings[0]).toMatch(/already contains/i);
  });
});

describe('planConvertToChild', () => {
  it('defaults the child key as a sibling with a -child suffix', () => {
    expect(defaultConvertChildKey('loraname')).toBe('loraname-child');
    expect(defaultConvertChildKey('clothing/hats')).toBe('clothing/hats-child');
    expect(defaultConvertChildKey('colors', '_v2')).toBe('colors_v2');
    expect(defaultConvertChildKey('colors', '   ')).toBe('colors-child');
  });

  it('moves source content into a new child and leaves a forwarder', () => {
    const plan = planConvertToChild(
      [file('colors', 'red\nblue\n'), file('root', '__colors__')],
      'colors.txt',
      'colors-child',
    );
    expect(plan.canConvert).toBe(true);
    expect(plan.childKey).toBe('colors-child');
    expect(plan.childRelativePath).toBe('colors-child.txt');
    expect(plan.sourceText).toBe('red\nblue\n');
    expect(plan.parentText).toBe('__colors-child__\n');
    expect(detectForwarderTarget({
      ...file('colors', plan.parentText),
    })).toBe('colors-child');
  });

  it('blocks collisions and structured hosts', () => {
    const collision = planConvertToChild(
      [file('colors', 'red'), file('colors-child', 'blue')],
      'colors.txt',
      'colors-child',
    );
    expect(collision.canConvert).toBe(false);
    expect(collision.reason).toMatch(/already exists/i);

    const structured = planConvertToChild(
      [
        {
          relativePath: 'data.yaml',
          absolutePath: '/lib/data.yaml',
          name: 'data.yaml',
          ext: '.yaml',
          key: 'data',
          text: 'a: 1\n',
        },
      ],
      'data.yaml',
      'data/child',
    );
    expect(structured.canConvert).toBe(false);
    expect(structured.reason).toMatch(/Structured/i);
  });
});
