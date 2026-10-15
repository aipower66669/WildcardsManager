import { describe, expect, it } from 'vitest';
import { searchGenFiles, searchWildcardFiles } from './globalSearch.js';

describe('searchWildcardFiles', () => {
  const files = [
    {
      relativePath: 'styles/oil.txt',
      name: 'oil.txt',
      text: 'thick paint\nimpressionist brush\n',
    },
    {
      relativePath: 'chars/hero.txt',
      name: 'hero.txt',
      text: 'a brave oil painter\nstanding tall\n',
    },
  ];

  it('matches file names and paths', () => {
    const { nameHits, contentHits } = searchWildcardFiles(files, 'oil');
    expect(nameHits.map((h) => h.relativePath)).toEqual(['styles/oil.txt']);
    expect(contentHits.some((h) => h.relativePath === 'chars/hero.txt')).toBe(
      true,
    );
  });

  it('returns 1-based line numbers and snippets', () => {
    const { contentHits } = searchWildcardFiles(files, 'impressionist');
    expect(contentHits).toEqual([
      {
        kind: 'wildcard-content',
        relativePath: 'styles/oil.txt',
        name: 'oil.txt',
        line: 2,
        snippet: 'impressionist brush',
      },
    ]);
  });

  it('returns empty for blank query', () => {
    expect(searchWildcardFiles(files, '  ')).toEqual({
      nameHits: [],
      contentHits: [],
    });
  });
});

describe('searchGenFiles', () => {
  it('matches a prompt folder path and a !gen.txt line', () => {
    const { nameHits, contentHits } = searchGenFiles(
      [
        {
          relativeFolder: 'portraits/boys',
          text: 'a __hats__ portrait\nplain line\n',
        },
      ],
      'hats',
    );
    expect(nameHits).toEqual([]);
    expect(contentHits).toEqual([
      {
        kind: 'prompt-content',
        relativeFolder: 'portraits/boys',
        relativePath: 'portraits/boys/!gen.txt',
        line: 1,
        snippet: 'a __hats__ portrait',
      },
    ]);
    const byFolder = searchGenFiles(
      [{ relativeFolder: 'portraits/boys', text: 'plain\n' }],
      'boys',
    );
    expect(byFolder.nameHits.map((hit) => hit.relativeFolder)).toEqual([
      'portraits/boys',
    ]);
  });
});
