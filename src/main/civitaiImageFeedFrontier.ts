import { app } from 'electron';
import path from 'node:path';
import { getCivitaiOrigin } from './settingsStore.js';
import { atomicWriteFile, readJsonFile } from './librarySidecarIo.js';
import type { CivitaiImageBrowseFiltersDto } from '../shared/contracts.js';

/**
 * Per-feed watermark so Download all can stop once it re-enters territory
 * already fully walked, instead of replaying months of known pages.
 *
 * Early-stop is allowed only after the feed has been API-exhausted at least
 * once (`feedExhaustedAt`). A tip full of already-downloaded cards is NOT
 * enough — that happens constantly on ranked sorts after Newest has run.
 *
 * - Newest: after a prior exhaust, stop on the first full page that is already
 *   known and at/older than `coveredThroughNewestAt`.
 * - Other sorts: after a prior exhaust, stop after N consecutive all-known pages.
 *
 * Incomplete first pass (`feedExhaustedAt` still null): each advanced page
 * stores `firstPassResumeCursor`. The next run always starts at the tip, walks
 * until N consecutive all-known pages, then jumps to that cursor so a mid-pass
 * interrupt does not replay hundreds of already-covered API pages.
 */

export type ImageFeedFrontierKeyParts = {
  sort: CivitaiImageBrowseFiltersDto['sort'];
  period: CivitaiImageBrowseFiltersDto['period'];
  nsfwMode: CivitaiImageBrowseFiltersDto['nsfwMode'];
  tool: CivitaiImageBrowseFiltersDto['tool'];
  baseModels: string[];
};

export type ImageFeedFrontier = {
  /**
   * Tip-side watermark from the last completed drain (first page newest).
   * Next Newest run stops when it re-enters this era with an all-known page.
   */
  coveredThroughNewestAt: string | null;
  coveredThroughNewestId: number | null;
  /** Oldest creator upload time reached while covering this feed (diagnostics). */
  oldestProcessedAt: string | null;
  oldestProcessedId: number | null;
  /**
   * Set only when Civitai returned no further pages for this feed at least once.
   * Without this, early-stop must not fire (interrupted runs / tip-known pages).
   */
  feedExhaustedAt: string | null;
  /**
   * Opaque Civitai `nextCursor` after the deepest page fully processed during
   * an incomplete first pass. Cleared once the feed is exhausted / caught up.
   */
  firstPassResumeCursor: string | null;
  /** Consecutive all-known pages at end of last run (non-Newest). */
  consecutiveKnownPages: number;
  updatedAt: string;
};

type FrontierFile = {
  /** v1 could mark catch-up without ever exhausting — discarded on load. */
  version: 2;
  frontiers: Record<string, ImageFeedFrontier>;
};

/** Full pages of already-known hits before early-stop on non-Newest sorts. */
export const NON_NEWEST_KNOWN_PAGE_STOP = 3;

/**
 * During an incomplete first pass, tip catch-up uses this many consecutive
 * all-known pages before jumping to `firstPassResumeCursor`.
 */
export const FIRST_PASS_KNOWN_PAGES_BEFORE_RESUME = 3;

let mem: FrontierFile | null = null;
let dirty = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 1500;

function frontiersPath(): string {
  return path.join(app.getPath('userData'), 'civitai-image-feed-frontiers.json');
}

function emptyFile(): FrontierFile {
  return { version: 2, frontiers: {} };
}

