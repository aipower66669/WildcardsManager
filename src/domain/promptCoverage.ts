/**
 * Prompt-library coverage: N simulated generations (random folder, then a
 * random decoded line), each followed by one wildcard Monte Carlo walk.
 * Never-used / hot buckets are scored against the wildcard file universe.
 */

import { createVisitWalker } from './expand.js';
import { createMulberry32, stripTestingGenTag } from './genPrompts.js';
import { extractRefsFromText } from './parseRefs.js';
import { buildLibraryIndex, resolveWildcard } from './resolveWildcard.js';
import type { Issue, LibraryFile } from './types.js';

export type PromptCoverageGenFile = {
  relativeFolder: string;
  lines: string[];
};

export type PromptCoverageBucket = 'never' | 'rare' | 'normal' | 'hot';

export type PromptCoverageWildcardStat = {
  key: string;
  hits: number;
  visits: number;
  reachRate: number;
  bucket: PromptCoverageBucket;
  directGenRefs: number;
  byFolder: Record<string, number>;
};

export type PromptCoverageEdgeStat = {
  parentKey: string;
  childKey: string;
  visits: number;
  parentShare: number;
};

export type PromptCoverageFolderStat = {
  relativeFolder: string;
  lineCount: number;
  walksFromFolder: number;
  topKeys: Array<{ key: string; hits: number }>;
};

export type PromptCoverageReport = {
  version: 1;
  libraryId: string;
  generatedAt: string;
  status: 'done' | 'cancelled' | 'error';
  seed: number;
  iterations: number;
  totalWalks: number;
  /** `randomGeneration` picks a folder, then a decoded line. `allGenLines` is a pre-0.8.10 report. */
  selection: PromptCoverageSelection;
  promptsRoot?: string;
  summary: {
    genFolders: number;
    genLines: number;
    libraryFiles: number;
    reachedFiles: number;
    /** Never-bucket keys not on the ignore list (actionable cleanup count). */
    neverReachedFiles: number;
    /** Never-bucket keys hidden via ignore (tools you keep but rarely use). */
    ignoredNeverFiles: number;
    hotFiles: number;
    rareFiles: number;
    issueCount: number;
  };
  wildcards: PromptCoverageWildcardStat[];
  neverReached: string[];
  /**
   * Wildcard keys hidden from Never Used (persists across coverage re-runs).
   * Still appear under Ignored / All.
   */
  ignoredKeys: string[];
  hottest: string[];
  genFolders: PromptCoverageFolderStat[];
  edges: PromptCoverageEdgeStat[];
  issues: Issue[];
};

export type PromptCoverageInput = {
  libraryId: string;
  genFiles: PromptCoverageGenFile[];
  libraryFiles: LibraryFile[];
  iterations: number;
  seed?: number;
  promptsRoot?: string;
  maxDepth?: number;
};

export type PromptCoverageRun = {
  readonly total: number;
  readonly seed: number;
  readonly iterations: number;
  readonly done: number;
  readonly currentFolder: string;
  readonly finished: boolean;
  readonly cancelled: boolean;
  /** Run up to `chunkSize` walks. Returns false when finished or cancelled. */
  runChunk: (chunkSize: number, shouldCancel?: () => boolean) => boolean;
  buildReport: (status: PromptCoverageReport['status']) => PromptCoverageReport;
};

const COVERAGE_ROOT = '__wcm_coverage__';

export type PromptCoverageSelection = 'allGenLines' | 'randomGeneration';

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor(p * sortedAsc.length)),
  );
  return sortedAsc[idx]!;
}

/** Count how often each library file key is named from decoded gen lines. */
export function collectDirectGenRefs(
  genFiles: PromptCoverageGenFile[],
  libraryFiles: LibraryFile[],
): Map<string, number> {
  const index = buildLibraryIndex(libraryFiles);
  const libraryKeySet = new Set(libraryFiles.map((f) => f.key));
  const counts = new Map<string, number>();
  const bump = (key: string) => {
    if (!libraryKeySet.has(key)) return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const file of genFiles) {
    for (const line of file.lines) {
      for (const ref of extractRefsFromText(line)) {
        const resolved = resolveWildcard(ref.name, index);
        if (resolved.kind === 'missing') continue;
        if (resolved.kind === 'glob' && resolved.matchedKeys) {
          for (const key of resolved.matchedKeys) bump(key);
          continue;
        }
        bump(resolved.hostKey ?? resolved.relativeKey ?? resolved.id);
      }
    }
  }
  return counts;
}

/**
 * Create a chunkable coverage run.
 * Each walk picks a folder uniformly, then a decoded line in that folder
 * (weight copies stay, so a heavier line is more likely inside its folder),
 * then one wildcard walk. `iterations` is the walk count.
 */
