/**
 * Hugging Face Hub model search helpers.
 * REST: GET https://huggingface.co/api/models
 */

export const HF_API_BASE = 'https://huggingface.co/api';
export const HF_SITE_ORIGIN = 'https://huggingface.co';

export type HfModelTypeId =
  | 'any'
  | 'lora'
  | 'checkpoint'
  | 'lycoris'
  | 'controlnet'
  | 'textual_inversion'
  | 'ip-adapter';

export type HfModelFamilyId =
  | 'any'
  | 'sd15'
  | 'sdxl'
  | 'pony'
  | 'illustrious'
  | 'flux'
  | 'sd3'
  | 'krea2'
  | 'qwen-image';

export type HfSortId =
  | 'downloads'
  | 'likes'
  | 'lastModified'
  | 'trendingScore'
  | 'createdAt';

export type HfGatedFilter = 'any' | 'true' | 'false';

export type HfBrowseFilters = {
  search: string;
  author: string;
  modelType: HfModelTypeId;
  modelFamily: HfModelFamilyId;
  /** Extra tag filters (comma/space separated). */
  tags: string;
  /** Hub repo id → `filter=base_model:{id}`. */
  baseModel: string;
  /** Empty = any task. */
  pipelineTag: string;
  /** Empty = any library. */
  library: string;
  sort: HfSortId;
  direction: 1 | -1;
  gated: HfGatedFilter;
  limit: number;
};

export const HF_MODEL_TYPES: Array<{ id: HfModelTypeId; label: string }> = [
  { id: 'any', label: 'Any type' },
  { id: 'lora', label: 'LoRA' },
  { id: 'checkpoint', label: 'Checkpoint' },
  { id: 'lycoris', label: 'LyCORIS' },
  { id: 'controlnet', label: 'ControlNet' },
  { id: 'textual_inversion', label: 'Textual inversion' },
  { id: 'ip-adapter', label: 'IP-Adapter' },
];

export const HF_MODEL_FAMILIES: Array<{ id: HfModelFamilyId; label: string }> = [
  { id: 'any', label: 'Any family' },
  { id: 'sd15', label: 'SD 1.5' },
  { id: 'sdxl', label: 'SDXL' },
  { id: 'pony', label: 'Pony' },
  { id: 'illustrious', label: 'Illustrious' },
  { id: 'flux', label: 'Flux' },
  { id: 'sd3', label: 'SD3' },
  { id: 'krea2', label: 'Krea 2' },
  { id: 'qwen-image', label: 'Qwen Image' },
];

export const HF_PIPELINE_TAGS: Array<{ id: string; label: string }> = [
  { id: '', label: 'Any task' },
  { id: 'text-to-image', label: 'Text-to-image' },
  { id: 'image-to-image', label: 'Image-to-image' },
  { id: 'image-to-video', label: 'Image-to-video' },
  { id: 'text-to-video', label: 'Text-to-video' },
  { id: 'text-to-3d', label: 'Text-to-3d' },
  { id: 'unconditional-image-generation', label: 'Unconditional image gen' },
];

export const HF_LIBRARIES: Array<{ id: string; label: string }> = [
  { id: '', label: 'Any library' },
  { id: 'diffusers', label: 'Diffusers' },
  { id: 'transformers', label: 'Transformers' },
  { id: 'peft', label: 'PEFT' },
  { id: 'safetensors', label: 'Safetensors' },
  { id: 'gguf', label: 'GGUF' },
];

export const HF_SORTS: Array<{ id: HfSortId; label: string }> = [
  { id: 'downloads', label: 'Most downloaded' },
  { id: 'likes', label: 'Most liked' },
  { id: 'trendingScore', label: 'Trending' },
  { id: 'lastModified', label: 'Recently updated' },
  { id: 'createdAt', label: 'Newest' },
];

export const DEFAULT_HF_BROWSE_FILTERS: HfBrowseFilters = {
  search: '',
  author: '',
  modelType: 'lora',
  modelFamily: 'any',
  tags: '',
  baseModel: '',
  pipelineTag: 'text-to-image',
  library: 'diffusers',
  sort: 'downloads',
  direction: -1,
  gated: 'any',
  limit: 30,
};

