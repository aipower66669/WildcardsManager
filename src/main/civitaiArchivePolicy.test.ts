import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addLoraFile, type LoraIndex } from '../domain/lora.js';

const archived = new Set<number>();
const maybe = new Set<number>();
const unarchive = vi.fn((modelId: number) => {
  archived.delete(modelId);
  return [];
});
const unmaybe = vi.fn((modelId: number) => {
  maybe.delete(modelId);
  return [];
});

vi.mock('./settingsStore.js', () => ({
  isCivitaiModelArchived: (modelId: number) => archived.has(modelId),
  isCivitaiModelMaybe: (modelId: number) => maybe.has(modelId),
  unarchiveCivitaiModel: (modelId: number) => unarchive(modelId),
  unmaybeCivitaiModel: (modelId: number) => unmaybe(modelId),
}));

function emptyIndex(): LoraIndex {
  return {
    root: '/checkpoints',
    aliases: new Map(),
    files: [],
    fileCount: 0,
  };
}

const checkpointIndex = emptyIndex();

vi.mock('./checkpointService.js', async () => {
  const actual = await vi.importActual<typeof import('./checkpointService.js')>(
    './checkpointService.js',
  );
  return {
    ...actual,
    getConfiguredCheckpointIndexCachedHashes: () => checkpointIndex,
  };
});

vi.mock('./loraService.js', () => ({
  getConfiguredLoraIndexCachedHashes: () => null,
}));

