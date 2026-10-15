import {
  isEarlyAccessActive,
  isVersionEarlyAccess,
  resolveEarlyAccessEndsAt,
  extractEarlyAccessGateFromModelPageHtml,
  type EarlyAccessPageGate,
} from '../domain/civitaiEarlyAccess.js';
import {
  CIVITAI_IMAGES_PAGE_LIMIT,
  civitaiImageMatchesTools,
  isCivitaiImageToolFilterId,
  type CivitaiImageToolFilterId,
} from '../domain/civitaiImageTools.js';
import {
  civitaiCommunityMediaKind,
  civitaiHitMatchesRequestedMedia,
} from '../domain/civitaiMediaType.js';
import {
  getCivitaiApiKey,
  getCivitaiOrigin,
} from './settingsStore.js';
import { createIntervalPacer } from './asyncPace.js';
import { appendDownloadLog, formatErrorDetail } from './downloadLog.js';

export {
  isEarlyAccessActive,
  isVersionEarlyAccess,
  resolveEarlyAccessEndsAt,
};
export type { EarlyAccessPageGate };

export type CivitaiModelType = 'LORA' | 'Checkpoint';

export type CivitaiModelFile = {
  id: number;
  name: string;
  sizeKB?: number;
  primary?: boolean;
  downloadUrl?: string;
  hashes?: Record<string, string>;
};

export type CivitaiModelVersion = {
  id: number;
  name: string;
  baseModel?: string;
  trainedWords?: string[];
  downloadUrl?: string;
  files?: CivitaiModelFile[];
  images?: Array<{
    url?: string;
    nsfwLevel?: number;
    type?: string;
  }>;
  stats?: { downloadCount?: number; thumbsUpCount?: number };
  /** ISO timestamp when early access ends, if still gated. */
  earlyAccessEndsAt?: string | null;
  /** Newer website field (same meaning). */
  earlyAccessDeadline?: string | null;
  paidAccess?: {
    endsAt?: string | null;
    timeframeDays?: number;
  } | null;
  availability?: string;
  publishedAt?: string | null;
  createdAt?: string | null;
  earlyAccessConfig?: {
    timeframe?: number;
    originalPublishedAt?: string;
    downloadPrice?: number;
    generationPrice?: number;
    chargeForDownload?: boolean;
    chargeForGeneration?: boolean;
  } | null;
  checkPermission?: boolean | null;
};

export type CivitaiModel = {
  id: number;
  name: string;
  type: string;
  nsfw?: boolean;
  description?: string;
  tags?: string[];
  creator?: { username?: string; image?: string };
  stats?: {
    downloadCount?: number;
    thumbsUpCount?: number;
    commentCount?: number;
  };
  modelVersions?: CivitaiModelVersion[];
};

export type CivitaiSearchParams = {
  type: CivitaiModelType;
  query?: string;
  cursor?: string;
  limit?: number;
  sort?: 'Highest Rated' | 'Most Downloaded' | 'Newest';
  period?: 'AllTime' | 'Year' | 'Month' | 'Week' | 'Day';
  nsfw?: boolean;
  baseModels?: string[];
  /** Civitai model category tag (character, style, concept, …). */
  tag?: string;
};

export type CivitaiSearchResult = {
  items: CivitaiModel[];
  nextCursor: string | null;
};

function apiBase(): string {
  return `${getCivitaiOrigin()}/api/v1`;
}