function emptyFrontier(): ImageFeedFrontier {
  return {
    coveredThroughNewestAt: null,
    coveredThroughNewestId: null,
    oldestProcessedAt: null,
    oldestProcessedId: null,
    feedExhaustedAt: null,
    firstPassResumeCursor: null,
    consecutiveKnownPages: 0,
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeFrontier(row: Partial<ImageFeedFrontier> | null | undefined): ImageFeedFrontier {
  const base = emptyFrontier();
  if (!row || typeof row !== 'object') return base;
  return {
    coveredThroughNewestAt:
      typeof row.coveredThroughNewestAt === 'string' &&
      row.coveredThroughNewestAt.trim()
        ? row.coveredThroughNewestAt
        : null,
    coveredThroughNewestId:
      typeof row.coveredThroughNewestId === 'number' &&
      Number.isFinite(row.coveredThroughNewestId)
        ? Math.round(row.coveredThroughNewestId)
        : null,
    oldestProcessedAt:
      typeof row.oldestProcessedAt === 'string' && row.oldestProcessedAt.trim()
        ? row.oldestProcessedAt
        : null,
    oldestProcessedId:
      typeof row.oldestProcessedId === 'number' &&
      Number.isFinite(row.oldestProcessedId)
        ? Math.round(row.oldestProcessedId)
        : null,
    feedExhaustedAt:
      typeof row.feedExhaustedAt === 'string' && row.feedExhaustedAt.trim()
        ? row.feedExhaustedAt
        : null,
    firstPassResumeCursor:
      typeof row.firstPassResumeCursor === 'string' &&
      row.firstPassResumeCursor.trim()
        ? row.firstPassResumeCursor.trim()
        : null,
    consecutiveKnownPages:
      typeof row.consecutiveKnownPages === 'number' &&
      Number.isFinite(row.consecutiveKnownPages)
        ? Math.max(0, Math.round(row.consecutiveKnownPages))
        : 0,
    updatedAt:
      typeof row.updatedAt === 'string' && row.updatedAt.trim()
        ? row.updatedAt
        : new Date(0).toISOString(),
  };
}

function loadFile(): FrontierFile {
  if (mem) return mem;
  const raw = readJsonFile<{ version?: number; frontiers?: unknown }>(
    frontiersPath(),
  );
  // Drop v1 — it could record "caught up" after 3 known tip pages without ever
  // exhausting the feed (false catch-up on ranked sorts).
  if (!raw || raw.version !== 2 || !raw.frontiers || typeof raw.frontiers !== 'object') {
    mem = emptyFile();
    return mem;
  }
  const frontiers: Record<string, ImageFeedFrontier> = {};
  for (const [key, row] of Object.entries(
    raw.frontiers as Record<string, ImageFeedFrontier>,
  )) {
    frontiers[key] = normalizeFrontier(row);
  }
  mem = { version: 2, frontiers };
  return mem;
}

function schedulePersist(): void {
  dirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushImageFeedFrontiersSync();
  }, PERSIST_DEBOUNCE_MS);
  if (typeof persistTimer === 'object' && 'unref' in persistTimer) {
    persistTimer.unref();
  }
}

export function flushImageFeedFrontiersSync(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (!mem || !dirty) return;
  atomicWriteFile(frontiersPath(), `${JSON.stringify(mem)}\n`);
  dirty = false;
}

