/**
 * One-shot: copy already-computed AutoV2 entries from `!.wcm/models.json`
 * onto each file's NTFS `AUTOV2` ADS, then clear the JSON hash map.
 *
 * Does NOT re-hash files — only stamps the 10-char hash already in the catalog.
 * If a model was moved (path key stale), rematch by **basename** under the same
 * root so manual folder moves do not force multi-hour SHA-256.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MODEL_WEIGHT_EXTENSIONS } from '../domain/lora.js';
import { normalizeAutoV2 } from '../domain/modelHash.js';
import { readAutoV2Ads, writeAutoV2Ads } from './modelAutoV2Ads.js';
import { walkModelFolderEntries } from './modelFolderWalk.js';
import {
  invalidateModelsStoreMemory,
  loadModelsStore,
  saveModelsStore,
} from './modelRootStore.js';
import { listLibraryConfigs } from './settingsStore.js';

export type HashAdsMigrationResult = {
  libraries: number;
  written: number;
  /** Exact catalog path was gone; stamped via basename under the root. */
  rematchedByBasename: number;
  skippedExisting: number;
  missingFiles: number;
  clearedEntries: number;
  failedWrites: number;
};

/**
 * Migrate catalog hashes → ADS for every configured LoRA/checkpoint root.
 * Idempotent: files that already have AUTOV2 are left alone; JSON hashes
 * are cleared after processing each root.
 */
export function migrateModelHashesToAds(): HashAdsMigrationResult {
  const result: HashAdsMigrationResult = {
    libraries: 0,
    written: 0,
    rematchedByBasename: 0,
    skippedExisting: 0,
    missingFiles: 0,
    clearedEntries: 0,
    failedWrites: 0,
  };

  for (const lib of listLibraryConfigs()) {
    result.libraries += 1;
    for (const root of [lib.loraFolder, lib.checkpointFolder]) {
      if (!root?.trim()) continue;
      migrateRootHashesToAds(path.resolve(root), result);
    }
  }

  return result;
}

function isWeightFile(abs: string): boolean {
  const ext = path.extname(abs).toLowerCase();
  return (MODEL_WEIGHT_EXTENSIONS as readonly string[]).includes(ext);
}

/** basename(lower) → absolute paths (handles duplicate names in different folders). */
function buildBasenameIndex(modelRoot: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  try {
    if (!fs.existsSync(modelRoot) || !fs.statSync(modelRoot).isDirectory()) {
      return map;
    }
  } catch {
    return map;
  }
  walkModelFolderEntries(modelRoot, modelRoot, (abs) => {
    if (!isWeightFile(abs)) return;
    const key = path.basename(abs).toLowerCase();
    const list = map.get(key);
    if (list) list.push(abs);
    else map.set(key, [abs]);
  });
  return map;
}

function resolveMovedTarget(
  catalogAbs: string,
  fileName: string,
  byBasename: Map<string, string[]>,
): { abs: string; viaBasename: boolean } | null {
  try {
    if (fs.existsSync(catalogAbs) && fs.statSync(catalogAbs).isFile()) {
      return { abs: catalogAbs, viaBasename: false };
    }
  } catch {
    /* fall through to basename */
  }

  const hits = byBasename.get(fileName.toLowerCase()) ?? [];
  if (hits.length === 0) return null;
  if (hits.length === 1) return { abs: hits[0]!, viaBasename: true };

  // Ambiguous basename: prefer a file that does not already have AUTOV2.
  const needy = hits.filter((h) => !readAutoV2Ads(h));
  if (needy.length === 1) return { abs: needy[0]!, viaBasename: true };
  return null;
}

function migrateRootHashesToAds(
  modelRoot: string,
  result: HashAdsMigrationResult,
): void {
  invalidateModelsStoreMemory(modelRoot);
  const store = loadModelsStore(modelRoot);
  const entries = Object.entries(store.hashes);
  if (entries.length === 0) return;

  // One walk so moved files (stale relative keys) still get their catalog hash.
  const byBasename = buildBasenameIndex(modelRoot);

  for (const [rel, entry] of entries) {
    const autoV2 = normalizeAutoV2(entry?.autoV2);
    if (!autoV2) continue;

    const catalogAbs = path.resolve(modelRoot, rel);
    const fileName = path.basename(rel);
    const target = resolveMovedTarget(catalogAbs, fileName, byBasename);
    if (!target) {
      result.missingFiles += 1;
      continue;
    }

    const existing = readAutoV2Ads(target.abs);
    if (existing) {
      result.skippedExisting += 1;
      continue;
    }

    if (writeAutoV2Ads(target.abs, autoV2)) {
      result.written += 1;
      if (target.viaBasename) result.rematchedByBasename += 1;
    } else {
      result.failedWrites += 1;
    }
  }

  result.clearedEntries += entries.length;
  store.hashes = {};
  saveModelsStore(modelRoot, store);
}
