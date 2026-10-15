import { describe, expect, it } from 'vitest';
import {
  buildFileReferenceGraph,
  collectFileNodeIssues,
  findCyclicComponents,
  validateAllLibraryFiles,
} from './libraryValidation.js';
import { buildLibraryIndex } from './resolveWildcard.js';
import type { LibraryFile } from './types.js';

function file(key: string, text: string): LibraryFile {
  return {
    relativePath: `${key}.txt`,
    absolutePath: `/lib/${key}.txt`,
    name: `${key}.txt`,
    ext: '.txt',
    key,
    text,
  };
}

describe('libraryValidation', () => {
  it('collects missing-file issues from a wildcard', () => {
    const files = [file('root', '__missing__\n')];
    const index = buildLibraryIndex(files);
    const issues = collectFileNodeIssues(files[0]!, index, 'comfyui', null);
    expect(issues.some((i) => i.code === 'missing_file')).toBe(true);
  });

  it('detects a two-file cycle', () => {
    const files = [
      file('a', '__b__\n'),
      file('b', '__a__\n'),
    ];
    const graph = buildFileReferenceGraph(files, 'comfyui');
    const comps = findCyclicComponents(graph);
    expect(comps).toHaveLength(1);
    expect(comps[0]!.sort()).toEqual(['a', 'b']);
  });

  it('validateAllLibraryFiles attributes cycles to both files', () => {
    const files = [
      file('a', '__b__\n'),
      file('b', '__a__\n'),
      file('ok', 'plain text\n'),
    ];
    const results = validateAllLibraryFiles(files, 'comfyui', null);
    const byKey = new Map(results.map((r) => [r.key, r]));
    expect(byKey.get('a')!.errorCount).toBeGreaterThan(0);
    expect(byKey.get('b')!.errorCount).toBeGreaterThan(0);
    expect(byKey.get('ok')!.errorCount).toBe(0);
    expect(byKey.get('a')!.issues.some((i) => i.code === 'cycle')).toBe(true);
  });
});
