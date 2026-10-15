import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Download,
  ExternalLink,
  ListOrdered,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import type {
  ArchivedHfModelDto,
  HfBrowseFiltersDto,
  HfDownloadProgressDto,
  HfDownloadQueueSnapshotDto,
  HfDownloadTypeDto,
  HuggingFaceModelDetailDto,
  HuggingFaceModelHitDto,
  LoraDownloadCategoryListDto,
} from '../shared/contracts';
import {
  DEFAULT_HF_BROWSE_FILTERS,
  HF_LIBRARIES,
  HF_MODEL_FAMILIES,
  HF_MODEL_TYPES,
  HF_PIPELINE_TAGS,
  HF_SORTS,
} from '../domain/huggingfaceSearch';
import { DEFAULT_LORA_DOWNLOAD_WEIGHTS } from '../domain/loraDownloadCategory';
import { proposeDownloadSaveFileName } from '../domain/civitaiDownloadFileName';
import { modalOverlayDismiss } from './modalOverlayDismiss';

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '?';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function gatedLabel(gated: HuggingFaceModelHitDto['gated']): string | null {
  if (gated === true || gated === 'auto' || gated === 'manual') return 'Gated';
  return null;
}

function highlightTags(tags: string[]): string[] {
  const preferred = [
    'lora',
    'lycoris',
    'controlnet',
    'textual_inversion',
    'ip-adapter',
    'stable-diffusion-xl',
    'stable-diffusion',
    'flux',
    'pony',
    'illustrious',
    'krea',
    'krea-2',
    'krea2',
    'diffusers',
    'safetensors',
  ];
  const lower = new Set(tags.map((t) => t.toLowerCase()));
  const out: string[] = [];
  for (const p of preferred) {
    if (lower.has(p)) out.push(p);
  }
  for (const tag of tags) {
    if (tag.startsWith('base_model:') && out.length < 8) {
      out.push(tag.replace(/^base_model:(?:adapter:|finetune:)?/, 'base:'));
    }
  }
  return [...new Set(out)].slice(0, 8);
}

type Tab = 'browse' | 'archive' | 'queue';

type DownloadConfirm = {
  hit: HuggingFaceModelHitDto;
  detail: HuggingFaceModelDetailDto;
  filePath: string;
  type: HfDownloadTypeDto;
  fileName: string;
  loraCategoryId: string;
  category: string;
  weights: string;
  destError: string | null;
};

