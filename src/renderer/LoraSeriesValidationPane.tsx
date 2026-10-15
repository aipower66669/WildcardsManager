import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LoraSeriesValidationSetDto } from '../shared/contracts.js';

function ValidationThumb({
  absolutePath,
  fileName,
  onOpen,
}: {
  absolutePath: string;
  fileName: string;
  onOpen: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    void window.wcm.modelFiles
      .readTrainingLibraryImage(absolutePath)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [absolutePath]);

  return (
    <button
      type="button"
      className="lora-series-val-thumb"
      title={fileName}
      onClick={onOpen}
    >
      {src ? (
        <img src={src} alt={fileName} loading="lazy" />
      ) : (
        <span className="lora-series-val-thumb-empty" />
      )}
    </button>
  );
}

type ViewerPos = {
  setIndex: number;
  imageIndex: number;
};

function clampImageIndex(
  sets: readonly LoraSeriesValidationSetDto[],
  setIndex: number,
  imageIndex: number,
): number {
  const count = sets[setIndex]?.images.length ?? 0;
  if (count <= 0) return 0;
  return Math.min(Math.max(0, imageIndex), count - 1);
}

function nextSetWithImages(
  sets: readonly LoraSeriesValidationSetDto[],
  fromSetIndex: number,
  delta: number,
): number | null {
  const n = sets.length;
  if (n === 0) return null;
  let idx = fromSetIndex;
  for (let i = 0; i < n; i++) {
    idx = (idx + delta + n * 10) % n;
    if ((sets[idx]?.images.length ?? 0) > 0) return idx;
  }
  return null;
}

type Props = {
  title: string;
  busy?: boolean;
  emptyHint: string;
  validationSets: LoraSeriesValidationSetDto[];
};

/** Right pane: validation-set image grids for a training-series dataset. */
export function LoraSeriesValidationPane({
  title,
  busy = false,
  emptyHint,
  validationSets,
}: Props) {
  const [viewer, setViewer] = useState<ViewerPos | null>(null);

  const viewerImage =
    viewer &&
    validationSets[viewer.setIndex]?.images[
      clampImageIndex(validationSets, viewer.setIndex, viewer.imageIndex)
    ];
  const viewerSet = viewer ? validationSets[viewer.setIndex] : null;

  useEffect(() => {
    if (!viewer) return;

    const moveImage = (delta: number) => {
      setViewer((pos) => {
        if (!pos) return pos;
        const images = validationSets[pos.setIndex]?.images ?? [];
        if (images.length === 0) return pos;
        const next =
          (pos.imageIndex + delta + images.length * 10) % images.length;
        return { ...pos, imageIndex: next };
      });
    };

    const moveSet = (delta: number) => {
      setViewer((pos) => {
        if (!pos) return pos;
        const nextSet = nextSetWithImages(validationSets, pos.setIndex, delta);
        if (nextSet == null) return pos;
        return {
          setIndex: nextSet,
          imageIndex: clampImageIndex(
            validationSets,
            nextSet,
            pos.imageIndex,
          ),
        };
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setViewer(null);
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveImage(-1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveImage(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSet(-1);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSet(1);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Shift+wheel often becomes deltaX on Windows; prefer the non-zero axis.
      const primary = e.shiftKey
        ? e.deltaY !== 0
          ? e.deltaY
          : e.deltaX
        : e.deltaY !== 0
          ? e.deltaY
          : e.deltaX;
      if (primary === 0) return;
      const delta = primary > 0 ? 1 : -1;
      if (e.shiftKey) moveSet(delta);
      else moveImage(delta);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onWheel);
    };
  }, [viewer, validationSets]);

  // Drop viewer if the underlying sets disappear / shrink out from under us.
  useEffect(() => {
    if (!viewer) return;
    const set = validationSets[viewer.setIndex];
    if (!set || set.images.length === 0) {
      setViewer(null);
      return;
    }
    if (viewer.imageIndex >= set.images.length) {
      setViewer({
        setIndex: viewer.setIndex,
        imageIndex: set.images.length - 1,
      });
    }
  }, [validationSets, viewer]);

  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!viewerImage) {
      setViewerSrc(null);
      return;
    }
    let cancelled = false;
    setViewerSrc(null);
    void window.wcm.modelFiles
      .readTrainingLibraryImage(viewerImage.absolutePath)
      .then((url) => {
        if (!cancelled) setViewerSrc(url);
      })
      .catch(() => {
        if (!cancelled) setViewerSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [viewerImage?.absolutePath]);

  const lightbox =
    viewer && viewerImage && viewerSet
      ? createPortal(
          <div
            className="lora-series-val-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="Validation image viewer"
            onClick={() => setViewer(null)}
          >
            <div className="lora-series-val-lightbox-meta">
              <span>
                {viewerSet.label}
                {' · '}
                {clampImageIndex(
                  validationSets,
                  viewer.setIndex,
                  viewer.imageIndex,
                ) + 1}
                /{viewerSet.images.length}
              </span>
              <span className="hint">
                ←→ images · ↑↓ sets · wheel / shift+wheel · click to close
              </span>
            </div>
            <div className="lora-series-val-lightbox-stage">
              {viewerSrc ? (
                <img
                  src={viewerSrc}
                  alt={viewerImage.fileName}
                  title={viewerImage.fileName}
                />
              ) : (
                <span className="hint">Loading…</span>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <section
      className="model-browser-panel lora-series-validation-pane"
      aria-label="Validation set images"
    >
      <div className="civitai-preview-bar">
        <strong title={title}>{title}</strong>
      </div>
      {busy && validationSets.length === 0 ? (
        <div className="civitai-preview-empty">
          <p>Looking up validation sets…</p>
        </div>
      ) : validationSets.length === 0 ? (
        <div className="civitai-preview-empty">
          <p>{emptyHint}</p>
        </div>
      ) : (
        <div className="lora-series-validation-scroll">
          {validationSets.map((set, setIndex) => (
            <section key={set.folderAbsolutePath} className="lora-series-val-set">
              <header className="lora-series-val-set-head">
                <strong
                  title={[
                    set.folderAbsolutePath,
                    set.prompt ? `Prompt: ${set.prompt}` : null,
                  ]
                    .filter(Boolean)
                    .join('\n')}
                >
                  {set.label}
                </strong>
                <span className="hint" title={set.folderAbsolutePath}>
                  {set.images.length} image{set.images.length === 1 ? '' : 's'}
                </span>
              </header>
              {set.images.length === 0 ? (
                <div className="hint pad lora-series-val-empty">
                  <p title={set.folderAbsolutePath}>No images in this set folder.</p>
                </div>
              ) : (
                <div className="lora-series-val-grid">
                  {set.images.map((img, imageIndex) => (
                    <ValidationThumb
                      key={img.absolutePath}
                      absolutePath={img.absolutePath}
                      fileName={img.fileName}
                      onOpen={() => setViewer({ setIndex, imageIndex })}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {lightbox}
    </section>
  );
}
