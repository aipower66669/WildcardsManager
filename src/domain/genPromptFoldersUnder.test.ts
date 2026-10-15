import { describe, expect, it } from 'vitest';
import {
  genPromptFoldersUnder,
  normalizePromptFolderRel,
} from './genPromptFoldersUnder.js';

describe('normalizePromptFolderRel', () => {
  it('trims slashes and normalizes separators', () => {
    expect(normalizePromptFolderRel('  a\\b/c/  ')).toBe('a/b/c');
  });
});

describe('genPromptFoldersUnder', () => {
  const all = ['root', 'root/child', 'root/child/deep', 'other', 'other/x'];

  it('returns all folders when parent is empty', () => {
    expect(genPromptFoldersUnder(all, '')).toEqual(all);
    expect(genPromptFoldersUnder(all, '   ')).toEqual(all);
  });

  it('includes the parent and its descendants only', () => {
    expect(genPromptFoldersUnder(all, 'root')).toEqual([
      'root',
      'root/child',
      'root/child/deep',
    ]);
    expect(genPromptFoldersUnder(all, 'root/child')).toEqual([
      'root/child',
      'root/child/deep',
    ]);
  });

  it('does not match a prefix that is only a path segment start', () => {
    expect(genPromptFoldersUnder(['foo', 'foobar', 'foo/bar'], 'foo')).toEqual([
      'foo',
      'foo/bar',
    ]);
  });
});
