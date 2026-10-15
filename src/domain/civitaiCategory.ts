/**
 * Relative folder under a model root (one or more path segments).
 * Rejects traversal (`..`), absolute paths, and Windows-illegal characters.
 */
export function sanitizeDownloadCategoryName(name: string): string {
  const trimmed = name.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!trimmed || trimmed.includes('..')) return '';
  const parts = trimmed.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) return '';
  for (const part of parts) {
    if (part === '.' || part === '..') return '';
    if (/[<>:"|?*]/.test(part)) return '';
  }
  return parts.join('/');
}


export function isSafeCategoryRelativePath(relative: string): boolean {
  return (
    relative.length > 0 &&
    !relative.startsWith('..') &&
    !relative.includes('..')
  );
}

/**
 * Turn an absolute folder path into a sanitized path relative to `rootFolder`.
 * Returns null if the pick is the root itself, outside the root, or invalid.
 */
export function relativeFolderUnderRoot(
  rootFolder: string,
  absoluteFolder: string,
): string | null {
  const root = rootFolder.trim().replace(/\\/g, '/').replace(/\/+$/g, '');
  const picked = absoluteFolder.trim().replace(/\\/g, '/').replace(/\/+$/g, '');
  if (!root || !picked) return null;

  // Case-insensitive compare on Windows-style paths.
  const rootLower = root.toLowerCase();
  const pickedLower = picked.toLowerCase();
  if (pickedLower === rootLower) return null;
  if (!pickedLower.startsWith(`${rootLower}/`)) return null;

  const relative = picked.slice(root.length).replace(/^\/+/g, '');
  return sanitizeDownloadCategoryName(relative) || null;
}

