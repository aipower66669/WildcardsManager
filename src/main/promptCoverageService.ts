import fs from 'node:fs';
import { BrowserWindow, shell } from 'electron';
import { decodeGenPrompts } from '../domain/genPrompts.js';
import { promptCoverageJsonPath } from '../domain/librarySidecarPaths.js';
import {
  applyPromptCoverageIgnoredKeys,
  pruneMissingPromptCoverageWildcards,
  refreshPromptCoverageNeverUsed,
  type PromptCoverageReport,
} from '../domain/promptCoverage.js';
import type {
  IssueDto,
  PromptCoverageIgnorePatchDto,
  PromptCoverageProgressDto,
  PromptCoverageRefreshResultDto,
  PromptCoverageReportDto,
  PromptCoverageStartRequestDto,
  PromptCoverageStartResultDto,
} from '../shared/contracts.js';
import { IPC } from '../shared/contracts.js';
import { atomicWriteFile } from './librarySidecarIo.js';
import { libraryService } from './libraryService.js';
import { listGenFiles } from './promptsService.js';
import {
  cancelPromptCoverageInWorker,
  disposePromptCoverageWorker,
  startPromptCoverageInWorker,
} from './promptCoverageWorkerClient.js';
import {
  getActiveLibrary,
  getActiveLibraryId,
  loadSettings,
} from './settingsStore.js';

const CACHE_VERSION = 1 as const;

type CacheFile = {
  version: typeof CACHE_VERSION;
  libraryId: string;
  report: PromptCoverageReportDto;
};

let generation = 0;
let activeGeneration = 0;
let memoryReport: PromptCoverageReportDto | null = null;
let lastProgress: PromptCoverageProgressDto | null = null;
let runStartedAt = 0;

/** Rolling window of recent raw ETA estimates (seconds) for a smoother UI. */
const ETA_SMOOTH_WINDOW = 32;
let etaSamples: number[] = [];

function resetEtaSmoothing(): void {
  etaSamples = [];
}

/**
 * Push a raw ETA sample and return the rounded mean of the last N values.
 * Early samples still average (smaller window) so the first ticks are usable.
 */
function smoothEtaSeconds(rawSeconds: number | null): number | null {
  if (rawSeconds == null || !Number.isFinite(rawSeconds) || rawSeconds < 0) {
    return null;
  }
  etaSamples.push(rawSeconds);
  if (etaSamples.length > ETA_SMOOTH_WINDOW) {
    etaSamples.splice(0, etaSamples.length - ETA_SMOOTH_WINDOW);
  }
  let sum = 0;
  for (const sample of etaSamples) sum += sample;
  return Math.max(0, Math.round(sum / etaSamples.length));
}

function cachePathForActiveLibrary(): string | null {
  const root = getActiveLibrary().wildcardsRoot;
  if (!root?.trim()) return null;
  return promptCoverageJsonPath(root);
}

function toIssueDto(issue: PromptCoverageReport['issues'][number]): IssueDto {
  return {
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    nodeId: issue.nodeId,
    line: issue.line,
    column: issue.column,
    snippet: issue.snippet,
    relatedPaths: issue.relatedPaths,
    fixAction: issue.fixAction,
  };
}

function readIgnoredKeys(report: {
  ignoredKeys?: string[] | null;
}): string[] {
  return Array.isArray(report.ignoredKeys) ? [...report.ignoredKeys] : [];
}

function previousIgnoredKeys(): string[] {
  if (memoryReport?.libraryId === getActiveLibraryId()) {
    return readIgnoredKeys(memoryReport);
  }
  const cached = loadCachedReport();
  return cached ? readIgnoredKeys(cached) : [];
}

