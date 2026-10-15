import { memo, useEffect, useState, type CSSProperties } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import type {
  CivitaiPreviewDownloadStripDto,
  CivitaiPreviewStripCardDto,
} from '../shared/contracts';
import { modalOverlayDismiss } from './modalOverlayDismiss';

type Props = {
  open: boolean;
  onClose: () => void;
  cardMinWidth: number;
  adjustCardMinWidth: (delta: number) => void;
};

function renderPreviewStripCard(
  card: CivitaiPreviewStripCardDto | null,
  key: string,
  role: CivitaiPreviewStripCardDto['role'],
) {
  if (!card) {
    return (
      <article
        key={key}
        className={`civitai-card preview-strip-card preview-strip-card-${role} preview-strip-card-empty`}
        aria-hidden
      >
        <div className="civitai-thumb preview-strip-empty-thumb" />
        <div className="civitai-card-body">
          <strong>—</strong>
          <small>{role}</small>
        </div>
      </article>
    );
  }
  const localSrc =
    role === 'previous' && !card.previewMissing && card.previewUrl
      ? window.wcm.civitai.localPreviewUrl(card.previewUrl)
      : null;
  return (
    <article
      key={key}
      className={`civitai-card preview-strip-card preview-strip-card-${role}${
        role === 'current' ? ' downloading' : ''
      }`}
    >
      <div className="civitai-thumb">
        {localSrc ? (
          <img src={localSrc} alt="" loading="lazy" />
        ) : (
          <div className="preview-strip-pending-thumb" aria-hidden>
            {role === 'current' ? 'Downloading…' : 'Waiting…'}
          </div>
        )}
        <span className={`preview-strip-role preview-strip-role-${role}`}>
          {role === 'previous'
            ? 'Done'
            : role === 'current'
              ? 'Downloading'
              : 'Queued'}
        </span>
      </div>
      <div className="civitai-card-body">
        <strong title={card.name}>{card.name}</strong>
        <small>{card.creator ?? card.type}</small>
      </div>
    </article>
  );
}

/**
 * Visual preview-warm strip. Owns its own polling so the Browse modal does not
 * re-render when strip cards change.
 */
export const CivitaiPreviewDownloader = memo(function CivitaiPreviewDownloader({
  open,
  onClose,
  cardMinWidth,
  adjustCardMinWidth,
}: Props) {
  const [strip, setStrip] = useState<CivitaiPreviewDownloadStripDto | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const pull = () => {
      void window.wcm.civitai
        .getPreviewDownloadStrip()
        .then((next) => {
          if (!cancelled) setStrip(next);
        })
        .catch(() => {
          // best-effort
        });
    };
    pull();
    const timer = window.setInterval(pull, 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open]);

  if (!open) return null;

  const stripPrevious = strip?.previous ?? [];
  const stripNext = strip?.next ?? [];
  const stripPrevPadded: Array<CivitaiPreviewStripCardDto | null> = [
    ...Array.from({ length: Math.max(0, 3 - stripPrevious.length) }, () => null),
    ...stripPrevious.slice(-3),
  ];
  const stripNextPadded: Array<CivitaiPreviewStripCardDto | null> = [
    ...stripNext.slice(0, 3),
    ...Array.from({ length: Math.max(0, 3 - stripNext.length) }, () => null),
  ];

  return (
    <div
      className="modal-overlay preview-downloader-overlay"
      {...modalOverlayDismiss(onClose)}
    >
      <div
        className="modal preview-downloader-modal"
        style={
          {
            ['--civitai-card-min' as string]: `${cardMinWidth}px`,
          } as CSSProperties
        }
      >
        <header className="modal-head preview-downloader-head">
          <h2>Preview downloader</h2>
          <div className="preview-downloader-head-actions">
            <div
              className="civitai-card-zoom"
              role="group"
              aria-label="Card size"
            >
              <button
                type="button"
                className="civitai-icon-btn civitai-card-zoom-btn"
                title="Smaller cards"
                aria-label="Smaller cards"
                disabled={cardMinWidth <= 100}
                onClick={() => adjustCardMinWidth(-20)}
              >
                <Minus size={14} />
              </button>
              <span className="civitai-card-zoom-label" title="Card size">
                {cardMinWidth}px
              </span>
              <button
                type="button"
                className="civitai-icon-btn civitai-card-zoom-btn"
                title="Larger cards"
                aria-label="Larger cards"
                disabled={cardMinWidth >= 280}
                onClick={() => adjustCardMinWidth(20)}
              >
                <Plus size={14} />
              </button>
            </div>
            <button type="button" className="icon-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="modal-body preview-downloader-body">
          <p className="hint preview-downloader-hint">
            {(strip?.done ?? 0).toLocaleString()}
            {' / '}
            {(strip?.total ?? 0).toLocaleString()}
            {' active library models · middle card is downloading now'}
          </p>
          <div className="preview-downloader-row" role="list">
            {stripPrevPadded.map((card, i) =>
              renderPreviewStripCard(card, `prev-${card?.id ?? i}`, 'previous'),
            )}
            {renderPreviewStripCard(
              strip?.current ?? null,
              `current-${strip?.current?.id ?? 'none'}`,
              'current',
            )}
            {stripNextPadded.map((card, i) =>
              renderPreviewStripCard(card, `next-${card?.id ?? i}`, 'next'),
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
