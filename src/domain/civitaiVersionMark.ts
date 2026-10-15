/**
 * Pure matcher for “Mark as Downloaded” version/file rows.
 * Catalog snapshots often omit file ids — fileName / version fallbacks matter.
 */

export type VersionMark = {
  versionId: number;
  fileId: number;
  fileName?: string;
};

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