function authHeaders(): HeadersInit {
  const key = getCivitaiApiKey();
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Download cancelled'));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer);
      reject(new Error('Download cancelled'));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Civitai does not publish a fixed RPS quota — Cloudflare returns 429 when the
 * edge decides you're too hot. Stay well under interactive browsing rates:
 * roughly one /api/v1 call per second, with exponential backoff on 429/5xx.
 *
 * Downloads use a separate lane so catalog backfill / hash-enrich cannot park
 * a user download behind dozens of background GETs.
 */
const API_MIN_INTERVAL_MS = 1000;
const API_MAX_RETRIES = 6;
const API_ATTEMPT_TIMEOUT_MS = 45_000;
const paceBackgroundApi = createIntervalPacer(API_MIN_INTERVAL_MS);
const paceInteractiveApi = createIntervalPacer(API_MIN_INTERVAL_MS);

export type CivitaiApiLane = 'background' | 'interactive';

export type CivitaiGetOptions = {
  /** Default `background`. Downloads / user actions should use `interactive`. */
  lane?: CivitaiApiLane;
  /** Abort the whole get (including retries). */
  signal?: AbortSignal;
  /** Fired before each attempt / while waiting (for download status UI). */
  onStatus?: (message: string) => void;
  /**
   * Re-fetch model-page HTML even if this process already tried this model.
   * Default: one attempt per modelId per app session (success or fail).
   */
  force?: boolean;
};

function redactUrlForLog(url: string): string {
  return url
    .replace(/([?&]token=)[^&]*/gi, '$1***')
    .replace(/\/\/[^/]+@/g, '//***@');
}

async function civitaiGet<T>(
  pathAndQuery: string,
  opts?: CivitaiGetOptions,
): Promise<T> {
  const url = pathAndQuery.startsWith('http')
    ? pathAndQuery
    : `${apiBase()}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`;

  const lane = opts?.lane ?? 'background';
  const pace = lane === 'interactive' ? paceInteractiveApi : paceBackgroundApi;
  let backoffMs = 1000;
  let lastError = 'Civitai request failed';
  const logApi = lane === 'interactive';
  const logPath = redactUrlForLog(url);

  for (let attempt = 0; attempt < API_MAX_RETRIES; attempt += 1) {
    if (opts?.signal?.aborted) {
      throw new Error('Download cancelled');
    }

    opts?.onStatus?.(
      attempt === 0
        ? 'Waiting for Civitai API…'
        : `Retrying Civitai API (${attempt + 1}/${API_MAX_RETRIES})…`,
    );
    await pace();
    if (opts?.signal?.aborted) {
      throw new Error('Download cancelled');
    }

    opts?.onStatus?.(
      attempt === 0
        ? 'Looking up model on Civitai…'
        : `Looking up model on Civitai (attempt ${attempt + 1}/${API_MAX_RETRIES})…`,
    );

    if (logApi) {
      appendDownloadLog(
        'info',
        attempt === 0
          ? `GET ${logPath}`
          : `GET ${logPath} (attempt ${attempt + 1}/${API_MAX_RETRIES})`,
        { source: 'api' },
      );
    }

    let response: Response;
    try {
      const timeout = AbortSignal.timeout(API_ATTEMPT_TIMEOUT_MS);
      const signal = opts?.signal
        ? AbortSignal.any([opts.signal, timeout])
        : timeout;
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          ...authHeaders(),
        },
        signal,
      });
    } catch (e) {
      if (opts?.signal?.aborted) {
        throw new Error('Download cancelled');
      }
      // Transport failures (DNS, reset, TLS, timeout) — retry with backoff.
      const cause =
        e instanceof Error
          ? e.cause instanceof Error
            ? e.cause.message
            : e.name === 'TimeoutError' || /timeout/i.test(e.message)
              ? `timed out after ${API_ATTEMPT_TIMEOUT_MS / 1000}s`
              : formatErrorDetail(e)
          : String(e);
      lastError = `Civitai unreachable (${cause})`;
      if (logApi) {
        appendDownloadLog('warn', lastError, { source: 'api' });
      }
      if (attempt + 1 >= API_MAX_RETRIES) break;
      opts?.onStatus?.(
        `Civitai unreachable — retrying in ${Math.ceil(backoffMs / 1000)}s…`,
      );
      await sleep(backoffMs, opts?.signal);
      backoffMs = Math.min(30_000, backoffMs * 2);
      continue;
    }

    if (response.ok) {
      if (logApi) {
        appendDownloadLog('info', `GET ${logPath} → ${response.status}`, {
          source: 'api',
        });
      }
      const text = await response.text();
      // Let the window paint the retry/status line before a large model JSON
      // parse runs on this thread.
      await new Promise<void>((resolve) => setImmediate(resolve));
      return JSON.parse(text) as T;
    }

    const body = await response.text().catch(() => '');
    lastError = `Civitai request failed (${response.status}): ${body.slice(0, 200) || response.statusText}`;

    // 429 = edge rate limit (or pagination cap). 5xx = retryable.
    if (response.status === 429 || response.status >= 500) {
      if (logApi) {
        appendDownloadLog('warn', lastError, { source: 'api' });
      }
      opts?.onStatus?.(
        response.status === 429
          ? `Civitai rate-limited — retrying in ${Math.ceil(backoffMs / 1000)}s…`
          : `Civitai server error (${response.status}) — retrying in ${Math.ceil(backoffMs / 1000)}s…`,
      );
      await sleep(backoffMs, opts?.signal);
      backoffMs = Math.min(30_000, backoffMs * 2);
      continue;
    }

    if (logApi) {
      appendDownloadLog('error', lastError, { source: 'api' });
    }
    throw new Error(lastError);
  }

  if (logApi) {
    appendDownloadLog('error', lastError, { source: 'api' });
  }
  throw new Error(lastError);
}

