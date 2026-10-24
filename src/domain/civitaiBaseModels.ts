/**
 * Civitai base-model architecture groups and SDXL families.
 * apiValues are drawn from Civitai `GET /api/v1/enums` → BaseModel (curated into groups).
 * Per-library settings enable/disable group ids; defaults match the original app set.
 */

export type CivitaiArchitectureId =
  | 'sd15'
  | 'sd2'
  | 'sd3'
  | 'sdxl'
  | 'flux'
  | 'krea'
  | 'pixart'
  | 'wan'
  | 'other';

export type CivitaiArchitecturePreset = {
  id: CivitaiArchitectureId;
  label: string;
  /** Values accepted by Civitai `baseModels` query param. */
  apiValues: string[];
  /** Fallback when API filter misses or baseModel text differs. */
  matchPatterns: RegExp[];
};

export const CIVITAI_ARCHITECTURE_PRESETS: CivitaiArchitecturePreset[] = [
  {
    id: 'sd15',
    label: 'SD 1.x',
    apiValues: ['SD 1.4', 'SD 1.5', 'SD 1.5 Hyper', 'SD 1.5 LCM'],
    matchPatterns: [/sd\s*1\.[45]/i, /\bsd15\b/i],
  },
  {
    id: 'sd2',
    label: 'SD 2.x',
    apiValues: [
      'SD 2.0',
      'SD 2.0 768',
      'SD 2.1',
      'SD 2.1 768',
      'SD 2.1 Unclip',
    ],
    matchPatterns: [/sd\s*2(\.|$|\s)/i, /\bsd2\b/i],
  },
  {
    id: 'sd3',
    label: 'SD 3 / 3.5',
    apiValues: [
      'SD 3',
      'SD 3.5',
      'SD 3.5 Medium',
      'SD 3.5 Large',
      'SD 3.5 Large Turbo',
    ],
    matchPatterns: [/sd\s*3(\.|$|\s)/i, /\bsd3\b/i],
  },
  {
    id: 'sdxl',
    label: 'SDXL',
    apiValues: [
      'SDXL 0.9',
      'SDXL 1.0',
      'SDXL 1.0 LCM',
      'SDXL Turbo',
      'SDXL Lightning',
      'SDXL Hyper',
      'SDXL Distilled',
      'Pony',
      'Pony V7',
      'Illustrious',
      'NoobAI',
    ],
    matchPatterns: [/sdxl/i, /pony/i, /illustrious/i, /noobai/i],
  },
  {
    id: 'flux',
    label: 'Flux',
    apiValues: [
      'Flux.1 D',
      'Flux.1 S',
      'Flux.1 Krea',
      'Flux.1 Kontext',
      'Flux.2 D',
      'Flux.2 Klein 9B',
      'Flux.2 Klein 9B-base',
      'Flux.2 Klein 4B',
      'Flux.2 Klein 4B-base',
    ],
    matchPatterns: [/flux/i],
  },
  {
    id: 'krea',
    label: 'Krea 2',
    apiValues: ['Krea 2'],
    matchPatterns: [/^krea(\s*2)?$/i, /krea\s*2/i, /\bkrea\b/i],
  },
  {
    id: 'pixart',
    label: 'PixArt / Cascade',
    apiValues: [
      'PixArt a',
      'PixArt E',
      'Playground v2',
      'Stable Cascade',
      'AuraFlow',
      'Kolors',
      'Lumina',
    ],
    matchPatterns: [
      /pixart/i,
      /playground/i,
      /cascade/i,
      /auraflow/i,
      /kolors/i,
      /lumina/i,
    ],
  },
  {
    id: 'wan',
    label: 'WAN / Video',
    apiValues: [
      'Wan Video',
      'Wan Video 1.3B t2v',
      'Wan Video 14B t2v',
      'Wan Video 14B i2v 480p',
      'Wan Video 14B i2v 720p',
      'Wan Video 2.2 TI2V-5B',
      'Wan Video 2.2 I2V-A14B',
      'Wan Video 2.2 T2V-A14B',
      'Wan Video 2.5 T2V',
      'Wan Video 2.5 I2V',
      'Wan Video 2.7',
      'Wan Image 2.7',
      'Hunyuan Video',
      'Hunyuan 1',
      'LTXV',
      'LTXV2',
      'LTXV 2.3',
      'CogVideoX',
      'Mochi',
      'SVD',
      'SVD XT',
      'Sora 2',
      'Veo 3',
      'Vidu Q1',
      'Hailuo by MiniMax',
      'Kling',
      'Seedance',
    ],
    matchPatterns: [
      /wan/i,
      /video/i,
      /hunyuan/i,
      /ltx/i,
      /mochi/i,
      /cogvideo/i,
      /\bsvd\b/i,
      /sora/i,
      /veo/i,
      /vidu/i,
      /hailuo/i,
      /kling/i,
      /seedance/i,
    ],
  },
  {
    id: 'other',
    label: 'Other',
    apiValues: [
      'Anima',
      'Chroma',
      'Ernie',
      'Grok',
      'HappyHorse',
      'HiDream',
      'HiDream-O1',
      'Ideogram 4.0',
      'Boogu',
      'Imagen4',
      'Lens',
      'MAI',
      'Nano Banana',
      'ODOR',
      'OpenAI',
      'Qwen',
      'Qwen 2',
      'Reve',
      'Seedream',
      'Upscaler',
      'ZImageTurbo',
      'ZImageBase',
      'ACE Audio',
      'PolyGen',
      'Tripo',
      'Hunyuan3D',
      'Other',
    ],
    // Version titles often say “Ideogram4” / “ZIT” without a usable baseModel.
    matchPatterns: [
      /anima/i,
      /ideogram/i,
      /\bzit\b/i,
      /z[\s-_]?image/i,
      /chroma/i,
      /hidream/i,
      /qwen/i,
      /seedream/i,
      /nano\s*banana/i,
      /imagen\s*4/i,
    ],
  },
];

