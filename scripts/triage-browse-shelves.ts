/**
 * Move Browse cards that are not downloaded.
 * LoRA / Checkpoint: Notify when nothing is downloadable yet, otherwise Archive.
 * Images / Videos: Archive. Downloaded ids are left as they are.
 * Prints counts only.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { browseCardNeedsNotify } from '../src/domain/browseShelfTriage.js';
import { expandArchitectureApiValues } from '../src/domain/civitaiBaseModels.js';
import {
  catalogOriginHost,
  idChunkFileName,
  modelPageIndex,
} from '../src/domain/civitaiCatalogLayout.js';
import {
  CIVITAI_IMAGES_PAGE_LIMIT,
  civitaiImageMatchesTools,
  isCivitaiImageToolFilterId,
} from '../src/domain/civitaiImageTools.js';
import {
  civitaiCommunityMediaKind,
  civitaiHitMatchesRequestedMedia,
} from '../src/domain/civitaiMediaType.js';
import {
  assembleHfFamilyPage,
  buildHfModelSearchQuery,
  filterHfSearchItemsForModelType,
  HF_API_BASE,
  hfFamilyQueryBranches,
  parseHfBrowseFilters,
  parseHfNextCursor,
  planHfFamilyFetches,
  type HfSortableHit,
} from '../src/domain/huggingfaceSearch.js';
import {
  civitaiCatalogDir,
  libraryJsonPath,
} from '../src/domain/librarySidecarPaths.js';
import {
  backupBeforeRewrite,
  readLibrarySlot,
  writeLibrarySlot,
} from '../src/main/libraryLocalFile.js';
import type { LibraryLocalPayload } from '../src/main/libraryLocalState.js';

type ShelfModel = {
  id?: number;
  name?: string;
  type?: string;
  earlyAccess?: boolean;
  earlyAccessEndsAt?: string;
  versions?: Array<{
    id?: number;
    earlyAccess?: boolean;
    earlyAccessEndsAt?: string;
    downloadPrice?: number;
    earlyAccessConfig?: {
      downloadPrice?: number;
      chargeForDownload?: boolean;
    } | null;
  }>;
};

type SettingsFile = {
  civitaiApiKey?: string;
  huggingfaceToken?: string;
  activeLibraryId?: string;
  libraries?: Array<{
    id?: string;
    name?: string;
    wildcardsRoot?: string | null;
    civitaiOrigin?: string;
    enabledArchitectures?: string[];
  }>;
};

type ImageFilters = {
  sort?: string;
  period?: string;
  nsfwMode?: string;
  tool?: string;
  architecture?: string;
  sdxlFamily?: string;
};

const PAGE_LIMIT = CIVITAI_IMAGES_PAGE_LIMIT;
const MAX_MEDIA_PAGES = 8000;
const MEDIA_FLUSH_EVERY = 20;

function modelKind(type: string | undefined): 'LORA' | 'Checkpoint' | null {
  const value = (type ?? '').trim().toLowerCase();
  if (value === 'lora' || value === 'locon' || value === 'dora' || value === 'lycoris') {
    return 'LORA';
  }
  if (value === 'checkpoint') return 'Checkpoint';
  return null;
}

function readSettings(): SettingsFile {
  const appData = process.env.APPDATA;
  if (!appData) throw new Error('APPDATA is not set');
  const file = path.join(appData, 'wildcards-manager', 'settings.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as SettingsFile;
}

function loadDownloadedMediaIds(fileName: string): Set<number> {
  const appData = process.env.APPDATA;
  const ids = new Set<number>();
  if (!appData) return ids;
  const file = path.join(appData, 'wildcards-manager', fileName);
  if (!fs.existsSync(file)) return ids;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    items?: Array<{ imageId?: unknown }>;
  };
  for (const row of raw.items ?? []) {
    const id = row?.imageId;
    if (typeof id === 'number' && id > 0) ids.add(Math.round(id));
  }
  return ids;
}

function originOf(raw: string | undefined): 'https://civitai.com' | 'https://civitai.red' {
  return raw === 'https://civitai.red' ? 'https://civitai.red' : 'https://civitai.com';
}

function baseModelsFor(filters: ImageFilters | undefined): string[] {
  const architecture = filters?.architecture ?? 'krea';
  const family = filters?.sdxlFamily ?? 'all';
  if (architecture === 'sdxl') {
    const families =
      family === 'pony' || family === 'illustrious' || family === 'noobai' || family === 'sdxl'
        ? [family]
        : (['sdxl', 'pony', 'illustrious', 'noobai'] as const);
    return expandArchitectureApiValues(['sdxl'], { sdxlFamilies: [...families] });
  }
  if (
    architecture === 'sd15' ||
    architecture === 'flux' ||
    architecture === 'krea' ||
    architecture === 'other'
  ) {
    return expandArchitectureApiValues([architecture]);
  }
  return expandArchitectureApiValues(['krea']);
}

function browsingLevel(mode: string | undefined): number {
  if (mode === 'all') return 31;
  if (mode === 'nsfw') return 28;
  return 3;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function civitaiImagesPage(opts: {
  origin: string;
  apiKey: string;
  media: 'image' | 'video';
  cursor: string | null;
  filters: ImageFilters | undefined;
  baseModels: string[];
}): Promise<{ items: Array<Record<string, unknown>>; nextCursor: string | null }> {
  const qs = new URLSearchParams();
  qs.set('limit', String(PAGE_LIMIT));
  qs.set('type', opts.media);
  qs.set('browsingLevel', String(browsingLevel(opts.filters?.nsfwMode)));
  qs.set('withMeta', 'true');
  qs.set('sort', 'Newest');
  const period = opts.filters?.period;
  if (
    period === 'AllTime' ||
    period === 'Year' ||
    period === 'Month' ||
    period === 'Week' ||
    period === 'Day'
  ) {
    qs.set('period', period);
  }
  if (opts.cursor) qs.set('cursor', opts.cursor);
  for (const base of opts.baseModels) qs.append('baseModels', base);
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  let lastError = 'image request failed';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await sleep(attempt === 0 ? 350 : 1500 * (attempt + 1));
    const response = await fetch(`${opts.origin}/api/v1/images?${qs.toString()}`, {
      headers,
    });
    if (response.status === 429 || response.status >= 500) {
      lastError = `HTTP ${response.status}`;
      continue;
    }
    if (!response.ok) {
      throw new Error(`Civitai images HTTP ${response.status}`);
    }
    const data = (await response.json()) as {
      items?: unknown[];
      metadata?: { nextCursor?: unknown };
    };
    const cursor = data.metadata?.nextCursor;
    return {
      items: Array.isArray(data.items)
        ? data.items.filter(
            (row): row is Record<string, unknown> =>
              Boolean(row) && typeof row === 'object',
          )
        : [],
      nextCursor:
        typeof cursor === 'string' && cursor.trim()
          ? cursor.trim()
          : typeof cursor === 'number' && Number.isFinite(cursor)
            ? String(cursor)
            : null,
    };
  }
  throw new Error(lastError);
}

function hitId(row: Record<string, unknown>): number | null {
  return typeof row.id === 'number' && row.id > 0 ? Math.round(row.id) : null;
}

function hitCreatedAt(row: Record<string, unknown>): number | null {
  const raw = row.createdAt ?? row.publishedAt;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : null;
}

function oneMonthAgoMs(): number {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 1);
  return cutoff.getTime();
}

function hitKept(
  row: Record<string, unknown>,
  media: 'image' | 'video',
  filters: ImageFilters | undefined,
  baseModels: string[],
): boolean {
  const url = typeof row.url === 'string' ? row.url : '';
  const declared = typeof row.type === 'string' ? row.type : null;
  const kind = civitaiCommunityMediaKind({ type: declared, url });
  if (!civitaiHitMatchesRequestedMedia(kind, media)) return false;
  const tool = filters?.tool;
  if (tool && tool !== 'any' && isCivitaiImageToolFilterId(tool)) {
    const meta =
      row.meta && typeof row.meta === 'object'
        ? (row.meta as Record<string, unknown>)
        : null;
    if (!civitaiImageMatchesTools(meta, [tool])) return false;
  }
  if (baseModels.length === 0) return true;
  const meta =
    row.meta && typeof row.meta === 'object'
      ? (row.meta as Record<string, unknown>)
      : null;
  const base =
    (typeof row.baseModel === 'string' && row.baseModel.trim()) ||
    (typeof meta?.baseModel === 'string' && meta.baseModel.trim()) ||
    '';
  if (!base) return true;
  const lower = base.toLowerCase();
  return baseModels.some((value) => value.trim().toLowerCase() === lower);
}

type LibraryRow = {
  id: string;
  name: string;
  wildcardsRoot: string;
  origin: 'https://civitai.com' | 'https://civitai.red';
  architectures: string[];
};

function librariesFrom(settings: SettingsFile): LibraryRow[] {
  const rows: LibraryRow[] = [];
  for (const item of settings.libraries ?? []) {
    const id = item.id?.trim();
    const root = item.wildcardsRoot?.trim();
    if (!id || !root) continue;
    const architectures = (item.enabledArchitectures ?? [])
      .map((value) => value.trim())
      .filter(Boolean)
      .sort();
    rows.push({
      id,
      name: item.name?.trim() || 'Library',
      wildcardsRoot: root,
      origin: originOf(item.civitaiOrigin),
      architectures,
    });
  }
  return rows;
}

function browseModelIds(lib: LibraryRow): number[] {
  const slicesDir = path.join(
    civitaiCatalogDir(lib.wildcardsRoot, lib.id),
    'slices',
  );
  const wantArch = lib.architectures.join(',');
  const ids = new Set<number>();
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(slicesDir);
  } catch {
    return [];
  }
  for (const dir of dirs) {
    const metaPath = path.join(slicesDir, dir, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
      sliceKey?: string;
      idChunkCount?: number;
    };
    const key = meta.sliceKey ?? '';
    const parts = key.split('|');
    if (parts.length < 5) continue;
    const [origin, type, category, arch] = parts;
    if (origin !== lib.origin) continue;
    if (type !== 'LORA' && type !== 'Checkpoint') continue;
    if (category !== '') continue;
    if ((arch ?? '') !== wantArch) continue;
    const chunks = meta.idChunkCount ?? 0;
    for (let index = 0; index < chunks; index += 1) {
      const file = path.join(slicesDir, dir, idChunkFileName(index));
      if (!fs.existsSync(file)) continue;
      const chunk = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      if (!Array.isArray(chunk)) continue;
      for (const id of chunk) {
        if (typeof id === 'number' && id > 0) ids.add(id);
      }
    }
  }
  return [...ids];
}

function triageModels(lib: LibraryRow, slot: LibraryLocalPayload): {
  scanned: number;
  skippedDownloaded: number;
  skippedMaybe: number;
  skippedOther: number;
  archiveAdds: Array<{ origin: LibraryRow['origin']; modelId: number }>;
  watchAdds: NonNullable<LibraryLocalPayload['civitaiWatchlist']>;
} {
  const catalog = civitaiCatalogDir(lib.wildcardsRoot, lib.id);
  const downloaded = new Set<number>();
  const shelfPath = path.join(catalog, 'shelf-summaries.json');
  if (fs.existsSync(shelfPath)) {
    const shelf = JSON.parse(fs.readFileSync(shelfPath, 'utf8')) as {
      downloaded?: Array<{ id?: number }>;
    };
    for (const row of shelf.downloaded ?? []) {
      if (typeof row.id === 'number' && row.id > 0) downloaded.add(row.id);
    }
  }
  for (const row of slot.markedInstalledCivitaiModels ?? []) {
    if (row.modelId > 0) downloaded.add(row.modelId);
  }
  const archivedIds = new Set(
    (slot.archivedCivitaiModels ?? []).map((row) => row.modelId),
  );
  const maybeIds = new Set(
    (slot.maybeCivitaiModels ?? []).map((row) => row.modelId),
  );
  const watchIds = new Set(
    (slot.civitaiWatchlist ?? []).map((row) => row.modelId),
  );
  const archiveAdds: Array<{ origin: LibraryRow['origin']; modelId: number }> = [];
  const watchAdds: NonNullable<LibraryLocalPayload['civitaiWatchlist']> = [];
  let scanned = 0;
  let skippedDownloaded = 0;
  let skippedMaybe = 0;
  let skippedOther = 0;
  const hostDir = path.join(catalog, 'models', catalogOriginHost(lib.origin));
  const pages = new Map<number, number[]>();
  for (const id of browseModelIds(lib)) {
    const page = modelPageIndex(id);
    const list = pages.get(page);
    if (list) list.push(id);
    else pages.set(page, [id]);
  }
  for (const [page, ids] of pages) {
    const file = path.join(hostDir, `${page}.json`);
    const raw = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, ShelfModel>)
      : {};
    const byId = new Map<number, ShelfModel>();
    for (const model of Object.values(raw)) {
      if (typeof model?.id === 'number' && model.id > 0) byId.set(model.id, model);
    }
    for (const id of ids) {
      const model = byId.get(id);
      if (!model) {
        skippedOther += 1;
        continue;
      }
      const kind = modelKind(model.type);
      if (!kind) {
        skippedOther += 1;
        continue;
      }
      scanned += 1;
      if (downloaded.has(id)) {
        skippedDownloaded += 1;
        continue;
      }
      if (maybeIds.has(id)) {
        skippedMaybe += 1;
        continue;
      }
      if (archivedIds.has(id) || watchIds.has(id)) continue;
      if (browseCardNeedsNotify(model)) {
        watchIds.add(id);
        const versionId = model.versions?.find((row) => typeof row.id === 'number')?.id;
        watchAdds.push({
          origin: lib.origin,
          modelId: id,
          modelName: model.name?.trim() || String(id),
          type: kind,
          versionId,
          earlyAccessEndsAt: model.earlyAccessEndsAt,
          available: false,
          addedAt: new Date().toISOString(),
        });
        continue;
      }
      archivedIds.add(id);
      archiveAdds.push({ origin: lib.origin, modelId: id });
    }
  }
  return {
    scanned,
    skippedDownloaded,
    skippedMaybe,
    skippedOther,
    archiveAdds,
    watchAdds,
  };
}

function applyModelTriage(
  lib: LibraryRow,
  triage: ReturnType<typeof triageModels>,
): { archiveTotal: number; notifyTotal: number } {
  const slot = readLibrarySlot(lib.wildcardsRoot, lib.id);
  if (!slot) throw new Error('Missing library slot');
  const next: LibraryLocalPayload = {
    ...slot,
    version: 1,
    archivedCivitaiModels: [
      ...(slot.archivedCivitaiModels ?? []),
      ...triage.archiveAdds,
    ],
    civitaiWatchlist: [...(slot.civitaiWatchlist ?? []), ...triage.watchAdds],
  };
  writeLibrarySlot(lib.wildcardsRoot, lib.id, next);
  return {
    archiveTotal: next.archivedCivitaiModels?.length ?? 0,
    notifyTotal: next.civitaiWatchlist?.length ?? 0,
  };
}

type HfHit = HfSortableHit & { tags?: string[] };

async function fetchHfModelPage(
  filters: ReturnType<typeof parseHfBrowseFilters>,
  cursor: string | null,
  branch: Parameters<typeof buildHfModelSearchQuery>[2],
  token: string,
): Promise<{ items: HfHit[]; nextCursor: string | null }> {
  const params = buildHfModelSearchQuery(filters, cursor, branch);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'WildcardsManager/1.0 (Hugging Face model)',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let lastError = 'Hugging Face request failed';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await sleep(attempt === 0 ? 200 : 1000 * (attempt + 1));
    const response = await fetch(`${HF_API_BASE}/models?${params.toString()}`, {
      headers,
    });
    if (response.status === 429 || response.status >= 500) {
      lastError = `HTTP ${response.status}`;
      continue;
    }
    if (!response.ok) throw new Error(`Hugging Face HTTP ${response.status}`);
    const json: unknown = await response.json();
    if (!Array.isArray(json)) throw new Error('Hugging Face search returned an unexpected payload');
    const items: HfHit[] = [];
    for (const raw of json) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      if (!id) continue;
      items.push({
        id,
        likes: typeof row.likes === 'number' ? row.likes : 0,
        downloads: typeof row.downloads === 'number' ? row.downloads : 0,
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
        lastModified: typeof row.lastModified === 'string' ? row.lastModified : null,
        trendingScore: typeof row.trendingScore === 'number' ? row.trendingScore : null,
        tags: Array.isArray(row.tags)
          ? row.tags.filter((tag): tag is string => typeof tag === 'string')
          : [],
      });
    }
    return { items, nextCursor: parseHfNextCursor(response.headers.get('Link')) };
  }
  throw new Error(lastError);
}

async function searchHfPage(
  filters: ReturnType<typeof parseHfBrowseFilters>,
  cursor: string | null,
  token: string,
): Promise<{ items: HfHit[]; nextCursor: string | null }> {
  const branches = hfFamilyQueryBranches(filters.modelFamily);
  if (branches.length > 1) {
    const plans = planHfFamilyFetches(branches, cursor);
    if (plans.length === 0) return { items: [], nextCursor: null };
    const pages = await Promise.all(
      plans.map(async (plan) => {
        const fetched = await fetchHfModelPage(
          filters,
          plan.cursor,
          plan.branch,
          token,
        );
        return { plan, items: fetched.items, nextCursor: fetched.nextCursor };
      }),
    );
    const assembled = assembleHfFamilyPage(pages, branches, {
      sort: filters.sort,
      direction: filters.direction,
      limit: filters.limit,
    });
    return {
      items: filterHfSearchItemsForModelType(assembled.items, filters.modelType),
      nextCursor: assembled.nextCursor,
    };
  }
  const fetched = await fetchHfModelPage(filters, cursor, undefined, token);
  return {
    items: filterHfSearchItemsForModelType(fetched.items, filters.modelType),
    nextCursor: fetched.nextCursor,
  };
}

async function archiveHuggingFace(lib: LibraryRow, token: string): Promise<{
  pages: number;
  added: number;
  total: number;
}> {
  const slot = readLibrarySlot(lib.wildcardsRoot, lib.id);
  if (!slot) throw new Error('Missing library slot');
  const filters = parseHfBrowseFilters(slot.hfBrowseFilters);
  filters.limit = 100;
  const downloaded = new Set(
    (slot.downloadedHfModels ?? []).map((row) => row.repoId.toLowerCase()),
  );
  const existing = new Set(
    (slot.archivedHfModels ?? []).map((row) => row.repoId.toLowerCase()),
  );
  let cursor: string | null = null;
  let pages = 0;
  let added = 0;
  let pending: string[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    const current = readLibrarySlot(lib.wildcardsRoot, lib.id);
    if (!current) throw new Error('Missing library slot');
    const already = new Set(
      (current.archivedHfModels ?? []).map((row) => row.repoId.toLowerCase()),
    );
    const rows = pending
      .filter((repoId) => !already.has(repoId.toLowerCase()))
      .map((repoId) => ({ repoId }));
    pending = [];
    if (rows.length === 0) return;
    writeLibrarySlot(
      lib.wildcardsRoot,
      lib.id,
      {
        ...current,
        version: 1,
        archivedHfModels: [...(current.archivedHfModels ?? []), ...rows],
      },
      { replaceManualShelves: true },
    );
  };

  while (pages < 2000) {
    const page = await searchHfPage(filters, cursor, token);
    pages += 1;
    for (const hit of page.items) {
      const key = hit.id.toLowerCase();
      if (downloaded.has(key) || existing.has(key)) continue;
      existing.add(key);
      pending.push(hit.id);
      added += 1;
    }
    if (pages % 10 === 0) flush();
    if (!page.nextCursor) {
      flush();
      const current = readLibrarySlot(lib.wildcardsRoot, lib.id);
      return {
        pages,
        added,
        total: current?.archivedHfModels?.length ?? added,
      };
    }
    cursor = page.nextCursor;
    if (pages % 10 === 0) {
      console.log(JSON.stringify({ library: lib.name, media: 'hf', pages, added }));
    }
  }
  flush();
  const current = readLibrarySlot(lib.wildcardsRoot, lib.id);
  return { pages, added, total: current?.archivedHfModels?.length ?? added };
}

async function archiveMedia(opts: {
  lib: LibraryRow;
  media: 'image' | 'video';
  apiKey: string;
  downloaded: Set<number>;
}): Promise<{ pages: number; added: number; capped: boolean; stoppedAtOneMonth: boolean }> {
  const slot = readLibrarySlot(opts.lib.wildcardsRoot, opts.lib.id);
  if (!slot) throw new Error('Missing library slot');
  const filters =
    opts.media === 'image'
      ? (slot.civitaiImageBrowseFilters as ImageFilters | undefined)
      : (slot.civitaiVideoBrowseFilters as ImageFilters | undefined);
  const baseModels = baseModelsFor(filters);
  const key = opts.media === 'image' ? 'archivedCivitaiImages' : 'archivedCivitaiVideos';
  const existing = new Set(
    (slot[key] ?? []).map((row) => row.imageId),
  );
  const cutoffMs = oneMonthAgoMs();
  let cursor: string | null = null;
  let pages = 0;
  let added = 0;
  let removed = 0;
  let capped = false;
  let stoppedAtOneMonth = false;
  let pending: number[] = [];
  let removePending: number[] = [];

  const flush = () => {
    if (pending.length === 0 && removePending.length === 0) return;
    const current = readLibrarySlot(opts.lib.wildcardsRoot, opts.lib.id);
    if (!current) throw new Error('Missing library slot');
    const drop = new Set(removePending);
    removePending = [];
    const already = new Set(
      (current[key] ?? [])
        .map((row) => row.imageId)
        .filter((id) => !drop.has(id)),
    );
    const rows = pending
      .filter((id) => !already.has(id))
      .map((imageId) => ({ origin: opts.lib.origin, imageId }));
    pending = [];
    const kept = (current[key] ?? []).filter((row) => !drop.has(row.imageId));
    if (rows.length === 0 && kept.length === (current[key] ?? []).length) return;
    writeLibrarySlot(
      opts.lib.wildcardsRoot,
      opts.lib.id,
      {
        ...current,
        version: 1,
        [key]: [...kept, ...rows],
      },
      { replaceManualShelves: true },
    );
  };

  while (pages < MAX_MEDIA_PAGES) {
    const page = await civitaiImagesPage({
      origin: opts.lib.origin,
      apiKey: opts.apiKey,
      media: opts.media,
      cursor,
      filters,
      baseModels,
    });
    pages += 1;
    let pageHasArchived = false;
    let pageOlderThanMonth = false;
    for (const row of page.items) {
      const id = hitId(row);
      if (id == null) continue;
      if (!hitKept(row, opts.media, filters, baseModels)) continue;
      if (existing.has(id)) pageHasArchived = true;
      const created = hitCreatedAt(row);
      if (created != null && created < cutoffMs) {
        pageOlderThanMonth = true;
        if (existing.has(id)) {
          existing.delete(id);
          removePending.push(id);
          removed += 1;
        }
        continue;
      }
      if (opts.downloaded.has(id) || existing.has(id)) continue;
      existing.add(id);
      pending.push(id);
      added += 1;
    }
    if (pages % MEDIA_FLUSH_EVERY === 0 || pageOlderThanMonth) flush();
    if (pageOlderThanMonth && !pageHasArchived) {
      stoppedAtOneMonth = true;
      flush();
      console.log(
        JSON.stringify({
          library: opts.lib.name,
          media: opts.media,
          pages,
          added,
          removed,
          stoppedAtOneMonth: true,
        }),
      );
      return { pages, added, capped, stoppedAtOneMonth };
    }
    if (!page.nextCursor) {
      flush();
      return { pages, added, capped, stoppedAtOneMonth };
    }
    cursor = page.nextCursor;
    if (pages % 25 === 0) {
      console.log(
        JSON.stringify({
          library: opts.lib.name,
          media: opts.media,
          pages,
          added,
          removed,
        }),
      );
    }
  }
  capped = true;
  flush();
  return { pages, added, capped, stoppedAtOneMonth };
}

function wildcardsAppIsRunning(): boolean {
  if (process.platform !== 'win32') return false;
  const script =
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -or $_.Name -eq 'Wildcards Manager.exe' } | ForEach-Object { $_.Name + ' ' + $_.CommandLine }";
  let text = '';
  try {
    text = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', script],
      { encoding: 'utf8', timeout: 30000 },
    );
  } catch {
    return false;
  }
  return /Wildcards Manager\.exe/i.test(text) || /[\\/]WildcardsManager[\\/]/i.test(text);
}

async function main(): Promise<void> {
  const countsOnly = process.argv.includes('--counts-only');
  if (!countsOnly && wildcardsAppIsRunning()) {
    throw new Error(
      'Wildcards Manager is still running. Quit it, including the tray, before this write.',
    );
  }
  const settings = readSettings();
  const libs = librariesFrom(settings).filter(
    (lib) => lib.id === settings.activeLibraryId,
  );
  if (libs.length === 0) throw new Error('No active library with a wildcards folder');
  const roots = [...new Set(libs.map((lib) => path.resolve(lib.wildcardsRoot)))];
  if (!countsOnly) {
    for (const root of roots) {
      backupBeforeRewrite(root, libraryJsonPath(root), 'library.json');
    }
  }

  const report: unknown[] = [];
  for (const lib of libs) {
    const slot = readLibrarySlot(lib.wildcardsRoot, lib.id);
    if (!slot) {
      report.push({ library: lib.name, error: 'no slot' });
      continue;
    }
    const triage = triageModels(lib, slot);
    const totals = countsOnly
      ? {
          archiveTotal:
            (slot.archivedCivitaiModels?.length ?? 0) + triage.archiveAdds.length,
          notifyTotal:
            (slot.civitaiWatchlist?.length ?? 0) + triage.watchAdds.length,
        }
      : applyModelTriage(lib, triage);
    report.push({
      library: lib.name,
      scanned: triage.scanned,
      skippedDownloaded: triage.skippedDownloaded,
      skippedMaybe: triage.skippedMaybe,
      skippedOther: triage.skippedOther,
      archivedAdded: triage.archiveAdds.length,
      notifyAdded: triage.watchAdds.length,
      archiveTotal: totals.archiveTotal,
      notifyTotal: totals.notifyTotal,
    });
    console.log(JSON.stringify(report[report.length - 1]));
  }
  if (countsOnly) return;
  for (const root of roots) {
    backupBeforeRewrite(root, libraryJsonPath(root), 'library.json');
  }

  const hfToken = settings.huggingfaceToken?.trim() ?? '';
  for (const lib of libs) {
    const hf = await archiveHuggingFace(lib, hfToken);
    console.log(
      JSON.stringify({
        library: lib.name,
        media: 'hf',
        pages: hf.pages,
        archivedAdded: hf.added,
        archiveTotal: hf.total,
      }),
    );
  }

  const downloadedImages = loadDownloadedMediaIds('downloaded-civitai-images.json');
  const downloadedVideos = loadDownloadedMediaIds('downloaded-civitai-videos.json');
  const apiKey = settings.civitaiApiKey?.trim() ?? '';
  for (const lib of libs) {
    for (const media of ['image', 'video'] as const) {
      const result = await archiveMedia({
        lib,
        media,
        apiKey,
        downloaded: media === 'image' ? downloadedImages : downloadedVideos,
      });
      console.log(
        JSON.stringify({
          library: lib.name,
          media,
          pages: result.pages,
          archivedAdded: result.added,
          capped: result.capped,
          stoppedAtOneMonth: result.stoppedAtOneMonth,
          skippedDownloadedRegistry: (media === 'image'
            ? downloadedImages
            : downloadedVideos
          ).size,
        }),
      );
    }
  }

  for (const root of roots) {
    backupBeforeRewrite(root, libraryJsonPath(root), 'library.json');
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'triage failed';
  console.error(message);
  process.exitCode = 1;
});