const MODEL_TYPE_IDS = new Set<string>(HF_MODEL_TYPES.map((t) => t.id));
const MODEL_FAMILY_IDS = new Set<string>(HF_MODEL_FAMILIES.map((f) => f.id));
const SORT_IDS = new Set<string>(HF_SORTS.map((s) => s.id));

/** Tags that mark adapter-style repos (used to approximate “checkpoint”). */
export const HF_ADAPTER_TAGS = [
  'lora',
  'lycoris',
  'controlnet',
  'textual_inversion',
  'ip-adapter',
  'adapter',
] as const;

/**
 * One Hub list request ANDs every `filter` param, so a family that is known
 * under several tags has to be queried once per tag and merged.
 *
 * Krea 2 is the split case. Older cards use the tag `krea`. Current LoRAs
 * are tagged `krea-2` / `krea2`, linked with `base_model:krea/Krea-2-Raw`,
 * `base_model:krea/Krea-2-Turbo`, or `base_model:Comfy-Org/Krea-2`, or they
 * only mention Krea 2 in the repo name and carry no family tag at all.
 */
export type HfFamilyQueryBranch = {
  /** Stable id stored in the merged pagination cursor. */
  id: string;
  /** Hub `filter` value. Omit for a text-only branch. */
  tag?: string;
  /** Extra search text, combined with the user's keyword. */
  search?: string;
};

const FAMILY_QUERY_BRANCHES: Record<
  Exclude<HfModelFamilyId, 'any'>,
  readonly HfFamilyQueryBranch[]
> = {
  sd15: [{ id: 'sd15', tag: 'stable-diffusion' }],
  sdxl: [{ id: 'sdxl', tag: 'stable-diffusion-xl' }],
  pony: [{ id: 'pony', tag: 'pony' }],
  illustrious: [{ id: 'illustrious', tag: 'illustrious' }],
  flux: [{ id: 'flux', tag: 'flux' }],
  sd3: [{ id: 'sd3', tag: 'stable-diffusion-3' }],
  krea2: [
    { id: 'krea', tag: 'krea' },
    { id: 'krea-2', tag: 'krea-2' },
    { id: 'krea2', tag: 'krea2' },
    { id: 'bm-raw', tag: 'base_model:krea/Krea-2-Raw' },
    { id: 'bm-turbo', tag: 'base_model:krea/Krea-2-Turbo' },
    { id: 'bm-comfy', tag: 'base_model:Comfy-Org/Krea-2' },
    { id: 'name-krea2', search: 'krea2' },
    { id: 'name-krea-2', search: 'krea-2' },
  ],
  'qwen-image': [{ id: 'qwen', tag: 'qwen' }],
};

export function hfFamilyQueryBranches(
  family: HfModelFamilyId,
): readonly HfFamilyQueryBranch[] {
  if (family === 'any') return [];
  return FAMILY_QUERY_BRANCHES[family];
}

const TYPE_FILTER_TAG: Partial<Record<HfModelTypeId, string>> = {
  lora: 'lora',
  lycoris: 'lycoris',
  controlnet: 'controlnet',
  textual_inversion: 'textual_inversion',
  'ip-adapter': 'ip-adapter',
};

export function huggingfaceModelPageUrl(modelId: string): string {
  const id = modelId.trim().replace(/^\/+|\/+$/g, '');
  return `${HF_SITE_ORIGIN}/${id}`;
}

/** `https://huggingface.co/<org>/<repo>` (extra path segments are ignored). */
export function parseHuggingFaceModelPageUrl(
  raw: string,
): { repoId: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'huggingface.co') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const head = parts[0]!.toLowerCase();
  if (
    head === 'datasets' ||
    head === 'spaces' ||
    head === 'collections' ||
    head === 'docs' ||
    head === 'models'
  ) {
    return null;
  }
  return { repoId: `${parts[0]}/${parts[1]}` };
}

