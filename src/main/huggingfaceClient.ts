import {
  assembleHfFamilyPage,
  buildHfModelSearchQuery,
  filterHfSearchItemsForModelType,
  hfFamilyQueryBranches,
  planHfFamilyFetches,
  parseHfBrowseFilters,
  parseHfNextCursor,
  HF_API_BASE,
  HF_SITE_ORIGIN,
  huggingfaceModelPageUrl,
  type HfBrowseFilters,
  type HfFamilyQueryBranch,
} from '../domain/huggingfaceSearch.js';
import { hfPreviewUrlFromRepoFiles } from '../domain/huggingfacePreview.js';
import { compareHfWeightFiles } from '../domain/huggingfaceWeightPick.js';
import { getHuggingFaceToken } from './settingsStore.js';

export type HuggingFaceModelHit = {
  id: string;
  likes: number;
  downloads: number;
  private: boolean;
  gated: boolean | 'auto' | 'manual' | null;
  pipelineTag: string | null;
  libraryName: string | null;
  tags: string[];
  createdAt: string | null;
  lastModified: string | null;
  trendingScore: number | null;
  pageUrl: string;
  /** Sample image from the repo, when it has one. */
  previewUrl: string | null;
};

export type HuggingFaceSearchResult = {
  items: HuggingFaceModelHit[];
  nextCursor: string | null;
  /** Items before checkpoint client-side filtering. */
  fetchedCount: number;
};

export type HuggingFaceRepoFile = {
  path: string;
  size: number | null;
  oid?: string;
};

