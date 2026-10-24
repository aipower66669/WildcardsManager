import fs from 'node:fs';
import path from 'node:path';
import {
  isSafeCategoryRelativePath,
  sanitizeDownloadCategoryName,
} from '../domain/civitaiCategory.js';
import { isLibraryUtilityDirName } from '../domain/librarySidecarPaths.js';
import { direntIsDirectory } from './modelFolderWalk.js';
import type { CivitaiModelTypeDto } from '../shared/contracts.js';
import {
  getLastCivitaiDownloadCategory,
  loadSettings,
  setLastCivitaiDownloadCategory,
} from './settingsStore.js';

export type CivitaiDownloadCategoryInfo = {
  categories: string[];
  lastCategory: string;
  rootFolder: string;
};

function modelRootFolder(type: CivitaiModelTypeDto): string {
  const settings = loadSettings();
  const folder =
    type === 'LORA' ? settings.loraFolder : settings.checkpointFolder;
  if (!folder) {
    throw new Error(
      type === 'LORA'
        ? 'No LoRA folder configured'
        : 'No checkpoint folder configured',
    );
  }
  return folder;
}

export function resolveDownloadCategoryDir(
  rootFolder: string,
  category: string | undefined,
): string {
  const normalized = sanitizeDownloadCategoryName(category ?? '');
  if (!normalized) return rootFolder;

  const resolved = path.resolve(rootFolder, normalized);
  const relative = path.relative(path.resolve(rootFolder), resolved);
  if (!isSafeCategoryRelativePath(relative) || path.isAbsolute(relative)) {
    throw new Error('Invalid download category');
  }
  return resolved;
}

/** Subfolders a checkpoint can download into. Junctions count. Utility dirs do not. */
export function listDownloadCategoryDirNames(rootFolder: string): string[] {
  const categories: string[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(rootFolder, { withFileTypes: true });
  } catch {
    return categories;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || isLibraryUtilityDirName(entry.name)) continue;
    if (!direntIsDirectory(path.join(rootFolder, entry.name), entry)) continue;
    categories.push(entry.name);
  }
  categories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return categories;
}

export function listDownloadCategories(
  type: CivitaiModelTypeDto,
): CivitaiDownloadCategoryInfo {
  const rootFolder = modelRootFolder(type);
  const categories = listDownloadCategoryDirNames(rootFolder);

  const last = getLastCivitaiDownloadCategory(type);
  const lastCategory =
    last && (last === '' || categories.includes(last)) ? last : '';

  return { categories, lastCategory, rootFolder };
}

export function createDownloadCategory(
  type: CivitaiModelTypeDto,
  name: string,
): CivitaiDownloadCategoryInfo {
  const rootFolder = modelRootFolder(type);
  const category = sanitizeDownloadCategoryName(name);
  if (!category) {
    throw new Error(
      'Category name is invalid. Use letters, numbers, spaces, hyphens, or underscores.',
    );
  }

  const target = path.join(rootFolder, category);
  if (fs.existsSync(target) && !fs.statSync(target).isDirectory()) {
    throw new Error(`"${category}" already exists as a file`);
  }
  fs.mkdirSync(target, { recursive: true });
  setLastCivitaiDownloadCategory(type, category);
  return listDownloadCategories(type);
}

export function rememberDownloadCategory(
  type: CivitaiModelTypeDto,
  category: string | undefined,
): void {
  setLastCivitaiDownloadCategory(type, sanitizeDownloadCategoryName(category ?? ''));
}
