import type { Issue } from './types.js';
import { findMatchingBrace, splitTopLevelOptions } from './parseVariants.js';
import { buildUnusedLoraIssues } from './loraSeriesExtend.js';

export const LORA_EXTENSIONS = ['.safetensors', '.ckpt', '.pt'] as const;

/**
 * Wildcard issues that are often stale when the LoRA folder index is old
 * (`missing_lora`, unused files / missing training steps).
 */
export const LORA_INDEX_STALE_ISSUE_MAX_AGE_MS = 3 * 60 * 1000;

export function issueSuggestsStaleLoraIndex(issue: {
  code: string;
  fixAction?: string;
}): boolean {
  return issue.code === 'missing_lora' || issue.code === 'unused_lora';
}

/** Keep watching — these stay on screen until the folder index catches up. */
export function issueNeedsLoraIndexWatch(issue: {
  code: string;
  fixAction?: string;
}): boolean {
  return (
    issue.code === 'missing_lora' ||
    (issue.code === 'unused_lora' && issue.fixAction === 'extend_lora_series')
  );
}

/** Checkpoint folder weights — includes GGUF quantizations used by Comfy / llama.cpp. */
export const CHECKPOINT_EXTENSIONS = [
  ...LORA_EXTENSIONS,
  '.gguf',
] as const;

/** Any on-disk weight we may index (LoRA or checkpoint). */
export const MODEL_WEIGHT_EXTENSIONS = CHECKPOINT_EXTENSIONS;

/**
 * Complete A1111/Forge LoRA tags, including empty names like `<lora:>`
 * and optional extra weight fields: `<lora:name:0.8>` / `<lora:name:0.5:0.2>`.
 * Brace weight lists like `<lora:name:{0.8|1.0}>` are allowed.
 * Dynamic Prompts choices in the model name
 * (`<lora:LORANAME-00000{1000|2000|3000}>`) are also allowed.
 */
const LORA_TAG_RE = /<lora:([^:>\n]*)(?::[^>\n]*)?>/gi;

/** Opening `<lora:` delimiter used to find tags that never close with `>`. */
const LORA_OPEN_RE = /<lora:/gi;

/** Integer or float, optional leading minus — same rule as download-category weights. */
const LORA_WEIGHT_NUMBER_RE = /^-?\d+(\.\d+)?$/;

/**
 * Split a LoRA tag body on `:` that are not inside `{…}`.
 * `Natural:{0.8|df}` → `['Natural', '{0.8|df}']`
 */
export function splitLoraTagFields(body: string): string[] {
  const fields: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ':' && depth === 0) {
      fields.push(body.slice(start, i));
      start = i + 1;
    }
  }
  fields.push(body.slice(start));
  return fields;
}

/** True when a weight token is a finite number or a `{a|b}` list of those. */
export function isNumericLoraWeightToken(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('{')) {
    if (!trimmed.endsWith('}')) return false;
    const inner = trimmed.slice(1, -1);
    const options = splitTopLevelOptions(inner);
    return (
      options.length > 0 &&
      options.every((opt) => isNumericLoraWeightToken(opt))
    );
  }
  return LORA_WEIGHT_NUMBER_RE.test(trimmed) && Number.isFinite(Number(trimmed));
}

/** Non-numeric tokens inside a weight field (for issue messages). */
export function invalidLoraWeightTokens(field: string): string[] {
  const trimmed = field.trim();
  if (!trimmed) return ['(empty)'];
  if (isNumericLoraWeightToken(trimmed)) return [];
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const bad = splitTopLevelOptions(trimmed.slice(1, -1)).flatMap((opt) =>
      invalidLoraWeightTokens(opt),
    );
    return bad.length > 0 ? bad : [trimmed];
  }
  return [trimmed];
}

function loraTagBody(raw: string): string {
  const trimmed = raw.trim();
  const start = /^<lora:/i.test(trimmed) ? 6 : 0;
  const end = trimmed.endsWith('>') ? trimmed.length - 1 : trimmed.length;
  return trimmed.slice(start, end);
}

