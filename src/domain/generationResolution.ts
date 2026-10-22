/**
 * Common image sizes for the Generation width/height steppers.
 * Every side is a multiple of 16 so latents stay GPU-aligned.
 * Both orientations are listed. SDXL's ~1 megapixel shapes are included
 * because those exact pixels are what people actually run.
 */
export const COMMON_GENERATION_RESOLUTIONS: ReadonlyArray<
  readonly [number, number]
> = [
  // 1:1
  [512, 512],
  [768, 768],
  [1024, 1024],
  [1152, 1152],
  [1280, 1280],
  [1536, 1536],
  [2048, 2048],
  // 2:3 and 3:2
  [512, 768],
  [768, 512],
  [768, 1152],
  [1152, 768],
  [1024, 1536],
  [1536, 1024],
  [1280, 1920],
  [1920, 1280],
  // 3:4 and 4:3
  [480, 640],
  [640, 480],
  [768, 1024],
  [1024, 768],
  [960, 1280],
  [1280, 960],
  [1152, 1536],
  [1536, 1152],
  [1200, 1600],
  [1600, 1200],
  [1440, 1920],
  [1920, 1440],
  [1536, 2048],
  [2048, 1536],
  // 9:16 and 16:9
  [576, 1024],
  [1024, 576],
  [720, 1280],
  [1280, 720],
  [864, 1536],
  [1536, 864],
  [1088, 1920],
  [1920, 1088],
  [1152, 2048],
  [2048, 1152],
  // SDXL ~1MP shapes
  [896, 1152],
  [1152, 896],
  [832, 1216],
  [1216, 832],
  [768, 1344],
  [1344, 768],
  [640, 1536],
  [1536, 640],
];

export type GenerationSize = { width: number; height: number };

/** Portrait ↔ landscape. Values are exchanged as they are. */
export function swapGenerationSize(
  width: number,
  height: number,
): GenerationSize {
  return { width: height, height: width };
}

const ASPECT_TIE = 0.02;

function aspectError(width: number, height: number, aspect: number): number {
  return Math.abs(Math.log(width / height) - Math.log(aspect));
}

/**
 * Next smaller or larger common size.
 * Prefers the closest aspect ratio, then the nearest pixel count.
 * A change of less than 16px on both sides is ignored so 1920×1080 does not
 * "grow" into 1920×1088.
 */
export function stepGenerationResolution(
  width: number,
  height: number,
  direction: 'up' | 'down',
): GenerationSize | null {
  const w = Math.round(width);
  const h = Math.round(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;
  const area = w * h;
  const aspect = w / h;
  let best: readonly [number, number] | null = null;
  let bestAspect = Infinity;
  let bestAreaDist = Infinity;

  for (const candidate of COMMON_GENERATION_RESOLUTIONS) {
    const [cw, ch] = candidate;
    if (cw === w && ch === h) continue;
    if (Math.abs(cw - w) < 16 && Math.abs(ch - h) < 16) continue;
    const candidateArea = cw * ch;
    if (direction === 'down' ? candidateArea >= area : candidateArea <= area) {
      continue;
    }
    const err = aspectError(cw, ch, aspect);
    const areaDist = Math.abs(candidateArea - area);
    const closerAspect = err < bestAspect - ASPECT_TIE;
    const sameAspect = Math.abs(err - bestAspect) <= ASPECT_TIE;
    if (best == null || closerAspect || (sameAspect && areaDist < bestAreaDist)) {
      best = candidate;
      bestAspect = err;
      bestAreaDist = areaDist;
    }
  }

  return best ? { width: best[0], height: best[1] } : null;
}
