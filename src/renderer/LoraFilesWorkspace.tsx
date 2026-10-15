import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Filter,
  FolderOpen,
  Layers,
  RefreshCw,
  Search,
  Tags,
  Trash2,
} from 'lucide-react';
import type {
  IssueDto,
  LoraListFilterMode,
  LoraManagerDetailDto,
  LoraSeriesDatasetPreviewDto,
  ModelFileManagerEntryDto,
} from '../shared/contracts.js';
import { usePersistedWorkspaceListFilter } from './usePersistedWorkspaceListFilter';
import { loraNameHasStackedUnderscores } from '../domain/lora.js';
import {
  groupLoraFilesByTrainingSeries,
  parseLoraTrainingStep,
  type GroupedLoraSeries,
} from '../domain/loraSeries.js';
import { ModelIdentityPanel } from './ModelIdentityPanel';
import { ModelCivitaiPagePane } from './ModelCivitaiPagePane';
import { LoraSeriesValidationPane } from './LoraSeriesValidationPane';
import { WildcardEditor } from './WildcardEditor';
import { PanelSplitter, type PanelSplitterHandlers } from './PanelSplitter';
import {
  ModelFileContextMenu,
  openModelFileContextMenu,
  type ModelFileContextMenuState,
} from './ModelFileContextMenu';
import { LoraDownloadCategoryManagerModal } from './LoraDownloadCategoryManagerModal';
import { LoraInspectModal } from './LoraInspectModal';
import { modalOverlayDismiss } from './modalOverlayDismiss';

