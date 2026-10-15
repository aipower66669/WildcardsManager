import { describe, expect, it } from 'vitest';
import { validateGenPromptFiles } from './genPromptValidation.js';
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

describe('validateGenPromptFiles', () => {
  it('flags a !gen.txt line that calls a missing wildcard', () => {
    const [result] = validateGenPromptFiles(
      [{ relativeFolder: 'portraits', text: 'a __missing-style__ portrait\n' }],
      [file('hats', 'beanie\n')],
      'comfyui',
      null,
    );
    expect(result?.relativePath).toBe('portraits/!gen.txt');
    expect(result?.errorCount).toBeGreaterThan(0);
    expect(result?.issues.some((issue) => issue.code === 'missing_file')).toBe(
      true,
    );
  });

  it('accepts a wildcard that exists in the library', () => {
    const [result] = validateGenPromptFiles(
      [{ relativeFolder: 'portraits', text: 'a __hats__ portrait\n' }],
      [file('hats', 'beanie\n')],
      'comfyui',
      null,
    );
    expect(result?.issues.some((issue) => issue.code === 'missing_file')).toBe(
      false,
    );
    expect(result?.errorCount).toBe(0);
  });

  it('flags the same syntax errors on an unsaved draft body', () => {
    const [result] = validateGenPromptFiles(
      [{ relativeFolder: '', text: 'a {red|green portrait\n' }],
      [file('hats', 'beanie\n')],
      'comfyui',
      null,
    );
    expect(result?.relativePath).toBe('!gen.txt');
    expect(result?.issues.some((issue) => issue.code === 'unbalanced_brace')).toBe(
      true,
    );
  });
});
