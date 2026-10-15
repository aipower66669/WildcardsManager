import type { ValidationPlatform } from './platformValidation.js';

/**
 * True when a `__name__` body contains Dynamic Prompts variant logic that
 * Stable Diffusion expands before (or as) the wildcard lookup, e.g.
 * `__where{|-indoor}__` or `__color(|-basic)__` (paren delimiters when `{`/`}`
 * are remapped).
 */
export function hasDynamicWildcardLogic(name: string): boolean {
  return /[{}|]|\$\$/.test(name);
}

function findMatchingDelim(
  text: string,
  openIndex: number,
  open: string,
  close: string,
): number {
  if (text[openIndex] !== open) return -1;
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Body contains a top-level `|` (variant), not just `(key=value)` params. */
function bodyHasTopLevelPipe(body: string): boolean {
  let brace = 0;
  let paren = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (ch === '{') brace += 1;
    else if (ch === '}') brace = Math.max(0, brace - 1);
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === '|' && brace === 0 && paren === 0) return true;
  }
  return false;
}

/**
 * Split options at top-level `|`, respecting nested `{}` and `()`.
 */
function splitOptions(body: string): string[] {
  const parts: string[] = [];
  let brace = 0;
  let paren = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (ch === '{') brace += 1;
    else if (ch === '}') brace = Math.max(0, brace - 1);
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === '|' && brace === 0 && paren === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

function stripOptionDecorators(option: string): string {
  let text = option.trim();
  // weight prefix: 2::value or 0.5::value
  text = text.replace(/^\d+(?:\.\d+)?::/, '');
  return text.trim();
}

function optionsFromVariantBody(body: string): string[] {
  let rest = body.trim();
  // Drop multi-select header: N$$, N-M$$, optional custom separator $$sep$$
  const multi = /^(-?\d*(?:-\d*)?)\$\$(?:([^$]*)\$\$)?/.exec(rest);
  if (multi) rest = rest.slice(multi[0].length);
  return splitOptions(rest).map(stripOptionDecorators);
}

type Part = { type: 'lit'; text: string } | { type: 'var'; options: string[] };

function tokenizeDynamicWildcardName(name: string): Part[] {
  const parts: Part[] = [];
  let literal = '';
  const flush = () => {
    if (literal) {
      parts.push({ type: 'lit', text: literal });
      literal = '';
    }
  };

  let i = 0;
  while (i < name.length) {
    const ch = name[i]!;
    if (ch === '{' || ch === '(') {
      const open = ch;
      const close = ch === '{' ? '}' : ')';
      const end = findMatchingDelim(name, i, open, close);
      if (end === -1) {
        literal += ch;
        i += 1;
        continue;
      }
      const body = name.slice(i + 1, end);
      if (bodyHasTopLevelPipe(body)) {
        flush();
        parts.push({ type: 'var', options: optionsFromVariantBody(body) });
        i = end + 1;
        continue;
      }
      // Parameterized template call, e.g. (season=winter) — keep literal.
      literal += name.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    literal += ch;
    i += 1;
  }
  flush();
  return parts;
}

/**
 * Expand Dynamic Prompts logic inside a wildcard body into concrete names.
 * `__color(|-basic)__` → `color`, `color-basic` (same as `{__color__|__color-basic__}`).
 * Names without variant groups are returned unchanged as a single-element list.
 */
export function expandDynamicWildcardName(name: string): string[] {
  if (!hasDynamicWildcardLogic(name)) return [name];

  const parts = tokenizeDynamicWildcardName(name);
  if (!parts.some((part) => part.type === 'var')) {
    // e.g. bare `|` or `$$` without a delimited group — leave as-is.
    return [name];
  }

  let combos = [''];
  for (const part of parts) {
    if (part.type === 'lit') {
      combos = combos.map((prefix) => prefix + part.text);
      continue;
    }
    const next: string[] = [];
    for (const prefix of combos) {
      for (const option of part.options) {
        next.push(prefix + option);
      }
    }
    combos = next;
  }

  // Recurse so nested leftover groups inside options still expand.
  const expanded = new Set<string>();
  for (const combo of combos) {
    if (combo !== name && hasDynamicWildcardLogic(combo)) {
      for (const nested of expandDynamicWildcardName(combo)) {
        expanded.add(nested);
      }
    } else {
      expanded.add(combo);
    }
  }
  return [...expanded];
}

/**
 * Names to resolve for graph/validation. ComfyUI keeps the literal (invalid)
 * key so callers can skip file lookup when dynamic logic is present.
 */
export function wildcardNamesForPlatform(
  name: string,
  platform: ValidationPlatform,
): { names: string[]; dynamic: boolean } {
  const dynamic = hasDynamicWildcardLogic(name);
  if (!dynamic) return { names: [name], dynamic: false };
  if (platform === 'comfyui') return { names: [name], dynamic: true };
  return { names: expandDynamicWildcardName(name), dynamic: true };
}
