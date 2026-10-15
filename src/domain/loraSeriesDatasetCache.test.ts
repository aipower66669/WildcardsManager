import { describe, expect, it } from 'vitest';
import {
  cachedSeriesDatasetLink,
  seriesDatasetHitEntry,
  seriesDatasetNotFoundEntry,
} from './loraSeriesDatasetCache.js';

describe('cachedSeriesDatasetLink', () => {
  it('is a miss when nothing is stored', () => {
    expect(cachedSeriesDatasetLink(undefined)).toEqual({ kind: 'miss' });
    expect(cachedSeriesDatasetLink({})).toEqual({ kind: 'miss' });
  });

  it('returns the dataset folder without searching again', () => {
    expect(cachedSeriesDatasetLink(seriesDatasetHitEntry('Girl/Akira'))).toEqual({
      kind: 'hit',
      relativePath: 'Girl/Akira',
    });
  });

  it('remembers a failed search so the training tree is not walked again', () => {
    expect(cachedSeriesDatasetLink(seriesDatasetNotFoundEntry())).toEqual({
      kind: 'not_found',
    });
  });
});
