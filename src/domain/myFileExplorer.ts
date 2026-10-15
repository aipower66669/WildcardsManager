/**
 * My File Explorer (`mfe://`) — replaces Windows Explorer for reveal / open.
 * The handler is registered in the Windows registry; we only emit the URL.
 */

export type MyFileExplorerMode = 'reveal' | 'open';

/** `mfe://reveal?path=` or `mfe://open?path=` with an encoded filesystem path. */
export function myFileExplorerUrl(
  mode: MyFileExplorerMode,
  fsPath: string,
): string {
  const trimmed = fsPath.trim();
  if (!trimmed) throw new Error('Empty path');
  return `mfe://${mode}?path=${encodeURIComponent(trimmed)}`;
}
