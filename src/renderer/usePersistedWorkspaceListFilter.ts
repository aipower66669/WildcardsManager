import { useEffect, useRef, useState } from 'react';
import { DEFAULT_WORKSPACE_LIST_FILTERS } from '../shared/contracts';
import type {
  WorkspaceListFilterTab,
  WorkspaceListFiltersDto,
} from '../shared/contracts';

const PERSIST_MS = 300;

export function usePersistedWorkspaceListFilter<
  Tab extends WorkspaceListFilterTab,
>(tab: Tab) {
  type Mode = WorkspaceListFiltersDto[Tab]['mode'];
  const [filter, setFilterState] = useState(
    DEFAULT_WORKSPACE_LIST_FILTERS[tab].query,
  );
  const [filterMode, setFilterModeState] = useState<Mode>(
    DEFAULT_WORKSPACE_LIST_FILTERS[tab].mode,
  );
  const [ready, setReady] = useState(false);
  const touched = useRef(false);
  const hydrateOk = useRef(false);

  const setFilter = (query: string) => {
    touched.current = true;
    setFilterState(query);
  };

  const setFilterMode = (mode: Mode) => {
    touched.current = true;
    setFilterModeState(mode);
  };

  useEffect(() => {
    let cancelled = false;
    void window.wcm.ui
      .getSettings()
      .then((settings) => {
        if (cancelled) return;
        hydrateOk.current = true;
        if (touched.current) return;
        const saved = settings.workspaceListFilters?.[tab];
        if (!saved) return;
        setFilterState(saved.query);
        setFilterModeState(saved.mode as Mode);
      })
      .catch(() => {
        // Keep defaults; do not write them over a failed read.
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const latest = useRef({ filter, filterMode });
  latest.current = { filter, filterMode };

  const canPersist = () => hydrateOk.current || touched.current;

  useEffect(() => {
    if (!ready || !canPersist()) return;
    const persist = () => {
      void window.wcm.ui.setWorkspaceListFilter(tab, {
        query: latest.current.filter,
        mode: latest.current.filterMode,
      });
    };
    const handle = window.setTimeout(persist, PERSIST_MS);
    return () => window.clearTimeout(handle);
  }, [ready, tab, filter, filterMode]);

  useEffect(() => {
    if (!ready) return;
    const flush = () => {
      if (!canPersist()) return;
      void window.wcm.ui.setWorkspaceListFilter(tab, {
        query: latest.current.filter,
        mode: latest.current.filterMode,
      });
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [ready, tab]);

  return { filter, setFilter, filterMode, setFilterMode };
}
