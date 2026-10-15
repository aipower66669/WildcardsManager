/** Fixed Dynamic Prompts weight options copied with downloaded LoRAs. */
export const LORA_CLIPBOARD_WEIGHTS = '{0.8|0.9|1|1}';

export const CIVITAI_ORIGINS = [
  'https://civitai.com',
  'https://civitai.red',
] as const;

export type CivitaiOrigin = (typeof CIVITAI_ORIGINS)[number];

export const DEFAULT_CIVITAI_ORIGIN: CivitaiOrigin = 'https://civitai.com';

export function normalizeCivitaiOrigin(raw: string | null | undefined): CivitaiOrigin {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (trimmed === 'https://civitai.red') return 'https://civitai.red';
  return DEFAULT_CIVITAI_ORIGIN;
}

/** URL slug for a Civitai model page (`/models/{id}/{slug}`). */
export function civitaiModelSlug(modelName: string, modelId: number): string {
  const slug = modelName
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || String(modelId);
}

export function civitaiModelPageUrl(
  origin: string,
  modelId: number,
  modelName: string,
): string {
  const base = normalizeCivitaiOrigin(origin);
  return `${base}/models/${modelId}/${civitaiModelSlug(modelName, modelId)}`;
}

export type ParsedCivitaiModelPageUrl = {
  origin: CivitaiOrigin;
  modelId: number;
  /** Trailing slug if present (may be empty). */
  slug?: string;
};

/**
 * Parse a Civitai / civitai.red model page URL into origin + model id.
 * Accepts `/models/{id}` and `/models/{id}/{slug}` (query/hash ignored).
 */
export function parseCivitaiModelPageUrl(
  raw: string,
): ParsedCivitaiModelPageUrl | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  let origin: CivitaiOrigin | null = null;
  if (host === 'civitai.com' || host === 'www.civitai.com') {
    origin = 'https://civitai.com';
  } else if (host === 'civitai.red' || host === 'www.civitai.red') {
    origin = 'https://civitai.red';
  }
  if (!origin) return null;

  const match = url.pathname.match(/^\/models\/(\d+)(?:\/([^/]*))?\/?$/i);
  if (!match?.[1]) return null;
  const modelId = Number(match[1]);
  if (!Number.isFinite(modelId) || modelId <= 0) return null;
  const slug = match[2]?.trim() || undefined;
  return { origin, modelId, slug };
}

const CIVITAI_MODEL_URL_IN_TEXT_RE =
  /https?:\/\/(?:www\.)?civitai\.(?:com|red)\/models\/\d+(?:\/[^\s#]*)?/i;

/** Pull a model-page URL out of a comment or plain line, if present. */
export function parseCivitaiModelUrlFromLine(
  line: string,
): ParsedCivitaiModelPageUrl | null {
  const trimmed = line.trim().replace(/^#\s*/, '');
  if (!trimmed) return null;
  const embedded = CIVITAI_MODEL_URL_IN_TEXT_RE.exec(trimmed)?.[0];
  return parseCivitaiModelPageUrl(embedded ?? trimmed);
}

/**
 * Find a Civitai model URL on the previous non-empty line (or the one before
 * that) above a character offset — the usual `# https://civitai…` comment
 * sitting above a pasted `<lora:…>` tag.
 */
export function findCivitaiModelUrlAbove(
  text: string,
  offset: number,
): ParsedCivitaiModelPageUrl | null {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const safeOffset = Math.max(0, Math.min(offset, normalized.length));
  const lineStart = normalized.lastIndexOf('\n', Math.max(0, safeOffset - 1));
  let cursor = lineStart < 0 ? 0 : lineStart;

  let checked = 0;
  while (cursor > 0 && checked < 2) {
    const prevBreak = normalized.lastIndexOf('\n', cursor - 1);
    const from = prevBreak < 0 ? 0 : prevBreak + 1;
    const line = normalized.slice(from, cursor);
    cursor = prevBreak < 0 ? 0 : prevBreak;
    if (!line.trim()) continue;
    checked += 1;
    const parsed = parseCivitaiModelUrlFromLine(line);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Clipboard / wildcard snippet for a LoRA download:
 *   # <civitai url>
 *   # optional extra comment line(s)
 *   <lora:stem:weights> [triggers] [extra prompt]
 */
export function buildLoraClipboardSnippet(opts: {
  origin: string;
  modelId: number;
  modelName: string;
  fileStem: string;
  trainedWords?: string[] | null;
  /** Override default `{0.8|0.9|1|1}` weights. */
  weights?: string | null;
  /**
   * Optional note between the URL comment and the `<lora:…>` line
   * (e.g. slider value guidance). Blank lines ignored; `# ` prefixed if missing.
   */
  extraComment?: string | null;
  /**
   * Optional prompt text after trained-word triggers on the `<lora:…>` line
   * (e.g. lighting / atmosphere tags).
   */
  extraPrompt?: string | null;
}): string {
  const url = civitaiModelPageUrl(opts.origin, opts.modelId, opts.modelName);
  const stem = opts.fileStem.trim();
  const words = (opts.trainedWords ?? [])
    .map((w) => w.trim())
    .filter(Boolean);
  let triggers = '';
  if (words.length === 1) {
    triggers = ` ${words[0]}`;
  } else if (words.length > 1) {
    // Dynamic Prompts: pick 1..N of the keywords (not exclusively one).
    triggers = ` {1-${words.length}$$${words.join(' | ')}}`;
  }
  const weights =
    typeof opts.weights === 'string' && opts.weights.trim()
      ? opts.weights.trim()
      : LORA_CLIPBOARD_WEIGHTS;

  const lines: string[] = [`# ${url}`];
  for (const comment of formatLoraSnippetCommentLines(opts.extraComment)) {
    lines.push(comment);
  }

  const loraLine = appendLoraExtraPrompt(
    `<lora:${stem}:${weights}>${triggers}`,
    opts.extraPrompt,
  );
  lines.push(loraLine);
  return lines.join('\n');
}

/**
 * Append optional extra prompt text after existing triggers/keywords on a
 * `<lora:…>` line. When there is already prompt content after `>`, join with
 * `, ` (and collapse any user-supplied leading/trailing commas so we never
 * emit `,,`).
 */
export function appendLoraExtraPrompt(
  loraLine: string,
  extraPrompt: string | null | undefined,
): string {
  let extra = (extraPrompt ?? '').trim();
  if (!extra) return loraLine;

  const close = loraLine.lastIndexOf('>');
  const afterTag = close >= 0 ? loraLine.slice(close + 1) : '';
  if (!afterTag.trim()) {
    extra = extra.replace(/^[\s,]+/, '');
    if (!extra) return loraLine;
    return `${loraLine} ${extra}`;
  }

  const base = loraLine.replace(/[\s,]+$/, '');
  extra = extra.replace(/^[\s,]+/, '');
  if (!extra) return base;
  return `${base}, ${extra}`;
}

/** Normalize optional multi-line comment text into `# …` lines. */
export function formatLoraSnippetCommentLines(
  raw: string | null | undefined,
): string[] {
  if (!raw?.trim()) return [];
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .map((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith('#') ? trimmed : `# ${trimmed}`;
    });
}
