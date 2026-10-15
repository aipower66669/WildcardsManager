/**
 * Which `!gen.txt` folders sit under a selected prompts folder
 * (the folder itself when it has gen, plus descendants).
 */

export function normalizePromptFolderRel(relative: string): string {
  return relative.trim().replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Filter gen-folder relative paths to `parent` and its descendants.
 * Empty / missing parent → all folders (same as Randomize).
 */
export function genPromptFoldersUnder(
  allGenFolders: readonly string[],
  parentRelative: string,
): string[] {
  const parent = normalizePromptFolderRel(parentRelative);
  if (!parent) return allGenFolders.map((f) => normalizePromptFolderRel(f));
  const prefix = `${parent}/`;
  return allGenFolders
    .map((f) => normalizePromptFolderRel(f))
    .filter((rel) => rel === parent || rel.startsWith(prefix));
}