function formatLoraRefreshAge(at: number | null, now: number): string {
  if (at == null) return 'never';
  const sec = Math.max(0, Math.floor((now - at) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

function formatStepLabel(digits: string): string {
  const trimmed = digits.replace(/^0+/, '');
  return trimmed.length > 0 ? trimmed : '0';
}

function seriesRowKey(group: GroupedLoraSeries<ModelFileManagerEntryDto>): string {
  return `series:${group.dir}\0${group.seriesBase}\0${group.separator}`;
}

function seriesDisplayLabel(
  group: GroupedLoraSeries<ModelFileManagerEntryDto>,
): string {
  return group.dir ? `${group.dir}/${group.pickName}` : group.pickName;
}

function fileMatchesLoraFilter(
  f: ModelFileManagerEntryDto,
  q: string,
  filterMode: LoraListFilterMode,
): boolean {
  if (
    q &&
    !f.relativePath.toLowerCase().includes(q) &&
    !f.stem.toLowerCase().includes(q)
  ) {
    return false;
  }
  if (filterMode === 'used') return (f.referenceCount ?? 0) > 0;
  if (filterMode === 'unused') return Boolean(f.unused);
  if (filterMode === 'errors') {
    return (
      loraNameHasStackedUnderscores(f.stem) ||
      loraNameHasStackedUnderscores(f.name)
    );
  }
  if (filterMode === 'has-sidecar') {
    return Boolean(f.sidecar.imageRelativePath || f.sidecar.jsonRelativePath);
  }
  if (filterMode === 'has-civitai') return Boolean(f.civitaiModelId);
  if (filterMode === 'unmatched') return !f.civitaiModelId;
  return true;
}

/** Mirror of main-process rule: archive only if no sibling still owns the model. */
function willArchiveCivitaiOnDelete(
  relativePath: string,
  list: ModelFileManagerEntryDto[],
  detail: LoraManagerDetailDto | null,
): boolean {
  const norm = normPath(relativePath);
  const target =
    detail?.file && normPath(detail.file.relativePath) === norm
      ? detail.file
      : (list.find((f) => normPath(f.relativePath) === norm) ?? null);
  if (!target) return true;

  if (detail && normPath(detail.file.relativePath) === norm) {
    const dup = detail.issues.find((i) => i.code === 'duplicate_lora_hash');
    if (
      dup?.relatedPaths?.some((p) =>
        list.some((f) => normPath(f.relativePath) === normPath(p)),
      )
    ) {
      return false;
    }
  }

  const hash = target.autoV2?.trim().toUpperCase() ?? '';
  if (hash) {
    if (
      list.some(
        (f) =>
          normPath(f.relativePath) !== norm &&
          f.autoV2?.trim().toUpperCase() === hash,
      )
    ) {
      return false;
    }
  }

  const modelId = target.civitaiModelId;
  if (typeof modelId === 'number' && Number.isFinite(modelId)) {
    if (
      list.some(
        (f) =>
          normPath(f.relativePath) !== norm && f.civitaiModelId === modelId,
      )
    ) {
      return false;
    }
  }

  return true;
}

type Props = {
  filesWidth: number;
  detailsWidth: number;
  filesSplitter: PanelSplitterHandlers;
  detailsSplitter: PanelSplitterHandlers;
  /** When false, stay mounted but hidden so selection/filters survive tab switches. */
  active?: boolean;
  /** Switch to Wildcard files and open this library path as the graph root. */
  onOpenInWildcardsTab?: (relativePath: string) => void;
  /** Select this LoRA relative path after mount / when set (e.g. from editor). */
  pendingSelectPath?: string | null;
  onPendingSelectConsumed?: () => void;
  /** Open the rename-on-disk modal for this LoRA stem. */
  onRenameLora?: (stem: string) => void;
  /** Bumped after Rebuild so this tab reloads from the just-rescanned index. */
  folderEpoch?: number;
};

export function LoraFilesWorkspace({
  filesWidth,
  detailsWidth,
  filesSplitter,
  detailsSplitter,
  active = true,
  onOpenInWildcardsTab,
  pendingSelectPath,
  onPendingSelectConsumed,
  onRenameLora,
  folderEpoch = 0,
}: Props) {
  const [list, setList] = useState<ModelFileManagerEntryDto[]>([]);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [refreshAgeNow, setRefreshAgeNow] = useState(() => Date.now());
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { filter, setFilter, filterMode, setFilterMode } =
    usePersistedWorkspaceListFilter('loras');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [detail, setDetail] = useState<LoraManagerDetailDto | null>(null);
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [editorText, setEditorText] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);
  const [contextMenu, setContextMenu] =
    useState<ModelFileContextMenuState | null>(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [inspectPath, setInspectPath] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    path: string;
    referenceFiles: number;
    referenceTags: number;
    /** False when another on-disk copy still owns the Civitai model. */
    archiveCivitai: boolean;
  } | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingScrollPath = useRef<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  const selectedListItem = useMemo(
    () => list.find((f) => f.relativePath === selectedPath) ?? null,
    [list, selectedPath],
  );

  const seriesByMemberPath = useMemo(() => {
    const map = new Map<
      string,
      GroupedLoraSeries<ModelFileManagerEntryDto>
    >();
    for (const row of groupLoraFilesByTrainingSeries(list)) {
      if (row.kind !== 'series') continue;
      for (const member of row.group.members) {
        map.set(normPath(member.relativePath), row.group);
      }
    }
    return map;
  }, [list]);

  const activeSeries = useMemo(() => {
    if (!selectedPath) return null;
    return seriesByMemberPath.get(normPath(selectedPath)) ?? null;
  }, [selectedPath, seriesByMemberPath]);

  const [seriesDataset, setSeriesDataset] =
    useState<LoraSeriesDatasetPreviewDto | null>(null);
  const [seriesDatasetBusy, setSeriesDatasetBusy] = useState(false);
  const [seriesDatasetError, setSeriesDatasetError] = useState<string | null>(
    null,
  );

  const activeSeriesKey = activeSeries ? seriesRowKey(activeSeries) : null;

  // Cheap freshness tick: main reuses the cached dataset folder + image lists
  // unless a set-folder mtime changed. Rematch is the only full training-tree search.
  useEffect(() => {
    if (!active || !activeSeries || !activeSeriesKey) {
      if (!activeSeries || !activeSeriesKey) {
        setSeriesDataset(null);
        setSeriesDatasetError(null);
        setSeriesDatasetBusy(false);
      }
      return;
    }
    const { dir, seriesBase, separator } = activeSeries;
    let cancelled = false;
    let isFirst = true;

    const load = (opts?: { rematchFolder?: boolean }) => {
      if (isFirst || opts?.rematchFolder) setSeriesDatasetBusy(true);
      void window.wcm.modelFiles
        .resolveLoraSeriesDataset({
          dir,
          seriesBase,
          separator,
          force: opts?.rematchFolder === true,
        })
        .then((result) => {
          if (cancelled) return;
          setSeriesDataset((prev) => {
            // Keep prior cover data-URL when the file path is unchanged to avoid
            // flicker on the quiet 2s live refresh.
            if (
              prev?.status === 'ok' &&
              result.status === 'ok' &&
              prev.previewAbsolutePath &&
              prev.previewAbsolutePath === result.previewAbsolutePath &&
              prev.previewDataUrl
            ) {
              return { ...result, previewDataUrl: prev.previewDataUrl };
            }
            return result;
          });
          setSeriesDatasetError(null);
          setSeriesDatasetBusy(false);
          isFirst = false;
        })
        .catch((e) => {
          if (cancelled) return;
          setSeriesDatasetError(e instanceof Error ? e.message : String(e));
          setSeriesDatasetBusy(false);
          isFirst = false;
        });
    };

    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    const intervalId = window.setInterval(() => load(), 2000);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.clearInterval(intervalId);
    };
  }, [active, activeSeriesKey]); // eslint-disable-line react-hooks/exhaustive-deps -- key encodes series identity

  const rematchSeriesDatasetFolder = useCallback(() => {
    if (!activeSeries) return;
    const { dir, seriesBase, separator } = activeSeries;
    setSeriesDatasetBusy(true);
    setSeriesDatasetError(null);
    void window.wcm.modelFiles
      .resolveLoraSeriesDataset({
        dir,
        seriesBase,
        separator,
        force: true,
      })
      .then((result) => {
        setSeriesDataset(result);
        setSeriesDatasetBusy(false);
      })
      .catch((e) => {
        setSeriesDataset(null);
        setSeriesDatasetError(e instanceof Error ? e.message : String(e));
        setSeriesDatasetBusy(false);
      });
  }, [activeSeries]);

  const refresh = useCallback(async (opts?: { force?: boolean; quiet?: boolean }) => {
    if (!opts?.quiet) {
      setBusy(true);
      setError(null);
    }
    try {
      const result = await window.wcm.modelFiles.listLoras(
        opts?.force ? { force: true } : undefined,
      );
      setFolder(result.folder);
      setList(result.files);
      if (result.lastRefreshAt !== undefined) {
        setLastRefreshAt(result.lastRefreshAt);
      }
      setSelectedPath((current) => {
        if (
          current &&
          !result.files.some((f) => f.relativePath === current)
        ) {
          setDetail(null);
          return null;
        }
        return current;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setList([]);
      setFolder(null);
    } finally {
      if (!opts?.quiet) setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return window.wcm.modelFiles.onLoraIndexRefreshed((info) => {
      setLastRefreshAt(info.lastRefreshAt);
    });
  }, []);

  useEffect(() => {
    if (!active || lastRefreshAt == null) return;
    const id = window.setInterval(() => setRefreshAgeNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [active, lastRefreshAt]);

  // Stay-mounted tabs keep the last list in memory. Re-read the folder when
  // the user comes back so adds/moves/deletes show up without a manual Refresh.
  const wasActive = useRef(false);
  useEffect(() => {
    if (!active) {
      wasActive.current = false;
      return;
    }
    const becameActive = !wasActive.current;
    wasActive.current = true;
    if (!becameActive) return;
    void refresh({ force: true, quiet: true });
  }, [active, refresh]);

  useEffect(() => {
    if (!folderEpoch) return;
    void refresh();
  }, [folderEpoch, refresh]);

  useEffect(() => {
    if (!pendingSelectPath) return;
    let cancelled = false;
    void (async () => {
      // Rename (and deep-links) need a fresh list before selection, otherwise
      // refresh() would clear the old path and details stay stale.
      await refresh();
      if (cancelled) return;
      setSelectedPath(pendingSelectPath);
      pendingScrollPath.current = pendingSelectPath;
      onPendingSelectConsumed?.();
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingSelectPath, onPendingSelectConsumed, refresh]);

  // Refresh list when populate finishes.
  useEffect(() => {
    return window.wcm.modelFiles.onPopulateProgress((progress) => {
      if (progress.kind !== 'LORA') return;
      if (progress.status === 'done' || progress.status === 'cancelled') {
        void refresh();
      }
    });
  }, [refresh]);

  // Refresh when background hashing finishes (new AutoV2 values on disk).
  useEffect(() => {
    return window.wcm.civitai.onHashWarmProgress((progress) => {
      if (progress.kind !== 'LORA') return;
      if (progress.status === 'done') void refresh();
    });
  }, [refresh]);

  // Refresh when a LoRA download finishes while this tab is open.
  useEffect(() => {
    return window.wcm.civitai.onDownloadProgress((progress) => {
      if (progress.type !== 'LORA') return;
      if (!progress.done || progress.error) return;
      // Don't rebuild the list between queue jobs (sync folder walk freezes UI).
      if ((progress.queuedCount ?? 0) > 0 || progress.activeModelId != null) {
        return;
      }
      void refresh();
    });
  }, [refresh]);

  const loadDetail = useCallback(async (relativePath: string) => {
    setBusy(true);
    setError(null);
    try {
      const d = await window.wcm.modelFiles.getLoraDetail(relativePath);
      setDetail(d);
      setEditorPath(null);
      setEditorText('');
      setEditorDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDetail(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedPath) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedPath);
  }, [selectedPath, loadDetail]);

  const visibleRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const grouped = groupLoraFilesByTrainingSeries(list);
    return grouped.filter((row) => {
      const files =
        row.kind === 'single' ? [row.file] : row.group.members;
      if (
        selectedPath &&
        files.some((f) => f.relativePath === selectedPath)
      ) {
        return true;
      }
      if (filterMode === 'training-series' && row.kind !== 'series') {
        return false;
      }
      // Text search still applies; mode-specific checks use 'all' for series-only.
      return files.some((f) =>
        fileMatchesLoraFilter(
          f,
          q,
          filterMode === 'training-series' ? 'all' : filterMode,
        ),
      );
    });
  }, [list, filter, filterMode, selectedPath]);

  const visibleFileCount = useMemo(
    () =>
      visibleRows.reduce(
        (sum, row) =>
          sum + (row.kind === 'single' ? 1 : row.group.members.length),
        0,
      ),
    [visibleRows],
  );

  const errorFileCount = useMemo(
    () =>
      list.filter(
        (f) =>
          loraNameHasStackedUnderscores(f.stem) ||
          loraNameHasStackedUnderscores(f.name),
      ).length,
    [list],
  );

  useEffect(() => {
    const target = pendingScrollPath.current;
    if (!target || !selectedPath) return;
    if (normPath(selectedPath) !== normPath(target)) return;
    const series = seriesByMemberPath.get(normPath(target));
    const scrollKey = series
      ? seriesRowKey(series)
      : (list.find((f) => normPath(f.relativePath) === normPath(target))
          ?.relativePath ?? target);

    const frame = window.requestAnimationFrame(() => {
      const el =
        rowRefs.current.get(scrollKey) ??
        [...rowRefs.current.entries()].find(
          ([path]) => normPath(path) === normPath(scrollKey),
        )?.[1];
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      pendingScrollPath.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedPath, seriesByMemberPath, list]);

  const openWildcard = useCallback(async (relativePath: string) => {
    try {
      const file = await window.wcm.library.readFile(relativePath);
      setEditorPath(relativePath);
      setEditorText(file.text);
      setEditorDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const scheduleSave = useCallback((relativePath: string, text: string) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void window.wcm.library
        .writeFile(relativePath, text)
        .then(() => setEditorDirty(false))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 2000);
  }, []);

  const allowedEditorPaths = useMemo(() => {
    if (!detail) return new Set<string>();
    return new Set(detail.reverseRefs.map((r) => r.relativePath));
  }, [detail]);

  const runDelete = async (relativePath: string) => {
    if (!relativePath) return;
    setBusy(true);
    setError(null);
    setConfirmDelete(null);
    try {
      const result = await window.wcm.modelFiles.deleteLoras([relativePath]);
      if (result.errors.length > 0) {
        setError(
          result.errors
            .map((e) => `${e.relativePath}: ${e.message}`)
            .join('\n'),
        );
      }
      await refresh();
      if (selectedPath && result.deleted.some((p) => normPath(p) === normPath(selectedPath))) {
        setSelectedPath(null);
        setDetail(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = (
    relativePath: string,
    skipConfirm: boolean,
  ) => {
    if (!relativePath) return;
    if (skipConfirm) {
      void runDelete(relativePath);
      return;
    }
    void (async () => {
      let referenceFiles = 0;
      let referenceTags = 0;
      let detailForTarget: LoraManagerDetailDto | null = null;
      const fromList = list.find(
        (f) => normPath(f.relativePath) === normPath(relativePath),
      );
      referenceFiles = fromList?.referenceCount ?? 0;
      if (
        detail?.file.relativePath &&
        normPath(detail.file.relativePath) === normPath(relativePath)
      ) {
        detailForTarget = detail;
        referenceFiles = detail.reverseRefs.length;
        referenceTags = detail.reverseRefs.reduce(
          (sum, r) => sum + r.refs.length,
          0,
        );
      } else if (referenceFiles > 0) {
        try {
          const d = await window.wcm.modelFiles.getLoraDetail(relativePath);
          detailForTarget = d;
          referenceFiles = d.reverseRefs.length;
          referenceTags = d.reverseRefs.reduce(
            (sum, r) => sum + r.refs.length,
            0,
          );
        } catch {
          // keep list count only
        }
      } else {
        try {
          detailForTarget =
            await window.wcm.modelFiles.getLoraDetail(relativePath);
        } catch {
          detailForTarget = null;
        }
      }
      setConfirmDelete({
        path: relativePath,
        referenceFiles,
        referenceTags,
        archiveCivitai: willArchiveCivitaiOnDelete(
          relativePath,
          list,
          detailForTarget,
        ),
      });
    })();
  };

  const pageUrl =
    detail?.file.civitaiPageUrl ?? selectedListItem?.civitaiPageUrl ?? null;
  const modelId =
    detail?.file.civitaiModelId ?? selectedListItem?.civitaiModelId;
  const modelName =
    detail?.file.civitaiName ??
    selectedListItem?.civitaiName ??
    detail?.file.stem ??
    selectedListItem?.stem;

  return (
    <main
      className={`workspace workspace-model-manager${active ? '' : ' workspace-tab-hidden'}`}
      aria-hidden={!active}
      style={
        {
          '--files-panel-width': `${filesWidth}px`,
          '--details-panel-width': `${detailsWidth}px`,
        } as CSSProperties
      }
    >
      <aside className="sidebar files-sidebar">
        <div className="sidebar-head">
          <strong>LoRA files</strong>
          <div className="head-actions">
            <span
              title={
                visibleRows.length !== visibleFileCount
                  ? `${visibleRows.length} rows · ${visibleFileCount} files`
                  : undefined
              }
            >
              {visibleRows.length}
              {visibleFileCount !== list.length
                ? `/${list.length}`
                : visibleRows.length !== visibleFileCount
                  ? ` · ${visibleFileCount} files`
                  : ''}
            </span>
            <button
              type="button"
              className="ghost-btn icon-only"
              title="LoRA download categories (folder + wildcard)"
              onClick={() => setCategoryManagerOpen(true)}
            >
              <Tags size={15} />
            </button>
            <time
              className="lora-refresh-age"
              dateTime={
                lastRefreshAt ? new Date(lastRefreshAt).toISOString() : undefined
              }
              title={
                lastRefreshAt
                  ? `Last folder scan: ${new Date(lastRefreshAt).toLocaleString()}`
                  : 'LoRA folder has not been scanned yet'
              }
            >
              {formatLoraRefreshAge(lastRefreshAt, refreshAgeNow)}
            </time>
            <button
              type="button"
              className="ghost-btn icon-only"
              title={
                lastRefreshAt
                  ? `Re-read LoRA folder from disk (last scan ${formatLoraRefreshAge(lastRefreshAt, refreshAgeNow)})`
                  : 'Re-read LoRA folder from disk (picks up moves, adds, deletes)'
              }
              onClick={() => void refresh({ force: true })}
              disabled={busy}
            >
              <RefreshCw size={15} className={busy ? 'spin' : ''} />
            </button>
          </div>
        </div>
        {!folder ? (
          <p className="hint pad">
            Configure a LoRA folder in Settings / Library manager.
          </p>
        ) : (
          <>
            <p className="hint pad mono" title={folder}>
              {folder}
            </p>
            <label className="search-box">
              <Search size={14} />
              <input
                type="search"
                placeholder="Filter LoRAs…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <label className="filter-row">
              <Filter size={13} />
              <select
                value={filterMode}
                onChange={(e) =>
                  setFilterMode(e.target.value as LoraListFilterMode)
                }
              >
                <option value="all">All</option>
                <option value="training-series">Training sets</option>
                <option value="used">Referenced in wildcards</option>
                <option value="unused">Unused</option>
                <option value="errors">
                  Files with issues
                  {errorFileCount > 0 ? ` (${errorFileCount})` : ''}
                </option>
                <option value="has-sidecar">Has image/JSON sidecar</option>
                <option value="has-civitai">Matched on Civitai</option>
                <option value="unmatched">Unmatched</option>
              </select>
            </label>
            <ul className="file-list">
              {visibleRows.map((row) => {
                if (row.kind === 'single') {
                  const f = row.file;
                  return (
                    <li key={f.relativePath}>
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) rowRefs.current.set(f.relativePath, el);
                          else rowRefs.current.delete(f.relativePath);
                        }}
                        className={
                          f.relativePath === selectedPath
                            ? 'selected'
                            : undefined
                        }
                        onClick={() => setSelectedPath(f.relativePath)}
                        onContextMenu={(event: ReactMouseEvent) => {
                          setSelectedPath(f.relativePath);
                          setContextMenu(
                            openModelFileContextMenu(f, event, 'LORA'),
                          );
                        }}
                        title={f.relativePath}
                      >
                        <span className="file-list-name">{f.stem}</span>
                        {(f.referenceCount ?? 0) > 0 ||
                        f.unused ||
                        loraNameHasStackedUnderscores(f.stem) ? (
                          <span className="file-list-meta">
                            {loraNameHasStackedUnderscores(f.stem)
                              ? 'invalid name'
                              : (f.referenceCount ?? 0) > 0
                                ? `${f.referenceCount} refs`
                                : 'unused'}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                }

                const { group } = row;
                const key = seriesRowKey(group);
                const label = seriesDisplayLabel(group);
                const selected =
                  activeSeries != null &&
                  seriesRowKey(activeSeries) === key;
                const refTotal = group.members.reduce(
                  (sum, m) => sum + (m.referenceCount ?? 0),
                  0,
                );
                const allUnused = group.members.every((m) => m.unused);
                const hasInvalidName = group.members.some((m) =>
                  loraNameHasStackedUnderscores(m.stem),
                );
                const primary = group.members[0]!;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) rowRefs.current.set(key, el);
                        else rowRefs.current.delete(key);
                      }}
                      className={`lora-series-row${selected ? ' selected' : ''}`}
                      onClick={() => setSelectedPath(primary.relativePath)}
                      onContextMenu={(event: ReactMouseEvent) => {
                        setSelectedPath(primary.relativePath);
                        setContextMenu(
                          openModelFileContextMenu(primary, event, 'LORA'),
                        );
                      }}
                      title={group.members
                        .map((m) => m.relativePath)
                        .join('\n')}
                    >
                      <span className="file-list-name lora-series-row-name">
                        <Layers size={12} className="lora-series-row-icon" />
                        {label}
                      </span>
                      <span className="file-list-meta">
                        {group.members.length} steps
                        {hasInvalidName
                          ? ' · invalid name'
                          : refTotal > 0
                            ? ` · ${refTotal} refs`
                            : allUnused
                              ? ' · unused'
                              : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </aside>

      <PanelSplitter kind="files" {...filesSplitter} />

      <aside className="sidebar details-sidebar model-details-mid">
        {error ? <p className="hint error-text pad">{error}</p> : null}
        {detail ? (
          <>
            <div className="sidebar-head">
              <strong>LoRA details</strong>
              <div className="head-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  title="Read embedded training metadata from the .safetensors header"
                  onClick={() => setInspectPath(detail.file.relativePath)}
                >
                  <Search size={14} /> Inspect
                </button>
              </div>
            </div>
            {activeSeries ? (
              <section className="pad lora-series-detail">
                <div className="lora-series-detail-head">
                  <strong>
                    <Layers size={14} /> Training series
                  </strong>
                  <span className="hint mono" title={activeSeries.displayStem}>
                    {seriesDisplayLabel(activeSeries)}
                  </span>
                </div>
                <div className="lora-series-dataset-meta">
                  {seriesDatasetError ? (
                    <p className="hint error-text">{seriesDatasetError}</p>
                  ) : seriesDataset?.status === 'ok' ? (
                    <p
                      className="hint mono"
                      title={seriesDataset.datasetAbsolutePath}
                    >
                      Dataset: {seriesDataset.datasetRelativePath}
                      {seriesDataset.fromCache ? '' : ' · linked'}
                    </p>
                  ) : seriesDataset?.status === 'no_training_library' ? (
                    <p className="hint">
                      Set a LoRA training library folder in Settings to show the
                      dataset preview.
                    </p>
                  ) : seriesDataset?.status === 'not_found' ? (
                    <p className="hint">
                      No <code>.safetensors</code> for{' '}
                      <code>{activeSeries.seriesBase}</code> found under a
                      training dataset <code>output/</code> folder.
                    </p>
                  ) : seriesDataset?.status === 'no_lora_folder' ? (
                    <p className="hint">
                      Configure a LoRA folder first (needed to cache the dataset
                      link).
                    </p>
                  ) : (
                    <p className="hint">Resolving dataset…</p>
                  )}
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={seriesDatasetBusy || !activeSeries}
                    title="Re-walk the training library to rematch which dataset folder this series uses (validation images refresh automatically)"
                    onClick={() => rematchSeriesDatasetFolder()}
                  >
                    <RefreshCw
                      size={13}
                      className={seriesDatasetBusy ? 'spin' : ''}
                    />{' '}
                    {seriesDatasetBusy ? 'Scanning…' : 'Rematch folder'}
                  </button>
                </div>
                <p className="hint">
                  {activeSeries.members.length} step files — select one for
                  Inspect and wildcard refs.
                </p>
                <ul className="lora-series-members">
                  {activeSeries.members.map((member, index) => {
                    const step =
                      activeSeries.stepDigitsList[index] ??
                      parseLoraTrainingStep(
                        member.stem.replace(/^.*\//, ''),
                      )?.stepDigits ??
                      '';
                    const isActive =
                      selectedPath != null &&
                      normPath(member.relativePath) ===
                        normPath(selectedPath);
                    const refsLabel =
                      (member.referenceCount ?? 0) > 0
                        ? `${member.referenceCount} refs`
                        : member.unused
                          ? 'unused'
                          : '';
                    return (
                      <li key={member.relativePath}>
                        <button
                          type="button"
                          className={
                            isActive
                              ? 'lora-series-member selected'
                              : 'lora-series-member'
                          }
                          onClick={() =>
                            setSelectedPath(member.relativePath)
                          }
                          title={member.relativePath}
                        >
                          <span className="lora-series-member-step">
                            {formatStepLabel(step)}
                          </span>
                          <span className="lora-series-member-name mono">
                            {member.stem.replace(/^.*\//, '')}
                          </span>
                          <span className="lora-series-member-hash mono">
                            {member.autoV2 ?? 'pending'}
                          </span>
                          <span className="lora-series-member-refs">
                            {refsLabel}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {!activeSeries ? (
              <div className="pad">
                <ModelIdentityPanel
                  file={detail.file}
                  showCompanionJson={false}
                  rematchKind="LORA"
                  onCivitaiLinkChanged={() => {
                    void refresh();
                    if (selectedPath) void loadDetail(selectedPath);
                  }}
                />
              </div>
            ) : null}

            {detail.issues.length > 0 ? (
              <section className="pad">
                <strong>Issues</strong>
                <ul className="issue-list">
                  {detail.issues.map((issue: IssueDto, i) => (
                    <li
                      key={`${issue.code}-${i}`}
                      className={`issue-item issue-severity-${issue.severity}${
                        (issue.relatedPaths?.length ?? 0) > 0
                          ? ' issue-item-stack'
                          : ''
                      }`}
                    >
                      <div className="issue-main">
                        <span>{issue.message}</span>
                      </div>
                      {issue.relatedPaths && issue.relatedPaths.length > 0 ? (
                        <ul className="issue-related-paths">
                          {issue.relatedPaths.map((path) => (
                            <li key={path}>
                              <button
                                type="button"
                                className="issue-related-path"
                                title={`Select ${path}`}
                                onClick={() => setSelectedPath(path)}
                              >
                                {path}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="pad">
              <strong>Referencing wildcards</strong>
              {detail.reverseRefs.length === 0 ? (
                <p className="hint">None in this library.</p>
              ) : (
                <ul className="file-list compact">
                  {detail.reverseRefs.map((r) => (
                    <li key={r.relativePath} className="file-list-row">
                      <button
                        type="button"
                        className={
                          editorPath === r.relativePath ? 'active' : undefined
                        }
                        onClick={() => void openWildcard(r.relativePath)}
                        title="Edit here"
                      >
                        <span className="file-list-name">{r.key}</span>
                        <span className="file-list-meta">
                          {r.refs.length} tag
                          {r.refs.length === 1 ? '' : 's'}
                        </span>
                      </button>
                      {onOpenInWildcardsTab ? (
                        <button
                          type="button"
                          className="ghost-btn icon-only"
                          title="Open in Wildcard files tab"
                          aria-label={`Open ${r.key} in Wildcard files`}
                          onClick={() => onOpenInWildcardsTab(r.relativePath)}
                        >
                          <FolderOpen size={14} />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {editorPath && allowedEditorPaths.has(editorPath) ? (
              <section className="lora-editor-section">
                <div className="sidebar-head">
                  <strong>Edit · {editorPath}</strong>
                  {editorDirty ? <span className="hint">Saving…</span> : null}
                </div>
                <WildcardEditor
                  value={editorText}
                  fileExt={
                    editorPath.match(/\.(ya?ml|json|txt)$/i)?.[0]?.toLowerCase()
                  }
                  onChange={(text) => {
                    setEditorText(text);
                    setEditorDirty(true);
                    scheduleSave(editorPath, text);
                  }}
                />
              </section>
            ) : activeSeries ? (
              <section className="lora-series-cover-section pad">
                <strong>Dataset cover</strong>
                {seriesDataset?.previewDataUrl ? (
                  <div className="lora-series-cover-frame">
                    <img
                      src={seriesDataset.previewDataUrl}
                      alt=""
                      title={
                        seriesDataset.datasetRelativePath
                          ? `Dataset: ${seriesDataset.datasetRelativePath}`
                          : undefined
                      }
                    />
                  </div>
                ) : (
                  <p className="hint">
                    {seriesDatasetBusy
                      ? 'Looking up dataset cover…'
                      : seriesDataset?.status === 'ok'
                        ? 'No cover image in this dataset.'
                        : seriesDataset?.status === 'no_training_library'
                          ? 'Set a LoRA training library folder in Settings.'
                          : seriesDataset?.status === 'not_found'
                            ? `No training .safetensors for ${activeSeries.seriesBase} found under a dataset output/ folder.`
                            : 'Dataset cover will appear here.'}
                  </p>
                )}
              </section>
            ) : (
              <p className="hint pad">
                Select a referencing wildcard to edit it (only files that tag
                this LoRA).
              </p>
            )}
          </>
        ) : (
          <div className="empty">Select a LoRA file.</div>
        )}
      </aside>

      <PanelSplitter kind="details" {...detailsSplitter} />

      {activeSeries ? (
        <LoraSeriesValidationPane
          title={
            seriesDataset?.datasetRelativePath
              ? `Validation · ${seriesDataset.datasetRelativePath}`
              : `Validation · ${seriesDisplayLabel(activeSeries)}`
          }
          busy={seriesDatasetBusy}
          validationSets={seriesDataset?.validationSets ?? []}
          emptyHint={
            seriesDataset?.status === 'ok'
              ? 'No output/ validation-set folders found for this dataset.'
              : seriesDataset?.status === 'no_training_library'
                ? 'Set a LoRA training library folder in Settings.'
                : seriesDataset?.status === 'not_found'
                  ? `No training .safetensors for ${activeSeries.seriesBase} found under a dataset output/ folder.`
                  : seriesDataset?.status === 'no_lora_folder'
                    ? 'Configure a LoRA folder first.'
                    : 'Validation set images will appear here.'
          }
        />
      ) : (
        <ModelCivitaiPagePane
          pageUrl={pageUrl}
          modelId={modelId}
          modelName={modelName}
        />
      )}

      {contextMenu ? (
        <ModelFileContextMenu
          menu={contextMenu}
          kind="LORA"
          onClose={() => setContextMenu(null)}
          onSelect={setSelectedPath}
          onRename={onRenameLora}
          onError={(message) => setError(message)}
          onDeleteLora={(target, skipConfirm) =>
            requestDelete(target.relativePath, skipConfirm)
          }
        />
      ) : null}

      {confirmDelete ? (
        <div
          className="modal-overlay"
          {...modalOverlayDismiss(() => setConfirmDelete(null))}
        >
          <div
            className="modal"
            role="dialog"
            aria-label="Confirm delete LoRA"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <h2>
                <Trash2 size={17} /> Delete LoRA?
              </h2>
            </header>
            <div className="modal-body">
              <p>
                {confirmDelete.archiveCivitai
                  ? 'Permanently delete this LoRA from disk and archive any linked Civitai catalog entry.'
                  : 'Permanently delete this LoRA from disk. A duplicate copy remains, so the linked Civitai catalog entry will not be archived.'}
              </p>
              <p className="mono">{confirmDelete.path}</p>
              {confirmDelete.referenceFiles > 0 ? (
                <p className="warn-row">
                  {confirmDelete.referenceFiles} wildcard file
                  {confirmDelete.referenceFiles === 1 ? '' : 's'}
                  {confirmDelete.referenceTags > 0
                    ? ` (${confirmDelete.referenceTags} <lora:…> tag${
                        confirmDelete.referenceTags === 1 ? '' : 's'
                      })`
                    : ''}{' '}
                  reference this LoRA; those references will be removed from
                  wildcards.
                </p>
              ) : (
                <p className="hint">No wildcard references found.</p>
              )}
            </div>
            <footer className="modal-foot">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => void runDelete(confirmDelete.path)}
              >
                <Trash2 size={15} /> {busy ? 'Deleting…' : 'Delete'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {categoryManagerOpen ? (
        <LoraDownloadCategoryManagerModal
          onClose={() => setCategoryManagerOpen(false)}
        />
      ) : null}

      {inspectPath ? (
        <LoraInspectModal
          relativePath={inspectPath}
          onClose={() => setInspectPath(null)}
        />
      ) : null}
    </main>
  );
}
