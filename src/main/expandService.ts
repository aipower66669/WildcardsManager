import { expandPrompts, type ExpandResult } from '../domain/expand.js';
import {
  appendAdditionalPositive,
  pickGenerationPrompt,
  promptsForFileExpand,
  resolveGenerationSeed,
} from '../domain/generationPromptPick.js';
import type { ExpandRequestDto, ExpandResultDto } from '../shared/contracts.js';
import { applyLibraryPromptSubstitutions } from './promptSubstitutions.js';
import {
  ensureGenPromptFolders,
  expandGenLine,
  expandPromptTemplates,
  getLoadedGenPrompts,
  libraryIndexForExpand,
  listGenPromptFolders,
  listGenPromptFoldersUnder,
  loadGenPrompts,
  readGenFile,
} from './promptsService.js';

function toDto(result: ExpandResult, detail?: string): ExpandResultDto {
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
    ...(detail ? { detail } : {}),
  };
}

export async function expandPreview(
  request: ExpandRequestDto,
): Promise<ExpandResultDto> {
  const source = request.source ?? 'wildcard';
  if (source === 'gen-file') return expandGenFilePreview(request);
  if (source === 'generation') {
    const promptSource = request.promptSource === 'text' ? 'text' : 'folder';
    const folder = request.relativeFolder?.trim() ?? '';
    if (
      promptSource !== 'text' &&
      (!folder || request.promptFoldersRecursive === true)
    ) {
      await ensureGenPromptFolders();
    }
    return expandGenerationPreview(request);
  }

  const relativePath = request.relativePath?.trim();
  if (!relativePath) throw new Error('Invalid path');
  const result = expandPrompts({
    rootRelativePath: relativePath,
    files: [],
    index: libraryIndexForExpand(),
    mode: request.mode,
    limit: request.limit,
    seed: request.seed,
  });
  return toDto(result);
}

function expandGenFilePreview(request: ExpandRequestDto): ExpandResultDto {
  const folder = request.relativeFolder?.trim() ?? '';
  if (!folder) throw new Error('Select a prompt folder');
  const content =
    typeof request.content === 'string'
      ? request.content
      : readGenFile(folder).content;
  const lines = promptsForFileExpand(content);
  if (lines.length === 0) {
    throw new Error(`${folder}/!gen.txt has no usable prompts`);
  }
  const result = expandPromptTemplates(lines, {
    mode: request.mode,
    limit: request.limit ?? (request.mode === 'random' ? 20 : 100),
    seed: request.seed,
  });
  return toDto(
    result,
    `${folder}/!gen.txt · ${lines.length} prompt${lines.length === 1 ? '' : 's'}`,
  );
}

function expandGenerationPreview(request: ExpandRequestDto): ExpandResultDto {
  const promptSource = request.promptSource === 'text' ? 'text' : 'folder';
  const seed = resolveGenerationSeed(request.generationSeed);
  const picked = pickGenerationPrompt({
    promptSource,
    promptText: request.promptText ?? '',
    promptSingle: request.promptSingle === true,
    relativeFolder: request.relativeFolder?.trim() ?? '',
    recursive: request.promptFoldersRecursive === true,
    seed,
    listAllFolders: listGenPromptFolders,
    listFoldersUnder: listGenPromptFoldersUnder,
    loadLines: (folder) => {
      loadGenPrompts(folder);
      return getLoadedGenPrompts(folder);
    },
  });
  const line = applyLibraryPromptSubstitutions(
    picked.line,
    request.checkpoint ?? '',
  ).trim();
  if (!line) {
    throw new Error('Expanded prompt was empty');
  }
  const result = expandPromptTemplates([line], {
    mode: request.mode,
    limit: request.limit ?? (request.mode === 'random' ? 20 : 100),
    seed,
  });
  const extraRaw = request.additionalPositivePrompt?.trim() ?? '';
  const extraExpanded = extraRaw ? expandGenLine(extraRaw, seed).text.trim() : '';
  const extra = extraExpanded || extraRaw;
  if (extra) {
    result.samples = result.samples.map((sample) =>
      appendAdditionalPositive(sample, extra),
    );
  }
  const where =
    promptSource === 'text'
      ? 'typed prompt'
      : `${picked.relativeFolder}/!gen.txt`;
  return toDto(result, `Once · ${where} · seed ${seed}`);
}
