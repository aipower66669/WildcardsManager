import fs from 'node:fs';
import { BrowserWindow } from 'electron';
import { validateAllLibraryFiles } from '../domain/libraryValidation.js';
import { validationJsonPath } from '../domain/librarySidecarPaths.js';
import type {
  IssueDto,
  WildcardValidationFileDto,
  WildcardValidationProgressDto,
  WildcardValidationReportDto,
} from '../shared/contracts.js';
import { IPC } from '../shared/contracts.js';
import { libraryService } from './libraryService.js';
import { getConfiguredLoraIndex } from './loraService.js';
import { attachCachedAutoV2Hashes } from './modelHashCache.js';
import { getActiveLibrary, getActiveLibraryId } from './settingsStore.js';
import { atomicWriteFile } from './librarySidecarIo.js';

const CACHE_VERSION = 1 as const;

type CacheFile = {
  version: typeof CACHE_VERSION;
  libraryId: string;
  report: WildcardValidationReportDto;
};

let active: { cancelled: boolean; generation: number } | null = null;
let generation = 0;
let memoryReport: WildcardValidationReportDto | null = null;

function cachePathForActiveLibrary(): string | null {
  const root = getActiveLibrary().wildcardsRoot;
  if (!root?.trim()) return null;
  return validationJsonPath(root);
}

function emitProgress(progress: WildcardValidationProgressDto): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.analyzeValidateAllProgress, progress);
  }
}

function toIssueDto(issue: {
  severity: IssueDto['severity'];
  code: IssueDto['code'];
  message: string;
  nodeId?: string;
  line?: number;
  column?: number;
  snippet?: string;
  relatedPaths?: string[];
}): IssueDto {
  return {
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    nodeId: issue.nodeId,
    line: issue.line,
    column: issue.column,
    snippet: issue.snippet,
    relatedPaths: issue.relatedPaths,
  };
}

function buildReport(
  libraryId: string,
  results: ReturnType<typeof validateAllLibraryFiles>,
  status: WildcardValidationReportDto['status'],
): WildcardValidationReportDto {
  const files: WildcardValidationFileDto[] = [];
  let errorCount = 0;
  let warningCount = 0;
  let filesWithIssues = 0;

  for (const row of results) {
    errorCount += row.errorCount;
    warningCount += row.warningCount;
    if (row.errorCount > 0 || row.warningCount > 0) {
      filesWithIssues += 1;
      files.push({
        relativePath: row.relativePath,
        key: row.key,
        errorCount: row.errorCount,
        warningCount: row.warningCount,
        issues: row.issues.map(toIssueDto),
      });
    }
  }

  files.sort((a, b) => {
    if (b.errorCount !== a.errorCount) return b.errorCount - a.errorCount;
    if (b.warningCount !== a.warningCount) return b.warningCount - a.warningCount;
    return a.relativePath.localeCompare(b.relativePath);
  });

  return {
    libraryId,
    generatedAt: new Date().toISOString(),
    status,
    fileCount: results.length,
    filesWithIssues,
    errorCount,
    warningCount,
    files,
  };
}

function persistReport(report: WildcardValidationReportDto): void {
  memoryReport = report;
  const file = cachePathForActiveLibrary();
  if (!file) return;
  const payload: CacheFile = {
    version: CACHE_VERSION,
    libraryId: report.libraryId,
    report,
  };
  atomicWriteFile(file, `${JSON.stringify(payload)}\n`);
}

function loadPersistedReport(libraryId: string): WildcardValidationReportDto | null {
  try {
    const file = cachePathForActiveLibrary();
    if (!file) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheFile;
    if (raw?.version !== CACHE_VERSION || raw.libraryId !== libraryId) {
      return null;
    }
    return raw.report;
  } catch {
    return null;
  }
}

/** Last report for the active library (memory, then disk). */
export function getWildcardValidationReport(): WildcardValidationReportDto | null {
  const libraryId = getActiveLibraryId();
  if (memoryReport?.libraryId === libraryId) return memoryReport;
  const loaded = loadPersistedReport(libraryId);
  memoryReport = loaded;
  return loaded;
}

export function clearWildcardValidationReport(): void {
  const libraryId = getActiveLibraryId();
  if (memoryReport?.libraryId === libraryId) memoryReport = null;
  try {
    const file = cachePathForActiveLibrary();
    if (file) fs.unlinkSync(file);
  } catch {
    // ignore
  }
}

export function cancelWildcardValidation(): void {
  if (active) active.cancelled = true;
}

export async function startWildcardValidation(): Promise<WildcardValidationReportDto> {
  if (active) {
    throw new Error('Validation is already running');
  }

  const libraryId = getActiveLibraryId();
  const root = libraryService.getRoot();
  if (!root) {
    throw new Error('No wildcards folder open in the active library');
  }

  const gen = ++generation;
  const sync = { cancelled: false, generation: gen };
  active = sync;

  const files = libraryService.loadAllFiles();
  const total = files.length;
  emitProgress({
    status: 'running',
    libraryId,
    done: 0,
    total,
  });

  try {
    const platform = getActiveLibrary().validationPlatform ?? 'comfyui';
    const rawIndex = getConfiguredLoraIndex();
    const loraIndex = rawIndex ? attachCachedAutoV2Hashes(rawIndex) : null;

    // Yield so the UI can paint the progress strip before CPU-heavy work.
    await new Promise<void>((resolve) => setImmediate(resolve));

    const results = validateAllLibraryFiles(files, platform, loraIndex, {
      shouldCancel: () => sync.cancelled || sync.generation !== generation,
      onFile: (done, fileTotal, relativePath) => {
        if (done === 1 || done === fileTotal || done % 25 === 0) {
          emitProgress({
            status: 'running',
            libraryId,
            done,
            total: fileTotal,
            relativePath,
          });
        }
      },
    });

    const cancelled = sync.cancelled || sync.generation !== generation;
    const report = buildReport(
      libraryId,
      results,
      cancelled ? 'cancelled' : 'done',
    );
    if (!cancelled) {
      persistReport(report);
    } else if (results.length > 0) {
      // Keep partial results in memory only (not written as authoritative).
      memoryReport = report;
    }

    emitProgress({
      status: cancelled ? 'cancelled' : 'done',
      libraryId,
      done: results.length,
      total,
      report,
    });
    return report;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    emitProgress({
      status: 'error',
      libraryId,
      done: 0,
      total,
      error: message,
    });
    throw e;
  } finally {
    if (active === sync) active = null;
  }
}
