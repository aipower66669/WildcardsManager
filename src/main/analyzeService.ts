import {
  analyzeCore,
  isLoraFolderIssue,
  type AnalyzeCoreResult,
} from '../domain/analyzeCore.js';
import {
  libraryFilesFingerprint,
} from '../domain/fileArtifactCache.js';
import {
  loraIndexFingerprint,
  validateDuplicateLoraAutoV2,
  validateLoraRefs,
  validateUnusedLoras,
} from '../domain/lora.js';
import { wildcardNamesForPlatform } from '../domain/dynamicWildcardName.js';
import { validatePlatformWildcardSyntax } from '../domain/platformValidation.js';
import {
  type DirectCaller,
  type FileRefStat,
} from '../domain/references.js';
import {
  getCachedAnalysis,
  rememberAnalysis,
} from './analyzeResultCache.js';
import { analyzeCoreInWorker } from './analyzeWorkerClient.js';
import {
  hasNoValidationMarker,
  HONOR_NO_VALIDATION_MARKER,
  parseFileContent,
} from '../domain/parseRefs.js';
import {
  buildLibraryIndex,
  resolveWildcard,
} from '../domain/resolveWildcard.js';
import {
  isStructuredFile,
  parseStructuredFile,
} from '../domain/structured.js';
import type { Issue, LibraryFile } from '../domain/types.js';
import type { AnalysisResultDto, IssueDto } from '../shared/contracts.js';
import { libraryService } from './libraryService.js';
import { getConfiguredLoraIndex } from './loraService.js';
import { attachCachedAutoV2Hashes } from './modelHashCache.js';
import { listAllGenFileContents } from './promptsService.js';
import { getActiveLibrary, loadSettings } from './settingsStore.js';

function activeValidationPlatform() {
  return getActiveLibrary().validationPlatform ?? 'comfyui';
}

type AnalyzeExtrasCache = {
  libraryFp: string;
  loraFp: string;
  libraryWideIssues: Issue[];
  refStats: Map<string, FileRefStat>;
  callersByRoot: Map<string, DirectCaller[]>;
};

let extrasCache: AnalyzeExtrasCache | null = null;

function extrasMatch(libraryFp: string, loraFp: string): boolean {
  return Boolean(
    extrasCache &&
      extrasCache.libraryFp === libraryFp &&
      extrasCache.loraFp === loraFp,
  );
}

export async function analyzeFromFile(
  relativePath: string,
): Promise<AnalysisResultDto> {
  const root = libraryService.requireRoot();
  const files = libraryService.loadAllFiles();
  return analyzeFiles(root, relativePath, files, { persist: true });
}

export async function analyzeFromContent(
  relativePath: string,
  text: string,
): Promise<AnalysisResultDto> {
  const root = libraryService.requireRoot();
  const files = libraryService.loadAllFiles();
  const index = files.findIndex((file) => file.relativePath === relativePath);
  if (index < 0) throw new Error('File not found');

  const previewFiles = files.slice();
  const overlay = previewFiles[index]!;
  previewFiles[index] = {
    ...overlay,
    text,
    size: undefined,
    mtimeMs: undefined,
  };
  return analyzeFiles(root, relativePath, previewFiles, { persist: false });
}

/**
 * Fast single-file validation for the live editor — no full graph rebuild and
 * no unused-LoRA library scan.
 */
export function validateFileContent(
  relativePath: string,
  text: string,
): IssueDto[] {
  const files = libraryService.loadAllFiles();
  const index = files.findIndex((file) => file.relativePath === relativePath);
  if (index < 0) throw new Error('File not found');

  const previewFiles = files.slice();
  const file: LibraryFile = {
    ...previewFiles[index]!,
    text,
    size: undefined,
    mtimeMs: undefined,
  };
  previewFiles[index] = file;

  if (HONOR_NO_VALIDATION_MARKER && hasNoValidationMarker(text)) return [];

  const libraryIndex = buildLibraryIndex(previewFiles);
  const issues: Issue[] = [];
  const nodeId = file.key;
  const platform = activeValidationPlatform();

  const resolveRefIssues = (ref: { name: string; line: number; column: number; raw: string }) => {
    const { names, dynamic } = wildcardNamesForPlatform(ref.name, platform);
    if (dynamic && platform === 'comfyui') return;
    for (const resolvedName of names) {
      const resolved = resolveWildcard(resolvedName, libraryIndex);
      for (const issue of resolved.issues) {
        issues.push({
          ...issue,
          nodeId: issue.nodeId ?? resolved.id,
          line: issue.line ?? ref.line,
          column: issue.column ?? ref.column,
          snippet: issue.snippet ?? ref.raw,
        });
      }
    }
  };

  if (isStructuredFile(file)) {
    const document = parseStructuredFile(file);
    for (const issue of document.issues) {
      issues.push({ ...issue, nodeId: issue.nodeId ?? nodeId });
    }
    for (const entry of document.entries) {
      for (const issue of entry.issues) {
        issues.push({ ...issue, nodeId: issue.nodeId ?? entry.key });
      }
      for (const ref of entry.refs) {
        resolveRefIssues(ref);
      }
    }
  } else {
    const parsed = parseFileContent(text, file.key, file.absolutePath);
    for (const issue of parsed.issues) {
      issues.push({ ...issue, nodeId: issue.nodeId ?? nodeId });
    }
    for (const ref of parsed.refs) {
      resolveRefIssues(ref);
    }
  }

  issues.push(
    ...validateLoraRefsResilient(text, nodeId),
    ...validatePlatformWildcardSyntax(text, platform, nodeId),
  );

  return issues;
}

