/**
 * Both families show every sampler Comfy reports. A saved name stays in the
 * list when the catalog no longer includes it.
 */
export function generationSamplerOptions(
  _family: 'krea2' | 'sdxl',
  catalog: string[],
  saved: string,
): string[] {
  const base = [...catalog];
  const value = saved.trim();
  if (value && !base.includes(value)) base.unshift(value);
  return base;
}

/** Dropdown text. The Comfy id is shown as-is, underscores included. */
export function samplerLabel(name: string): string {
  return name.trim();
}

/** Dropdown text. The Comfy id is shown as-is, underscores included. */
export function schedulerLabel(name: string): string {
  return name.trim();
}

function stem(name: string): string {
  return name.trim().replace(/\.[^.]+$/, '').toLowerCase();
}

/**
 * Keep a saved upscaler when Comfy lists that file or the same stem
 * (`4x_foolhardy_Remacri` matches `4x_foolhardy_Remacri.pth`).
 */
export function matchUpscaler(saved: string, catalog: string[]): string {
  const value = saved.trim();
  if (!value) return '';
  if (catalog.includes(value)) return value;
  const wanted = stem(value);
  return catalog.find((name) => stem(name) === wanted) ?? value;
}
