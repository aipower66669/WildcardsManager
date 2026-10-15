import { memo, useEffect, useState, type ReactNode } from 'react';
import type { CivitaiDownloadProgressDto } from '../shared/contracts';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

type SlimProgress = Pick<
  CivitaiDownloadProgressDto,
  | 'modelId'
  | 'fileName'
  | 'modelName'
  | 'receivedBytes'
  | 'totalBytes'
  | 'statusMessage'
  | 'error'
  | 'pauseReason'
  | 'done'
>;

function progressPct(p: SlimProgress | null): number | null {
  if (!p?.totalBytes || p.totalBytes <= 0) return null;
  return Math.min(100, Math.round((p.receivedBytes / p.totalBytes) * 100));
}

type Props = {
  activeDownloadId: number | null;
  activeDownloadLabel: string | null;
  queuedCount: number;
  firstQueuedName?: string | null;
  paused: boolean;
  onOpenQueue: () => void;
  /** Rendered between the progress line and the queue button (e.g. spinner). */
  afterBar?: ReactNode;
};

/**
 * Owns byte-progress subscription so the heavy Browse modal does not re-render
 * on every throttled tick.
 */
export const CivitaiDownloadProgressHud = memo(function CivitaiDownloadProgressHud({
  activeDownloadId,
  activeDownloadLabel,
  queuedCount,
  firstQueuedName,
  paused,
  onOpenQueue,
  afterBar,
}: Props) {
  const [progress, setProgress] = useState<SlimProgress | null>(null);

  useEffect(() => {
    return window.wcm.civitai.onDownloadProgress((p) => {
      const activeId = p.activeModelId ?? null;
      if (activeId == null && (p.queuedCount ?? 0) === 0 && !p.error) {
        setProgress(null);
        return;
      }
      const statusText = p.error ?? p.statusMessage ?? p.pauseReason;
      if (activeId != null && p.modelId !== activeId && !p.fileName && !statusText) {
        setProgress({
          modelId: activeId,
          modelName: p.activeModelName ?? p.modelName,
          fileName: 'Starting…',
          receivedBytes: 0,
          totalBytes: null,
          done: false,
        });
        return;
      }
      if (!(p.fileName || statusText || p.modelId === activeId)) return;

      setProgress((prev) => {
        const next: SlimProgress = {
          modelId: p.modelId,
          fileName: p.fileName,
          modelName: p.modelName,
          receivedBytes: p.receivedBytes,
          totalBytes: p.totalBytes,
          statusMessage: p.statusMessage,
          error: p.error,
          pauseReason: p.pauseReason,
          done: p.done,
        };
        if (!prev) return next;
        if (prev.modelId !== next.modelId) return next;
        if (prev.fileName !== next.fileName) return next;
        if (prev.statusMessage !== next.statusMessage) return next;
        if (prev.error !== next.error) return next;
        if (prev.pauseReason !== next.pauseReason) return next;
        if (Boolean(prev.done) !== Boolean(next.done)) return next;
        // Skip re-render unless the displayed percent actually moves.
        if (progressPct(prev) === progressPct(next)) return prev;
        return next;
      });
    });
  }, []);

  const isDownloading = activeDownloadId !== null || queuedCount > 0;
  if (!isDownloading) return null;

  const activeProgress =
    progress &&
    activeDownloadId !== null &&
    progress.modelId === activeDownloadId
      ? progress
      : null;
  const pct =
    activeProgress &&
    activeProgress.totalBytes &&
    activeProgress.totalBytes > 0
      ? progressPct(activeProgress)
      : null;
  const downloadBytesLabel =
    activeProgress &&
    (activeProgress.receivedBytes > 0 || activeProgress.totalBytes)
      ? `${formatBytes(activeProgress.receivedBytes)}${
          activeProgress.totalBytes && activeProgress.totalBytes > 0
            ? ` / ${formatBytes(activeProgress.totalBytes)}`
            : ''
        }`
      : null;

  const downloadStatusText = [
    paused ? 'Paused' : activeDownloadId !== null ? 'Downloading' : 'Queued',
    activeDownloadLabel ??
      activeProgress?.modelName ??
      firstQueuedName ??
      'model',
    paused
      ? activeProgress?.error?.trim() ||
        activeProgress?.pauseReason?.trim() ||
        'resume or auto-retry ~1m'
      : activeProgress?.error?.trim() ||
        (pct !== null
          ? `${pct}%`
          : activeProgress?.statusMessage?.trim() ||
            (activeDownloadId !== null ? 'Starting…' : null)),
    paused ? null : downloadBytesLabel,
    !paused &&
    activeProgress?.fileName &&
    activeProgress.fileName !== 'Starting…' &&
    activeDownloadLabel &&
    activeProgress.fileName !== activeDownloadLabel
      ? `(${activeProgress.fileName})`
      : null,
    queuedCount > 0 ? `(${queuedCount} queued)` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div
        className={`status-bar-progress-line${pct === null ? ' indeterminate' : ''}`}
        aria-hidden
      >
        <div
          className="status-bar-progress-fill"
          style={pct !== null ? { width: `${pct}%` } : undefined}
        />
      </div>
      {afterBar}
      <button
        type="button"
        className="status-bar-message status-bar-queue-btn"
        title={`${downloadStatusText} — click to manage queue`}
        onClick={onOpenQueue}
      >
        {downloadStatusText}
      </button>
    </>
  );
});