/**
 * Validate LoRA tags against the cached folder index. A missing/unused hit
 * can trigger an async rescan from the renderer when the last walk is stale
 * (see `refreshLoraIndexIfStale`). Never walk here — that froze the editor.
 */
function validateLoraRefsResilient(text: string, nodeId?: string): Issue[] {
  return validateLoraRefs(text, getConfiguredLoraIndex(), nodeId);
}

/**
 * Recompute library-wide LoRA folder warnings (unused + duplicate AutoV2),
 * optionally overlaying unsaved editor text for one file so the All/Other
 * issues list stays current.
 *
 * Reuses the last analyze extras when the wildcard + LoRA fingerprints match.
 */
export function refreshUnusedLoraIssues(
  previewRelativePath?: string,
  previewText?: string,
): IssueDto[] {
  const files = libraryService.loadAllFiles();
  const rawIndex = getConfiguredLoraIndex();
  if (!rawIndex) return [];
  const loraIndex = attachCachedAutoV2Hashes(rawIndex);

  const overlay =
    previewRelativePath !== undefined && previewText !== undefined;
  const previewFiles = overlay
    ? files.map((file) =>
        file.relativePath === previewRelativePath
          ? { ...file, text: previewText!, size: undefined, mtimeMs: undefined }
          : file,
      )
    : files;

  const libraryFp = libraryFilesFingerprint(previewFiles);
  const loraFp = loraIndexFingerprint(loraIndex);
  if (!overlay && extrasMatch(libraryFp, loraFp) && extrasCache) {
    return extrasCache.libraryWideIssues;
  }

  const settings = loadSettings();
  // Include `# NO VALIDATION` files: that marker skips graph/syntax issues on
  // the file, but `<lora:…>` tags there still mean the LoRA is in use.
  const libraryTexts = [
    ...previewFiles.map((file) => file.text),
    ...listAllGenFileContents(),
  ];

  const libraryWide = [
    ...validateUnusedLoras(
      loraIndex,
      libraryTexts,
      settings.ignoredUnusedLoras,
    ),
    ...validateDuplicateLoraAutoV2(loraIndex),
  ];
  if (!overlay) {
    extrasCache = {
      libraryFp,
      loraFp,
      libraryWideIssues: libraryWide,
      refStats: extrasCache?.refStats ?? new Map(),
      callersByRoot: extrasCache?.callersByRoot ?? new Map(),
    };
  }
  return libraryWide;
}

async function loadAnalyzeCore(
  relativePath: string,
  files: LibraryFile[],
  platform: ReturnType<typeof activeValidationPlatform>,
): Promise<AnalyzeCoreResult> {
  const input = {
    rootRelativePath: relativePath,
    files,
    validationPlatform: platform,
  };
  try {
    return await analyzeCoreInWorker(input);
  } catch (error) {
    console.warn(
      '[analyze] worker failed, using in-process fallback',
      error instanceof Error ? error.message : error,
    );
    return analyzeCore(input);
  }
}

