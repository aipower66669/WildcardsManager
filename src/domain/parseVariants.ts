import type { SyntaxIssue } from './types.js';

/** Count top-level `$$` runs in a brace body prefix (nested `{…}` ignored). */
function countTopLevelDoubleDollars(bodyPrefix: string): number {
  let depth = 0;
  let count = 0;
  for (let i = 0; i < bodyPrefix.length; i++) {
    const ch = bodyPrefix[i]!;
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0 || ch !== '$') continue;
    let dollars = 0;
    while (i < bodyPrefix.length && bodyPrefix[i] === '$') {
      dollars += 1;
      i += 1;
    }
    i -= 1;
    if (dollars === 2) count += 1;
  }
  return count;
}

/** Valid multi-select range prefix before the first `$$`: empty, N, N-M, -M, N-. */
function isValidMultiselectRange(rangeRaw: string): boolean {
  const range = rangeRaw.trim();
  if (range === '') return true;
  return /^-?\d*(?:-\d*)?$/.test(range);
}

/**
 * Depth-aware validation of `{ … }` variants, `|` options, `$$` multi-select,
 * and matching `()` / `[]` / `"` delimiters (Dynamic Prompts + attention syntax).
 * Does not expand — Phase 1 only flags structural problems.
 *
 * Supported multi-select forms (Dynamic Prompts):
 * - `{2$$a|b|c}` / `{1-2$$a|b}` / `{$$a|b}` — count then options
 * - `{2$$ and $$a|b}` / `{2$$-$$a|b}` / `{2$$ $$a|b}` — custom separator
 *   between the two `$$` markers (spaces allowed inside the separator)
 */
