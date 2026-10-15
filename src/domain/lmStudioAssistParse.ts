/**
 * Parse LM Studio assist replies that are supposed to be JSON but often aren’t
 * (unquoted keys, fences, thinking wrappers, truncated braces).
 */

export type LmStudioAssistParsed = {
  mode: 'review' | 'edit';
  summary: string;
  notes: string;
  proposedText: string | null;
};

function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, '')
    .trim();
}

function tryJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Common LLM “JSON-ish” repairs for our small schema. */
export function repairLooseJson(text: string): string {
  let s = text.trim();
  // // line comments
  s = s.replace(/^\s*\/\/.*$/gm, '');
  // trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');
  // {'key': -> {"key":
  s = s.replace(/([{,]\s*)'([^'\\]+)'(\s*:)/g, '$1"$2"$3');
  // {key: or , key: -> {"key":
  s = s.replace(/([{,]\s*)([A-Za-z_][\w]*)(\s*:)/g, '$1"$2"$3');
  return s;
}

function candidatesFromRaw(raw: string): string[] {
  const trimmed = stripThinkBlocks(raw).trim();
  const out: string[] = [];
  const push = (value: string | undefined | null) => {
    const v = value?.trim();
    if (v && !out.includes(v)) out.push(v);
  };

  push(trimmed);

  const fenced = trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  for (const match of fenced) push(match[1]);

  // Balanced-ish object slices (outermost and each `{...}` start)
  const starts: number[] = [];
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === '{') starts.push(i);
  }
  for (const start of starts.slice(0, 8)) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          push(trimmed.slice(start, i + 1));
          break;
        }
      }
    }
  }

  // Last-resort naive slice (may include broken strings)
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) push(trimmed.slice(first, last + 1));

  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readStringField(
  row: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

/**
 * When JSON.parse still fails (often because proposedText has raw newlines),
 * pull known fields with a tolerant scanner.
 */
export function extractAssistFieldsLoose(
  text: string,
): Record<string, unknown> | null {
  const src = stripThinkBlocks(text);
  const modeMatch = src.match(
    /["']?mode["']?\s*:\s*["']?(review|edit)["']?/i,
  );
  if (!modeMatch) return null;

  const out: Record<string, unknown> = {
    mode: modeMatch[1].toLowerCase(),
  };

  const summary = matchJsonishString(src, 'summary');
  if (summary != null) out.summary = summary;
  const notes =
    matchJsonishString(src, 'notes') ?? matchJsonishString(src, 'analysis');
  if (notes != null) out.notes = notes;
  const proposed = matchJsonishString(src, 'proposedText');
  if (proposed != null) out.proposedText = proposed;

  return out;
}

/**
 * Read a string-valued field that may use "…", '…', or an unescaped multiline
 * value terminated by the next known key / object end.
 */
function matchJsonishString(src: string, key: string): string | null {
  const keyRe = new RegExp(
    `["']?${key}["']?\\s*:\\s*`,
    'i',
  );
  const keyMatch = keyRe.exec(src);
  if (!keyMatch || keyMatch.index == null) return null;
  let i = keyMatch.index + keyMatch[0].length;
  while (i < src.length && /\s/.test(src[i])) i += 1;
  if (i >= src.length) return null;

  const quote = src[i];
  if (quote === '"' || quote === "'") {
    i += 1;
    let out = '';
    let escape = false;
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (escape) {
        if (ch === 'n') out += '\n';
        else if (ch === 'r') out += '\r';
        else if (ch === 't') out += '\t';
        else out += ch;
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === quote) return out;
      out += ch;
    }
    return out;
  }

  // Bare / broken multiline: read until ,\n"nextKey" or end brace.
  const stop = src.slice(i).search(
    /\n\s*,?\s*["']?(?:mode|summary|notes|analysis|proposedText)["']?\s*:|\n\s*}\s*$/,
  );
  if (stop < 0) {
    const end = src.lastIndexOf('}');
    return end > i ? src.slice(i, end).replace(/,?\s*$/, '').trim() : null;
  }
  return src
    .slice(i, i + stop)
    .replace(/,?\s*$/, '')
    .trim();
}

function normalizeParsed(row: Record<string, unknown>): LmStudioAssistParsed {
  const mode = row.mode === 'edit' ? 'edit' : 'review';
  const summary = readStringField(row, 'summary').trim();
  const notes = readStringField(row, 'notes', 'analysis').trim();
  let proposedText: string | null = null;
  if (mode === 'edit') {
    const raw = readStringField(row, 'proposedText');
    if (raw) {
      proposedText = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const inner = proposedText.match(/^```(?:\w+)?\n([\s\S]*)\n```$/);
      if (inner?.[1] != null) proposedText = inner[1];
    }
  }
  return {
    mode,
    summary:
      summary ||
      (mode === 'edit' ? 'Proposed file edits' : 'Review complete'),
    notes,
    proposedText,
  };
}

/**
 * Parse an assistant message into the assist payload.
 * Tries strict JSON, repaired JSON, then loose field extraction.
 */
export function parseLmStudioAssistResponse(raw: string): LmStudioAssistParsed {
  const snippets = candidatesFromRaw(raw);
  for (const snippet of snippets) {
    for (const variant of [snippet, repairLooseJson(snippet)]) {
      const parsed = asRecord(tryJsonParse(variant));
      if (parsed && ('mode' in parsed || 'proposedText' in parsed || 'summary' in parsed)) {
        return normalizeParsed(parsed);
      }
    }
    const loose = extractAssistFieldsLoose(snippet);
    if (loose) return normalizeParsed(loose);
  }

  const preview = stripThinkBlocks(raw).replace(/\s+/g, ' ').slice(0, 180);
  throw new Error(
    `Model response was not valid JSON${
      preview ? ` (got: ${preview}${preview.length >= 180 ? '…' : ''})` : ''
    }`,
  );
}
