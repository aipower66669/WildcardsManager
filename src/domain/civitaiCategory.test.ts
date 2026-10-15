import { describe, expect, it } from 'vitest';
import {
  relativeFolderUnderRoot,
  sanitizeDownloadCategoryName,
} from './civitaiCategory.js';

describe('sanitizeDownloadCategoryName', () => {
  it('accepts simple folder names', () => {
    expect(sanitizeDownloadCategoryName(' SDXL ')).toBe('SDXL');
    expect(sanitizeDownloadCategoryName('wan_video')).toBe('wan_video');
  });

  it('accepts nested relative folders', () => {
    expect(sanitizeDownloadCategoryName('clothing\\swim')).toBe('clothing/swim');
    expect(sanitizeDownloadCategoryName('/styles/realism/')).toBe(
      'styles/realism',
    );
  });

  it('rejects path traversal and illegal characters', () => {
    expect(sanitizeDownloadCategoryName('../escape')).toBe('');
    expect(sanitizeDownloadCategoryName('foo/../bar')).toBe('');
    expect(sanitizeDownloadCategoryName('a<b')).toBe('');
    expect(sanitizeDownloadCategoryName('')).toBe('');
  });
});

describe('relativeFolderUnderRoot', () => {
  it('returns a relative path under the root', () => {
    expect(
      relativeFolderUnderRoot(
        'F:/AI/models/loras',
        'F:/AI/models/loras/Poses',
      ),
    ).toBe('Poses');
    expect(
      relativeFolderUnderRoot(
        'F:\\AI\\models\\loras',
        'F:\\AI\\models\\loras\\x-style\\clothes',
      ),
    ).toBe('x-style/clothes');
  });

  it('rejects the root itself and paths outside it', () => {
    expect(
      relativeFolderUnderRoot('F:/AI/models/loras', 'F:/AI/models/loras'),
    ).toBeNull();
    expect(
      relativeFolderUnderRoot(
        'F:/AI/models/loras',
        'F:/AI/models/checkpoints/SDXL',
      ),
    ).toBeNull();
  });
});
