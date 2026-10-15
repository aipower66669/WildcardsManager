import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/wcm-frontier-test' },
}));
vi.mock('./settingsStore.js', () => ({
  getCivitaiOrigin: () => 'https://civitai.com',
}));
vi.mock('./librarySidecarIo.js', () => ({
  atomicWriteFile: vi.fn(),
  readJsonFile: () => null,
}));

import {
  FIRST_PASS_KNOWN_PAGES_BEFORE_RESUME,
  NON_NEWEST_KNOWN_PAGE_STOP,
  pageIsAllKnown,
  shouldEarlyStopNewest,
  shouldEarlyStopRanked,
  shouldJumpToFirstPassResume,
  type ImageFeedFrontier,
} from './civitaiImageFeedFrontier.js';

function known(...ids: number[]) {
  return {
    downloaded: new Set(ids),
    archived: new Set<number>(),
  };
}

function frontier(opts: {
  coveredThroughNewestAt?: string | null;
  feedExhaustedAt?: string | null;
  firstPassResumeCursor?: string | null;
}): ImageFeedFrontier {
  const tip = opts.coveredThroughNewestAt ?? null;
  return {
    coveredThroughNewestAt: tip,
    coveredThroughNewestId: tip ? 1 : null,
    oldestProcessedAt: '2026-01-01T00:00:00.000Z',
    oldestProcessedId: 10,
    feedExhaustedAt: opts.feedExhaustedAt ?? null,
    firstPassResumeCursor: opts.firstPassResumeCursor ?? null,
    consecutiveKnownPages: 0,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('pageIsAllKnown', () => {
  it('requires a non-empty page of downloaded ids (archived alone is not enough)', () => {
    expect(pageIsAllKnown([], known(1))).toBe(false);
    expect(pageIsAllKnown([{ id: 1 }, { id: 2 }], known(1, 2))).toBe(true);
    expect(pageIsAllKnown([{ id: 1 }, { id: 2 }], known(1))).toBe(false);
    expect(
      pageIsAllKnown([{ id: 1 }, { id: 2 }], {
        downloaded: new Set([1]),
        archived: new Set([1, 2]),
      }),
    ).toBe(false);
    expect(
      pageIsAllKnown([{ id: 1 }, { id: 2 }], {
        downloaded: new Set(),
        archived: new Set([1, 2]),
      }),
    ).toBe(false);
  });
});

describe('shouldEarlyStopNewest', () => {
  it('does not stop without a prior exhausted pass', () => {
    const page = [
      { id: 1, createdAt: '2026-06-01T00:00:00.000Z' },
      { id: 2, createdAt: '2026-05-01T00:00:00.000Z' },
    ];
    expect(
      shouldEarlyStopNewest(
        page,
        frontier({
          coveredThroughNewestAt: '2026-06-01T00:00:00.000Z',
          feedExhaustedAt: null,
        }),
        known(1, 2),
      ),
    ).toBe(false);
  });

  it('stops on an all-downloaded page at/older than the prior tip after exhaust', () => {
    const page = [
      { id: 3, createdAt: '2026-06-01T00:00:00.000Z' },
      { id: 2, createdAt: '2026-05-15T00:00:00.000Z' },
    ];
    expect(
      shouldEarlyStopNewest(
        page,
        frontier({
          coveredThroughNewestAt: '2026-06-01T00:00:00.000Z',
          feedExhaustedAt: '2026-08-01T00:00:00.000Z',
        }),
        known(2, 3),
      ),
    ).toBe(true);
  });

  it('does not early-stop when the tip is only archived, not downloaded', () => {
    const page = [
      { id: 3, createdAt: '2026-06-01T00:00:00.000Z' },
      { id: 2, createdAt: '2026-05-15T00:00:00.000Z' },
    ];
    expect(
      shouldEarlyStopNewest(
        page,
        frontier({
          coveredThroughNewestAt: '2026-06-01T00:00:00.000Z',
          feedExhaustedAt: '2026-08-01T00:00:00.000Z',
        }),
        { downloaded: new Set(), archived: new Set([2, 3]) },
      ),
    ).toBe(false);
  });

  it('keeps paging through newer all-known tip pages after months of history', () => {
    const mayPage = [
      { id: 20, createdAt: '2026-05-20T00:00:00.000Z' },
      { id: 19, createdAt: '2026-05-19T00:00:00.000Z' },
    ];
    const julyPage = [
      { id: 30, createdAt: '2026-07-20T00:00:00.000Z' },
      { id: 29, createdAt: '2026-07-19T00:00:00.000Z' },
    ];
    const fr = frontier({
      coveredThroughNewestAt: '2026-06-01T00:00:00.000Z',
      feedExhaustedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(shouldEarlyStopNewest(julyPage, fr, known(29, 30))).toBe(false);
    expect(shouldEarlyStopNewest(mayPage, fr, known(19, 20))).toBe(true);
  });
});

describe('shouldEarlyStopRanked', () => {
  it('does not treat tip-known pages as caught up before a full exhaust', () => {
    // Regression: Most Collected tip is often already saved via Newest.
    expect(
      shouldEarlyStopRanked(NON_NEWEST_KNOWN_PAGE_STOP, null),
    ).toBe(false);
    expect(
      shouldEarlyStopRanked(
        NON_NEWEST_KNOWN_PAGE_STOP,
        frontier({ feedExhaustedAt: null }),
      ),
    ).toBe(false);
  });

  it(`stops after ${NON_NEWEST_KNOWN_PAGE_STOP} known pages once exhausted before`, () => {
    const fr = frontier({ feedExhaustedAt: '2026-08-01T00:00:00.000Z' });
    expect(shouldEarlyStopRanked(NON_NEWEST_KNOWN_PAGE_STOP - 1, fr)).toBe(
      false,
    );
    expect(shouldEarlyStopRanked(NON_NEWEST_KNOWN_PAGE_STOP, fr)).toBe(true);
  });
});

describe('shouldJumpToFirstPassResume', () => {
  it('jumps only during an incomplete first pass with a saved cursor', () => {
    const incomplete = frontier({
      feedExhaustedAt: null,
      firstPassResumeCursor: 'cursor-500',
    });
    expect(
      shouldJumpToFirstPassResume(
        FIRST_PASS_KNOWN_PAGES_BEFORE_RESUME - 1,
        incomplete,
        false,
      ),
    ).toBe(false);
    expect(
      shouldJumpToFirstPassResume(
        FIRST_PASS_KNOWN_PAGES_BEFORE_RESUME,
        incomplete,
        false,
      ),
    ).toBe(true);
    expect(
      shouldJumpToFirstPassResume(
        FIRST_PASS_KNOWN_PAGES_BEFORE_RESUME,
        incomplete,
        true,
      ),
    ).toBe(false);
  });

  it('does not jump after the feed was exhausted or without a cursor', () => {
    expect(
      shouldJumpToFirstPassResume(
        FIRST_PASS_KNOWN_PAGES_BEFORE_RESUME,
        frontier({
          feedExhaustedAt: '2026-08-01T00:00:00.000Z',
          firstPassResumeCursor: 'cursor-500',
        }),
        false,
      ),
    ).toBe(false);
    expect(
      shouldJumpToFirstPassResume(
        FIRST_PASS_KNOWN_PAGES_BEFORE_RESUME,
        frontier({ feedExhaustedAt: null, firstPassResumeCursor: null }),
        false,
      ),
    ).toBe(false);
  });
});