/** Cap cartesian expansions of nested `{a|b}` groups in LoRA names. */
const MAX_LORA_NAME_EXPANSIONS = 256;

export type LoraRef = {
  /** Extensionless model name; empty when the tag has no name. */
  name: string;
  raw: string;
  line: number;
  column: number;
  endColumn: number;
};

export type LoraFileEntry = {
  /** Path relative to the LoRA folder, using `/` separators (with extension). */
  relativePath: string;
  absolutePath: string;
  /** Extensionless relative path used as the primary display key. */
  stem: string;
  /** Civitai AutoV2 (SHA-256 prefix), when hashed/cached. */
  autoV2?: string;
};

export type LoraIndex = {
  root: string;
  /** Lowercased aliases → absolute file path. */
  aliases: Map<string, string>;
  /** Unique model files discovered under the LoRA folder. */
  files: LoraFileEntry[];
  fileCount: number;
  /** AutoV2 → absolute path for installed detection. */
  byAutoV2?: Map<string, string>;
  /**
   * Normalized alias → every file that claims it (basename collisions).
   * Built by `addLoraFile` / `reuseLoraFile`; rebuilt on demand if missing.
   */
  filesByAlias?: Map<string, LoraFileEntry[]>;
};

/** Path-set identity for unused-LoRA / reverse-ref caches. */
export function loraIndexFingerprint(index: LoraIndex | null): string {
  if (!index) return '';
  return `${index.root}\0${index.fileCount}\0${index.files
    .map((file) => file.relativePath)
    .join('\n')}`;
}

export function normalizeLoraName(name: string): string {
  return name.trim().replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}

/** `__` (or more) in a LoRA file/tag name is parsed as a Dynamic Prompts wildcard. */
export function loraNameHasStackedUnderscores(name: string): boolean {
  return name.includes('__');
}

/** Collapse `__` / `___` / … to a single `_` so a download name stays tag-safe. */
export function collapseStackedUnderscores(name: string): string {
  return name.replace(/_{2,}/g, '_');
}

/** Error issues for an on-disk LoRA whose stem/path would break `<lora:…>` tags. */
export function loraFileNameIssues(
  stem: string,
  relativePath: string,
): Issue[] {
  if (
    !loraNameHasStackedUnderscores(stem) &&
    !loraNameHasStackedUnderscores(relativePath)
  ) {
    return [];
  }
  return [
    {
      severity: 'error',
      code: 'invalid_lora',
      message: `LoRA file name must not contain \`__\` (Dynamic Prompts wildcard markers): \`${stem}\``,
      snippet: relativePath.replace(/\\/g, '/'),
    },
  ];
}

/** Strip a supported model extension when present. */
export function stripLoraExtension(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  for (const ext of MODEL_WEIGHT_EXTENSIONS) {
    if (lower.endsWith(ext)) return normalized.slice(0, -ext.length);
  }
  return normalized;
}

function basename(pathLike: string): string {
  const normalized = pathLike.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? normalized;
}

/**
 * Expand Dynamic Prompts `{a|b|c}` choices inside a LoRA model name.
 * Weight braces live after `:` and are not part of `name`.
 * Unclosed braces are left literal (no expansion).
 */
export function expandLoraNameVariants(name: string): string[] {
  const open = name.indexOf('{');
  if (open === -1) return [name];
  const close = findMatchingBrace(name, open);
  if (close === -1) return [name];

  const before = name.slice(0, open);
  const body = name.slice(open + 1, close);
  const after = name.slice(close + 1);
  const options = splitTopLevelOptions(body);
  const out: string[] = [];
  const seen = new Set<string>();

  for (const option of options) {
    const combined = `${before}${option}${after}`;
    for (const expanded of expandLoraNameVariants(combined)) {
      if (seen.has(expanded)) continue;
      seen.add(expanded);
      out.push(expanded);
      if (out.length >= MAX_LORA_NAME_EXPANSIONS) return out;
    }
  }
  return out.length > 0 ? out : [name];
}

