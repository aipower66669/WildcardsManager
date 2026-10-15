import { describe, expect, it } from 'vitest';
import { formatErrorDetail } from './downloadLog.js';

describe('formatErrorDetail', () => {
  it('unwraps undici terminated + cause', () => {
    const err = new Error('terminated');
    err.cause = new Error('other side closed');
    expect(formatErrorDetail(err)).toBe('terminated — other side closed');
  });

  it('handles plain strings', () => {
    expect(formatErrorDetail('boom')).toBe('boom');
  });
});
