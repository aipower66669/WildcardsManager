import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { ExternalLink, Filter, RefreshCw, Search, Trash2 } from 'lucide-react';
import type {
  CheckpointListFilterMode,
  ModelFileManagerEntryDto,
} from '../shared/contracts.js';
import { usePersistedWorkspaceListFilter } from './usePersistedWorkspaceListFilter';
import { parseHuggingFaceModelPageUrl } from '../domain/huggingfaceSearch.js';
import { isUnrated } from '../domain/modelRating.js';
import { ModelIdentityPanel } from './ModelIdentityPanel';
import { ModelCivitaiPagePane } from './ModelCivitaiPagePane';
import { CheckpointBenchmarkPane } from './CheckpointBenchmarkPane';
import { PanelSplitter, type PanelSplitterHandlers } from './PanelSplitter';
import {
  ModelFileContextMenu,
  openModelFileContextMenu,
  type ModelFileContextMenuState,
} from './ModelFileContextMenu';

type Props = {
  filesWidth: number;
  detailsWidth: number;
  filesSplitter: PanelSplitterHandlers;
  detailsSplitter: PanelSplitterHandlers;
  /** When false, stay mounted but hidden so selection/filters survive tab switches. */
  active?: boolean;
  /** Select this checkpoint relative path after mount / when set. */
  pendingSelectPath?: string | null;
  onPendingSelectConsumed?: () => void;
  /** Bumped after Rebuild so this tab reloads from the just-rescanned index. */
  folderEpoch?: number;
};

function matchesRatingFilter(
  rating: number,
  filterMode: CheckpointListFilterMode,
): boolean {
  if (filterMode === 'unrated') return isUnrated(rating);
  if (filterMode === 'rating-lte-1') return !isUnrated(rating) && rating <= 1;
  if (filterMode === 'rating-lte-2') return !isUnrated(rating) && rating <= 2;
  if (filterMode === 'rating-lte-3') return !isUnrated(rating) && rating <= 3;
  if (filterMode === 'rating-gte-4') return !isUnrated(rating) && rating >= 4;
  return true;
}