function toReportDto(
  report: PromptCoverageReport,
  ignoredKeys: readonly string[] = [],
): PromptCoverageReportDto {
  const withIgnore = applyPromptCoverageIgnoredKeys(report, ignoredKeys);
  return {
    version: 1,
    libraryId: withIgnore.libraryId,
    generatedAt: withIgnore.generatedAt,
    status: withIgnore.status,
    seed: withIgnore.seed,
    iterations: withIgnore.iterations,
    totalWalks: withIgnore.totalWalks,
    selection: withIgnore.selection,
    promptsRoot: withIgnore.promptsRoot,
    summary: {
      ...withIgnore.summary,
      ignoredNeverFiles: withIgnore.summary.ignoredNeverFiles ?? 0,
    },
    wildcards: withIgnore.wildcards,
    neverReached: withIgnore.neverReached,
    ignoredKeys: withIgnore.ignoredKeys ?? [],
    hottest: withIgnore.hottest,
    genFolders: withIgnore.genFolders,
    edges: withIgnore.edges,
    issues: withIgnore.issues.map(toIssueDto),
  };
}

function emitProgress(progress: PromptCoverageProgressDto): void {
  lastProgress = progress;
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(IPC.promptsCoverageProgress, progress);
    } catch {
      // ignore
    }
  }
}

function persistReport(report: PromptCoverageReportDto): void {
  memoryReport = report;
  const filePath = cachePathForActiveLibrary();
  if (!filePath) return;
  const payload: CacheFile = {
    version: CACHE_VERSION,
    libraryId: report.libraryId,
    report,
  };
  atomicWriteFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function loadCachedReport(): PromptCoverageReportDto | null {
  const filePath = cachePathForActiveLibrary();
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CacheFile;
    if (raw.version !== CACHE_VERSION) return null;
    if (raw.libraryId !== getActiveLibraryId()) return null;
    if (!raw.report || typeof raw.report !== 'object') return null;
    // Only completed runs are authoritative on disk.
    if (raw.report.status && raw.report.status !== 'done') return null;
    // Older reports lack ignore fields — normalize counts.
    return domainReportAsDto(
      dtoAsDomainReport({
        ...raw.report,
        ignoredKeys: readIgnoredKeys(raw.report),
        summary: {
          ...raw.report.summary,
          ignoredNeverFiles: raw.report.summary?.ignoredNeverFiles ?? 0,
        },
      }),
      raw.report.issues ?? [],
      readIgnoredKeys(raw.report),
    );
  } catch {
    return null;
  }
}

function dtoAsDomainReport(
  dto: PromptCoverageReportDto,
): PromptCoverageReport {
  return dto as unknown as PromptCoverageReport;
}

function domainReportAsDto(
  report: PromptCoverageReport,
  issues: IssueDto[],
  ignoredKeys?: readonly string[],
): PromptCoverageReportDto {
  const withIgnore = applyPromptCoverageIgnoredKeys(
    report,
    ignoredKeys ?? report.ignoredKeys ?? [],
  );
  return {
    version: 1,
    libraryId: withIgnore.libraryId,
    generatedAt: withIgnore.generatedAt,
    status: withIgnore.status,
    seed: withIgnore.seed,
    iterations: withIgnore.iterations,
    totalWalks: withIgnore.totalWalks,
    selection: withIgnore.selection,
    promptsRoot: withIgnore.promptsRoot,
    summary: {
      ...withIgnore.summary,
      ignoredNeverFiles: withIgnore.summary.ignoredNeverFiles ?? 0,
    },
    wildcards: withIgnore.wildcards,
    neverReached: withIgnore.neverReached,
    ignoredKeys: withIgnore.ignoredKeys ?? [],
    hottest: withIgnore.hottest,
    genFolders: withIgnore.genFolders,
    edges: withIgnore.edges,
    issues,
  };
}

/** Drop deleted wildcard keys from a saved report; persist when changed. */
function pruneMissingFromReport(
  report: PromptCoverageReportDto,
): PromptCoverageReportDto {
  // Startup may ask for the report before a wildcards root is open — skip prune.
  if (!libraryService.getRoot()) return report;
  const keys = libraryService.loadAllFiles().map((f) => f.key);
  const result = pruneMissingPromptCoverageWildcards(
    dtoAsDomainReport(report),
    keys,
  );
  if (!result.changed) return report;
  const next = domainReportAsDto(
    result.report,
    report.issues,
    readIgnoredKeys(report),
  );
  if (next.status === 'done') persistReport(next);
  else memoryReport = next;
  return next;
}

