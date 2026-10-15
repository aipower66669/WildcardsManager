import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { RefreshCw } from 'lucide-react';
import {
  civitaiSizedPreviewUrl,
  civitaiVideoPosterUrl,
} from '../shared/civitaiPreviewUrl';
import { registerFailedCivitaiThumb } from '../shared/civitaiMediaThumbRetryRegistry';

/**
 * Browse / Downloaded card thumbnail for Civitai Images & Videos.
 *
 * Normal load: direct CDN URL + native lazy loading (same as before the queue).
 * Retry: main-process download into the preview cache (bypasses Chromium’s
 * cached failure for a remount of the same CDN URL).
 */
export function CivitaiMediaCardThumb({
  mediaUrl,
  isVideo,
  children,
}: {
  /** Raw Civitai media URL from the API / download record. */
  mediaUrl: string;
  isVideo: boolean;
  /** Badges (Saved / Archived) rendered over the thumb. */
  children?: ReactNode;
}) {
  const thumbUrl = useMemo(
    () =>
      isVideo
        ? civitaiVideoPosterUrl(mediaUrl, 450)
        : civitaiSizedPreviewUrl(mediaUrl, 450),
    [isVideo, mediaUrl],
  );

  /** After a successful Retry — local cache URL only (never used for first paint). */
  const [recoveredSrc, setRecoveredSrc] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    setRecoveredSrc(null);
    setBroken(false);
    setBusy(false);
    busyRef.current = false;
  }, [thumbUrl]);

  const displaySrc = recoveredSrc ?? thumbUrl;

  const retry = useCallback(() => {
    if (busyRef.current || !thumbUrl) return;
    busyRef.current = true;
    setBusy(true);
    setBroken(false);
    void (async () => {
      try {
        let local = await window.wcm.civitai.refreshPreview(thumbUrl);
        if (!local) {
          local = await window.wcm.civitai.cachePreview(thumbUrl);
        }
        if (local) {
          const sep = local.includes('?') ? '&' : '?';
          setRecoveredSrc(`${local}${sep}t=${Date.now()}`);
          setBroken(false);
          return;
        }
        setBroken(true);
      } catch {
        setBroken(true);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, [thumbUrl]);

  useEffect(() => {
    if (!broken || busy || !thumbUrl) return;
    return registerFailedCivitaiThumb(thumbUrl, retry);
  }, [broken, busy, thumbUrl, retry]);

  const onRetryClick = (event: {
    preventDefault(): void;
    stopPropagation(): void;
  }) => {
    event.preventDefault();
    event.stopPropagation();
    retry();
  };

  return (
    <div
      className={`civitai-image-thumb${broken ? ' is-broken' : ''}${busy ? ' is-busy' : ''}`}
    >
      {!broken && !busy ? (
        <>
          <img
            key={displaySrc}
            src={displaySrc}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            onLoad={() => setBroken(false)}
          />
          {isVideo ? (
            <video
              className="civitai-video-preview"
              src={mediaUrl}
              poster={displaySrc}
              muted
              loop
              playsInline
              preload="none"
              onMouseEnter={(e) => {
                void e.currentTarget.play().catch(() => {
                  // Autoplay / decode failures — poster remains visible.
                });
              }}
              onMouseLeave={(e) => {
                e.currentTarget.pause();
                e.currentTarget.currentTime = 0;
              }}
            />
          ) : null}
        </>
      ) : (
        <div className="civitai-image-thumb-failed">
          <span>{busy ? 'Fetching…' : 'Thumbnail failed'}</span>
          {!busy ? (
            <button
              type="button"
              className="civitai-image-thumb-retry"
              title="Re-fetch thumbnail via app cache"
              aria-label="Re-fetch thumbnail"
              onClick={onRetryClick}
            >
              <RefreshCw size={14} />
              Retry
            </button>
          ) : (
            <RefreshCw size={16} className="spin" aria-hidden />
          )}
        </div>
      )}
      {!broken && !busy ? (
        <div className="civitai-image-thumb-actions">
          <button
            type="button"
            className="civitai-thumb-action"
            title="Re-fetch thumbnail"
            aria-label="Re-fetch thumbnail"
            onClick={onRetryClick}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}
