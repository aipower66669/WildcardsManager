import { describe, expect, it } from 'vitest';
import {
  classifyModelWalkName,
  defaultWeightExtensionSet,
} from './modelWalkName.js';

describe('classifyModelWalkName', () => {
  const weights = defaultWeightExtensionSet();

  it('treats model weights as files without a stat', () => {
    expect(classifyModelWalkName('a.safetensors', weights)).toBe('weight');
    expect(classifyModelWalkName('a.ckpt', weights)).toBe('weight');
    expect(classifyModelWalkName('a.pt', weights)).toBe('weight');
    expect(classifyModelWalkName('a.gguf', weights)).toBe('weight');
  });

  it('skips previews and text sidecars by extension', () => {
    expect(classifyModelWalkName('a.png', weights)).toBe('skip');
    expect(classifyModelWalkName('a.preview.png', weights)).toBe('skip');
    expect(classifyModelWalkName('a.txt', weights)).toBe('skip');
    expect(classifyModelWalkName('a.json', weights)).toBe('skip');
    expect(classifyModelWalkName('.hidden.safetensors', weights)).toBe('skip');
  });

  it('probes extensionless names and dotted folder names', () => {
    expect(classifyModelWalkName('Characters', weights)).toBe('probe');
    expect(classifyModelWalkName('v1.0', weights)).toBe('probe');
  });
});