/**
 * Extract complete `<lora:…>` tags from text.
 * Comment-only lines (`# …`) are skipped, matching wildcard comment rules.
 * Empty names (`<lora:>`) are included so they can be flagged as invalid.
 */
export function extractLoraRefs(text: string): LoraRef[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const refs: LoraRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i] ?? '';
    if (lineText.trimStart().startsWith('#')) continue;

    LORA_TAG_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LORA_TAG_RE.exec(lineText)) !== null) {
      const name = stripLoraExtension(match[1]!.trim());
      refs.push({
        name,
        raw: match[0],
        line: i + 1,
        column: match.index + 1,
        endColumn: match.index + match[0].length,
      });
    }
  }

  return refs;
}

export function countLoraTags(text: string): number {
  return extractLoraRefs(text).length;
}

export type UnclosedLoraTag = {
  raw: string;
  line: number;
  column: number;
  endColumn: number;
};

/**
 * Find `<lora:` openings that are not closed by `>` on the same line.
 * Comment-only lines are skipped.
 */
export function extractUnclosedLoraTags(text: string): UnclosedLoraTag[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const unclosed: UnclosedLoraTag[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i] ?? '';
    if (lineText.trimStart().startsWith('#')) continue;

    const covered = new Set<number>();
    LORA_TAG_RE.lastIndex = 0;
    let complete: RegExpExecArray | null;
    while ((complete = LORA_TAG_RE.exec(lineText)) !== null) {
      for (let j = 0; j < complete[0].length; j++) {
        covered.add(complete.index + j);
      }
    }

    LORA_OPEN_RE.lastIndex = 0;
    let open: RegExpExecArray | null;
    while ((open = LORA_OPEN_RE.exec(lineText)) !== null) {
      if (covered.has(open.index)) continue;

      const from = open.index;
      let to = lineText.length;
      const nextOpen = lineText.slice(from + 6).search(/<lora:/i);
      if (nextOpen >= 0) to = from + 6 + nextOpen;
      const raw = lineText.slice(from, to).trimEnd().slice(0, 80);
      unclosed.push({
        raw: raw || '<lora:',
        line: i + 1,
        column: from + 1,
        endColumn: from + Math.max(raw.length, 6) + 1,
      });
    }
  }

  return unclosed;
}

/** Register relative path / stem / basename aliases for a model file. */
export function registerLoraAliases(
  aliases: Map<string, string>,
  relativePath: string,
  absolutePath: string,
): void {
  const relative = relativePath.replace(/\\/g, '/');
  const stem = stripLoraExtension(relative);
  const candidates = [relative, stem, basename(stem), basename(relative)];
  for (const candidate of candidates) {
    const key = normalizeLoraName(stripLoraExtension(candidate));
    // First-wins only for the exact key. Never register a stripped `name (1)`
    // as bare `name` — that steals refs from a real `name.safetensors` sibling
    // and makes delete/rename wipe both.
    if (!key || aliases.has(key)) continue;
    aliases.set(key, absolutePath);
  }
}

