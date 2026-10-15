import { describe, expect, it } from 'vitest';
import {
  isRetryableDownloadError,
  isUserCancelledDownloadError,
} from '../main/civitaiModelDownloadQueue.js';

describe('download queue error classification', () => {
  it('treats user cancel as non-retryable', () => {
    expect(isUserCancelledDownloadError(new Error('Download cancelled'))).toBe(
      true,
    );
    expect(isRetryableDownloadError(new Error('Download cancelled'))).toBe(
      false,
    );
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    expect(isUserCancelledDownloadError(abort)).toBe(true);
    expect(isRetryableDownloadError(abort)).toBe(false);

    const wrapped = new Error('fetch failed');
    wrapped.cause = Object.assign(new Error('This operation was aborted'), {
      name: 'AbortError',
    });
    expect(isUserCancelledDownloadError(wrapped)).toBe(true);
    expect(isRetryableDownloadError(wrapped)).toBe(false);
  });

  it('retries typical offline / DNS / gateway failures', () => {
    expect(isRetryableDownloadError(new Error('fetch failed'))).toBe(true);
    expect(
      isRetryableDownloadError(new Error('getaddrinfo ENOTFOUND civitai.com')),
    ).toBe(true);
    expect(
      isRetryableDownloadError(new Error('Download failed (503): unavailable')),
    ).toBe(true);
    expect(
      isRetryableDownloadError(new Error('Download failed (429): rate limit')),
    ).toBe(true);
    expect(isRetryableDownloadError(new Error('read ECONNRESET'))).toBe(true);
    expect(isRetryableDownloadError(new Error('terminated'))).toBe(true);
    const sock = new Error('terminated');
    sock.cause = new Error('other side closed');
    expect(isRetryableDownloadError(sock)).toBe(true);
  });

  it('does not retry permanent client errors', () => {
    expect(
      isRetryableDownloadError(new Error('Download failed (404): not found')),
    ).toBe(false);
    expect(
      isRetryableDownloadError(new Error('Download failed (401): unauthorized')),
    ).toBe(false);
    expect(
      isRetryableDownloadError(new Error('LoRA download category not found')),
    ).toBe(false);
  });

  it('inspects error.cause from undici', () => {
    const err = new Error('fetch failed');
    err.cause = new Error('Connect Timeout Error');
    expect(isRetryableDownloadError(err)).toBe(true);
  });
});
