import { BrowserWindow } from 'electron';
import type { LoraWildcardBufferOp } from '../domain/loraDownloadCategory.js';

/**
 * Ask the renderer for the live open-editor buffer for a path.
 * Falls back to null when no window / file not open / bridge unavailable.
 */
export async function requestOpenFileLiveText(
  relativePath: string,
): Promise<string | null> {
  const normalized = relativePath.replace(/\\/g, '/');
  const script = `(function () {
    try {
      const fn = window.__wcmGetOpenFileLiveText;
      if (typeof fn !== 'function') return null;
      const text = fn(${JSON.stringify(normalized)});
      return typeof text === 'string' ? text : null;
    } catch {
      return null;
    }
  })()`;

  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      const text = await win.webContents.executeJavaScript(script, true);
      if (typeof text === 'string') return text;
    } catch {
      // try next window
    }
  }
  return null;
}

export type OpenFileApplyResult = {
  before: string;
  text: string;
  changed: boolean;
};

/**
 * Apply a LoRA category op to the live editor on the UI thread (atomic vs
 * typing). Returns null when the file is not open or the bridge is missing.
 */
export async function requestOpenFileApplyOp(
  relativePath: string,
  op: LoraWildcardBufferOp,
): Promise<OpenFileApplyResult | null> {
  const normalized = relativePath.replace(/\\/g, '/');
  const script = `(function () {
    try {
      const fn = window.__wcmApplyOpenWildcardOp;
      if (typeof fn !== 'function') return null;
      const result = fn(${JSON.stringify(normalized)}, ${JSON.stringify(op)});
      if (!result || typeof result !== 'object') return null;
      if (typeof result.before !== 'string' || typeof result.text !== 'string') {
        return null;
      }
      return {
        before: result.before,
        text: result.text,
        changed: Boolean(result.changed),
      };
    } catch {
      return null;
    }
  })()`;

  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      const result = await win.webContents.executeJavaScript(script, true);
      if (result && typeof result === 'object' && typeof result.text === 'string') {
        return result as OpenFileApplyResult;
      }
    } catch {
      // try next window
    }
  }
  return null;
}
