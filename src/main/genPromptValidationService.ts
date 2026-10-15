import { validateGenPromptFiles } from '../domain/genPromptValidation.js';
import type {
  GenPromptValidationFileDto,
  GenPromptValidationReportDto,
} from '../shared/contracts.js';
import { libraryService } from './libraryService.js';
import { getConfiguredLoraIndex } from './loraService.js';
import { attachCachedAutoV2Hashes } from './modelHashCache.js';
import { listGenFiles, readGenFile } from './promptsService.js';
import { getActiveLibrary } from './settingsStore.js';

function toDto(
  row: ReturnType<typeof validateGenPromptFiles>[number],
): GenPromptValidationFileDto {
  return {
    relativeFolder: row.relativeFolder,
    relativePath: row.relativePath,
    issues: row.issues,
    errorCount: row.errorCount,
    warningCount: row.warningCount,
  };
}

function context() {
  const platform = getActiveLibrary().validationPlatform ?? 'comfyui';
  const rawIndex = getConfiguredLoraIndex();
  const loraIndex = rawIndex ? attachCachedAutoV2Hashes(rawIndex) : null;
  const libraryFiles = libraryService.getRoot()
    ? libraryService.loadAllFiles()
    : [];
  return { platform, loraIndex, libraryFiles };
}

/** Validate every `!gen.txt`. Only files with issues are returned. */
export function validateAllGenPrompts(): GenPromptValidationReportDto {
  const files = listGenFiles();
  const { platform, loraIndex, libraryFiles } = context();
  const rows = validateGenPromptFiles(
    files.map((file) => ({
      relativeFolder: file.relativeFolder,
      text: file.content,
    })),
    libraryFiles,
    platform,
    loraIndex,
  );
  const withIssues = rows.filter(
    (row) => row.errorCount > 0 || row.warningCount > 0,
  );
  return {
    files: withIssues.map(toDto),
    filesWithIssues: withIssues.length,
    errorCount: withIssues.reduce((sum, row) => sum + row.errorCount, 0),
    warningCount: withIssues.reduce((sum, row) => sum + row.warningCount, 0),
  };
}

/** Re-check one folder after its `!gen.txt` is edited. Null when the file is gone. */
export function validateOneGenPrompt(
  relativeFolder: string,
): GenPromptValidationFileDto | null {
  const gen = readGenFile(relativeFolder);
  if (!gen.exists) return null;
  const { platform, loraIndex, libraryFiles } = context();
  const [row] = validateGenPromptFiles(
    [{ relativeFolder: gen.relativeFolder, text: gen.content }],
    libraryFiles,
    platform,
    loraIndex,
  );
  return row ? toDto(row) : null;
}

/** Same checks as a `!gen.txt` file, for the Generation “Use this prompt” draft. */
export function validateGenPromptText(text: string): GenPromptValidationFileDto {
  const { platform, loraIndex, libraryFiles } = context();
  const [row] = validateGenPromptFiles(
    [{ relativeFolder: '', text }],
    libraryFiles,
    platform,
    loraIndex,
  );
  if (!row) {
    return {
      relativeFolder: '',
      relativePath: '!gen.txt',
      issues: [],
      errorCount: 0,
      warningCount: 0,
    };
  }
  return toDto(row);
}
