import { shell } from 'electron';
import {
  myFileExplorerUrl,
  type MyFileExplorerMode,
} from '../domain/myFileExplorer.js';

/**
 * Open or reveal a path in My File Explorer (`mfe://`).
 * On non-Windows, fall back to Electron’s default file manager.
 */
export async function openInMyFileExplorer(
  mode: MyFileExplorerMode,
  fsPath: string,
): Promise<void> {
  const trimmed = fsPath.trim();
  if (!trimmed) throw new Error('Empty path');

  if (process.platform !== 'win32') {
    if (mode === 'reveal') {
      shell.showItemInFolder(trimmed);
      return;
    }
    const error = await shell.openPath(trimmed);
    if (error) throw new Error(error);
    return;
  }

  await shell.openExternal(myFileExplorerUrl(mode, trimmed));
}

export async function revealInMyFileExplorer(filePath: string): Promise<void> {
  await openInMyFileExplorer('reveal', filePath);
}

export async function openFolderInMyFileExplorer(
  folderPath: string,
): Promise<void> {
  await openInMyFileExplorer('open', folderPath);
}
