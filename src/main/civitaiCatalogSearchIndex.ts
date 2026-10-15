import fs from 'node:fs';
import path from 'node:path';
import {
  CATALOG_PAGE_SIZE,
  chunkModelIds,
} from '../domain/civitaiCatalogLayout.js';
import type { CachedCivitaiModel } from './civitaiCatalogCache.js';

export type CatalogSearchHitWindow = {
  /** Matches in catalog order, each with its hay-array index. */
  matches: Array<{ id: number; hayIndex: number }>;
  /**
   * Resume cursor into the hay array. Pass as `fromIndex` on the next call.
   * Equals `lastMatch.hayIndex + 1` when the window is full, else end of scan.
   */
  nextIndex: number;
  hasMore: boolean;
};

type MemSearchIndex = {
  /** Model ids in catalog slice order (newest first). */
  ids: number[];
  /** Lowercased haystacks aligned with ids. */
  hays: string[];
};

const memBySlice = new Map<string, MemSearchIndex>();
const buildInflight = new Map<string, Promise<MemSearchIndex>>();

export function catalogSearchHay(model: {
  name?: string;
  creator?: string;
  tags?: string[];
  fileName?: string;
  baseModel?: string;
}): string {
  const parts = [
    model.name ?? '',
    model.creator ?? '',
    model.fileName ?? '',
    model.baseModel ?? '',
    ...(Array.isArray(model.tags) ? model.tags : []),
  ];
  return parts.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

function hayChunkName(chunkIndex: number): string {
  return `hay-${String(Math.max(0, Math.floor(chunkIndex))).padStart(4, '0')}.json`;
}

function atomicWrite(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, data, 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.renameSync(temp, file);
  }
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Drop in-memory search data for a slice (after structural id changes). */
export function invalidateCatalogSearchIndex(sliceKey: string): void {
  memBySlice.delete(sliceKey);
  buildInflight.delete(sliceKey);
}

/**
 * Write haystacks aligned with id chunks under the slice directory.
 * `hays` must be parallel to `ids` (same length / order).
 */
export function writeCatalogSearchHays(
  sliceDir: string,
  ids: number[],
  hays: string[],
): void {
  if (ids.length !== hays.length) {
    throw new Error('Search hay length must match id list');
  }
  const idChunks = chunkModelIds(ids);
  for (let i = 0; i < idChunks.length; i += 1) {
    const start = i * CATALOG_PAGE_SIZE;
    const sliceHays = hays.slice(start, start + idChunks[i]!.length);
    atomicWrite(
      path.join(sliceDir, hayChunkName(i)),
      `${JSON.stringify(sliceHays)}\n`,
    );
  }
  for (let i = idChunks.length; i < idChunks.length + 8; i += 1) {
    const file = path.join(sliceDir, hayChunkName(i));
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // ignore
    }
  }
}

/** Append hays for newly appended ids (fill sync). */
export function appendCatalogSearchHays(
  sliceDir: string,
  idCountBeforeAppend: number,
  newHays: string[],
): void {
  if (newHays.length === 0) return;
  let start = idCountBeforeAppend;
  let hayOffset = 0;
  while (hayOffset < newHays.length) {
    const chunkIndex = Math.floor(start / CATALOG_PAGE_SIZE);
    const inChunk = start % CATALOG_PAGE_SIZE;
    const file = path.join(sliceDir, hayChunkName(chunkIndex));
    const existing = readJsonFile<string[]>(file);
    const chunk = Array.isArray(existing) ? [...existing] : [];
    while (chunk.length < inChunk) chunk.push('');
    const room = CATALOG_PAGE_SIZE - chunk.length;
    const take = Math.min(room, newHays.length - hayOffset);
    chunk.push(...newHays.slice(hayOffset, hayOffset + take));
    atomicWrite(file, `${JSON.stringify(chunk)}\n`);
    hayOffset += take;
    start += take;
  }
}

