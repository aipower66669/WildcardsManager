import { findMatchingBrace, splitTopLevelOptions } from './parseVariants.js';
import { expandDynamicWildcardName } from './dynamicWildcardName.js';
import {
  buildLibraryIndex,
  resolveWildcard,
  type LibraryIndex,
} from './resolveWildcard.js';
import type { Issue, LibraryFile } from './types.js';

export type ExpandMode = 'exhaustive' | 'random';

export type ExpandInput = {
  rootRelativePath: string;
  files: LibraryFile[];
  mode: ExpandMode;
  /** Max samples returned. */
  limit?: number;
  /** Seed for random mode. */
  seed?: number;
  maxDepth?: number;
  /**
   * When false, skip the full combination count. Generation only needs one
   * random sample; counting a deep wildcard tree blocks the UI for seconds.
   */
  countCombinations?: boolean;
};

export type ExpandResult = {
  mode: ExpandMode;
  rootKey: string;
  samples: string[];
  /** Estimated size of the full combination space (saturated). */
  totalCombinations: number;
  combinationsSaturated: boolean;
  limit: number;
  /** True when the space is larger than the returned sample set. */
  truncated: boolean;
  seed: number | null;
  issues: Issue[];
};

const SATURATION = 1_000_000_000;
const ANCHORED_WILDCARD = /^__([^_\n](?:[^_\n]|_(?!_))*)__/;

type VariantOption = { text: string; weight: number };
type ParsedVariant = {
  low: number;
  high: number;
  separator: string;
  options: VariantOption[];
};
type Segment =
  | { type: 'lit'; text: string }
  | { type: 'var'; variant: ParsedVariant }
  | { type: 'wild'; name: string };

type ExpandCtx = {
  index: LibraryIndex;
  maxDepth: number;
  rng: () => number;
  addIssue: (issue: Issue) => void;
  /** Called every time a wildcard file key is selected during a walk.
   *  `fromKey` is the file currently being expanded (the parent). */
  onVisit?: (key: string, fromKey?: string) => void;
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function satMul(a: number, b: number): number {
  const r = a * b;
  return r >= SATURATION ? SATURATION : r;
}
function satAdd(a: number, b: number): number {
  const r = a + b;
  return r >= SATURATION ? SATURATION : r;
}

function isStructured(ext: string): boolean {
  return ext === '.yaml' || ext === '.yml' || ext === '.json';
}

function activeLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

function cleanup(text: string): string {
  return text.replace(/[ \t]{2,}/g, ' ').trim();
}

function indexOfTopLevel(body: string, token: string): number {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && body.startsWith(token, i)) return i;
  }
  return -1;
}

function parseOption(raw: string): VariantOption {
  const match = /^\s*(\d+(?:\.\d+)?)::/.exec(raw);
  if (match) {
    return { text: raw.slice(match[0].length), weight: parseFloat(match[1]!) };
  }
  return { text: raw, weight: 1 };
}

function parseVariantBody(body: string): ParsedVariant {
  let separator = ', ';
  let rangeRaw = '';
  let optionsBody = body;

  const firstDD = indexOfTopLevel(body, '$$');
  if (firstDD !== -1) {
    rangeRaw = body.slice(0, firstDD).trim();
    let rest = body.slice(firstDD + 2);
    const secondDD = indexOfTopLevel(rest, '$$');
    if (secondDD !== -1) {
      separator = rest.slice(0, secondDD);
      rest = rest.slice(secondDD + 2);
    }
    optionsBody = rest;
  }

  const options = splitTopLevelOptions(optionsBody).map(parseOption);
  const count = options.length;

  let low = 1;
  let high = 1;
  if (firstDD !== -1) {
    if (rangeRaw === '') {
      low = 0;
      high = count;
    } else if (rangeRaw.includes('-')) {
      const [lo, hi] = rangeRaw.split('-');
      low = lo && lo.trim() !== '' ? parseInt(lo, 10) : 0;
      high = hi && hi.trim() !== '' ? parseInt(hi, 10) : count;
    } else {
      low = parseInt(rangeRaw, 10);
      high = low;
    }
  }

  if (!Number.isFinite(low)) low = 0;
  if (!Number.isFinite(high)) high = count;
  low = Math.max(0, Math.min(low, count));
  high = Math.max(low, Math.min(high, count));

  return { low, high, separator, options };
}

