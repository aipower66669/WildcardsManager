import { describe, expect, it } from 'vitest';
import { validatePlatformWildcardSyntax } from './platformValidation.js';

describe('validatePlatformWildcardSyntax', () => {
  const text = '__where{|-indoor}__';

  it('rejects Dynamic Prompts logic inside ComfyUI wildcard references', () => {
    expect(validatePlatformWildcardSyntax(text, 'comfyui', 'root')).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'unsupported_wildcard_logic',
        nodeId: 'root',
        line: 1,
        column: 1,
        snippet: text,
      }),
    ]);
  });

  it('accepts the same syntax for Stable Diffusion Dynamic Prompts', () => {
    expect(validatePlatformWildcardSyntax(text, 'stable-diffusion')).toEqual([]);
  });

  it('rejects paren-form Dynamic Prompts logic for ComfyUI', () => {
    expect(
      validatePlatformWildcardSyntax('__color(|-basic)__', 'comfyui', 'root'),
    ).toEqual([
      expect.objectContaining({
        code: 'unsupported_wildcard_logic',
        snippet: '__color(|-basic)__',
      }),
    ]);
  });

  it('accepts paren-form for Stable Diffusion Dynamic Prompts', () => {
    expect(
      validatePlatformWildcardSyntax('__color(|-basic)__', 'stable-diffusion'),
    ).toEqual([]);
  });
});
