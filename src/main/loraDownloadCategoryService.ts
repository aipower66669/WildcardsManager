import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_LORA_DOWNLOAD_WEIGHTS,
  normalizeLoraWeights,
  normalizeWildcardRelativePath,
  parseLoraDownloadCategories,
  type LoraDownloadCategory,
} from '../domain/loraDownloadCategory.js';
import { sanitizeDownloadCategoryName } from '../domain/civitaiCategory.js';
import { libraryService } from './libraryService.js';
import {
  getLastLoraDownloadCategoryId,
  getLoraDownloadCategories,
  loadSettings,
  setLastLoraDownloadCategoryId,
  setLoraDownloadCategories,
} from './settingsStore.js';

export type LoraDownloadCategoryListDto = {
  categories: LoraDownloadCategory[];
  lastCategoryId: string | null;
  loraRoot: string | null;
  wildcardFiles: string[];
};

function requireLoraRoot(): string {
  const folder = loadSettings().loraFolder;
  if (!folder) throw new Error('No LoRA folder configured');
  return folder;
}

function ensureCategoryFolder(folder: string): void {
  const root = requireLoraRoot();
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
}

function assertWildcardExists(relativePath: string): void {
  try {
    libraryService.readFile(relativePath);
  } catch {
    throw new Error(`Wildcard file not found: ${relativePath}`);
  }
}

function listWildcardRelativePaths(): string[] {
  try {
    return libraryService
      .listFiles()
      .map((f) => f.relativePath)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

export function listLoraDownloadCategories(opts?: {
  /** Full wildcards walk — only the category manager needs this. Default false. */
  includeWildcardFiles?: boolean;
}): LoraDownloadCategoryListDto {
  const categories = getLoraDownloadCategories().sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
  let lastCategoryId = getLastLoraDownloadCategoryId();
  if (lastCategoryId && !categories.some((c) => c.id === lastCategoryId)) {
    lastCategoryId = null;
  }
  return {
    categories,
    lastCategoryId: lastCategoryId ?? null,
    loraRoot: loadSettings().loraFolder ?? null,
    // Download confirm/queue only need categories. Walking the wildcards tree
    // here blocks the main process (especially during active downloads).
    wildcardFiles:
      opts?.includeWildcardFiles === true ? listWildcardRelativePaths() : [],
  };
}

export function getLoraDownloadCategoryById(
  id: string,
): LoraDownloadCategory | null {
  const trimmed = id.trim();
  if (!trimmed) return null;
  return getLoraDownloadCategories().find((c) => c.id === trimmed) ?? null;
}

export type LoraDownloadCategoryInput = {
  name: string;
  folder: string;
  wildcardRelativePath: string;
  defaultWeights?: string;
};

function normalizeInput(
  input: LoraDownloadCategoryInput,
): Omit<LoraDownloadCategory, 'id'> {
  const name = input.name.trim();
  if (!name) throw new Error('Category name is required');
  const folder = sanitizeDownloadCategoryName(input.folder);
  if (!folder) {
    throw new Error(
      'Folder is invalid. Use a path under the LoRA root (no .. or special characters).',
    );
  }
  const wildcardRelativePath = normalizeWildcardRelativePath(
    input.wildcardRelativePath,
  );
  if (!wildcardRelativePath) {
    throw new Error('Wildcard file path is required');
  }
  assertWildcardExists(wildcardRelativePath);
  const defaultWeights =
    normalizeLoraWeights(input.defaultWeights ?? '') ??
    DEFAULT_LORA_DOWNLOAD_WEIGHTS;
  return { name, folder, wildcardRelativePath, defaultWeights };
}

export function createLoraDownloadCategory(
  input: LoraDownloadCategoryInput,
): LoraDownloadCategoryListDto {
  const fields = normalizeInput(input);
  ensureCategoryFolder(fields.folder);
  const next: LoraDownloadCategory = { id: randomUUID(), ...fields };
  const categories = [...getLoraDownloadCategories(), next];
  setLoraDownloadCategories(categories);
  setLastLoraDownloadCategoryId(next.id);
  return listLoraDownloadCategories({ includeWildcardFiles: true });
}

export function updateLoraDownloadCategory(
  id: string,
  input: LoraDownloadCategoryInput,
): LoraDownloadCategoryListDto {
  const existing = getLoraDownloadCategoryById(id);
  if (!existing) throw new Error('Category not found');
  const fields = normalizeInput(input);
  ensureCategoryFolder(fields.folder);
  const categories = getLoraDownloadCategories().map((c) =>
    c.id === existing.id ? { ...existing, ...fields } : c,
  );
  setLoraDownloadCategories(categories);
  return listLoraDownloadCategories({ includeWildcardFiles: true });
}

export function deleteLoraDownloadCategory(
  id: string,
): LoraDownloadCategoryListDto {
  const trimmed = id.trim();
  const categories = getLoraDownloadCategories().filter((c) => c.id !== trimmed);
  setLoraDownloadCategories(categories);
  if (getLastLoraDownloadCategoryId() === trimmed) {
    setLastLoraDownloadCategoryId(categories[0]?.id ?? null);
  }
  return listLoraDownloadCategories({ includeWildcardFiles: true });
}

export function rememberLoraDownloadCategory(
  id: string,
): LoraDownloadCategory | null {
  const cat = getLoraDownloadCategoryById(id);
  if (!cat) return null;
  setLastLoraDownloadCategoryId(cat.id);
  return cat;
}