export function parseHfBrowseFilters(raw: unknown): HfBrowseFilters {
  const defaults = { ...DEFAULT_HF_BROWSE_FILTERS };
  if (!raw || typeof raw !== 'object') return defaults;
  const row = raw as Record<string, unknown>;

  const modelType =
    typeof row.modelType === 'string' && MODEL_TYPE_IDS.has(row.modelType)
      ? (row.modelType as HfModelTypeId)
      : defaults.modelType;
  const modelFamily =
    typeof row.modelFamily === 'string' && MODEL_FAMILY_IDS.has(row.modelFamily)
      ? (row.modelFamily as HfModelFamilyId)
      : defaults.modelFamily;
  const sort =
    typeof row.sort === 'string' && SORT_IDS.has(row.sort)
      ? (row.sort as HfSortId)
      : defaults.sort;
  const direction = row.direction === 1 || row.direction === '1' ? 1 : -1;
  const gated =
    row.gated === 'true' || row.gated === 'false' || row.gated === 'any'
      ? row.gated
      : defaults.gated;
  const limitRaw =
    typeof row.limit === 'number'
      ? row.limit
      : typeof row.limit === 'string'
        ? Number(row.limit)
        : defaults.limit;
  const limit = Number.isFinite(limitRaw)
    ? Math.min(100, Math.max(5, Math.round(limitRaw)))
    : defaults.limit;

  return {
    search: typeof row.search === 'string' ? row.search : defaults.search,
    author: typeof row.author === 'string' ? row.author : defaults.author,
    modelType,
    modelFamily,
    tags: typeof row.tags === 'string' ? row.tags : defaults.tags,
    baseModel:
      typeof row.baseModel === 'string' ? row.baseModel : defaults.baseModel,
    pipelineTag:
      typeof row.pipelineTag === 'string'
        ? row.pipelineTag
        : defaults.pipelineTag,
    library: typeof row.library === 'string' ? row.library : defaults.library,
    sort,
    direction,
    gated,
    limit,
  };
}

/** Split free-form tags on commas / whitespace. */
export function splitHfTagList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}

export function buildHfModelSearchQuery(
  filters: HfBrowseFilters,
  cursor?: string | null,
  branch?: HfFamilyQueryBranch,
): URLSearchParams {
  const params = new URLSearchParams();
  const familyBranches = hfFamilyQueryBranches(filters.modelFamily);
  const active =
    branch ?? (familyBranches.length === 1 ? familyBranches[0] : undefined);
  if (!branch && familyBranches.length > 1) {
    throw new Error(
      `Hugging Face family "${filters.modelFamily}" is queried once per tag`,
    );
  }

  const searchTokens: string[] = [];
  const pushSearch = (raw: string) => {
    for (const token of raw.split(/\s+/)) {
      if (token && !searchTokens.includes(token)) searchTokens.push(token);
    }
  };
  pushSearch(filters.search.trim());
  if (active?.search) pushSearch(active.search);
  if (searchTokens.length > 0) params.set('search', searchTokens.join(' '));

  const author = filters.author.trim();
  if (author) params.set('author', author);
  const pipelineTag = filters.pipelineTag.trim();
  if (pipelineTag) params.set('pipeline_tag', pipelineTag);
  const library = filters.library.trim();
  if (library) params.set('library', library);

  params.set('sort', filters.sort);
  params.set('direction', String(filters.direction));
  params.set('limit', String(filters.limit));
  // File list + model-card YAML, so cards can show a sample image.
  params.set('full', 'true');
  params.set('cardData', 'true');

  if (filters.gated === 'true' || filters.gated === 'false') {
    params.set('gated', filters.gated);
  }

  const filtersToAdd: string[] = [];
  const typeTag = TYPE_FILTER_TAG[filters.modelType];
  if (typeTag) filtersToAdd.push(typeTag);
  if (active?.tag) filtersToAdd.push(active.tag);
  const baseModel = filters.baseModel.trim();
  if (baseModel) filtersToAdd.push(`base_model:${baseModel}`);
  for (const tag of splitHfTagList(filters.tags)) {
    filtersToAdd.push(tag);
  }
  for (const tag of [...new Set(filtersToAdd)]) {
    params.append('filter', tag);
  }

  if (cursor?.trim()) params.set('cursor', cursor.trim());
  return params;
}

