import { describe, expect, it } from 'vitest';
import { analyzeWildcardTree } from './analyze.js';
import {
  hasNoValidationMarker,
  HONOR_NO_VALIDATION_MARKER,
  graphRelationshipFingerprint,
  localWildcardSyntaxIssues,
  mergeLocalSyntaxIssues,
  parseFileContent,
  parseLine,
} from './parseRefs.js';
import {
  validateVariantSyntax,
  validateVariantSyntaxAcrossLines,
} from './parseVariants.js';
import { globToRegExp, resolveWildcard, buildLibraryIndex } from './resolveWildcard.js';
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

describe('parseLine', () => {
  it('extracts nested wildcard refs', () => {
    const result = parseLine('A __clothing/hats__ and __colors__', 1);
    expect(result.refs.map((r) => r.name)).toEqual(['clothing/hats', 'colors']);
  });

  it('flags unclosed wildcards', () => {
    const result = parseLine('broken __colors', 3);
    expect(result.issues.some((i) => i.code === 'unclosed_wildcard')).toBe(true);
  });

  it('ignores comment lines', () => {
    const result = parseLine('# __ignored__', 1);
    expect(result.isComment).toBe(true);
    expect(result.refs).toHaveLength(0);
  });
});

describe('graphRelationshipFingerprint', () => {
  it('is stable for prose-only edits and changes when refs change', () => {
    const base = 'hello __a__ and __b__\n';
    expect(graphRelationshipFingerprint(base)).toBe(
      graphRelationshipFingerprint('hello __a__ and __b__\nmore prose\n'),
    );
    expect(graphRelationshipFingerprint(base)).toBe(
      graphRelationshipFingerprint('__b__\n__a__\n'),
    );
    expect(graphRelationshipFingerprint(base)).not.toBe(
      graphRelationshipFingerprint('hello __a__ and __c__\n'),
    );
    expect(graphRelationshipFingerprint('# __a__\n')).toBe('');
  });
});

describe('parseFileContent empty_file', () => {
  it('flags comment-only and blank files', () => {
    const result = parseFileContent('# only\n\n# still\n', 'stub', '/stub.txt');
    expect(result.issues.some((i) => i.code === 'empty_file')).toBe(true);
  });

  it('does not flag files with any active line', () => {
    const result = parseFileContent('# header\nbeanie\n', 'hats', '/hats.txt');
    expect(result.issues.some((i) => i.code === 'empty_file')).toBe(false);
  });
});

describe('NO VALIDATION marker', () => {
  it('detects the first-line marker case-insensitively', () => {
    expect(hasNoValidationMarker('# NO VALIDATION\nbroken {')).toBe(true);
    expect(hasNoValidationMarker('# no validation — intentional\nx')).toBe(true);
    expect(hasNoValidationMarker('# note\n# NO VALIDATION\nx')).toBe(false);
    expect(hasNoValidationMarker('plain\n# NO VALIDATION')).toBe(false);
  });

  it('still extracts refs from marked files', () => {
    const result = parseFileContent(
      '# NO VALIDATION\nbroken {a|b\n__gone__ and __ok__\n',
      'messy',
      '/messy.txt',
    );
    expect(result.refs.map((r) => r.name)).toEqual(['gone', 'ok']);
  });

  it.skipIf(!HONOR_NO_VALIDATION_MARKER)(
    'skips syntax issues when the marker is honored',
    () => {
      const result = parseFileContent(
        '# NO VALIDATION\nbroken {a|b\n__gone__ and __ok__\n',
        'messy',
        '/messy.txt',
      );
      expect(result.issues).toEqual([]);
    },
  );

  it.skipIf(HONOR_NO_VALIDATION_MARKER)(
    'still reports syntax when the marker is temporarily ignored',
    () => {
      const result = parseFileContent(
        '# NO VALIDATION\nbroken {a|b\n__gone__ and __ok__\n',
        'messy',
        '/messy.txt',
      );
      expect(result.issues.some((i) => i.code === 'unbalanced_brace')).toBe(true);
    },
  );

  it.skipIf(!HONOR_NO_VALIDATION_MARKER)(
    'keeps no-validation files and their real children but drops missing refs',
    () => {
      const files = [
        file('root', '__messy__\n__ok__'),
        file(
          'messy',
          '# NO VALIDATION\nbroken {a|b\n__missing_from_messy__\n__ok__',
        ),
        file('ok', 'fine'),
      ];
      const result = analyzeWildcardTree({
        rootRelativePath: 'root.txt',
        files,
      });
      const nodeIds = result.nodes.map((n) => n.id);
      expect(nodeIds).toEqual(expect.arrayContaining(['root', 'messy', 'ok']));
      expect(nodeIds).not.toContain('missing:missing_from_messy');
      expect(result.issues).toEqual([]);
      expect(result.stats.missingCount).toBe(0);
      expect(result.nodes.find((n) => n.id === 'messy')?.issues).toEqual([]);
    },
  );

  it('still validates callers that are not marked', () => {
    const files = [
      file('root', '__gone__'),
      file('messy', '# NO VALIDATION\n{a|b'),
    ];
    const result = analyzeWildcardTree({
      rootRelativePath: 'root.txt',
      files,
    });
    expect(result.issues.some((i) => i.code === 'missing_file')).toBe(true);
  });
});

