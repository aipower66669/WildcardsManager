import { describe, expect, it } from 'vitest';
import {
  hfPreviewUrlFromRepoFiles,
  pickHfPreviewFile,
} from './huggingfacePreview.js';

describe('pickHfPreviewFile', () => {
  it('prefers a cover name over a later showcase file', () => {
    expect(
      pickHfPreviewFile([
        'showcase/release_2.png',
        'media/hero.webp',
        'weights.safetensors',
      ]),
    ).toBe('media/hero.webp');
  });

  it('uses the only image even when it sits under input', () => {
    expect(
      pickHfPreviewFile(['model.safetensors', 'comfyui/input/cat.webp']),
    ).toBe('comfyui/input/cat.webp');
  });

  it('returns null when the repo has no image', () => {
    expect(
      pickHfPreviewFile(['README.md', '.gitattributes', 'model.safetensors']),
    ).toBeNull();
  });
});

describe('hfPreviewUrlFromRepoFiles', () => {
  it('resolves a card thumbnail path and ignores other files', () => {
    expect(
      hfPreviewUrlFromRepoFiles({
        repoId: 'org/name',
        thumbnail: './images/cover.png',
        files: ['showcase/other.png'],
      }),
    ).toBe('https://huggingface.co/org/name/resolve/main/images/cover.png');
  });

  it('keeps an absolute thumbnail URL', () => {
    expect(
      hfPreviewUrlFromRepoFiles({
        repoId: 'org/name',
        thumbnail: 'https://huggingface.co/org/name/resolve/main/a.png',
        files: [],
      }),
    ).toBe('https://huggingface.co/org/name/resolve/main/a.png');
  });

  it('returns null without a thumbnail or image file', () => {
    expect(
      hfPreviewUrlFromRepoFiles({
        repoId: 'org/name',
        files: ['README.md'],
      }),
    ).toBeNull();
  });
});
