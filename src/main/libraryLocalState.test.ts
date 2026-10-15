import { describe, expect, it } from 'vitest';
import {
  LIBRARY_LOCAL_VERSION,
  protectLibraryListsFromEmptyClobber,
  type LibraryLocalPayload,
} from './libraryLocalState.js';

function basePayload(
  patch: Partial<LibraryLocalPayload> = {},
): LibraryLocalPayload {
  return {
    version: LIBRARY_LOCAL_VERSION,
    ignoredUnusedLoras: [],
    archivedCivitaiModels: [],
    maybeCivitaiModels: [],
    markedInstalledCivitaiModels: [],
    markedInstalledCivitaiVersions: [],
    civitaiWatchlist: [],
    enabledArchitectures: [],
    enabledSdxlFamilies: [],
    enabledCivitaiCategories: [],
    validationPlatform: 'comfyui',
    civitaiOrigin: 'https://civitai.com',
    ...patch,
  };
}

describe('protectLibraryListsFromEmptyClobber', () => {
  it('blocks catastrophic wipe when all incoming lists are empty', () => {
    const existing = basePayload({
      archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 1 }],
      maybeCivitaiModels: [{ origin: 'https://civitai.com', modelId: 2 }],
      civitaiWatchlist: [
        {
          origin: 'https://civitai.com',
          modelId: 3,
          modelName: 'x',
          type: 'LORA',
          available: false,
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const incoming = basePayload({ lastRootFile: 'keep-me.txt' });
    const next = protectLibraryListsFromEmptyClobber(incoming, existing);
    expect(next.lastRootFile).toBe('keep-me.txt');
    expect(next.archivedCivitaiModels).toEqual(existing.archivedCivitaiModels);
    expect(next.maybeCivitaiModels).toEqual(existing.maybeCivitaiModels);
    expect(next.civitaiWatchlist).toEqual(existing.civitaiWatchlist);
  });

  it('allows clearing the last item of a single list while others remain', () => {
    const existing = basePayload({
      archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 1 }],
      maybeCivitaiModels: [{ origin: 'https://civitai.com', modelId: 2 }],
    });
    const incoming = basePayload({
      archivedCivitaiModels: [],
      maybeCivitaiModels: [{ origin: 'https://civitai.com', modelId: 2 }],
    });
    const next = protectLibraryListsFromEmptyClobber(incoming, existing);
    expect(next.archivedCivitaiModels).toEqual([]);
    expect(next.maybeCivitaiModels).toEqual(existing.maybeCivitaiModels);
  });

  it('blocks wiping a multi-item list to empty while others remain', () => {
    const existing = basePayload({
      archivedCivitaiModels: [
        { origin: 'https://civitai.com', modelId: 1 },
        { origin: 'https://civitai.com', modelId: 3 },
      ],
      maybeCivitaiModels: [{ origin: 'https://civitai.com', modelId: 2 }],
      civitaiWatchlist: [
        {
          origin: 'https://civitai.com',
          modelId: 9,
          modelName: 'notify',
          type: 'LORA',
          available: false,
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const incoming = basePayload({
      archivedCivitaiModels: [],
      maybeCivitaiModels: [{ origin: 'https://civitai.com', modelId: 2 }],
      civitaiWatchlist: existing.civitaiWatchlist,
    });
    const next = protectLibraryListsFromEmptyClobber(incoming, existing);
    expect(next.archivedCivitaiModels).toEqual(existing.archivedCivitaiModels);
    expect(next.maybeCivitaiModels).toEqual(existing.maybeCivitaiModels);
    expect(next.civitaiWatchlist).toEqual(existing.civitaiWatchlist);
  });

  it('allows intentional empty via allowEmptyMembershipLists', () => {
    const existing = basePayload({
      archivedCivitaiModels: [
        { origin: 'https://civitai.com', modelId: 1 },
        { origin: 'https://civitai.com', modelId: 3 },
      ],
    });
    const incoming = basePayload({ archivedCivitaiModels: [] });
    const next = protectLibraryListsFromEmptyClobber(incoming, existing, {
      allowEmptyMembershipLists: true,
    });
    expect(next.archivedCivitaiModels).toEqual([]);
  });

  it('allows intentional non-empty updates', () => {
    const existing = basePayload({
      archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 1 }],
    });
    const incoming = basePayload({
      archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 9 }],
    });
    const next = protectLibraryListsFromEmptyClobber(incoming, existing);
    expect(next.archivedCivitaiModels).toEqual([
      { origin: 'https://civitai.com', modelId: 9 },
    ]);
  });

  it('blocks wiping categories even when membership lists remain', () => {
    const existing = basePayload({
      archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 1 }],
      loraDownloadCategories: [
        {
          id: 'c1',
          name: 'Style',
          folder: 'Style',
          wildcardRelativePath: 'styles.txt',
          defaultWeights: '{0.8|0.9|1|1}',
        },
      ],
    });
    const incoming = basePayload({
      archivedCivitaiModels: [{ origin: 'https://civitai.com', modelId: 1 }],
      loraDownloadCategories: [],
    });
    const next = protectLibraryListsFromEmptyClobber(incoming, existing);
    expect(next.loraDownloadCategories).toEqual(existing.loraDownloadCategories);
  });
});
