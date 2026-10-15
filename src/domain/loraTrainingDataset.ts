/**
 * Training-library dataset folders (dataset.json + preview icon) for local
 * multi-step LoRA series.
 *
 * Datasets are matched by finding a series `.safetensors` under the training
 * tree (typically `<dataset>/output/…`), then walking up to `dataset.json` —
 * not by comparing folder names to the LoRA series base.
 */

import { parseLoraTrainingStep } from './loraSeries.js';

const IMAGE_EXT_RE = /\.(jpe?g|jfif|png|webp|gif|bmp|avif|tiff?)$/i;
const SAFETENSORS_EXT_RE = /\.safetensors$/i;

/** True when a basename looks like a dataset preview/image file. */
export function isDatasetImageFileName(name: string): boolean {
  const base = name.trim().split(/[\\/]/).pop() ?? '';
  if (!base || base.startsWith('.')) return false;
  if (base.toLowerCase() === 'dataset.json') return false;
  return IMAGE_EXT_RE.test(base);
}

/**
 * First image basename in a directory listing (numeric sort). Used when
 * dataset.json has no coverFileName.
 */
export function pickFirstDatasetImageFileName(
  fileNames: readonly string[],
): string | null {
  const images = fileNames
    .map((n) => n.trim())
    .filter((n) => isDatasetImageFileName(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return images[0] ?? null;
}

const PREVIEW_STRING_KEYS = [
  // Primary field used by the local training library dataset.json
  'coverFileName',
  'cover_file_name',
  'preview',
  'preview_image',
  'previewImage',
  'preview_file',
  'previewFile',
  'preview_path',
  'previewPath',
  'icon',
  'icon_path',
  'iconPath',
  'thumbnail',
  'thumbnail_path',
  'thumbnailPath',
  'cover',
  'cover_image',
  'coverImage',
] as const;

const NAME_KEYS = [
  'name',
  'title',
  'output_name',
  'outputName',
  'ss_output_name',
  'dataset_name',
  'datasetName',
] as const;

export type LoraSeriesDatasetKeyParts = {
  /** LoRA-relative dir of the series members (may be empty). */
  dir: string;
  seriesBase: string;
  separator: '_' | '-';
};

/** Stable cache key for a training-step LoRA series. */
export function loraSeriesDatasetKey(parts: LoraSeriesDatasetKeyParts): string {
  const dir = parts.dir.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').toLowerCase();
  const base = parts.seriesBase.trim().toLowerCase();
  return `${dir}\0${base}\0${parts.separator}`;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function looksLikeImagePath(value: string): boolean {
  return IMAGE_EXT_RE.test(value.split(/[\\/]/).pop() ?? value);
}

/**
 * Read which image file (relative to the dataset root) is the preview icon.
 * Supports common field names and a few nested / list shapes.
 */
export function parseDatasetPreviewRelativePath(json: unknown): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const row = json as Record<string, unknown>;

  for (const key of PREVIEW_STRING_KEYS) {
    const value = asNonEmptyString(row[key]);
    if (value && looksLikeImagePath(value)) {
      return value.replaceAll('\\', '/');
    }
  }

  for (const key of PREVIEW_STRING_KEYS) {
    const nested = row[key];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    const obj = nested as Record<string, unknown>;
    for (const nestedKey of [
      'path',
      'file',
      'filename',
      'name',
      'relativePath',
      'relative_path',
    ]) {
      const value = asNonEmptyString(obj[nestedKey]);
      if (value && looksLikeImagePath(value)) {
        return value.replaceAll('\\', '/');
      }
    }
  }

  const images = row.images;
  if (Array.isArray(images)) {
    for (const item of images) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const img = item as Record<string, unknown>;
      const flagged =
        img.preview === true ||
        img.is_preview === true ||
        img.isPreview === true ||
        img.icon === true ||
        img.is_icon === true ||
        img.isIcon === true;
      if (!flagged) continue;
      for (const nestedKey of [
        'path',
        'file',
        'filename',
        'name',
        'relativePath',
        'image',
      ]) {
        const value = asNonEmptyString(img[nestedKey]);
        if (value && looksLikeImagePath(value)) {
          return value.replaceAll('\\', '/');
        }
      }
    }
  }

  return null;
}

/** Optional display / match name from dataset.json. */
export function parseDatasetName(json: unknown): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const row = json as Record<string, unknown>;
  for (const key of NAME_KEYS) {
    const value = asNonEmptyString(row[key]);
    if (value) return value;
  }
  return null;
}

export type DatasetValidationSetMeta = {
  index: number;
  prompt: string;
  seed: number | null;
  loraWeight: number | null;
};

/** Parse `validationSets` entries from dataset.json. */
export function parseDatasetValidationSets(
  json: unknown,
): DatasetValidationSetMeta[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return [];
  const row = json as Record<string, unknown>;
  if (!Array.isArray(row.validationSets)) return [];
  const out: DatasetValidationSetMeta[] = [];
  for (let i = 0; i < row.validationSets.length; i++) {
    const item = row.validationSets[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      out.push({ index: i, prompt: '', seed: null, loraWeight: null });
      continue;
    }
    const set = item as Record<string, unknown>;
    const prompt = asNonEmptyString(set.prompt) ?? '';
    const seed =
      typeof set.seed === 'number' && Number.isFinite(set.seed)
        ? set.seed
        : null;
    const loraWeight =
      typeof set.loraWeight === 'number' && Number.isFinite(set.loraWeight)
        ? set.loraWeight
        : null;
    out.push({ index: i, prompt, seed, loraWeight });
  }
  return out;
}