export function imageFeedFrontierKey(parts: ImageFeedFrontierKeyParts): string {
  const origin = getCivitaiOrigin();
  const bases = [...parts.baseModels]
    .map((b) => b.trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join('|');
  return [
    origin,
    parts.sort,
    parts.period,
    parts.nsfwMode,
    parts.tool,
    bases || '*',
  ].join('\0');
}

export function getImageFeedFrontier(
  parts: ImageFeedFrontierKeyParts,
): ImageFeedFrontier | null {
  const key = imageFeedFrontierKey(parts);
  return loadFile().frontiers[key] ?? null;
}

function parseCreatedMs(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function newestHit(
  hits: Array<{ id: number; createdAt: string | null }>,
): { id: number; ms: number } | null {
  let best: { id: number; ms: number } | null = null;
  for (const hit of hits) {
    const ms = parseCreatedMs(hit.createdAt);
    if (ms == null) continue;
    if (
      !best ||
      ms > best.ms ||
      (ms === best.ms && hit.id > best.id)
    ) {
      best = { id: hit.id, ms };
    }
  }
  return best;
}

export function pageIsAllKnown(
  page: Array<{ id: number }>,
  known: { downloaded: Set<number>; archived: Set<number> },
): boolean {
  if (page.length === 0) return false;
  // Early-stop / tip catch-up must key off downloads only. Archived-without-
  // download (Browse “Archive all showing”) must not freeze Newest catch-up —
  // those ids are still skipped for download, but we keep paging for real new
  // files behind a tip padded with dismissals.
  return page.every((h) => known.downloaded.has(h.id));
}

/** True only after this feed was walked to API end at least once. */
export function feedHasCompletedPass(
  frontier: ImageFeedFrontier | null,
): boolean {
  return Boolean(frontier?.feedExhaustedAt);
}

/**
 * Newest: entire page already downloaded and at/older than the tip covered
 * after a prior full exhaust → no point paging further back through known
 * history. Archived-only ids do not count (see pageIsAllKnown).
 */
export function shouldEarlyStopNewest(
  page: Array<{ id: number; createdAt: string | null }>,
  frontier: ImageFeedFrontier | null,
  known: { downloaded: Set<number>; archived: Set<number> },
): boolean {
  if (!feedHasCompletedPass(frontier)) return false;
  if (!frontier?.coveredThroughNewestAt) return false;
  const coveredMs = parseCreatedMs(frontier.coveredThroughNewestAt);
  if (coveredMs == null) return false;
  if (!pageIsAllKnown(page, known)) return false;
  let newestOnPage = -Infinity;
  for (const hit of page) {
    const ms = parseCreatedMs(hit.createdAt);
    if (ms == null) return false;
    if (ms > newestOnPage) newestOnPage = ms;
  }
  return newestOnPage <= coveredMs;
}

/**
 * Non-Newest: stop after enough consecutive all-known pages, but only once the
 * feed has been fully exhausted before. Tip pages of popular images are often
 * already saved via Newest — that must not count as "caught up".
 */
export function shouldEarlyStopRanked(
  consecutiveKnownPages: number,
  frontier: ImageFeedFrontier | null,
): boolean {
  if (!feedHasCompletedPass(frontier)) return false;
  return consecutiveKnownPages >= NON_NEWEST_KNOWN_PAGE_STOP;
}

/**
 * Incomplete first pass: after tip catch-up hits enough all-known pages, jump
 * to the saved deep cursor instead of replaying the whole walk.
 */
export function shouldJumpToFirstPassResume(
  consecutiveKnownPages: number,
  frontier: ImageFeedFrontier | null,
  alreadyJumped: boolean,
): boolean {
  if (alreadyJumped) return false;
  if (feedHasCompletedPass(frontier)) return false;
  if (!frontier?.firstPassResumeCursor?.trim()) return false;
  return consecutiveKnownPages >= FIRST_PASS_KNOWN_PAGES_BEFORE_RESUME;
}

/** Save / clear the deep resume cursor for an incomplete first pass. */
export function setFirstPassResumeCursor(
  parts: ImageFeedFrontierKeyParts,
  cursor: string | null,
): void {
  const state = loadFile();
  const key = imageFeedFrontierKey(parts);
  const prev = state.frontiers[key] ?? emptyFrontier();
  const next =
    typeof cursor === 'string' && cursor.trim() ? cursor.trim() : null;
  if (prev.firstPassResumeCursor === next) return;
  state.frontiers[key] = {
    ...prev,
    firstPassResumeCursor: next,
    updatedAt: new Date().toISOString(),
  };
  schedulePersist();
}

/**
 * Extend oldest watermark with hits we covered this page (downloaded, skipped
 * as known, or any id we decided not to chase further on this feed).
 */
export function noteProcessedHits(
  parts: ImageFeedFrontierKeyParts,
  hits: Array<{ id: number; createdAt: string | null }>,
): void {
  if (hits.length === 0) return;
  const state = loadFile();
  const key = imageFeedFrontierKey(parts);
  const prev = state.frontiers[key] ?? emptyFrontier();

  let oldestMs = parseCreatedMs(prev.oldestProcessedAt);
  let oldestId = prev.oldestProcessedId;

  for (const hit of hits) {
    const ms = parseCreatedMs(hit.createdAt);
    if (ms == null) continue;
    if (oldestMs == null || ms < oldestMs) {
      oldestMs = ms;
      oldestId = hit.id;
    } else if (ms === oldestMs && (oldestId == null || hit.id < oldestId)) {
      oldestId = hit.id;
    }
  }

  if (oldestMs == null) return;

  state.frontiers[key] = {
    ...prev,
    oldestProcessedAt: new Date(oldestMs).toISOString(),
    oldestProcessedId: oldestId,
    updatedAt: new Date().toISOString(),
  };
  schedulePersist();
}

export function setConsecutiveKnownPages(
  parts: ImageFeedFrontierKeyParts,
  count: number,
): void {
  const state = loadFile();
  const key = imageFeedFrontierKey(parts);
  const prev = state.frontiers[key] ?? emptyFrontier();
  state.frontiers[key] = {
    ...prev,
    consecutiveKnownPages: Math.max(0, Math.round(count)),
    updatedAt: new Date().toISOString(),
  };
  schedulePersist();
}

/**
 * Record a finished drain. The tip watermark is the first-page newest **only
 * when this walk actually reached API end**. Catch-up / early-stop must not
 * promote the live first page — that claims the whole gap is covered and the
 * next Newest run stops immediately while unarchived cards still sit behind
 * the cursor (Browse “Continue” then “finds more since then”).
 */
export function markFeedCovered(
  parts: ImageFeedFrontierKeyParts,
  opts: {
    /** Newest hits from the first page of this drain (tip at start). */
    tipHits: Array<{ id: number; createdAt: string | null }>;
    /** Oldest-end / recent pages covered while draining. */
    coveredHits: Array<{ id: number; createdAt: string | null }>;
    /** True when Civitai returned no next cursor / empty end page. */
    exhausted: boolean;
  },
): void {
  noteProcessedHits(parts, opts.coveredHits);
  const tip = newestHit(opts.tipHits);
  const state = loadFile();
  const key = imageFeedFrontierKey(parts);
  const prev = state.frontiers[key] ?? emptyFrontier();
  const advanceTip = opts.exhausted && tip != null;
  state.frontiers[key] = {
    ...prev,
    coveredThroughNewestAt: advanceTip
      ? new Date(tip.ms).toISOString()
      : prev.coveredThroughNewestAt,
    coveredThroughNewestId: advanceTip ? tip.id : prev.coveredThroughNewestId,
    feedExhaustedAt: opts.exhausted
      ? new Date().toISOString()
      : prev.feedExhaustedAt,
    // First-pass deep resume is only for incomplete drains.
    firstPassResumeCursor: null,
    consecutiveKnownPages: 0,
    updatedAt: new Date().toISOString(),
  };
  schedulePersist();
}
