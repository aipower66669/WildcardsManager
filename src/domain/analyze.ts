import { buildDependencyGraph } from './buildGraph.js';
import type { ValidationPlatform } from './platformValidation.js';
import type { AnalysisGraph, LibraryFile } from './types.js';

export type AnalyzeInput = {
  rootRelativePath: string;
  files: LibraryFile[];
  validationPlatform?: ValidationPlatform;
};

export type AnalyzeOutput = AnalysisGraph & {
  stats: {
    fileCount: number;
    nodeCount: number;
    edgeCount: number;
    missingCount: number;
    cycleCount: number;
    errorCount: number;
    warningCount: number;
  };
};

export function analyzeWildcardTree(input: AnalyzeInput): AnalyzeOutput {
  const graph = buildDependencyGraph({
    rootRelativePath: input.rootRelativePath,
    files: input.files,
    validationPlatform: input.validationPlatform,
  });

  const missingCount = graph.nodes.filter((n) => n.kind === 'missing').length;
  const cycleCount = graph.edges.filter((e) => e.isCycle).length;
  const errorCount = graph.issues.filter((i) => i.severity === 'error').length;
  const warningCount = graph.issues.filter((i) => i.severity === 'warning').length;

  return {
    ...graph,
    stats: {
      fileCount: input.files.length,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      missingCount,
      cycleCount,
      errorCount,
      warningCount,
    },
  };
}
