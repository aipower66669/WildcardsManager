/**
 * Names ComfyUI may have written for this job.
 * The stem is `WCG`. The rest of the name is whatever the save node appends
 * (`WCG_00001_.png`, `WCG_<extra>_00001.png`, `WCG.png`, …).
 */

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/** True when this directory entry is an image for the generation stem. */
export function isGenerationOutputName(fileName: string, stem: string): boolean {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = lower.slice(dot);
  if (!IMAGE_EXTS.has(ext)) return false;
  const stemLower = stem.toLowerCase();
  return (
    lower === `${stemLower}${ext}` ||
    lower.startsWith(`${stemLower}_`) ||
    lower.startsWith(`${stemLower}.`)
  );
}

/** Every image in `names` that belongs to this generation stem. */
export function generationOutputNames(
  names: readonly string[],
  stem: string,
): string[] {
  return names.filter((name) => isGenerationOutputName(name, stem));
}
