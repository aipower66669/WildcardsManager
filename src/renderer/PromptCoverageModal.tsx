import { useEffect, useMemo, useState } from 'react';
import {
  Eye,
  EyeOff,
  FolderOpen,
  ListRestart,
  Loader2,
  Maximize2,
  Minimize2,
  PieChart,
  Play,
  Square,
  X,
} from 'lucide-react';
import type {
  PromptCoverageProgressDto,
  PromptCoverageReportDto,
  PromptCoverageWildcardStatDto,
} from '../shared/contracts';
import { modalOverlayDismiss } from './modalOverlayDismiss';
import { usePersistedFloatingModal } from './usePersistedFloatingModal';

type TabId = 'never' | 'ignored' | 'hot' | 'all' | 'byPrompt';

type Props = {
  progress: PromptCoverageProgressDto | null;
  report: PromptCoverageReportDto | null;
  onClose: () => void;
  onStart: () => void;
  onCancel: () => void;
  onReportUpdated?: (report: PromptCoverageReportDto) => void;
  onOpenWildcard?: (key: string) => void;
  onSelectPromptFolder?: (relativeFolder: string) => void;
  starting?: boolean;
};

function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `~${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `~${m}m ${s}s` : `~${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `~${h}h ${rm}m` : `~${h}h`;
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function breadcrumb(folder: string): string {
  const cleaned = folder.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!cleaned) return '(prompts root)';
  return cleaned.split('/').filter(Boolean).join(' › ');
}

function topFolders(byFolder: Record<string, number>, limit = 3): string {
  return Object.entries(byFolder)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([f, n]) => `${breadcrumb(f)} (${n})`)
    .join(', ');
}

