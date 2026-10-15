import {
  expandLoraNameVariants,
  extractLoraRefs,
  type LoraFileEntry,
  type LoraRef,
} from './lora.js';
import {
  buildCompactLoraSeriesPickName,
  groupUnusedLoraFiles,
  parseLoraTrainingStep,
} from './loraSeries.js';
import type { Issue } from './types.js';

export type LoraSeriesExtendPlan = {
  relativePath: string;
  text: string;
  /** e.g. `Styles_FlatLines_+2500,+3000` */
  summary: string;
};

type SeriesKey = string;

function seriesKey(seriesBase: string, separator: '_' | '-'): SeriesKey {
  return `${seriesBase}\0${separator}`;
}

function fileDirAndBase(stem: string): { dir: string; base: string } {
  const normalized = stem.replaceAll('\\', '/').replace(/\/+$/g, '');
  const slash = normalized.lastIndexOf('/');
  if (slash === -1) return { dir: '', base: normalized };
  return {
    dir: normalized.slice(0, slash),
    base: normalized.slice(slash + 1),
  };
}

function formatStepLabel(digits: string): string {
  const trimmed = digits.replace(/^0+/, '');
  return trimmed.length > 0 ? trimmed : '0';
}

/**
 * True when any library `<lora:…>` tag already expands to at least one
 * training step of this series (same base + separator).
 */
