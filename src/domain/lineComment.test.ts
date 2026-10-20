import { describe, expect, it } from 'vitest';
import { commentLine, uncommentLine } from './lineComment.js';

describe('commentLine', () => {
  it('puts a hash and one space at the start of the line', () => {
    expect(commentLine('hat, red')).toBe('# hat, red');
    expect(commentLine('  indented')).toBe('#   indented');
    expect(commentLine('')).toBe('# ');
  });
});

describe('uncommentLine', () => {
  it('removes one leading hash and the single space after it', () => {
    expect(uncommentLine('# hat, red')).toBe('hat, red');
    expect(uncommentLine('#   indented')).toBe('  indented');
    expect(uncommentLine('  # already')).toBe('  already');
    expect(uncommentLine('#hat')).toBe('hat');
    expect(uncommentLine('# ')).toBe('');
  });

  it('round-trips a commented line', () => {
    expect(uncommentLine(commentLine('hat, red'))).toBe('hat, red');
    expect(uncommentLine(commentLine('  indented'))).toBe('  indented');
    expect(uncommentLine(commentLine(''))).toBe('');
  });

  it('leaves a line that is not a comment alone', () => {
    expect(uncommentLine('hat # note')).toBe('hat # note');
    expect(uncommentLine('')).toBe('');
  });
});