function assembleAnalysis(
  root: string,
  relativePath: string,
  files: LibraryFile[],
  core: AnalyzeCoreResult,
): AnalysisResultDto {
  const graph = core.graph;
  const refStats = new Map(
    core.refStats.map((stat) => [stat.key, stat] as const),
  );
  const callers = core.callers;
  const callerNodes: AnalysisResultDto['nodes'] = callers.map((caller) => {
    const stats = refStats.get(caller.key);
    return {
      id: `caller:${caller.key}`,
      kind: 'file',
      label: caller.key,
      path: caller.absolutePath,
      relativeKey: caller.key,
      hostKey: caller.key,
      depth: -1,
      lineCount:
        files
          .find((file) => file.key === caller.key)
          ?.text.split(/\r?\n/).length ?? 0,
      outboundCount: stats?.outbound ?? 0,
      inboundCount: stats?.inbound ?? 0,
      issues: [],
      isCaller: true,
    };
  });
  const callerEdges: AnalysisResultDto['edges'] = callers.map((caller) => ({
    id: `caller-edge:${caller.key}->${graph.rootNodeId}`,
    from: `caller:${caller.key}`,
    to: graph.rootNodeId,
    line: caller.line,
    column: caller.column,
    snippet: caller.snippet,
    isCycle: false,
    isCallerEdge: true,
  }));
  const issues = graph.issues.filter((issue) => !isLoraFolderIssue(issue));
  return {
    root,
    rootFile: relativePath,
    rootNodeId: graph.rootNodeId,
    generatedAt: new Date().toISOString(),
    nodes: [
      ...callerNodes,
      ...graph.nodes.map((n) => ({
        id: n.id,
        kind: n.kind === 'root' ? ('root' as const) : n.kind,
        label: n.label,
        path: n.path,
        relativeKey: n.relativeKey,
        hostKey: n.hostKey,
        depth: n.depth,
        lineCount: n.lineCount,
        outboundCount: n.outboundCount,
        inboundCount: n.inboundCount,
        issues: n.issues.filter((issue) => !isLoraFolderIssue(issue)),
      })),
    ],
    edges: [...callerEdges, ...graph.edges],
    issues,
    stats: {
      ...graph.stats,
      warningCount: issues.filter((issue) => issue.severity === 'warning').length,
      errorCount: issues.filter((issue) => issue.severity === 'error').length,
      nodeCount: graph.stats.nodeCount + callerNodes.length,
      edgeCount: graph.stats.edgeCount + callerEdges.length,
    },
  };
}

function overlayLoraFolderIssues(
  dto: AnalysisResultDto,
  files: LibraryFile[],
): AnalysisResultDto {
  const loraIndex = getConfiguredLoraIndex();
  const filesByKey = new Map(files.map((file) => [file.key, file] as const));
  const seenHosts = new Set<string>();
  const extra: AnalysisResultDto['issues'] = [];

  for (const node of dto.nodes) {
    if (node.isCaller) continue;
    const hostKey = node.hostKey ?? node.relativeKey;
    if (!hostKey || seenHosts.has(hostKey)) continue;
    const file = filesByKey.get(hostKey);
    if (!file) continue;
    seenHosts.add(hostKey);
    if (HONOR_NO_VALIDATION_MARKER && hasNoValidationMarker(file.text)) continue;
    extra.push(...validateLoraRefs(file.text, loraIndex, node.id));
  }

  const libraryFp = libraryFilesFingerprint(files);
  const loraFp = loraIndexFingerprint(loraIndex);
  const reuseExtras = extrasMatch(libraryFp, loraFp);
  if (loraIndex) {
    const libraryWide =
      reuseExtras && extrasCache
        ? extrasCache.libraryWideIssues
        : extrasCache && extrasCache.libraryFp === libraryFp
          ? extrasCache.libraryWideIssues
          : [];
    extra.push(...libraryWide);
    if (!extrasCache || extrasCache.libraryFp !== libraryFp) {
      extrasCache = {
        libraryFp,
        loraFp,
        libraryWideIssues: extrasCache?.libraryWideIssues ?? [],
        refStats: new Map(),
        callersByRoot: new Map(),
      };
    } else {
      extrasCache.loraFp = loraFp;
    }
  }

  if (extra.length === 0) return dto;
  const issues = [...dto.issues, ...extra];
  return {
    ...dto,
    issues,
    stats: {
      ...dto.stats,
      warningCount: issues.filter((issue) => issue.severity === 'warning').length,
      errorCount: issues.filter((issue) => issue.severity === 'error').length,
    },
  };
}

async function analyzeFiles(
  root: string,
  relativePath: string,
  files: LibraryFile[],
  opts: { persist: boolean },
): Promise<AnalysisResultDto> {
  const platform = activeValidationPlatform();
  const libraryFp = libraryFilesFingerprint(files);
  const cached = getCachedAnalysis({
    wildcardsRoot: root,
    rootFile: relativePath,
    libraryFp,
    platform,
  });
  if (cached) {
    return overlayLoraFolderIssues(cached, files);
  }

  const core = await loadAnalyzeCore(relativePath, files, platform);
  const assembled = assembleAnalysis(root, relativePath, files, core);
  if (opts.persist) {
    rememberAnalysis({
      wildcardsRoot: root,
      rootFile: relativePath,
      libraryFp,
      platform,
      result: assembled,
    });
  }
  return overlayLoraFolderIssues(assembled, files);
}