export type HuggingFaceModelDetail = {
  id: string;
  tags: string[];
  pipelineTag: string | null;
  libraryName: string | null;
  gated: boolean | 'auto' | 'manual' | null;
  private: boolean;
  siblings: HuggingFaceRepoFile[];
  pageUrl: string;
  /** Suggested app download type from tags. */
  suggestedType: 'LORA' | 'Checkpoint' | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseGated(value: unknown): boolean | 'auto' | 'manual' | null {
  if (value === true || value === false) return value;
  if (value === 'auto' || value === 'manual') return value;
  return null;
}

export function hfAuthHeaders(): Record<string, string> {
  const token = getHuggingFaceToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function mapModelHit(raw: unknown): HuggingFaceModelHit | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asString(row.id) ?? asString(row.modelId);
  if (!id) return null;
  const tags = Array.isArray(row.tags)
    ? row.tags.filter((t): t is string => typeof t === 'string')
    : [];
  const files: string[] = [];
  if (Array.isArray(row.siblings)) {
    for (const item of row.siblings) {
      const sibling = asRecord(item);
      if (!sibling) continue;
      const path = asString(sibling.rfilename) ?? asString(sibling.path);
      if (path) files.push(path);
    }
  }
  const card = asRecord(row.cardData);
  return {
    id,
    likes: asNumber(row.likes) ?? 0,
    downloads: asNumber(row.downloads) ?? 0,
    private: row.private === true,
    gated: parseGated(row.gated),
    pipelineTag: asString(row.pipeline_tag),
    libraryName: asString(row.library_name),
    tags,
    createdAt: asString(row.createdAt),
    lastModified: asString(row.lastModified),
    trendingScore: asNumber(row.trendingScore),
    pageUrl: huggingfaceModelPageUrl(id),
    previewUrl: hfPreviewUrlFromRepoFiles({
      repoId: id,
      files,
      thumbnail: card ? asString(card.thumbnail) : null,
    }),
  };
}

function suggestedTypeFromTags(
  tags: string[],
): 'LORA' | 'Checkpoint' | null {
  const lower = new Set(tags.map((t) => t.toLowerCase()));
  if (
    lower.has('lora') ||
    lower.has('lycoris') ||
    lower.has('locon') ||
    lower.has('loha')
  ) {
    return 'LORA';
  }
  if (
    lower.has('diffusers') ||
    lower.has('text-to-image') ||
    lower.has('stable-diffusion')
  ) {
    // Hub checkpoints often lack an explicit tag; prefer Checkpoint when not adapter.
    if (!lower.has('controlnet') && !lower.has('textual_inversion')) {
      return 'Checkpoint';
    }
  }
  return null;
}

const WEIGHT_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i;

async function fetchHfModelPage(
  filters: HfBrowseFilters,
  cursor: string | null | undefined,
  branch: HfFamilyQueryBranch | undefined,
  signal?: AbortSignal,
): Promise<{ items: HuggingFaceModelHit[]; nextCursor: string | null }> {
  const params = buildHfModelSearchQuery(filters, cursor, branch);
  const url = `${HF_API_BASE}/models?${params.toString()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'WildcardsManager/1.0 (Hugging Face search)',
      ...hfAuthHeaders(),
    },
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Hugging Face search failed (${response.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
    );
  }

  const json: unknown = await response.json();
  if (!Array.isArray(json)) {
    throw new Error('Hugging Face search returned an unexpected payload');
  }

  const items = json
    .map(mapModelHit)
    .filter((item): item is HuggingFaceModelHit => Boolean(item));
  return {
    items,
    nextCursor: parseHfNextCursor(response.headers.get('Link')),
  };
}

export async function searchHuggingFaceModels(opts: {
  filters: unknown;
  cursor?: string | null;
  signal?: AbortSignal;
}): Promise<HuggingFaceSearchResult> {
  const filters: HfBrowseFilters = parseHfBrowseFilters(opts.filters);
  const familyBranches = hfFamilyQueryBranches(filters.modelFamily);
  if (familyBranches.length > 1) {
    const plans = planHfFamilyFetches(familyBranches, opts.cursor);
    if (plans.length === 0) {
      return { items: [], nextCursor: null, fetchedCount: 0 };
    }
    const pages = await Promise.all(
      plans.map(async (plan) => {
        const fetched = await fetchHfModelPage(
          filters,
          plan.cursor,
          plan.branch,
          opts.signal,
        );
        return {
          plan,
          items: fetched.items,
          nextCursor: fetched.nextCursor,
        };
      }),
    );
    const assembled = assembleHfFamilyPage(pages, familyBranches, {
      sort: filters.sort,
      direction: filters.direction,
      limit: filters.limit,
    });
    return {
      items: filterHfSearchItemsForModelType(
        assembled.items,
        filters.modelType,
      ),
      nextCursor: assembled.nextCursor,
      fetchedCount: pages.reduce((sum, page) => sum + page.items.length, 0),
    };
  }

  const fetched = await fetchHfModelPage(
    filters,
    opts.cursor,
    undefined,
    opts.signal,
  );
  return {
    items: filterHfSearchItemsForModelType(fetched.items, filters.modelType),
    nextCursor: fetched.nextCursor,
    fetchedCount: fetched.items.length,
  };
}

export async function getHuggingFaceModelDetail(
  repoId: string,
  opts?: { signal?: AbortSignal },
): Promise<HuggingFaceModelDetail> {
  const id = repoId.trim().replace(/^\/+|\/+$/g, '');
  if (!id) throw new Error('Invalid Hugging Face model id');

  // Hub expects a literal slash in the path (`/api/models/org/name`).
  const url = `${HF_API_BASE}/models/${id}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'WildcardsManager/1.0 (Hugging Face model)',
      ...hfAuthHeaders(),
    },
    signal: opts?.signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Hugging Face model lookup failed (${response.status})${
        body ? `: ${body.slice(0, 200)}` : ''
      }`,
    );
  }

  const row = asRecord(await response.json());
  if (!row) throw new Error('Hugging Face model lookup returned empty payload');

  const tags = Array.isArray(row.tags)
    ? row.tags.filter((t): t is string => typeof t === 'string')
    : [];
  const siblingsRaw = Array.isArray(row.siblings) ? row.siblings : [];
  const siblings: HuggingFaceRepoFile[] = [];
  for (const item of siblingsRaw) {
    const s = asRecord(item);
    if (!s) continue;
    const path = asString(s.rfilename) ?? asString(s.path);
    if (!path || !WEIGHT_EXT.test(path)) continue;
    siblings.push({
      path,
      size: asNumber(s.size),
      oid: asString(s.blob_id) ?? asString(s.oid) ?? undefined,
    });
  }
  siblings.sort(compareHfWeightFiles);

  return {
    id: asString(row.id) ?? id,
    tags,
    pipelineTag: asString(row.pipeline_tag),
    libraryName: asString(row.library_name),
    gated: parseGated(row.gated),
    private: row.private === true,
    siblings,
    pageUrl: huggingfaceModelPageUrl(id),
    suggestedType: suggestedTypeFromTags(tags),
  };
}

export function hfResolveDownloadUrl(
  repoId: string,
  filePath: string,
  revision = 'main',
): string {
  const id = repoId.trim().replace(/^\/+|\/+$/g, '');
  const file = filePath.replace(/^\/+/, '').replace(/\\/g, '/');
  const rev = revision.trim() || 'main';
  return `${HF_SITE_ORIGIN}/${id}/resolve/${encodeURIComponent(rev)}/${file
    .split('/')
    .map(encodeURIComponent)
    .join('/')}?download=true`;
}
