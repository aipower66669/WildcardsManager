import { parseCivitaiModelUrlFromLine } from './civitaiSnippet.js';
import {
  extractLoraRefs,
  filesMatchingLoraName,
  splitLoraTagFields,
  type LoraIndex,
} from './lora.js';
import { splitTopLevelOptions } from './parseVariants.js';

export type LibraryTextFile = {
  relativePath: string;
  text: string;
};

function tagBody(raw: string): string {
  const trimmed = raw.trim();
  const start = /^<lora:/i.test(trimmed) ? 6 : 0;
  const end = trimmed.endsWith('>') ? trimmed.length - 1 : trimmed.length;
  return trimmed.slice(start, end);
}

export type DefinedLoraReference = {
  /** Complete `<lora:…>` tag (no trailing triggers). */
  tag: string;
  /**
   * Documented block: preceding `#` comment lines + the full LoRA line
   * (tag plus any trailing prompt text), joined with `\n`.
   */
  block: string;
  relativePath: string;
  /** 1-based line of the `<lora:…>` tag. */
  line: number;
  /** True when at least one `#` comment sits immediately above the tag. */
  hasDocComments: boolean;
};

type Candidate = DefinedLoraReference & { score: number };

/**
 * Collect consecutive `#` comment lines immediately above `lineIndex`
 * (0-based). Stops at a blank or non-comment line.
 */
export function collectPrecedingCommentLines(
  lines: readonly string[],
  lineIndex: number,
): string[] {
  const comments: string[] = [];
  for (let i = lineIndex - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (!line.trim()) break;
    if (!line.trimStart().startsWith('#')) break;
    comments.push(line);
  }
  comments.reverse();
  return comments;
}

function weightRichness(rawTag: string): number {
  const fields = splitLoraTagFields(tagBody(rawTag));
  // name [, weight [, …]]
  const weightFields = fields.slice(1).filter((f) => f.trim().length > 0);
  if (weightFields.length === 0) return 0;
  let score = 0;
  for (const field of weightFields) {
    const trimmed = field.trim();
    score += Math.min(trimmed.length, 80);
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const options = splitTopLevelOptions(trimmed.slice(1, -1));
      score += 20 + options.length * 8;
    } else {
      score += 2;
    }
  }
  return score;
}

function scoreCandidate(
  comments: readonly string[],
  rawTag: string,
): { score: number; hasDocComments: boolean } {
  const hasDocComments = comments.length > 0;
  let score = weightRichness(rawTag);
  if (hasDocComments) score += 1000;
  for (const comment of comments) {
    if (parseCivitaiModelUrlFromLine(comment)) score += 200;
    const body = comment.trim().replace(/^#\s*/, '');
    if (/^LOCAL\b/i.test(body)) score += 80;
    else if (body.length > 0) score += 10;
  }
  return { score, hasDocComments };
}

/**
 * Among wildcard (and similar) texts, pick the best documented `<lora:…>`
 * reference for an on-disk LoRA file.
 *
 * Prefer tags with `#` comments immediately above (URL / range notes), then
 * the richest weight expression. Used by Copy LoRA tag / Copy reference so
 * the clipboard gets the user’s defined range, not a generic `:1`.
 */
export function findDefinedLoraReference(
  files: readonly LibraryTextFile[],
  index: LoraIndex,
  absolutePath: string,
): DefinedLoraReference | null {
  const targetAbs = absolutePath.replaceAll('\\', '/').toLowerCase();
  const candidates: Candidate[] = [];

  for (const file of files) {
    const text = file.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n');
    const refs = extractLoraRefs(text);
    for (const ref of refs) {
      if (!ref.name) continue;
      const matches = filesMatchingLoraName(ref.name, index);
      if (
        !matches.some(
          (m) => m.absolutePath.replaceAll('\\', '/').toLowerCase() === targetAbs,
        )
      ) {
        continue;
      }

      const lineIndex = ref.line - 1;
      const comments = collectPrecedingCommentLines(lines, lineIndex);
      const { score, hasDocComments } = scoreCandidate(comments, ref.raw);
      const loraLine = lines[lineIndex] ?? ref.raw;
      const blockLines = [...comments, loraLine];
      candidates.push({
        tag: ref.raw,
        block: blockLines.join('\n'),
        relativePath: file.relativePath.replaceAll('\\', '/'),
        line: ref.line,
        hasDocComments,
        score,
      });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pathCmp = a.relativePath.localeCompare(b.relativePath);
    if (pathCmp !== 0) return pathCmp;
    return a.line - b.line;
  });

  const best = candidates[0]!;
  return {
    tag: best.tag,
    block: best.block,
    relativePath: best.relativePath,
    line: best.line,
    hasDocComments: best.hasDocComments,
  };
}
