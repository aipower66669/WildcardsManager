import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';

type Props = {
  /** Absolute paths: hero first, then remaining samples. */
  imagePaths: string[];
  emptyHint?: string;
};

function wrapIndex(index: number, length: number, delta: number): number {
  if (length <= 0) return 0;
  return (index + delta + length * 20) % length;
}

/** Gallery body for Checkpoint Benchmark samples (parent supplies chrome/tabs). */
export function CheckpointBenchmarkPane({
  imagePaths,
  emptyHint = 'No Benchmark samples for this checkpoint yet. Run Generation → Benchmark to fill them.',
}: Props) {
  const [srcs, setSrcs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const paths = imagePaths.filter((p) => p.trim());
    if (paths.length === 0) {
      setSrcs([]);
      setBusy(false);
      setIndex(0);
      setLightbox(false);
      return;
    }
    setBusy(true);
    setSrcs([]);
    setIndex(0);
    setLightbox(false);
    void Promise.all(
      paths.map((abs) => window.wcm.modelFiles.readMasterImage(abs)),
    ).then((urls) => {
      if (cancelled) return;
      setSrcs(urls.filter((u): u is string => Boolean(u)));
      setBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [imagePaths]);

  useEffect(() => {
    if (srcs.length === 0) {
      setIndex(0);
      return;
    }
    if (index >= srcs.length) setIndex(srcs.length - 1);
  }, [srcs, index]);

  useEffect(() => {
    if (srcs.length === 0) return;

    const move = (delta: number) => {
      setIndex((i) => wrapIndex(i, srcs.length, delta));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const inStage =
        lightbox ||
        stageRef.current?.contains(document.activeElement) ||
        (e.target instanceof Node &&
          Boolean(stageRef.current?.contains(e.target)));
      if (!inStage && !lightbox) return;

      if (e.key === 'Escape' && lightbox) {
        e.preventDefault();
        setLightbox(false);
        return;
      }
      if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowUp' ||
        e.key === 'PageUp'
      ) {
        e.preventDefault();
        move(-1);
        return;
      }
      if (
        e.key === 'ArrowRight' ||
        e.key === 'ArrowDown' ||
        e.key === 'PageDown' ||
        e.key === ' '
      ) {
        e.preventDefault();
        move(1);
      }
    };

    const onWheel = (e: WheelEvent) => {
      const target = e.target;
      const overStage =
        lightbox ||
        (target instanceof Node &&
          Boolean(stageRef.current?.contains(target)));
      // Lightbox covers the whole window — always navigate while open.
      const overLightbox =
        lightbox &&
        target instanceof Element &&
        Boolean(target.closest('.lora-series-val-lightbox'));
      if (!overStage && !overLightbox) return;
      e.preventDefault();
      const primary =
        e.deltaY !== 0 ? e.deltaY : e.deltaX !== 0 ? e.deltaX : 0;
      if (primary === 0) return;
      move(primary > 0 ? 1 : -1);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onWheel);
    };
  }, [srcs.length, lightbox]);

  if (srcs.length === 0) {
    return (
      <div className="civitai-preview-empty">
        {busy ? (
          <p>
            <RefreshCw size={14} className="spin" /> Loading samples…
          </p>
        ) : (
          <p>{emptyHint}</p>
        )}
      </div>
    );
  }

  const current = srcs[index] ?? srcs[0]!;
  const label = `${index + 1}/${srcs.length}`;

  const stepFromClick = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    setIndex((i) => wrapIndex(i, srcs.length, clientX < mid ? -1 : 1));
  };

  const lightboxPortal = lightbox
    ? createPortal(
        <div
          className="lora-series-val-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Benchmark image viewer"
          onClick={() => setLightbox(false)}
        >
          <div className="lora-series-val-lightbox-meta">
            <span>Benchmark · {label}</span>
            <span className="hint">
              ←→ / ↑↓ / wheel · Esc or click outside to close
            </span>
          </div>
          <div
            className="lora-series-val-lightbox-stage"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={current}
              alt=""
              title="Click left/right half for previous/next"
              onClick={(e) => {
                e.stopPropagation();
                stepFromClick(e.clientX, e.currentTarget);
              }}
            />
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div
        ref={stageRef}
        className="checkpoint-benchmark-stage"
        tabIndex={0}
        role="region"
        aria-label="Benchmark samples"
        onMouseEnter={() => stageRef.current?.focus({ preventScroll: true })}
      >
        <div className="checkpoint-benchmark-hero">
          <button
            type="button"
            className="checkpoint-benchmark-hero-btn"
            title="Open larger viewer (←→ / ↑↓ / wheel)"
            onClick={() => setLightbox(true)}
          >
            <img src={current} alt="" className="checkpoint-benchmark-hero-img" />
          </button>
          <div className="checkpoint-benchmark-hero-meta">
            <span>{label}</span>
            <span className="hint">
              Click for large view · ←→ ↑↓ · wheel
            </span>
          </div>
        </div>
        {srcs.length > 1 ? (
          <div className="checkpoint-benchmark-strip" role="list">
            {srcs.map((src, i) => (
              <button
                key={`${i}-${src.slice(0, 32)}`}
                type="button"
                role="listitem"
                className={
                  i === index
                    ? 'checkpoint-benchmark-strip-btn is-active'
                    : 'checkpoint-benchmark-strip-btn'
                }
                aria-label={`Sample ${i + 1}`}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => {
                  setIndex(i);
                  setLightbox(true);
                }}
              >
                <img src={src} alt="" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {lightboxPortal}
    </>
  );
}
