import { BrowserWindow } from 'electron';
import { CIVITAI_IMAGES_PAGE_LIMIT } from '../domain/civitaiImageTools.js';
import {
  civitaiCommunityMediaKind,
  civitaiHitMatchesRequestedMedia,
  CivitaiMediaTypeMismatchError,
} from '../domain/civitaiMediaType.js';
import { searchCivitaiVideos } from './civitaiClient.js';
import {
  downloadCivitaiVideo,
  isCivitaiVideoDownloaded,
  listDownloadedCivitaiVideoIds,
} from './civitaiVideoDownload.js';
import {
  feedHasCompletedPass,
  flushVideoFeedFrontiersSync,
  getVideoFeedFrontier,
  markFeedCovered,
  noteProcessedHits,
  pageIsAllKnown,
  setConsecutiveKnownPages,
  setFirstPassResumeCursor,
  shouldEarlyStopNewest,
  shouldEarlyStopRanked,
  shouldJumpToFirstPassResume,
  type VideoFeedFrontierKeyParts,
} from './civitaiVideoFeedFrontier.js';
import {
  archiveCivitaiVideo,
  getActiveLibrary,
  getCivitaiVideoBrowseFilters,
  listArchivedCivitaiVideos,
  loadSettings,
  setCivitaiVideoBrowseFilters,
} from './settingsStore.js';
import {
  IPC,
  type CivitaiImageBrowseFiltersDto,
  type CivitaiVideoDownloadAllSortStatsDto,
} from '../shared/contracts.js';
import { appendDownloadLog, formatErrorDetail } from './downloadLog.js';

/** Cap IPC/React churn while Download all is running. */
const STATUS_BROADCAST_MIN_MS = 1500;

type PageHit = {
  id: number;
  url: string;
  baseModel: string | null;
  username: string | null;
  createdAt: string | null;
  width: number | null;
};

export type CivitaiVideoDownloadAllRequest = {
  sort?: CivitaiImageBrowseFiltersDto['sort'];
  period?: CivitaiImageBrowseFiltersDto['period'];
  nsfwMode?: CivitaiImageBrowseFiltersDto['nsfwMode'];
  tool?: CivitaiImageBrowseFiltersDto['tool'];
  baseModels?: string[];
};

export type CivitaiVideoDownloadAllSortStats = CivitaiVideoDownloadAllSortStatsDto;

export type CivitaiVideoDownloadAllStatus = {
  active: boolean;
  sort: CivitaiImageBrowseFiltersDto['sort'];
  period: CivitaiImageBrowseFiltersDto['period'];
  nsfwMode: CivitaiImageBrowseFiltersDto['nsfwMode'];
  tool: CivitaiImageBrowseFiltersDto['tool'];
  baseModels: string[];
  saved: number;
  failed: number;
  skipped: number;
  phase: 'idle' | 'downloading' | 'pausing' | 'switching';
  /** @deprecated Sort cycling removed — always null. */
  pauseEndsAt: number | null;
  statusMessage: string | null;
  /** Latest image id saved during this run (for UI prune). */
  lastSavedImageId: number | null;
  /** Latest finished sort drain — insight panel payload. */
  lastSortStats: CivitaiVideoDownloadAllSortStats | null;
};

type RunnerConfig = {
  sort: CivitaiImageBrowseFiltersDto['sort'];
  period: CivitaiImageBrowseFiltersDto['period'];
  nsfwMode: CivitaiImageBrowseFiltersDto['nsfwMode'];
  tool: CivitaiImageBrowseFiltersDto['tool'];
  baseModels: string[];
};

let stopRequested = false;
let running = false;
let status: CivitaiVideoDownloadAllStatus = idleStatus();
let lastStatusBroadcastAt = 0;

function idleStatus(
  partial?: Partial<CivitaiVideoDownloadAllStatus>,
): CivitaiVideoDownloadAllStatus {
  const saved = getCivitaiVideoBrowseFilters();
  return {
    active: false,
    sort: saved.sort,
    period: saved.period,
    nsfwMode: saved.nsfwMode,
    tool: saved.tool,
    baseModels: [],
    saved: 0,
    failed: 0,
    skipped: 0,
    phase: 'idle',
    pauseEndsAt: null,
    statusMessage: null,
    lastSavedImageId: null,
    lastSortStats: null,
    ...partial,
  };
}

