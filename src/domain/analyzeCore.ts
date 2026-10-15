import { analyzeWildcardTree, type AnalyzeOutput } from './analyze.js';
import {
  hasNoValidationMarker,
  HONOR_NO_VALIDATION_MARKER,
} from './parseRefs.js';
import { validatePlatformWildcardSyntax } from './platformValidation.js';
import type { ValidationPlatform } from './platformValidation.js';
import {
  computeReferenceStats,
  findDirectCallers,
  type DirectCaller,
  type FileRefStat,
} from './references.js';
import { isStructuredFile } from './structured.js';
import type { Issue, LibraryFile } from './types.js';

export type AnalyzeCoreInput = {
  rootRelativePath: string;
  files: LibraryFile[];
  validationPlatform: ValidationPlatform;
};

export type AnalyzeCoreResult = {
  graph: AnalyzeOutput;
  refStats: FileRefStat[];
  callers: DirectCaller[];
};

/**
 * Graph + platform syntax + reverse-refs. No LoRA folder I/O — that belongs
 * on the already-cached index after the worker returns.
 */
export function analyzeCore(input: AnalyzeCoreInput): AnalyzeCoreResult {
  const platform = input.validationPlatform;
  const graph = analyzeWildcardTree({
    rootRelativePath: input.rootRelativePath,
    files: input.files,
    validationPlatform: platform,
  });

  const filesByKey = new Map(input.files.map((file) => [file.key, file]));
  const validatedHosts = new Set<string>();
  for (const node of graph.nodes) {
    const hostKey = node.hostKey ?? node.relativeKey;
    if (!hostKey || validatedHosts.has(hostKey)) continue;
    const file = filesByKey.get(hostKey);
    if (!file) continue;
    validatedHosts.add(hostKey);
    if (HONOR_NO_VALIDATION_MARKER && hasNoValidationMarker(file.text)) {
      continue;
    }
    if (isStructuredFile(file) && !file.text.trim()) continue;
    const hostNode =
      graph.nodes.find(
        (candidate) =>
          candidate.id === hostKey ||
          candidate.id === `structured-file:${hostKey}` ||
          (candidate.hostKey === hostKey &&
            (candidate.kind === 'file' || candidate.kind === 'root')),
      ) ?? graph.nodes.find((candidate) => candidate.hostKey === hostKey);
    const nodeId = hostNode?.id ?? hostKey;
    for (const issue of validatePlatformWildcardSyntax(
      file.text,
      platform,
      nodeId,
    )) {
      graph.issues.push(issue);
      if (hostNode) hostNode.issues.push(issue);
    }
  }

  const refStats = computeReferenceStats(input.files, platform);
  const rootNode = graph.nodes.find((node) => node.id === graph.rootNodeId);
  const rootKey = graph.rootNodeId.startsWith('structured-file:')
    ? undefined
    : rootNode?.relativeKey;
  const callers = rootKey ? findDirectCallers(input.files, rootKey) : [];

  return { graph, refStats, callers };
}

export function isLoraFolderIssue(issue: Pick<Issue, 'code'>): boolean {
  return (
    issue.code === 'missing_lora' ||
    issue.code === 'invalid_lora' ||
    issue.code === 'unused_lora' ||
    issue.code === 'duplicate_lora_hash'
  );
}
