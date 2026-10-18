import { describe, expect, it } from 'vitest';
import { parseBenchmarkResultsView } from './benchmarkResultsView.js';

describe('parseBenchmarkResultsView', () => {
  it('keeps a known sort and the name filter', () => {
    expect(
      parseBenchmarkResultsView({
        sort: 'rating-desc',
        nameFilter: 'krea',
      }),
    ).toEqual({ sort: 'rating-desc', nameFilter: 'krea' });
  });

  it('falls back when the saved view is missing or invalid', () => {
    expect(parseBenchmarkResultsView(undefined)).toEqual({
      sort: 'speed-asc',
      nameFilter: '',
    });
    expect(
      parseBenchmarkResultsView({ sort: 'nope', nameFilter: 4 }),
    ).toEqual({ sort: 'speed-asc', nameFilter: '' });
  });
});
