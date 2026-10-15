/**
 * Utility dirs under library roots — mirrored from librarySidecarPaths so this
 * module stays browser-safe (renderer must not import node:crypto).
 */
const LIBRARY_UTILITY_DIR_NAMES = new Set([
  '!.wcm',
  '!Cache',
  '!Thumbnails',
]);

/** Staging folder for new generations — not a prompt category. */
const REVIEW_SUBFOLDER = 'new';

/**
 * Prompt-tree folders that are not user categories: dot-folders, the review
 * `new` folder, and app sidecars (`!.wcm`, `!Cache`, `!Thumbnails`).
 */
export function isSkippedPromptFolderName(name: string): boolean {
  if (!name || name.startsWith('.')) return true;
  if (name.toLowerCase() === REVIEW_SUBFOLDER) return true;
  return LIBRARY_UTILITY_DIR_NAMES.has(name);
}