/** Fields needed to merge Hub pages that were sorted the same way. */
export type HfSortableHit = {
  id: string;
  likes: number;
  downloads: number;
  createdAt: string | null;
  lastModified: string | null;
  trendingScore: number | null;
};

export function compareHfSearchHits(
  a: HfSortableHit,
  b: HfSortableHit,
  sort: HfSortId,
  direction: 1 | -1,
): number {
  const value = (hit: HfSortableHit): number | string => {
    switch (sort) {
      case 'likes':
        return hit.likes;
      case 'downloads':
        return hit.downloads;
      case 'trendingScore':
        return hit.trendingScore ?? Number.NEGATIVE_INFINITY;
      case 'lastModified':
        return hit.lastModified ?? '';
      case 'createdAt':
        return hit.createdAt ?? '';
    }
  };
  const av = value(a);
  const bv = value(b);
  let cmp = 0;
  if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  if (cmp === 0) cmp = a.id.localeCompare(b.id);
  return direction === -1 ? -cmp : cmp;
}

export const HF_FAMILY_CURSOR_PREFIX = 'hfmerge1.';

export type HfFamilyFetchPlan = {
  branch: HfFamilyQueryBranch;
  /** Cursor sent to Hub. null starts at the first page. */
  cursor: string | null;
  /**
   * When set, this fetch replays a page and only these ids still need to be
   * shown. `after` is the Hub cursor that follows the replayed page.
   */
  onlyIds: string[] | null;
  after: string | null;
};

type HfFamilySavedBranch =
  | null
  | { cursor: string | null }
  | { replay: string | null; only: string[]; after: string | null };

type HfFamilyCursorState = {
  v: 1;
  branches: Record<string, HfFamilySavedBranch>;
};

export type HfFamilyFetchedPage<T> = {
  plan: HfFamilyFetchPlan;
  items: T[];
  /** `Link rel=next` from this response. Ignored while replaying a page. */
  nextCursor: string | null;
};

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseSavedBranch(value: unknown): HfFamilySavedBranch | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (Array.isArray(row.only)) {
    return {
      replay: typeof row.replay === 'string' ? row.replay : null,
      only: row.only.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
      after: typeof row.after === 'string' ? row.after : null,
    };
  }
  if ('cursor' in row) {
    return { cursor: typeof row.cursor === 'string' ? row.cursor : null };
  }
  return undefined;
}