function tokenizeTemplate(text: string): Segment[] {
  const segments: Segment[] = [];
  let literal = '';
  const flush = () => {
    if (literal) {
      segments.push({ type: 'lit', text: literal });
      literal = '';
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '{') {
      const close = findMatchingBrace(text, i);
      if (close === -1) {
        literal += ch;
        i += 1;
        continue;
      }
      flush();
      segments.push({ type: 'var', variant: parseVariantBody(text.slice(i + 1, close)) });
      i = close + 1;
      continue;
    }
    if (ch === '_' && text[i + 1] === '_') {
      const match = ANCHORED_WILDCARD.exec(text.slice(i));
      if (match) {
        flush();
        segments.push({ type: 'wild', name: match[1]!.trim() });
        i += match[0].length;
        continue;
      }
    }
    literal += ch;
    i += 1;
  }
  flush();
  return segments;
}

function* indexCombos(n: number, k: number): Generator<number[]> {
  if (k < 0 || k > n) return;
  if (k === 0) {
    yield [];
    return;
  }
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.slice();
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i -= 1;
    if (i < 0) break;
    idx[i]! += 1;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}

function fileCandidates(
  name: string,
  ctx: ExpandCtx,
): { keys: string[]; missing: boolean; globId?: string } {
  const names = expandDynamicWildcardName(name);
  const keys: string[] = [];
  let globId: string | undefined;
  let sawMissing = false;

  for (const resolvedName of names) {
    const resolved = resolveWildcard(resolvedName, ctx.index);
    if (resolved.kind === 'missing') {
      sawMissing = true;
      continue;
    }
    if (resolved.kind === 'glob') {
      keys.push(...(resolved.matchedKeys ?? []));
      globId = resolved.id;
      continue;
    }
    keys.push(resolved.relativeKey ?? resolved.id);
  }

  if (keys.length === 0) {
    if (sawMissing) {
      ctx.addIssue({
        severity: 'warning',
        code: 'missing_file',
        message: `Unresolved reference while expanding: __${name}__`,
      });
    }
    return { keys: [], missing: true };
  }

  return {
    keys: [...new Set(keys)],
    missing: false,
    globId,
  };
}

function fileFor(key: string, ctx: ExpandCtx): LibraryFile | undefined {
  return ctx.index.byKey.get(key) ?? ctx.index.byKeyLower.get(key.toLowerCase());
}

function candidateLines(key: string, ctx: ExpandCtx): string[] | undefined {
  const structured =
    ctx.index.structuredByKey.get(key) ??
    ctx.index.structuredByKeyLower.get(key.toLowerCase());
  if (structured) return structured.values.map((value) => value.text);

  const file = fileFor(key, ctx);
  if (!file) return undefined;
  if (isStructured(file.ext)) {
    return ctx.index.structuredDocuments
      .get(file.key)
      ?.entries.flatMap((entry) => entry.values.map((value) => value.text));
  }
  return activeLines(file.text);
}

// ---- Random expansion ----

function weightedSample(
  options: VariantOption[],
  k: number,
  rng: () => number,
): VariantOption[] {
  const pool = options.map((o) => ({ o, w: o.weight > 0 ? o.weight : 0 }));
  const chosen: VariantOption[] = [];
  for (let n = 0; n < k && pool.length > 0; n++) {
    const totalW = pool.reduce((s, p) => s + p.w, 0);
    let idx = 0;
    if (totalW <= 0) {
      idx = Math.floor(rng() * pool.length);
    } else {
      let r = rng() * totalW;
      for (; idx < pool.length; idx++) {
        r -= pool[idx]!.w;
        if (r <= 0) break;
      }
      if (idx >= pool.length) idx = pool.length - 1;
    }
    chosen.push(pool[idx]!.o);
    pool.splice(idx, 1);
  }
  return chosen;
}

