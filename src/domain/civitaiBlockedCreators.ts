/** Normalize a Civitai creator username for block-list matching. */
export function normalizeCivitaiCreatorUsername(
  username: string | null | undefined,
): string {
  return (username ?? '').trim().toLowerCase();
}

/** True when `creator` matches a blocked username (case-insensitive). */
export function isCivitaiCreatorBlocked(
  creator: string | null | undefined,
  blockedUsernames: ReadonlySet<string> | Iterable<string>,
): boolean {
  const key = normalizeCivitaiCreatorUsername(creator);
  if (!key) return false;
  if (blockedUsernames instanceof Set) return blockedUsernames.has(key);
  for (const entry of blockedUsernames) {
    if (normalizeCivitaiCreatorUsername(entry) === key) return true;
  }
  return false;
}