describe('validateVariantSyntax', () => {
  it('flags unbalanced braces', () => {
    const issues = validateVariantSyntax('{a|b', 1);
    expect(issues.some((i) => i.code === 'unbalanced_brace')).toBe(true);
  });

  it('flags the Dynamic Prompts unclosed fragment from generation errors', () => {
    const issues = validateVariantSyntax('foo {| bright colors outfit', 1);
    const hit = issues.find((i) => i.code === 'unbalanced_brace');
    expect(hit).toBeTruthy();
    expect(hit?.snippet).toContain('{| bright colors outfit');
    expect(hit?.message).toContain('{| bright colors outfit');
  });

  it('flags unclosed parentheses and brackets', () => {
    expect(
      validateVariantSyntax('(word:1.2', 1).some((i) => i.code === 'unbalanced_paren'),
    ).toBe(true);
    expect(
      validateVariantSyntax('[soft detail', 1).some(
        (i) => i.code === 'unbalanced_bracket',
      ),
    ).toBe(true);
    expect(
      validateVariantSyntax('"open quote', 1).some(
        (i) => i.code === 'unbalanced_quote',
      ),
    ).toBe(true);
  });

  it('accepts balanced attention and quotes', () => {
    const issues = validateVariantSyntax(
      '(masterpiece:1.2), [soft], "quoted phrase", {a|b}',
      1,
    );
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('ignores parentheses inside __wildcard__ names', () => {
    const issues = validateVariantSyntax('__color(|-basic)__', 1);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('ignores $ and $$ outside braces (LoRA triggers, literals)', () => {
    const samples = [
      'PartiallyOpenPant$',
      '<lora:Unzipped_Pants_krea2_3383430_epoch_11:{0.8|0.9|1|1}> PartiallyOpenPant$',
      '2$$a|b',
    ];
    for (const sample of samples) {
      const issues = validateVariantSyntax(sample, 1);
      expect(
        issues.filter((i) => i.code === 'bad_multiselect'),
        sample,
      ).toEqual([]);
    }
  });

  it('accepts valid multi-select', () => {
    const issues = validateVariantSyntax('{2$$a|b|c}', 1);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('accepts custom multi-select separators (including spaces)', () => {
    const samples = [
      '{2$$ $$red|blue|green|yellow}',
      '{2$$-$$red|blue|green|yellow}',
      '{2$$ and $$red|blue|green|yellow}',
      '{2$$ + $$red|blue|green|yellow}',
      '{1-2$$ and $$a|b|c}',
      // LoRA weight braces on the same line must not confuse $$ counting.
      '<lora:Nude_Selfieleak_v1.1:{0.8|0.9|1|1|1.1}> {1-3$$ and $$private | amateur | low-quality} {|smartphone} photography.',
    ];
    for (const sample of samples) {
      const issues = validateVariantSyntax(sample, 1);
      expect(
        issues.filter(
          (i) => i.severity === 'error' || i.code === 'bad_multiselect',
        ),
        sample,
      ).toEqual([]);
    }
  });

  it('still rejects a spaced range before the first $$', () => {
    const issues = validateVariantSyntax('{2 $$a|b|c}', 1);
    expect(issues.some((i) => i.code === 'bad_multiselect')).toBe(true);
  });
});

describe('localWildcardSyntaxIssues', () => {
  it('clears an unbalanced brace after the user fixes it', () => {
    const key = 'outfit';
    const broken = localWildcardSyntaxIssues('red {hat\n', key);
    expect(broken.some((i) => i.code === 'unbalanced_brace')).toBe(true);
    const fixed = localWildcardSyntaxIssues('red hat\n', key);
    expect(fixed.some((i) => i.code === 'unbalanced_brace')).toBe(false);
    const merged = mergeLocalSyntaxIssues(
      [
        ...broken,
        { severity: 'warning' as const, code: 'missing_lora' as const, message: 'keep' },
      ],
      fixed,
    );
    expect(merged.some((i) => i.code === 'unbalanced_brace')).toBe(false);
    expect(merged.some((i) => i.code === 'missing_lora')).toBe(true);
  });

  it('flags a non-numeric LoRA weight token', () => {
    const issues = localWildcardSyntaxIssues(
      '<lora:Natural:{0.8|0.9|1|1|df}>',
      'outfit',
    );
    expect(issues.some((i) => i.code === 'invalid_lora')).toBe(true);
    expect(issues.some((i) => i.message.includes('`df`'))).toBe(true);
  });
});

describe('validateVariantSyntaxAcrossLines', () => {
  it('joins continuation lines until braces balance', () => {
    const lines = ['# header', '{a|b', '|c|d}', '', 'plain'];
    const issues = validateVariantSyntaxAcrossLines(lines);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('stops joining at a blank line and reports the unclosed span', () => {
    const lines = ['{a|b', '', '|c}'];
    const issues = validateVariantSyntaxAcrossLines(lines);
    expect(issues.some((i) => i.code === 'unbalanced_brace')).toBe(true);
  });

  it('parseFileContent accepts multi-line prompts with blank separators', () => {
    const result = parseFileContent(
      [
        '# NO VALIDATION',
        '',
        '{red|blue',
        '|green}',
        '',
        'single line {a|b}',
        '',
      ].join('\n'),
      'prompts',
      '/prompts.txt',
    );
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('resolveWildcard', () => {
  const files = [
    file('colors', 'red\nblue'),
    file('clothing/hats', 'beanie\ncap'),
    file('colors-warm', 'red\nyellow'),
    file('colors-cold', 'blue\ngreen'),
  ];
  const index = buildLibraryIndex(files);

  it('resolves nested paths', () => {
    const r = resolveWildcard('clothing/hats', index);
    expect(r.kind).toBe('file');
    expect(r.id).toBe('clothing/hats');
  });

  it('resolves globs', () => {
    const r = resolveWildcard('colors*', index);
    expect(r.kind).toBe('glob');
    expect(r.matchedKeys).toEqual(
      expect.arrayContaining(['colors', 'colors-warm', 'colors-cold']),
    );
  });

  it('reports missing files', () => {
    const r = resolveWildcard('nope', index);
    expect(r.kind).toBe('missing');
    expect(r.issues[0]?.code).toBe('missing_file');
  });
});

describe('globToRegExp', () => {
  it('matches recursive globs', () => {
    const re = globToRegExp('artists/**');
    expect(re.test('artists/a')).toBe(true);
    expect(re.test('artists/nested/b')).toBe(true);
    expect(re.test('other/a')).toBe(false);
  });
});

describe('analyzeWildcardTree', () => {
  it('builds a nested dependency graph', () => {
    const files = [
      file('root', '__people__\nplain'),
      file('people', '__asia__\n__africa__'),
      file('asia', 'Japanese\nKorean'),
      file('africa', 'Namibian\nBasotho'),
    ];
    const result = analyzeWildcardTree({
      rootRelativePath: 'root.txt',
      files,
    });
    expect(result.rootNodeId).toBe('root');
    expect(result.nodes.map((n) => n.id).sort()).toEqual(
      ['africa', 'asia', 'people', 'root'].sort(),
    );
    expect(result.stats.missingCount).toBe(0);
    expect(result.stats.cycleCount).toBe(0);
  });

  it('detects recursive cycles with path stack', () => {
    const files = [
      file('a', '__b__'),
      file('b', '__c__'),
      file('c', '__a__'),
    ];
    const result = analyzeWildcardTree({
      rootRelativePath: 'a.txt',
      files,
    });
    expect(result.stats.cycleCount).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.code === 'cycle')).toBe(true);
  });

  it('flags missing children', () => {
    const files = [file('root', '__missing_child__')];
    const result = analyzeWildcardTree({
      rootRelativePath: 'root.txt',
      files,
    });
    expect(result.stats.missingCount).toBe(1);
    expect(result.issues.some((i) => i.code === 'missing_file')).toBe(true);
  });

  it('self-reference is a cycle', () => {
    const files = [file('loop', 'hello __loop__')];
    const result = analyzeWildcardTree({
      rootRelativePath: 'loop.txt',
      files,
    });
    expect(result.issues.some((i) => i.code === 'cycle')).toBe(true);
  });
});
