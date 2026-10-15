import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/wcm-browse-catchup-test' },
}));

const archivedImageIds = vi.hoisted(() => ({ ids: [] as number[] }));

vi.mock('./settingsStore.js', () => ({
  getCivitaiOrigin: () => 'https://civitai.com',
  listArchivedCivitaiImages: () =>
    archivedImageIds.ids.map((imageId) => ({
      origin: 'https://civitai.com',
      imageId,
    })),
  listArchivedCivitaiVideos: () => [],
}));
vi.mock('./librarySidecarIo.js', () => ({
  atomicWriteFile: vi.fn(),
  readJsonFile: () => null,
}));
vi.mock('./civitaiImageDownload.js', () => ({
  listDownloadedCivitaiImageIds: () => [1, 2],
}));
vi.mock('./civitaiVideoDownload.js', () => ({
  listDownloadedCivitaiVideoIds: () => [],
}));

const getImageFeedFrontier = vi.fn();
vi.mock('./civitaiImageFeedFrontier.js', async () => {
  const actual = await vi.importActual<
    typeof import('./civitaiImageFeedFrontier.js')
  >('./civitaiImageFeedFrontier.js');
  return {
    ...actual,
    getImageFeedFrontier: (...args: unknown[]) => getImageFeedFrontier(...args),
    setFirstPassResumeCursor: vi.fn(),
    markFeedCovered: vi.fn(),
  };
});

import { evaluateBrowseCatchUpPage } from './civitaiBrowseCatchUp.js';
import { invalidateCivitaiMediaKnown } from './civitaiMediaKnownCache.js';

const keyParts = {
  sort: 'Newest' as const,
  period: 'AllTime' as const,
  nsfwMode: 'all' as const,
  tool: 'any' as const,
  baseModels: [] as string[],
};

