import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the app icon on disk (dev: repo `resources/`, packaged: extraResources).
 * Prefers `.ico` on Windows for sharper taskbar scaling.
 */
export function resolveAppIconPath(): string | undefined {
  const names =
    process.platform === 'win32'
      ? ['icon.ico', 'icon.png']
      : ['icon.png', 'icon.ico'];
  const dirs = [
    path.join(process.resourcesPath),
    path.join(__dirname, '../../resources'),
    path.join(app.getAppPath(), 'resources'),
  ];
  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        if (fs.existsSync(file)) return file;
      } catch {
        // try next
      }
    }
  }
  return undefined;
}