/** Original product defaults — enabled when creating a new library. */
export const DEFAULT_ENABLED_ARCHITECTURES: CivitaiArchitectureId[] = [
  'sd15',
  'sdxl',
  'flux',
  'krea',
  'wan',
  'other',
];

/** Narrow SDXL catalog further (local filter + sync apiValues). */
export type CivitaiSdxlFamilyId =
  | 'all'
  | 'sdxl'
  | 'pony'
  | 'illustrious'
  | 'noobai';

export type CivitaiSdxlFamilyPreset = {
  id: CivitaiSdxlFamilyId;
  label: string;
};

export const CIVITAI_SDXL_FAMILY_PRESETS: CivitaiSdxlFamilyPreset[] = [
  { id: 'all', label: 'All families' },
  { id: 'sdxl', label: 'SDXL only' },
  { id: 'pony', label: 'Pony' },
  { id: 'illustrious', label: 'Illustrious' },
  { id: 'noobai', label: 'NoobAI' },
];

export type CivitaiSdxlFamilyToggleId = Exclude<CivitaiSdxlFamilyId, 'all'>;

/** Families that can be enabled/disabled per library (not “All”). */
export const CIVITAI_SDXL_FAMILY_TOGGLE_IDS: CivitaiSdxlFamilyToggleId[] = [
  'sdxl',
  'pony',
  'illustrious',
  'noobai',
];

export const DEFAULT_ENABLED_SDXL_FAMILIES: CivitaiSdxlFamilyToggleId[] = [
  'sdxl',
  'pony',
  'illustrious',
  'noobai',
];

/** API baseModels strings belonging to each SDXL family. */
export const SDXL_FAMILY_API_VALUES: Record<
  CivitaiSdxlFamilyToggleId,
  string[]
> = {
  sdxl: [
    'SDXL 0.9',
    'SDXL 1.0',
    'SDXL 1.0 LCM',
    'SDXL Turbo',
    'SDXL Lightning',
    'SDXL Hyper',
    'SDXL Distilled',
  ],
  pony: ['Pony', 'Pony V7'],
  illustrious: ['Illustrious'],
  noobai: ['NoobAI'],
};

export function matchesSdxlFamily(
  baseModel: string | undefined,
  family: CivitaiSdxlFamilyId,
): boolean {
  if (family === 'all') return true;
  const text = (baseModel ?? '').trim();
  if (!text) return false;
  const isPony = /pony/i.test(text);
  const isIllustrious = /illustrious/i.test(text);
  const isNoobai = /noobai/i.test(text);
  if (family === 'pony') return isPony;
  if (family === 'illustrious') return isIllustrious;
  if (family === 'noobai') return isNoobai;
  // Vanilla SDXL variants — exclude Pony / Illustrious / NoobAI.
  if (isPony || isIllustrious || isNoobai) return false;
  return /sdxl/i.test(text);
}

/**
 * True when any listed base model belongs on this Browse selection.
 * A specific SDXL family chip does not accept the other families.
 */