describe('evaluateBrowseCatchUpPage', () => {
  it('does not early-stop Newest without a prior exhausted tip', () => {
    archivedImageIds.ids = [];
    invalidateCivitaiMediaKnown('image');
    getImageFeedFrontier.mockReturnValue({
      coveredThroughNewestAt: '2026-06-01T00:00:00.000Z',
      coveredThroughNewestId: 1,
      oldestProcessedAt: null,
      oldestProcessedId: null,
      feedExhaustedAt: null,
      firstPassResumeCursor: null,
      consecutiveKnownPages: 0,
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const result = evaluateBrowseCatchUpPage({
      media: 'image',
      keyParts,
      page: [
        { id: 1, createdAt: '2026-05-01T00:00:00.000Z' },
        { id: 2, createdAt: '2026-04-01T00:00:00.000Z' },
      ],
      consecutiveDownloadedPages: 5,
      append: true,
    });
    expect(result.earlyStop).toBe(false);
  });

  it('does not early-stop Newest on a single tip-era known page', () => {
    archivedImageIds.ids = [];
    invalidateCivitaiMediaKnown('image');
    getImageFeedFrontier.mockReturnValue({
      coveredThroughNewestAt: '2026-06-01T00:00:00.000Z',
      coveredThroughNewestId: 1,
      oldestProcessedAt: null,
      oldestProcessedId: null,
      feedExhaustedAt: '2026-07-01T00:00:00.000Z',
      firstPassResumeCursor: null,
      consecutiveKnownPages: 0,
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const result = evaluateBrowseCatchUpPage({
      media: 'image',
      keyParts,
      page: [
        { id: 1, createdAt: '2026-05-01T00:00:00.000Z' },
        { id: 2, createdAt: '2026-04-01T00:00:00.000Z' },
      ],
      consecutiveDownloadedPages: 0,
      append: true,
    });
    expect(result.earlyStop).toBe(false);
    expect(result.consecutiveDownloadedPages).toBe(1);
  });

  it('early-stops Newest after a streak of tip-era known pages (downloaded)', () => {
    archivedImageIds.ids = [];
    invalidateCivitaiMediaKnown('image');
    getImageFeedFrontier.mockReturnValue({
      coveredThroughNewestAt: '2026-06-01T00:00:00.000Z',
      coveredThroughNewestId: 1,
      oldestProcessedAt: null,
      oldestProcessedId: null,
      feedExhaustedAt: '2026-07-01T00:00:00.000Z',
      firstPassResumeCursor: null,
      consecutiveKnownPages: 0,
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const result = evaluateBrowseCatchUpPage({
      media: 'image',
      keyParts,
      page: [
        { id: 1, createdAt: '2026-05-01T00:00:00.000Z' },
        { id: 2, createdAt: '2026-04-01T00:00:00.000Z' },
      ],
      consecutiveDownloadedPages: 2,
      append: true,
    });
    expect(result.earlyStop).toBe(true);
    expect(result.coveredThroughNewestAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('early-stops Newest on archived-only pages once past the shared tip', () => {
    archivedImageIds.ids = [9, 10];
    invalidateCivitaiMediaKnown('image');
    getImageFeedFrontier.mockReturnValue({
      coveredThroughNewestAt: '2026-06-01T00:00:00.000Z',
      coveredThroughNewestId: 1,
      oldestProcessedAt: null,
      oldestProcessedId: null,
      feedExhaustedAt: '2026-07-01T00:00:00.000Z',
      firstPassResumeCursor: null,
      consecutiveKnownPages: 0,
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const result = evaluateBrowseCatchUpPage({
      media: 'image',
      keyParts,
      page: [
        { id: 9, createdAt: '2026-05-01T00:00:00.000Z' },
        { id: 10, createdAt: '2026-04-01T00:00:00.000Z' },
      ],
      consecutiveDownloadedPages: 2,
      append: true,
    });
    expect(result.earlyStop).toBe(true);
  });

  it('keeps walking archived-only pages that are still newer than the tip', () => {
    archivedImageIds.ids = [9, 10];
    invalidateCivitaiMediaKnown('image');
    getImageFeedFrontier.mockReturnValue({
      coveredThroughNewestAt: '2026-06-01T00:00:00.000Z',
      coveredThroughNewestId: 1,
      oldestProcessedAt: null,
      oldestProcessedId: null,
      feedExhaustedAt: '2026-07-01T00:00:00.000Z',
      firstPassResumeCursor: null,
      consecutiveKnownPages: 0,
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const result = evaluateBrowseCatchUpPage({
      media: 'image',
      keyParts,
      page: [
        { id: 9, createdAt: '2026-07-01T00:00:00.000Z' },
        { id: 10, createdAt: '2026-06-15T00:00:00.000Z' },
      ],
      consecutiveDownloadedPages: 0,
      append: true,
    });
    expect(result.earlyStop).toBe(false);
    expect(result.consecutiveDownloadedPages).toBe(1);
  });

  it('can ignore Newest early-stop when the user loads older past the tip', () => {
    archivedImageIds.ids = [];
    invalidateCivitaiMediaKnown('image');
    getImageFeedFrontier.mockReturnValue({
      coveredThroughNewestAt: '2026-06-01T00:00:00.000Z',
      coveredThroughNewestId: 1,
      oldestProcessedAt: null,
      oldestProcessedId: null,
      feedExhaustedAt: '2026-07-01T00:00:00.000Z',
      firstPassResumeCursor: null,
      consecutiveKnownPages: 0,
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const result = evaluateBrowseCatchUpPage({
      media: 'image',
      keyParts,
      page: [
        { id: 1, createdAt: '2026-05-01T00:00:00.000Z' },
        { id: 2, createdAt: '2026-04-01T00:00:00.000Z' },
      ],
      consecutiveDownloadedPages: 0,
      append: true,
      ignoreEarlyStop: true,
    });
    expect(result.earlyStop).toBe(false);
  });
});