export async function searchCivitaiModels(
  params: CivitaiSearchParams,
): Promise<CivitaiSearchResult> {
  const qs = new URLSearchParams();
  qs.set('types', params.type);
  qs.set('limit', String(Math.max(1, Math.min(100, params.limit ?? 20))));
  if (params.query?.trim()) qs.set('query', params.query.trim());
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.sort) qs.set('sort', params.sort);
  if (params.period) qs.set('period', params.period);
  if (params.nsfw === true) qs.set('nsfw', 'true');
  if (params.tag?.trim()) qs.set('tag', params.tag.trim());
  if (params.baseModels?.length) {
    for (const base of params.baseModels) qs.append('baseModels', base);
  }
  qs.set('primaryFileOnly', 'true');

  const data = await civitaiGet<{
    items?: CivitaiModel[];
    metadata?: { nextCursor?: string };
  }>(`/models?${qs.toString()}`);

  return {
    items: Array.isArray(data.items) ? data.items : [],
    nextCursor:
      typeof data.metadata?.nextCursor === 'string'
        ? data.metadata.nextCursor
        : null,
  };
}

export type CivitaiImageSearchParams = {
  cursor?: string | null;
  limit?: number;
  baseModels?: string[];
  /** Generator tools inferred from image meta (public API has no tools param). */
  tools?: CivitaiImageToolFilterId[];
  sort?:
    | 'Most Reactions'
    | 'Most Comments'
    | 'Most Collected'
    | 'Newest'
    | 'Oldest';
  period?: 'AllTime' | 'Year' | 'Month' | 'Week' | 'Day';
  /** `sfw` | `all` | `nsfw` — see contracts. Legacy `nsfw: true` ⇒ all. */
  nsfwMode?: 'sfw' | 'all' | 'nsfw';
  nsfw?: boolean;
  username?: string;
  modelId?: number;
  withMeta?: boolean;
  /** Public `/images` media type (default `image`). */
  mediaType?: 'image' | 'video';
};

export type CivitaiImageHit = {
  id: number;
  url: string;
  width: number | null;
  height: number | null;
  nsfwLevel: number | null;
  username: string | null;
  baseModel: string | null;
  createdAt: string | null;
  likeCount: number | null;
  commentCount: number | null;
  modelId: number | null;
  modelVersionId: number | null;
  postId: number | null;
  /** Civitai `/images` `type` when present (`image` / `video` / `audio`). */
  mediaType: string | null;
};

export type CivitaiImageSearchResult = {
  items: CivitaiImageHit[];
  nextCursor: string | null;
};

/**
 * Civitai image `browsingLevel` bits (docs: prefer this over legacy `nsfw`).
 * PG=1, PG13/Soft=2, R/Mature=4, X=8, XXX=16.
 */
const BROWSING_PG = 1;
const BROWSING_PG13 = 2;
const BROWSING_R = 4;
const BROWSING_X = 8;
const BROWSING_XXX = 16;
const BROWSING_SFW = BROWSING_PG | BROWSING_PG13; // 3
const BROWSING_NSFW_ONLY = BROWSING_R | BROWSING_X | BROWSING_XXX; // 28
const BROWSING_ALL = BROWSING_SFW | BROWSING_NSFW_ONLY; // 31

const NSFW_LEVEL_NAME_TO_BIT: Record<string, number> = {
  none: BROWSING_PG,
  pg: BROWSING_PG,
  soft: BROWSING_PG13,
  pg13: BROWSING_PG13,
  mature: BROWSING_R,
  r: BROWSING_R,
  x: BROWSING_X,
  xxx: BROWSING_XXX,
};

function parseImageNsfwLevelBit(row: Record<string, unknown>): number | null {
  if (typeof row.browsingLevel === 'number' && Number.isFinite(row.browsingLevel)) {
    return Math.round(row.browsingLevel);
  }
  if (typeof row.nsfwLevel === 'number' && Number.isFinite(row.nsfwLevel)) {
    return Math.round(row.nsfwLevel);
  }
  if (typeof row.nsfwLevel === 'string') {
    const bit = NSFW_LEVEL_NAME_TO_BIT[row.nsfwLevel.trim().toLowerCase()];
    return bit ?? null;
  }
  return null;
}

