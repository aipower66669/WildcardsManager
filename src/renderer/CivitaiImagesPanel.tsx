import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Archive,
  ArchiveRestore,
  ChevronsDown,
  Download,
  ExternalLink,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Square,
  Sprout,
} from 'lucide-react';
import {
  CIVITAI_ARCHITECTURE_PRESETS,
  CIVITAI_SDXL_FAMILY_PRESETS,
  expandArchitectureApiValues,
  type CivitaiArchitectureId,
  type CivitaiSdxlFamilyId,
  type CivitaiSdxlFamilyToggleId,
} from '../domain/civitaiBaseModels';
import {
  CIVITAI_IMAGES_PAGE_LIMIT,
  CIVITAI_IMAGE_TOOL_PRESETS,
  type CivitaiImageToolId,
} from '../domain/civitaiImageTools';
import type {
  CivitaiArchitectureIdDto,
  CivitaiImageDownloadAllSortStatsDto,
  CivitaiImageDownloadAllStatusDto,
  CivitaiImageHitDto,
  CivitaiSdxlFamilyIdDto,
  DownloadedCivitaiImageDto,
} from '../shared/contracts';
import { CivitaiVirtualGrid } from './CivitaiVirtualGrid';
import {
  getFailedCivitaiThumbCount,
  retryAllFailedCivitaiThumbs,
  subscribeFailedCivitaiThumbs,
} from '../shared/civitaiMediaThumbRetryRegistry';
import { CivitaiMediaCardThumb } from './CivitaiMediaCardThumb';

type ImageTab = 'browse' | 'downloaded' | 'archive';

const IMAGE_SORTS = [
  'Newest',
  'Most Reactions',
  'Most Comments',
  'Most Collected',
] as const;

type ImageSort = (typeof IMAGE_SORTS)[number];

type ImagePeriod = 'AllTime' | 'Year' | 'Month' | 'Week' | 'Day';

const IMAGE_PERIODS: Array<{ id: ImagePeriod; label: string }> = [
  { id: 'AllTime', label: 'All time' },
  { id: 'Year', label: 'Year' },
  { id: 'Month', label: 'Month' },
  { id: 'Week', label: 'Week' },
  { id: 'Day', label: 'Day' },
];

/** Browse content filter — maps to Civitai `/images` `nsfw` query. */
type ImageNsfwMode = 'sfw' | 'all' | 'nsfw';

const IMAGE_NSFW_MODES: Array<{ id: ImageNsfwMode; label: string }> = [
  { id: 'sfw', label: 'SFW only' },
  { id: 'all', label: 'SFW + NSFW' },
  { id: 'nsfw', label: 'NSFW only' },
];

function SdxlFamilyIcon({
  id,
  size,
}: {
  id: CivitaiSdxlFamilyId;
  size: number;
}) {
  if (id === 'illustrious') return <Sparkles size={size} strokeWidth={2.25} />;
  if (id === 'noobai') return <Sprout size={size} strokeWidth={2.25} />;
  return <Layers size={size} strokeWidth={2.25} />;
}

function familyMetaLabel(id: CivitaiSdxlFamilyId): string {
  if (id === 'all') return 'All families';
  if (id === 'pony') return 'Pony';
  if (id === 'illustrious') return 'Illustrious';
  if (id === 'noobai') return 'NoobAI';
  return 'SDXL';
}

