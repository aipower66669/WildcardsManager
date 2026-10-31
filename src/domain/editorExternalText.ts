/**
 * The smallest edit that turns `current` into `next`.
 * A whole-document replace maps every caret inside the file to offset 0.
 */
export function editorExternalTextChange(
  current: string,
  next: string,
): { from: number; to: number; insert: string } | null {
  if (current === next) return null;

  let start = 0;
  const max = Math.min(current.length, next.length);
  while (start < max && current.charCodeAt(start) === next.charCodeAt(start)) {
    start += 1;
  }

  let currentEnd = current.length;
  let nextEnd = next.length;
  while (
    currentEnd > start &&
    nextEnd > start &&
    current.charCodeAt(currentEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    currentEnd -= 1;
    nextEnd -= 1;
  }

  return {
    from: start,
    to: currentEnd,
    insert: next.slice(start, nextEnd),
  };
}

/**
 * The parent `value` is behind the live document (a keystroke landed after
 * the snapshot). Applying it would wipe that keystroke and, as a full
 * replace, jump the caret to the start of the file.
 */
export function editorExternalValueIsStale(
  doc: string,
  committed: string,
  next: string,
): boolean {
  if (doc === next) return false;
  return doc !== committed;
}
