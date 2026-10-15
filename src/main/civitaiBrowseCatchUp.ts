/**
 * Browse catch-up uses the **same** tip watermark file/keys as Download all
 * (`civitai-image-feed-frontiers.json` / video twin).
 *
 * Download all treats a page as “known” only when every hit is **downloaded**
 * (archive alone must not skip overnight undownloaded files).
 *
 * Browse is different: once a prior pass set `feedExhaustedAt` + tip, a page is
 * “settled” when every hit is archived **or** downloaded. Re-entering tip-era
 * settled pages can stop the walk, but only after a streak of such pages —
 * Civitai Newest is not strictly chronological, so one archived page at the
 * watermark is not “caught up”. Catch-up must not rewrite the shared tip to
 * this search’s first page (that poisons the next run). A few settled pages
 * *newer* than the tip still keep paging (Archive-all at the live tip must not
 * freeze before older unsettled files).
 *
 * Incomplete first pass: deep `firstPassResumeCursor`; after tip-side settled
 * streak, jump there instead of replaying the whole feed.
 */

import {
  FIRST_PASS_KNOWN_PAGES_BEFORE_RESUME,
  NON_NEWEST_KNOWN_PAGE_STOP,
  feedHasCompletedPass,
  getImageFeedFrontier,
  markFeedCovered as markImageFeedCovered,
  pageIsAllKnown,
  setFirstPassResumeCursor as setImageFirstPassResumeCursor,
  shouldEarlyStopNewest,
  shouldEarlyStopRanked,
  shouldJumpToFirstPassResume,
  type ImageFeedFrontierKeyParts,
} from './civitaiImageFeedFrontier.js';
import {
  feedHasCompletedPass as videoFeedHasCompletedPass,
  getVideoFeedFrontier,
  markFeedCovered as markVideoFeedCovered,
  pageIsAllKnown as videoPageIsAllKnown,
  setFirstPassResumeCursor as setVideoFirstPassResumeCursor,
  shouldEarlyStopNewest as shouldEarlyStopVideoNewest,
  shouldEarlyStopRanked as shouldEarlyStopVideoRanked,
  shouldJumpToFirstPassResume as shouldJumpToVideoFirstPassResume,
} from './civitaiVideoFeedFrontier.js';
import { listDownloadedCivitaiImageIds } from './civitaiImageDownload.js';
import { listDownloadedCivitaiVideoIds } from './civitaiVideoDownload.js';
import {
  listArchivedCivitaiImages,
  listArchivedCivitaiVideos,
} from './settingsStore.js';
import { civitaiMediaKnownGeneration } from './civitaiMediaKnownCache.js';

export type BrowseCatchUpMedia = 'image' | 'video';

export type BrowseCatchUpKeyParts = {
  sort: ImageFeedFrontierKeyParts['sort'];
  period: ImageFeedFrontierKeyParts['period'];
  nsfwMode: ImageFeedFrontierKeyParts['nsfwMode'];
  tool: ImageFeedFrontierKeyParts['tool'];
  baseModels: string[];
};

export type BrowseCatchUpHit = {
  id: number;
  createdAt: string | null;
};

export type BrowseCatchUpEvaluateRequest = {
  media: BrowseCatchUpMedia;
  keyParts: BrowseCatchUpKeyParts;
  page: BrowseCatchUpHit[];
  /** Consecutive Browse-settled pages so far this walk (0 on a fresh tip search). */
  consecutiveDownloadedPages: number;
  /** False on the first page of a Browse search; true when auto-loading / Load more. */
  append: boolean;
  /** True after this Browse session already jumped to firstPassResumeCursor. */
  alreadyJumpedToResume?: boolean;
  /**
   * User chose “Load older” after a tip catch-up stop. Skip Newest/ranked
   * early-stop for this page so they can walk past a stuck watermark.
   */
  ignoreEarlyStop?: boolean;
};

export type BrowseCatchUpEvaluateResult = {
  earlyStop: boolean;
  consecutiveDownloadedPages: number;
  /** Opaque Civitai cursor to jump to (first-pass resume). */
  jumpToCursor: string | null;
  /** Tip watermark used for the early-stop decision (ISO), when earlyStop. */
  coveredThroughNewestAt: string | null;
};

export type BrowseCatchUpCommitRequest = {
  media: BrowseCatchUpMedia;
  keyParts: BrowseCatchUpKeyParts;
  tipHits: BrowseCatchUpHit[];
  coveredHits: BrowseCatchUpHit[];
  exhausted: boolean;
};

type KnownSets = {
  downloaded: Set<number>;
  archived: Set<number>;
};

const knownCache: {
  image: { gen: number; known: KnownSets } | null;
  video: { gen: number; known: KnownSets } | null;
} = { image: null, video: null };

function knownSets(media: BrowseCatchUpMedia): KnownSets {
  const gen = civitaiMediaKnownGeneration(media);
  const cached = knownCache[media];
  if (cached && cached.gen === gen) return cached.known;
  const known: KnownSets =
    media === 'video'
      ? {
          downloaded: new Set(listDownloadedCivitaiVideoIds()),
          archived: new Set(listArchivedCivitaiVideos().map((a) => a.imageId)),
        }
      : {
          downloaded: new Set(listDownloadedCivitaiImageIds()),
          archived: new Set(listArchivedCivitaiImages().map((a) => a.imageId)),
        };
  knownCache[media] = { gen, known };
  return known;
}

/**
 * For Browse tip logic only: treat archived ∪ downloaded as “handled”.
 * Reuses Download-all helpers that key off the `downloaded` set.
 */
