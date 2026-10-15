/**
 * Community file URLs stay on image.civitai.com. The /images/{id} *page*
 * moved (.com → .red); that is not the download URL.
 *
 * `original=true` 301s to image-b2 `/original` and 404s for media Civitai
 * has not cached there. Sized / optimized transforms still work. Retry
 * once by swapping that transform — never a second time.
 */

export function isHtmlContentType(contentType: string | null | undefined): boolean {
  return (contentType ?? '').toLowerCase().includes('text/html');
}

/** 404 JSON: `{ code: "not_found", message: "File with such name does not exist." }` */
export function isCivitaiMediaMovedNotFound(opts: {
  status: number;
  body?: string;
  contentType?: string | null;
}): boolean {
  if (opts.status !== 404) return false;
  const body = (opts.body ?? '').toLowerCase();
  if (!body) return true;
  return body.includes('not_found') || body.includes('does not exist');
}

/**
 * Replace a bare `original=true` path segment with `width=N` (JPEG, not WebP).
 * Returns null when there is nothing to change.
 */
export function rewriteCivitaiOriginalTrueFallback(
  url: string,
  pixelWidth?: number,
): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!/\.civitai\.com$/i.test(parsed.hostname)) return null;

  const parts = parsed.pathname.split('/');
  const idx = parts.findIndex((part) => /^original=true$/i.test(part));
  if (idx < 0) return null;

  const width =
    typeof pixelWidth === 'number' &&
    Number.isFinite(pixelWidth) &&
    pixelWidth >= 1
      ? Math.round(pixelWidth)
      : 4096;
  parts[idx] = `width=${width}`;
  parsed.pathname = parts.join('/');
  return parsed.toString();
}