export function baseModelsMatchBrowseSelection(
  baseModels: Array<string | undefined>,
  opts: {
    architectures: CivitaiArchitectureId[];
    sdxlFamily?: CivitaiSdxlFamilyId | 'all';
    enabledSdxlFamilies?: readonly CivitaiSdxlFamilyToggleId[];
  },
): boolean {
  const bases = baseModels.filter((value): value is string =>
    Boolean(value?.trim()),
  );
  if (opts.architectures.length === 0) return true;
  const archHits = bases.filter((base) =>
    matchesArchitectureFilter(base, opts.architectures),
  );
  if (archHits.length === 0) return false;
  if (!opts.architectures.includes('sdxl')) return true;
  const sdxlHits = archHits.filter((base) =>
    matchesArchitectureFilter(base, ['sdxl']),
  );
  if (sdxlHits.length === 0) return false;
  if (opts.sdxlFamily && opts.sdxlFamily !== 'all') {
    return sdxlHits.some((base) => matchesSdxlFamily(base, opts.sdxlFamily!));
  }
  const enabled = opts.enabledSdxlFamilies ?? DEFAULT_ENABLED_SDXL_FAMILIES;
  return sdxlHits.some((base) => matchesEnabledSdxlFamilies(base, [...enabled]));
}

/** True when baseModel belongs to one of the enabled SDXL families. */
export function matchesEnabledSdxlFamilies(
  baseModel: string | undefined,
  enabled: CivitaiSdxlFamilyToggleId[],
): boolean {
  if (enabled.length === 0) return false;
  if (enabled.length === CIVITAI_SDXL_FAMILY_TOGGLE_IDS.length) return true;
  return enabled.some((id) => matchesSdxlFamily(baseModel, id));
}

/** Compact family id when browsing SDXL with “All families”. */
export function sdxlFamilyBadgeId(
  baseModel: string | undefined,
): CivitaiSdxlFamilyToggleId | null {
  const text = (baseModel ?? '').trim();
  if (!text) return null;
  if (/pony/i.test(text)) return 'pony';
  if (/illustrious/i.test(text)) return 'illustrious';
  if (/noobai/i.test(text)) return 'noobai';
  if (/sdxl/i.test(text)) return 'sdxl';
  return null;
}

/** @deprecated Prefer sdxlFamilyBadgeId for icon badges. */
export function sdxlFamilyBadgeLabel(
  baseModel: string | undefined,
): string | null {
  const id = sdxlFamilyBadgeId(baseModel);
  if (!id) return null;
  if (id === 'sdxl') return 'SDXL';
  if (id === 'pony') return 'Pony';
  if (id === 'illustrious') return 'Illustrious';
  return 'NoobAI';
}

export function architecturePreset(
  id: CivitaiArchitectureId,
): CivitaiArchitecturePreset {
  return (
    CIVITAI_ARCHITECTURE_PRESETS.find((preset) => preset.id === id) ??
    CIVITAI_ARCHITECTURE_PRESETS[CIVITAI_ARCHITECTURE_PRESETS.length - 1]!
  );
}

export function allArchitectureIds(): CivitaiArchitectureId[] {
  return CIVITAI_ARCHITECTURE_PRESETS.map((p) => p.id);
}

/**
 * Expand selected architecture ids into Civitai API baseModels values.
 * When SDXL is included, `sdxlFamilies` limits which SDXL-family strings are sent.
 */
export function expandArchitectureApiValues(
  ids: CivitaiArchitectureId[],
  opts?: { sdxlFamilies?: CivitaiSdxlFamilyToggleId[] },
): string[] {
  const values = new Set<string>();
  const families =
    opts?.sdxlFamilies && opts.sdxlFamilies.length > 0
      ? opts.sdxlFamilies
      : DEFAULT_ENABLED_SDXL_FAMILIES;

  for (const id of ids) {
    if (id === 'other') {
      for (const value of architecturePreset('other').apiValues) {
        values.add(value);
      }
      continue;
    }
    if (id === 'sdxl') {
      for (const family of families) {
        for (const value of SDXL_FAMILY_API_VALUES[family]) {
          values.add(value);
        }
      }
      continue;
    }
    for (const value of architecturePreset(id).apiValues) {
      values.add(value);
    }
  }
  return [...values];
}

/**
 * Normalize a Civitai `baseModel` enum string for exact comparison.
 * Civitai’s field is the source of truth (e.g. "Krea 2", "Flux.1 D", "Pony").
 */
export function normalizeBaseModelValue(baseModel: string | undefined): string {
  return (baseModel ?? '').trim().toLowerCase();
}

function apiValueSet(values: readonly string[]): Set<string> {
  return new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean));
}

