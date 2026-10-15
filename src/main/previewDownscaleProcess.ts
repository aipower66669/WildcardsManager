/**
 * Dedicated Electron child entry for cover-crop JPEG generation.
 * Launched as `electron previewDownscaleProcess.js` so `nativeImage` is
 * available without blocking the app main process event loop.
 */
import { app } from 'electron';
import { downscalePreviewCover } from './previewDownscaleCompute.js';
import type {
  PreviewDownscaleRequest,
  PreviewDownscaleResponse,
} from './previewDownscaleCompute.js';

// Headless helper — never show a window / dock bounce.
app.disableHardwareAcceleration();
if (process.platform === 'darwin') {
  app.dock?.hide();
}
// Do not quit when no BrowserWindows exist (we never open any).
app.on('window-all-closed', () => {
  /* keep alive until parent kills us */
});

function reply(msg: PreviewDownscaleResponse): void {
  if (typeof process.send === 'function') {
    process.send(msg);
  }
}

function handle(msg: PreviewDownscaleRequest): void {
  try {
    const jpeg = downscalePreviewCover(
      msg.buffer,
      msg.targetW,
      msg.targetH,
      msg.quality,
    );
    reply({
      id: msg.id,
      jpeg: jpeg ? new Uint8Array(jpeg) : null,
    });
  } catch (e) {
    reply({
      id: msg.id,
      jpeg: null,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

void app.whenReady().then(() => {
  process.on('message', (msg) => {
    handle(msg as PreviewDownscaleRequest);
  });
  // Tell parent we are ready to accept jobs.
  reply({ id: -1, jpeg: null });
});