function parseHitMs(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function noteSeenRange(
  state: { newestMs: number | null; oldestMs: number | null },
  hits: PageHit[],
): void {
  for (const hit of hits) {
    const ms = parseHitMs(hit.createdAt);
    if (ms == null) continue;
    if (state.newestMs == null || ms > state.newestMs) state.newestMs = ms;
    if (state.oldestMs == null || ms < state.oldestMs) state.oldestMs = ms;
  }
}

function broadcastStatus(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(IPC.civitaiVideoDownloadAllProgress, { ...status });
    } catch {
      // ignore
    }
  }
}

function setStatus(
  patch: Partial<CivitaiVideoDownloadAllStatus>,
  opts?: { force?: boolean },
): void {
  status = { ...status, ...patch, active: running };
  const now = Date.now();
  const force =
    opts?.force === true ||
    !running ||
    status.phase === 'idle';
  if (!force && now - lastStatusBroadcastAt < STATUS_BROADCAST_MIN_MS) {
    return;
  }
  lastStatusBroadcastAt = now;
  broadcastStatus();
}

function requireVideosFolder(): void {
  const folder =
    getActiveLibrary().videosFolder?.trim() ||
    loadSettings().videosFolder?.trim();
  if (!folder) {
    throw new Error(
      'No videos folder configured — set one in Settings before downloading.',
    );
  }
}

/** Build skip Sets once per sort drain; mutate as we save/archive. */
function buildSkipSets(): {
  archived: Set<number>;
  downloaded: Set<number>;
} {
  return {
    archived: new Set(listArchivedCivitaiVideos().map((a) => a.imageId)),
    downloaded: new Set(listDownloadedCivitaiVideoIds()),
  };
}

function searchOpts(config: RunnerConfig, cursor: string | null) {
  const tool =
    config.tool !== 'any'
      ? (config.tool as Exclude<RunnerConfig['tool'], 'any'>)
      : null;
  return {
    cursor,
    limit: CIVITAI_IMAGES_PAGE_LIMIT,
    sort: config.sort,
    period: config.period,
    nsfwMode: config.nsfwMode,
    baseModels: config.baseModels.length ? config.baseModels : undefined,
    tools: tool ? [tool] : undefined,
    // Meta is only needed for client-side tool fingerprints.
    withMeta: Boolean(tool),
  };
}

function toPageHits(
  items: Array<{
    id: number;
    url: string;
    baseModel: string | null;
    username: string | null;
    createdAt: string | null;
    width?: number | null;
  }>,
): PageHit[] {
  return items.map((h) => ({
    id: h.id,
    url: h.url,
    baseModel: h.baseModel,
    username: h.username,
    createdAt: h.createdAt,
    width: h.width ?? null,
  }));
}

type DrainResult = {
  outcome: 'exhausted' | 'caught_up' | 'stopped';
  stats: CivitaiVideoDownloadAllSortStats;
};

/**
 * Walk one sort feed page-by-page. Only the current API page is retained.
 * Stops early when feed frontiers say older pages were already fully covered.
 *
 * Incomplete first pass: always start at the tip; after consecutive all-known
 * pages, jump to `firstPassResumeCursor` so interrupted deep walks resume.
 */
