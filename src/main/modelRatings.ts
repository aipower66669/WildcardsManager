import {
  absolutePathKey,
  loadModelsStore,
  loadModelsStoreForPath,
  resolveModelRootForPath,
  saveModelsStore,
} from './modelRootStore.js';
import { normalizeAutoV2 } from '../domain/modelHash.js';

/** Sentinel: never rated. Rated values are 0.5 … 5 in half-star steps. */
export const UNRATED = -1;

/** Clamp to −1 or 0.5…5 in half-star steps. */
export function normalizeModelRating(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return UNRATED;
  if (raw < 0) return UNRATED;
  const stepped = Math.round(raw * 2) / 2;
  if (stepped < 0.5) return UNRATED;
  if (stepped > 5) return 5;
  return stepped;
}

export function getModelRating(
  absolutePath: string,
  autoV2?: string | null,
): number {
  const ctx = loadModelsStoreForPath(absolutePath);
  if (!ctx) return UNRATED;
  const hash = normalizeAutoV2(autoV2 ?? undefined);
  if (hash && ctx.store.ratings.byAutoV2[hash] !== undefined) {
    return normalizeModelRating(ctx.store.ratings.byAutoV2[hash]);
  }
  const byPath = ctx.store.ratings.byPath[ctx.pathKey];
  if (byPath !== undefined) return normalizeModelRating(byPath);
  return UNRATED;
}

export function setModelRating(opts: {
  absolutePath: string;
  autoV2?: string | null;
  rating: number;
}): number {
  const rating = normalizeModelRating(opts.rating);
  const ctx = loadModelsStoreForPath(opts.absolutePath);
  if (!ctx) return rating;
  const { root, store, pathKey } = ctx;
  if (rating === UNRATED) {
    delete store.ratings.byPath[pathKey];
    const hash = normalizeAutoV2(opts.autoV2 ?? undefined);
    if (hash) delete store.ratings.byAutoV2[hash];
  } else {
    store.ratings.byPath[pathKey] = rating;
    const hash = normalizeAutoV2(opts.autoV2 ?? undefined);
    if (hash) store.ratings.byAutoV2[hash] = rating;
  }
  saveModelsStore(root, store);
  return rating;
}

export function clearModelRating(opts: {
  absolutePath: string;
  autoV2?: string | null;
}): void {
  setModelRating({ ...opts, rating: UNRATED });
}

/** @internal test/migration helper */
export function _ratingStoreDebug(absolutePath: string) {
  return {
    root: resolveModelRootForPath(absolutePath),
    absKey: absolutePathKey(absolutePath),
    store: loadModelsStoreForPath(absolutePath)?.store,
  };
}

export { loadModelsStore };