function loadMemIndexFromDisk(
  sliceDir: string,
  ids: number[],
  idChunkCount: number,
): MemSearchIndex | null {
  if (ids.length === 0) return { ids: [], hays: [] };
  const hays: string[] = [];
  for (let c = 0; c < idChunkCount; c += 1) {
    const file = path.join(sliceDir, hayChunkName(c));
    const chunk = readJsonFile<string[]>(file);
    if (!Array.isArray(chunk)) return null;
    hays.push(...chunk.map((h) => (typeof h === 'string' ? h : '')));
  }
  if (hays.length !== ids.length) return null;
  return { ids: [...ids], hays };
}

/**
 * Ensure an in-memory search index for the slice. Builds from card pages when
 * hay files are missing (one-time / after upgrade).
 */
export async function ensureCatalogSearchIndex(opts: {
  sliceKey: string;
  sliceDir: string;
  ids: number[];
  idChunkCount: number;
  loadModel: (id: number) => CachedCivitaiModel | null;
}): Promise<MemSearchIndex> {
  const cached = memBySlice.get(opts.sliceKey);
  if (cached && cached.ids.length === opts.ids.length) return cached;

  const inflight = buildInflight.get(opts.sliceKey);
  if (inflight) return inflight;

  const job = (async () => {
    let mem = loadMemIndexFromDisk(
      opts.sliceDir,
      opts.ids,
      opts.idChunkCount,
    );
    if (!mem) {
      const hays: string[] = [];
      for (let i = 0; i < opts.ids.length; i += 1) {
        const model = opts.loadModel(opts.ids[i]!);
        hays.push(model ? catalogSearchHay(model) : '');
        if (i > 0 && i % 2000 === 0) {
          await new Promise<void>((r) => setImmediate(r));
        }
      }
      writeCatalogSearchHays(opts.sliceDir, opts.ids, hays);
      mem = { ids: [...opts.ids], hays };
    }
    memBySlice.set(opts.sliceKey, mem);
    buildInflight.delete(opts.sliceKey);
    return mem;
  })();

  buildInflight.set(opts.sliceKey, job);
  return job;
}

/**
 * Fast local search: all whitespace-separated tokens must appear in the hay
 * (order-independent). Scans the compact in-memory index — no card JSON I/O.
 *
 * `fromIndex` is a position in the hay/id arrays (slice order). Each call
 * resumes from there so pagination stays O(remaining).
 */
export function searchCatalogIndex(
  index: MemSearchIndex,
  query: string,
  fromIndex: number,
  limit: number,
): CatalogSearchHitWindow {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const start = Math.max(0, Math.min(index.ids.length, Math.floor(fromIndex)));
  const take = Math.max(1, Math.floor(limit));
  const matches: Array<{ id: number; hayIndex: number }> = [];

  if (tokens.length === 0) {
    const end = Math.min(index.ids.length, start + take);
    for (let i = start; i < end; i += 1) {
      matches.push({ id: index.ids[i]!, hayIndex: i });
    }
    return {
      matches,
      nextIndex: end,
      hasMore: end < index.ids.length,
    };
  }

  for (let i = start; i < index.hays.length; i += 1) {
    const hay = index.hays[i]!;
    let ok = true;
    for (const token of tokens) {
      if (!hay.includes(token)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    matches.push({ id: index.ids[i]!, hayIndex: i });
    if (matches.length >= take) {
      return {
        matches,
        nextIndex: i + 1,
        hasMore: i + 1 < index.hays.length,
      };
    }
  }

  return {
    matches,
    nextIndex: index.hays.length,
    hasMore: false,
  };
}

/** Append newly filled ids into the in-memory index (keep search hot during sync). */
export function appendCatalogSearchMem(
  sliceKey: string,
  ids: number[],
  hays: string[],
): void {
  if (ids.length === 0) return;
  if (ids.length !== hays.length) return;
  const mem = memBySlice.get(sliceKey);
  if (!mem) return;
  mem.ids.push(...ids);
  mem.hays.push(...hays);
}

export function clearAllCatalogSearchMem(): void {
  memBySlice.clear();
  buildInflight.clear();
}
