/**
 * Per-library prompt substitutions applied before wildcard expansion.
 * A rule fires when the checkpoint file name contains `modelContains`.
 */

export type PromptSubstitution = {
  /** Case-insensitive substring of the checkpoint file name (extension ignored). */
  modelContains: string;
  /** Exact text replaced in the prompt. Case-sensitive. */
  find: string;
  /** Written in place of every `find` match. */
  replace: string;
};

const MAX_RULES = 200;
const MAX_MODEL = 200;
const MAX_TEXT = 2000;

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** Drop incomplete or non-object rows. Keeps list order. */
export function normalizePromptSubstitutions(raw: unknown): PromptSubstitution[] {
  if (!Array.isArray(raw)) return [];
  const out: PromptSubstitution[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const modelContains = clip(
      typeof row.modelContains === 'string' ? row.modelContains.trim() : '',
      MAX_MODEL,
    );
    const find = clip(typeof row.find === 'string' ? row.find : '', MAX_TEXT);
    const replace = clip(
      typeof row.replace === 'string' ? row.replace : '',
      MAX_TEXT,
    );
    if (!modelContains || find.length === 0) continue;
    out.push({ modelContains, find, replace });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

/**
 * Checkpoint file name used for “model contains”: the last path segment
 * without its extension. Parent folders are not part of the name.
 */
export function checkpointNameForSubstitution(relativePath: string): string {
  const normalized = relativePath.trim().replaceAll('\\', '/');
  const base = normalized.split('/').filter(Boolean).pop() ?? '';
  return base.replace(/\.[^./]+$/, '');
}

/**
 * Apply every rule whose keyword is in the checkpoint file name, in order.
 * Later rules see earlier replacements. Find is an exact, case-sensitive
 * substring; every non-overlapping match is replaced once.
 */
export function applyPromptSubstitutions(
  prompt: string,
  checkpointRelativePath: string,
  rules: readonly PromptSubstitution[],
): string {
  if (!prompt || rules.length === 0) return prompt;
  const name = checkpointNameForSubstitution(checkpointRelativePath).toLowerCase();
  if (!name) return prompt;
  let text = prompt;
  for (const rule of rules) {
    const needle = rule.modelContains.trim().toLowerCase();
    if (!needle || !rule.find) continue;
    if (!name.includes(needle)) continue;
    if (!text.includes(rule.find)) continue;
    text = text.split(rule.find).join(rule.replace);
  }
  return text;
}