function loraAliasKeys(relativePath: string, stem: string): string[] {
  const relative = relativePath.replace(/\\/g, '/');
  const candidates = [relative, stem, basename(stem), basename(relative)];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = normalizeLoraName(stripLoraExtension(candidate));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function registerFilesByAlias(index: LoraIndex, file: LoraFileEntry): void {
  if (!index.filesByAlias) index.filesByAlias = new Map();
  for (const key of loraAliasKeys(file.relativePath, file.stem)) {
    const list = index.filesByAlias.get(key);
    if (list) list.push(file);
    else index.filesByAlias.set(key, [file]);
  }
}

export function ensureFilesByAlias(
  index: LoraIndex,
): Map<string, LoraFileEntry[]> {
  if (
    index.filesByAlias &&
    (index.filesByAlias.size > 0 || index.files.length === 0)
  ) {
    return index.filesByAlias;
  }
  index.filesByAlias = new Map();
  for (const file of index.files) registerFilesByAlias(index, file);
  return index.filesByAlias;
}

export function addLoraFile(
  index: LoraIndex,
  relativePath: string,
  absolutePath: string,
): void {
  const relative = relativePath.replace(/\\/g, '/');
  const stem = stripLoraExtension(relative);
  const entry: LoraFileEntry = {
    relativePath: relative,
    absolutePath,
    stem,
  };
  index.files.push(entry);
  index.fileCount += 1;
  registerLoraAliases(index.aliases, relative, absolutePath);
  registerFilesByAlias(index, entry);
}

/** Reuse an existing index row (same path) without re-stating the weight file. */
export function reuseLoraFile(index: LoraIndex, file: LoraFileEntry): void {
  index.files.push(file);
  index.fileCount += 1;
  registerLoraAliases(index.aliases, file.relativePath, file.absolutePath);
  registerFilesByAlias(index, file);
}

export function resolveLoraName(
  name: string,
  index: LoraIndex,
): string | undefined {
  const key = normalizeLoraName(stripLoraExtension(name));
  if (!key) return undefined;
  // Exact alias only (relative path, stem, or basename). Do not treat
  // `name (1)` and `name` as interchangeable — a tag `<lora:V1 (1)>` must not
  // silently resolve to `V1.safetensors` (or any other fuzzy sibling).
  return index.aliases.get(key);
}

/**
 * Every on-disk LoRA that a tag name can mean (basename, stem, or relative path).
 * Unlike alias lookup (first-wins), this returns all basename collisions so
 * `<lora:NewFace>` counts for both `NewFace` and `MyGirls/NewFace`.
 */
export function filesMatchingLoraName(
  name: string,
  index: LoraIndex,
): LoraFileEntry[] {
  const byAlias = ensureFilesByAlias(index);
  const seen = new Set<string>();
  const out: LoraFileEntry[] = [];
  for (const expanded of expandLoraNameVariants(name)) {
    const key = normalizeLoraName(stripLoraExtension(expanded));
    if (!key) continue;
    const hits = byAlias.get(key);
    if (!hits) continue;
    for (const file of hits) {
      const abs = file.absolutePath.toLowerCase();
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push(file);
    }
  }
  return out;
}

export type LoraSearchHit = {
  relativePath: string;
  absolutePath: string;
  stem: string;
  /** True when the query equals the stem or basename (case-insensitive). */
  exact: boolean;
};

/**
 * Search indexed LoRA files by prefix against relative path, stem, and basename.
 * Dynamic Prompts brace picks (`Akira_000000{100|200}`) resolve to on-disk
 * expansions first so “Open in LoRA files” works for multi-step tags.
 * Results are sorted with exact matches first, then alphabetically by stem.
 *
 * Matching is prefix (`startsWith`), not substring (`includes`), so a tag like
 * `<lora:V1 (1)>` does not open `Krea2_v1 (1).safetensors`.
 */
export function searchLoraIndex(
  index: LoraIndex,
  rawQuery: string,
  limit = 100,
): LoraSearchHit[] {
  const stripped = stripLoraExtension(rawQuery).trim();
  if (!stripped) return [];

  if (stripped.includes('{')) {
    const matched = filesMatchingLoraName(stripped, index);
    if (matched.length > 0) {
      const hits = matched.map((file) => ({
        relativePath: file.relativePath,
        absolutePath: file.absolutePath,
        stem: file.stem,
        exact: true as const,
      }));
      hits.sort((a, b) => a.stem.localeCompare(b.stem, undefined, { numeric: true }));
      return hits.slice(0, Math.max(1, limit));
    }
  }

  const query = normalizeLoraName(stripped);
  if (!query) return [];

  const hits: LoraSearchHit[] = [];
  for (const file of index.files) {
    const stemKey = normalizeLoraName(file.stem);
    const pathKey = normalizeLoraName(file.relativePath);
    const baseKey = normalizeLoraName(basename(file.stem));
    if (
      !stemKey.startsWith(query) &&
      !pathKey.startsWith(query) &&
      !baseKey.startsWith(query)
    ) {
      continue;
    }
    hits.push({
      relativePath: file.relativePath,
      absolutePath: file.absolutePath,
      stem: file.stem,
      exact: stemKey === query || baseKey === query || pathKey === query,
    });
  }

  hits.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    return a.stem.localeCompare(b.stem);
  });
  return hits.slice(0, Math.max(1, limit));
}

