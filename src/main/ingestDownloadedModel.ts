import { ingestCheckpointFileAt } from './checkpointService.js';
import { ingestLoraFileAt } from './loraService.js';

/** Add one downloaded weight to the live LoRA or checkpoint index. */
export function ingestDownloadedModelFile(
  absolutePath: string,
  opts?: { notify?: boolean },
): boolean {
  if (ingestLoraFileAt(absolutePath, opts)) return true;
  return ingestCheckpointFileAt(absolutePath);
}
