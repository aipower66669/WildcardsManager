import { describe, expect, it } from 'vitest';
import {
  remapPromptFolderPath,
  sanitizePromptFolderName,
  uniqueNewPromptFolderName,
} from './promptFolderNames.js';

describe('sanitizePromptFolderName', () => {
  it('accepts a normal name', () => {
    expect(sanitizePromptFolderName('  portraits  ')).toBe('portraits');
  });

  it('rejects reserved and illegal names', () => {
    expect(() => sanitizePromptFolderName('')).toThrow(/required/i);
    expect(() => sanitizePromptFolderName('new')).toThrow(/reserved/i);
    expect(() => sanitizePromptFolderName('!.wcm')).toThrow(/reserved/i);
    expect(() => sanitizePromptFolderName('a/b')).toThrow(/separators/i);
    expect(() => sanitizePromptFolderName('a:b')).toThrow(/invalid/i);
    expect(() => sanitizePromptFolderName('.hidden')).toThrow(
      /reserved|dot/i,
    );
  });
});

describe('uniqueNewPromptFolderName', () => {
  it('uses New folder, then numbered copies', () => {
    expect(uniqueNewPromptFolderName([])).toBe('New folder');
    expect(uniqueNewPromptFolderName(['New folder'])).toBe('New folder (2)');
    expect(uniqueNewPromptFolderName(['New folder', 'New folder (2)'])).toBe(
      'New folder (3)',
    );
  });
});

describe('remapPromptFolderPath', () => {
  it('rewrites the renamed folder and its descendants', () => {
    expect(remapPromptFolderPath('a/b', 'a/b', 'a/c')).toBe('a/c');
    expect(remapPromptFolderPath('a/b/x', 'a/b', 'a/c')).toBe('a/c/x');
    expect(remapPromptFolderPath('other', 'a/b', 'a/c')).toBe('other');
  });
});
