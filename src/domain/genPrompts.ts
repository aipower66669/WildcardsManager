/**
 * Decode `!gen.txt` bodies into prompt entries.
 *
 * A line that starts with `,` after leading whitespace continues the previous
 * prompt (joined inline) when that previous line is not empty. A blank line
 * breaks the continuation. `#` comments are ignored and are not empty lines.
 *
 * Leading tags (any order, stripped from the prompt text):
 * - {@link GEN_TESTING_TAG} — preferred by {@link pickGenPrompt} for debugging
 * - `[xN]` / `[W=N]` / `[WEIGHT=N]` — expand the prompt into N copies so it
 *   is relatively more likely to be picked
 */

/** Prefix that forces Generation to pick this prompt instead of a random line. */
export const GEN_TESTING_TAG = '[TESTING]';

const GEN_TESTING_TAG_RE = /^\[TESTING\]\s*/i;

/** `[x3]`, `[W=3]`, `[WEIGHT=3]` — integer weight at the start of a prompt. */
const GEN_WEIGHT_TAG_RE = /^\[(?:x|w=|weight=)(\d+)\]\s*/i;

/** Cap accidental huge weights (e.g. `[x999999]`). */
const GEN_WEIGHT_MAX = 1000;

/** True when a decoded prompt is marked for forced pick (case-insensitive). */
export function isTestingGenPrompt(prompt: string): boolean {
  return GEN_TESTING_TAG_RE.test(prompt.trimStart());
}

/** Strip a leading `[TESTING]` marker (and following spaces) from a prompt. */
export function stripTestingGenTag(prompt: string): string {
  return prompt.trimStart().replace(GEN_TESTING_TAG_RE, '');
}

/**
 * First decoded prompt marked `[TESTING]`, or null when none.
 * The returned string still includes the tag — strip before expanding.
 */
export function findTestingGenPrompt(
  prompts: readonly string[],
): string | null {
  for (const prompt of prompts) {
    if (isTestingGenPrompt(prompt)) return prompt;
  }
  return null;
}

export type GenPromptLeadTags = {
  /** Prompt text with leading TESTING / weight tags removed. */
  body: string;
  /** Copy count from a weight tag; default 1. 0 means omit the prompt. */
  weight: number;
  /** True when a `[TESTING]` tag was present. */
  testing: boolean;
};

/**
 * Peel leading `[TESTING]` and/or `[xN]`/`[W=N]`/`[WEIGHT=N]` tags (any order).
 * Only the first weight tag is honored.
 */
export function parseGenPromptLeadTags(prompt: string): GenPromptLeadTags {
  let rest = prompt.trimStart();
  let weight = 1;
  let testing = false;
  let sawWeight = false;
  for (;;) {
    const testingMatch = GEN_TESTING_TAG_RE.exec(rest);
    if (testingMatch) {
      testing = true;
      rest = rest.slice(testingMatch[0].length);
      continue;
    }
    const weightMatch = GEN_WEIGHT_TAG_RE.exec(rest);
    if (weightMatch && !sawWeight) {
      sawWeight = true;
      const n = Number(weightMatch[1]);
      weight = Number.isFinite(n)
        ? Math.max(0, Math.min(GEN_WEIGHT_MAX, Math.floor(n)))
        : 1;
      rest = rest.slice(weightMatch[0].length);
      continue;
    }
    break;
  }
  return { body: rest, weight, testing };
}

/**
 * Apply weight expansion: one logical prompt → `weight` copies (tags stripped
 * except `[TESTING]`, which is kept until pick/Comfy strip).
 */
export function expandWeightedGenPrompt(prompt: string): string[] {
  const { body, weight, testing } = parseGenPromptLeadTags(prompt);
  if (weight < 1) return [];
  const trimmedBody = body.trim();
  if (!trimmedBody) return [];
  const entry = testing ? `${GEN_TESTING_TAG} ${trimmedBody}` : trimmedBody;
  if (weight === 1) return [entry];
  return Array.from({ length: weight }, () => entry);
}

/**
 * Decode a `!gen.txt` body into prompt entries (continuations joined, then
 * weight tags expanded into duplicate slots).
 */
export function decodeGenPrompts(content: string): string[] {
  const prompts: string[] = [];
  let previousLineEmpty = true;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      previousLineEmpty = true;
      continue;
    }
    if (line.startsWith('#')) {
      previousLineEmpty = false;
      continue;
    }
    if (line.startsWith(',') && prompts.length > 0 && !previousLineEmpty) {
      prompts[prompts.length - 1] = `${prompts[prompts.length - 1]}${line}`;
    } else {
      prompts.push(line);
    }
    previousLineEmpty = false;
  }
  return prompts.flatMap(expandWeightedGenPrompt);
}

/**
 * Append a finished prompt to a `!gen.txt` body when that exact prompt is not
 * already present (after decode). Blank prompt → no-op.
 */
export function appendGenPromptIfMissing(
  content: string,
  prompt: string,
): {
  content: string;
  added: boolean;
  alreadyExists: boolean;
} {
  const block = prompt.trim();
  if (!block) {
    return { content, added: false, alreadyExists: false };
  }
  const incoming = decodeGenPrompts(block);
  if (incoming.length === 0) {
    return { content, added: false, alreadyExists: false };
  }
  const existing = new Set(decodeGenPrompts(content));
  if (incoming.every((entry) => existing.has(entry))) {
    return { content, added: false, alreadyExists: true };
  }
  const trimmedEnd = content.replace(/\s+$/u, '');
  const next =
    trimmedEnd.length === 0 ? `${block}\n` : `${trimmedEnd}\n\n${block}\n`;
  return { content: next, added: true, alreadyExists: false };
}

/** Seeded PRNG in [0, 1). Same seed → same sequence. */
export function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick one prompt with a seeded RNG (same seed → same index).
 * If any entry starts with `[TESTING]`, that line wins (tag stripped) so a
 * single prompt can be debugged without commenting out the rest.
 * Weight tags are already expanded by {@link decodeGenPrompts}.
 */
export function pickGenPrompt(prompts: string[], seed: number): string {
  if (prompts.length === 0) {
    throw new Error('!gen.txt has no usable prompts');
  }
  const testing = findTestingGenPrompt(prompts);
  if (testing != null) {
    const stripped = stripTestingGenTag(testing).trim();
    if (!stripped) {
      throw new Error('!gen.txt [TESTING] prompt is empty after the tag');
    }
    return stripped;
  }
  const rng = createMulberry32(seed >>> 0);
  const idx = Math.floor(rng() * prompts.length);
  return prompts[idx]!;
}

/**
 * Treat `content` as a `!gen.txt` body, then return one prompt from that list.
 * Comments, blank lines, and comma continuations are resolved before the pick.
 */
export function chooseGenPrompt(content: string, seed: number): string {
  return pickGenPrompt(decodeGenPrompts(content), seed);
}
