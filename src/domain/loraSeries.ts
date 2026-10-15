import { DEFAULT_LORA_DOWNLOAD_WEIGHTS } from './loraDownloadCategory.js';
import { formatLoraSnippetCommentLines, appendLoraExtraPrompt } from './civitaiSnippet.js';
import type { Issue } from './types.js';
import type { LoraFileEntry } from './lora.js';

const WINDOWS_DUP_SUFFIX_RE = / \(\d+\)$/;
/** Trailing training-step digits (kohya / similar): name_000250 or name-000001000 */
const TRAINING_STEP_RE = /^(.+?)([_-])(\d{3,})$/;

export type LoraSeriesParse = {
  /** Basename without step, e.g. `Melly`. */
  seriesBase: string;
  separator: '_' | '-';
  /** Digit run as it appears on disk. */
  stepDigits: string;
};

/**
 * Parse a LoRA basename (no folder/ext) as `Base_step` / `Base-step`.
 * Strips a Windows ` (1)` copy suffix first.
 */
export function parseLoraTrainingStep(baseName: string): LoraSeriesParse | null {
  const trimmed = baseName.trim();
  if (!trimmed) return null;
  const withoutDup = trimmed.replace(WINDOWS_DUP_SUFFIX_RE, '');
  const match = TRAINING_STEP_RE.exec(withoutDup);
  if (!match) return null;
  const seriesBase = match[1]!;
  const separator = match[2] as '_' | '-';
  const stepDigits = match[3]!;
  if (!seriesBase || /[_-]$/.test(seriesBase)) return null;
  return { seriesBase, separator, stepDigits };
}

/**
 * Build the shortest Dynamic Prompts pick-list model name that expands to
 * every step on disk.
 *
 * Same digit width → share longest common zero/digit prefix:
 *   Melly_000000250 + Melly_000000500 → Melly_000000{250|500}
 * Mixed widths → brace holds full digit runs (must match disk):
 *   Melly_000000250 + Melly_0000001000 → Melly_{000000250|0000001000}
 */
export function buildCompactLoraSeriesPickName(
  seriesBase: string,
  separator: '_' | '-',
  stepDigitsList: string[],
): string {
  const unique = [
    ...new Set(stepDigitsList.map((s) => s.trim()).filter(Boolean)),
  ];
  if (unique.length === 0) return `${seriesBase}${separator}`;
  if (unique.length === 1) {
    return `${seriesBase}${separator}${unique[0]}`;
  }

  const lengths = new Set(unique.map((s) => s.length));
  if (lengths.size === 1) {
    const len = unique[0]!.length;
    let prefixLen = 0;
    while (prefixLen < len) {
      const ch = unique[0]![prefixLen]!;
      if (!unique.every((s) => s[prefixLen] === ch)) break;
      prefixLen += 1;
    }
    // Keep at least one character inside the brace.
    if (prefixLen >= len) prefixLen = len - 1;
    const prefix = unique[0]!.slice(0, prefixLen);
    const suffixes = unique
      .map((s) => s.slice(prefixLen))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return `${seriesBase}${separator}${prefix}{${suffixes.join('|')}}`;
  }

  const full = [...unique].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  return `${seriesBase}${separator}{${full.join('|')}}`;
}

/** Format ` keyword1, keyword2` for a LOCAL LoRA reference line. */
export function formatLocalLoraKeywordSuffix(
  keywords: string[] | undefined,
): string {
  const words = [...new Set((keywords ?? []).map((k) => k.trim()).filter(Boolean))];
  if (words.length === 0) return '';
  return ` ${words.join(', ')}`;
}

export function buildLocalLoraSeriesSnippet(opts: {
  seriesBase: string;
  separator: '_' | '-';
  stepDigitsList: string[];
  weights?: string;
  /** Activation / trigger words appended after the `<lora:…>` tag. */
  keywords?: string[];
  /** Optional `#` comment line(s) between `# LOCAL` and `<lora:…>`. */
  extraComment?: string | null;
  /** Optional prompt text after keywords on the `<lora:…>` line. */
  extraPrompt?: string | null;
}): string {
  const pick = buildCompactLoraSeriesPickName(
    opts.seriesBase,
    opts.separator,
    opts.stepDigitsList,
  );
  const weights = (opts.weights ?? '').trim() || DEFAULT_LORA_DOWNLOAD_WEIGHTS;
  const lines: string[] = ['# LOCAL'];
  for (const comment of formatLoraSnippetCommentLines(opts.extraComment)) {
    lines.push(comment);
  }
  const loraLine = appendLoraExtraPrompt(
    `<lora:${pick}:${weights}>${formatLocalLoraKeywordSuffix(opts.keywords)}`,
    opts.extraPrompt,
  );
  lines.push(loraLine);
  return lines.join('\n');
}

