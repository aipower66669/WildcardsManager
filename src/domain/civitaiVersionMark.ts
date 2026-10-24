/**
 * Pure matcher for “Mark as Downloaded” version/file rows.
 * Catalog snapshots often omit file ids — fileName / version fallbacks matter.
 */

export type VersionMark = {
  versionId: number;
  fileId: number;
  fileName?: string;
};

/**
 * Version/file rows to record for “All current versions”.
 * Early-access rows are omitted. A version that is not in `picks` is not marked.
 */
export function versionMarksForCurrentPicks(
  picks: Array<{
    versionId: number;
    fileId?: number | null;
    fileName?: string | null;
    earlyAccess?: boolean;
  }>,
): VersionMark[] {
  const out: VersionMark[] = [];
  const seen = new Set<string>();
  for (const pick of picks) {
    if (pick.earlyAccess) continue;
    if (!Number.isFinite(pick.versionId)) continue;
    const versionId = Math.round(pick.versionId);
    const fileId =
      typeof pick.fileId === 'number' && Number.isFinite(pick.fileId)
        ? Math.round(pick.fileId)
        : 0;
    const fileName = pick.fileName?.trim() || undefined;
    const key = `${versionId}:${fileId}:${(fileName ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ versionId, fileId, fileName });
  }
  return out;
}

export function versionFileIsMarkedInstalled(
  marks: VersionMark[],
  versionId: number,
  fileId?: number | null,
  fileName?: string | null,
): boolean {
  const vid = Math.round(versionId);
  const fid =
    typeof fileId === 'number' && Number.isFinite(fileId)
      ? Math.round(fileId)
      : null;
  const name = fileName?.trim().toLowerCase() || '';
  const forVersion = marks.filter((m) => m.versionId === vid);
  if (forVersion.length === 0) return false;
  for (const m of forVersion) {
    if (fid != null && fid !== 0 && m.fileId === fid) return true;
    if (name && m.fileName?.trim().toLowerCase() === name) return true;
    if (m.fileId === 0) return true;
  }
  if (fid == null || fid === 0) return true;
  return false;
}
