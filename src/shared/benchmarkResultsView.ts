import {
  BENCHMARK_RESULTS_SORTS,
  DEFAULT_BENCHMARK_RESULTS_VIEW,
  type BenchmarkResultsSort,
  type BenchmarkResultsViewDto,
} from './contracts.js';

export const BENCHMARK_RESULTS_FILTER_MAX = 300;

function parseSort(raw: unknown): BenchmarkResultsSort {
  return typeof raw === 'string' &&
    (BENCHMARK_RESULTS_SORTS as readonly string[]).includes(raw)
    ? (raw as BenchmarkResultsSort)
    : DEFAULT_BENCHMARK_RESULTS_VIEW.sort;
}

function parseNameFilter(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.length > BENCHMARK_RESULTS_FILTER_MAX
    ? raw.slice(0, BENCHMARK_RESULTS_FILTER_MAX)
    : raw;
}

/** Missing or invalid prefs fall back to fastest-first and an empty filter. */
export function parseBenchmarkResultsView(
  raw: unknown,
): BenchmarkResultsViewDto {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_BENCHMARK_RESULTS_VIEW };
  }
  const rec = raw as Record<string, unknown>;
  return {
    sort: parseSort(rec.sort),
    nameFilter: parseNameFilter(rec.nameFilter),
  };
}