/** Exact (case-insensitive) membership in a preset’s official apiValues. */
function baseModelInApiValues(
  baseModel: string | undefined,
  apiValues: readonly string[],
): boolean {
  const key = normalizeBaseModelValue(baseModel);
  if (!key) return false;
  return apiValueSet(apiValues).has(key);
}

/** Every known non-other BaseModel enum string we catalogue. */
function allKnownBaseModelApiValues(): Set<string> {
  const out = new Set<string>();
  for (const preset of CIVITAI_ARCHITECTURE_PRESETS) {
    if (preset.id === 'other') continue;
    for (const value of preset.apiValues) {
      out.add(value.trim().toLowerCase());
    }
  }
  for (const values of Object.values(SDXL_FAMILY_API_VALUES)) {
    for (const value of values) {
      out.add(value.trim().toLowerCase());
    }
  }
  return out;
}

let knownBaseModelCache: Set<string> | null = null;
function knownBaseModelValues(): Set<string> {
  if (!knownBaseModelCache) knownBaseModelCache = allKnownBaseModelApiValues();
  return knownBaseModelCache;
}

/**
 * True when `baseModel` is Civitai’s official enum value for a selected
 * architecture. Uses exact apiValues only — not version titles or filenames.
 */
export function matchesArchitectureFilter(
  baseModel: string | undefined,
  selected: CivitaiArchitectureId[],
): boolean {
  if (selected.length === 0) return true;
  const text = (baseModel ?? '').trim();
  if (!text) return selected.includes('other');

  for (const id of selected) {
    if (id === 'other') continue;
    if (baseModelInApiValues(text, architecturePreset(id).apiValues)) {
      return true;
    }
  }

  if (!selected.includes('other')) return false;

  if (baseModelInApiValues(text, architecturePreset('other').apiValues)) {
    return true;
  }
  // Unknown enum → Other bucket (same as Civitai’s catch-all).
  return !knownBaseModelValues().has(normalizeBaseModelValue(text));
}

/**
 * Architecture group ids whose official apiValues include this baseModel.
 * Empty when the value is unknown (caller may treat as Other).
 */
export function architectureIdsForBaseModel(
  baseModel: string | undefined,
): CivitaiArchitectureId[] {
  const text = (baseModel ?? '').trim();
  if (!text) return [];
  const ids: CivitaiArchitectureId[] = [];
  for (const preset of CIVITAI_ARCHITECTURE_PRESETS) {
    if (preset.id === 'other') continue;
    if (baseModelInApiValues(text, preset.apiValues)) {
      ids.push(preset.id);
    }
  }
  if (ids.length > 0) return ids;
  if (
    baseModelInApiValues(text, architecturePreset('other').apiValues) ||
    !knownBaseModelValues().has(normalizeBaseModelValue(text))
  ) {
    return ['other'];
  }
  return [];
}

let officialBaseModelValuesCache: string[] | null = null;

/** Official BaseModel enum strings, longest first so "Krea 2" beats a shorter prefix. */
function officialBaseModelValuesLongestFirst(): string[] {
  if (officialBaseModelValuesCache) return officialBaseModelValuesCache;
  const values = new Set<string>();
  for (const preset of CIVITAI_ARCHITECTURE_PRESETS) {
    for (const value of preset.apiValues) values.add(value);
  }
  for (const list of Object.values(SDXL_FAMILY_API_VALUES)) {
    for (const value of list) values.add(value);
  }
  officialBaseModelValuesCache = [...values].sort(
    (a, b) => b.length - a.length,
  );
  return officialBaseModelValuesCache;
}

/**
 * Official base-model names mentioned in a version title (e.g. "v1.0 Illustrious").
 * Longest match wins on overlap. Does not use filenames.
 */
export function baseModelsNamedInText(text: string | undefined): string[] {
  const raw = text?.trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const taken: Array<[number, number]> = [];
  const found: string[] = [];
  const overlaps = (start: number, end: number) =>
    taken.some(([from, to]) => start < to && end > from);
  for (const value of officialBaseModelValuesLongestFirst()) {
    const needle = value.toLowerCase();
    let from = 0;
    while (from <= lower.length - needle.length) {
      const idx = lower.indexOf(needle, from);
      if (idx < 0) break;
      const end = idx + needle.length;
      const beforeOk = idx === 0 || !/[a-z0-9]/i.test(raw[idx - 1]!);
      const afterOk = end >= raw.length || !/[a-z0-9]/i.test(raw[end]!);
      if (beforeOk && afterOk && !overlaps(idx, end)) {
        found.push(value);
        taken.push([idx, end]);
        break;
      }
      from = idx + 1;
    }
  }
  return found;
}

