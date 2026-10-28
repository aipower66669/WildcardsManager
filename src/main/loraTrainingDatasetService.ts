import path from 'node:path';
import type { LoraSeriesDatasetKeyParts } from '../domain/loraTrainingDataset.js';
import { getActiveLibrary } from './settingsStore.js';
import {
  readTrainingLibraryImageDataUrlInRoot,
  resolveLoraSeriesDatasetPreviewInRoots,
  type LoraSeriesDatasetPreviewResult,
} from './loraTrainingDatasetResolve.js';

export {
  resetLoraSeriesDatasetMemory,
  type LoraSeriesDatasetPreviewResult,
} from './loraTrainingDatasetResolve.js';

function activeLibraryRoots(): {
  trainingRoot: string | null;
  loraRoot: string | null;
} {
  const lib = getActiveLibrary();
  return {
    trainingRoot: lib.trainingLibraryFolder?.trim()
      ? path.resolve(lib.trainingLibraryFolder)
      : null,
    loraRoot: lib.loraFolder?.trim() ? path.resolve(lib.loraFolder) : null,
  };
}

/** Data URL for an image under the configured training library root. */
export function readTrainingLibraryImageDataUrl(
  absolutePath: string,
): string | null {
  return readTrainingLibraryImageDataUrlInRoot(
    activeLibraryRoots().trainingRoot,
    absolutePath,
  );
}

/**
 * Resolve a training-dataset folder for a multi-step LoRA series.
 * Callers on the Electron main thread should use the worker client instead.
 */
export function resolveLoraSeriesDatasetPreview(
  parts: LoraSeriesDatasetKeyParts,
  opts?: { force?: boolean },
): LoraSeriesDatasetPreviewResult {
  return resolveLoraSeriesDatasetPreviewInRoots(
    parts,
    activeLibraryRoots(),
    opts,
  );
}
