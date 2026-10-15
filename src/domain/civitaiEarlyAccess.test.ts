import { describe, expect, it } from 'vitest';
import {
  isEarlyAccessActive,
  isVersionConfirmedPublic,
  isVersionEarlyAccess,
  mergeEarlyAccessFlag,
  projectVersionSnapEarlyAccess,
  resolveEarlyAccessEndsAt,
  extractEarlyAccessEndsAtFromPageJson,
  extractEarlyAccessEndsAtFromModelPageHtml,
  extractEarlyAccessGateFromModelPageHtml,
  versionHasPaidBuzzResidue,
} from './civitaiEarlyAccess.js';

describe('resolveEarlyAccessEndsAt', () => {
  it('uses earlyAccessEndsAt when present', () => {
    expect(
      resolveEarlyAccessEndsAt({
        earlyAccessEndsAt: '2026-07-27T01:51:26.625Z',
      }),
    ).toBe('2026-07-27T01:51:26.625Z');
  });

  it('uses earlyAccessDeadline / paidAccess.endsAt (website fields)', () => {
    expect(
      resolveEarlyAccessEndsAt({
        earlyAccessDeadline: '2026-07-29T11:27:10.987Z',
      }),
    ).toBe('2026-07-29T11:27:10.987Z');
    expect(
      resolveEarlyAccessEndsAt({
        paidAccess: { endsAt: '2026-07-29T11:27:10.987Z', timeframeDays: 3 },
      }),
    ).toBe('2026-07-29T11:27:10.987Z');
  });

  it('derives end time from paidAccess.timeframeDays + publish start', () => {
    expect(
      resolveEarlyAccessEndsAt({
        availability: 'EarlyAccess',
        publishedAt: '2026-07-26T11:27:10.987Z',
        paidAccess: { timeframeDays: 3 },
      }),
    ).toBe('2026-07-29T11:27:10.987Z');
  });

  it('derives end time from timeframe + publish start', () => {
    expect(
      resolveEarlyAccessEndsAt({
        availability: 'EarlyAccess',
        publishedAt: '2026-07-20T01:51:26.625Z',
        earlyAccessConfig: {
          timeframe: 7,
          originalPublishedAt: '2026-07-20T01:51:26.625Z',
        },
      }),
    ).toBe('2026-07-27T01:51:26.625Z');
  });

  it('returns undefined when list payload has no end fields', () => {
    expect(
      resolveEarlyAccessEndsAt({
        availability: 'EarlyAccess',
        publishedAt: '2026-07-20T01:51:26.625Z',
      }),
    ).toBeUndefined();
  });
});

