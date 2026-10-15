/**
 * Last-output preview as a short privileged URL.
 * Image bytes stay on disk and are streamed to the renderer — they are not
 * copied through IPC as base64 (that stalled the main process at job start,
 * which overlaps ComfyUI "Model Initializing").
 */
import { app, net, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const GENERATION_PREVIEW_SCHEME = 'wcm-gen';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

let previewAbsolutePath: string | null = null;
let previewVersion = 0;

/** Must be called before app ready. */
export function registerGenerationPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: GENERATION_PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/** Must be called after app ready. Serves only the one remembered preview file. */
export function registerGenerationPreviewProtocolHandler(): void {
  protocol.handle(GENERATION_PREVIEW_SCHEME, () => {
    const file = previewAbsolutePath;
    if (!file) return new Response('Not found', { status: 404 });
    const ext = path.extname(file).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) return new Response('Not found', { status: 404 });
    try {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(file).href);
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

/** Point the preview at an existing image file. Returns a cache-busted URL. */
export function generationPreviewUrlForFile(absolutePath: string): string {
  previewAbsolutePath = path.resolve(absolutePath);
  previewVersion += 1;
  return `${GENERATION_PREVIEW_SCHEME}://preview/${previewVersion}`;
}

/** Stop serving a preview file (after the last output is deleted). */
export function clearGenerationPreviewFile(): void {
  previewAbsolutePath = null;
  previewVersion += 1;
}

/**
 * Comfy `/view` fallback when the workflow did not write a local file.
 * One file in app data, replaced each time — not a growing preview cache.
 */
export async function generationPreviewUrlForBytes(
  bytes: Buffer,
  ext: string,
): Promise<string> {
  const normalized = ext.toLowerCase();
  const safeExt = IMAGE_EXTS.has(normalized) ? normalized : '.png';
  const dest = path.join(app.getPath('userData'), `generation-view-fallback${safeExt}`);
  await fs.promises.writeFile(dest, bytes);
  return generationPreviewUrlForFile(dest);
}
