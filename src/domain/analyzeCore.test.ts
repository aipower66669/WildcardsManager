import { describe, expect, it } from 'vitest';
import { analyzeCore, isLoraFolderIssue } from './analyzeCore.js';
import type { LibraryFile } from './types.js';

function file(key: string, text: string): LibraryFile {
  return {
    key,
    name: `${key}.txt`,
    ext: '.txt',
    relativePath: `${key}.txt`,
    absolutePath: `/tmp/${key}.txt`,
    text,
  };
}

describe('analyzeCore', () => {
  it('builds a graph without touching a LoRA folder', () => {
    const result = analyzeCore({
      rootRelativePath: 'root.txt',
      files: [
        file('root', '__child__\n'),
        file('child', 'ok\n'),
      ],
      validationPlatform: 'comfyui',
    });
    expect(result.graph.rootNodeId).toBeTruthy();
    expect(result.graph.nodes.length).toBeGreaterThan(0);
    expect(result.graph.issues.some(isLoraFolderIssue)).toBe(false);
  });
});