function imageMatchesBaseModels(
  baseModel: string | null | undefined,
  allowed: string[],
): boolean {
  if (allowed.length === 0) return true;
  const raw = baseModel?.trim();
  // Missing baseModel: do not treat as a match. Civitai's Newest tip is often
  // untagged; passing those through would mix SD1.5 / Illustrious into a Krea
  // architecture filter. Prefer fewer results over wrong bases.
  if (!raw) return false;
  const lower = raw.toLowerCase();
  return allowed.some((a) => a.trim().toLowerCase() === lower);
}

function mapCivitaiImageHit(raw: unknown): CivitaiImageHit | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'number' || !Number.isFinite(row.id)) return null;
  const url =
    typeof row.url === 'string' && row.url.trim()
      ? row.url.trim()
      : typeof (row as { imageUrl?: unknown }).imageUrl === 'string'
        ? String((row as { imageUrl: string }).imageUrl).trim()
        : '';
  if (!url) return null;
  const meta =
    row.meta && typeof row.meta === 'object'
      ? (row.meta as Record<string, unknown>)
      : null;
  const stats =
    row.stats && typeof row.stats === 'object'
      ? (row.stats as Record<string, unknown>)
      : null;
  const baseFromMeta =
    typeof meta?.baseModel === 'string' ? meta.baseModel.trim() : '';
  const baseFromRow =
    typeof row.baseModel === 'string' ? row.baseModel.trim() : '';
  const username =
    typeof row.username === 'string'
      ? row.username
      : row.user &&
          typeof row.user === 'object' &&
          typeof (row.user as { username?: unknown }).username === 'string'
        ? String((row.user as { username: string }).username)
        : null;
  return {
    id: Math.round(row.id),
    url: /^https?:\/\//i.test(url)
      ? url
      : `${getCivitaiOrigin().replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`,
    width: typeof row.width === 'number' ? row.width : null,
    height: typeof row.height === 'number' ? row.height : null,
    nsfwLevel: parseImageNsfwLevelBit(row),
    username,
    baseModel: baseFromMeta || baseFromRow || null,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
    likeCount:
      typeof stats?.likeCount === 'number'
        ? stats.likeCount
        : typeof stats?.heartCount === 'number'
          ? stats.heartCount
          : null,
    commentCount:
      typeof stats?.commentCount === 'number' ? stats.commentCount : null,
    modelId: typeof row.modelId === 'number' ? row.modelId : null,
    modelVersionId:
      typeof row.modelVersionId === 'number' ? row.modelVersionId : null,
    postId: typeof row.postId === 'number' ? row.postId : null,
    mediaType: typeof row.type === 'string' ? row.type.trim() || null : null,
  };
}

