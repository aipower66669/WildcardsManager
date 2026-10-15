import path from 'node:path';

/**
 * Pick a basename that does not collide with an existing file in `folder`.
 * `photo.jpg` → `photo.jpg`, or `photo (1).jpg`, `photo (2).jpg`, …
 */
export function uniqueDestFileName(
  folder: string,
  desiredFileName: string,
  exists: (absolutePath: string) => boolean,
): { fileName: string; absolutePath: string; renamed: boolean } {
  const base = path.basename(desiredFileName.trim() || 'download.bin');
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const safeStem = stem.trim() || 'download';
  const safeExt = ext;

  let fileName = `${safeStem}${safeExt}`;
  let absolutePath = path.join(folder, fileName);
  if (!exists(absolutePath)) {
    return { fileName, absolutePath, renamed: false };
  }

  for (let n = 1; n < 10_000; n += 1) {
    fileName = `${safeStem} (${n})${safeExt}`;
    absolutePath = path.join(folder, fileName);
    if (!exists(absolutePath)) {
      return { fileName, absolutePath, renamed: true };
    }
  }

  // Extremely unlikely — fall back to timestamp suffix.
  fileName = `${safeStem} (${Date.now()})${safeExt}`;
  absolutePath = path.join(folder, fileName);
  return { fileName, absolutePath, renamed: true };
}

/** Sanitize a base-model label for use as a single path segment. */
export function safeBaseModelDirName(baseModel: string | null | undefined): string {
  const raw = (baseModel ?? '').trim() || '_unknown';
  const cleaned = raw
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/[/\\]+/g, '-')
    .replace(/\.+$/g, '')
    .trim();
  return cleaned || '_unknown';
}
