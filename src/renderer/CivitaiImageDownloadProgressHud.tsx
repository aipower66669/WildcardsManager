import { memo, useEffect, useState } from 'react';
import type { CivitaiImageDownloadProgressDto } from '../shared/contracts';

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

/**
 * Image/video download progress for the bottom status bar (never inline above the grid).
 * Serial queue — one active transfer, optional waiting count.
 */
export const CivitaiImageDownloadProgressHud = memo(
  function CivitaiImageDownloadProgressHud({
    kind = 'image',
  }: {
    kind?: 'image' | 'video';
  }) {
    const [progress, setProgress] =
      useState<CivitaiImageDownloadProgressDto | null>(null);
    const noun = kind === 'video' ? 'video' : 'image';

    useEffect(() => {
      const subscribe =
        kind === 'video'
          ? window.wcm.civitai.onVideoDownloadProgress
          : window.wcm.civitai.onImageDownloadProgress;
      return subscribe((p) => {
        if (p.done && !p.error && (p.queuedCount ?? 0) === 0) {
          setProgress(null);
          return;
        }
        if (p.imageId === 0 && p.done && (p.queuedCount ?? 0) === 0) {
          setProgress(null);
          return;
        }
        // Keep showing the last active tick while the next job starts.
        if (p.error && (p.queuedCount ?? 0) === 0 && p.done) {
          setProgress(null);
          return;
        }
        if (p.error) return;
        setProgress(p);
      });
    }, [kind]);

    if (!progress || (progress.done && (progress.queuedCount ?? 0) === 0)) {
      return null;
    }

    const pct =
      !progress.done &&
      progress.phase === 'active' &&
      progress.totalBytes &&
      progress.totalBytes > 0
        ? Math.min(
            100,
            Math.round((progress.receivedBytes / progress.totalBytes) * 100),
          )
        : null;
    const queued = progress.queuedCount ?? 0;
    const text = [
      progress.phase === 'queued'
        ? `Queued ${noun} #${progress.imageId}`
        : progress.statusMessage?.trim() ||
          `Downloading ${noun} #${progress.imageId}`,
      pct != null ? `${pct}%` : null,
      progress.phase === 'active'
        ? `${formatBytes(progress.receivedBytes)}${
            progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ''
          }`
        : null,
      progress.fileName && progress.phase === 'active'
        ? `(${progress.fileName})`
        : null,
      queued > 0 ? `${queued} queued` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <>
        <div
          className={`status-bar-progress-line${
            progress.phase === 'active' && pct === null ? ' indeterminate' : ''
          }`}
          aria-hidden
        >
          <div
            className="status-bar-progress-fill"
            style={
              pct != null
                ? { width: `${pct}%` }
                : progress.phase === 'queued'
                  ? { width: '8%' }
                  : undefined
            }
          />
        </div>
        <span className="status-bar-message" title={text}>
          {text}
        </span>
      </>
    );
  },
);