export function createPromptCoverageRun(
  input: PromptCoverageInput,
): PromptCoverageRun {
  const iterations = Math.max(
    1,
    Math.min(Math.floor(input.iterations), 1_000_000),
  );
  const seed =
    (input.seed ?? Math.floor(Math.random() * 1_000_000_000)) >>> 0;
  const genFiles = input.genFiles
    .map((f) => ({
      relativeFolder: f.relativeFolder,
      // Strip debug `[TESTING]` markers so coverage expands the real prompt.
      lines: f.lines
        .map((line) => stripTestingGenTag(line).trim())
        .filter((line) => line.length > 0),
    }))
    .filter((f) => f.lines.length > 0);

  genFiles.sort((a, b) => a.relativeFolder.localeCompare(b.relativeFolder));
  const lineCount = genFiles.reduce((n, file) => n + file.lines.length, 0);

  const totalWalks = lineCount === 0 ? 0 : iterations;
  const libraryKeys = input.libraryFiles.map((f) => f.key);
  const libraryKeySet = new Set(libraryKeys);

  const hits = new Map<string, number>();
  const visits = new Map<string, number>();
  const edgeVisits = new Map<string, number>();
  const byFolderHits = new Map<string, Map<string, number>>();
  const folderWalkHits = new Map<string, Map<string, number>>();

  const edgeKey = (parent: string, child: string) => `${parent}\0${child}`;
  const directRefs = collectDirectGenRefs(genFiles, input.libraryFiles);
  const pickRng = createMulberry32(seed);
  const folderWalkCounts = new Map<string, number>();

  const walker = createVisitWalker(
    input.libraryFiles,
    seed,
    input.maxDepth ?? 25,
  );

  let walkIndex = 0;
  let finished = totalWalks === 0;
  let cancelled = false;
  let currentFolder = genFiles[0]?.relativeFolder ?? '';

  return {
    total: totalWalks,
    seed,
    iterations,
    get done() {
      return walkIndex;
    },
    get currentFolder() {
      return currentFolder;
    },
    get finished() {
      return finished;
    },
    get cancelled() {
      return cancelled;
    },
    runChunk(chunkSize: number, shouldCancel?: () => boolean) {
      if (finished || cancelled) return false;
      const n = Math.max(1, Math.floor(chunkSize));
      let stepped = 0;
      while (stepped < n && walkIndex < totalWalks) {
        if (shouldCancel?.()) {
          cancelled = true;
          finished = true;
          return false;
        }
        const folder =
          genFiles[Math.floor(pickRng() * genFiles.length)]!;
        const line =
          folder.lines[Math.floor(pickRng() * folder.lines.length)]!;
        currentFolder = folder.relativeFolder;
        folderWalkCounts.set(
          folder.relativeFolder,
          (folderWalkCounts.get(folder.relativeFolder) ?? 0) + 1,
        );
        const touched = new Set<string>();
        walker.setOnVisit((key, fromKey) => {
          visits.set(key, (visits.get(key) ?? 0) + 1);
          if (libraryKeySet.has(key)) touched.add(key);
          if (fromKey) {
            const ek = edgeKey(fromKey, key);
            edgeVisits.set(ek, (edgeVisits.get(ek) ?? 0) + 1);
          }
        });
        walker.walkLine(line, COVERAGE_ROOT);
        for (const key of touched) {
          hits.set(key, (hits.get(key) ?? 0) + 1);
          let folderMap = byFolderHits.get(key);
          if (!folderMap) {
            folderMap = new Map();
            byFolderHits.set(key, folderMap);
          }
          folderMap.set(
            folder.relativeFolder,
            (folderMap.get(folder.relativeFolder) ?? 0) + 1,
          );
          let walkMap = folderWalkHits.get(folder.relativeFolder);
          if (!walkMap) {
            walkMap = new Map();
            folderWalkHits.set(folder.relativeFolder, walkMap);
          }
          walkMap.set(key, (walkMap.get(key) ?? 0) + 1);
        }
        walkIndex += 1;
        stepped += 1;
      }
      if (walkIndex >= totalWalks) {
        finished = true;
        return false;
      }
      return true;
    },
    buildReport(status) {
      const total = Math.max(1, totalWalks);
      const positiveRates: number[] = [];
      const positiveVisits: number[] = [];
      for (const key of libraryKeys) {
        const h = hits.get(key) ?? 0;
        if (h > 0) {
          positiveRates.push(h / total);
          positiveVisits.push(visits.get(key) ?? 0);
        }
      }
      positiveRates.sort((a, b) => a - b);
      positiveVisits.sort((a, b) => a - b);
      const p25 = percentile(positiveRates, 0.25);
      const p90 = percentile(positiveRates, 0.9);
      const visitHotCut =
        positiveVisits.length === 0
          ? Number.POSITIVE_INFINITY
          : percentile(positiveVisits, 0.9);

      const wildcards: PromptCoverageWildcardStat[] = libraryKeys.map((key) => {
        const h = hits.get(key) ?? 0;
        const v = visits.get(key) ?? 0;
        const reachRate = h / total;
        let bucket: PromptCoverageBucket;
        if (h === 0) bucket = 'never';
        else if (reachRate >= p90 || v >= visitHotCut) bucket = 'hot';
        else if (reachRate < p25) bucket = 'rare';
        else bucket = 'normal';
        const folderMap = byFolderHits.get(key);
        const byFolder: Record<string, number> = {};
        if (folderMap) {
          for (const [folder, count] of folderMap) {
            byFolder[folder] = count;
          }
        }
        return {
          key,
          hits: h,
          visits: v,
          reachRate,
          bucket,
          directGenRefs: directRefs.get(key) ?? 0,
          byFolder,
        };
      });

      wildcards.sort(
        (a, b) =>
          a.reachRate - b.reachRate ||
          a.visits - b.visits ||
          a.key.localeCompare(b.key),
      );

      const neverReached = wildcards
        .filter((w) => w.bucket === 'never')
        .map((w) => w.key);
      const hottest = [...wildcards]
        .filter((w) => w.hits > 0)
        .sort(
          (a, b) =>
            b.reachRate - a.reachRate ||
            b.visits - a.visits ||
            a.key.localeCompare(b.key),
        )
        .slice(0, 50)
        .map((w) => w.key);

      const edges: PromptCoverageEdgeStat[] = [];
      for (const [ek, count] of edgeVisits) {
        const sep = ek.indexOf('\0');
        const parentKey = ek.slice(0, sep);
        const childKey = ek.slice(sep + 1);
        if (parentKey === COVERAGE_ROOT) continue;
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

      const folderStats: PromptCoverageFolderStat[] = genFiles.map((file) => {
        const walkMap = folderWalkHits.get(file.relativeFolder);
        const topKeys = walkMap
          ? [...walkMap.entries()]
              .map(([key, h]) => ({ key, hits: h }))
              .sort(
                (a, b) => b.hits - a.hits || a.key.localeCompare(b.key),
              )
              .slice(0, 20)
          : [];
        return {
          relativeFolder: file.relativeFolder,
          lineCount: file.lines.length,
          walksFromFolder: folderWalkCounts.get(file.relativeFolder) ?? 0,
          topKeys,
        };
      });
      folderStats.sort((a, b) =>
        a.relativeFolder.localeCompare(b.relativeFolder),
      );

      const issues = walker.takeIssues();
      const hotFiles = wildcards.filter((w) => w.bucket === 'hot').length;
      const rareFiles = wildcards.filter((w) => w.bucket === 'rare').length;
      const reachedFiles = wildcards.filter((w) => w.hits > 0).length;

      return {
        version: 1,
        libraryId: input.libraryId,
        generatedAt: new Date().toISOString(),
        status,
        seed,
        iterations,
        totalWalks,
        selection: 'randomGeneration',
        ...(input.promptsRoot ? { promptsRoot: input.promptsRoot } : {}),
        summary: {
          genFolders: genFiles.length,
          genLines: lineCount,
          libraryFiles: libraryKeys.length,
          reachedFiles,
          neverReachedFiles: neverReached.length,
          ignoredNeverFiles: 0,
          hotFiles,
          rareFiles,
          issueCount: issues.length,
        },
        wildcards,
        neverReached,
        ignoredKeys: [],
        hottest,
        genFolders: folderStats,
        edges,
        issues,
      };
    },
  };
}

/** Run the full coverage simulation synchronously (tests / small fixtures). */
export function runPromptCoverageSync(
  input: PromptCoverageInput,
): PromptCoverageReport {
  const run = createPromptCoverageRun(input);
  if (run.total === 0) {
    return run.buildReport('done');
  }
  while (run.runChunk(500)) {
    // drain
  }
  return run.buildReport(run.cancelled ? 'cancelled' : 'done');
}

export type PromptCoveragePruneResult = {
  report: PromptCoverageReport;
  removedMissing: number;
  clearedNeverByGenRef: number;
  changed: boolean;
};

function recomputeSummary(
  report: PromptCoverageReport,
  wildcards: PromptCoverageWildcardStat[],
  ignoredKeys: readonly string[] = report.ignoredKeys ?? [],
): PromptCoverageReport['summary'] {
  const ignored = new Set(ignoredKeys);
  const neverAll = wildcards.filter((w) => w.bucket === 'never');
  return {
    ...report.summary,
    libraryFiles: wildcards.length,
    reachedFiles: wildcards.filter((w) => w.hits > 0).length,
    neverReachedFiles: neverAll.filter((w) => !ignored.has(w.key)).length,
    ignoredNeverFiles: neverAll.filter((w) => ignored.has(w.key)).length,
    hotFiles: wildcards.filter((w) => w.bucket === 'hot').length,
    rareFiles: wildcards.filter((w) => w.bucket === 'rare').length,
  };
}

/** Keep ignore list limited to keys that still exist; refresh Never counts. */
export function applyPromptCoverageIgnoredKeys(
  report: PromptCoverageReport,
  ignoredKeys: readonly string[],
): PromptCoverageReport {
  const alive = new Set(report.wildcards.map((w) => w.key));
  const nextIgnored = [
    ...new Set(
      ignoredKeys
        .map((k) => k.trim().replaceAll('\\', '/'))
        .filter((k) => k && alive.has(k)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  return {
    ...report,
    ignoredKeys: nextIgnored,
    summary: recomputeSummary(report, report.wildcards, nextIgnored),
  };
}

/**
 * Drop wildcards that no longer exist in the library. Does not re-scan gens.
 */
export function pruneMissingPromptCoverageWildcards(
  report: PromptCoverageReport,
  libraryKeys: Iterable<string>,
): PromptCoveragePruneResult {
  const keySet = new Set(libraryKeys);
  const before = report.wildcards.length;
  const wildcards = report.wildcards.filter((w) => keySet.has(w.key));
  const removedMissing = before - wildcards.length;
  if (removedMissing === 0) {
    return { report, removedMissing: 0, clearedNeverByGenRef: 0, changed: false };
  }
  const alive = new Set(wildcards.map((w) => w.key));
  const neverReached = wildcards
    .filter((w) => w.bucket === 'never')
    .map((w) => w.key);
  const hottest = report.hottest.filter((k) => alive.has(k));
  const edges = report.edges.filter(
    (e) => alive.has(e.parentKey) && alive.has(e.childKey),
  );
  const genFolders = report.genFolders.map((folder) => ({
    ...folder,
    topKeys: folder.topKeys.filter((t) => alive.has(t.key)),
  }));
  const next = applyPromptCoverageIgnoredKeys(
    {
      ...report,
      wildcards,
      neverReached,
      hottest,
      edges,
      genFolders,
      summary: recomputeSummary(report, wildcards, report.ignoredKeys ?? []),
    },
    report.ignoredKeys ?? [],
  );
  return {
    report: next,
    removedMissing,
    clearedNeverByGenRef: 0,
    changed: true,
  };
}

/**
 * Re-scan !gen.txt direct refs: keys that are now named leave the Never bucket
 * (without re-running Monte Carlo). Also drops missing library files.
 */
export function refreshPromptCoverageNeverUsed(
  report: PromptCoverageReport,
  libraryFiles: LibraryFile[],
  genFiles: PromptCoverageGenFile[],
): PromptCoveragePruneResult {
  const libraryKeys = libraryFiles.map((f) => f.key);
  const pruned = pruneMissingPromptCoverageWildcards(report, libraryKeys);
  let working = pruned.report;
  const directRefs = collectDirectGenRefs(genFiles, libraryFiles);
  let clearedNeverByGenRef = 0;
  const wildcards = working.wildcards.map((w) => {
    const directGenRefs = directRefs.get(w.key) ?? 0;
    if (w.bucket === 'never' && directGenRefs > 0) {
      clearedNeverByGenRef += 1;
      return { ...w, directGenRefs, bucket: 'normal' as const };
    }
    if (w.directGenRefs !== directGenRefs) {
      return { ...w, directGenRefs };
    }
    return w;
  });
  const changed =
    pruned.changed ||
    clearedNeverByGenRef > 0 ||
    wildcards.some((w, i) => w.directGenRefs !== working.wildcards[i]?.directGenRefs);
  if (!changed) {
    return {
      report: working,
      removedMissing: pruned.removedMissing,
      clearedNeverByGenRef: 0,
      changed: false,
    };
  }
  const neverReached = wildcards
    .filter((w) => w.bucket === 'never')
    .map((w) => w.key);
  working = applyPromptCoverageIgnoredKeys(
    {
      ...working,
      wildcards,
      neverReached,
      summary: recomputeSummary(working, wildcards, working.ignoredKeys ?? []),
    },
    working.ignoredKeys ?? [],
  );
  return {
    report: working,
    removedMissing: pruned.removedMissing,
    clearedNeverByGenRef,
    changed: true,
  };
}
