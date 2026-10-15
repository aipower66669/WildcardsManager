/**
 * Image “Tools” filter (Created with…), inferred from public `/images` meta.
 * Civitai’s site filters by numeric tool IDs via an internal API; the public
 * Images endpoint does not honor `tools`, so we match generator fingerprints
 * in `meta` instead.
 */

/** Civitai public `/images` hard cap — use full pages to minimize cursor round-trips. */
export const CIVITAI_IMAGES_PAGE_LIMIT = 200;

export const CIVITAI_IMAGE_TOOL_PRESETS = [
  { id: 'any', label: 'Any tool' },
  { id: 'krea', label: 'Krea' },
  { id: 'comfyui', label: 'ComfyUI' },
  { id: 'civitai', label: 'Civitai' },
  { id: 'automatic1111', label: 'AUTOMATIC1111' },
  { id: 'forge', label: 'Forge' },
  { id: 'swarmui', label: 'SwarmUI' },
  { id: 'fooocus', label: 'Fooocus' },
] as const;

export type CivitaiImageToolId = (typeof CIVITAI_IMAGE_TOOL_PRESETS)[number]['id'];

export type CivitaiImageToolFilterId = Exclude<CivitaiImageToolId, 'any'>;

const FILTER_IDS = new Set<string>(
  CIVITAI_IMAGE_TOOL_PRESETS.filter((p) => p.id !== 'any').map((p) => p.id),
);

export function isCivitaiImageToolFilterId(
  value: string,
): value is CivitaiImageToolFilterId {
  return FILTER_IDS.has(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Best-effort generator tool from public image `meta`.
 * Returns null when meta is missing or does not match a known fingerprint.
 */
export function inferCivitaiImageTool(
  meta: Record<string, unknown> | null | undefined,
): CivitaiImageToolFilterId | null {
  if (!meta || typeof meta !== 'object') return null;

  const engine = asTrimmedString(meta.engine).toLowerCase();
  const software = asTrimmedString(meta.software).toLowerCase();
  const version = asTrimmedString(meta.version).toLowerCase();
  const ecosystem = asTrimmedString(meta.ecosystem).toLowerCase();
  const externalName = (() => {
    const external = meta.external;
    if (!external || typeof external !== 'object') return '';
    const source = (external as { source?: unknown }).source;
    if (!source || typeof source !== 'object') return '';
    return asTrimmedString((source as { name?: unknown }).name).toLowerCase();
  })();
  const combined = `${engine} ${software} ${version} ${ecosystem} ${externalName}`;

  if (
    meta.comfy != null ||
    engine.includes('comfy') ||
    software.includes('comfy') ||
    version.includes('comfy')
  ) {
    return 'comfyui';
  }

  // On-site Krea 2 gens use meta.ecosystem = "Krea2" (also engine/external).
  if (
    ecosystem.includes('krea') ||
    engine.includes('krea') ||
    software.includes('krea') ||
    externalName.includes('krea')
  ) {
    return 'krea';
  }

  if (
    engine.includes('civitai') ||
    software.includes('civitai') ||
    (meta.workflow != null &&
      meta.civitaiResources != null &&
      meta.comfy == null)
  ) {
    return 'civitai';
  }

  if (
    combined.includes('swarm') ||
    software.includes('swarmui') ||
    engine.includes('swarm')
  ) {
    return 'swarmui';
  }

  if (
    combined.includes('fooocus') ||
    combined.includes('rfooocus') ||
    software.includes('fooocus')
  ) {
    return 'fooocus';
  }

  // Forge Neo / Forge version strings (e.g. f2.0.1v1.10.1-…, neo-2.24).
  if (
    combined.includes('forge') ||
    version.startsWith('f2.') ||
    /(^|[^a-z])neo([-\s]|$)/i.test(version) ||
    version.includes('neo-')
  ) {
    return 'forge';
  }

  if (
    combined.includes('automatic') ||
    combined.includes('a1111') ||
    combined.includes('stable-diffusion-webui') ||
    /^v?\d+\.\d+(\.\d+)?$/.test(version)
  ) {
    return 'automatic1111';
  }

  return null;
}

export function civitaiImageMatchesTools(
  meta: Record<string, unknown> | null | undefined,
  tools: readonly CivitaiImageToolFilterId[] | undefined,
): boolean {
  if (!tools?.length) return true;
  const inferred = inferCivitaiImageTool(meta);
  if (!inferred) return false;
  return tools.includes(inferred);
}
