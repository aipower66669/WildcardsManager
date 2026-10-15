import { sanitizeDownloadCategoryName } from './civitaiCategory.js';
import { LORA_CLIPBOARD_WEIGHTS } from './civitaiSnippet.js';
import {
  extendLoraSeriesStepsForSeries,
  libraryReferencesLoraSeries,
} from './loraSeriesExtend.js';

export type LoraDownloadCategory = {
  id: string;
  name: string;
  /** Subfolder under the LoRA root (relative; may be nested). */
  folder: string;
  /** Library-relative wildcard path, e.g. `styles/realism.txt`. */
  wildcardRelativePath: string;
  /** Dynamic Prompts weight pattern, e.g. `{0.8|0.9|1}` or `0.8`. */
  defaultWeights: string;
};

export const DEFAULT_LORA_DOWNLOAD_WEIGHTS = LORA_CLIPBOARD_WEIGHTS;

/** Normalize a library-relative wildcard path. */
export function normalizeWildcardRelativePath(raw: string): string {
  return raw.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
}

/**
 * Accept Dynamic Prompts-style weights: `{0.8|0.9|1}`, `0.8`, `-0.5`,
 * `{3|4|5}`, or `0.7|0.8`. Any finite number is allowed.
 * Returns normalized string or null if invalid.
 */
export function normalizeLoraWeights(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, '');
  if (!trimmed) return null;
  const inner = trimmed.startsWith('{') && trimmed.endsWith('}')
    ? trimmed.slice(1, -1)
    : trimmed;
  if (!inner) return null;
  const parts = inner.split('|');
  if (parts.length === 0) return null;
  for (const part of parts) {
    if (!/^-?\d+(\.\d+)?$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
  }
  return parts.length === 1 ? parts[0]! : `{${parts.join('|')}}`;
}

export function parseLoraDownloadCategory(
  raw: unknown,
): LoraDownloadCategory | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : null;
  const name =
    typeof row.name === 'string' && row.name.trim() ? row.name.trim() : null;
  const folder = sanitizeDownloadCategoryName(
    typeof row.folder === 'string' ? row.folder : '',
  );
  const wildcardRelativePath = normalizeWildcardRelativePath(
    typeof row.wildcardRelativePath === 'string' ? row.wildcardRelativePath : '',
  );
  const weightsRaw =
    typeof row.defaultWeights === 'string' ? row.defaultWeights : '';
  const defaultWeights =
    normalizeLoraWeights(weightsRaw) ?? DEFAULT_LORA_DOWNLOAD_WEIGHTS;
  if (!id || !name || !folder || !wildcardRelativePath) return null;
  return { id, name, folder, wildcardRelativePath, defaultWeights };
}

export function parseLoraDownloadCategories(raw: unknown): LoraDownloadCategory[] {
  if (!Array.isArray(raw)) return [];
  const out: LoraDownloadCategory[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const cat = parseLoraDownloadCategory(item);
    if (!cat || seen.has(cat.id)) continue;
    seen.add(cat.id);
    out.push(cat);
  }
  return out;
}

/**
 * Extra LoRA category ids for wildcard append only (primary still owns the
 * download folder). Drops blanks, duplicates, and the primary id.
 */
export function uniqueExtraLoraCategoryIds(
  primaryId: string | undefined,
  extras: readonly string[] | undefined,
): string[] {
  const primary = (primaryId ?? '').trim();
  const seen = new Set<string>(primary ? [primary] : []);
  const out: string[] = [];
  for (const raw of extras ?? []) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export type LoraWildcardSeriesOp = {
  seriesBase: string;
  separator: '_' | '-';
  stepDigitsList: readonly string[];
};

/** Apply a category snippet to a live or in-memory wildcard buffer. */
export type LoraWildcardBufferOp =
  | { type: 'append'; snippet: string; fileStem: string }
  | {
      type: 'upsert';
      snippet: string;
      fileStem: string;
      series?: LoraWildcardSeriesOp;
    };

export function applyLoraWildcardBufferOp(
  existing: string,
  op: LoraWildcardBufferOp,
): { text: string; changed: boolean } {
  if (op.type === 'upsert') {
    const result = upsertLoraSnippetIntoWildcardText({
      existing,
      snippet: op.snippet,
      fileStem: op.fileStem,
      series: op.series,
    });
    return { text: result.text, changed: result.mode !== 'unchanged' };
  }
  const result = appendLoraSnippetToWildcardText(
    existing,
    op.snippet,
    op.fileStem,
  );
  return { text: result.text, changed: result.appended };
}

/**
 * Append a LoRA snippet to wildcard text. Skips if an identical `<lora:stem:`
 * line already exists. Ensures a blank line before the new block when needed.
 */
export function appendLoraSnippetToWildcardText(
  existing: string,
  snippet: string,
  fileStem: string,
): { text: string; appended: boolean } {
  const stem = fileStem.trim();
  const loraLineRe = new RegExp(
    `<lora:${escapeRegExp(stem)}:`,
    'i',
  );
  if (loraLineRe.test(existing)) {
    return { text: existing, appended: false };
  }

  const block = snippet.trimEnd();
  if (!block) return { text: existing, appended: false };

  let base = existing.replace(/\s+$/u, '');
  if (base.length > 0) {
    base += '\n\n';
  }
  return { text: `${base}${block}\n`, appended: true };
}

/**
 * Prefer updating an existing training-step series root in the target file
 * (extend step braces) over appending a second `<lora:…>` block.
 */
export function upsertLoraSnippetIntoWildcardText(opts: {
  existing: string;
  snippet: string;
  fileStem: string;
  series?: {
    seriesBase: string;
    separator: '_' | '-';
    stepDigitsList: readonly string[];
  };
}): {
  text: string;
  mode: 'extended' | 'appended' | 'unchanged';
  summary?: string;
} {
  const series = opts.series;
  if (series && series.stepDigitsList.length > 0) {
    const ext = extendLoraSeriesStepsForSeries(
      opts.existing,
      series.seriesBase,
      series.separator,
      series.stepDigitsList,
    );
    if (ext.changed) {
      return { text: ext.text, mode: 'extended', summary: ext.summary };
    }
    // Series root already present (steps already covered) — do not append a
    // second pick with a different brace list.
    if (
      libraryReferencesLoraSeries(
        [opts.existing],
        series.seriesBase,
        series.separator,
      )
    ) {
      return { text: opts.existing, mode: 'unchanged' };
    }
  }

  const append = appendLoraSnippetToWildcardText(
    opts.existing,
    opts.snippet,
    opts.fileStem,
  );
  if (append.appended) {
    return { text: append.text, mode: 'appended' };
  }
  return { text: opts.existing, mode: 'unchanged' };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
