import { parentPort } from 'node:worker_threads';
import type { LoraSeriesDatasetKeyParts } from '../domain/loraTrainingDataset.js';
import {
  readTrainingLibraryImageDataUrlInRoot,
  resolveLoraSeriesDatasetPreviewInRoots,
  type LoraSeriesDatasetPreviewResult,
} from './loraTrainingDatasetResolve.js';

export type LoraSeriesDatasetWorkerRequest =
  | {
      id: number;
      op: 'resolve';
      parts: LoraSeriesDatasetKeyParts;
      trainingRoot: string | null;
      loraRoot: string | null;
      force?: boolean;
      /** When this still matches the cover, omit the data URL from the reply. */
      knownPreviewPath?: string | null;
    }
  | {
      id: number;
      op: 'readImage';
      trainingRoot: string | null;
      absolutePath: string;
    };

export type LoraSeriesDatasetWorkerResponse = {
  id: number;
  ok: boolean;
  result?: LoraSeriesDatasetPreviewResult;
  dataUrl?: string | null;
  error?: string;
};

const port = parentPort;
if (!port) {
  throw new Error('LoRA series dataset worker requires parentPort');
}

port.on('message', (msg: LoraSeriesDatasetWorkerRequest) => {
  try {
    if (msg.op === 'readImage') {
      const dataUrl = readTrainingLibraryImageDataUrlInRoot(
        msg.trainingRoot,
        msg.absolutePath,
      );
      const reply: LoraSeriesDatasetWorkerResponse = {
        id: msg.id,
        ok: true,
        dataUrl,
      };
      port.postMessage(reply);
      return;
    }
    const result = resolveLoraSeriesDatasetPreviewInRoots(
      msg.parts,
      { trainingRoot: msg.trainingRoot, loraRoot: msg.loraRoot },
      { force: msg.force === true },
    );
    const posted =
      result.previewDataUrl &&
      msg.knownPreviewPath &&
      msg.knownPreviewPath === result.previewAbsolutePath
        ? { ...result, previewDataUrl: null }
        : result;
    const reply: LoraSeriesDatasetWorkerResponse = {
      id: msg.id,
      ok: true,
      result: posted,
    };
    port.postMessage(reply);
  } catch (error) {
    const reply: LoraSeriesDatasetWorkerResponse = {
      id: msg.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    port.postMessage(reply);
  }
});