/**
 * Base model used to decide which chip a version belongs to.
 * Trusts Civitai's `baseModel` unless the version title names exactly one
 * different architecture (a Krea card must not keep an Illustrious sibling
 * just because the stored field was copied from the model primary).
 */
export function resolveVersionBaseModel(row: {
  baseModel?: string;
  versionName?: string;
  name?: string;
}): string | undefined {
  const field = row.baseModel?.trim() || undefined;
  const named = baseModelsNamedInText(row.versionName ?? row.name);
  const namedArch = new Set(
    named.flatMap((value) => architectureIdsForBaseModel(value)),
  );
  if (!field) {
    if (namedArch.size !== 1) return undefined;
    return named.find(
      (value) => architectureIdsForBaseModel(value)[0] === [...namedArch][0],
    );
  }
  if (namedArch.size !== 1) return field;
  const fieldArch = architectureIdsForBaseModel(field)[0];
  const titleArch = [...namedArch][0];
  if (fieldArch && titleArch && fieldArch !== titleArch) {
    return named.find(
      (value) => architectureIdsForBaseModel(value)[0] === titleArch,
    );
  }
  return field;
}

export type VersionArchitectureFields = {
  /** Civitai modelVersions[].baseModel — the only field used for arch matching. */
  baseModel?: string;
  versionName?: string;
  name?: string;
  fileName?: string;
};

/**
 * @deprecated Prefer the version’s `baseModel` field directly.
 * Kept as a thin alias so call sites that used the old hint keep compiling.
 */
export function versionArchitectureHint(
  row: VersionArchitectureFields,
): string | undefined {
  const base = row.baseModel?.trim();
  return base || undefined;
}

/**
 * True when a model version’s official `baseModel` belongs to `selected`.
 * Ignores version title and filename.
 */
export function matchesVersionArchitectureFilter(
  row: VersionArchitectureFields,
  selected: CivitaiArchitectureId[],
): boolean {
  return matchesArchitectureFilter(row.baseModel, selected);
}

/**
 * True when baseModel belongs to this library’s enabled architecture set
 * (and enabled SDXL families when SDXL is enabled).
 */
export function matchesEnabledLibraryBaseModel(
  baseModel: string | undefined,
  opts: {
    architectures: CivitaiArchitectureId[];
    sdxlFamilies?: CivitaiSdxlFamilyToggleId[];
  },
): boolean {
  const architectures = opts.architectures;
  if (!matchesArchitectureFilter(baseModel, architectures)) return false;
  if (
    architectures.includes('sdxl') &&
    matchesArchitectureFilter(baseModel, ['sdxl'])
  ) {
    return matchesEnabledSdxlFamilies(
      baseModel,
      opts.sdxlFamilies ?? DEFAULT_ENABLED_SDXL_FAMILIES,
    );
  }
  return true;
}

/**
 * Library / Browse check for a version row — uses only `row.baseModel`
 * (Civitai’s per-version enum).
 */
export function matchesEnabledLibraryVersion(
  row: VersionArchitectureFields,
  opts: {
    architectures: CivitaiArchitectureId[];
    sdxlFamilies?: CivitaiSdxlFamilyToggleId[];
  },
): boolean {
  return matchesEnabledLibraryBaseModel(row.baseModel, opts);
}

export function normalizeEnabledArchitectures(
  raw: unknown,
): CivitaiArchitectureId[] {
  const allowed = new Set(allArchitectureIds());
  if (!Array.isArray(raw)) return [...DEFAULT_ENABLED_ARCHITECTURES];
  const out: CivitaiArchitectureId[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    if (!allowed.has(item as CivitaiArchitectureId)) continue;
    if (!out.includes(item as CivitaiArchitectureId)) {
      out.push(item as CivitaiArchitectureId);
    }
  }
  return out.length > 0 ? out : [...DEFAULT_ENABLED_ARCHITECTURES];
}

export function normalizeEnabledSdxlFamilies(
  raw: unknown,
): CivitaiSdxlFamilyToggleId[] {
  const allowed = new Set(CIVITAI_SDXL_FAMILY_TOGGLE_IDS);
  if (!Array.isArray(raw)) return [...DEFAULT_ENABLED_SDXL_FAMILIES];
  const out: CivitaiSdxlFamilyToggleId[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    if (!allowed.has(item as CivitaiSdxlFamilyToggleId)) continue;
    if (!out.includes(item as CivitaiSdxlFamilyToggleId)) {
      out.push(item as CivitaiSdxlFamilyToggleId);
    }
  }
  return out.length > 0 ? out : [...DEFAULT_ENABLED_SDXL_FAMILIES];
}