function civitaiNextCursor(
  metadata: { nextCursor?: unknown } | null | undefined,
): string | null {
  const raw = metadata?.nextCursor;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  // Some responses historically returned a numeric cursor.
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

export async function searchCivitaiImages(
  params: CivitaiImageSearchParams,
): Promise<CivitaiImageSearchResult> {
  const limit = Math.max(
    1,
    Math.min(CIVITAI_IMAGES_PAGE_LIMIT, params.limit ?? CIVITAI_IMAGES_PAGE_LIMIT),
  );
  const tools = (params.tools ?? []).filter(isCivitaiImageToolFilterId);
  const needToolFilter = tools.length > 0;
  const allowedBases = (params.baseModels ?? [])
    .map((b) => b.trim())
    .filter(Boolean);
  const needBaseFilter = allowedBases.length > 0;
  // Tool filter needs meta fingerprints; always request meta when filtering.
  const withMeta = needToolFilter || params.withMeta !== false;

  const collected: CivitaiImageHit[] = [];
  let cursor = params.cursor ?? null;
  let pages = 0;
  // Client-side tool filter thins pages; keep walking the same sort cursor.
  const maxPages = needToolFilter ? 12 : 1;

  while (collected.length < limit && pages < maxPages) {
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    qs.set('type', params.mediaType === 'video' ? 'video' : 'image');
    if (cursor) qs.set('cursor', cursor);
    if (params.sort) qs.set('sort', params.sort);
    if (
      params.period === 'AllTime' ||
      params.period === 'Year' ||
      params.period === 'Month' ||
      params.period === 'Week' ||
      params.period === 'Day'
    ) {
      qs.set('period', params.period);
    }
    // Prefer browsingLevel (current API); legacy nsfw= is deprecated upstream.
    const nsfwMode =
      params.nsfwMode === 'sfw' ||
      params.nsfwMode === 'all' ||
      params.nsfwMode === 'nsfw'
        ? params.nsfwMode
        : params.nsfw === true
          ? 'all'
          : 'sfw';
    if (nsfwMode === 'all') qs.set('browsingLevel', String(BROWSING_ALL));
    else if (nsfwMode === 'nsfw') {
      qs.set('browsingLevel', String(BROWSING_NSFW_ONLY));
    } else {
      qs.set('browsingLevel', String(BROWSING_SFW));
    }
    if (params.username?.trim()) qs.set('username', params.username.trim());
    if (typeof params.modelId === 'number' && Number.isFinite(params.modelId)) {
      qs.set('modelId', String(Math.round(params.modelId)));
    }
    if (withMeta) qs.set('withMeta', 'true');
    // Still send baseModels when set — that is how Krea volume is selected.
    // (Newest tip tagging is flaky; untagged images are NOT treated as Krea.)
    if (needBaseFilter) {
      for (const base of allowedBases) {
        qs.append('baseModels', base);
      }
    }

    const data = await civitaiGet<{
      items?: unknown[];
      metadata?: { nextCursor?: unknown };
    }>(`/images?${qs.toString()}`, { lane: 'interactive' });

    const rawItems = Array.isArray(data.items) ? data.items : [];
    for (const raw of rawItems) {
      if (needToolFilter) {
        const row =
          raw && typeof raw === 'object'
            ? (raw as Record<string, unknown>)
            : null;
        const meta =
          row?.meta && typeof row.meta === 'object'
            ? (row.meta as Record<string, unknown>)
            : null;
        if (!civitaiImageMatchesTools(meta, tools)) continue;
      }
      const hit = mapCivitaiImageHit(raw);
      if (!hit) continue;
      const requested = params.mediaType === 'video' ? 'video' : 'image';
      const kind = civitaiCommunityMediaKind({
        type: hit.mediaType,
        url: hit.url,
      });
      if (!civitaiHitMatchesRequestedMedia(kind, requested)) continue;
      // Defense in depth: never keep a clearly wrong tagged base.
      if (
        needBaseFilter &&
        hit.baseModel &&
        !imageMatchesBaseModels(hit.baseModel, allowedBases)
      ) {
        continue;
      }
      collected.push(hit);
      if (collected.length >= limit) break;
    }

    cursor = civitaiNextCursor(data.metadata);
    pages += 1;
    if (!cursor || !needToolFilter) break;
  }

  return {
    items: collected.slice(0, limit),
    nextCursor: cursor,
  };
}

/** Community videos — same `/images` endpoint with `type=video`. */
export async function searchCivitaiVideos(
  params: CivitaiImageSearchParams,
): Promise<CivitaiImageSearchResult> {
  return searchCivitaiImages({ ...params, mediaType: 'video' });
}

export async function getCivitaiModel(
  modelId: number,
  opts?: CivitaiGetOptions,
): Promise<CivitaiModel> {
  return civitaiGet<CivitaiModel>(
    `/models/${Math.round(modelId)}`,
    opts,
  );
}

/**
 * Batch detail for known model ids via `GET /models?ids=…` (max 100 / call).
 * Prefer this over N× `getCivitaiModel` for library refresh / enrich passes.
 */
export async function getCivitaiModelsByIds(
  modelIds: number[],
  opts?: CivitaiGetOptions,
): Promise<CivitaiModel[]> {
  const ids = [
    ...new Set(
      modelIds
        .map((id) => Math.round(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  if (ids.length === 0) return [];

  const out: CivitaiModel[] = [];
  const BATCH = 100;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const qs = new URLSearchParams();
    qs.set('ids', chunk.join(','));
    qs.set('limit', String(chunk.length));
    qs.set('nsfw', 'true');
    const data = await civitaiGet<{ items?: CivitaiModel[] }>(
      `/models?${qs.toString()}`,
      opts,
    );
    if (Array.isArray(data.items)) out.push(...data.items);
  }
  return out;
}

export async function getCivitaiModelVersion(
  versionId: number,
  opts?: CivitaiGetOptions,
): Promise<CivitaiModelVersion> {
  return civitaiGet<CivitaiModelVersion>(
    `/model-versions/${Math.round(versionId)}`,
    opts,
  );
}

/**
 * Resolve a local file hash (AutoV2 / SHA256 / …) to a model version.
 * Used by the one-shot LoRA populate pass when the local catalog has no hit.
 */
export async function getCivitaiModelVersionByHash(
  hash: string,
): Promise<CivitaiModelVersion & { modelId?: number; model?: { name?: string; type?: string; nsfw?: boolean } }> {
  const trimmed = hash.trim();
  if (!trimmed) throw new Error('Empty hash');
  return civitaiGet(
    `/model-versions/by-hash/${encodeURIComponent(trimmed)}`,
  );
}

/** First still URL on a version (by-hash payload). */
export function versionPreviewUrl(
  version: CivitaiModelVersion | null | undefined,
): string | null {
  if (!version) return null;
  const stills = (version.images ?? []).filter(
    (img) => img.url && img.type?.toLowerCase() !== 'video',
  );
  const raw = stills[0]?.url;
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const origin = getCivitaiOrigin().replace(/\/$/, '');
  return `${origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

/**
 * Public REST often omits EA end times for paid early-access models.
 * Prefer the model page (`earlyAccessDeadline` / `paidAccess.endsAt`) — version
 * detail no longer carries those fields for many Buzz / paid-EA releases.
 */
export async function enrichVersionEarlyAccess(
  version: CivitaiModelVersion | undefined,
  opts?: { force?: boolean; lane?: CivitaiApiLane; modelId?: number },
): Promise<CivitaiModelVersion | undefined> {
  if (!version?.id) return version;
  if (resolveEarlyAccessEndsAt(version) && !opts?.force) return version;

  // Always page-scrape when the end time is unknown. Public REST labels many
  // paid Buzz EA versions as `availability: Public` with *no* earlyAccessConfig,
  // while the model page still embeds `paidAccess.endsAt` / earlyAccessDeadline.
  // Skipping Public here was the bug that left Browse showing Download forever.

  // Page first — REST version detail is usually empty for paid EA deadlines.
  const modelId = opts?.modelId;
  if (modelId != null && Number.isFinite(modelId)) {
    const gate = await fetchEarlyAccessGateFromModelPage(modelId, {
      lane: opts?.lane,
      force: opts?.force,
    });
    if (gate && (gate.endsAt || gate.gated)) {
      return {
        ...version,
        earlyAccessEndsAt: gate.endsAt ?? version.earlyAccessEndsAt,
        earlyAccessDeadline:
          version.earlyAccessDeadline ?? gate.endsAt ?? undefined,
        earlyAccessConfig: {
          ...(version.earlyAccessConfig ?? {}),
          ...(gate.downloadPrice != null
            ? { downloadPrice: gate.downloadPrice }
            : {}),
          ...(gate.gated && !gate.endsAt
            ? { chargeForDownload: true }
            : {}),
        },
      };
    }
  }

  // Legacy fallback: version detail may still expose earlyAccessConfig.timeframe.
  try {
    const detail = await getCivitaiModelVersion(version.id, {
      lane: opts?.lane,
    });
    const next: CivitaiModelVersion = {
      ...version,
      availability:
        (detail.availability ?? '').trim() || version.availability,
      earlyAccessEndsAt:
        detail.earlyAccessEndsAt ?? version.earlyAccessEndsAt,
      earlyAccessDeadline:
        detail.earlyAccessDeadline ?? version.earlyAccessDeadline,
      paidAccess: detail.paidAccess ?? version.paidAccess,
      earlyAccessConfig:
        detail.earlyAccessConfig ?? version.earlyAccessConfig,
      publishedAt: detail.publishedAt ?? version.publishedAt,
      createdAt: detail.createdAt ?? version.createdAt,
    };
    const resolved = resolveEarlyAccessEndsAt(next);
    if (resolved) {
      return {
        ...next,
        earlyAccessEndsAt: next.earlyAccessEndsAt ?? resolved,
      };
    }
    return next;
  } catch {
    return version;
  }
}

/** One model-page HTML enrich per modelId per process after a definitive result. */
const pageScrapeAttemptedByModel = new Set<number>();
/** In-flight enrich per modelId (before definitive result). */
const pageScrapeModelInFlight = new Map<
  number,
  Promise<EarlyAccessPageGate | undefined>
>();

/**
 * Parse EA gate from the public model page (no API key required).
 * REST `/api/v1` strips deadlines / Buzz price for many paid-EA versions.
 *
 * Tries the library’s configured site first (Settings → Civitai → Site).
 * If that fails (e.g. civitai.red 403 / Cloudflare), falls back to the other
 * host — same model ids often still embed `earlyAccessDeadline` on .com.
 *
 * Session skip only after a definitive HTML result (gate found OR clean
 * HTML with no EA signals). Transport failures (403/CF) are NOT permanent.
 */
export async function fetchEarlyAccessGateFromModelPage(
  modelId: number,
  opts?: CivitaiGetOptions,
): Promise<EarlyAccessPageGate | undefined> {
  const id = Math.round(modelId);
  if (!Number.isFinite(id) || id <= 0) return undefined;

  if (!opts?.force && pageScrapeAttemptedByModel.has(id)) {
    return undefined;
  }

  const existing = pageScrapeModelInFlight.get(id);
  if (existing && !opts?.force) return existing;

  const run = (async (): Promise<EarlyAccessPageGate | undefined> => {
    const configured = getCivitaiOrigin().replace(/\/$/, '');
    if (!configured) return undefined;

    let sawDefinitiveHtml = false;

    const tryOrigin = async (
      origin: string,
    ): Promise<EarlyAccessPageGate | undefined> =>
      fetchEarlyAccessGateFromOrigin(origin, id, opts);

    const gate = await tryOrigin(configured);
    if (gate && (gate.gated || gate.endsAt)) {
      pageScrapeAttemptedByModel.add(id);
      return gate;
    }
    if (pageScrapeDefinitiveMiss.has(`${configured}:${id}`)) {
      sawDefinitiveHtml = true;
    }

    const fallback = alternateCivitaiOrigin(configured);
    if (fallback) {
      const fromFallback = await tryOrigin(fallback);
      if (fromFallback && (fromFallback.gated || fromFallback.endsAt)) {
        pageScrapeAttemptedByModel.add(id);
        return fromFallback;
      }
      if (pageScrapeDefinitiveMiss.has(`${fallback}:${id}`)) {
        sawDefinitiveHtml = true;
      }
    }

    if (sawDefinitiveHtml) {
      pageScrapeAttemptedByModel.add(id);
      return gate ?? { gated: false };
    }
    return undefined;
  })();

  pageScrapeModelInFlight.set(id, run);
  try {
    return await run;
  } finally {
    pageScrapeModelInFlight.delete(id);
  }
}

/** @deprecated Prefer fetchEarlyAccessGateFromModelPage — endsAt only. */
export async function fetchEarlyAccessEndsAtFromModelPage(
  modelId: number,
  opts?: CivitaiGetOptions,
): Promise<string | undefined> {
  const gate = await fetchEarlyAccessGateFromModelPage(modelId, opts);
  return gate?.endsAt;
}

/** True after a definitive page enrich (deadline found or clean HTML miss). */
export function hasCompletedEarlyAccessPageScrape(modelId: number): boolean {
  const id = Math.round(modelId);
  return Number.isFinite(id) && id > 0 && pageScrapeAttemptedByModel.has(id);
}

function alternateCivitaiOrigin(origin: string): string | undefined {
  const host = origin.replace(/\/$/, '').toLowerCase();
  if (host === 'https://civitai.red') return 'https://civitai.com';
  if (host === 'https://civitai.com') return 'https://civitai.red';
  return undefined;
}

/** Skip re-fetching HTML for models that recently 403/429'd (per origin). */
const PAGE_SCRAPE_FAIL_TTL_MS = 30 * 60_000;
const pageScrapeFailCache = new Map<
  string,
  { status: number; at: number }
>();
/**
 * Clean HTML response with no EA gate signals for this origin:model — counts
 * as a definitive miss for session skip (unlike 403/CF which must retry).
 */
const pageScrapeDefinitiveMiss = new Set<string>();
/** One in-flight HTML fetch per origin:model — coalesces parallel callers. */
const pageScrapeInFlight = new Map<
  string,
  Promise<EarlyAccessPageGate | undefined>
>();

async function fetchEarlyAccessGateFromOrigin(
  origin: string,
  modelId: number,
  opts?: CivitaiGetOptions,
): Promise<EarlyAccessPageGate | undefined> {
  const failKey = `${origin.replace(/\/$/, '')}:${modelId}`;
  const priorFail = pageScrapeFailCache.get(failKey);
  if (
    priorFail &&
    Date.now() - priorFail.at < PAGE_SCRAPE_FAIL_TTL_MS &&
    (priorFail.status === 403 || priorFail.status === 429)
  ) {
    return undefined;
  }

  const existing = pageScrapeInFlight.get(failKey);
  if (existing) return existing;

  const run = doFetchEarlyAccessGateFromOrigin(
    origin,
    modelId,
    failKey,
    priorFail,
    opts,
  );
  pageScrapeInFlight.set(failKey, run);
  try {
    return await run;
  } finally {
    pageScrapeInFlight.delete(failKey);
  }
}

async function doFetchEarlyAccessGateFromOrigin(
  origin: string,
  modelId: number,
  failKey: string,
  priorFail: { status: number; at: number } | undefined,
  opts?: CivitaiGetOptions,
): Promise<EarlyAccessPageGate | undefined> {
  const url = `${origin.replace(/\/$/, '')}/models/${modelId}`;
  const lane = opts?.lane ?? 'background';
  const pace = lane === 'interactive' ? paceInteractiveApi : paceBackgroundApi;

  try {
    await pace();
    if (opts?.signal?.aborted) return undefined;

    const headers: Record<string, string> = {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    const apiKey = getCivitaiApiKey();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    let response: Response;
    try {
      const timeout = AbortSignal.timeout(API_ATTEMPT_TIMEOUT_MS);
      const signal = opts?.signal
        ? AbortSignal.any([opts.signal, timeout])
        : timeout;
      response = await fetch(url, {
        headers,
        signal,
        redirect: 'follow',
      });
    } catch (e) {
      if (opts?.signal?.aborted) return undefined;
      response = await fetch(url, { headers, redirect: 'follow' });
      void e;
    }

    if (!response.ok) {
      pageScrapeFailCache.set(failKey, {
        status: response.status,
        at: Date.now(),
      });
      if (!priorFail || Date.now() - priorFail.at >= PAGE_SCRAPE_FAIL_TTL_MS) {
        appendDownloadLog(
          'warn',
          `EA page enrich model ${modelId} via ${origin}: HTTP ${response.status}`,
          { source: 'api', modelId },
        );
      }
      return undefined;
    }
    pageScrapeFailCache.delete(failKey);
    const html = await response.text();
    if (/just a moment|cf-challenge|challenge-platform/i.test(html)) {
      pageScrapeFailCache.set(failKey, { status: 403, at: Date.now() });
      if (!priorFail || Date.now() - priorFail.at >= PAGE_SCRAPE_FAIL_TTL_MS) {
        appendDownloadLog(
          'warn',
          `EA page enrich model ${modelId} via ${origin}: Cloudflare challenge`,
          { source: 'api', modelId },
        );
      }
      return undefined;
    }
    const gate = extractEarlyAccessGateFromModelPageHtml(html);
    if (gate.gated || gate.endsAt) {
      pageScrapeDefinitiveMiss.delete(failKey);
      appendDownloadLog(
        'info',
        `EA page enrich model ${modelId} via ${origin}: gated=${gate.gated}` +
          (gate.endsAt ? ` opens ${gate.endsAt}` : '') +
          (gate.downloadPrice != null ? ` price=${gate.downloadPrice}` : ''),
        { source: 'api', modelId },
      );
    } else {
      pageScrapeDefinitiveMiss.add(failKey);
      appendDownloadLog(
        'warn',
        `EA page enrich model ${modelId} via ${origin}: no EA gate (html ${html.length}b)`,
        { source: 'api', modelId },
      );
    }
    return gate;
  } catch (e) {
    appendDownloadLog(
      'warn',
      `EA page enrich model ${modelId} via ${origin}: ${formatErrorDetail(e)}`,
      { source: 'api', modelId },
    );
    return undefined;
  }
}

export function pickPrimaryFile(
  version: CivitaiModelVersion | undefined,
): CivitaiModelFile | null {
  if (!version?.files?.length) return null;
  return (
    version.files.find((f) => f.primary) ??
    version.files.find((f) => /\.(safetensors|ckpt|pt)$/i.test(f.name)) ??
    version.files[0] ??
    null
  );
}

/**
 * Cover image for a model card — matches Civitai browse cards:
 * first still on the latest version, then older versions. Never random,
 * and never “safest NSFW across every version” (that diverged from the site).
 */
export function primaryPreviewUrl(model: CivitaiModel): string | null {
  const versions = model.modelVersions ?? [];
  for (const version of versions) {
    const stills = (version.images ?? []).filter(
      (img) => img.url && img.type?.toLowerCase() !== 'video',
    );
    const raw = stills[0]?.url;
    if (!raw) continue;
    if (/^https?:\/\//i.test(raw)) return raw;
    const origin = getCivitaiOrigin().replace(/\/$/, '');
    return `${origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
  }
  return null;
}
