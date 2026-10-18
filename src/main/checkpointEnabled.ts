/**
 * Per-library checkpoint use list (`ignoredCheckpoints` in that library’s
 * `library.json`). Unticked checkpoints stay on disk. Generation and Benchmark
 * for this library skip them; another library sharing the folder can still
 * use them.
 */

import path from 'node:path';
import {
  isCheckpointIgnored,
  withCheckpointEnabled,
} from '../domain/checkpointEnabled.js';
import { getActiveLibrary, patchActiveLibrary } from './settingsStore.js';
import { loadModelsStoreForPath } from './modelRootStore.js';

export function checkpointEnabledForRelativePath(relativePath: string): boolean {
  return !isCheckpointIgnored(
    relativePath,
    getActiveLibrary().ignoredCheckpoints ?? [],
  );
}

/** Persist use/don’t-use for the active library. Returns the new enabled flag. */
export function setCheckpointEnabled(opts: {
  absolutePath: string;
  enabled: boolean;
}): boolean {
  const lib = getActiveLibrary();
  const checkpointRoot = lib.checkpointFolder?.trim();
  if (!checkpointRoot) {
    throw new Error('No checkpoint folder configured for this library');
  }
  if (!lib.wildcardsRoot?.trim()) {
    throw new Error('No wildcards folder configured for this library');
  }
  const ctx = loadModelsStoreForPath(opts.absolutePath);
  if (
    !ctx ||
    path.resolve(ctx.root).toLowerCase() !==
      path.resolve(checkpointRoot).toLowerCase()
  ) {
    throw new Error('Not a checkpoint in the configured Checkpoint folder');
  }
  const enabled = opts.enabled === true;
  patchActiveLibrary(
    {
      ignoredCheckpoints: withCheckpointEnabled(
        lib.ignoredCheckpoints ?? [],
        ctx.pathKey,
        enabled,
      ),
    },
    { flushImmediate: true },
  );
  return enabled;
}

/** Drop this file from the active library’s unused list when it is deleted. */
export function clearCheckpointIgnored(absolutePath: string): void {
  const lib = getActiveLibrary();
  const ctx = loadModelsStoreForPath(absolutePath);
  if (!ctx) return;
  const next = withCheckpointEnabled(
    lib.ignoredCheckpoints ?? [],
    ctx.pathKey,
    true,
  );
  if (next.length === (lib.ignoredCheckpoints ?? []).length) return;
  patchActiveLibrary({ ignoredCheckpoints: next }, { flushImmediate: true });
}