export function HuggingFaceBrowserModal({
  onClose,
  onError,
  presentation = 'modal',
}: {
  onClose: () => void;
  onError: (message: string) => void;
  presentation?: 'modal' | 'window';
}) {
  const isWindow = presentation === 'window';
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState<HfBrowseFiltersDto>({
    ...DEFAULT_HF_BROWSE_FILTERS,
  });
  const [items, setItems] = useState<HuggingFaceModelHitDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [tab, setTab] = useState<Tab>('browse');
  const [archived, setArchived] = useState<ArchivedHfModelDto[]>([]);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<HfDownloadProgressDto | null>(null);
  const [queueSnap, setQueueSnap] =
    useState<HfDownloadQueueSnapshotDto | null>(null);
  const [confirm, setConfirm] = useState<DownloadConfirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [loraCategories, setLoraCategories] =
    useState<LoraDownloadCategoryListDto | null>(null);
  const [checkpointCategories, setCheckpointCategories] = useState<string[]>(
    [],
  );
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipPersist = useRef(true);

  const flashError = useCallback(
    (message: string) => {
      setStatusError(message);
      onError(message);
    },
    [onError],
  );

  const archivedSet = useMemo(
    () => new Set(archived.map((a) => a.repoId.toLowerCase())),
    [archived],
  );

  const visibleItems = useMemo(() => {
    if (tab === 'archive') {
      // Show archived ids as lightweight rows when we don't have full hit data.
      return items.filter((i) => archivedSet.has(i.id.toLowerCase()));
    }
    return items.filter((i) => !archivedSet.has(i.id.toLowerCase()));
  }, [items, archivedSet, tab]);

  const archivedOnlyRows = useMemo(() => {
    if (tab !== 'archive') return [];
    const present = new Set(visibleItems.map((i) => i.id.toLowerCase()));
    return archived.filter((a) => !present.has(a.repoId.toLowerCase()));
  }, [tab, archived, visibleItems]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.wcm.ui.getHfBrowseFilters(),
      window.wcm.huggingface.listArchived(),
      window.wcm.huggingface.listDownloadQueue(),
      window.wcm.civitai.listLoraDownloadCategories().catch(() => null),
      window.wcm.civitai
        .listDownloadCategories('Checkpoint')
        .catch(() => ({ categories: [] as string[] })),
    ])
      .then(([saved, arch, queue, cats, ckCats]) => {
        if (cancelled) return;
        setFilters(saved);
        setArchived(arch);
        setQueueSnap(queue);
        setLoraCategories(cats);
        setCheckpointCategories(ckCats?.categories ?? []);
        setReady(true);
        window.setTimeout(() => {
          skipPersist.current = false;
        }, 0);
      })
      .catch((err) => {
        if (cancelled) return;
        flashError(err instanceof Error ? err.message : String(err));
        setReady(true);
        skipPersist.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [flashError]);

  useEffect(() => {
    if (!ready || skipPersist.current) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void window.wcm.ui.setHfBrowseFilters(filters).catch((err) => {
        flashError(err instanceof Error ? err.message : String(err));
      });
    }, 250);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [filters, ready, flashError]);

  useEffect(() => {
    const offProgress = window.wcm.huggingface.onDownloadProgress((p) => {
      setProgress(p.done && !p.error ? null : p);
      if (p.done && p.saved) {
        setStatusNotice(`Saved ${p.fileName}`);
        window.setTimeout(() => setStatusNotice(null), 2500);
      }
      if (p.error) flashError(p.error);
    });
    const offQueue = window.wcm.huggingface.onDownloadQueueChanged((snap) => {
      setQueueSnap(snap);
    });
    return () => {
      offProgress();
      offQueue();
    };
  }, [flashError]);

  const patch = <K extends keyof HfBrowseFiltersDto>(
    key: K,
    value: HfBrowseFiltersDto[K],
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const runSearch = useCallback(
    async (opts?: { cursor?: string | null; append?: boolean }) => {
      const append = opts?.append === true;
      if (append) setLoadingMore(true);
      else setBusy(true);
      setStatusError(null);
      try {
        const result = await window.wcm.huggingface.searchModels({
          filters,
          cursor: opts?.cursor ?? null,
        });
        setItems((prev) => {
          if (!append) return result.items;
          const seen = new Set(prev.map((item) => item.id.toLowerCase()));
          return [
            ...prev,
            ...result.items.filter((item) => !seen.has(item.id.toLowerCase())),
          ];
        });
        setNextCursor(result.nextCursor);
        setSearched(true);
        if (tab === 'archive') setTab('browse');
      } catch (err) {
        flashError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        setLoadingMore(false);
      }
    },
    [filters, tab, flashError],
  );

  // Browse hides archived rows — keep paging until something visible shows up.
  useEffect(() => {
    if (tab !== 'browse' || !searched || busy || loadingMore) return;
    if (visibleItems.length > 0 || !nextCursor) return;
    void runSearch({ cursor: nextCursor, append: true });
  }, [
    tab,
    searched,
    busy,
    loadingMore,
    visibleItems.length,
    nextCursor,
    runSearch,
  ]);

  const clearFilters = async () => {
    skipPersist.current = true;
    try {
      const cleared = await window.wcm.ui.clearHfBrowseFilters();
      setFilters(cleared);
      setItems([]);
      setNextCursor(null);
      setSearched(false);
    } catch (err) {
      flashError(err instanceof Error ? err.message : String(err));
    } finally {
      window.setTimeout(() => {
        skipPersist.current = false;
      }, 0);
    }
  };

  const archiveRepo = async (repoId: string) => {
    try {
      const next = await window.wcm.huggingface.archiveModel(repoId);
      setArchived(next);
      setStatusNotice(`Archived ${repoId}`);
      window.setTimeout(() => setStatusNotice(null), 2000);
    } catch (err) {
      flashError(err instanceof Error ? err.message : String(err));
    }
  };

  const unarchiveRepo = async (repoId: string) => {
    try {
      const next = await window.wcm.huggingface.unarchiveModel(repoId);
      setArchived(next);
    } catch (err) {
      flashError(err instanceof Error ? err.message : String(err));
    }
  };

  const openDownloadConfirm = async (hit: HuggingFaceModelHitDto) => {
    setConfirmBusy(true);
    setStatusError(null);
    try {
      const detail = await window.wcm.huggingface.getModelDetail(hit.id);
      if (detail.siblings.length === 0) {
        throw new Error('No weight files (.safetensors / .ckpt / …) found in this repo');
      }
      const filePath = detail.siblings[0]!.path;
      const type: HfDownloadTypeDto =
        detail.suggestedType ??
        (filters.modelType === 'checkpoint' ? 'Checkpoint' : 'LORA');
      const fileName = proposeDownloadSaveFileName(
        filePath.split('/').pop() || filePath,
        'model.safetensors',
      );
      const loraCategoryId =
        loraCategories?.lastCategoryId ??
        loraCategories?.categories[0]?.id ??
        '';
      const category = checkpointCategories[0] ?? '';
      const next: DownloadConfirm = {
        hit,
        detail,
        filePath,
        type,
        fileName,
        loraCategoryId,
        category,
        weights: DEFAULT_LORA_DOWNLOAD_WEIGHTS,
        destError: null,
      };
      const dest = await window.wcm.huggingface.checkDownloadDestination({
        type,
        fileName,
        loraCategoryId: type === 'LORA' ? loraCategoryId || undefined : undefined,
        category: type === 'Checkpoint' ? category || undefined : undefined,
      });
      if (dest.fileName) {
        next.fileName = dest.fileName;
      }
      setConfirm(next);
    } catch (err) {
      flashError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmBusy(false);
    }
  };

  const refreshDestError = async (draft: DownloadConfirm) => {
    try {
      const dest = await window.wcm.huggingface.checkDownloadDestination({
        type: draft.type,
        fileName: draft.fileName,
        loraCategoryId:
          draft.type === 'LORA' ? draft.loraCategoryId || undefined : undefined,
        category:
          draft.type === 'Checkpoint' ? draft.category || undefined : undefined,
      });
      setConfirm({
        ...draft,
        fileName: dest.fileName ?? draft.fileName,
        destError: null,
      });
    } catch (err) {
      setConfirm({
        ...draft,
        destError: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const enqueueDownload = async () => {
    if (!confirm || confirm.destError) return;
    if (confirm.type === 'LORA' && !confirm.loraCategoryId) {
      setConfirm({ ...confirm, destError: 'Pick a LoRA download category.' });
      return;
    }
    setConfirmBusy(true);
    try {
      const snap = await window.wcm.huggingface.downloadModel({
        repoId: confirm.hit.id,
        filePath: confirm.filePath,
        type: confirm.type,
        fileName: confirm.fileName,
        modelName: confirm.hit.id,
        loraCategoryId:
          confirm.type === 'LORA' ? confirm.loraCategoryId : undefined,
        category: confirm.type === 'Checkpoint' ? confirm.category : undefined,
        weights: confirm.type === 'LORA' ? confirm.weights : undefined,
      });
      setQueueSnap(snap);
      setConfirm(null);
      setStatusNotice(`Queued ${confirm.hit.id}`);
      window.setTimeout(() => setStatusNotice(null), 2000);
    } catch (err) {
      flashError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmBusy(false);
    }
  };

  const pct =
    progress && progress.totalBytes && progress.totalBytes > 0
      ? Math.min(
          100,
          Math.round((progress.receivedBytes / progress.totalBytes) * 100),
        )
      : null;

  const queueCount =
    (queueSnap?.queuedCount ?? 0) + (queueSnap?.active ? 1 : 0);

  const body = (
    <>
      <header className={`modal-head${isWindow ? ' hf-window-head' : ''}`}>
        <h2>
          <Search size={18} /> Hugging Face
        </h2>
        <div className="hf-head-tabs" role="tablist">
          <button
            type="button"
            className={tab === 'browse' ? 'active' : ''}
            onClick={() => setTab('browse')}
          >
            Browse
          </button>
          <button
            type="button"
            className={tab === 'archive' ? 'active' : ''}
            onClick={() => setTab('archive')}
          >
            Archive ({archived.length})
          </button>
          <button
            type="button"
            className={tab === 'queue' ? 'active' : ''}
            onClick={() => setTab('queue')}
          >
            <ListOrdered size={14} /> Queue
            {queueCount > 0 ? ` (${queueCount})` : ''}
          </button>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </header>

      <div className="modal-body hf-modal-body">
        {!ready ? (
          <p className="hint">
            <Loader2 size={14} className="spin" /> Loading…
          </p>
        ) : tab === 'queue' ? (
          <div className="hf-queue-panel">
            <div className="hf-queue-actions">
              {queueSnap?.paused ? (
                <button
                  type="button"
                  onClick={() =>
                    void window.wcm.huggingface
                      .resumeDownloadQueue()
                      .then(setQueueSnap)
                  }
                >
                  <Play size={14} /> Resume
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    void window.wcm.huggingface
                      .pauseDownloadQueue()
                      .then(setQueueSnap)
                  }
                  disabled={!queueSnap?.active && (queueSnap?.queuedCount ?? 0) === 0}
                >
                  <Pause size={14} /> Pause
                </button>
              )}
            </div>
            {!queueSnap?.active && (queueSnap?.queue.length ?? 0) === 0 ? (
              <p className="hint">Download queue is empty.</p>
            ) : (
              <ul className="hf-queue-list">
                {queueSnap?.active ? (
                  <li className="hf-queue-row active">
                    <div>
                      <strong>{queueSnap.active.modelName}</strong>
                      <small>
                        {queueSnap.active.fileName} · {queueSnap.active.type}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() =>
                        void window.wcm.huggingface
                          .cancelDownloadJob(queueSnap.active!.jobId)
                          .then(setQueueSnap)
                      }
                    >
                      Cancel
                    </button>
                  </li>
                ) : null}
                {(queueSnap?.queue ?? []).map((job) => (
                  <li key={job.jobId} className="hf-queue-row">
                    <div>
                      <strong>{job.modelName}</strong>
                      <small>
                        {job.fileName} · {job.type}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() =>
                        void window.wcm.huggingface
                          .cancelDownloadJob(job.jobId)
                          .then(setQueueSnap)
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            {tab === 'browse' ? (
              <>
                <div className="hf-toolbar">
                  <label className="search-box hf-search">
                    <Search size={14} />
                    <input
                      type="search"
                      placeholder="Keyword (model id / name)…"
                      value={filters.search}
                      disabled={busy}
                      onChange={(e) => patch('search', e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void runSearch();
                        }
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runSearch()}
                  >
                    {busy ? (
                      <>
                        <Loader2 size={14} className="spin" /> Searching…
                      </>
                    ) : (
                      'Search'
                    )}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    title="Reset filters"
                    onClick={() => void clearFilters()}
                  >
                    <RotateCcw size={14} /> Clear
                  </button>
                </div>

                <div className="hf-filters">
                  <label className="field">
                    <span>Model type</span>
                    <select
                      value={filters.modelType}
                      disabled={busy}
                      onChange={(e) =>
                        patch(
                          'modelType',
                          e.target.value as HfBrowseFiltersDto['modelType'],
                        )
                      }
                    >
                      {HF_MODEL_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Model family</span>
                    <select
                      value={filters.modelFamily}
                      disabled={busy}
                      onChange={(e) =>
                        patch(
                          'modelFamily',
                          e.target.value as HfBrowseFiltersDto['modelFamily'],
                        )
                      }
                    >
                      {HF_MODEL_FAMILIES.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Task</span>
                    <select
                      value={filters.pipelineTag}
                      disabled={busy}
                      onChange={(e) => patch('pipelineTag', e.target.value)}
                    >
                      {HF_PIPELINE_TAGS.map((p) => (
                        <option key={p.id || 'any'} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Library</span>
                    <select
                      value={filters.library}
                      disabled={busy}
                      onChange={(e) => patch('library', e.target.value)}
                    >
                      {HF_LIBRARIES.map((lib) => (
                        <option key={lib.id || 'any'} value={lib.id}>
                          {lib.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Sort</span>
                    <select
                      value={filters.sort}
                      disabled={busy}
                      onChange={(e) =>
                        patch(
                          'sort',
                          e.target.value as HfBrowseFiltersDto['sort'],
                        )
                      }
                    >
                      {HF_SORTS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Direction</span>
                    <select
                      value={String(filters.direction)}
                      disabled={busy}
                      onChange={(e) =>
                        patch('direction', e.target.value === '1' ? 1 : -1)
                      }
                    >
                      <option value="-1">Descending</option>
                      <option value="1">Ascending</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Gated</span>
                    <select
                      value={filters.gated}
                      disabled={busy}
                      onChange={(e) =>
                        patch(
                          'gated',
                          e.target.value as HfBrowseFiltersDto['gated'],
                        )
                      }
                    >
                      <option value="any">Any</option>
                      <option value="false">Public only</option>
                      <option value="true">Gated only</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Page size</span>
                    <select
                      value={String(filters.limit)}
                      disabled={busy}
                      onChange={(e) => patch('limit', Number(e.target.value))}
                    >
                      {[10, 20, 30, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field hf-field-wide">
                    <span>Author / org</span>
                    <input
                      className="text-input"
                      value={filters.author}
                      disabled={busy}
                      placeholder="e.g. stabilityai"
                      spellCheck={false}
                      onChange={(e) => patch('author', e.target.value)}
                    />
                  </label>
                  <label className="field hf-field-wide">
                    <span>Base model</span>
                    <input
                      className="text-input"
                      value={filters.baseModel}
                      disabled={busy}
                      placeholder="e.g. stabilityai/stable-diffusion-xl-base-1.0"
                      spellCheck={false}
                      onChange={(e) => patch('baseModel', e.target.value)}
                    />
                  </label>
                  <label className="field hf-field-wide">
                    <span>Extra tags</span>
                    <input
                      className="text-input"
                      value={filters.tags}
                      disabled={busy}
                      placeholder="Comma/space tags"
                      spellCheck={false}
                      onChange={(e) => patch('tags', e.target.value)}
                    />
                  </label>
                </div>
              </>
            ) : (
              <p className="hint">
                Archived Hub repos are hidden from Browse. Unarchive to restore.
              </p>
            )}

            <div className="hf-results">
              {tab === 'browse' && !searched && !busy ? (
                <p className="hint">Run a search to list Hub models.</p>
              ) : null}
              {tab === 'browse' && searched && visibleItems.length === 0 ? (
                busy || loadingMore || nextCursor ? (
                  <p className="hint">
                    <Loader2 size={14} className="spin" /> Loading more…
                  </p>
                ) : (
                  <p className="hint">No models matched these filters.</p>
                )
              ) : null}
              {tab === 'archive' &&
              visibleItems.length === 0 &&
              archivedOnlyRows.length === 0 ? (
                <p className="hint">Nothing archived yet.</p>
              ) : null}

              <ul className="hf-result-list">
                {visibleItems.map((item) => {
                  const chips = highlightTags(item.tags);
                  const gated = gatedLabel(item.gated);
                  const isArchived = archivedSet.has(item.id.toLowerCase());
                  return (
                    <li key={item.id} className="hf-result-row">
                      <div className="hf-result-main">
                        <button
                          type="button"
                          className="link-btn hf-result-id"
                          title="Open on Hugging Face"
                          onClick={() => {
                            void window.wcm.huggingface
                              .openModelPage(item.id)
                              .catch((err) =>
                                flashError(
                                  err instanceof Error
                                    ? err.message
                                    : String(err),
                                ),
                              );
                          }}
                        >
                          {item.id}
                          <ExternalLink size={12} />
                        </button>
                        <div className="hf-result-meta">
                          <span>{formatCount(item.downloads)}↓</span>
                          <span>{formatCount(item.likes)}♥</span>
                          {item.pipelineTag ? (
                            <span>{item.pipelineTag}</span>
                          ) : null}
                          {item.libraryName ? (
                            <span>{item.libraryName}</span>
                          ) : null}
                          {gated ? (
                            <span className="hf-badge">{gated}</span>
                          ) : null}
                        </div>
                        {chips.length > 0 ? (
                          <div className="hf-tag-row">
                            {chips.map((tag) => (
                              <span key={tag} className="hf-tag">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="hf-result-actions">
                        {!isArchived ? (
                          <>
                            <button
                              type="button"
                              className="manage-btn"
                              disabled={confirmBusy}
                              title="Download to LoRA / Checkpoint folder"
                              onClick={() => void openDownloadConfirm(item)}
                            >
                              <Download size={14} /> Download
                            </button>
                            <button
                              type="button"
                              className="ghost-btn"
                              title="Hide from Browse"
                              onClick={() => void archiveRepo(item.id)}
                            >
                              <Archive size={14} /> Archive
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="manage-btn"
                            onClick={() => void unarchiveRepo(item.id)}
                          >
                            <ArchiveRestore size={14} /> Unarchive
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
                {archivedOnlyRows.map((row) => (
                  <li key={row.repoId} className="hf-result-row">
                    <div className="hf-result-main">
                      <strong className="hf-result-id">{row.repoId}</strong>
                      <div className="hf-result-meta">
                        <span className="hf-badge">Archived</span>
                      </div>
                    </div>
                    <div className="hf-result-actions">
                      <button
                        type="button"
                        className="manage-btn"
                        onClick={() => void unarchiveRepo(row.repoId)}
                      >
                        <ArchiveRestore size={14} /> Unarchive
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              {tab === 'browse' && nextCursor ? (
                <div className="hf-load-more">
                  <button
                    type="button"
                    disabled={busy || loadingMore}
                    onClick={() =>
                      void runSearch({ cursor: nextCursor, append: true })
                    }
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 size={14} className="spin" /> Loading…
                      </>
                    ) : (
                      'Load more'
                    )}
                  </button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      {confirm ? (
        <div
          className="modal-overlay hf-confirm-overlay"
          {...modalOverlayDismiss(() => setConfirm(null))}
        >
          <div
            className="modal hf-confirm-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <h2>Download {confirm.hit.id}</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setConfirm(null)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="modal-body">
              <label className="field">
                <span>Weight file</span>
                <select
                  value={confirm.filePath}
                  onChange={(e) => {
                    const filePath = e.target.value;
                    const fileName = proposeDownloadSaveFileName(
                      filePath.split('/').pop() || filePath,
                      'model.safetensors',
                    );
                    void refreshDestError({ ...confirm, filePath, fileName });
                  }}
                >
                  {confirm.detail.siblings.map((f) => (
                    <option key={f.path} value={f.path}>
                      {f.path}
                      {f.size != null ? ` (${formatBytes(f.size)})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Save as</span>
                <input
                  className="text-input"
                  value={confirm.fileName}
                  spellCheck={false}
                  onChange={(e) => {
                    const fileName = e.target.value;
                    void refreshDestError({ ...confirm, fileName });
                  }}
                />
              </label>
              <label className="field">
                <span>Destination type</span>
                <select
                  value={confirm.type}
                  onChange={(e) => {
                    const type = e.target.value as HfDownloadTypeDto;
                    void refreshDestError({ ...confirm, type });
                  }}
                >
                  <option value="LORA">LoRA</option>
                  <option value="Checkpoint">Checkpoint</option>
                </select>
              </label>
              {confirm.type === 'LORA' ? (
                <>
                  <label className="field">
                    <span>LoRA category</span>
                    <select
                      value={confirm.loraCategoryId}
                      onChange={(e) => {
                        const loraCategoryId = e.target.value;
                        void refreshDestError({ ...confirm, loraCategoryId });
                      }}
                    >
                      <option value="">Select…</option>
                      {(loraCategories?.categories ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Weights</span>
                    <input
                      className="text-input"
                      value={confirm.weights}
                      onChange={(e) =>
                        setConfirm({ ...confirm, weights: e.target.value })
                      }
                    />
                  </label>
                </>
              ) : (
                <label className="field">
                  <span>Category folder</span>
                  <select
                    value={confirm.category}
                    onChange={(e) => {
                      const category = e.target.value;
                      void refreshDestError({ ...confirm, category });
                    }}
                  >
                    <option value="">(root)</option>
                    {checkpointCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {confirm.destError ? (
                <p className="hint error-text">{confirm.destError}</p>
              ) : null}
              <div className="manage-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={confirmBusy || Boolean(confirm.destError)}
                  onClick={() => void enqueueDownload()}
                >
                  {confirmBusy ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Download size={14} />
                  )}{' '}
                  Queue download
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <footer
        className={`status-bar hf-status-bar${
          statusError
            ? ' status-error'
            : statusNotice
              ? ' status-notice'
              : ''
        }`}
        role="status"
        aria-live="polite"
      >
        {progress && !progress.done ? (
          <>
            <div
              className={`status-bar-progress-line${pct === null ? ' indeterminate' : ''}`}
              aria-hidden
            >
              <div
                className="status-bar-progress-fill"
                style={{ width: `${pct ?? 30}%` }}
              />
            </div>
            <button
              type="button"
              className="status-bar-message status-bar-queue-btn"
              title="Open download queue"
              onClick={() => setTab('queue')}
            >
              {progress.statusMessage ||
                `Downloading ${progress.modelName ?? progress.repoId}`}
              {pct != null ? ` — ${pct}%` : ''}
              {` · ${formatBytes(progress.receivedBytes)}${
                progress.totalBytes
                  ? ` / ${formatBytes(progress.totalBytes)}`
                  : ''
              }`}
              {(progress.queuedCount ?? 0) > 0
                ? ` · ${progress.queuedCount} queued`
                : ''}
            </button>
          </>
        ) : statusError ? (
          <span className="status-bar-message" title={statusError}>
            {statusError}
          </span>
        ) : statusNotice ? (
          <span className="status-bar-message" title={statusNotice}>
            {statusNotice}
          </span>
        ) : (
          <span className="status-bar-message">Ready</span>
        )}
        {(statusError || statusNotice) && !(progress && !progress.done) ? (
          <button
            type="button"
            className="status-bar-dismiss"
            title="Dismiss"
            onClick={() => {
              setStatusError(null);
              setStatusNotice(null);
            }}
          >
            <X size={14} />
          </button>
        ) : null}
      </footer>
    </>
  );

  if (isWindow) {
    return <div className="hf-window-shell">{body}</div>;
  }

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onClose)}>
      <div
        className="modal modal-wide hf-modal"
        onClick={(event) => event.stopPropagation()}
      >
        {body}
      </div>
    </div>
  );
}