export function buildLocalLoraSingleSnippet(opts: {
  fileStem: string;
  weights?: string;
  keywords?: string[];
  extraComment?: string | null;
  extraPrompt?: string | null;
}): string {
  const stem = opts.fileStem.trim();
  const weights = (opts.weights ?? '').trim() || DEFAULT_LORA_DOWNLOAD_WEIGHTS;
  const lines: string[] = ['# LOCAL'];
  for (const comment of formatLoraSnippetCommentLines(opts.extraComment)) {
    lines.push(comment);
  }
  const loraLine = appendLoraExtraPrompt(
    `<lora:${stem}:${weights}>${formatLocalLoraKeywordSuffix(opts.keywords)}`,
    opts.extraPrompt,
  );
  lines.push(loraLine);
  return lines.join('\n');
}

/** Basename without folder or model extension. */
export function loraBasenameFromRelativePath(relativePath: string): string {
  return relativePath
    .replaceAll('\\', '/')
    .replace(/^.*\//, '')
    .replace(/\.(safetensors|ckpt|pt)$/i, '');
}

/**
 * `# LOCAL` + `<lora:…>` block that Categorize appends to a category wildcard.
 * Series (≥2 training steps) become a compact pick; a single file is a stem tag.
 */
export function buildUnusedLoraLocalSnippet(opts: {
  relativePaths: string[];
  weights?: string;
  keywords?: string[];
  extraComment?: string | null;
  extraPrompt?: string | null;
}): string | null {
  const bases = [
    ...new Set(
      opts.relativePaths.map(loraBasenameFromRelativePath).filter(Boolean),
    ),
  ];
  if (bases.length === 0) return null;

  const steps: string[] = [];
  let seriesBase = '';
  let separator: '_' | '-' = '_';
  let series = bases.length >= 2;
  for (const base of bases) {
    const parsed = parseLoraTrainingStep(base);
    if (!parsed) {
      series = false;
      break;
    }
    if (!seriesBase) {
      seriesBase = parsed.seriesBase;
      separator = parsed.separator;
    } else if (
      seriesBase !== parsed.seriesBase ||
      separator !== parsed.separator
    ) {
      series = false;
      break;
    }
    steps.push(parsed.stepDigits);
  }

  if (series && seriesBase) {
    return buildLocalLoraSeriesSnippet({
      seriesBase,
      separator,
      stepDigitsList: steps,
      weights: opts.weights,
      keywords: opts.keywords,
      extraComment: opts.extraComment,
      extraPrompt: opts.extraPrompt,
    });
  }
  if (bases.length === 1) {
    return buildLocalLoraSingleSnippet({
      fileStem: bases[0]!,
      weights: opts.weights,
      keywords: opts.keywords,
      extraComment: opts.extraComment,
      extraPrompt: opts.extraPrompt,
    });
  }
  return null;
}

export type LoraSeriesMember = {
  stem: string;
  relativePath: string;
};

export type GroupedLoraSeries<T extends LoraSeriesMember = LoraFileEntry> = {
  /** Display stem, e.g. `!Testing/Melly_*`. */
  displayStem: string;
  /** Compact pick, e.g. `Melly_000000{250|500}` (basename; may include dir prefix in UI). */
  pickName: string;
  seriesBase: string;
  separator: '_' | '-';
  dir: string;
  members: T[];
  stepDigitsList: string[];
};

/** @deprecated Prefer GroupedLoraSeries — same shape for unused-issue grouping. */
export type GroupedUnusedLora = GroupedLoraSeries<LoraFileEntry>;

export type GroupedLoraSeriesEntry<T extends LoraSeriesMember> =
  | { kind: 'single'; file: T }
  | { kind: 'series'; group: GroupedLoraSeries<T> };

function fileDirAndBase(stem: string): { dir: string; base: string } {
  const normalized = stem.replaceAll('\\', '/').replace(/\/+$/g, '');
  const slash = normalized.lastIndexOf('/');
  if (slash === -1) return { dir: '', base: normalized };
  return {
    dir: normalized.slice(0, slash),
    base: normalized.slice(slash + 1),
  };
}

/**
 * Collapse files that share a training-step series (same dir + base + separator,
 * ≥2 steps) into one row; leave other files as singles.
 */
export function groupLoraFilesByTrainingSeries<T extends LoraSeriesMember>(
  files: T[],
): GroupedLoraSeriesEntry<T>[] {
  type Bucket = {
    seriesBase: string;
    separator: '_' | '-';
    dir: string;
    members: T[];
  };
  const buckets = new Map<string, Bucket>();
  const singles: T[] = [];

  for (const file of files) {
    const { dir, base } = fileDirAndBase(file.stem);
    const parsed = parseLoraTrainingStep(base);
    if (!parsed) {
      singles.push(file);
      continue;
    }
    const key = `${dir}\0${parsed.seriesBase}\0${parsed.separator}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        seriesBase: parsed.seriesBase,
        separator: parsed.separator,
        dir,
        members: [],
      };
      buckets.set(key, bucket);
    }
    bucket.members.push(file);
  }

  const out: GroupedLoraSeriesEntry<T>[] = [];

  for (const file of singles) {
    out.push({ kind: 'single', file });
  }

  for (const bucket of buckets.values()) {
    if (bucket.members.length < 2) {
      out.push({ kind: 'single', file: bucket.members[0]! });
      continue;
    }
    const members = [...bucket.members].sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath, undefined, {
        numeric: true,
      }),
    );
    const stepDigitsList = members.map((m) => {
      const { base } = fileDirAndBase(m.stem);
      return parseLoraTrainingStep(base)!.stepDigits;
    });
    const pickName = buildCompactLoraSeriesPickName(
      bucket.seriesBase,
      bucket.separator,
      stepDigitsList,
    );
    const displayStem = bucket.dir
      ? `${bucket.dir}/${bucket.seriesBase}${bucket.separator}*`
      : `${bucket.seriesBase}${bucket.separator}*`;
    out.push({
      kind: 'series',
      group: {
        displayStem,
        seriesBase: bucket.seriesBase,
        separator: bucket.separator,
        dir: bucket.dir,
        members,
        stepDigitsList,
        pickName,
      },
    });
  }

  out.sort((a, b) => {
    const sa =
      a.kind === 'single' ? a.file.stem : a.group.displayStem;
    const sb =
      b.kind === 'single' ? b.file.stem : b.group.displayStem;
    return sa.localeCompare(sb, undefined, { numeric: true });
  });
  return out;
}

/**
 * Collapse unused LoRA files that share a training-step series into one
 * issue each; leave non-series files as individual issues.
 */
export function groupUnusedLoraFiles(
  files: LoraFileEntry[],
): GroupedLoraSeriesEntry<LoraFileEntry>[] {
  return groupLoraFilesByTrainingSeries(files);
}

/** Build unused_lora Issue list with series collapsed via relatedPaths. */
export function unusedLoraIssuesFromFiles(files: LoraFileEntry[]): Issue[] {
  const grouped = groupUnusedLoraFiles(files);
  const issues: Issue[] = [];
  for (const entry of grouped) {
    if (entry.kind === 'single') {
      const file = entry.file;
      issues.push({
        severity: 'warning',
        code: 'unused_lora',
        message: `LoRA on disk is not referenced by any wildcard file: \`${file.stem}\``,
        snippet: file.relativePath.replace(/\\/g, '/'),
      });
      continue;
    }
    const { group } = entry;
    const paths = group.members.map((m) =>
      m.relativePath.replace(/\\/g, '/'),
    );
    const [head, ...rest] = paths;
    issues.push({
      severity: 'warning',
      code: 'unused_lora',
      message: `LoRA training series on disk is not referenced by any wildcard file: \`${group.displayStem}\` (${group.members.length} steps)`,
      snippet: head,
      relatedPaths: rest,
    });
  }
  return issues;
}