export function libraryReferencesLoraSeries(
  libraryTexts: string[],
  seriesBase: string,
  separator: '_' | '-',
): boolean {
  for (const text of libraryTexts) {
    for (const ref of extractLoraRefs(text)) {
      for (const variant of expandLoraNameVariants(ref.name)) {
        const normalized = variant.replaceAll('\\', '/');
        const slash = normalized.lastIndexOf('/');
        const base = slash === -1 ? normalized : normalized.slice(slash + 1);
        const parsed = parseLoraTrainingStep(base);
        if (
          parsed &&
          parsed.seriesBase === seriesBase &&
          parsed.separator === separator
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Missing training steps keyed by seriesBase + separator (basename series). */
function missingStepsBySeries(
  unusedFiles: LoraFileEntry[],
): Map<
  SeriesKey,
  { seriesBase: string; separator: '_' | '-'; steps: Set<string> }
> {
  const map = new Map<
    SeriesKey,
    { seriesBase: string; separator: '_' | '-'; steps: Set<string> }
  >();
  for (const file of unusedFiles) {
    const { base } = fileDirAndBase(file.stem);
    const parsed = parseLoraTrainingStep(base);
    if (!parsed) continue;
    const key = seriesKey(parsed.seriesBase, parsed.separator);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        seriesBase: parsed.seriesBase,
        separator: parsed.separator,
        steps: new Set(),
      };
      map.set(key, bucket);
    }
    bucket.steps.add(parsed.stepDigits);
  }
  return map;
}

/**
 * If this LoRA name expands to training-step members of `wanted`, return the
 * rebuilt pick name that also includes the missing steps.
 */
function extendedPickNameForRef(
  refName: string,
  wanted: {
    seriesBase: string;
    separator: '_' | '-';
    steps: Set<string>;
  },
): { newName: string; addedSteps: string[] } | null {
  const expanded = expandLoraNameVariants(refName);
  const covered = new Set<string>();
  let dirPrefix = '';
  let matched = false;

  for (const variant of expanded) {
    const normalized = variant.replaceAll('\\', '/');
    const slash = normalized.lastIndexOf('/');
    const base = slash === -1 ? normalized : normalized.slice(slash + 1);
    const parsed = parseLoraTrainingStep(base);
    if (!parsed) continue;
    if (
      parsed.seriesBase !== wanted.seriesBase ||
      parsed.separator !== wanted.separator
    ) {
      continue;
    }
    matched = true;
    covered.add(parsed.stepDigits);
    if (slash >= 0 && !dirPrefix) {
      dirPrefix = normalized.slice(0, slash + 1);
    }
  }

  if (!matched) return null;

  const addedSteps = [...wanted.steps]
    .filter((step) => !covered.has(step))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (addedSteps.length === 0) return null;

  const allSteps = [...new Set([...covered, ...wanted.steps])];
  const pick = buildCompactLoraSeriesPickName(
    wanted.seriesBase,
    wanted.separator,
    allSteps,
  );
  return { newName: `${dirPrefix}${pick}`, addedSteps };
}

function replaceLoraNameInLine(
  line: string,
  ref: LoraRef,
  newName: string,
): string {
  const start = ref.column - 1;
  const end = ref.endColumn - 1;
  if (start < 0 || end <= start || end > line.length) return line;
  const raw = line.slice(start, end);
  const replaced = raw.replace(/^(<lora:)([^:>]*)(:)/i, `$1${newName}$3`);
  if (replaced === raw) return line;
  return `${line.slice(0, start)}${replaced}${line.slice(end)}`;
}

/**
 * Extend one training-step series in a single wildcard text (if a matching
 * `<lora:…>` root already exists).
 */
export function extendLoraSeriesStepsForSeries(
  text: string,
  seriesBase: string,
  separator: '_' | '-',
  stepDigitsList: readonly string[],
): { text: string; changed: boolean; summary?: string } {
  const steps = new Set(
    stepDigitsList.map((s) => s.trim()).filter((s) => s.length > 0),
  );
  if (steps.size === 0) return { text, changed: false };
  const missing = new Map<
    SeriesKey,
    { seriesBase: string; separator: '_' | '-'; steps: Set<string> }
  >([
    [seriesKey(seriesBase, separator), { seriesBase, separator, steps }],
  ]);
  const result = extendLoraSeriesStepsInText(text, missing);
  return {
    text: result.text,
    changed: result.changed,
    summary: result.addedSummaries.length
      ? [...new Set(result.addedSummaries)].join('; ')
      : undefined,
  };
}

/**
 * Rewrite `<lora:…>` tags in one file so existing training-step series picks
 * also cover the missing on-disk steps.
 */
export function extendLoraSeriesStepsInText(
  text: string,
  missing: Map<
    SeriesKey,
    { seriesBase: string; separator: '_' | '-'; steps: Set<string> }
  >,
): { text: string; changed: boolean; addedSummaries: string[] } {
  if (missing.size === 0) {
    return { text, changed: false, addedSummaries: [] };
  }

  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const addedSummaries: string[] = [];
  let changed = false;

  // Bottom-up so column offsets stay valid within each line when multiple tags.
  const refs = extractLoraRefs(text).slice().reverse();
  for (const ref of refs) {
    for (const wanted of missing.values()) {
      const extended = extendedPickNameForRef(ref.name, wanted);
      if (!extended) continue;
      const lineIdx = ref.line - 1;
      const line = lines[lineIdx];
      if (line == null) continue;
      const nextLine = replaceLoraNameInLine(line, ref, extended.newName);
      if (nextLine === line) continue;
      lines[lineIdx] = nextLine;
      changed = true;
      addedSummaries.push(
        `${wanted.seriesBase}${wanted.separator}+${extended.addedSteps
          .map(formatStepLabel)
          .join(',')}`,
      );
      break;
    }
  }

  return {
    text: changed ? lines.join(newline) : text,
    changed,
    addedSummaries,
  };
}

/**
 * Find wildcard files whose existing LoRA series tags can absorb unused
 * training-step files (e.g. add 2500|3000 into `00000{1500|1750|2000}`).
 */
export function planExtendUnusedLoraSeriesSteps(opts: {
  unusedFiles: LoraFileEntry[];
  libraryFiles: Array<{ relativePath: string; text: string }>;
}): LoraSeriesExtendPlan[] {
  const missing = missingStepsBySeries(opts.unusedFiles);
  if (missing.size === 0) return [];

  const plans: LoraSeriesExtendPlan[] = [];
  for (const file of opts.libraryFiles) {
    const result = extendLoraSeriesStepsInText(file.text, missing);
    if (!result.changed) continue;
    plans.push({
      relativePath: file.relativePath.replaceAll('\\', '/'),
      text: result.text,
      summary: [...new Set(result.addedSummaries)].join('; '),
    });
  }
  return plans;
}

/**
 * Build unused_lora issues. When library texts already reference the series,
 * message + fixAction describe missing steps (extend) instead of “no reference”.
 */
export function buildUnusedLoraIssues(
  files: LoraFileEntry[],
  libraryTexts: string[] = [],
): Issue[] {
  const grouped = groupUnusedLoraFiles(files);
  const issues: Issue[] = [];
  for (const entry of grouped) {
    if (entry.kind === 'single') {
      const file = entry.file;
      const { base } = fileDirAndBase(file.stem);
      const parsed = parseLoraTrainingStep(base);
      const canExtend =
        parsed != null &&
        libraryReferencesLoraSeries(
          libraryTexts,
          parsed.seriesBase,
          parsed.separator,
        );
      if (canExtend && parsed) {
        issues.push({
          severity: 'warning',
          code: 'unused_lora',
          message: `Existing LoRA reference is missing training step \`${formatStepLabel(parsed.stepDigits)}\` for \`${parsed.seriesBase}${parsed.separator}*\``,
          snippet: file.relativePath.replace(/\\/g, '/'),
          fixAction: 'extend_lora_series',
        });
      } else {
        issues.push({
          severity: 'warning',
          code: 'unused_lora',
          message: `LoRA on disk is not referenced by any wildcard file: \`${file.stem}\``,
          snippet: file.relativePath.replace(/\\/g, '/'),
        });
      }
      continue;
    }
    const { group } = entry;
    const paths = group.members.map((m) =>
      m.relativePath.replace(/\\/g, '/'),
    );
    const [head, ...rest] = paths;
    const canExtend = libraryReferencesLoraSeries(
      libraryTexts,
      group.seriesBase,
      group.separator,
    );
    const stepLabels = group.stepDigitsList
      .map(formatStepLabel)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (canExtend) {
      issues.push({
        severity: 'warning',
        code: 'unused_lora',
        message: `Existing LoRA reference is missing training steps for \`${group.displayStem}\`: ${stepLabels.join(', ')}`,
        snippet: head,
        relatedPaths: rest,
        fixAction: 'extend_lora_series',
      });
    } else {
      issues.push({
        severity: 'warning',
        code: 'unused_lora',
        message: `LoRA training series on disk is not referenced by any wildcard file: \`${group.displayStem}\` (${group.members.length} steps)`,
        snippet: head,
        relatedPaths: rest,
      });
    }
  }
  return issues;
}
