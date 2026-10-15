import { findLocalInstallMatches } from './checkpointService.js';
import { getConfiguredCheckpointIndexCachedHashes } from './checkpointService.js';
import { getConfiguredLoraIndexCachedHashes } from './loraService.js';
import {
  isCivitaiModelArchived,
  isCivitaiModelMaybe,
  unarchiveCivitaiModel,
  unmaybeCivitaiModel,
} from './settingsStore.js';

type VersionHashSource = {
  id?: number;
  autoV2?: string;
  autoV2Hashes?: string[];
};

function collectHashes(
  autoV2?: string | null,
  autoV2Hashes?: Iterable<string> | null,
  versions?: VersionHashSource[] | null,
): string[] {
  const seen = new Set<string>();
  const add = (h?: string | null) => {
    const t = typeof h === 'string' ? h.trim() : '';
    if (t) seen.add(t);
  };
  add(autoV2);
  if (autoV2Hashes) {
    for (const h of autoV2Hashes) add(h);
  }
  if (versions) {
    for (const v of versions) {
      add(v.autoV2);
      if (v.autoV2Hashes) {
        for (const h of v.autoV2Hashes) add(h);
      }
    }
  }
  return [...seen];
}

function hashesForVersionId(
  versions: VersionHashSource[] | null | undefined,
  versionId: number,
): string[] {
  if (!versions?.length) return [];
  return collectHashes(
    undefined,
    undefined,
    versions.filter((v) => v.id === versionId),
  );
}

function hasLocalHashHit(
  type: string | undefined,
  hashes: string[],
): boolean {
  if (hashes.length === 0) return false;
  const isCheckpoint = (type ?? '').toLowerCase() === 'checkpoint';
  const index = isCheckpoint
    ? getConfiguredCheckpointIndexCachedHashes()
    : getConfiguredLoraIndexCachedHashes();
  return findLocalInstallMatches(index, '', undefined, hashes).length > 0;
}

/**
 * When catalog sync discovers a newer version on an Archive or Maybe model,
 * bring it back to Browse — but only when that is a *real* update:
 * the user already has an older weight on disk, and the new version’s hashes
 * are not local yet.
 *
 * Bare `versionId` bumps (metadata catch-up / tip-check churn) must NOT
 * unshelve a card the user already has fully matched.
 */
export function maybeUnarchiveForNewVersion(opts: {
  modelId: number;
  type?: string;
  previousVersionId?: number | null;
  nextVersionId?: number | null;
  autoV2?: string | null;
  autoV2Hashes?: Iterable<string> | null;
  versions?: VersionHashSource[] | null;
}): boolean {
  const nextId = opts.nextVersionId;
  const prevId = opts.previousVersionId;
  if (nextId == null || !Number.isFinite(nextId)) return false;
  // First time we learn a versionId — not a "new version" bump.
  if (prevId == null || !Number.isFinite(prevId)) return false;
  if (nextId <= prevId) return false;

  const archived = isCivitaiModelArchived(opts.modelId);
  const maybe = isCivitaiModelMaybe(opts.modelId);
  if (!archived && !maybe) return false;

  // Need per-version hashes for the new id. Without them we cannot tell a real
  // update from catalog metadata churn — stay shelved.
  const newVersionHashes = hashesForVersionId(opts.versions, nextId);
  if (newVersionHashes.length === 0) return false;

  // Already have the new version (or its only published weight) → stay shelved.
  if (hasLocalHashHit(opts.type, newVersionHashes)) return false;

  const allHashes = collectHashes(
    opts.autoV2,
    opts.autoV2Hashes,
    opts.versions,
  );
  // Never downloaded this card → Archive/Maybe stays permanent.
  if (!hasLocalHashHit(opts.type, allHashes)) return false;

  if (archived) unarchiveCivitaiModel(opts.modelId);
  if (maybe) unmaybeCivitaiModel(opts.modelId);
  return true;
}

/**
 * When a model leaves Notify because early access ended, clear Archive / Maybe
 * so it returns to Browse. Only call from the Notify unlock path — never for
 * unrelated shelved models.
 */
export function clearShelvesForNotifyUnlock(modelId: number): boolean {
  const id = Math.round(modelId);
  if (!Number.isFinite(id)) return false;
  const archived = isCivitaiModelArchived(id);
  const maybe = isCivitaiModelMaybe(id);
  if (!archived && !maybe) return false;
  if (archived) unarchiveCivitaiModel(id);
  if (maybe) unmaybeCivitaiModel(id);
  return true;
}