export function getPromptCoverageReport(): PromptCoverageReportDto | null {
  const libraryId = getActiveLibraryId();
  // Prefer a completed in-memory/disk report — never let a cancelled re-run
  // hide the last finished coverage.
  let report: PromptCoverageReportDto | null = null;
  if (
    memoryReport &&
    memoryReport.libraryId === libraryId &&
    memoryReport.status === 'done'
  ) {
    report = memoryReport;
  } else {
    const cached = loadCachedReport();
    if (cached) {
      memoryReport = cached;
      report = cached;
    } else if (memoryReport && memoryReport.libraryId === libraryId) {
      report = memoryReport;
    }
  }
  if (!report) return null;
  return pruneMissingFromReport(report);
}

/**
 * Re-scan !gen.txt for direct refs and drop missing files from Never Used.
 * Does not re-run Monte Carlo coverage.
 */
export function refreshPromptCoverageNeverUsedReport(): PromptCoverageRefreshResultDto {
  const current = getPromptCoverageReport();
  if (!current) {
    throw new Error('No coverage report to refresh — run Coverage first');
  }
  const libraryFiles = libraryService.loadAllFiles({ refresh: true });
  const genFiles = listGenFiles().map((file) => ({
    relativeFolder: file.relativeFolder,
    lines: decodeGenPrompts(file.content),
  }));
  // getPromptCoverageReport already pruned missing; refresh gens from disk.
  const result = refreshPromptCoverageNeverUsed(
    dtoAsDomainReport(current),
    libraryFiles,
    genFiles,
  );
  const next = domainReportAsDto(
    result.report,
    current.issues,
    readIgnoredKeys(current),
  );
  if (result.changed && next.status === 'done') {
    persistReport(next);
  } else if (result.changed) {
    memoryReport = next;
  }
  return {
    report: next,
    removedMissing: result.removedMissing,
    clearedNeverByGenRef: result.clearedNeverByGenRef,
    changed: result.changed,
  };
}

/** Add/remove keys on the Never Used ignore list (persisted with the report). */
export function patchPromptCoverageIgnore(
  patch: PromptCoverageIgnorePatchDto,
): PromptCoverageReportDto {
  const current = getPromptCoverageReport();
  if (!current) {
    throw new Error('No coverage report — run Coverage first');
  }
  const set = new Set(readIgnoredKeys(current));
  for (const key of patch.add ?? []) {
    const cleaned = key.trim().replaceAll('\\', '/');
    if (cleaned) set.add(cleaned);
  }
  for (const key of patch.remove ?? []) {
    set.delete(key.trim().replaceAll('\\', '/'));
  }
  const next = domainReportAsDto(
    dtoAsDomainReport(current),
    current.issues,
    [...set],
  );
  if (next.status === 'done') persistReport(next);
  else memoryReport = next;
  return next;
}

export function getPromptCoverageProgress(): PromptCoverageProgressDto | null {
  return lastProgress;
}

export function getPromptCoverageReportPath(): string | null {
  return cachePathForActiveLibrary();
}

export async function revealPromptCoverageReport(): Promise<void> {
  const filePath = cachePathForActiveLibrary();
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('No coverage report file on disk yet');
  }
  shell.showItemInFolder(filePath);
}

export function cancelPromptCoverage(): void {
  cancelPromptCoverageInWorker();
}