describe('maybeUnarchiveForNewVersion', () => {
  beforeEach(() => {
    archived.clear();
    maybe.clear();
    unarchive.mockClear();
    unmaybe.mockClear();
    checkpointIndex.files = [];
    checkpointIndex.fileCount = 0;
    checkpointIndex.byAutoV2 = undefined;
  });

  it('unarchives when a newer version appears and only an older AutoV2 is local', async () => {
    const { maybeUnarchiveForNewVersion } = await import(
      './civitaiArchivePolicy.js'
    );
    archived.add(42);
    addLoraFile(checkpointIndex, 'v1.safetensors', '/checkpoints/v1.safetensors');
    checkpointIndex.byAutoV2 = new Map([
      ['AAAAAAAAAA', '/checkpoints/v1.safetensors'],
    ]);

    expect(
      maybeUnarchiveForNewVersion({
        modelId: 42,
        type: 'Checkpoint',
        previousVersionId: 1,
        nextVersionId: 2,
        autoV2: 'BBBBBBBBBB',
        autoV2Hashes: ['BBBBBBBBBB', 'AAAAAAAAAA'],
        versions: [
          { id: 2, autoV2: 'BBBBBBBBBB', autoV2Hashes: ['BBBBBBBBBB'] },
          { id: 1, autoV2: 'AAAAAAAAAA', autoV2Hashes: ['AAAAAAAAAA'] },
        ],
      }),
    ).toBe(true);
    expect(unarchive).toHaveBeenCalledWith(42);
    expect(unmaybe).not.toHaveBeenCalled();
    expect(archived.has(42)).toBe(false);
  });

  it('stays archived when the “new” version is already on disk', async () => {
    const { maybeUnarchiveForNewVersion } = await import(
      './civitaiArchivePolicy.js'
    );
    archived.add(42);
    addLoraFile(checkpointIndex, 'v2.safetensors', '/checkpoints/v2.safetensors');
    checkpointIndex.byAutoV2 = new Map([
      ['BBBBBBBBBB', '/checkpoints/v2.safetensors'],
    ]);

    expect(
      maybeUnarchiveForNewVersion({
        modelId: 42,
        type: 'Checkpoint',
        previousVersionId: 1,
        nextVersionId: 2,
        autoV2: 'BBBBBBBBBB',
        autoV2Hashes: ['BBBBBBBBBB', 'AAAAAAAAAA'],
        versions: [
          { id: 2, autoV2: 'BBBBBBBBBB', autoV2Hashes: ['BBBBBBBBBB'] },
          { id: 1, autoV2: 'AAAAAAAAAA', autoV2Hashes: ['AAAAAAAAAA'] },
        ],
      }),
    ).toBe(false);
    expect(unarchive).not.toHaveBeenCalled();
    expect(archived.has(42)).toBe(true);
  });

  it('stays archived on bare versionId bumps without per-version hashes', async () => {
    const { maybeUnarchiveForNewVersion } = await import(
      './civitaiArchivePolicy.js'
    );
    archived.add(42);
    addLoraFile(checkpointIndex, 'v1.safetensors', '/checkpoints/v1.safetensors');
    checkpointIndex.byAutoV2 = new Map([
      ['AAAAAAAAAA', '/checkpoints/v1.safetensors'],
    ]);

    expect(
      maybeUnarchiveForNewVersion({
        modelId: 42,
        type: 'Checkpoint',
        previousVersionId: 1,
        nextVersionId: 2,
        autoV2: 'AAAAAAAAAA',
        autoV2Hashes: ['AAAAAAAAAA'],
        // Tip-check churn: versionId moved, no version snaps for id 2.
        versions: [{ id: 1, autoV2: 'AAAAAAAAAA', autoV2Hashes: ['AAAAAAAAAA'] }],
      }),
    ).toBe(false);
    expect(unarchive).not.toHaveBeenCalled();
    expect(archived.has(42)).toBe(true);
  });

  it('clears Maybe when a newer version appears and only an older AutoV2 is local', async () => {
    const { maybeUnarchiveForNewVersion } = await import(
      './civitaiArchivePolicy.js'
    );
    maybe.add(42);
    addLoraFile(checkpointIndex, 'v1.safetensors', '/checkpoints/v1.safetensors');
    checkpointIndex.byAutoV2 = new Map([
      ['AAAAAAAAAA', '/checkpoints/v1.safetensors'],
    ]);

    expect(
      maybeUnarchiveForNewVersion({
        modelId: 42,
        type: 'Checkpoint',
        previousVersionId: 1,
        nextVersionId: 2,
        autoV2Hashes: ['BBBBBBBBBB', 'AAAAAAAAAA'],
        versions: [
          { id: 2, autoV2: 'BBBBBBBBBB', autoV2Hashes: ['BBBBBBBBBB'] },
          { id: 1, autoV2: 'AAAAAAAAAA', autoV2Hashes: ['AAAAAAAAAA'] },
        ],
      }),
    ).toBe(true);
    expect(unmaybe).toHaveBeenCalledWith(42);
    expect(unarchive).not.toHaveBeenCalled();
    expect(maybe.has(42)).toBe(false);
  });

  it('stays shelved when there is no local download', async () => {
    const { maybeUnarchiveForNewVersion } = await import(
      './civitaiArchivePolicy.js'
    );
    archived.add(99);
    maybe.add(98);

    expect(
      maybeUnarchiveForNewVersion({
        modelId: 99,
        type: 'Checkpoint',
        previousVersionId: 1,
        nextVersionId: 2,
        autoV2: 'CCCCCCCCCC',
        autoV2Hashes: ['CCCCCCCCCC'],
        versions: [
          { id: 2, autoV2: 'CCCCCCCCCC', autoV2Hashes: ['CCCCCCCCCC'] },
        ],
      }),
    ).toBe(false);
    expect(
      maybeUnarchiveForNewVersion({
        modelId: 98,
        type: 'Checkpoint',
        previousVersionId: 1,
        nextVersionId: 2,
        autoV2Hashes: ['CCCCCCCCCC'],
        versions: [
          { id: 2, autoV2: 'CCCCCCCCCC', autoV2Hashes: ['CCCCCCCCCC'] },
        ],
      }),
    ).toBe(false);
    expect(unarchive).not.toHaveBeenCalled();
    expect(unmaybe).not.toHaveBeenCalled();
    expect(archived.has(99)).toBe(true);
    expect(maybe.has(98)).toBe(true);
  });

  it('does nothing when versionId is first learned or not newer', async () => {
    const { maybeUnarchiveForNewVersion } = await import(
      './civitaiArchivePolicy.js'
    );
    archived.add(7);
    addLoraFile(checkpointIndex, 'v1.safetensors', '/checkpoints/v1.safetensors');
    checkpointIndex.byAutoV2 = new Map([
      ['AAAAAAAAAA', '/checkpoints/v1.safetensors'],
    ]);

    expect(
      maybeUnarchiveForNewVersion({
        modelId: 7,
        type: 'Checkpoint',
        previousVersionId: null,
        nextVersionId: 2,
        autoV2Hashes: ['AAAAAAAAAA'],
        versions: [
          { id: 2, autoV2: 'AAAAAAAAAA', autoV2Hashes: ['AAAAAAAAAA'] },
        ],
      }),
    ).toBe(false);
    expect(
      maybeUnarchiveForNewVersion({
        modelId: 7,
        type: 'Checkpoint',
        previousVersionId: 2,
        nextVersionId: 2,
        autoV2Hashes: ['AAAAAAAAAA'],
        versions: [
          { id: 2, autoV2: 'AAAAAAAAAA', autoV2Hashes: ['AAAAAAAAAA'] },
        ],
      }),
    ).toBe(false);
    expect(unarchive).not.toHaveBeenCalled();
    expect(unmaybe).not.toHaveBeenCalled();
  });
});

describe('clearShelvesForNotifyUnlock', () => {
  beforeEach(() => {
    archived.clear();
    maybe.clear();
    unarchive.mockClear();
    unmaybe.mockClear();
  });

  it('clears Archive and Maybe for a Notify unlock', async () => {
    const { clearShelvesForNotifyUnlock } = await import(
      './civitaiArchivePolicy.js'
    );
    archived.add(11);
    maybe.add(11);
    expect(clearShelvesForNotifyUnlock(11)).toBe(true);
    expect(unarchive).toHaveBeenCalledWith(11);
    expect(unmaybe).toHaveBeenCalledWith(11);
    expect(archived.has(11)).toBe(false);
    expect(maybe.has(11)).toBe(false);
  });

  it('is a no-op when the model is not shelved', async () => {
    const { clearShelvesForNotifyUnlock } = await import(
      './civitaiArchivePolicy.js'
    );
    expect(clearShelvesForNotifyUnlock(12)).toBe(false);
    expect(unarchive).not.toHaveBeenCalled();
    expect(unmaybe).not.toHaveBeenCalled();
  });
});