async function drainCurrentSort(config: RunnerConfig): Promise<DrainResult> {
  const skip = buildSkipSets();
  const keyParts: VideoFeedFrontierKeyParts = {
    sort: config.sort,
    period: config.period,
    nsfwMode: config.nsfwMode,
    tool: config.tool,
    baseModels: config.baseModels,
  };
  let frontier = getVideoFeedFrontier(keyParts);
  const frontierTipAtStart = frontier?.coveredThroughNewestAt ?? null;
  const savedResumeCursor =
    !feedHasCompletedPass(frontier) && frontier?.firstPassResumeCursor?.trim()
      ? frontier.firstPassResumeCursor.trim()
      : null;
  /** Tip catch-up until we jump (or no saved resume). */
  let inTipCatchUp = Boolean(savedResumeCursor);
  let jumpedToResume = false;
  let consecutiveKnownPages = 0;
  /** Tip page at drain start — becomes coveredThroughNewestAt when we finish. */
  let tipPage: PageHit[] = [];
  /** Recent pages this drain — used to deepen oldestProcessedAt. */
  const coveredThisDrain: PageHit[] = [];

  const startedAt = Date.now();
  const savedAtStart = status.saved;
  const failedAtStart = status.failed;
  const skippedAtStart = status.skipped;
  let pagesFetched = 0;
  let imagesSeen = 0;
  const seenRange = { newestMs: null as number | null, oldestMs: null as number | null };

  const finishCovered = (exhausted: boolean): void => {
    markFeedCovered(keyParts, {
      tipHits: tipPage,
      coveredHits: coveredThisDrain,
      exhausted,
    });
  };

  const observePage = (hits: PageHit[]): void => {
    pagesFetched += 1;
    imagesSeen += hits.length;
    noteSeenRange(seenRange, hits);
    if (hits.length > 0) {
      coveredThisDrain.push(...hits);
      if (coveredThisDrain.length > 500) {
        coveredThisDrain.splice(0, coveredThisDrain.length - 500);
      }
    }
  };

  /** Persist deep resume only while walking the first-pass frontier (not tip catch-up). */
  const rememberResumeCursor = (nextCursor: string | null): void => {
    if (feedHasCompletedPass(getVideoFeedFrontier(keyParts))) return;
    if (inTipCatchUp && !jumpedToResume) return;
    setFirstPassResumeCursor(keyParts, nextCursor);
  };

  let page: PageHit[] = [];
  let cursor: string | null = null;

  const advancePage = async (
    fromCursor: string,
  ): Promise<'ok' | 'exhausted'> => {
    const result = await searchCivitaiVideos(searchOpts(config, fromCursor));
    page = toPageHits(result.items);
    cursor = result.nextCursor;
    observePage(page);
    if (page.length === 0 && !cursor) return 'exhausted';
    return 'ok';
  };

  const buildStats = (
    outcome: DrainResult['outcome'],
  ): CivitaiVideoDownloadAllSortStats => ({
    sort: config.sort,
    outcome,
    saved: status.saved - savedAtStart,
    failed: status.failed - failedAtStart,
    skipped: status.skipped - skippedAtStart,
    pagesFetched,
    imagesSeen,
    newestSeenAt:
      seenRange.newestMs != null
        ? new Date(seenRange.newestMs).toISOString()
        : null,
    oldestSeenAt:
      seenRange.oldestMs != null
        ? new Date(seenRange.oldestMs).toISOString()
        : null,
    coveredThroughNewestAt: frontierTipAtStart,
    durationMs: Math.max(0, Date.now() - startedAt),
    nextSort: null,
    sessionSaved: status.saved,
    sessionFailed: status.failed,
    sessionSkipped: status.skipped,
    completedAt: new Date().toISOString(),
  });

  const finish = (outcome: DrainResult['outcome']): DrainResult => {
    const stats = buildStats(outcome);
    setStatus({ lastSortStats: stats }, { force: true });
    return { outcome, stats };
  };

  const first = await searchCivitaiVideos(searchOpts(config, null));
  page = toPageHits(first.items);
  cursor = first.nextCursor;
  tipPage = page.slice();
  observePage(page);

  while (!stopRequested) {
    const allKnown = pageIsAllKnown(page, skip);

    if (config.sort === 'Newest') {
      if (shouldEarlyStopNewest(page, frontier, skip)) {
        // Catch-up after a prior full exhaust — do not re-mark exhausted.
        finishCovered(false);
        appendDownloadLog(
          'info',
          `Video Download all early-stop Newest (covered through ${frontierTipAtStart ?? 'n/a'})`,
          { source: 'download' },
        );
        return finish('caught_up');
      }
    } else if (allKnown) {
      // Ranked sorts only — Newest uses coveredThroughNewestAt, not a streak.
      consecutiveKnownPages += 1;
      setConsecutiveKnownPages(keyParts, consecutiveKnownPages);
      if (shouldEarlyStopRanked(consecutiveKnownPages, frontier)) {
        finishCovered(false);
        appendDownloadLog(
          'info',
          `Video Download all early-stop ${config.sort} after ${consecutiveKnownPages} known pages`,
          { source: 'download' },
        );
        return finish('caught_up');
      }
    } else {
      consecutiveKnownPages = 0;
      setConsecutiveKnownPages(keyParts, 0);
    }

    // First-pass tip catch-up → jump (Newest + ranked while incomplete).
    if (allKnown) {
      if (config.sort === 'Newest') {
        consecutiveKnownPages += 1;
        setConsecutiveKnownPages(keyParts, consecutiveKnownPages);
      }
      if (
        shouldJumpToFirstPassResume(
          consecutiveKnownPages,
          frontier,
          jumpedToResume,
        ) &&
        savedResumeCursor
      ) {
        appendDownloadLog(
          'info',
          `Video Download all first-pass resume: tip catch-up done (${consecutiveKnownPages} known pages) → jump to saved cursor (${config.sort})`,
          { source: 'download' },
        );
        setStatus({
          phase: 'downloading',
          statusMessage: `Download all (${config.sort}): resuming first pass from saved cursor…`,
        });
        try {
          const jumped = await advancePage(savedResumeCursor);
          jumpedToResume = true;
          inTipCatchUp = false;
          consecutiveKnownPages = 0;
          setConsecutiveKnownPages(keyParts, 0);
          frontier = getVideoFeedFrontier(keyParts);
          if (jumped === 'exhausted') {
            if (page.length > 0) finishCovered(true);
            return finish('exhausted');
          }
          rememberResumeCursor(cursor);
          continue;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          appendDownloadLog(
            'warn',
            `Video Download all first-pass resume cursor failed — clearing and continuing from tip: ${message}`,
            { source: 'download' },
          );
          setFirstPassResumeCursor(keyParts, null);
          jumpedToResume = true;
          inTipCatchUp = false;
          consecutiveKnownPages = 0;
          frontier = getVideoFeedFrontier(keyParts);
          // Fall through and keep walking from the current tip-side page.
        }
      }
    } else if (config.sort === 'Newest') {
      consecutiveKnownPages = 0;
      setConsecutiveKnownPages(keyParts, 0);
    }

    const actionable = page.filter((hit) => {
      // Only skip files we already have. Browse “Archive” hides cards but must
      // not permanently block Download all for overnight / never-saved videos.
      if (skip.downloaded.has(hit.id)) {
        status.skipped += 1;
        return false;
      }
      if (
        !civitaiHitMatchesRequestedMedia(
          civitaiCommunityMediaKind({ url: hit.url }),
          'video',
        )
      ) {
        status.skipped += 1;
        return false;
      }
      return true;
    });

    if (actionable.length === 0) {
      noteProcessedHits(keyParts, page);
      frontier = getVideoFeedFrontier(keyParts);
      if (!cursor) {
        // Empty terminal page is not a trustworthy catalog end — do not move
        // the tip / exhausted watermark (same trap as Browse catch-up).
        if (page.length > 0) finishCovered(true);
        return finish('exhausted');
      }
      rememberResumeCursor(cursor);
      const advanced = await advancePage(cursor);
      if (advanced === 'exhausted') {
        if (page.length > 0) finishCovered(true);
        return finish('exhausted');
      }
      continue;
    }

    for (const hit of actionable) {
      if (stopRequested) return finish('stopped');

      if (isCivitaiVideoDownloaded(hit.id)) {
        skip.downloaded.add(hit.id);
        status.skipped += 1;
        continue;
      }

      try {
        setStatus({
          phase: 'downloading',
          pauseEndsAt: null,
          statusMessage:
            `Download all (${config.sort}): saved ${status.saved}` +
            (status.failed ? ` · ${status.failed} failed` : '') +
            '…',
        });
        await downloadCivitaiVideo({
          imageId: hit.id,
          url: hit.url,
          baseModel: hit.baseModel,
          username: hit.username,
          createdAt: hit.createdAt,
          width: hit.width,
        });
        skip.downloaded.add(hit.id);
        try {
          archiveCivitaiVideo(hit.id);
          skip.archived.add(hit.id);
        } catch (archErr) {
          appendDownloadLog(
            'warn',
            `Archive after video download failed: ${formatErrorDetail(archErr)}`,
            { source: 'download' },
          );
        }
        status.saved += 1;
        noteProcessedHits(keyParts, [hit]);
        frontier = getVideoFeedFrontier(keyParts);
        setStatus({
          lastSavedImageId: hit.id,
          statusMessage:
            `Download all (${config.sort}): saved ${status.saved}` +
            (status.failed ? ` · ${status.failed} failed` : '') +
            '…',
        });
      } catch (err) {
        status.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof CivitaiMediaTypeMismatchError) {
          status.skipped += 1;
          status.failed -= 1;
        } else if (/already queued|already downloaded/i.test(message)) {
          skip.downloaded.add(hit.id);
          status.skipped += 1;
          status.failed -= 1;
        } else {
          setStatus(
            { statusMessage: `Download all error: ${message}` },
            { force: true },
          );
          appendDownloadLog('error', message, { source: 'download' });
        }
      }
    }

    noteProcessedHits(keyParts, page);
    frontier = getVideoFeedFrontier(keyParts);

    if (stopRequested) {
      // Page finished downloading — keep resume at the next cursor.
      if (cursor) rememberResumeCursor(cursor);
      flushVideoFeedFrontiersSync();
      return finish('stopped');
    }

    if (!cursor) {
      finishCovered(true);
      return finish('exhausted');
    }
    rememberResumeCursor(cursor);
    const advanced = await advancePage(cursor);
    if (advanced === 'exhausted') {
      if (page.length > 0) finishCovered(true);
      return finish('exhausted');
    }
  }
  if (cursor) rememberResumeCursor(cursor);
  flushVideoFeedFrontiersSync();
  return finish('stopped');
}