/** Collect normalized referenced LoRA names from wildcard file text. */
export function collectReferencedLoraNames(texts: string[]): Set<string> {
  const referenced = new Set<string>();
  for (const text of texts) {
    for (const ref of extractLoraRefs(text)) {
      for (const expanded of expandLoraNameVariants(ref.name)) {
        const key = normalizeLoraName(stripLoraExtension(expanded));
        if (key) referenced.add(key);
      }
    }
  }
  return referenced;
}

/**
 * True when any alias for this on-disk file was referenced by a wildcard tag.
 */
export function isLoraFileReferenced(
  file: LoraFileEntry,
  referenced: Set<string>,
): boolean {
  const candidates = [
    file.relativePath,
    file.stem,
    basename(file.stem),
    basename(file.relativePath),
  ];
  return candidates.some((candidate) => {
    const key = normalizeLoraName(stripLoraExtension(candidate));
    return Boolean(key && referenced.has(key));
  });
}

/**
 * Folder-independent LoRA tag syntax: unclosed tags, empty names, `__` in
 * the name, and weight fields that are not numbers / numeric `{a|b}` lists.
 */
export function validateLoraTagSyntax(
  text: string,
  nodeId?: string,
): Issue[] {
  const issues: Issue[] = [];

  for (const tag of extractUnclosedLoraTags(text)) {
    issues.push({
      severity: 'error',
      code: 'invalid_lora',
      message: `Unclosed LoRA tag (missing \`>\`): \`${tag.raw}\``,
      nodeId,
      line: tag.line,
      column: tag.column,
      snippet: tag.raw,
    });
  }

  for (const ref of extractLoraRefs(text)) {
    if (!ref.name) {
      issues.push({
        severity: 'warning',
        code: 'invalid_lora',
        message: `LoRA tag is missing a model name: \`${ref.raw}\``,
        nodeId,
        line: ref.line,
        column: ref.column,
        snippet: ref.raw,
      });
    } else if (ref.name.includes('__')) {
      // Dynamic Prompts uses `__…__` as wildcard markers; a LoRA name
      // containing `__` is parsed as a wildcard and breaks expansion.
      issues.push({
        severity: 'error',
        code: 'invalid_lora',
        message: `LoRA name must not contain \`__\` (Dynamic Prompts wildcard markers): \`${ref.raw}\``,
        nodeId,
        line: ref.line,
        column: ref.column,
        snippet: ref.raw,
      });
    }

    const fields = splitLoraTagFields(loraTagBody(ref.raw));
    const weightFields = fields.slice(1);
    for (const field of weightFields) {
      const bad = invalidLoraWeightTokens(field);
      if (bad.length === 0) continue;
      const shown = bad.slice(0, 3).map((token) => `\`${token}\``);
      const more =
        bad.length > shown.length ? ` (+${bad.length - shown.length} more)` : '';
      issues.push({
        severity: 'error',
        code: 'invalid_lora',
        message: `LoRA weight must be a number (or \`{a|b}\` of numbers): ${shown.join(', ')}${more} in \`${ref.raw}\``,
        nodeId,
        line: ref.line,
        column: ref.column,
        snippet: ref.raw,
      });
    }
  }

  return issues;
}

/**
 * Validate LoRA tags in text.
 * Unclosed tags and empty names are errors/warnings; unresolved models warn
 * when a LoRA folder is configured.
 */