function expandRandom(
  text: string,
  ctx: ExpandCtx,
  path: string[],
  depth: number,
): string {
  if (depth > ctx.maxDepth) return text;
  let out = '';
  for (const seg of tokenizeTemplate(text)) {
    if (seg.type === 'lit') {
      out += seg.text;
    } else if (seg.type === 'var') {
      const v = seg.variant;
      if (v.options.length === 0) continue;
      const k =
        v.low === v.high
          ? v.low
          : v.low + Math.floor(ctx.rng() * (v.high - v.low + 1));
      const picks = weightedSample(v.options, Math.min(k, v.options.length), ctx.rng);
      out += picks
        .map((o) => expandRandom(o.text, ctx, path, depth + 1))
        .join(v.separator);
    } else {
      const { keys, missing, globId } = fileCandidates(seg.name, ctx);
      if (missing || keys.length === 0) {
        out += `__${seg.name}__`;
        continue;
      }
      const fromKey = path[path.length - 1];
      if (globId) ctx.onVisit?.(globId, fromKey);
      const key = keys.length === 1 ? keys[0]! : keys[Math.floor(ctx.rng() * keys.length)]!;
      ctx.onVisit?.(key, globId ?? fromKey);
      if (path.includes(key)) {
        ctx.addIssue({
          severity: 'warning',
          code: 'cycle',
          message: `Recursion stopped while expanding: __${seg.name}__`,
        });
        out += `__${seg.name}__`;
        continue;
      }
      const lines = candidateLines(key, ctx);
      if (!lines) {
        out += `__${seg.name}__`;
        continue;
      }
      if (lines.length === 0) {
        ctx.addIssue({
          severity: 'warning',
          code: 'unsupported_structured_value',
          message: `Structured wildcard has no scalar/list values: __${seg.name}__`,
        });
        out += `__${seg.name}__`;
        continue;
      }
      const line = lines[Math.floor(ctx.rng() * lines.length)]!;
      out += expandRandom(line, ctx, [...path, key], depth + 1);
    }
  }
  return out;
}

// ---- Exhaustive expansion ----