export function CheckpointFilesWorkspace({
  filesWidth,
  detailsWidth,
  filesSplitter,
  detailsSplitter,
  active = true,
  pendingSelectPath,
  onPendingSelectConsumed,
  folderEpoch = 0,
}: Props) {
  const [list, setList] = useState<ModelFileManagerEntryDto[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { filter, setFilter, filterMode, setFilterMode } =
    usePersistedWorkspaceListFilter('checkpoints');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [file, setFile] = useState<ModelFileManagerEntryDto | null>(null);
  const [contextMenu, setContextMenu] =
    useState<ModelFileContextMenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    path: string;
    hasMasters: boolean;
  } | null>(null);
  /** Right pane: Benchmark samples vs Civitai website. */
  const [rightTab, setRightTab] = useState<'benchmark' | 'website'>(
    'website',
  );

  const selectedListItem = useMemo(
    () => list.find((f) => f.relativePath === selectedPath) ?? null,
    [list, selectedPath],
  );

  const setCheckpointInUse = useCallback(
    async (entry: ModelFileManagerEntryDto, enabled: boolean) => {
      setError(null);
      try {
        const next = await window.wcm.modelFiles.setCheckpointEnabled({
          absolutePath: entry.absolutePath,
          enabled,
        });
        setList((prev) =>
          prev.map((row) =>
            row.relativePath === entry.relativePath
              ? { ...row, enabled: next }
              : row,
          ),
        );
        setFile((prev) =>
          prev && prev.relativePath === entry.relativePath
            ? { ...prev, enabled: next }
            : prev,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const refresh = useCallback(async (opts?: { force?: boolean; quiet?: boolean }) => {
    if (!opts?.quiet) {
      setBusy(true);
      setError(null);
    }
    try {
      const result = await window.wcm.modelFiles.listCheckpoints(
        opts?.force ? { force: true } : undefined,
      );
      setFolder(result.folder);
      setList(result.files);
      setSelectedPath((current) => {
        if (
          current &&
          !result.files.some((f) => f.relativePath === current)
        ) {
          setFile(null);
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
    setSelectedPath(pendingSelectPath);
    onPendingSelectConsumed?.();
  }, [pendingSelectPath, onPendingSelectConsumed]);

  useEffect(() => {
    return window.wcm.modelFiles.onPopulateProgress((progress) => {
      if (progress.kind !== 'Checkpoint') return;
      if (progress.status === 'done' || progress.status === 'cancelled') {
        void refresh();
      }
    });
  }, [refresh]);

  useEffect(() => {
    return window.wcm.civitai.onHashWarmProgress((progress) => {
      if (progress.kind !== 'Checkpoint') return;
      if (progress.status === 'done') void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    return window.wcm.civitai.onDownloadProgress((progress) => {
      if (progress.type !== 'Checkpoint') return;
      if (!progress.done || progress.error) return;
      if ((progress.queuedCount ?? 0) > 0 || progress.activeModelId != null) {
        return;
      }
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    if (!selectedPath) {
      setFile(null);
      setRightTab('website');
      return;
    }
    let cancelled = false;
    setBusy(true);
    void window.wcm.modelFiles
      .getCheckpointDetail(selectedPath)
      .then((d) => {
        if (cancelled) return;
        setFile(d.file);
        // Prefer Benchmark gist when samples exist; otherwise Website.
        setRightTab(
          d.file.masterImageAbsolutePath ? 'benchmark' : 'website',
        );
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setFile(null);
          setRightTab('website');
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  const benchmarkImagePaths = useMemo(() => {
    if (!file?.masterImageAbsolutePath) return [];
    return [
      file.masterImageAbsolutePath,
      ...(file.masterGenImageAbsolutePaths ?? []),
    ];
  }, [file?.masterImageAbsolutePath, file?.masterGenImageAbsolutePaths]);

  const hasBenchmarkSamples = benchmarkImagePaths.length > 0;

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return list.filter((f) => {
      if (selectedPath && f.relativePath === selectedPath) return true;
      if (
        q &&
        !f.relativePath.toLowerCase().includes(q) &&
        !f.stem.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (filterMode === 'has-sidecar') {
        return Boolean(
          f.sidecar.imageRelativePath || f.sidecar.jsonRelativePath,
        );
      }
      if (filterMode === 'has-civitai') return Boolean(f.civitaiModelId);
      if (filterMode === 'unmatched') return !f.civitaiModelId;
      if (filterMode === 'missing-hash') return !f.autoV2;
      if (!matchesRatingFilter(f.rating ?? -1, filterMode)) return false;
      return true;
    });
  }, [list, filter, filterMode, selectedPath]);

  const pageUrl = file?.civitaiPageUrl ?? selectedListItem?.civitaiPageUrl ?? null;
  const modelId = file?.civitaiModelId ?? selectedListItem?.civitaiModelId;
  const modelName =
    file?.civitaiName ??
    selectedListItem?.civitaiName ??
    file?.stem ??
    selectedListItem?.stem;

  const runDelete = async (relativePath: string) => {
    if (!relativePath) return;
    setBusy(true);
    setError(null);
    setConfirmDelete(null);
    try {
      const result = await window.wcm.modelFiles.deleteCheckpoints([
        relativePath,
      ]);
      if (result.errors.length > 0) {
        setError(
          result.errors
            .map((e) => `${e.relativePath}: ${e.message}`)
            .join('\n'),
        );
      }
      await refresh();
      if (selectedPath && result.deleted.includes(selectedPath)) {
        const remaining = visible.filter(
          (f) =>
            !result.deleted.includes(f.relativePath) &&
            f.relativePath !== selectedPath,
        );
        setSelectedPath(remaining[0]?.relativePath ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = (relativePath: string, skipConfirm: boolean) => {
    if (!relativePath) return;
    if (skipConfirm) {
      void runDelete(relativePath);
      return;
    }
    void (async () => {
      let hasMasters = Boolean(
        file?.relativePath === relativePath && file.masterImageAbsolutePath,
      );
      if (!hasMasters) {
        const entry =
          list.find((f) => f.relativePath === relativePath) ??
          (file?.relativePath === relativePath ? file : null);
        if (entry) {
          try {
            const stem =
              entry.stem.replaceAll('\\', '/').split('/').pop() ||
              entry.name.replace(/\.[^.]+$/, '');
            const masters = await window.wcm.modelFiles.resolveMasterImages({
              absolutePath: entry.absolutePath,
              stem,
              autoV2: entry.autoV2 ?? null,
              force: true,
            });
            hasMasters = Boolean(masters?.masterAbsolutePath);
          } catch {
            // ignore ? treat as no masters for dialog copy
          }
        }
      }
      setConfirmDelete({ path: relativePath, hasMasters });
    })();
  };

  const handleRatingChanged = (relativePath: string, rating: number) => {
    setList((prev) =>
      prev.map((f) =>
        f.relativePath === relativePath ? { ...f, rating } : f,
      ),
    );
    setFile((prev) =>
      prev && prev.relativePath === relativePath ? { ...prev, rating } : prev,
    );

    if (filterMode !== 'unrated') return;

    const idx = visible.findIndex((f) => f.relativePath === relativePath);
    const nextVisible = visible.filter((f) => f.relativePath !== relativePath);
    const next =
      nextVisible[Math.min(Math.max(idx, 0), nextVisible.length - 1)] ?? null;
    setSelectedPath(next?.relativePath ?? null);
  };

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
          <strong>Checkpoint files</strong>
          <div className="head-actions">
            <span>
              {visible.length}
              {visible.length !== list.length ? `/${list.length}` : ''}
            </span>
            <button
              type="button"
              className="ghost-btn icon-only"
              title="Re-read checkpoint folder from disk (picks up moves, adds, deletes)"
              onClick={() => void refresh({ force: true })}
              disabled={busy}
            >
              <RefreshCw size={15} className={busy ? 'spin' : ''} />
            </button>
          </div>
        </div>
        {!folder ? (
          <p className="hint pad">
            Configure a checkpoint folder in Settings / Library manager.
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
                placeholder="Filter checkpoints?"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <label className="filter-row">
              <Filter size={13} />
              <select
                value={filterMode}
                onChange={(e) =>
                  setFilterMode(e.target.value as CheckpointListFilterMode)
                }
              >
                <option value="all">All</option>
                <option value="unrated">Unrated</option>
                <option value="rating-lte-1">Rating ? 1</option>
                <option value="rating-lte-2">Rating ? 2</option>
                <option value="rating-lte-3">Rating ? 3</option>
                <option value="rating-gte-4">Rating ? 4</option>
                <option value="has-sidecar">Has image/JSON sidecar</option>
                <option value="has-civitai">Matched on Civitai</option>
                <option value="unmatched">Unmatched</option>
                <option value="missing-hash">Missing AutoV2 hash</option>
              </select>
            </label>
            <ul className="file-list file-list-dense">
              {visible.map((f) => (
                <li key={f.relativePath} className="file-list-row">
                  <label
                    className="file-list-use"
                    title="Use this checkpoint in the current library. Untick to keep the file but hide it from this library’s Generation list and Benchmark. Other libraries are unchanged."
                  >
                    <input
                      type="checkbox"
                      checked={f.enabled !== false}
                      aria-label={`Use ${f.stem} in this library`}
                      onChange={(event) =>
                        void setCheckpointInUse(f, event.target.checked)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className={
                      [
                        f.relativePath === selectedPath ? 'selected' : '',
                        f.enabled === false ? 'file-list-unused' : '',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    onClick={() => setSelectedPath(f.relativePath)}
                    onContextMenu={(event: ReactMouseEvent) => {
                      setSelectedPath(f.relativePath);
                      setContextMenu(
                        openModelFileContextMenu(f, event, 'Checkpoint'),
                      );
                    }}
                    title={
                      isUnrated(f.rating)
                        ? `${f.relativePath} ? unrated`
                        : `${f.relativePath} ? ${f.rating}?`
                    }
                  >
                    <span className="file-list-name">{f.stem}</span>
                    {!isUnrated(f.rating) ? (
                      <span className="file-list-rating">
                        {f.rating.toFixed(1)}?
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      <PanelSplitter kind="files" {...filesSplitter} />

      <aside className="sidebar details-sidebar model-details-mid">
        {error ? <p className="hint error-text pad">{error}</p> : null}
        {file ? (
          <>
            <div className="sidebar-head">
              <strong>Checkpoint details</strong>
            </div>
            <label
              className="checkpoint-use-toggle"
              title="Untick to keep this file on disk but leave it out of this library’s Generation list and Benchmark."
            >
              <input
                type="checkbox"
                checked={file.enabled !== false}
                onChange={(event) =>
                  void setCheckpointInUse(file, event.target.checked)
                }
              />
              Use in this library
            </label>
            <div className="pad">
              <ModelIdentityPanel
                file={file}
                showRating
                rematchKind="Checkpoint"
                onCivitaiLinkChanged={() => {
                  void refresh();
                  if (selectedPath) {
                    void window.wcm.modelFiles
                      .getCheckpointDetail(selectedPath)
                      .then((d) => {
                        setFile(d.file);
                        if (d.file.masterImageAbsolutePath) {
                          setRightTab('benchmark');
                        }
                      })
                      .catch(() => {});
                  }
                }}
                onRatingChanged={(rating) =>
                  handleRatingChanged(file.relativePath, rating)
                }
              />
            </div>
          </>
        ) : (
          <div className="empty">Select a checkpoint file.</div>
        )}
      </aside>

      <PanelSplitter kind="details" {...detailsSplitter} />

      <section
        className="model-browser-panel checkpoint-right-pane"
        aria-label="Checkpoint preview"
      >
        <div className="civitai-preview-bar checkpoint-right-tabs">
          <div className="segmented" role="tablist" aria-label="Checkpoint view">
            <button
              type="button"
              role="tab"
              aria-selected={rightTab === 'benchmark'}
              className={rightTab === 'benchmark' ? 'active' : ''}
              title={
                hasBenchmarkSamples
                  ? 'Benchmark samples for this checkpoint'
                  : 'No Benchmark samples yet — run Generation → Benchmark'
              }
              onClick={() => setRightTab('benchmark')}
            >
              Benchmark
              {hasBenchmarkSamples ? ` · ${benchmarkImagePaths.length}` : ''}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={rightTab === 'website'}
              className={rightTab === 'website' ? 'active' : ''}
              onClick={() => setRightTab('website')}
            >
              Website
            </button>
          </div>
          {rightTab === 'website' && (modelId != null || pageUrl) ? (
            <div className="civitai-preview-bar-actions">
              <button
                type="button"
                className="civitai-icon-btn action-open"
                title="Open in external browser"
                aria-label="Open in external browser"
                onClick={() => {
                  const hf = pageUrl
                    ? parseHuggingFaceModelPageUrl(pageUrl)?.repoId
                    : undefined;
                  if (hf) {
                    void window.wcm.huggingface.openModelPage(hf);
                    return;
                  }
                  if (modelId != null) {
                    void window.wcm.civitai.openModelPage(
                      modelId,
                      modelName ?? String(modelId),
                    );
                  }
                }}
              >
                <ExternalLink size={15} />
              </button>
            </div>
          ) : null}
        </div>
        <div className="checkpoint-right-pane-body">
          {rightTab === 'benchmark' ? (
            <CheckpointBenchmarkPane imagePaths={benchmarkImagePaths} />
          ) : (
            <ModelCivitaiPagePane
              pageUrl={pageUrl}
              modelId={modelId}
              modelName={modelName}
              embedded
            />
          )}
        </div>
      </section>

      {contextMenu ? (
        <ModelFileContextMenu
          menu={contextMenu}
          kind="Checkpoint"
          onClose={() => setContextMenu(null)}
          onSelect={setSelectedPath}
          onError={(message) => setError(message)}
          onDeleteCheckpoint={(target, skipConfirm) =>
            requestDelete(target.relativePath, skipConfirm)
          }
        />
      ) : null}

      {confirmDelete ? (
        <div
          className="modal-overlay"
          onClick={() => setConfirmDelete(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setConfirmDelete(null);
          }}
          role="presentation"
        >
          <div
            className="modal"
            role="dialog"
            aria-label="Confirm delete checkpoint"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <h2>Delete checkpoint?</h2>
            </header>
            <div className="modal-body">
              <p>
                Permanently delete this checkpoint from disk
                {confirmDelete.hasMasters ? (
                  <>
                    , move matching Checkpoint Benchmark samples into{' '}
                    <code>!Deleted</code>
                  </>
                ) : null}
                , and archive any linked Civitai catalog entry.
              </p>
              <p className="mono">{confirmDelete.path}</p>
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
                className="danger-btn"
                disabled={busy}
                onClick={() => void runDelete(confirmDelete.path)}
              >
                <Trash2 size={14} /> Delete
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </main>
  );
}
