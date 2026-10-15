/**
 * Registry of failed Civitai media card thumbnails so the Images/Videos toolbar
 * can Retry all of them in one click.
 */

type RetryFn = () => void;
type Listener = () => void;

const failed = new Map<string, RetryFn>();
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to failed-thumb count changes (for toolbar enablement). */
export function subscribeFailedCivitaiThumbs(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFailedCivitaiThumbCount(): number {
  return failed.size;
}

/**
 * Register a retry callback while this thumb is in the failed state.
 * Returns an unregister function (call on recover / unmount / new failure fn).
 */
export function registerFailedCivitaiThumb(
  key: string,
  retry: RetryFn,
): () => void {
  failed.set(key, retry);
  notify();
  return () => {
    if (failed.get(key) === retry) {
      failed.delete(key);
      notify();
    }
  };
}

/** Fire every registered Retry (same path as the per-card button). */
export function retryAllFailedCivitaiThumbs(): number {
  const retries = [...failed.values()];
  for (const retry of retries) retry();
  return retries.length;
}
