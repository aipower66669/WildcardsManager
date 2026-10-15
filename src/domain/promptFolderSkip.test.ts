import { describe, expect, it } from 'vitest';
import { isSkippedPromptFolderName } from './promptFolderSkip.js';

describe('isSkippedPromptFolderName', () => {
  it('skips app sidecars, dot-folders, and the review folder', () => {
    expect(isSkippedPromptFolderName('!.wcm')).toBe(true);
    expect(isSkippedPromptFolderName('!Cache')).toBe(true);
    expect(isSkippedPromptFolderName('!Thumbnails')).toBe(true);
    expect(isSkippedPromptFolderName('.git')).toBe(true);
    expect(isSkippedPromptFolderName('new')).toBe(true);
    expect(isSkippedPromptFolderName('New')).toBe(true);
  });

  it('keeps real prompt folders', () => {
    expect(isSkippedPromptFolderName('styles')).toBe(false);
    expect(isSkippedPromptFolderName('!Deleted')).toBe(false);
  });
});
