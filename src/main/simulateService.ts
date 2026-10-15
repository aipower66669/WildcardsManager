import fs from 'node:fs';
import { forEachSimulatedPromptLine, simulateReach } from '../domain/expand.js';
import type {
  SimulateExportResultDto,
  SimulateRequestDto,
  SimulateResultDto,
} from '../shared/contracts.js';
import { libraryService } from './libraryService.js';

export function runSimulation(request: SimulateRequestDto): SimulateResultDto {
  const files = libraryService.loadAllFiles();
  const result = simulateReach({
    rootRelativePath: request.relativePath,
    files,
    iterations: request.iterations,
    seed: request.seed,
  });
  return {
    rootKey: result.rootKey,
    iterations: result.iterations,
    seed: result.seed,
    stats: result.stats,
    edges: result.edges,
    issues: result.issues,
  };
}

/** Write every simulated prompt, with a blank line between runs. */
export function exportSimulatedLines(
  request: SimulateRequestDto,
  filePath: string,
): SimulateExportResultDto {
  const files = libraryService.loadAllFiles();
  let handle: number | null = fs.openSync(filePath, 'w');
  try {
    const meta = forEachSimulatedPromptLine(
      {
        rootRelativePath: request.relativePath,
        files,
        iterations: request.iterations,
        seed: request.seed,
      },
      (line, index) => {
        fs.writeSync(handle!, index === 0 ? line : `\n\n${line}`);
      },
    );
    if (!meta.found) {
      throw new Error(`Root file not found: ${request.relativePath}`);
    }
    if (meta.lineCount > 0) fs.writeSync(handle, '\n');
    return {
      saved: true,
      filePath,
      lineCount: meta.lineCount,
      iterations: meta.iterations,
      seed: meta.seed,
    };
  } catch (err) {
    if (handle !== null) {
      fs.closeSync(handle);
      handle = null;
    }
    fs.rmSync(filePath, { force: true });
    throw err;
  } finally {
    if (handle !== null) fs.closeSync(handle);
  }
}