export function PromptCoverageModal({
  progress,
  report,
  onClose,
  onStart,
  onCancel,
  onReportUpdated,
  onOpenWildcard,
  onSelectPromptFolder,
  starting = false,
}: Props) {
  const running = progress?.status === 'running' || starting;
  const [tab, setTab] = useState<TabId>('never');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [refreshingNever, setRefreshingNever] = useState(false);
  const [ignoreBusyKey, setIgnoreBusyKey] = useState<string | null>(null);

  const ignoredSet = useMemo(
    () => new Set(report?.ignoredKeys ?? []),
    [report?.ignoredKeys],
  );

  const {
    maximized,
    modalStyle,
    dragging,
    headerPointerProps,
    resizePointerProps,
    toggleMaximized,
  } = usePersistedFloatingModal({
    defaultWidth: 960,
    defaultHeight: 700,
    minWidth: 560,
    minHeight: 400,
    load: async () => {
      const settings = await window.wcm.ui.getSettings();
      return settings.promptCoverageWindow;
    },
    save: (state) => {
      void window.wcm.ui.setPromptCoverageWindow(state).catch(() => {
        // ignore persistence failures
      });
    },
  });

  useEffect(() => {
    if (progress?.status === 'error' && progress.error) {
      setError(progress.error);
    }
  }, [progress]);

  useEffect(() => {
    if (!report || running) return;
    if (report.summary.neverReachedFiles > 0) setTab('never');
    else if (report.summary.hotFiles > 0) setTab('hot');
    else setTab('all');
  }, [report, running]);

  const filtered = useMemo(() => {
    if (!report) return [] as PromptCoverageWildcardStatDto[];
    const q = query.trim().toLowerCase();
    let rows = report.wildcards;
    if (tab === 'never') {
      rows = rows.filter(
        (w) => w.bucket === 'never' && !ignoredSet.has(w.key),
      );
    } else if (tab === 'ignored') {
      rows = rows.filter((w) => ignoredSet.has(w.key));
    } else if (tab === 'hot') {
      rows = rows.filter((w) => w.bucket === 'hot');
    }
    if (q) rows = rows.filter((w) => w.key.toLowerCase().includes(q));
    if (tab === 'hot') {
      rows = [...rows].sort(
        (a, b) =>
          b.reachRate - a.reachRate ||
          b.visits - a.visits ||
          a.key.localeCompare(b.key),
      );
    } else if (tab === 'ignored') {
      rows = [...rows].sort((a, b) => a.key.localeCompare(b.key));
    }
    return rows;
  }, [report, tab, query, ignoredSet]);

  const reveal = async () => {
    setError(null);
    try {
      await window.wcm.prompts.revealCoverageReport();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const patchIgnore = async (key: string, action: 'add' | 'remove') => {
    setError(null);
    setIgnoreBusyKey(key);
    try {
      const next = await window.wcm.prompts.patchCoverageIgnore(
        action === 'add' ? { add: [key] } : { remove: [key] },
      );
      onReportUpdated?.(next);
      setRefreshNote(
        action === 'add'
          ? `Ignored “${key}” — hidden from Never Used.`
          : `Restored “${key}” to Never Used.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIgnoreBusyKey(null);
    }
  };

  const refreshNever = async () => {
    setError(null);
    setRefreshNote(null);
    setRefreshingNever(true);
    try {
      const result = await window.wcm.prompts.refreshCoverageNeverUsed();
      onReportUpdated?.(result.report);
      if (!result.changed) {
        setRefreshNote('Never Used is already up to date.');
      } else {
        const parts: string[] = [];
        if (result.removedMissing > 0) {
          parts.push(
            `removed ${result.removedMissing} deleted wildcard${
              result.removedMissing === 1 ? '' : 's'
            }`,
          );
        }
        if (result.clearedNeverByGenRef > 0) {
          parts.push(
            `cleared ${result.clearedNeverByGenRef} now named in !gen.txt`,
          );
        }
        setRefreshNote(
          parts.length > 0
            ? `Updated Never Used — ${parts.join('; ')}.`
            : 'Updated Never Used.',
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshingNever(false);
    }
  };

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onClose)}>
      <div
        className={`modal modal-wide prompt-coverage-modal${
          dragging ? ' is-dragging' : ''
        }${maximized ? ' is-maximized' : ''}`}
        role="dialog"
        aria-labelledby="prompt-coverage-title"
        style={modalStyle}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className={`modal-head modal-head-draggable${
            dragging ? ' dragging' : ''
          }`}
          title="Drag to move · double-click to maximize"
          {...headerPointerProps}
        >
          <h2 id="prompt-coverage-title">
            <PieChart size={18} /> Prompt coverage
          </h2>
          <div className="row-actions">
            <button
              type="button"
              className="icon-btn"
              title={maximized ? 'Restore' : 'Maximize'}
              aria-label={maximized ? 'Restore' : 'Maximize'}
              onClick={toggleMaximized}
            >
              {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Close"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="modal-body prompt-coverage-body">
          {running ? (
            <div className="prompt-coverage-progress">
              <p className="hint">
                Simulating every `!gen.txt` line in the background. You can close
                this dialog — progress stays on the Prompts toolbar.
              </p>
              <div className="prompt-coverage-bar-track">
                <div
                  className="prompt-coverage-bar-fill"
                  style={{ width: `${progress?.percent ?? 0}%` }}
                />
              </div>
              <div className="prompt-coverage-progress-meta">
                <span>
                  {(progress?.percent ?? 0).toFixed(1)}% ·{' '}
                  {(progress?.done ?? 0).toLocaleString()} /{' '}
                  {(progress?.total ?? 0).toLocaleString()} walks
                </span>
                <span>
                  {progress?.walksPerSec?.toLocaleString() ?? '0'}/s · ETA{' '}
                  {formatEta(progress?.etaSeconds)}
                </span>
              </div>
              {progress?.currentFolder != null ? (
                <p className="hint mono">
                  Current: {breadcrumb(progress.currentFolder)}
                </p>
              ) : null}
              <div className="row-actions">
                <button
                  type="button"
                  className="danger"
                  onClick={onCancel}
                  disabled={starting && !progress}
                >
                  <Square size={14} /> Cancel
                </button>
                <button type="button" onClick={onClose}>
                  Close (keep running)
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="row-actions prompt-coverage-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    setError(null);
                    onStart();
                  }}
                >
                  {starting ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  {report ? 'Re-run coverage' : 'Run coverage'}
                </button>
                {report ? (
                  <>
                    <button
                      type="button"
                      title="Re-scan !gen.txt refs and drop deleted wildcards — no full coverage re-run"
                      disabled={refreshingNever}
                      onClick={() => void refreshNever()}
                    >
                      {refreshingNever ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <ListRestart size={14} />
                      )}
                      Refresh Never Used
                    </button>
                    <button type="button" onClick={() => void reveal()}>
                      <FolderOpen size={14} /> Reveal JSON
                    </button>
                  </>
                ) : null}
              </div>
              {refreshNote ? <p className="hint">{refreshNote}</p> : null}

              {report ? (
                <>
                  <div className="prompt-coverage-summary">
                    <span>
                      {report.summary.reachedFiles.toLocaleString()} /{' '}
                      {report.summary.libraryFiles.toLocaleString()} reached
                    </span>
                    <span>
                      {report.summary.neverReachedFiles.toLocaleString()} never
                    </span>
                    {(report.summary.ignoredNeverFiles ??
                      report.ignoredKeys?.length ??
                      0) > 0 ? (
                      <span>
                        {(
                          report.summary.ignoredNeverFiles ??
                          report.ignoredKeys.length
                        ).toLocaleString()}{' '}
                        ignored
                      </span>
                    ) : null}
                    <span>{report.summary.hotFiles.toLocaleString()} hot</span>
                    <span>
                      {report.summary.genLines.toLocaleString()} lines ×{' '}
                      {report.iterations.toLocaleString()}
                    </span>
                    <span className="hint">
                      seed {report.seed} ·{' '}
                      {new Date(report.generatedAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="prompt-coverage-tabs">
                    {(
                      [
                        ['never', `Never (${report.summary.neverReachedFiles})`],
                        [
                          'ignored',
                          `Ignored (${
                            report.summary.ignoredNeverFiles ??
                            report.ignoredKeys?.length ??
                            0
                          })`,
                        ],
                        ['hot', `Hot (${report.summary.hotFiles})`],
                        ['all', `All (${report.summary.libraryFiles})`],
                        ['byPrompt', `By prompt (${report.summary.genFolders})`],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={tab === id ? 'active' : ''}
                        onClick={() => setTab(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {tab !== 'byPrompt' ? (
                    <>
                      <input
                        className="text-input"
                        placeholder="Filter wildcard keys…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <div className="prompt-coverage-table-wrap">
                        <table className="prompt-coverage-table">
                          <thead>
                            <tr>
                              <th>Wildcard</th>
                              <th>Reach</th>
                              <th>Hits</th>
                              <th>Visits</th>
                              <th>Bucket</th>
                              <th>Direct refs</th>
                              <th>Top folders</th>
                              {tab === 'never' || tab === 'ignored' ? (
                                <th />
                              ) : null}
                            </tr>
                          </thead>
                          <tbody>
                            {filtered.slice(0, 500).map((row) => (
                              <tr key={row.key}>
                                <td>
                                  <button
                                    type="button"
                                    className="ghost-btn linkish"
                                    title="Open wildcard"
                                    onClick={() => onOpenWildcard?.(row.key)}
                                  >
                                    {row.key}
                                  </button>
                                </td>
                                <td className="mono">{pct(row.reachRate)}</td>
                                <td className="mono">
                                  {row.hits.toLocaleString()}
                                </td>
                                <td className="mono">
                                  {row.visits.toLocaleString()}
                                </td>
                                <td>
                                  <span
                                    className={`prompt-coverage-bucket is-${row.bucket}`}
                                  >
                                    {row.bucket}
                                  </span>
                                </td>
                                <td className="mono">{row.directGenRefs}</td>
                                <td className="hint">
                                  {topFolders(row.byFolder) || '—'}
                                </td>
                                {tab === 'never' ? (
                                  <td>
                                    <button
                                      type="button"
                                      className="icon-btn"
                                      title="Ignore — hide from Never Used (keep as a tool wildcard)"
                                      aria-label={`Ignore ${row.key}`}
                                      disabled={ignoreBusyKey === row.key}
                                      onClick={() =>
                                        void patchIgnore(row.key, 'add')
                                      }
                                    >
                                      {ignoreBusyKey === row.key ? (
                                        <Loader2 size={14} className="spin" />
                                      ) : (
                                        <EyeOff size={14} />
                                      )}
                                    </button>
                                  </td>
                                ) : null}
                                {tab === 'ignored' ? (
                                  <td>
                                    <button
                                      type="button"
                                      className="icon-btn"
                                      title="Stop ignoring — show in Never Used again"
                                      aria-label={`Unignore ${row.key}`}
                                      disabled={ignoreBusyKey === row.key}
                                      onClick={() =>
                                        void patchIgnore(row.key, 'remove')
                                      }
                                    >
                                      {ignoreBusyKey === row.key ? (
                                        <Loader2 size={14} className="spin" />
                                      ) : (
                                        <Eye size={14} />
                                      )}
                                    </button>
                                  </td>
                                ) : null}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {filtered.length > 500 ? (
                          <p className="hint">
                            Showing first 500 of{' '}
                            {filtered.length.toLocaleString()}. Refine the filter
                            to narrow results.
                          </p>
                        ) : null}
                        {filtered.length === 0 ? (
                          <p className="hint">No rows match.</p>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="prompt-coverage-table-wrap">
                      <table className="prompt-coverage-table">
                        <thead>
                          <tr>
                            <th>Prompt folder</th>
                            <th>Lines</th>
                            <th>Walks</th>
                            <th>Top wildcards</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.genFolders.map((folder) => (
                            <tr key={folder.relativeFolder || '__root__'}>
                              <td>
                                <button
                                  type="button"
                                  className="ghost-btn linkish"
                                  onClick={() =>
                                    onSelectPromptFolder?.(
                                      folder.relativeFolder,
                                    )
                                  }
                                >
                                  {breadcrumb(folder.relativeFolder)}
                                </button>
                              </td>
                              <td className="mono">{folder.lineCount}</td>
                              <td className="mono">
                                {folder.walksFromFolder.toLocaleString()}
                              </td>
                              <td className="hint">
                                {folder.topKeys.length === 0
                                  ? '—'
                                  : folder.topKeys
                                      .slice(0, 5)
                                      .map((t) => `${t.key} (${t.hits})`)
                                      .join(', ')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <p className="hint">
                  Coverage walks every decoded prompt in every `!gen.txt`
                  (`iterations` Monte Carlo expansions per line) and reports which
                  wildcard files are never reached or over-used. Results are saved
                  to the wildcards sidecar as `prompt-coverage.json`.
                </p>
              )}
            </>
          )}

          {error ? <p className="error-text">{error}</p> : null}
          {progress?.status === 'cancelled' && !running ? (
            <p className="hint">
              Last run was cancelled
              {report?.status === 'done'
                ? ' — showing the previous completed report.'
                : ' (partial stats in memory).'}
            </p>
          ) : null}
        </div>

        {maximized ? null : (
          <div
            className="prompt-coverage-resize-handle"
            title="Drag to resize"
            {...resizePointerProps}
          />
        )}
      </div>
    </div>
  );
}
