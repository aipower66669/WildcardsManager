/**
 * Heuristics for trigger words buried in Civitai model descriptions when
 * creators skip the dedicated "trained words" field.
 */

const LABEL_RE =
  /(?:^|\n)\s*(?:[-*•]\s*)?(?:\*\*|__)?\s*(?:trigger\s*words?|trigger|activation\s*words?|activation|keywords?|prompt\s*trigger)\s*(?:\*\*|__)?\s*[:：\-–—]\s*(.+)$/gim;

/** Strip simple HTML to plain text for description scanning. */
export function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<\/\s*h[1-6]\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function splitTriggerValue(raw: string): string[] {
  let text = raw.trim();
  // Cut trailing sentence noise after a period when the value looks long.
  const sentence = text.match(/^(.+?)(?:\.(?:\s|$)|$)/);
  if (sentence?.[1] && sentence[1].length < text.length) {
    const candidate = sentence[1].trim();
    // Keep the cut only when it still looks like a word list, not prose.
    if (candidate.length <= 120 && !/\b(the|and|with|for|this|that)\b/i.test(candidate)) {
      text = candidate;
    }
  }
  text = text.replace(/^[`"'“”]+|[`"'“”]+$/g, '').trim();
  if (!text) return [];

  // Prefer comma / pipe / slash lists; otherwise a single token / short phrase.
  if (/[,|/，、]/.test(text)) {
    return text
      .split(/[,|/，、]+/)
      .map((s) => s.trim().replace(/^[`"'“”]+|[`"'“”]+$/g, ''))
      .filter((s) => s.length > 0 && s.length <= 64);
  }

  // "word1 word2" without commas — only accept if short (≤ 4 tokens).
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length <= 4 && text.length <= 80) {
    return [text];
  }
  return [];
}

/**
 * Pull trigger keywords from a Civitai description (HTML or plain).
 * Returns [] when no labeled trigger line is found.
 */
export function extractTriggersFromCivitaiDescription(
  description: string | null | undefined,
  opts?: { max?: number },
): string[] {
  const max = Math.max(1, opts?.max ?? 12);
  if (!description?.trim()) return [];
  const plain = stripHtmlToPlainText(description);
  if (!plain) return [];

  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of plain.matchAll(LABEL_RE)) {
    const value = match[1]?.trim();
    if (!value) continue;
    for (const word of splitTriggerValue(value)) {
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(word);
      if (found.length >= max) return found;
    }
  }
  return found;
}