describe('extractEarlyAccessEndsAtFromPageJson', () => {
  it('finds paidAccess.endsAt nested in Next.js payload', () => {
    expect(
      extractEarlyAccessEndsAtFromPageJson({
        props: {
          pageProps: {
            trpcState: {
              json: {
                queries: [
                  {
                    state: {
                      data: {
                        modelVersions: [
                          {
                            id: 1,
                            earlyAccessDeadline: '2026-07-29T11:27:10.987Z',
                            paidAccess: {
                              endsAt: '2026-07-29T11:27:10.987Z',
                              timeframeDays: 3,
                            },
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      }),
    ).toBe('2026-07-29T11:27:10.987Z');
  });
});

describe('extractEarlyAccessEndsAtFromModelPageHtml', () => {
  it('reads earlyAccessDeadline via HTML regex', () => {
    const html = `<html><script id="__NEXT_DATA__" type="application/json">{"x":1}</script>
      "earlyAccessDeadline":"2026-07-29T11:27:10.987Z","paidAccess":{"endsAt":"2026-07-29T11:27:10.987Z","timeframeDays":3}</html>`;
    expect(extractEarlyAccessEndsAtFromModelPageHtml(html)).toBe(
      '2026-07-29T11:27:10.987Z',
    );
  });
});

describe('isVersionEarlyAccess', () => {
  it('treats availability EarlyAccess as early access when no end time', () => {
    expect(
      isVersionEarlyAccess({
        availability: 'EarlyAccess',
      }),
    ).toBe(true);
  });

  it('treats ended EarlyAccess as available when end time has passed', () => {
    expect(
      isVersionEarlyAccess(
        {
          availability: 'EarlyAccess',
          earlyAccessEndsAt: '2020-01-01T00:00:00.000Z',
        },
        Date.parse('2026-07-20T00:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('keeps EarlyAccess active when end time is still in the future', () => {
    expect(
      isVersionEarlyAccess(
        {
          availability: 'EarlyAccess',
          earlyAccessEndsAt: '2030-01-01T00:00:00.000Z',
        },
        Date.parse('2026-07-20T00:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('treats Buzz earlyAccessConfig as gated when end time is unknown', () => {
    expect(
      isVersionEarlyAccess({
        earlyAccessConfig: { timeframe: 7, downloadPrice: 500 },
      }),
    ).toBe(true);
  });

  it('treats Buzz downloadPrice as gated even when availability is Public', () => {
    expect(
      isVersionEarlyAccess({
        availability: 'Public',
        earlyAccessConfig: { downloadPrice: 500 },
      }),
    ).toBe(true);
  });

  it('treats chargeForDownload / checkPermission as gated', () => {
    expect(
      isVersionEarlyAccess({
        availability: 'Public',
        earlyAccessConfig: { chargeForDownload: true },
      }),
    ).toBe(true);
    expect(
      isVersionEarlyAccess({
        availability: 'Public',
        checkPermission: true,
      }),
    ).toBe(true);
  });

  it('does not treat Public + leftover timeframe (no price) as early access', () => {
    expect(
      isVersionEarlyAccess({
        availability: 'Public',
        earlyAccessConfig: { timeframe: 7 },
      }),
    ).toBe(false);
  });

  it('past end time unlocks even with leftover downloadPrice', () => {
    expect(
      isVersionEarlyAccess(
        {
          availability: 'Public',
          earlyAccessEndsAt: '2020-01-01T00:00:00.000Z',
          earlyAccessConfig: { downloadPrice: 500 },
        },
        Date.parse('2026-07-20T00:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('past end time stays gated when chargeForDownload is still true', () => {
    expect(
      isVersionEarlyAccess(
        {
          availability: 'Public',
          earlyAccessEndsAt: '2020-01-01T00:00:00.000Z',
          earlyAccessConfig: {
            downloadPrice: 500,
            chargeForDownload: true,
          },
        },
        Date.parse('2026-07-20T00:00:00.000Z'),
      ),
    ).toBe(true);
  });
});

describe('versionHasPaidBuzzResidue', () => {
  it('detects snap downloadPrice and charge flags', () => {
    expect(versionHasPaidBuzzResidue({ downloadPrice: 100 })).toBe(true);
    expect(
      versionHasPaidBuzzResidue({
        earlyAccessConfig: { chargeForDownload: true },
      }),
    ).toBe(true);
    expect(versionHasPaidBuzzResidue({ downloadPrice: 0 })).toBe(false);
  });
});

describe('isVersionConfirmedPublic', () => {
  it('requires positive proof — missing fields are not unlocked', () => {
    expect(isVersionConfirmedPublic({})).toBe(false);
    expect(
      isVersionConfirmedPublic({ availability: 'EarlyAccess' }),
    ).toBe(false);
  });

  it('accepts Public availability or a past end time', () => {
    expect(
      isVersionConfirmedPublic({ availability: 'Public' }),
    ).toBe(true);
    expect(
      isVersionConfirmedPublic(
        {
          availability: 'EarlyAccess',
          earlyAccessEndsAt: '2020-01-01T00:00:00.000Z',
        },
        Date.parse('2026-07-20T00:00:00.000Z'),
      ),
    ).toBe(true);
  });
});

describe('isEarlyAccessActive', () => {
  it('ignores a stale true flag once the end time has passed', () => {
    expect(
      isEarlyAccessActive(true, '2020-01-01T00:00:00.000Z', Date.parse('2026-07-20T00:00:00.000Z')),
    ).toBe(false);
  });

  it('trusts the flag when there is no end time', () => {
    expect(isEarlyAccessActive(true, undefined)).toBe(true);
    expect(isEarlyAccessActive(false, undefined)).toBe(false);
  });

  it('future end time wins even when the boolean flag is false', () => {
    expect(
      isEarlyAccessActive(
        false,
        '2026-08-01T00:00:00.000Z',
        Date.parse('2026-07-20T00:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('past end time unlocks even when the boolean flag is still true', () => {
    expect(
      isEarlyAccessActive(
        true,
        '2020-01-01T00:00:00.000Z',
        Date.parse('2026-07-20T00:00:00.000Z'),
      ),
    ).toBe(false);
  });
});

describe('mergeEarlyAccessFlag', () => {
  it('does not let a thin false clear active EA without a past end', () => {
    expect(
      mergeEarlyAccessFlag({
        prev: true,
        next: false,
        prevEndsAt: undefined,
        nextEndsAt: undefined,
      }),
    ).toBe(true);
  });

  it('clears EA when a past end time proves unlock', () => {
    expect(
      mergeEarlyAccessFlag({
        prev: true,
        next: false,
        prevEndsAt: '2020-01-01T00:00:00.000Z',
        nextEndsAt: undefined,
        nowMs: Date.parse('2026-07-20T00:00:00.000Z'),
      }),
    ).toBe(false);
  });
});

describe('extractEarlyAccessGateFromModelPageHtml', () => {
  it('detects paid Buzz with downloadPrice and no deadline', () => {
    const html =
      '<html>"availability":"Public","downloadPrice":500,"chargeForDownload":true</html>';
    const gate = extractEarlyAccessGateFromModelPageHtml(html);
    expect(gate.gated).toBe(true);
    expect(gate.downloadPrice).toBe(500);
    expect(gate.endsAt).toBeUndefined();
  });

  it('future deadline gates; past deadline unlocks even with price residue', () => {
    const future = extractEarlyAccessGateFromModelPageHtml(
      '<html>"earlyAccessDeadline":"2030-01-01T00:00:00.000Z","downloadPrice":100</html>',
      Date.parse('2026-07-20T00:00:00.000Z'),
    );
    expect(future.gated).toBe(true);
    expect(future.endsAt).toBe('2030-01-01T00:00:00.000Z');

    const past = extractEarlyAccessGateFromModelPageHtml(
      '<html>"earlyAccessDeadline":"2020-01-01T00:00:00.000Z","downloadPrice":100</html>',
      Date.parse('2026-07-20T00:00:00.000Z'),
    );
    expect(past.gated).toBe(false);
  });

  it('past deadline stays gated when chargeForDownload is still true', () => {
    const past = extractEarlyAccessGateFromModelPageHtml(
      '<html>"earlyAccessDeadline":"2020-01-01T00:00:00.000Z","downloadPrice":100,"chargeForDownload":true</html>',
      Date.parse('2026-07-20T00:00:00.000Z'),
    );
    expect(past.gated).toBe(true);
  });
});

describe('projectVersionSnapEarlyAccess', () => {
  it('keeps Buzz downloadPrice gated without an end time', () => {
    expect(
      projectVersionSnapEarlyAccess({
        earlyAccess: false,
        downloadPrice: 500,
      }).earlyAccess,
    ).toBe(true);
  });

  it('does not inherit model past-end onto a paid version', () => {
    expect(
      projectVersionSnapEarlyAccess({
        downloadPrice: 500,
        inheritModelEarlyAccess: false,
        inheritModelEndsAt: '2020-01-01T00:00:00.000Z',
        nowMs: Date.parse('2026-07-20T00:00:00.000Z'),
      }).earlyAccess,
    ).toBe(true);
  });

  it('unlocks when snap end time is past', () => {
    expect(
      projectVersionSnapEarlyAccess({
        earlyAccess: true,
        downloadPrice: 500,
        earlyAccessEndsAt: '2020-01-01T00:00:00.000Z',
        nowMs: Date.parse('2026-07-20T00:00:00.000Z'),
      }).earlyAccess,
    ).toBe(false);
  });
});
