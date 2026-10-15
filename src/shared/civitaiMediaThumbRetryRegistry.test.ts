import { describe, expect, it } from 'vitest';
import {
  getFailedCivitaiThumbCount,
  registerFailedCivitaiThumb,
  retryAllFailedCivitaiThumbs,
  subscribeFailedCivitaiThumbs,
} from './civitaiMediaThumbRetryRegistry';

describe('civitaiMediaThumbRetryRegistry', () => {
  it('registers, counts, retries, and unregisters failed thumbs', () => {
    const calls: string[] = [];
    let notified = 0;
    const unsub = subscribeFailedCivitaiThumbs(() => {
      notified += 1;
    });

    const clearA = registerFailedCivitaiThumb('a', () => calls.push('a'));
    const clearB = registerFailedCivitaiThumb('b', () => calls.push('b'));
    expect(getFailedCivitaiThumbCount()).toBe(2);
    expect(notified).toBeGreaterThanOrEqual(2);

    expect(retryAllFailedCivitaiThumbs()).toBe(2);
    expect(calls).toEqual(['a', 'b']);

    clearA();
    expect(getFailedCivitaiThumbCount()).toBe(1);
    clearB();
    expect(getFailedCivitaiThumbCount()).toBe(0);
    unsub();
  });
});