export function decodeHfFamilyCursor(
  cursor: string | null | undefined,
): HfFamilyCursorState | null {
  if (!cursor?.startsWith(HF_FAMILY_CURSOR_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(
      decodeBase64Url(cursor.slice(HF_FAMILY_CURSOR_PREFIX.length)),
    );
    if (!parsed || typeof parsed !== 'object') return null;
    const row = parsed as Record<string, unknown>;
    if (row.v !== 1 || !row.branches || typeof row.branches !== 'object') {
      return null;
    }
    const branches: Record<string, HfFamilySavedBranch> = {};
    for (const [id, value] of Object.entries(
      row.branches as Record<string, unknown>,
    )) {
      const saved = parseSavedBranch(value);
      if (saved !== undefined) branches[id] = saved;
    }
    return { v: 1, branches };
  } catch {
    return null;
  }
}

function encodeHfFamilyCursor(state: HfFamilyCursorState): string {
  return HF_FAMILY_CURSOR_PREFIX + encodeBase64Url(JSON.stringify(state));
}

/** How to fetch the next page of a multi-tag family search. */
export function planHfFamilyFetches(
  branches: readonly HfFamilyQueryBranch[],
  cursor: string | null | undefined,
): HfFamilyFetchPlan[] {
  const saved = decodeHfFamilyCursor(cursor);
  const plans: HfFamilyFetchPlan[] = [];
  for (const branch of branches) {
    if (!saved) {
      plans.push({ branch, cursor: null, onlyIds: null, after: null });
      continue;
    }
    if (!(branch.id in saved.branches)) {
      plans.push({ branch, cursor: null, onlyIds: null, after: null });
      continue;
    }
    const state = saved.branches[branch.id];
    if (state === null) continue;
    if (!state) {
      plans.push({ branch, cursor: null, onlyIds: null, after: null });
      continue;
    }
    if ('only' in state) {
      if (state.only.length === 0) {
        if (state.after) {
          plans.push({
            branch,
            cursor: state.after,
            onlyIds: null,
            after: null,
          });
        }
        continue;
      }
      plans.push({
        branch,
        cursor: state.replay,
        onlyIds: state.only,
        after: state.after,
      });
      continue;
    }
    plans.push({
      branch,
      cursor: state.cursor,
      onlyIds: null,
      after: null,
    });
  }
  return plans;
}

/**
 * Merge one round of family-tag pages into a single sorted page.
 * Rows that lose the sort stay in the cursor so the next round does not
 * skip them or pull the following Hub page too early.
 */
export function assembleHfFamilyPage<T extends HfSortableHit>(
  pages: Array<HfFamilyFetchedPage<T>>,
  branches: readonly HfFamilyQueryBranch[],
  opts: { sort: HfSortId; direction: 1 | -1; limit: number },
): { items: T[]; nextCursor: string | null } {
  const byId = new Map<string, T>();
  for (const page of pages) {
    const source = page.plan.onlyIds
      ? page.plan.onlyIds.flatMap((id) => {
          const match = page.items.find((item) => item.id === id);
          return match ? [match] : [];
        })
      : page.items;
    for (const item of source) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }

  const sorted = [...byId.values()].sort((a, b) =>
    compareHfSearchHits(a, b, opts.sort, opts.direction),
  );
  const items = sorted.slice(0, Math.max(0, opts.limit));
  const emitted = new Set(items.map((item) => item.id));
  const pageById = new Map(pages.map((page) => [page.plan.branch.id, page]));
  const saved: Record<string, HfFamilySavedBranch> = {};
  let more = false;

  for (const branch of branches) {
    const page = pageById.get(branch.id);
    if (!page) {
      saved[branch.id] = null;
      continue;
    }
    const sourceIds = page.plan.onlyIds
      ? page.plan.onlyIds.filter((id) => page.items.some((item) => item.id === id))
      : page.items.map((item) => item.id);
    const pending = sourceIds.filter((id) => !emitted.has(id));
    const following = page.plan.onlyIds ? page.plan.after : page.nextCursor;
    if (pending.length > 0) {
      more = true;
      saved[branch.id] = {
        replay: page.plan.cursor,
        only: pending,
        after: following,
      };
      continue;
    }
    if (following) {
      more = true;
      saved[branch.id] = { cursor: following };
      continue;
    }
    saved[branch.id] = null;
  }

  return {
    items,
    nextCursor: more ? encodeHfFamilyCursor({ v: 1, branches: saved }) : null,
  };
}

export function isHfAdapterModel(tags: string[] | undefined): boolean {
  if (!tags?.length) return false;
  const lower = new Set(tags.map((t) => t.toLowerCase()));
  return HF_ADAPTER_TAGS.some((t) => lower.has(t));
}

/**
 * Hub has no dedicated “checkpoint” tag; approximate by dropping adapter tags
 * when model type is Checkpoint.
 */
export function filterHfSearchItemsForModelType<
  T extends { tags?: string[] },
>(items: T[], modelType: HfModelTypeId): T[] {
  if (modelType !== 'checkpoint') return items;
  return items.filter((item) => !isHfAdapterModel(item.tags));
}

/** Parse `Link: <url>; rel="next"` from Hub list responses. */
export function parseHfNextCursor(linkHeader: string | null): string | null {
  if (!linkHeader?.trim()) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (!match?.[1]) continue;
    try {
      const url = new URL(match[1]);
      return url.searchParams.get('cursor');
    } catch {
      /* ignore malformed */
    }
  }
  return null;
}