export function startPromptCoverage(
  request: PromptCoverageStartRequestDto = {},
): PromptCoverageStartResultDto {
  if (activeGeneration !== 0) {
    throw new Error('A coverage simulation is already running');
  }

  const libraryId = getActiveLibraryId();
  const wildcardsRoot = getActiveLibrary().wildcardsRoot?.trim();
  if (!wildcardsRoot) {
    throw new Error('No wildcards folder open in the active library');
  }
  const promptsRoot = loadSettings().promptsFolder?.trim();
  if (!promptsRoot) {
    throw new Error('No prompts folder configured for this library');
  }

  const genRaw = listGenFiles();
  const genFiles = genRaw.map((file) => ({
    relativeFolder: file.relativeFolder,
    lines: decodeGenPrompts(file.content),
  }));
  const lineCount = genFiles.reduce((n, f) => n + f.lines.length, 0);
  if (lineCount === 0) {
    throw new Error('No decoded prompt lines found in any !gen.txt');
  }

  const libraryFiles = libraryService.loadAllFiles({ refresh: true });
  if (libraryFiles.length === 0) {
    throw new Error('Wildcards library is empty');
  }

  const settings = loadSettings();
  const configured =
    typeof settings.simulationIterations === 'number' &&
    Number.isFinite(settings.simulationIterations)
      ? settings.simulationIterations
      : 10_000;
  const iterations = Math.max(
    1,
    Math.min(1_000_000, Math.floor(request.iterations ?? configured)),
  );
  const seed =
    request.seed !== undefined
      ? Math.floor(request.seed) >>> 0
      : (settings.simulationSeed ?? 1) >>> 0;

  const gen = ++generation;
  activeGeneration = gen;
  runStartedAt = Date.now();
  resetEtaSmoothing();
  const total = iterations;

  emitProgress({
    status: 'running',
    libraryId,
    done: 0,
    total,
    percent: 0,
    currentFolder: genFiles[0]?.relativeFolder ?? '',
    walksPerSec: 0,
    etaSeconds: null,
  });

  startPromptCoverageInWorker(
    {
      libraryId,
      genFiles,
      libraryFiles,
      iterations,
      seed,
      promptsRoot,
    },
    {
      onProgress: (info) => {
        if (activeGeneration !== gen) return;
        const elapsed = Math.max(0.001, (Date.now() - runStartedAt) / 1000);
        const fraction =
          info.total > 0 ? Math.min(1, info.done / info.total) : 0;
        const percent =
          Math.round(fraction * 1000) / 10;
        // Overall average rate from whole run — not a short window (those jump).
        const rate = info.done > 0 ? info.done / elapsed : 0;
        // Raw ETA from unrounded fraction; rolling-average for a steadier UI.
        const rawEtaSeconds =
          info.done > 0 && fraction > 0 && fraction < 1
            ? Math.max(0, (elapsed * (1 - fraction)) / fraction)
            : null;
        emitProgress({
          status: 'running',
          libraryId,
          done: info.done,
          total: info.total,
          percent,
          currentFolder: info.currentFolder,
          walksPerSec: Math.round(rate),
          etaSeconds: smoothEtaSeconds(rawEtaSeconds),
        });
      },
      onDone: (report) => {
        if (activeGeneration !== gen) return;
        // Preserve Never Used ignore list across re-runs.
        const dto = toReportDto(report, previousIgnoredKeys());
        persistReport(dto);
        activeGeneration = 0;
        emitProgress({
          status: 'done',
          libraryId,
          done: dto.totalWalks,
          total: dto.totalWalks,
          percent: 100,
          walksPerSec: 0,
          etaSeconds: 0,
          report: dto,
        });
        disposePromptCoverageWorker();
      },
      onCancelled: (report) => {
        if (activeGeneration !== gen) return;
        const dto = toReportDto(report);
        // Keep the last finished report available; do not persist cancel.
        if (memoryReport?.status !== 'done') {
          memoryReport = dto;
        }
        activeGeneration = 0;
        emitProgress({
          status: 'cancelled',
          libraryId,
          done: lastProgress?.done ?? 0,
          total: lastProgress?.total ?? dto.totalWalks,
          percent: lastProgress?.percent ?? 0,
          walksPerSec: 0,
          etaSeconds: null,
          // Prefer last completed report for the UI after cancel.
          report:
            memoryReport?.status === 'done' ? memoryReport : dto,
        });
        disposePromptCoverageWorker();
      },
      onError: (error) => {
        if (activeGeneration !== gen) return;
        activeGeneration = 0;
        emitProgress({
          status: 'error',
          libraryId,
          done: lastProgress?.done ?? 0,
          total: lastProgress?.total ?? 0,
          percent: lastProgress?.percent ?? 0,
          walksPerSec: 0,
          etaSeconds: null,
          error,
        });
        disposePromptCoverageWorker();
      },
    },
  );

  return { started: true, totalWalks: total, iterations, seed };
}
