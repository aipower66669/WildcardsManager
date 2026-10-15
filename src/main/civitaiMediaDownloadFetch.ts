import {
  isCivitaiMediaMovedNotFound,
  rewriteCivitaiOriginalTrueFallback,
} from '../domain/civitaiMediaOriginRetry.js';

export type CivitaiMediaFetchResult = {
  response: Response;
  url: string;
  retried: boolean;
};

/**
 * Fetch a community image/video file. If `original=true` 404s on the B2
 * cache, retry once with `width=N` on the same image.civitai.com host.
 */
export async function fetchCivitaiCommunityMedia(
  url: string,
  init: RequestInit,
  onRetry?: (nextUrl: string) => void,
  pixelWidth?: number,
): Promise<CivitaiMediaFetchResult> {
  const requestInit: RequestInit = { ...init, redirect: 'follow' };
  const first = await fetch(url, requestInit);
  const fallback = rewriteCivitaiOriginalTrueFallback(url, pixelWidth);
  if (!fallback) return { response: first, url, retried: false };

  let body = '';
  if (!first.ok) {
    body = await first.clone().text().catch(() => '');
  }
  const shouldRetry = isCivitaiMediaMovedNotFound({
    status: first.status,
    body,
    contentType: first.headers.get('content-type'),
  });
  if (!shouldRetry) return { response: first, url, retried: false };

  try {
    await first.body?.cancel();
  } catch {
    // ignore
  }
  onRetry?.(fallback);
  const second = await fetch(fallback, requestInit);
  return { response: second, url: fallback, retried: true };
}
