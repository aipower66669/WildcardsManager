import {
  CHECKPOINT_LIST_FILTER_MODES,
  DEFAULT_WORKSPACE_LIST_FILTERS,
  LORA_LIST_FILTER_MODES,
  WILDCARD_LIST_FILTER_MODES,
  type WorkspaceListFilterDto,
  type WorkspaceListFilterTab,
  type WorkspaceListFiltersDto,
} from './contracts.js';

export const WORKSPACE_LIST_FILTER_QUERY_MAX = 300;

const TABS: readonly WorkspaceListFilterTab[] = [
  'wildcards',
  'loras',
  'checkpoints',
];

function parseQuery(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.length > WORKSPACE_LIST_FILTER_QUERY_MAX
    ? raw.slice(0, WORKSPACE_LIST_FILTER_QUERY_MAX)
    : raw;
}

function parseMode<Mode extends string>(
  raw: unknown,
  allowed: readonly Mode[],
): Mode {
  return typeof raw === 'string' &&
    (allowed as readonly string[]).includes(raw)
    ? (raw as Mode)
    : (allowed[0] as Mode);
}

function parseOne<Mode extends string>(
  raw: unknown,
  allowed: readonly Mode[],
): WorkspaceListFilterDto<Mode> {
  const rec =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    query: parseQuery(rec.query),
    mode: parseMode(rec.mode, allowed),
  };
}

export function isWorkspaceListFilterTab(
  value: unknown,
): value is WorkspaceListFilterTab {
  return (
    typeof value === 'string' &&
    (TABS as readonly string[]).includes(value)
  );
}

export function parseWorkspaceListFilters(
  raw: unknown,
): WorkspaceListFiltersDto {
  const rec =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    wildcards: parseOne(rec.wildcards, WILDCARD_LIST_FILTER_MODES),
    loras: parseOne(rec.loras, LORA_LIST_FILTER_MODES),
    checkpoints: parseOne(rec.checkpoints, CHECKPOINT_LIST_FILTER_MODES),
  };
}

export function normalizeWorkspaceListFilter(
  tab: WorkspaceListFilterTab,
  raw: unknown,
): WorkspaceListFiltersDto[typeof tab] {
  if (tab === 'wildcards') {
    return parseOne(raw, WILDCARD_LIST_FILTER_MODES);
  }
  if (tab === 'loras') {
    return parseOne(raw, LORA_LIST_FILTER_MODES);
  }
  return parseOne(raw, CHECKPOINT_LIST_FILTER_MODES);
}

export function defaultWorkspaceListFilters(): WorkspaceListFiltersDto {
  return {
    wildcards: { ...DEFAULT_WORKSPACE_LIST_FILTERS.wildcards },
    loras: { ...DEFAULT_WORKSPACE_LIST_FILTERS.loras },
    checkpoints: { ...DEFAULT_WORKSPACE_LIST_FILTERS.checkpoints },
  };
}