async function runDownloadAll(config: RunnerConfig): Promise<void> {
  setStatus(
    {
      sort: config.sort,
      period: config.period,
      nsfwMode: config.nsfwMode,
      tool: config.tool,
      baseModels: config.baseModels,
      phase: 'downloading',
      lastSortStats: null,
      statusMessage: `Download all started (${config.sort} · ${config.period})…`,
    },
    { force: true },
  );

  setCivitaiVideoBrowseFilters({
    ...getCivitaiVideoBrowseFilters(),
    sort: config.sort,
    period: config.period,
    nsfwMode: config.nsfwMode,
    tool: config.tool,
  });

  const drain = await drainCurrentSort(config);
  const stopped = drain.outcome === 'stopped' || stopRequested;

  const summary =
    `Download all ${stopped ? 'stopped' : drain.outcome === 'caught_up' ? 'caught up' : 'finished'}: ${status.saved} saved` +
    (status.failed ? ` · ${status.failed} failed` : '') +
    (status.skipped ? ` · ${status.skipped} skipped` : '');
  running = false;
  stopRequested = false;
  setStatus(
    {
      active: false,
      phase: 'idle',
      pauseEndsAt: null,
      statusMessage: summary,
      lastSavedImageId: null,
      // Keep lastSortStats so the insight panel stays visible after stop.
    },
    { force: true },
  );
  appendDownloadLog('info', summary, { source: 'download' });
}

