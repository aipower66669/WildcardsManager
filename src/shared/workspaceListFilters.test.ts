import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE_LIST_FILTERS } from './contracts.js';
import {
  WORKSPACE_LIST_FILTER_QUERY_MAX,
  isWorkspaceListFilterTab,
  normalizeWorkspaceListFilter,
  parseWorkspaceListFilters,
} from './workspaceListFilters.js';

describe('parseWorkspaceListFilters', () => {
  it('returns defaults for missing or invalid input', () => {
    expect(parseWorkspaceListFilters(undefined)).toEqual(
      DEFAULT_WORKSPACE_LIST_FILTERS,
    );
    expect(parseWorkspaceListFilters(null)).toEqual(
      DEFAULT_WORKSPACE_LIST_FILTERS,
    );
    expect(parseWorkspaceListFilters('nope')).toEqual(
      DEFAULT_WORKSPACE_LIST_FILTERS,
    );
  });

  it('keeps known modes and query text', () => {
    expect(
      parseWorkspaceListFilters({
        wildcards: { query: 'clothes', mode: 'leaves' },
        loras: { query: 'xl', mode: 'errors' },
        checkpoints: { query: 'pony', mode: 'unrated' },
      }),
    ).toEqual({
      wildcards: { query: 'clothes', mode: 'leaves' },
      loras: { query: 'xl', mode: 'errors' },
      checkpoints: { query: 'pony', mode: 'unrated' },
    });
  });

  it('rejects unknown modes and truncates long queries', () => {
    const long = 'x'.repeat(WORKSPACE_LIST_FILTER_QUERY_MAX + 40);
    const parsed = parseWorkspaceListFilters({
      wildcards: { query: long, mode: 'not-a-mode' },
      loras: { query: 12, mode: 'training-series' },
      checkpoints: { mode: 'rating-gte-4' },
    });
    expect(parsed.wildcards.mode).toBe('all');
    expect(parsed.wildcards.query).toHaveLength(WORKSPACE_LIST_FILTER_QUERY_MAX);
    expect(parsed.loras).toEqual({ query: '', mode: 'training-series' });
    expect(parsed.checkpoints).toEqual({ query: '', mode: 'rating-gte-4' });
  });
});

describe('normalizeWorkspaceListFilter', () => {
  it('parses one tab without touching others', () => {
    expect(
      normalizeWorkspaceListFilter('loras', {
        query: '  style',
        mode: 'has-civitai',
      }),
    ).toEqual({ query: '  style', mode: 'has-civitai' });
  });
});

describe('isWorkspaceListFilterTab', () => {
  it('accepts the three list tabs only', () => {
    expect(isWorkspaceListFilterTab('wildcards')).toBe(true);
    expect(isWorkspaceListFilterTab('search')).toBe(false);
    expect(isWorkspaceListFilterTab(1)).toBe(false);
  });
});
