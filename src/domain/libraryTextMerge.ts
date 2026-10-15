/**
 * Merge an on-disk library buffer with the live editor buffer when both may
 * have diverged from a shared `saved` baseline (e.g. LoRA download append vs
 * unsaved typing).
 *
 * Append-compatible races keep live edits and pull in disk suffixes.
 * Structural rewrites (convert-to-child, absorb, rename body, …) prefer disk —
 * never write the pre-mutation editor buffer back over an authoritative mutation.
 */
export function mergeLibraryTextBuffers(
  live: string,
  disk: string,
  saved: string,
): string {
  if (live === disk) return live;

  // Disk is live plus a suffix.
  // Unchanged disk + shorter live = user deleted. Grown disk = external append.
  if (disk.startsWith(live)) {
    return disk === saved ? live : disk;
  }
  // User typed past the disk snapshot (save/append race).
  if (live.startsWith(disk)) return live;

  const liveTrimmed = live.replace(/\s+$/u, '');
  if (liveTrimmed.length > 0 && disk.startsWith(liveTrimmed)) {
    return disk === saved ? live : disk;
  }

  if (saved.length > 0 && disk.startsWith(saved) && live.startsWith(saved)) {
    const diskSuffix = disk.slice(saved.length);
    const trimmedSuffix = diskSuffix.replace(/^\s+/u, '').trimEnd();
    if (!trimmedSuffix) return live;
    if (live.includes(trimmedSuffix)) return live;
    let base = liveTrimmed;
    if (base.length > 0) base += '\n\n';
    return `${base}${trimmedSuffix}\n`;
  }

  // Disk still matches the last-known save — only the editor moved (typing /
  // mid-string delete). Keep live.
  if (disk === saved) return live;

  // Structural rewrite (convert-to-child, absorb, …) — disk is authoritative.
  // Preferring live here previously let openRoot/flush restore the old parent
  // body over the new `__child__` pointer.
  return disk;
}

export type EditorSaveResolution =
  | { action: 'noop'; writtenText: string }
  | { action: 'notify'; writtenText: string }
  | { action: 'write'; writtenText: string };

/**
 * Decide what an editor save should do given the current disk buffer.
 * Never write a shorter/older buffer over a disk file that grew (LoRA append)
 * or was structurally rewritten (convert-to-child, etc.).
 * Do write when disk is still the save baseline — the user deleted text.
 */
export function resolveEditorSaveAgainstDisk(
  text: string,
  disk: string,
  basedOn?: string,
): EditorSaveResolution {
  if (disk === text) return { action: 'noop', writtenText: disk };

  const trimmed = text.replace(/\s+$/u, '');
  const diskExtendsText =
    disk.startsWith(text) ||
    (trimmed.length > 0 && disk.startsWith(trimmed));

  if (diskExtendsText) {
    // Disk grew under us (append). Don't write the shorter editor buffer.
    if (basedOn !== undefined && disk !== basedOn) {
      return { action: 'notify', writtenText: disk };
    }
    // Disk is still the baseline the editor started from — this is a delete.
    return { action: 'write', writtenText: text };
  }

  if (basedOn !== undefined && disk !== basedOn) {
    const merged = mergeLibraryTextBuffers(text, disk, basedOn);
    if (merged === disk) return { action: 'notify', writtenText: disk };
    return { action: 'write', writtenText: merged };
  }

  return { action: 'write', writtenText: text };
}
