import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generationImageOutputFolder } from './generationOutputRoots.js';

describe('generationImageOutputFolder', () => {
  it('writes into the prompt folder unless New is enabled', () => {
    const root = path.resolve('D:/out');
    expect(generationImageOutputFolder(root, 'portraits/boys', false)).toBe(
      path.resolve(root, 'portraits/boys'),
    );
    expect(generationImageOutputFolder(root, 'portraits/boys', true)).toBe(
      path.resolve(root, 'portraits/boys', 'New'),
    );
  });
});