function crossJoin(a: string[], b: string[], cap: number): string[] {
  const out: string[] = [];
  for (const x of a) {
    for (const y of b) {
      out.push(x + y);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

function expandAll(
  text: string,
  ctx: ExpandCtx,
  path: string[],
  depth: number,
  cap: number,
): string[] {
  if (depth > ctx.maxDepth) return [text];
  let results: string[] = [''];
  for (const seg of tokenizeTemplate(text)) {
    const pieces = segmentOptions(seg, ctx, path, depth, cap);
    results = crossJoin(results, pieces, cap);
    if (results.length >= cap) break;
  }
  return results;
}

function segmentOptions(
  seg: Segment,
  ctx: ExpandCtx,
  path: string[],
  depth: number,
  cap: number,
): string[] {
  if (seg.type === 'lit') return [seg.text];

  if (seg.type === 'wild') {
    const { keys, missing } = fileCandidates(seg.name, ctx);
    if (missing || keys.length === 0) return [`__${seg.name}__`];
    const out: string[] = [];
    for (const key of keys) {
      if (path.includes(key)) {
        ctx.addIssue({
          severity: 'warning',
          code: 'cycle',
          message: `Recursion stopped while expanding: __${seg.name}__`,
        });
        out.push(`__${seg.name}__`);
        continue;
      }
      const lines = candidateLines(key, ctx);
      if (!lines) continue;
      if (lines.length === 0) {
        ctx.addIssue({
          severity: 'warning',
          code: 'unsupported_structured_value',
          message: `Structured wildcard has no scalar/list values: __${seg.name}__`,
        });
        out.push(`__${seg.name}__`);
        continue;
      }
      for (const line of lines) {
        for (const e of expandAll(line, ctx, [...path, key], depth + 1, cap)) {
          out.push(e);
          if (out.length >= cap) return out;
        }
      }
    }
    return out.length > 0 ? out : [`__${seg.name}__`];
  }

  const v = seg.variant;
  if (v.options.length === 0) return [''];
  const out: string[] = [];
  for (let k = v.low; k <= v.high; k++) {
    for (const combo of indexCombos(v.options.length, k)) {
      let partial: string[] = [''];
      combo.forEach((ci, position) => {
        const optExpansions = expandAll(v.options[ci]!.text, ctx, path, depth + 1, cap);
        const next: string[] = [];
        for (const p of partial) {
          for (const o of optExpansions) {
            next.push(position === 0 ? o : p + v.separator + o);
            if (next.length >= cap) break;
          }
          if (next.length >= cap) break;
        }
        partial = next;
      });
      for (const p of partial) {
        out.push(p);
        if (out.length >= cap) return out;
      }
    }
  }
  return out;
}

// ---- Combination counting ----

function countTemplate(
  text: string,
  ctx: ExpandCtx,
  path: string[],
  depth: number,
): number {
  if (depth > ctx.maxDepth) return 1;
  let total = 1;
  for (const seg of tokenizeTemplate(text)) {
    total = satMul(total, countSegment(seg, ctx, path, depth));
    if (total >= SATURATION) return SATURATION;
  }
  return total;
}

function countSegment(
  seg: Segment,
  ctx: ExpandCtx,
  path: string[],
  depth: number,
): number {
  if (seg.type === 'lit') return 1;

  if (seg.type === 'wild') {
    const { keys, missing } = fileCandidates(seg.name, ctx);
    if (missing || keys.length === 0) return 1;
    let sum = 0;
    for (const key of keys) {
      if (path.includes(key)) {
        sum = satAdd(sum, 1);
        continue;
      }
      const lines = candidateLines(key, ctx);
      if (!lines) {
        sum = satAdd(sum, 1);
        continue;
      }
      for (const line of lines) {
        sum = satAdd(sum, countTemplate(line, ctx, [...path, key], depth + 1));
        if (sum >= SATURATION) return SATURATION;
      }
    }
    return sum || 1;
  }

  const v = seg.variant;
  if (v.options.length === 0) return 1;
  let sum = 0;
  for (let k = v.low; k <= v.high; k++) {
    for (const combo of indexCombos(v.options.length, k)) {
      let prod = 1;
      for (const ci of combo) {
        prod = satMul(prod, countTemplate(v.options[ci]!.text, ctx, path, depth + 1));
        if (prod >= SATURATION) break;
      }
      sum = satAdd(sum, prod);
      if (sum >= SATURATION) return SATURATION;
    }
  }
  return sum || 1;
}

// ---- Public entry point ----

function toKey(relativePath: string): string {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\.(txt|ya?ml|json)$/i, '');
}

export function expandPrompts(input: ExpandInput): ExpandResult {
  const index = buildLibraryIndex(input.files);
  const rootKey = toKey(input.rootRelativePath);
  const rootFile =
    index.byKey.get(rootKey) ?? index.byKeyLower.get(rootKey.toLowerCase());
  const maxDepth = input.maxDepth ?? 25;
  const limit = Math.max(
    1,
    Math.min(input.limit ?? (input.mode === 'random' ? 20 : 100), 2000),
  );

  const issueMap = new Map<string, Issue>();
  const addIssue = (issue: Issue) => {
    const key = `${issue.code}:${issue.message}`;
    if (!issueMap.has(key)) issueMap.set(key, issue);
  };

  const baseResult = (
    samples: string[],
    total: number,
    truncated: boolean,
    seed: number | null,
  ): ExpandResult => ({
    mode: input.mode,
    rootKey,
    samples,
    totalCombinations: total,
    combinationsSaturated: total >= SATURATION,
    limit,
    truncated,
    seed,
    issues: [...issueMap.values()],
  });

  if (!rootFile) {
    addIssue({
      severity: 'error',
      code: 'missing_file',
      message: `Root file not found: ${input.rootRelativePath}`,
    });
    return baseResult([], 0, false, input.mode === 'random' ? (input.seed ?? 0) : null);
  }

  const rootLines = isStructured(rootFile.ext)
    ? (index.structuredDocuments
        .get(rootFile.key)
        ?.entries.flatMap((entry) =>
          entry.values.map((value) => value.text),
        ) ?? [])
    : activeLines(rootFile.text);
  for (const issue of index.structuredDocuments.get(rootFile.key)?.issues ?? []) {
    addIssue(issue);
  }
  const countCombinations = input.countCombinations !== false;
  let total = 0;
  if (countCombinations) {
    const countCtx: ExpandCtx = { index, maxDepth, rng: () => 0, addIssue };
    for (const line of rootLines) {
      total = satAdd(total, countTemplate(line, countCtx, [rootKey], 1));
      if (total >= SATURATION) break;
    }
  }

  if (input.mode === 'random') {
    const seed = (input.seed ?? Math.floor(Math.random() * 1_000_000_000)) >>> 0;
    const rng = mulberry32(seed);
    const ctx: ExpandCtx = { index, maxDepth, rng, addIssue };
    const samples: string[] = [];
    if (rootLines.length > 0) {
      for (let n = 0; n < limit; n++) {
        const line = rootLines[Math.floor(rng() * rootLines.length)]!;
        samples.push(cleanup(expandRandom(line, ctx, [rootKey], 1)));
      }
    }
    return baseResult(samples, total, total > samples.length, seed);
  }

  const ctx: ExpandCtx = { index, maxDepth, rng: () => 0, addIssue };
  const samples: string[] = [];
  for (const line of rootLines) {
    if (samples.length >= limit) break;
    for (const s of expandAll(line, ctx, [rootKey], 1, limit)) {
      samples.push(cleanup(s));
      if (samples.length >= limit) break;
    }
  }
  return baseResult(samples, total, total > samples.length, null);
}

// ---- Monte Carlo simulation (selection-frequency analysis) ----

export type VisitWalker = {
  /** Expand one prompt line (visit-only). Optional root path key for edge parents. */
  walkLine: (text: string, rootPathKey?: string) => void;
  /** Install the visit hook used for the next walk(s). */
  setOnVisit: (
    hook: ((key: string, fromKey?: string) => void) | undefined,
  ) => void;
  addIssue: (issue: Issue) => void;
  takeIssues: () => Issue[];
};

/**
 * Shared RNG + visit walker for Monte Carlo coverage (gen lines / sim roots).
 * Call `walkLine` repeatedly; the same seeded RNG advances across calls.
 */
export function createVisitWalker(
  files: LibraryFile[],
  seed: number,
  maxDepth = 25,
): VisitWalker {
  const index = buildLibraryIndex(files);
  const rng = mulberry32(seed >>> 0);
  const issueMap = new Map<string, Issue>();
  const addIssue = (issue: Issue) => {
    const key = `${issue.code}:${issue.message}`;
    if (!issueMap.has(key)) issueMap.set(key, issue);
  };
  let onVisit: ((key: string, fromKey?: string) => void) | undefined;
  const ctx: ExpandCtx = {
    index,
    maxDepth,
    rng,
    addIssue,
    onVisit: (key, fromKey) => onVisit?.(key, fromKey),
  };
  return {
    walkLine(text, rootPathKey = '__wcm_coverage__') {
      walkRandom(text, ctx, [rootPathKey], 1);
    },
    setOnVisit(hook) {
      onVisit = hook;
    },
    addIssue,
    takeIssues: () => [...issueMap.values()],
  };
}

/** Traverse a random walk without building the output string (visit-only). */
function walkRandom(
  text: string,
  ctx: ExpandCtx,
  path: string[],
  depth: number,
): void {
  if (depth > ctx.maxDepth) return;
  for (const seg of tokenizeTemplate(text)) {
    if (seg.type === 'lit') continue;
    if (seg.type === 'var') {
      const v = seg.variant;
      if (v.options.length === 0) continue;
      const k =
        v.low === v.high
          ? v.low
          : v.low + Math.floor(ctx.rng() * (v.high - v.low + 1));
      const picks = weightedSample(v.options, Math.min(k, v.options.length), ctx.rng);
      for (const o of picks) walkRandom(o.text, ctx, path, depth + 1);
      continue;
    }
    const { keys, missing, globId } = fileCandidates(seg.name, ctx);
    if (missing || keys.length === 0) continue;
    const fromKey = path[path.length - 1];
    if (globId) ctx.onVisit?.(globId, fromKey);
    const key = keys.length === 1 ? keys[0]! : keys[Math.floor(ctx.rng() * keys.length)]!;
    ctx.onVisit?.(key, globId ?? fromKey);
    if (path.includes(key)) {
      ctx.addIssue({
        severity: 'warning',
        code: 'cycle',
        message: `Recursion stopped while simulating: __${seg.name}__`,
      });
      continue;
    }
    const lines = candidateLines(key, ctx);
    if (!lines) continue;
    if (lines.length === 0) {
      ctx.addIssue({
        severity: 'warning',
        code: 'unsupported_structured_value',
        message: `Structured wildcard has no scalar/list values: __${seg.name}__`,
      });
      continue;
    }
    const line = lines[Math.floor(ctx.rng() * lines.length)]!;
    walkRandom(line, ctx, [...path, key], depth + 1);
  }
}

export type SimulateInput = {
  rootRelativePath: string;
  files: LibraryFile[];
  iterations: number;
  seed?: number;
  maxDepth?: number;
};

export type NodeSimStat = {
  key: string;
  /** Iterations in which this node was selected at least once. */
  hits: number;
  /** Total selections across all iterations (can exceed iterations). */
  visits: number;
  /** hits / iterations, in [0, 1] — overall reach from the simulation root. */
  reachRate: number;
};

export type SimEdgeStat = {
  parentKey: string;
  childKey: string;
  /** Times this parent→child selection fired. */
  visits: number;
  /**
   * child edge visits / parent visits — share of parent selections.
   * Can exceed 1 when the parent references the child multiple times per expansion.
   */
  parentShare: number;
};

export type SimulateResult = {
  rootKey: string;
  iterations: number;
  seed: number;
  stats: NodeSimStat[];
  edges: SimEdgeStat[];
  issues: Issue[];
};

export function simulateReach(input: SimulateInput): SimulateResult {
  const index = buildLibraryIndex(input.files);
  const rootKey = toKey(input.rootRelativePath);
  const rootFile =
    index.byKey.get(rootKey) ?? index.byKeyLower.get(rootKey.toLowerCase());
  const maxDepth = input.maxDepth ?? 25;
  const iterations = Math.max(1, Math.min(Math.floor(input.iterations), 1_000_000));
  const seed = (input.seed ?? Math.floor(Math.random() * 1_000_000_000)) >>> 0;
  const rng = mulberry32(seed);

  const issueMap = new Map<string, Issue>();
  const addIssue = (issue: Issue) => {
    const key = `${issue.code}:${issue.message}`;
    if (!issueMap.has(key)) issueMap.set(key, issue);
  };

  const hits = new Map<string, number>();
  const visits = new Map<string, number>();
  const edgeVisits = new Map<string, number>();
  const edgeKey = (parent: string, child: string) => `${parent}\0${child}`;

  const empty = (extra?: Partial<SimulateResult>): SimulateResult => ({
    rootKey,
    iterations,
    seed,
    stats: [],
    edges: [],
    issues: [...issueMap.values()],
    ...extra,
  });

  if (!rootFile) {
    addIssue({
      severity: 'error',
      code: 'missing_file',
      message: `Root file not found: ${input.rootRelativePath}`,
    });
    return empty();
  }
  let current = new Set<string>();
  const ctx: ExpandCtx = {
    index,
    maxDepth,
    rng,
    addIssue,
    onVisit: (key, fromKey) => {
      visits.set(key, (visits.get(key) ?? 0) + 1);
      current.add(key);
      if (fromKey) {
        const ek = edgeKey(fromKey, key);
        edgeVisits.set(ek, (edgeVisits.get(ek) ?? 0) + 1);
      }
    },
  };

  const rootLines = isStructured(rootFile.ext)
    ? (index.structuredDocuments
        .get(rootFile.key)
        ?.entries.flatMap((entry) =>
          entry.values.map((value) => value.text),
        ) ?? [])
    : activeLines(rootFile.text);
  for (const issue of index.structuredDocuments.get(rootFile.key)?.issues ?? []) {
    addIssue(issue);
  }
  for (let n = 0; n < iterations; n++) {
    current = new Set<string>();
    // Root is always selected for every run.
    visits.set(rootKey, (visits.get(rootKey) ?? 0) + 1);
    current.add(rootKey);
    if (rootLines.length > 0) {
      const line = rootLines[Math.floor(rng() * rootLines.length)]!;
      walkRandom(line, ctx, [rootKey], 1);
    }
    for (const key of current) hits.set(key, (hits.get(key) ?? 0) + 1);
  }

  const stats: NodeSimStat[] = [...hits.keys()].map((key) => ({
    key,
    hits: hits.get(key) ?? 0,
    visits: visits.get(key) ?? 0,
    reachRate: (hits.get(key) ?? 0) / iterations,
  }));
  stats.sort((a, b) => a.reachRate - b.reachRate || a.key.localeCompare(b.key));

  const edges: SimEdgeStat[] = [];
  for (const [ek, count] of edgeVisits) {
    const sep = ek.indexOf('\0');
    const parentKey = ek.slice(0, sep);
    const childKey = ek.slice(sep + 1);
    const parentVisits = visits.get(parentKey) ?? 0;
    edges.push({
      parentKey,
      childKey,
      visits: count,
      parentShare: parentVisits > 0 ? count / parentVisits : 0,
    });
  }
  edges.sort(
    (a, b) =>
      a.parentKey.localeCompare(b.parentKey) ||
      a.childKey.localeCompare(b.childKey),
  );

  return {
    rootKey,
    iterations,
    seed,
    stats,
    edges,
    issues: [...issueMap.values()],
  };
}

export type SimulatedLinesMeta = {
  rootKey: string;
  iterations: number;
  seed: number;
  found: boolean;
  lineCount: number;
};

/**
 * One fully expanded prompt per simulation run, using the same seed and
 * random choices as `simulateReach`.
 */
export function forEachSimulatedPromptLine(
  input: SimulateInput,
  onLine: (line: string, index: number) => void,
): SimulatedLinesMeta {
  const index = buildLibraryIndex(input.files);
  const rootKey = toKey(input.rootRelativePath);
  const rootFile =
    index.byKey.get(rootKey) ?? index.byKeyLower.get(rootKey.toLowerCase());
  const maxDepth = input.maxDepth ?? 25;
  const iterations = Math.max(1, Math.min(Math.floor(input.iterations), 1_000_000));
  const seed = (input.seed ?? Math.floor(Math.random() * 1_000_000_000)) >>> 0;

  if (!rootFile) {
    return { rootKey, iterations, seed, found: false, lineCount: 0 };
  }

  const rng = mulberry32(seed);
  const addIssue = () => {
    // Export only needs the prompt text. Issues stay on the frequency run.
  };
  const ctx: ExpandCtx = { index, maxDepth, rng, addIssue };
  const rootLines = isStructured(rootFile.ext)
    ? (index.structuredDocuments
        .get(rootFile.key)
        ?.entries.flatMap((entry) =>
          entry.values.map((value) => value.text),
        ) ?? [])
    : activeLines(rootFile.text);

  for (let n = 0; n < iterations; n++) {
    if (rootLines.length === 0) {
      onLine('', n);
      continue;
    }
    const line = rootLines[Math.floor(rng() * rootLines.length)]!;
    onLine(cleanup(expandRandom(line, ctx, [rootKey], 1)), n);
  }
  return { rootKey, iterations, seed, found: true, lineCount: iterations };
}

/** Prompts separated by a blank line so each run is easy to read. */
export function formatSimulatedLines(lines: string[]): string {
  if (lines.length === 0) return '';
  return `${lines.join('\n\n')}\n`;
}