function browseSettledKnown(known: {
  downloaded: Set<number>;
  archived: Set<number>;
}): { downloaded: Set<number>; archived: Set<number> } {
  if (known.archived.size === 0) return known;
  const downloaded = new Set(known.downloaded);
  for (const id of known.archived) downloaded.add(id);
  return { downloaded, archived: known.archived };
}

export function evaluateBrowseCatchUpPage(
  request: BrowseCatchUpEvaluateRequest,
): BrowseCatchUpEvaluateResult {
  const known = browseSettledKnown(knownSets(request.media));
  const page = request.page;
  const allSettled =
    request.media === 'video'
      ? videoPageIsAllKnown(page, known)
      : pageIsAllKnown(page, known);

  let consecutive = request.append
    ? allSettled
      ? request.consecutiveDownloadedPages + 1
      : 0
    : allSettled
      ? 1
      : 0;

  const alreadyJumped = request.alreadyJumpedToResume === true;
  const ignoreEarlyStop = request.ignoreEarlyStop === true;

  if (request.media === 'video') {
    const frontier = getVideoFeedFrontier(request.keyParts);
    if (!ignoreEarlyStop) {
      if (request.keyParts.sort === 'Newest') {
        if (
          consecutive >= NON_NEWEST_KNOWN_PAGE_STOP &&
          shouldEarlyStopVideoNewest(page, frontier, known)
        ) {
          return {
            earlyStop: true,
            consecutiveDownloadedPages: consecutive,
            jumpToCursor: null,
            coveredThroughNewestAt: frontier?.coveredThroughNewestAt ?? null,
          };
        }
      } else if (shouldEarlyStopVideoRanked(consecutive, frontier)) {
        return {
          earlyStop: true,
          consecutiveDownloadedPages: consecutive,
          jumpToCursor: null,
          coveredThroughNewestAt: frontier?.coveredThroughNewestAt ?? null,
        };
      }
    }

    if (
      allSettled &&
      shouldJumpToVideoFirstPassResume(consecutive, frontier, alreadyJumped)
    ) {
      const cursor = frontier?.firstPassResumeCursor?.trim() || null;
      if (cursor) {
        return {
          earlyStop: false,
          consecutiveDownloadedPages: 0,
          jumpToCursor: cursor,
          coveredThroughNewestAt: null,
        };
      }
    }

    return {
      earlyStop: false,
      consecutiveDownloadedPages: consecutive,
      jumpToCursor: null,
      coveredThroughNewestAt: null,
    };
  }

  const frontier = getImageFeedFrontier(request.keyParts);
  if (!ignoreEarlyStop) {
    if (request.keyParts.sort === 'Newest') {
      if (
        consecutive >= NON_NEWEST_KNOWN_PAGE_STOP &&
        shouldEarlyStopNewest(page, frontier, known)
      ) {
        return {
          earlyStop: true,
          consecutiveDownloadedPages: consecutive,
          jumpToCursor: null,
          coveredThroughNewestAt: frontier?.coveredThroughNewestAt ?? null,
        };
      }
    } else if (shouldEarlyStopRanked(consecutive, frontier)) {
      return {
        earlyStop: true,
        consecutiveDownloadedPages: consecutive,
        jumpToCursor: null,
        coveredThroughNewestAt: frontier?.coveredThroughNewestAt ?? null,
      };
    }
  }

  if (
    allSettled &&
    shouldJumpToFirstPassResume(consecutive, frontier, alreadyJumped)
  ) {
    const cursor = frontier?.firstPassResumeCursor?.trim() || null;
    if (cursor) {
      return {
        earlyStop: false,
        consecutiveDownloadedPages: 0,
        jumpToCursor: cursor,
        coveredThroughNewestAt: null,
      };
    }
  }

  return {
    earlyStop: false,
    consecutiveDownloadedPages: consecutive,
    jumpToCursor: null,
    coveredThroughNewestAt: null,
  };
}

export function noteBrowseResumeCursor(
  media: BrowseCatchUpMedia,
  keyParts: BrowseCatchUpKeyParts,
  cursor: string | null,
  opts?: { alreadyJumpedToResume?: boolean },
): void {
  const alreadyJumped = opts?.alreadyJumpedToResume === true;
  if (media === 'video') {
    const frontier = getVideoFeedFrontier(keyParts);
    if (videoFeedHasCompletedPass(frontier)) return;
    // Tip catch-up before jump must not overwrite the saved deep cursor.
    if (frontier?.firstPassResumeCursor?.trim() && !alreadyJumped) return;
    setVideoFirstPassResumeCursor(keyParts, cursor);
    return;
  }
  const frontier = getImageFeedFrontier(keyParts);
  if (feedHasCompletedPass(frontier)) return;
  if (frontier?.firstPassResumeCursor?.trim() && !alreadyJumped) return;
  setImageFirstPassResumeCursor(keyParts, cursor);
}

export function commitBrowseCatchUp(
  request: BrowseCatchUpCommitRequest,
): void {
  if (request.media === 'video') {
    markVideoFeedCovered(request.keyParts, {
      tipHits: request.tipHits,
      coveredHits: request.coveredHits,
      exhausted: request.exhausted,
    });
    return;
  }
  markImageFeedCovered(request.keyParts, {
    tipHits: request.tipHits,
    coveredHits: request.coveredHits,
    exhausted: request.exhausted,
  });
}

/** Exported for tests — tip catch-up page count before jumping. */
export const BROWSE_FIRST_PASS_KNOWN_PAGES_BEFORE_RESUME =
  FIRST_PASS_KNOWN_PAGES_BEFORE_RESUME;
