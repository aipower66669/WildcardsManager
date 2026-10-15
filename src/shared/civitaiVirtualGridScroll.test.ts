import { describe, expect, it } from 'vitest';
import { preserveScrollForRowHeightChange } from './civitaiVirtualGridScroll';

describe('preserveScrollForRowHeightChange', () => {
  it('keeps the same fractional row when pitch grows', () => {
    expect(preserveScrollForRowHeightChange(750, 300, 340)).toBe(850);
  });

  it('is a no-op when pitch is invalid', () => {
    expect(preserveScrollForRowHeightChange(400, 0, 340)).toBe(400);
  });
});