export function getCivitaiVideoDownloadAllStatus(): CivitaiVideoDownloadAllStatus {
  return { ...status, active: running };
}

export function isCivitaiVideoDownloadAllActive(): boolean {
  return running;
}

export function stopCivitaiVideoDownloadAll(): CivitaiVideoDownloadAllStatus {
  if (!running) return getCivitaiVideoDownloadAllStatus();
  stopRequested = true;
  setStatus(
    {
      statusMessage: 'Stopping download all (after current file)…',
    },
    { force: true },
  );
  return getCivitaiVideoDownloadAllStatus();
}

export function startCivitaiVideoDownloadAll(
  request: CivitaiVideoDownloadAllRequest = {},
): CivitaiVideoDownloadAllStatus {
  requireVideosFolder();
  if (running) {
    return getCivitaiVideoDownloadAllStatus();
  }

  const saved = getCivitaiVideoBrowseFilters();
  const config: RunnerConfig = {
    sort: request.sort ?? saved.sort,
    period: request.period ?? saved.period,
    nsfwMode: request.nsfwMode ?? saved.nsfwMode,
    tool: request.tool ?? saved.tool,
    baseModels: Array.isArray(request.baseModels)
      ? request.baseModels.filter((b) => typeof b === 'string' && b.trim())
      : [],
  };

  stopRequested = false;
  running = true;
  lastStatusBroadcastAt = 0;
  status = idleStatus({
    active: true,
    sort: config.sort,
    period: config.period,
    nsfwMode: config.nsfwMode,
    tool: config.tool,
    baseModels: config.baseModels,
    phase: 'downloading',
    statusMessage: `Download all started (${config.sort} · ${config.period})…`,
  });
  broadcastStatus();

  void runDownloadAll(config).catch((err) => {
    running = false;
    stopRequested = false;
    const message = err instanceof Error ? err.message : String(err);
    setStatus(
      {
        active: false,
        phase: 'idle',
        pauseEndsAt: null,
        statusMessage: `Download all failed: ${message}`,
      },
      { force: true },
    );
    appendDownloadLog('error', `Download all failed: ${message}`, {
      source: 'download',
    });
  });

  return getCivitaiVideoDownloadAllStatus();
}