/** Compact calendar date for Newest-progress on image cards. */
function formatCardCreatedAt(iso: string, nowMs = Date.now()): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  const sameDay =
    date.getFullYear() === new Date(nowMs).getFullYear() &&
    date.getMonth() === new Date(nowMs).getMonth() &&
    date.getDate() === new Date(nowMs).getDate();
  // Newest can stay on "today" for hundreds of cards — show time so paging progress is visible.
  if (sameDay) {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function createdAtTitle(iso: string, nowMs: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'Posted on Civitai';
  const abs = new Date(ms).toLocaleString();
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(0, Math.floor((nowMs - ms) / dayMs));
  let age: string;
  if (days < 1) age = 'today';
  else if (days === 1) age = '1 day ago';
  else if (days < 60) age = `${days} days ago`;
  else {
    const months = Math.floor(days / 30);
    age = months === 1 ? '1 month ago' : `${months} months ago`;
  }
  return `Posted ${abs} (${age})`;
}

function formatInsightDate(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatInsightDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${sec}s`;
  return `${min}m ${sec.toString().padStart(2, '0')}s`;
}

function formatSpanDays(
  newestAt: string | null,
  oldestAt: string | null,
): string | null {
  if (!newestAt || !oldestAt) return null;
  const newest = Date.parse(newestAt);
  const oldest = Date.parse(oldestAt);
  if (!Number.isFinite(newest) || !Number.isFinite(oldest)) return null;
  const days = Math.max(0, Math.round((newest - oldest) / (24 * 60 * 60 * 1000)));
  if (days < 1) return 'same day';
  if (days === 1) return '1 day of history';
  if (days < 60) return `${days} days of history`;
  const months = Math.round(days / 30);
  return months === 1 ? '~1 month of history' : `~${months} months of history`;
}

function sortStatsHeadline(stats: CivitaiImageDownloadAllSortStatsDto): string {
  if (stats.outcome === 'caught_up') return `Caught up — ${stats.sort}`;
  if (stats.outcome === 'stopped') return `Stopped — ${stats.sort}`;
  return `Feed finished — ${stats.sort}`;
}

function sortStatsSubline(stats: CivitaiImageDownloadAllSortStatsDto): string {
  if (stats.outcome === 'caught_up') {
    if (stats.saved === 0 && stats.skipped > 0) {
      return stats.coveredThroughNewestAt
        ? `Tip already fully saved through ${formatInsightDate(stats.coveredThroughNewestAt)}. Krea (and other baseModels) Newest indexing looks stalled on Civitai — newer posts may be untagged and won’t appear in this filter yet.`
        : 'Already-saved tip pages; nothing new further down for these filters.';
    }
    return stats.coveredThroughNewestAt
      ? `Re-entered territory already covered through ${formatInsightDate(stats.coveredThroughNewestAt)} — no need to keep paging.`
      : 'This feed was fully walked before; already-known pages mean nothing new further down.';
  }
  if (stats.outcome === 'exhausted' && stats.saved === 0 && stats.skipped > 0) {
    return 'No never-saved images left for this Period / base / content filter.';
  }
  if (stats.outcome === 'stopped') {
    return 'Download all was stopped before this feed finished.';
  }
  return 'Civitai returned no further pages for this filter set.';
}

export type CivitaiMediaKind = 'image' | 'video';

export function CivitaiImagesPanel({
  kind = 'image',
  imagesFolderConfigured,
  nsfw: nsfwInitial,
  onStatus,
  onError,
}: {
  kind?: CivitaiMediaKind;
  imagesFolderConfigured: boolean;
  nsfw: boolean;
  onStatus: (message: string | null, tone?: 'notice' | 'error' | null) => void;
  onError: (message: string) => void;
}) {
  const [tab, setTab] = useState<ImageTab>('browse');
  const [sort, setSort] = useState<ImageSort>('Newest');
  const [period, setPeriod] = useState<ImagePeriod>('AllTime');
  const [nsfwMode, setNsfwMode] = useState<ImageNsfwMode>(
    nsfwInitial ? 'all' : 'sfw',
  );
  const [tool, setTool] = useState<CivitaiImageToolId>('any');
  /** Independent from LORA/Checkpoint browse architecture. */
  const [architecture, setArchitecture] =
    useState<CivitaiArchitectureIdDto>('krea');
  const [sdxlFamily, setSdxlFamily] =
    useState<CivitaiSdxlFamilyIdDto>('all');
  const [filtersReady, setFiltersReady] = useState(false);
  const imagePersistTimerRef = useRef<number | null>(null);
  const [items, setItems] = useState<CivitaiImageHitDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);
  /** True once any API page returned hits (even if all were archived/downloaded). */
  const [feedHadHits, setFeedHadHits] = useState(false);
  const [archived, setArchived] = useState<number[]>([]);
  const [downloaded, setDownloaded] = useState<DownloadedCivitaiImageDto[]>([]);
  /** Id-only list for browse skip Sets — avoids shipping full records at 100k+. */
  const [downloadedIds, setDownloadedIds] = useState<number[]>([]);
  const [queueIds, setQueueIds] = useState<Set<number>>(() => new Set());
  /** Ids archived in the UI ahead of IPC (spam-click hide). */
  const [pendingArchiveIds, setPendingArchiveIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [activeDownloadId, setActiveDownloadId] = useState<number | null>(null);
  const [downloadAllActive, setDownloadAllActive] = useState(false);
  const [downloadAllStatus, setDownloadAllStatus] =
    useState<CivitaiImageDownloadAllStatusDto | null>(null);
  const [sortStatsDismissed, setSortStatsDismissed] = useState(false);
  const failedThumbCount = useSyncExternalStore(
    subscribeFailedCivitaiThumbs,
    getFailedCivitaiThumbCount,
    getFailedCivitaiThumbCount,
  );
  const autoLoadRef = useRef(false);
  /** Consecutive all-downloaded pages this Browse walk (tip / ranked catch-up). */
  const consecutiveDownloadedPagesRef = useRef(0);
  /** First page of the current Browse walk — becomes the new tip on commit. */
  const browseTipHitsRef = useRef<
    Array<{ id: number; createdAt: string | null }>
  >([]);
  /** Recent pages covered this walk (capped), for frontier oldest watermark. */
  const browseCoveredHitsRef = useRef<
    Array<{ id: number; createdAt: string | null }>
  >([]);
  /** True after this Browse session jumped to firstPassResumeCursor. */
  const alreadyJumpedToResumeRef = useRef(false);
  /**
   * Tip catch-up told Browse to stop auto-paging. Cursor is kept so the user
   * can continue past the watermark for this run.
   */
  const catchUpHoldRef = useRef(false);
  /**
   * This Browse walk ignores the tip watermark until a fresh search.
   * Archived / downloaded cards are still skipped; only early-stop is off.
   */
  const ignoreTipThisRunRef = useRef(false);
  const [ignoreTipThisRun, setIgnoreTipThisRun] = useState(false);
  const [catchUpThrough, setCatchUpThrough] = useState<string | null>(null);
  /** True while Download all is running (ignore sort-change abort). */
  const downloadAllOwnsSortRef = useRef(false);
  const onStatusRef = useRef(onStatus);
  const onErrorRef = useRef(onError);
  onStatusRef.current = onStatus;
  onErrorRef.current = onError;

  const isVideo = kind === 'video';
  const mediaNoun = isVideo ? 'video' : 'image';
  const mediaNouns = isVideo ? 'videos' : 'images';
  const mediaTitle = isVideo ? 'Videos' : 'Images';
  const mediaApi = isVideo
    ? {
        listArchived: () => window.wcm.civitai.listArchivedVideos(),
        listDownloadedIds: () => window.wcm.civitai.listDownloadedVideoIds(),
        listDownloaded: () => window.wcm.civitai.listDownloadedVideos(),
        onDownloadProgress: window.wcm.civitai.onVideoDownloadProgress.bind(
          window.wcm.civitai,
        ),
        getBrowseFilters: () => window.wcm.ui.getCivitaiVideoBrowseFilters(),
        setBrowseFilters: (
          filters: Parameters<
            typeof window.wcm.ui.setCivitaiVideoBrowseFilters
          >[0],
        ) => window.wcm.ui.setCivitaiVideoBrowseFilters(filters),
        search: (
          params: Parameters<typeof window.wcm.civitai.searchVideos>[0],
        ) => window.wcm.civitai.searchVideos(params),
        archiveOne: (id: number) => window.wcm.civitai.archiveVideo(id),
        archiveMany: (ids: number[]) => window.wcm.civitai.archiveVideos(ids),
        unarchive: (id: number) => window.wcm.civitai.unarchiveVideo(id),
        download: (
          params: Parameters<typeof window.wcm.civitai.downloadVideo>[0],
        ) => window.wcm.civitai.downloadVideo(params),
        startDownloadAll: (
          params: Parameters<typeof window.wcm.civitai.startVideoDownloadAll>[0],
        ) => window.wcm.civitai.startVideoDownloadAll(params),
        stopDownloadAll: () => window.wcm.civitai.stopVideoDownloadAll(),
        getDownloadAllStatus: () =>
          window.wcm.civitai.getVideoDownloadAllStatus(),
        onDownloadAllProgress:
          window.wcm.civitai.onVideoDownloadAllProgress.bind(window.wcm.civitai),
        openDownloaded: (path: string) =>
          window.wcm.civitai.openDownloadedVideo(path),
        openFolder: () => window.wcm.ui.openVideosFolder(),
      }
    : {
        listArchived: () => window.wcm.civitai.listArchivedImages(),
        listDownloadedIds: () => window.wcm.civitai.listDownloadedImageIds(),
        listDownloaded: () => window.wcm.civitai.listDownloadedImages(),
        onDownloadProgress: window.wcm.civitai.onImageDownloadProgress.bind(
          window.wcm.civitai,
        ),
        getBrowseFilters: () => window.wcm.ui.getCivitaiImageBrowseFilters(),
        setBrowseFilters: (
          filters: Parameters<
            typeof window.wcm.ui.setCivitaiImageBrowseFilters
          >[0],
        ) => window.wcm.ui.setCivitaiImageBrowseFilters(filters),
        search: (
          params: Parameters<typeof window.wcm.civitai.searchImages>[0],
        ) => window.wcm.civitai.searchImages(params),
        archiveOne: (id: number) => window.wcm.civitai.archiveImage(id),
        archiveMany: (ids: number[]) => window.wcm.civitai.archiveImages(ids),
        unarchive: (id: number) => window.wcm.civitai.unarchiveImage(id),
        download: (
          params: Parameters<typeof window.wcm.civitai.downloadImage>[0],
        ) => window.wcm.civitai.downloadImage(params),
        startDownloadAll: (
          params: Parameters<typeof window.wcm.civitai.startImageDownloadAll>[0],
        ) => window.wcm.civitai.startImageDownloadAll(params),
        stopDownloadAll: () => window.wcm.civitai.stopImageDownloadAll(),
        getDownloadAllStatus: () =>
          window.wcm.civitai.getImageDownloadAllStatus(),
        onDownloadAllProgress:
          window.wcm.civitai.onImageDownloadAllProgress.bind(window.wcm.civitai),
        openDownloaded: (path: string) =>
          window.wcm.civitai.openDownloadedImage(path),
        openFolder: () => window.wcm.ui.openImagesFolder(),
      };

  const baseModels = useMemo(
    () =>
      expandArchitectureApiValues([architecture as CivitaiArchitectureId], {
        // Images/Videos: expand the full SDXL family set when "all"
        // (not limited by Settings-enabled families).
        sdxlFamilies:
          architecture === 'sdxl'
            ? sdxlFamily !== 'all'
              ? [sdxlFamily as CivitaiSdxlFamilyToggleId]
              : ['sdxl', 'pony', 'illustrious', 'noobai']
            : undefined,
      }),
    [architecture, sdxlFamily],
  );

  const selectArchitecture = useCallback((id: CivitaiArchitectureIdDto) => {
    setArchitecture(id);
    if (id !== 'sdxl') setSdxlFamily('all');
  }, []);

  const browseFiltersRef = useRef({
    tab,
    sort,
    period,
    nsfwMode,
    tool,
    baseModelsKey: baseModels.join('|'),
  });

  const archivedSet = useMemo(() => new Set(archived), [archived]);
  const downloadedSet = useMemo(
    () => new Set(downloadedIds),
    [downloadedIds],
  );
  /** Ids that must not appear on Browse (archived or already saved). */
  const downloadedIdsRef = useRef<Set<number>>(new Set());
  downloadedIdsRef.current = downloadedSet;

  const hiddenBrowseIdsRef = useRef<Set<number>>(new Set());
  hiddenBrowseIdsRef.current = new Set([...archivedSet, ...downloadedSet]);

  const removeFromBrowse = useCallback((imageIds: Iterable<number>) => {
    const remove = new Set(
      [...imageIds].filter((id) => Number.isFinite(id)).map((id) => Math.round(id)),
    );
    if (remove.size === 0) return;
    for (const id of remove) hiddenBrowseIdsRef.current.add(id);
    setItems((prev) => {
      const next = prev.filter((i) => !remove.has(i.id));
      return next.length === prev.length ? prev : next;
    });
  }, []);

  // Browse only keeps actionable cards; archived/downloaded/queued are gone.
  const visibleBrowse = useMemo(
    () =>
      items.filter(
        (i) =>
          !archivedSet.has(i.id) &&
          !downloadedSet.has(i.id) &&
          !queueIds.has(i.id) &&
          !pendingArchiveIds.has(i.id),
      ),
    [items, archivedSet, downloadedSet, queueIds, pendingArchiveIds],
  );

  // Drop cards that became archived/downloaded (e.g. download-all, other tab).
  useEffect(() => {
    if (archivedSet.size === 0 && downloadedSet.size === 0) return;
    setItems((prev) => {
      const next = prev.filter(
        (i) => !archivedSet.has(i.id) && !downloadedSet.has(i.id),
      );
      return next.length === prev.length ? prev : next;
    });
  }, [archivedSet, downloadedSet]);

  const refreshMeta = useCallback(async () => {
    const [arch, dlIds] = await Promise.all([
      mediaApi.listArchived(),
      mediaApi.listDownloadedIds(),
    ]);
    setArchived(arch);
    setDownloadedIds(dlIds);
    const hidden = new Set([...arch, ...dlIds]);
    hiddenBrowseIdsRef.current = hidden;
    setItems((prev) => {
      const next = prev.filter((i) => !hidden.has(i.id));
      return next.length === prev.length ? prev : next;
    });
  }, [kind]);

  const refreshDownloadedRecords = useCallback(async () => {
    const dl = await mediaApi.listDownloaded();
    setDownloaded(dl);
    setDownloadedIds(dl.map((d) => d.imageId));
  }, [kind]);

  const releaseQueueId = useCallback((imageId: number) => {
    setQueueIds((prev) => {
      if (!prev.has(imageId)) return prev;
      const next = new Set(prev);
      next.delete(imageId);
      return next;
    });
    setActiveDownloadId((prev) => (prev === imageId ? null : prev));
  }, []);

  useEffect(() => {
    setNsfwMode(nsfwInitial ? 'all' : 'sfw');
  }, [nsfwInitial]);

  useEffect(() => {
    void refreshMeta().catch((err) =>
      onErrorRef.current(err instanceof Error ? err.message : String(err)),
    );
  }, [refreshMeta, kind]);

  useEffect(() => {
    return mediaApi.onDownloadProgress((p) => {
      if (p.phase === 'queued' && p.imageId > 0) {
        setQueueIds((prev) => {
          if (prev.has(p.imageId)) return prev;
          const next = new Set(prev);
          next.add(p.imageId);
          return next;
        });
      }
      if (p.phase === 'active' && p.imageId > 0) {
        setActiveDownloadId(p.imageId);
        setQueueIds((prev) => {
          if (prev.has(p.imageId)) return prev;
          const next = new Set(prev);
          next.add(p.imageId);
          return next;
        });
      }
      if (!(p.done && p.imageId > 0)) {
        if (p.error) onErrorRef.current(p.error);
        return;
      }

      if (p.error) {
        releaseQueueId(p.imageId);
        onErrorRef.current(p.error);
        return;
      }

      // Remove from Browse immediately — saved images must not linger in the grid.
      removeFromBrowse([p.imageId]);
      setDownloadedIds((prev) =>
        prev.includes(p.imageId) ? prev : [...prev, p.imageId],
      );
      onStatusRef.current(
        p.statusMessage ?? `Saved ${p.fileName ?? mediaNoun}`,
        'notice',
      );
      void refreshMeta()
        .catch((err) =>
          onErrorRef.current(err instanceof Error ? err.message : String(err)),
        )
        .finally(() => {
          releaseQueueId(p.imageId);
          if ((p.queuedCount ?? 0) === 0) setActiveDownloadId(null);
        });
    });
  }, [refreshMeta, releaseQueueId, removeFromBrowse]);

  useEffect(() => {
    let cancelled = false;
    void mediaApi
      .getBrowseFilters()
      .then((filters) => {
        if (cancelled) return;
        setSort(filters.sort);
        setPeriod(filters.period);
        setNsfwMode(filters.nsfwMode);
        setTool(filters.tool);
        setTab(filters.tab);
        setArchitecture(filters.architecture);
        setSdxlFamily(
          filters.architecture === 'sdxl' ? filters.sdxlFamily : 'all',
        );
        setFiltersReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Fall back to defaults / nsfwInitial already applied.
        setFiltersReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!filtersReady) return;
    if (imagePersistTimerRef.current !== null) {
      window.clearTimeout(imagePersistTimerRef.current);
    }
    imagePersistTimerRef.current = window.setTimeout(() => {
      imagePersistTimerRef.current = null;
      void mediaApi
        .setBrowseFilters({
          sort,
          period,
          nsfwMode,
          tool,
          tab,
          architecture,
          sdxlFamily: architecture === 'sdxl' ? sdxlFamily : 'all',
        })
        .catch(() => {
          // Persistence is best-effort.
        });
    }, 200);
    return () => {
      if (imagePersistTimerRef.current !== null) {
        window.clearTimeout(imagePersistTimerRef.current);
      }
    };
  }, [
    filtersReady,
    sort,
    period,
    nsfwMode,
    tool,
    tab,
    architecture,
    sdxlFamily,
    kind,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const runSearch = useCallback(
    async (opts?: {
      cursor?: string | null;
      append?: boolean;
      /** Override current sort while Download all is active. */
      sort?: ImageSort;
    }): Promise<{
      items: CivitaiImageHitDto[];
      nextCursor: string | null;
    } | null> => {
      const append = opts?.append === true;
      const activeSort = opts?.sort ?? sort;
      if (append) setLoadingMore(true);
      else setBusy(true);
      try {
        if (!append) {
          consecutiveDownloadedPagesRef.current = 0;
          browseTipHitsRef.current = [];
          browseCoveredHitsRef.current = [];
          alreadyJumpedToResumeRef.current = false;
          catchUpHoldRef.current = false;
          ignoreTipThisRunRef.current = false;
          setIgnoreTipThisRun(false);
          setCatchUpThrough(null);
        }
        const ignoreEarlyStop = ignoreTipThisRunRef.current;
        const result = await mediaApi.search({
          cursor: opts?.cursor ?? null,
          limit: CIVITAI_IMAGES_PAGE_LIMIT,
          sort: activeSort,
          period,
          nsfwMode,
          baseModels: baseModels.length ? baseModels : undefined,
          tools: tool === 'any' ? undefined : [tool],
          withMeta: true,
        });
        const hidden = hiddenBrowseIdsRef.current;
        const pageItems = result.items;
        const pageHits = pageItems.map((hit) => ({
          id: hit.id,
          createdAt: hit.createdAt,
        }));
        if (!append) {
          browseTipHitsRef.current = pageHits;
        }
        if (pageHits.length > 0) {
          browseCoveredHitsRef.current.push(...pageHits);
          if (browseCoveredHitsRef.current.length > 500) {
            browseCoveredHitsRef.current.splice(
              0,
              browseCoveredHitsRef.current.length - 500,
            );
          }
        }

        const keyParts = {
          sort: activeSort,
          period,
          nsfwMode,
          tool,
          baseModels,
        };
        const catchUp = await window.wcm.civitai.evaluateBrowseCatchUp({
          media: isVideo ? 'video' : 'image',
          keyParts,
          page: pageHits,
          consecutiveDownloadedPages: consecutiveDownloadedPagesRef.current,
          append,
          alreadyJumpedToResume: alreadyJumpedToResumeRef.current,
          ignoreEarlyStop,
        });
        consecutiveDownloadedPagesRef.current =
          catchUp.consecutiveDownloadedPages;

        if (!append) {
          setFeedHadHits(pageItems.length > 0);
        } else if (pageItems.length > 0) {
          setFeedHadHits(true);
        }
        const incoming = pageItems.filter((hit) => !hidden.has(hit.id));
        setItems((prev) => {
          if (!append) return incoming;
          const seen = new Set(prev.map((h) => h.id));
          const merged = [...prev];
          for (const hit of incoming) {
            if (seen.has(hit.id) || hidden.has(hit.id)) continue;
            seen.add(hit.id);
            merged.push(hit);
          }
          return merged;
        });

        let next: string | null = result.nextCursor;
        if (catchUp.jumpToCursor) {
          alreadyJumpedToResumeRef.current = true;
          next = catchUp.jumpToCursor;
        } else if (catchUp.earlyStop) {
          await window.wcm.civitai.commitBrowseCatchUp({
            media: isVideo ? 'video' : 'image',
            keyParts,
            tipHits: browseTipHitsRef.current,
            coveredHits: browseCoveredHitsRef.current,
            exhausted: false,
          });
          // Keep the API cursor — auto-load holds until “Continue to end”.
          catchUpHoldRef.current = true;
          setCatchUpThrough(catchUp.coveredThroughNewestAt ?? null);
          next = result.nextCursor;
        } else if (!result.nextCursor) {
          // Empty + no cursor is often a Civitai blip, not catalog end. Writing
          // tip/exhausted from that poisons every later pass (stops too early).
          if (pageItems.length > 0) {
            await window.wcm.civitai.commitBrowseCatchUp({
              media: isVideo ? 'video' : 'image',
              keyParts,
              tipHits: browseTipHitsRef.current,
              coveredHits: browseCoveredHitsRef.current,
              exhausted: true,
            });
          }
          catchUpHoldRef.current = false;
          setCatchUpThrough(null);
          ignoreTipThisRunRef.current = false;
          setIgnoreTipThisRun(false);
          next = null;
        } else {
          await window.wcm.civitai.noteBrowseResumeCursor({
            media: isVideo ? 'video' : 'image',
            keyParts,
            cursor: result.nextCursor,
            alreadyJumpedToResume: alreadyJumpedToResumeRef.current,
          });
        }

        setNextCursor(next);
        setSearched(true);
        return {
          items: result.items,
          nextCursor: next,
        };
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setBusy(false);
        setLoadingMore(false);
      }
    },
    [sort, period, nsfwMode, baseModels, tool, onError, isVideo],
  );

  useEffect(() => {
    const baseModelsKey = baseModels.join('|');
    const prev = browseFiltersRef.current;
    const sortOnlyChanged =
      prev.sort !== sort &&
      prev.tab === tab &&
      prev.period === period &&
      prev.nsfwMode === nsfwMode &&
      prev.tool === tool &&
      prev.baseModelsKey === baseModelsKey;
    browseFiltersRef.current = {
      tab,
      sort,
      period,
      nsfwMode,
      tool,
      baseModelsKey,
    };

    if (!filtersReady) return;
    if (tab !== 'browse') {
      return;
    }
    // Download all cycles sorts itself — don't abort or race a second search.
    if (
      downloadAllActive &&
      downloadAllOwnsSortRef.current &&
      sortOnlyChanged
    ) {
      return;
    }
    void runSearch();
  }, [filtersReady, tab, sort, period, nsfwMode, tool, baseModels.join('|'), downloadAllActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Full records only when viewing Downloaded (ids Set is enough for Browse).
  useEffect(() => {
    if (!filtersReady || tab !== 'downloaded') return;
    void refreshDownloadedRecords().catch((err) =>
      onErrorRef.current(err instanceof Error ? err.message : String(err)),
    );
  }, [filtersReady, tab, refreshDownloadedRecords]);

  const continuePastTipToEnd = useCallback(() => {
    if (!nextCursor || busy || loadingMore || downloadAllActive) return;
    ignoreTipThisRunRef.current = true;
    setIgnoreTipThisRun(true);
    catchUpHoldRef.current = false;
    setCatchUpThrough(null);
    void runSearch({ cursor: nextCursor, append: true });
  }, [nextCursor, busy, loadingMore, downloadAllActive, runSearch]);

  // Auto page when Browse is empty because items are archived or already downloaded.
  useEffect(() => {
    if (tab !== 'browse' || !searched || busy || loadingMore) return;
    if (downloadAllActive) return;
    // Tip catch-up: hold until the user chooses Continue to end.
    if (catchUpHoldRef.current && !ignoreTipThisRunRef.current) {
      autoLoadRef.current = false;
      return;
    }
    if (visibleBrowse.length > 0 || !nextCursor) {
      autoLoadRef.current = false;
      return;
    }
    if (autoLoadRef.current) return;
    // Yield so Archive / Refresh stay clickable while walking hidden pages.
    const timer = window.setTimeout(() => {
      if (autoLoadRef.current) return;
      autoLoadRef.current = true;
      void runSearch({ cursor: nextCursor, append: true }).finally(() => {
        autoLoadRef.current = false;
      });
    }, 40);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    tab,
    searched,
    busy,
    loadingMore,
    downloadAllActive,
    visibleBrowse.length,
    nextCursor,
    ignoreTipThisRun,
    runSearch,
  ]);

  const releasePendingArchive = useCallback((imageId: number) => {
    setPendingArchiveIds((prev) => {
      if (!prev.has(imageId)) return prev;
      const next = new Set(prev);
      next.delete(imageId);
      return next;
    });
  }, []);

  const archiveImage = (imageId: number) => {
    if (archivedSet.has(imageId) || pendingArchiveIds.has(imageId)) return;
    // Instant hide — same feel as download queue; IPC catches up in the background.
    setPendingArchiveIds((prev) => {
      const next = new Set(prev);
      next.add(imageId);
      return next;
    });
    onStatus(`Archived ${mediaNoun} #${imageId}`, 'notice');
    void mediaApi
      .archiveOne(imageId)
      .then(() => {
        setArchived((prev) => (prev.includes(imageId) ? prev : [...prev, imageId]));
        releasePendingArchive(imageId);
        removeFromBrowse([imageId]);
      })
      .catch((err) => {
        releasePendingArchive(imageId);
        onError(err instanceof Error ? err.message : String(err));
      });
  };

  const archiveAllShowing = () => {
    const ids = visibleBrowse.map((i) => i.id);
    if (ids.length === 0) return;
    setPendingArchiveIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    onStatus(`Archiving ${ids.length} ${mediaNoun}${ids.length === 1 ? '' : 's'}…`, 'notice');
    void mediaApi
      .archiveMany(ids)
      .then((result) => {
        setArchived((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.add(id);
          return [...next];
        });
        setPendingArchiveIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
        removeFromBrowse(ids);
        onStatus(
          result.archivedCount > 0
            ? `Archived ${result.archivedCount} showing ${mediaNoun}${
                result.archivedCount === 1 ? '' : 's'
              }`
            : 'Nothing new to archive',
          'notice',
        );
      })
      .catch((err) => {
        setPendingArchiveIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
        onError(err instanceof Error ? err.message : String(err));
      });
  };

  const unarchiveImage = (imageId: number) => {
    const prevArchived = archived;
    setArchived((prev) => prev.filter((id) => id !== imageId));
    void mediaApi.unarchive(imageId).catch((err) => {
      setArchived(prevArchived);
      onError(err instanceof Error ? err.message : String(err));
    });
  };

  const downloadImage = async (hit: CivitaiImageHitDto) => {
    if (!imagesFolderConfigured) {
      onError(`Set a ${mediaNouns} folder in Settings before downloading.`);
      return;
    }
    if (queueIds.has(hit.id) || downloadedSet.has(hit.id)) return;
    setQueueIds((prev) => {
      const next = new Set(prev);
      next.add(hit.id);
      return next;
    });
    onStatus(`Queued ${mediaNoun} #${hit.id}`, 'notice');
    try {
      // Progress handler refreshes downloaded meta, then releases queueIds
      // (keeps the card hidden so Browse does not flash).
      await mediaApi.download({
        imageId: hit.id,
        url: hit.url,
        baseModel: hit.baseModel,
        username: hit.username,
        createdAt: hit.createdAt,
        width: hit.width,
      });
    } catch (err) {
      releaseQueueId(hit.id);
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const applyDownloadAllStatus = useCallback(
    (s: CivitaiImageDownloadAllStatusDto) => {
      setDownloadAllActive(s.active);
      setDownloadAllStatus(s);
      downloadAllOwnsSortRef.current = s.active;
      if (s.lastSortStats) setSortStatsDismissed(false);
    },
    [],
  );

  const stopDownloadAll = useCallback(() => {
    void mediaApi
      .stopDownloadAll()
      .then((s) => {
        applyDownloadAllStatus(s);
        if (s.statusMessage) onStatus(s.statusMessage, 'notice');
      })
      .catch((err) =>
        onError(err instanceof Error ? err.message : String(err)),
      );
  }, [applyDownloadAllStatus, kind, onError, onStatus]);

  const startDownloadAll = useCallback(async () => {
    if (!imagesFolderConfigured) {
      onError(`Set a ${mediaNouns} folder in Settings before downloading.`);
      return;
    }
    try {
      downloadAllOwnsSortRef.current = true;
      setSortStatsDismissed(false);
      const s = await mediaApi.startDownloadAll({
        sort,
        period,
        nsfwMode,
        tool,
        baseModels,
      });
      applyDownloadAllStatus(s);
      if (s.statusMessage) onStatus(s.statusMessage, 'notice');
    } catch (err) {
      downloadAllOwnsSortRef.current = false;
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [
    applyDownloadAllStatus,
    baseModels,
    imagesFolderConfigured,
    nsfwMode,
    onError,
    onStatus,
    period,
    sort,
    tool,
    kind,
  ]);

  // Reconnect to a background Download all that survived leaving this tab.
  useEffect(() => {
    let cancelled = false;
    void mediaApi.getDownloadAllStatus().then((s) => {
      if (cancelled) return;
      applyDownloadAllStatus(s);
      if (s.active) {
        if (s.sort !== sort) setSort(s.sort);
        if (s.period !== period) setPeriod(s.period);
        if (s.nsfwMode !== nsfwMode) setNsfwMode(s.nsfwMode);
        if (s.tool !== tool) setTool(s.tool);
        if (s.statusMessage) onStatusRef.current(s.statusMessage, 'notice');
      }
    });
    return () => {
      cancelled = true;
    };
    // Only on mount — live updates come from the progress subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return mediaApi.onDownloadAllProgress((s) => {
      applyDownloadAllStatus(s);
      if (s.sort) {
        setSort((prev) => (prev === s.sort ? prev : (s.sort as ImageSort)));
      }
      if (s.period) {
        setPeriod((prev) =>
          prev === s.period ? prev : (s.period as ImagePeriod),
        );
      }
      if (s.lastSavedImageId != null) {
        removeFromBrowse([s.lastSavedImageId]);
        setDownloadedIds((prev) =>
          prev.includes(s.lastSavedImageId!)
            ? prev
            : [...prev, s.lastSavedImageId!],
        );
      }
      if (s.statusMessage) {
        const tone =
          /failed|error/i.test(s.statusMessage) && !s.active
            ? 'error'
            : 'notice';
        onStatusRef.current(s.statusMessage, tone);
      }
      if (!s.active) {
        void refreshMeta().catch(() => {
          // best-effort
        });
      }
    });
  }, [applyDownloadAllStatus, removeFromBrowse, refreshMeta]);

  const sortStats = downloadAllStatus?.lastSortStats ?? null;
  const showSortStats =
    Boolean(sortStats) && !sortStatsDismissed && !downloadAllActive;

  const downloadedFiltered = useMemo(() => {
    if (!baseModels.length) return downloaded;
    const set = new Set(baseModels.map((b) => b.toLowerCase()));
    return downloaded.filter(
      (d) =>
        set.has(d.baseModel.toLowerCase()) ||
        (d.baseModel === '_unknown' && set.size === 0),
    );
  }, [downloaded, baseModels]);

  const archivedRows = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    return archived.map((imageId) => ({
      imageId,
      hit: byId.get(imageId) ?? null,
    }));
  }, [archived, items]);

  const renderCard = (
    hit: CivitaiImageHitDto,
    opts: { archived?: boolean; downloaded?: boolean },
  ) => {
    const isDl = opts.downloaded || downloadedSet.has(hit.id);
    const isArch = opts.archived || archivedSet.has(hit.id);
    const hideBaseMeta = baseModels.length > 0;
    const dateLabel = hit.createdAt
      ? formatCardCreatedAt(hit.createdAt)
      : null;
    const downloadTitle = !imagesFolderConfigured
      ? `Configure ${mediaNouns} folder in Settings`
      : activeDownloadId === hit.id
        ? 'Downloading…'
        : queueIds.has(hit.id)
          ? 'Queued'
          : isDl
            ? 'Already downloaded'
            : 'Download';
    return (
      <div className="civitai-image-card">
        <CivitaiMediaCardThumb mediaUrl={hit.url} isVideo={isVideo}>
          {isDl ? <span className="civitai-image-badge">Saved</span> : null}
          {isArch ? (
            <span className="civitai-image-badge archived">Archived</span>
          ) : null}
        </CivitaiMediaCardThumb>
        {!hideBaseMeta || hit.username || dateLabel ? (
          <div className="civitai-image-meta">
            {!hideBaseMeta ? <strong>#{hit.id}</strong> : null}
            {!hideBaseMeta ? (
              <span>{hit.baseModel ?? 'Unknown base'}</span>
            ) : null}
            {hit.username ? <span>@{hit.username}</span> : null}
            {dateLabel && hit.createdAt ? (
              <span
                className="civitai-card-date"
                title={createdAtTitle(hit.createdAt, Date.now())}
              >
                {dateLabel}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="civitai-card-actions">
          {isArch ? (
            <span className="civitai-icon-btn-spacer" aria-hidden />
          ) : (
            <button
              type="button"
              className="civitai-icon-btn action-download"
              disabled={
                queueIds.has(hit.id) ||
                downloadedSet.has(hit.id) ||
                !imagesFolderConfigured
              }
              title={downloadTitle}
              aria-label={downloadTitle}
              onClick={() => void downloadImage(hit)}
            >
              {activeDownloadId === hit.id ? (
                <Loader2 size={20} className="spin" />
              ) : (
                <Download size={20} />
              )}
            </button>
          )}
          {isArch ? (
            <button
              type="button"
              className="civitai-icon-btn action-archive"
              title="Unarchive"
              aria-label="Unarchive"
              onClick={() => void unarchiveImage(hit.id)}
            >
              <ArchiveRestore size={20} />
            </button>
          ) : (
            <button
              type="button"
              className="civitai-icon-btn action-archive"
              title="Archive"
              aria-label="Archive"
              onClick={() => void archiveImage(hit.id)}
            >
              <Archive size={20} />
            </button>
          )}
          <a
            className="civitai-icon-btn action-open"
            href={`https://civitai.com/images/${hit.id}`}
            target="_blank"
            rel="noreferrer"
            title="Open on Civitai"
            aria-label="Open on Civitai"
          >
            <ExternalLink size={20} />
          </a>
        </div>
      </div>
    );
  };

  return (
    <div className="civitai-images-panel">
      <div className="civitai-images-toolbar">
        <div className="segmented civitai-tabs" role="tablist">
          <button
            type="button"
            className={tab === 'browse' ? 'active' : ''}
            onClick={() => setTab('browse')}
          >
            <ImageIcon size={13} /> Browse
          </button>
          <button
            type="button"
            className={tab === 'downloaded' ? 'active' : ''}
            onClick={() => setTab('downloaded')}
          >
            Downloaded ({downloadedIds.length})
          </button>
          <button
            type="button"
            className={tab === 'archive' ? 'active' : ''}
            onClick={() => setTab('archive')}
          >
            Archive ({archived.length})
          </button>
        </div>
        {tab === 'browse' ? (
          <>
            <label className="civitai-base-model-label" htmlFor="civitai-images-base-model">
              Base Model
            </label>
            <select
              id="civitai-images-base-model"
              className="civitai-architecture-select"
              value={architecture}
              aria-label="Base Model"
              disabled={busy}
              onChange={(e) =>
                selectArchitecture(
                  e.target.value as CivitaiArchitectureIdDto,
                )
              }
            >
              {CIVITAI_ARCHITECTURE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
            {architecture === 'sdxl' ? (
              <div
                className="civitai-chip-row civitai-sdxl-family-row"
                role="group"
                aria-label="SDXL family"
              >
                {CIVITAI_SDXL_FAMILY_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`civitai-chip civitai-sdxl-family-chip${
                      sdxlFamily === preset.id ? ' active' : ''
                    }`}
                    disabled={busy}
                    title={
                      preset.id === 'all'
                        ? 'All SDXL families'
                        : familyMetaLabel(preset.id as CivitaiSdxlFamilyId)
                    }
                    aria-pressed={sdxlFamily === preset.id}
                    onClick={() =>
                      setSdxlFamily(preset.id as CivitaiSdxlFamilyIdDto)
                    }
                  >
                    <SdxlFamilyIcon
                      id={preset.id as CivitaiSdxlFamilyId}
                      size={12}
                    />
                    <span>
                      {familyMetaLabel(preset.id as CivitaiSdxlFamilyId)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <label className="civitai-base-model-label" htmlFor="civitai-images-tool">
              Tools
            </label>
            <select
              id="civitai-images-tool"
              className="civitai-architecture-select"
              value={tool}
              aria-label="Tools"
              title="Created with… — filters by generator fingerprints in image metadata"
              disabled={busy || downloadAllActive}
              onChange={(e) => setTool(e.target.value as CivitaiImageToolId)}
            >
              {CIVITAI_IMAGE_TOOL_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
            <select
              className="civitai-sort-select"
              value={sort}
              title="Civitai re-queries each sort as its own ranked feed (not a local reorder of one page)"
              disabled={busy || downloadAllActive}
              onChange={(e) => setSort(e.target.value as ImageSort)}
            >
              {IMAGE_SORTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="civitai-sort-select"
              value={period}
              aria-label="Period"
              title="Civitai time window for this sort. If Newest looks stuck on All time, try Day or Week."
              disabled={busy || downloadAllActive}
              onChange={(e) => setPeriod(e.target.value as ImagePeriod)}
            >
              {IMAGE_PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              className="civitai-sort-select"
              value={nsfwMode}
              aria-label="Content rating"
              title={`Civitai ${mediaNoun} content filter. NSFW only uses the API’s nsfw=true mode.`}
              disabled={busy || downloadAllActive}
              onChange={(e) => setNsfwMode(e.target.value as ImageNsfwMode)}
            >
              {IMAGE_NSFW_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <div className="civitai-images-actions" role="toolbar" aria-label={`${mediaTitle} actions`}>
          {tab === 'browse' ? (
            <>
              <button
                type="button"
                className="ghost-btn icon-only"
                disabled={busy}
                title="Refresh browse results"
                aria-label="Refresh"
                onClick={() => void runSearch()}
              >
                {busy ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
              </button>
              <button
                type="button"
                className={`ghost-btn icon-only${ignoreTipThisRun ? ' is-active' : ''}`}
                disabled={
                  busy ||
                  loadingMore ||
                  downloadAllActive ||
                  ignoreTipThisRun ||
                  !nextCursor
                }
                title={
                  ignoreTipThisRun
                    ? 'This run is already ignoring the tip watermark and will walk until Civitai has no more pages. Archived/downloaded cards stay hidden.'
                    : 'This run only: ignore the tip watermark and keep paging until the catalog ends. Still skips archived/downloaded cards.'
                }
                aria-label={
                  ignoreTipThisRun
                    ? 'Ignoring tip this run'
                    : 'Continue to end, ignore tip'
                }
                onClick={() => continuePastTipToEnd()}
              >
                <ChevronsDown size={16} />
              </button>
              <button
                type="button"
                className="ghost-btn icon-only"
                disabled={
                  busy || visibleBrowse.length === 0 || downloadAllActive
                }
                title={
                  visibleBrowse.length > 0
                    ? `Archive all showing (${visibleBrowse.length})`
                    : 'Archive all showing'
                }
                aria-label={
                  visibleBrowse.length > 0
                    ? `Archive all showing (${visibleBrowse.length})`
                    : 'Archive all showing'
                }
                onClick={() => void archiveAllShowing()}
              >
                <Archive size={16} />
              </button>
              <button
                type="button"
                className={`ghost-btn icon-only${downloadAllActive ? ' is-danger' : ''}`}
                disabled={
                  !imagesFolderConfigured ||
                  (!downloadAllActive &&
                    busy &&
                    visibleBrowse.length === 0 &&
                    !nextCursor)
                }
                title={
                  downloadAllActive
                    ? `Stop download all after the current file finishes`
                    : `Start download all for current filters until the feed is exhausted`
                }
                aria-label={downloadAllActive ? 'Stop download' : 'Start download'}
                onClick={() => {
                  if (downloadAllActive) stopDownloadAll();
                  else void startDownloadAll();
                }}
              >
                {downloadAllActive ? (
                  <Square size={16} />
                ) : (
                  <Download size={16} />
                )}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="ghost-btn icon-only"
            disabled={failedThumbCount === 0}
            title={
              failedThumbCount > 0
                ? `Retry failed thumbnails (${failedThumbCount})`
                : 'Retry failed thumbnails'
            }
            aria-label={
              failedThumbCount > 0
                ? `Retry failed thumbnails (${failedThumbCount})`
                : 'Retry failed thumbnails'
            }
            onClick={() => {
              const n = retryAllFailedCivitaiThumbs();
              if (n > 0) {
                onStatus(
                  `Retrying ${n} failed thumbnail${n === 1 ? '' : 's'}…`,
                  'notice',
                );
              }
            }}
          >
            <RotateCcw size={16} />
          </button>
          {imagesFolderConfigured ? (
            <button
              type="button"
              className="ghost-btn icon-only"
              title={`Open ${mediaNouns} folder`}
              aria-label={`Open ${mediaNouns} folder`}
              onClick={() => void mediaApi.openFolder()}
            >
              <FolderOpen size={16} />
            </button>
          ) : (
            <span
              className="hint civitai-images-folder-hint"
              title={`Set ${mediaNouns} folder in Settings to download.`}
            >
              No folder
            </span>
          )}
        </div>
      </div>

      <div className="civitai-images-body">
        {showSortStats && sortStats ? (
          <section
            className="civitai-image-download-stats"
            aria-label="Download all feed summary"
          >
            <div className="civitai-image-download-stats-head">
              <div>
                <h3>{sortStatsHeadline(sortStats)}</h3>
                <p>{sortStatsSubline(sortStats)}</p>
              </div>
              <div className="civitai-image-download-stats-head-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setSortStatsDismissed(true)}
                >
                  Dismiss
                </button>
              </div>
            </div>
            <dl className="civitai-image-download-stats-grid">
              <div>
                <dt>Saved</dt>
                <dd>{sortStats.saved}</dd>
              </div>
              <div>
                <dt>Skipped</dt>
                <dd>{sortStats.skipped}</dd>
              </div>
              <div>
                <dt>Failed</dt>
                <dd>{sortStats.failed}</dd>
              </div>
              <div>
                <dt>API pages</dt>
                <dd>{sortStats.pagesFetched}</dd>
              </div>
              <div>
                <dt>{mediaTitle} seen</dt>
                <dd>{sortStats.imagesSeen}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{formatInsightDuration(sortStats.durationMs)}</dd>
              </div>
              <div>
                <dt>Newest seen</dt>
                <dd title={sortStats.newestSeenAt ?? undefined}>
                  {formatInsightDate(sortStats.newestSeenAt)}
                </dd>
              </div>
              <div>
                <dt>Oldest seen</dt>
                <dd title={sortStats.oldestSeenAt ?? undefined}>
                  {formatInsightDate(sortStats.oldestSeenAt)}
                </dd>
              </div>
              <div>
                <dt>History span</dt>
                <dd>
                  {formatSpanDays(
                    sortStats.newestSeenAt,
                    sortStats.oldestSeenAt,
                  ) ?? '—'}
                </dd>
              </div>
              <div>
                <dt>Session total</dt>
                <dd>
                  {sortStats.sessionSaved} saved
                  {sortStats.sessionFailed
                    ? ` · ${sortStats.sessionFailed} failed`
                    : ''}
                  {sortStats.sessionSkipped
                    ? ` · ${sortStats.sessionSkipped} skipped`
                    : ''}
                </dd>
              </div>
            </dl>
          </section>
        ) : null}
        {tab === 'browse' ? (
          <>
            {!searched || busy ? (
              <p className="hint">
                <Loader2 size={14} className="spin" /> Loading images…
              </p>
            ) : null}
            {searched &&
            !busy &&
            visibleBrowse.length === 0 &&
            (loadingMore || (nextCursor && !catchUpThrough)) ? (
              <p className="hint">
                <Loader2 size={14} className="spin" /> Loading more…
              </p>
            ) : null}
            {searched &&
            !busy &&
            !loadingMore &&
            visibleBrowse.length === 0 &&
            catchUpThrough &&
            !ignoreTipThisRun ? (
              <div className="hint pad civitai-catchup-hold">
                <p>
                  Caught up through{' '}
                  {(() => {
                    const ms = Date.parse(catchUpThrough);
                    return Number.isFinite(ms)
                      ? new Date(ms).toLocaleString()
                      : catchUpThrough;
                  })()}{' '}
                  (tip watermark). Archived / downloaded cards are hidden.
                </p>
                {nextCursor ? (
                  <button
                    type="button"
                    className="generation-action-btn"
                    disabled={busy || loadingMore || downloadAllActive}
                    title="Keep paging past the tip until Civitai has no more pages. Still skips archived/downloaded cards."
                    onClick={() => continuePastTipToEnd()}
                  >
                    <ChevronsDown size={14} /> Continue to end (ignore tip)
                  </button>
                ) : null}
              </div>
            ) : null}
            {searched && ignoreTipThisRun && nextCursor ? (
              <p className="hint pad">
                Ignoring tip this run — paging until the catalog ends. Archived /
                downloaded cards stay hidden.
              </p>
            ) : null}
            {searched &&
            !busy &&
            !loadingMore &&
            visibleBrowse.length === 0 &&
            !nextCursor &&
            !catchUpThrough ? (
              <p className="hint">
                {feedHadHits || items.length > 0
                  ? `No more unarchived ${mediaNouns} in “${sort}”. Archived/downloaded cards are hidden — try another sort, or unarchive some.`
                  : `No ${mediaNouns} matched these filters.`}
              </p>
            ) : null}
            <CivitaiVirtualGrid
              items={visibleBrowse}
              cardMinWidth={160}
              gap={10}
              estimateCardHeight={220}
              getItemKey={(hit) => hit.id}
              windowClassName="civitai-image-grid civitai-grid-virtual-window"
              renderItem={(hit) => renderCard(hit, {})}
            />
            {nextCursor && !catchUpThrough ? (
              <div className="hf-load-more">
                <button
                  type="button"
                  disabled={busy || loadingMore}
                  onClick={() =>
                    void runSearch({ cursor: nextCursor, append: true })
                  }
                >
                  {loadingMore ? (
                    <>
                      <Loader2 size={14} className="spin" /> Loading…
                    </>
                  ) : (
                    'Load more'
                  )}
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {tab === 'downloaded' ? (
          downloadedFiltered.length === 0 ? (
            <p className="hint">No downloaded {mediaNouns} yet.</p>
          ) : (
            <CivitaiVirtualGrid
              items={downloadedFiltered}
              cardMinWidth={160}
              gap={10}
              estimateCardHeight={220}
              getItemKey={(row) => `${row.origin}:${row.imageId}`}
              windowClassName="civitai-image-grid civitai-grid-virtual-window"
              renderItem={(row) => {
                const hideBaseMeta = baseModels.length > 0;
                const dateLabel = row.savedAt
                  ? formatCardCreatedAt(row.savedAt)
                  : null;
                return (
                  <div className="civitai-image-card">
                    <CivitaiMediaCardThumb mediaUrl={row.url} isVideo={isVideo}>
                      <span className="civitai-image-badge">Saved</span>
                    </CivitaiMediaCardThumb>
                    {!hideBaseMeta || row.fileName || dateLabel ? (
                      <div className="civitai-image-meta">
                        {!hideBaseMeta ? (
                          <strong>#{row.imageId}</strong>
                        ) : null}
                        {!hideBaseMeta ? <span>{row.baseModel}</span> : null}
                        {row.fileName ? <span>{row.fileName}</span> : null}
                        {dateLabel && row.savedAt ? (
                          <span
                            className="civitai-card-date"
                            title={`Downloaded ${new Date(row.savedAt).toLocaleString()}`}
                          >
                            {dateLabel}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="civitai-card-actions">
                      <span className="civitai-icon-btn-spacer" aria-hidden />
                      <button
                        type="button"
                        className="civitai-icon-btn action-reveal-local"
                        title="Open downloaded file"
                        aria-label="Open downloaded file"
                        onClick={() =>
                          void mediaApi
                            .openDownloaded(row.absolutePath)
                            .catch((err) =>
                              onError(
                                err instanceof Error
                                  ? err.message
                                  : String(err),
                              ),
                            )
                        }
                      >
                        <FolderOpen size={20} />
                      </button>
                      <a
                        className="civitai-icon-btn action-open"
                        href={`https://civitai.com/images/${row.imageId}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open on Civitai"
                        aria-label="Open on Civitai"
                      >
                        <ExternalLink size={20} />
                      </a>
                    </div>
                  </div>
                );
              }}
            />
          )
        ) : null}

        {tab === 'archive' ? (
          archived.length === 0 ? (
            <p className="hint">Nothing archived yet.</p>
          ) : (
            <CivitaiVirtualGrid
              items={archivedRows}
              cardMinWidth={160}
              gap={10}
              estimateCardHeight={120}
              getItemKey={(row) => row.imageId}
              windowClassName="civitai-image-grid civitai-grid-virtual-window"
              renderItem={({ imageId, hit }) =>
                hit ? (
                  renderCard(hit, { archived: true })
                ) : (
                  <div className="civitai-image-card">
                    {baseModels.length === 0 ? (
                      <div className="civitai-image-meta">
                        <strong>#{imageId}</strong>
                      </div>
                    ) : null}
                    <div className="civitai-card-actions">
                      <span className="civitai-icon-btn-spacer" aria-hidden />
                      <button
                        type="button"
                        className="civitai-icon-btn action-archive"
                        title="Unarchive"
                        aria-label="Unarchive"
                        onClick={() => void unarchiveImage(imageId)}
                      >
                        <ArchiveRestore size={20} />
                      </button>
                      <a
                        className="civitai-icon-btn action-open"
                        href={`https://civitai.com/images/${imageId}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open on Civitai"
                        aria-label="Open on Civitai"
                      >
                        <ExternalLink size={20} />
                      </a>
                    </div>
                  </div>
                )
              }
            />
          )
        ) : null}
      </div>
    </div>
  );
}