export function validateLoraRefs(
  text: string,
  index: LoraIndex | null,
  nodeId?: string,
): Issue[] {
  const issues = validateLoraTagSyntax(text, nodeId);

  for (const ref of extractLoraRefs(text)) {
    if (!ref.name || ref.name.includes('__')) continue;

    // Existence checks require a configured LoRA folder.
    if (!index) continue;

    const expandedNames = expandLoraNameVariants(ref.name);
    const missing = expandedNames.filter(
      (expanded) => !resolveLoraName(expanded, index),
    );
    if (missing.length === 0) continue;

    if (expandedNames.length === 1) {
      issues.push({
        severity: 'warning',
        code: 'missing_lora',
        message: `LoRA not found in configured folder: \`${ref.raw}\``,
        nodeId,
        line: ref.line,
        column: ref.column,
        snippet: ref.raw,
      });
      continue;
    }

    const shown = missing.slice(0, 3).map((name) => `\`${name}\``);
    const more =
      missing.length > shown.length
        ? ` (+${missing.length - shown.length} more)`
        : '';
    issues.push({
      severity: 'warning',
      code: 'missing_lora',
      message: `LoRA variant not found in configured folder: ${shown.join(', ')}${more} (from \`${ref.raw}\`)`,
      nodeId,
      line: ref.line,
      column: ref.column,
      snippet: ref.raw,
    });
  }
  return issues;
}

/**
 * Warn for each on-disk LoRA that no wildcard file references.
 * Requires a configured index; references come from the open library.
 * These are library-wide warnings and are never tied to a graph node.
 */
export function listUnusedLoraFiles(
  index: LoraIndex,
  libraryTexts: string[],
  ignoredRelativePaths: Iterable<string> = [],
): LoraFileEntry[] {
  const referenced = collectReferencedLoraNames(libraryTexts);
  const ignored = new Set(
    [...ignoredRelativePaths].map((item) =>
      item.trim().replaceAll('\\', '/').toLowerCase(),
    ),
  );
  const unused: LoraFileEntry[] = [];
  for (const file of index.files) {
    if (isLoraFileReferenced(file, referenced)) continue;
    if (ignored.has(file.relativePath.replaceAll('\\', '/').toLowerCase())) {
      continue;
    }
    unused.push(file);
  }
  return unused;
}

/**
 * Warn for each on-disk LoRA that no wildcard file references.
 * Requires a configured index; references come from the open library.
 * These are library-wide warnings and are never tied to a graph node.
 */
export function validateUnusedLoras(
  index: LoraIndex,
  libraryTexts: string[],
  ignoredRelativePaths: Iterable<string> = [],
): Issue[] {
  const unused = listUnusedLoraFiles(
    index,
    libraryTexts,
    ignoredRelativePaths,
  );
  return buildUnusedLoraIssues(unused, libraryTexts);
}

/**
 * Warn when two or more on-disk LoRA files share the same AutoV2 hash
 * (identical weights under different names/paths).
 * Files without a known AutoV2 are skipped.
 */
export function validateDuplicateLoraAutoV2(index: LoraIndex): Issue[] {
  const byHash = new Map<string, LoraFileEntry[]>();
  for (const file of index.files) {
    const hash = file.autoV2?.trim().toUpperCase();
    if (!hash) continue;
    const list = byHash.get(hash) ?? [];
    list.push(file);
    byHash.set(hash, list);
  }

  const issues: Issue[] = [];
  const groups = [...byHash.entries()]
    .filter(([, files]) => files.length > 1)
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [hash, files] of groups) {
    const sorted = [...files].sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath),
    );
    for (const file of sorted) {
      const relatedPaths = sorted
        .filter((other) => other.absolutePath !== file.absolutePath)
        .map((other) => other.relativePath.replace(/\\/g, '/'));
      issues.push({
        severity: 'warning',
        code: 'duplicate_lora_hash',
        message: `Duplicate AutoV2 \`${hash}\` — same hash as ${relatedPaths.length} other file${relatedPaths.length === 1 ? '' : 's'}`,
        snippet: file.relativePath.replace(/\\/g, '/'),
        relatedPaths,
      });
    }
  }
  return issues;
}
