/** Civitai site category chips — these map to model `tag=` filters. */
export type CivitaiModelCategoryId =
  | 'character'
  | 'style'
  | 'concept'
  | 'clothing'
  | 'base model'
  | 'background'
  | 'poses'
  | 'tool'
  | 'assets'
  | 'vehicle'
  | 'buildings'
  | 'objects'
  | 'animal'
  | 'action';

export type CivitaiModelCategoryPreset = {
  id: CivitaiModelCategoryId;
  label: string;
  /** Exact tag name accepted by Civitai `GET /models?tag=`. */
  tag: string;
};

/** Same primary categories shown on the Civitai browse UI. */
export const CIVITAI_MODEL_CATEGORY_PRESETS: CivitaiModelCategoryPreset[] = [
  { id: 'character', label: 'Character', tag: 'character' },
  { id: 'style', label: 'Style', tag: 'style' },
  { id: 'concept', label: 'Concept', tag: 'concept' },
  { id: 'clothing', label: 'Clothing', tag: 'clothing' },
  { id: 'base model', label: 'Base Model', tag: 'base model' },
  { id: 'background', label: 'Background', tag: 'background' },
  { id: 'poses', label: 'Poses', tag: 'poses' },
  { id: 'tool', label: 'Tool', tag: 'tool' },
  { id: 'assets', label: 'Assets', tag: 'assets' },
  { id: 'vehicle', label: 'Vehicle', tag: 'vehicle' },
  { id: 'buildings', label: 'Buildings', tag: 'buildings' },
  { id: 'objects', label: 'Objects', tag: 'objects' },
  { id: 'animal', label: 'Animal', tag: 'animal' },
  { id: 'action', label: 'Action', tag: 'action' },
];

export function modelCategoryTag(
  id: CivitaiModelCategoryId | null | undefined,
): string | undefined {
  if (!id) return undefined;
  return CIVITAI_MODEL_CATEGORY_PRESETS.find((preset) => preset.id === id)?.tag;
}

/** First known Civitai category id on a model, for UI badges. */
export function categoryIdFromTags(
  tags: string[] | undefined,
): CivitaiModelCategoryId | null {
  if (!tags?.length) return null;
  const lower = new Set(tags.map((t) => t.toLowerCase()));
  for (const preset of CIVITAI_MODEL_CATEGORY_PRESETS) {
    if (lower.has(preset.tag.toLowerCase())) return preset.id;
  }
  return null;
}

/** @deprecated Prefer categoryIdFromTags for icon badges. */
export function categoryLabelFromTags(
  tags: string[] | undefined,
): string | null {
  const id = categoryIdFromTags(tags);
  if (!id) return null;
  return (
    CIVITAI_MODEL_CATEGORY_PRESETS.find((preset) => preset.id === id)?.label ??
    null
  );
}

/** All known Civitai category ids (library default = everything visible). */
export const DEFAULT_ENABLED_CIVITAI_CATEGORIES: CivitaiModelCategoryId[] =
  CIVITAI_MODEL_CATEGORY_PRESETS.map((preset) => preset.id);

export function allCivitaiCategoryIds(): CivitaiModelCategoryId[] {
  return CIVITAI_MODEL_CATEGORY_PRESETS.map((preset) => preset.id);
}

/**
 * Normalize a persisted enable-list. Unknown ids are dropped. Empty /
 * invalid input falls back to the full default set so browse never blanks.
 */
export function normalizeEnabledCivitaiCategories(
  raw: unknown,
): CivitaiModelCategoryId[] {
  const allowed = new Set(allCivitaiCategoryIds());
  if (!Array.isArray(raw)) return [...DEFAULT_ENABLED_CIVITAI_CATEGORIES];
  const out: CivitaiModelCategoryId[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    if (!allowed.has(item as CivitaiModelCategoryId)) continue;
    if (!out.includes(item as CivitaiModelCategoryId)) {
      out.push(item as CivitaiModelCategoryId);
    }
  }
  return out.length > 0 ? out : [...DEFAULT_ENABLED_CIVITAI_CATEGORIES];
}

/** True when the model carries this category's Civitai tag (any position). */
export function modelHasCategoryTag(
  tags: string[] | undefined,
  category: CivitaiModelCategoryId | null | undefined,
): boolean {
  const want = modelCategoryTag(category)?.toLowerCase();
  if (!want) return true;
  return (tags ?? []).some((value) => value.toLowerCase() === want);
}

/** True when the model's primary category is enabled (or uncategorized). */
export function modelCategoryIsEnabled(
  tags: string[] | undefined,
  enabled: readonly CivitaiModelCategoryId[],
): boolean {
  const id = categoryIdFromTags(tags);
  if (!id) return true;
  return enabled.includes(id);
}
