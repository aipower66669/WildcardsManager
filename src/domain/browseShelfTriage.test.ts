import { describe, expect, it } from 'vitest';
import { browseCardNeedsNotify } from './browseShelfTriage.js';

const now = Date.parse('2026-06-01T00:00:00.000Z');

describe('browseCardNeedsNotify', () => {
  it('notifies while early access is still in the future', () => {
    expect(
      browseCardNeedsNotify(
        {
          earlyAccess: true,
          earlyAccessEndsAt: '2026-07-01T00:00:00.000Z',
          versions: [
            {
              earlyAccess: true,
              earlyAccessEndsAt: '2026-07-01T00:00:00.000Z',
            },
          ],
        },
        now,
      ),
    ).toBe(true);
  });

  it('notifies when the only version still costs Buzz', () => {
    expect(
      browseCardNeedsNotify(
        {
          versions: [{ earlyAccessConfig: { chargeForDownload: true, downloadPrice: 50 } }],
        },
        now,
      ),
    ).toBe(true);
  });

  it('archives when a free version exists beside a gated one', () => {
    expect(
      browseCardNeedsNotify(
        {
          versions: [
            { earlyAccess: true, earlyAccessEndsAt: '2026-07-01T00:00:00.000Z' },
            { earlyAccess: false },
          ],
        },
        now,
      ),
    ).toBe(false);
  });

  it('archives a normal card', () => {
    expect(
      browseCardNeedsNotify({ earlyAccess: false, versions: [{}] }, now),
    ).toBe(false);
  });

  it('archives after the countdown when only a leftover price remains', () => {
    expect(
      browseCardNeedsNotify(
        {
          versions: [
            {
              earlyAccess: true,
              earlyAccessEndsAt: '2026-01-01T00:00:00.000Z',
              earlyAccessConfig: { downloadPrice: 500 },
            },
          ],
        },
        now,
      ),
    ).toBe(false);
  });
});
