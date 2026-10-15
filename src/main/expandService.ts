import { expandPrompts } from '../domain/expand.js';
import type { ExpandRequestDto, ExpandResultDto } from '../shared/contracts.js';
import { libraryService } from './libraryService.js';

export function expandPreview(request: ExpandRequestDto): ExpandResultDto {
  const files = libraryService.loadAllFiles();
  const result = expandPrompts({
    rootRelativePath: request.relativePath,
    files,
    mode: request.mode,
    limit: request.limit,
    seed: request.seed,
  });
  return {
    mode: result.mode,
    rootKey: result.rootKey,
    samples: result.samples,
    totalCombinations: result.totalCombinations,
    combinationsSaturated: result.combinationsSaturated,
    limit: result.limit,
    truncated: result.truncated,
    seed: result.seed,
    issues: result.issues,
  };
}