export function validateVariantSyntax(
  text: string,
  line: number,
): SyntaxIssue[] {
  const issues: SyntaxIssue[] = [];
  let depth = 0;
  /** Index of each unmatched `{` (stack parallel to depth). */
  const braceStarts: number[] = [];
  const parenStarts: number[] = [];
  const bracketStarts: number[] = [];
  let inDoubleQuote = false;
  let doubleQuoteStart = -1;
  let i = 0;

  const snippetAround = (from: number, to = from + 1) =>
    text.slice(Math.max(0, from - 4), Math.min(text.length, to + 24));

  const snippetFrom = (from: number) => {
    const raw = text.slice(from, Math.min(text.length, from + 48));
    return raw.replace(/\s+/g, ' ').trim() || text.slice(from, from + 1);
  };

  while (i < text.length) {
    const ch = text[i]!;

    if (ch === '_' && text[i + 1] === '_') {
      // Skip Dynamic Prompts `__wildcard__` spans so `|` / `()` inside
      // `__color(|-basic)__` are not treated as prompt structure.
      const fromHere = text.slice(i);
      const wild = /^__([^_\n](?:[^_\n]|_(?!_))*)__/.exec(fromHere);
      if (wild) {
        i += wild[0].length;
        continue;
      }
    }

    if (ch === '"') {
      if (inDoubleQuote) {
        inDoubleQuote = false;
        doubleQuoteStart = -1;
      } else {
        inDoubleQuote = true;
        doubleQuoteStart = i;
      }
      i += 1;
      continue;
    }

    if (ch === '{') {
      braceStarts.push(i);
      depth += 1;
      i += 1;
      continue;
    }

    if (ch === '}') {
      if (depth === 0) {
        issues.push({
          severity: 'error',
          code: 'unbalanced_brace',
          message: 'Closing `}` without matching `{`',
          line,
          column: i + 1,
          snippet: snippetAround(i),
        });
      } else {
        depth -= 1;
        braceStarts.pop();
      }
      i += 1;
      continue;
    }

    if (ch === '(') {
      parenStarts.push(i);
      i += 1;
      continue;
    }

    if (ch === ')') {
      if (parenStarts.length === 0) {
        issues.push({
          severity: 'error',
          code: 'unbalanced_paren',
          message: 'Closing `)` without matching `(`',
          line,
          column: i + 1,
          snippet: snippetAround(i),
        });
      } else {
        parenStarts.pop();
      }
      i += 1;
      continue;
    }

    if (ch === '[') {
      bracketStarts.push(i);
      i += 1;
      continue;
    }

    if (ch === ']') {
      if (bracketStarts.length === 0) {
        issues.push({
          severity: 'error',
          code: 'unbalanced_bracket',
          message: 'Closing `]` without matching `[`',
          line,
          column: i + 1,
          snippet: snippetAround(i),
        });
      } else {
        bracketStarts.pop();
      }
      i += 1;
      continue;
    }

    // `$` / `$$` multi-select is only Dynamic Prompts syntax inside `{…}`.
    // Trailing `$` on LoRA triggers (e.g. `PartiallyOpenPant$`) is literal.
    if (ch === '$' && depth > 0) {
      let dollarCount = 0;
      let j = i;
      while (j < text.length && text[j] === '$') {
        dollarCount += 1;
        j += 1;
      }

      if (dollarCount === 1 || dollarCount >= 3) {
        issues.push({
          severity: 'error',
          code: 'bad_multiselect',
          message: `Expected \`$$\`, found ${'$'.repeat(dollarCount)}`,
          line,
          column: i + 1,
          snippet: text.slice(Math.max(0, i - 8), Math.min(text.length, j + 8)),
        });
      } else if (dollarCount === 2) {
        const openIdx = braceStarts[braceStarts.length - 1] ?? -1;
        const bodyPrefix = openIdx >= 0 ? text.slice(openIdx + 1, i) : '';
        const priorDD = countTopLevelDoubleDollars(bodyPrefix);

        if (priorDD === 0) {
          // First `$$` — must be preceded by an optional numeric range only.
          // Spaces in the range are rejected; custom separators use a *second* `$$`.
          if (/\s/.test(bodyPrefix)) {
            issues.push({
              severity: 'warning',
              code: 'bad_multiselect',
              message:
                'Unexpected space before `$$` (Dynamic Prompts rejects spaced ranges; use `{n$$ sep $$opts}` for a custom separator)',
              line,
              column: i + 1,
              snippet: text.slice(
                Math.max(0, i - 16),
                Math.min(text.length, j + 8),
              ),
            });
          } else if (!isValidMultiselectRange(bodyPrefix)) {
            issues.push({
              severity: 'error',
              code: 'bad_multiselect',
              message:
                'Invalid multi-select range before `$$` (expected empty, N, N-M, -M, or N-)',
              line,
              column: i + 1,
              snippet: text.slice(
                Math.max(0, i - 16),
                Math.min(text.length, j + 8),
              ),
            });
          }
        } else if (priorDD >= 2) {
          issues.push({
            severity: 'error',
            code: 'bad_multiselect',
            message:
              'Too many `$$` markers in this variant (at most two: count and optional custom separator)',
            line,
            column: i + 1,
            snippet: text.slice(
              Math.max(0, i - 16),
              Math.min(text.length, j + 8),
            ),
          });
        }
        // priorDD === 1 → closing custom-separator `$$`; separator text may
        // contain spaces (` and `, ` + `, or a lone space). Always OK.
      }

      i = j;
      continue;
    }

    if (ch === '|' && depth === 0) {
      issues.push({
        severity: 'warning',
        code: 'orphan_pipe',
        message: '`|` outside of `{…}` is not a Dynamic Prompts variant separator',
        line,
        column: i + 1,
        snippet: snippetAround(i),
      });
    }

    i += 1;
  }

  if (depth > 0) {
    const openIdx = braceStarts[0] ?? 0;
    issues.push({
      severity: 'error',
      code: 'unbalanced_brace',
      message: `Unclosed \`{\` (${depth} still open) — starting at: ${snippetFrom(openIdx)}`,
      line,
      column: openIdx + 1,
      snippet: snippetFrom(openIdx),
    });
  }

  if (parenStarts.length > 0) {
    const openIdx = parenStarts[0]!;
    issues.push({
      severity: 'error',
      code: 'unbalanced_paren',
      message: `Unclosed \`(\` (${parenStarts.length} still open) — starting at: ${snippetFrom(openIdx)}`,
      line,
      column: openIdx + 1,
      snippet: snippetFrom(openIdx),
    });
  }

  if (bracketStarts.length > 0) {
    const openIdx = bracketStarts[0]!;
    issues.push({
      severity: 'error',
      code: 'unbalanced_bracket',
      message: `Unclosed \`[\` (${bracketStarts.length} still open) — starting at: ${snippetFrom(openIdx)}`,
      line,
      column: openIdx + 1,
      snippet: snippetFrom(openIdx),
    });
  }

  if (inDoubleQuote && doubleQuoteStart >= 0) {
    issues.push({
      severity: 'error',
      code: 'unbalanced_quote',
      message: `Unclosed \`"\` — starting at: ${snippetFrom(doubleQuoteStart)}`,
      line,
      column: doubleQuoteStart + 1,
      snippet: snippetFrom(doubleQuoteStart),
    });
  }

  return issues;
}

function hasSyntaxError(issues: SyntaxIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

/**
 * Validate variant braces across a whole file.
 * When a line has a syntax error, keep appending the next non-empty,
 * non-comment line (prompt continuation) and re-check. Blank lines separate
 * complete prompts and stop the join — typical for large multi-line `{…}`
 * prompts where `{` and `}` sit on different lines.
 */
export function validateVariantSyntaxAcrossLines(
  rawLines: string[],
): SyntaxIssue[] {
  const issues: SyntaxIssue[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const lineText = rawLines[i] ?? '';
    const trimmed = lineText.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      i += 1;
      continue;
    }

    let end = i;
    let combined = lineText;
    let spanIssues = validateVariantSyntax(combined, i + 1);

    while (hasSyntaxError(spanIssues)) {
      let next = end + 1;
      while (
        next < rawLines.length &&
        (rawLines[next] ?? '').trimStart().startsWith('#')
      ) {
        next += 1;
      }
      if (next >= rawLines.length) break;
      if (!(rawLines[next] ?? '').trim()) break;

      end = next;
      combined += `\n${rawLines[end] ?? ''}`;
      spanIssues = validateVariantSyntax(combined, i + 1);
    }

    issues.push(...spanIssues);
    i = end + 1;
  }

  return issues;
}

/** Split options at top-level `|` inside a brace body (no surrounding braces). */
export function splitTopLevelOptions(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === '|' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

export function findMatchingBrace(text: string, openIndex: number): number {
  if (text[openIndex] !== '{') return -1;
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
