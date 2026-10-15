import { memo, useEffect, useState } from 'react';
import type {
  CivitaiCatalogAutoV2BackfillProgressDto,
  CivitaiHashWarmProgressDto,
  CivitaiPreviewWarmProgressDto,
} from '../shared/contracts';

function sameHash(
  a: CivitaiHashWarmProgressDto | null,
  b: CivitaiHashWarmProgressDto,
): boolean {
  if (!a) return false;
  return (
    a.status === b.status &&
    a.done === b.done &&
    a.total === b.total &&
    a.hashedThisRun === b.hashedThisRun &&
    a.currentStem === b.currentStem &&
    a.error === b.error
  );
}

function sameBackfill(
  a: CivitaiCatalogAutoV2BackfillProgressDto | null,
  b: CivitaiCatalogAutoV2BackfillProgressDto,
): boolean {
  if (!a) return false;
  return (
    a.status === b.status &&
    a.done === b.done &&
    a.total === b.total &&
    a.patchedThisRun === b.patchedThisRun &&
    a.failedThisRun === b.failedThisRun &&
    a.error === b.error
  );
}

function samePreview(
  a: CivitaiPreviewWarmProgressDto | null,
  b: CivitaiPreviewWarmProgressDto,
): boolean {
  if (!a) return false;
  return (
    a.status === b.status &&
    a.done === b.done &&
    a.total === b.total &&
    a.fetchedThisRun === b.fetchedThisRun &&
    a.error === b.error
  );
}

type RematchProps = {
  onRematch: () => void;
  onFlashError: (message: string) => void;
};

/** Hash + catalog AutoV2 backfill status line — isolated from Browse modal. */
export const CivitaiBackgroundWarmStatus = memo(
  function CivitaiBackgroundWarmStatus({
    onRematch,
    onFlashError,
  }: RematchProps) {
    const [hashWarm, setHashWarm] =
      useState<CivitaiHashWarmProgressDto | null>(null);
    const [autoV2Backfill, setAutoV2Backfill] =
      useState<CivitaiCatalogAutoV2BackfillProgressDto | null>(null);

    useEffect(() => {
      return window.wcm.civitai.onHashWarmProgress((progress) => {
        if (progress.status === 'hashing') {
          setHashWarm((prev) => (sameHash(prev, progress) ? prev : progress));
          return;
        }
        if (progress.status === 'done' || progress.status === 'cancelled') {
          setHashWarm(null);
          if (progress.hashedThisRun > 0) onRematch();
          return;
        }
        if (progress.status === 'error') {
          setHashWarm(null);
          if (progress.error) onFlashError(progress.error);
        }
      });
    }, [onFlashError, onRematch]);

    useEffect(() => {
      return window.wcm.civitai.onCatalogAutoV2BackfillProgress((progress) => {
        if (progress.status === 'backfilling') {
          setAutoV2Backfill((prev) =>
            sameBackfill(prev, progress) ? prev : progress,
          );
          return;
        }
        if (progress.status === 'done' || progress.status === 'cancelled') {
          setAutoV2Backfill(null);
          if (progress.patchedThisRun > 0) onRematch();
          return;
        }
        if (progress.status === 'error') {
          setAutoV2Backfill(null);
          if (progress.error) onFlashError(progress.error);
        }
      });
    }, [onFlashError, onRematch]);

    const isHashing = hashWarm?.status === 'hashing';
    const hashText =
      isHashing && hashWarm && hashWarm.total > 0 && hashWarm.done > 0
        ? `Hashing local models… ${hashWarm.done.toLocaleString()}/${hashWarm.total.toLocaleString()}`
        : null;

    const isBackfilling = autoV2Backfill?.status === 'backfilling';
    const backfillText =
      isBackfilling &&
      autoV2Backfill &&
      autoV2Backfill.total > 0 &&
      autoV2Backfill.done > 0
        ? `Backfilling catalog hashes… ${autoV2Backfill.done.toLocaleString()}/${autoV2Backfill.total.toLocaleString()}${
            autoV2Backfill.patchedThisRun > 0
              ? ` · +${autoV2Backfill.patchedThisRun.toLocaleString()} saved`
              : ''
          }${
            autoV2Backfill.failedThisRun > 0
              ? ` · ${autoV2Backfill.failedThisRun.toLocaleString()} no hash`
              : ''
          }`
        : null;

    const text = hashText ?? backfillText;
    if (!text) return null;
    return (
      <span className="status-bar-message" title={text}>
        {text}
      </span>
    );
  },
);

type PreviewButtonProps = {
  onOpenDownloader: () => void;
};

/** Preview-warm title button — owns its IPC subscription. */
export const CivitaiPreviewWarmButton = memo(function CivitaiPreviewWarmButton({
  onOpenDownloader,
}: PreviewButtonProps) {
  const [previewWarm, setPreviewWarm] =
    useState<CivitaiPreviewWarmProgressDto | null>(null);

  useEffect(() => {
    return window.wcm.civitai.onPreviewWarmProgress((progress) => {
      // Strip payloads are ignored here — downloader panel fetches its own strip.
      if (progress.total > 0 && progress.done < progress.total) {
        setPreviewWarm((prev) =>
          samePreview(prev, progress) ? prev : progress,
        );
        return;
      }
      if (progress.status === 'caching' && progress.total > 0) {
        setPreviewWarm((prev) =>
          samePreview(prev, progress) ? prev : progress,
        );
        return;
      }
      if (progress.status === 'done') {
        setPreviewWarm(progress.total > 0 ? progress : null);
        window.setTimeout(() => {
          setPreviewWarm((current) =>
            current &&
            current.status === 'done' &&
            current.done >= current.total
              ? null
              : current,
          );
        }, 2500);
        return;
      }
      if (progress.status === 'cancelled') {
        setPreviewWarm(null);
        return;
      }
      if (progress.status === 'error') {
        setPreviewWarm(null);
      }
    });
  }, []);

  const titleText =
    previewWarm &&
    previewWarm.total > 0 &&
    previewWarm.done < previewWarm.total
      ? `Previews ${previewWarm.done.toLocaleString()}/${previewWarm.total.toLocaleString()}`
      : previewWarm &&
          previewWarm.status === 'done' &&
          previewWarm.total > 0
        ? `Previews ${previewWarm.total.toLocaleString()}/${previewWarm.total.toLocaleString()}`
        : null;

  if (!titleText) return null;
  return (
    <button
      type="button"
      className="civitai-head-preview-status"
      title={`Downloading model card previews… ${
        previewWarm
          ? `${previewWarm.done.toLocaleString()}/${previewWarm.total.toLocaleString()}`
          : ''
      } — click for visual downloader`}
      onClick={onOpenDownloader}
    >
      {titleText}
    </button>
  );
});
