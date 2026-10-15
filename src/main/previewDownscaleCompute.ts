import { nativeImage } from 'electron';

export type PreviewDownscaleRequest = {
  id: number;
  /** Raw image bytes (JPEG/PNG). */
  buffer: Uint8Array;
  targetW: number;
  targetH: number;
  quality: number;
};

export type PreviewDownscaleResponse = {
  id: number;
  /** Cover-cropped JPEG, or null on failure. */
  jpeg: Uint8Array | null;
  error?: string;
};

/**
 * Produce a targetW × targetH JPEG using COVER scaling (scale so the short side
 * fills the box, then center-crop). Used from the preview utility process.
 */
export function downscalePreviewCover(
  buffer: Uint8Array,
  targetW: number,
  targetH: number,
  quality: number,
): Buffer | null {
  let image: Electron.NativeImage | null = null;
  let scaled: Electron.NativeImage | null = null;
  let cropped: Electron.NativeImage | null = null;
  try {
    image = nativeImage.createFromBuffer(Buffer.from(buffer));
    if (image.isEmpty()) return null;

    const { width, height } = image.getSize();
    if (width <= 0 || height <= 0) return null;

    const scale = Math.max(targetW / width, targetH / height);
    const scaledW = Math.max(targetW, Math.round(width * scale));
    const scaledH = Math.max(targetH, Math.round(height * scale));

    if (scaledW !== width || scaledH !== height) {
      scaled = image.resize({
        width: scaledW,
        height: scaledH,
        quality: 'better',
      });
      image = null;
    } else {
      scaled = image;
      image = null;
    }

    const x = Math.max(0, Math.round((scaledW - targetW) / 2));
    const y = Math.max(0, Math.round((scaledH - targetH) / 2));
    cropped = scaled.crop({ x, y, width: targetW, height: targetH });
    scaled = null;

    const jpeg = cropped.toJPEG(quality);
    cropped = null;
    return jpeg.length > 0 ? jpeg : null;
  } catch {
    return null;
  } finally {
    image = null;
    scaled = null;
    cropped = null;
  }
}
