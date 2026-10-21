import { describe, expect, it } from 'vitest';
import { missingFileSearchQuery } from './missingFileSearch.js';

describe('missingFileSearchQuery', () => {
  it('uses the wildcard token from the message', () => {
    expect(
      missingFileSearchQuery({
        code: 'missing_file',
        message: 'Missing wildcard file for `__listing__`',
      }),
    ).toBe('__listing__');
  });

  it('prefers a snippet that is already a wildcard token', () => {
    expect(
      missingFileSearchQuery({
        code: 'missing_file',
        message: 'Missing wildcard file for `__listing__`',
        snippet: '__listing__',
      }),
    ).toBe('__listing__');
  });

  it('ignores other issue codes', () => {
    expect(
      missingFileSearchQuery({
        code: 'missing_lora',
        message: 'Missing wildcard file for `__listing__`',
      }),
    ).toBeNull();
  });
});
