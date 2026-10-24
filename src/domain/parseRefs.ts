import { validateLoraTagSyntax } from './lora.js';
import {
  validateVariantSyntax,
  validateVariantSyntaxAcrossLines,
} from './parseVariants.js';
import type { FileParseResult, LineParseResult, WildcardRef } from './types.js';

const WILDCARD_RE = /__([^_\n](?:[^_\n]|_(?!_))*)__/g;

/**
 * Files whose first line starts with `# NO VALIDATION` are intentionally
 * exempt from syntax/logic checks (same convention as the C# Simulation tool).
 * They still appear in the library list and dependency tree.
 *
 * TEMP: set to `true` again once multi-line brace validation is proven on the
 * real library (so these markers can be removed from prompt files).
 */
export const HONOR_NO_VALIDATION_MARKER = false;

/**
 * Detect the first-line `# NO VALIDATION` marker (case-insensitive).
 * Whether syntax is skipped depends on {@link HONOR_NO_VALIDATION_MARKER}.
 */
export function hasNoValidationMarker(text: string): boolean {
  const firstLine =
    text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0]?.trimStart() ?? '';
  return firstLine.toUpperCase().startsWith('# NO VALIDATION');
}

/**
 * Extract `__wildcard__` references from a line.
 * Unclosed `__` pairs are reported as syntax issues.
 */
export function parseLine(
  text: string,
  line: number,
  opts?: { checkVariants?: boolean },
): LineParseResult {
  const checkVariants = opts?.checkVariants !== false;
  const trimmed = text.trim();
  const isComment = trimmed.startsWith('#');
  const issues =
    isComment || !checkVariants ? [] : validateVariantSyntax(text, line);
  const refs: WildcardRef[] = [];

  if (isComment || !trimmed) {
    // Still scan for accidental unclosed markers in comments? Skip — comments ignored.
    return { line, text, isComment, refs, issues };
  }

  // Detect odd number of `__` delimiters (unclosed).
  const delimiterMatches = text.match(/__/g);
  if (delimiterMatches && delimiterMatches.length % 2 !== 0) {
    issues.push({
      severity: 'error',
      code: 'unclosed_wildcard',
      message: 'Unclosed `__wildcard__` delimiter on this line',
      line,
      column: text.indexOf('__') + 1,
      snippet: text.trim().slice(0, 80),
    });
  }

  WILDCARD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WILDCARD_RE.exec(text)) !== null) {
    const name = match[1]!.trim();
    if (!name) continue;
    refs.push({
      name,
      line,
      column: match.index + 1,
      endColumn: match.index + match[0].length,
      raw: match[0],
    });
  }

  return { line, text, isComment, refs, issues };
}

export function parseFileContent(
  text: string,
  relativeKey: string,
  absolutePath: string,
): FileParseResult {
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: LineParseResult[] = [];
  const refs: WildcardRef[] = [];
  const issues: FileParseResult['issues'] = [];
  const skipValidation =
    HONOR_NO_VALIDATION_MARKER && hasNoValidationMarker(text);

  for (let i = 0; i < rawLines.length; i++) {
    // Variant braces are validated across lines below (multi-line prompts).
    const parsed = parseLine(rawLines[i] ?? '', i + 1, {
      checkVariants: false,
    });
    lines.push(skipValidation ? { ...parsed, issues: [] } : parsed);
    refs.push(...parsed.refs);
    if (!skipValidation) issues.push(...parsed.issues);
  }

  if (!skipValidation) {
    const variantIssues = validateVariantSyntaxAcrossLines(rawLines);
    issues.push(...variantIssues);
    for (const issue of variantIssues) {
      const lineNo = issue.line;
      if (typeof lineNo === 'number' && lineNo >= 1 && lineNo <= lines.length) {
        lines[lineNo - 1]!.issues.push(issue);
      }
    }
  }

  if (
    !skipValidation &&
    rawLines.every((l) => !l.trim() || l.trim().startsWith('#'))
  ) {
    issues.push({
      severity: 'warning',
      code: 'empty_file' as const,
      message: 'File has no active (non-comment) lines',
      nodeId: relativeKey,
    });
  }

  return { relativeKey, absolutePath, lines, refs, issues };
}

export const LOCAL_SYNTAX_ISSUE_CODES = new Set([
  'unbalanced_brace',
  'unbalanced_paren',
  'unbalanced_bracket',
  'unbalanced_quote',
  'unclosed_wildcard',
  'bad_multiselect',
  'orphan_pipe',
  'empty_file',
  'invalid_lora',
]);

/** Instant editor syntax (braces/variants/LoRA weights) — no library index, no IPC. */
export function localWildcardSyntaxIssues(
  text: string,
  relativeKey: string,
  absolutePath = '',
): FileParseResult['issues'] {
  const fromFile = parseFileContent(text, relativeKey, absolutePath).issues.filter(
    (issue) => LOCAL_SYNTAX_ISSUE_CODES.has(issue.code),
  );
  return [...fromFile, ...validateLoraTagSyntax(text, relativeKey)];
}

/** Overlay local syntax onto a previous issue list (keep refs / LoRA / etc.). */
export function mergeLocalSyntaxIssues<T extends { code: string }>(
  previous: readonly T[],
  syntax: readonly T[],
): T[] {
  return [
    ...previous.filter((issue) => !LOCAL_SYNTAX_ISSUE_CODES.has(issue.code)),
    ...syntax,
  ];
}

/** Collect wildcard names that appear inside a brace expression after expanding options. */
export function extractRefsFromText(text: string, line = 1): WildcardRef[] {
  return parseLine(text, line).refs;
}

/**
 * Stable fingerprint of outgoing `__wildcard__` relationships in a file.
 * Used to skip expensive graph rebuilds when a save only changed prose/weights.
 */
export function graphRelationshipFingerprint(text: string): string {
  const refs = parseFileContent(text, '_', '_').refs;
  if (refs.length === 0) return '';
  return [...new Set(refs.map((ref) => ref.name))]
    .sort((a, b) => a.localeCompare(b))
    .join('\0');
}
