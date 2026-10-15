import {
  collectFileNodeIssues,
  summarizeIssues,
} from './libraryValidation.js';
import { buildLibraryIndex } from './resolveWildcard.js';
import type { ValidationPlatform } from './platformValidation.js';
import type { LoraIndex } from './lora.js';
import type { Issue, LibraryFile } from './types.js';

export type GenPromptFileInput = {
  relativeFolder: string;
  text: string;
};

export type GenPromptFileValidation = {
  relativeFolder: string;
  relativePath: string;
  issues: Issue[];
  errorCount: number;
  warningCount: number;
};

function genRelativePath(relativeFolder: string): string {
  return relativeFolder ? `${relativeFolder}/!gen.txt` : '!gen.txt';
}

/**
 * Validate `!gen.txt` bodies the same way as wildcard files: syntax, missing
 * or invalid wildcard refs, and LoRA tags. An empty prompt file is not an
 * error — these files are allowed to be stubs.
 */
export function validateGenPromptFiles(
  genFiles: GenPromptFileInput[],
  libraryFiles: LibraryFile[],
  platform: ValidationPlatform,
  loraIndex: LoraIndex | null,
): GenPromptFileValidation[] {
  const libraryIndex = buildLibraryIndex(libraryFiles);
  return genFiles.map((gen) => {
    const relativePath = genRelativePath(gen.relativeFolder);
    const synthetic: LibraryFile = {
      relativePath,
      absolutePath: relativePath,
      name: '!gen.txt',
      ext: '.txt',
      key: relativePath,
      text: gen.text,
    };
    const issues = collectFileNodeIssues(
      synthetic,
      libraryIndex,
      platform,
      loraIndex,
    ).filter((issue) => issue.code !== 'empty_file');
    const { errorCount, warningCount } = summarizeIssues(issues);
    return {
      relativeFolder: gen.relativeFolder,
      relativePath,
      issues,
      errorCount,
      warningCount,
    };
  });
}