/**
 * Extract a set index from an output subfolder name (`0`, `Set 1`, `set-2`).
 * Returns null when the name has no clear index.
 */
export function parseOutputSetFolderIndex(folderName: string): number | null {
  const name = folderName.trim();
  if (!name) return null;
  if (/^\d+$/.test(name)) return Number(name);
  const setMatch = /(?:^|[^a-z])set\s*[_\-]?\s*(\d+)\s*$/i.exec(name);
  if (setMatch) return Number(setMatch[1]);
  const trailing = /(\d+)\s*$/.exec(name);
  if (trailing && /set|valid|val/i.test(name)) return Number(trailing[1]);
  return null;
}

/**
 * Order `output/` subfolders to align with validationSets indices.
 *
 * Convention: `<dataset>/output/Set 1`, `Set 2`, … (1-based). Ignores sibling
 * folders that are not set-like (e.g. a nested copy named like the dataset).
 * Supports 0-based and 1-based folder numbering.
 */
export function orderOutputSetFolders(
  folderNames: readonly string[],
  validationSetCount: number,
): string[] {
  const expected = (count: number) =>
    Array.from({ length: count }, (_, i) => `Set ${i + 1}`);

  const names = [
    ...new Set(
      folderNames
        .map((n) => n.trim())
        // Set folders are single path segments under output/ — never nested.
        .filter((n) => Boolean(n) && !/[\\/]/.test(n)),
    ),
  ];

  if (validationSetCount > 0 && names.length === 0) {
    return expected(validationSetCount);
  }
  if (names.length === 0) return [];

  const withIndex = names
    .map((name) => ({ name, index: parseOutputSetFolderIndex(name) }))
    .filter((row): row is { name: string; index: number } => row.index != null);

  // Prefer set-like folders only — do not fall back to alphabetical siblings
  // like `<dataset-name>` under output/.
  if (withIndex.length > 0) {
    const min = Math.min(...withIndex.map((r) => r.index));
    const offset = min === 1 && !withIndex.some((r) => r.index === 0) ? 1 : 0;
    const byIndex = new Map<number, string>();
    for (const row of withIndex) {
      const idx = row.index - offset;
      if (idx < 0) continue;
      const prev = byIndex.get(idx);
      // Prefer canonical "Set N" when several names map to the same index.
      if (!prev || /^set\s*\d+$/i.test(row.name.trim())) {
        byIndex.set(idx, row.name);
      }
    }
    const count =
      validationSetCount > 0 ? validationSetCount : Math.max(...byIndex.keys()) + 1;
    return Array.from({ length: count }, (_, i) => byIndex.get(i) ?? `Set ${i + 1}`);
  }

  if (validationSetCount > 0) {
    return expected(validationSetCount);
  }
  return [...names].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

export function validationSetLabel(
  meta: DatasetValidationSetMeta | undefined,
  folderName: string,
  index: number,
): string {
  const prompt = meta?.prompt?.trim();
  if (prompt) {
    const short = prompt.length > 48 ? `${prompt.slice(0, 48)}…` : prompt;
    return `Set ${index + 1} · ${short}`;
  }
  // Folders are already named "Set N" — don't repeat "Set 1 · Set 1".
  if (/^set\s*\d+$/i.test(folderName.trim())) {
    return `Set ${index + 1}`;
  }
  return `Set ${index + 1} · ${folderName}`;
}

/**
 * True when a file basename is a training-step `.safetensors` for this series
 * (`Base_0001000.safetensors` / `Base-0001000.safetensors`).
 */
export function safetensorsFileMatchesSeries(
  fileName: string,
  seriesBase: string,
  separator: '_' | '-',
): boolean {
  const base = fileName.trim().split(/[\\/]/).pop() ?? '';
  if (!base || !SAFETENSORS_EXT_RE.test(base)) return false;
  const stem = base.replace(SAFETENSORS_EXT_RE, '');
  const parsed = parseLoraTrainingStep(stem);
  if (!parsed) return false;
  return (
    parsed.seriesBase.toLowerCase() === seriesBase.trim().toLowerCase() &&
    parsed.separator === separator
  );
}

/**
 * Whether `loraRelativePosix` sits under `<datasetRelative>/output/…`.
 * Dataset folders are identified by locating the LoRA file, not by name.
 */
export function trainingLoraIsUnderDatasetOutput(
  datasetRelativePosix: string,
  loraRelativePosix: string,
): boolean {
  const dataset = datasetRelativePosix
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '');
  const lora = loraRelativePosix.replaceAll('\\', '/').replace(/^\/+/, '');
  const prefix = dataset ? `${dataset}/` : '';
  if (dataset && !lora.toLowerCase().startsWith(prefix.toLowerCase())) {
    return false;
  }
  const rest = dataset ? lora.slice(prefix.length) : lora;
  const segments = rest.split('/').filter(Boolean);
  // last segment is the filename
  if (segments.length < 2) return false;
  return segments.slice(0, -1).some((s) => s.toLowerCase() === 'output');
}

/**
 * From a training-library-relative LoRA path, list ancestor dirs (deepest first)
 * that should be checked for `dataset.json`.
 */
export function datasetAncestorRelativePaths(
  loraRelativePosix: string,
): string[] {
  const parts = loraRelativePosix
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean);
  if (parts.length === 0) return [];
  parts.pop(); // filename
  const out: string[] = [];
  for (let i = parts.length; i >= 0; i--) {
    out.push(parts.slice(0, i).join('/'));
  }
  return out;
}
