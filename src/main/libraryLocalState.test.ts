import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WCM_DIR } from '../domain/librarySidecarPaths.js';
import {
  LIBRARY_LOCAL_VERSION,
  protectLibraryListsFromEmptyClobber,
  readLibraryLocalPayload,
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

describe('readLibraryLocalPayload', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps sibling-only fields when the legacy file has more membership rows', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-lib-'));
    temps.push(parent);
    const root = path.join(parent, 'wildcards');
    fs.mkdirSync(root, { recursive: true });
    const rules = [
      { modelContains: 'Kroma', find: '__loraname__', replace: '__loraname-KromaVersion__' },
    ];
    fs.mkdirSync(path.join(parent, 'wildcards.wcm'), { recursive: true });
    fs.writeFileSync(
      path.join(parent, 'wildcards.wcm', 'library.json'),
      `${JSON.stringify({
        version: 1,
        promptSubstitutions: rules,
        archivedCivitaiModels: [],
      })}\n`,
    );
    fs.mkdirSync(path.join(root, WCM_DIR), { recursive: true });
    fs.writeFileSync(
      path.join(root, WCM_DIR, 'library.json'),
      `${JSON.stringify({
        version: 1,
        archivedCivitaiModels: [
          { origin: 'https://civitai.com', modelId: 1 },
          { origin: 'https://civitai.com', modelId: 2 },
        ],
        ignoredCheckpoints: ['old.safetensors'],
      })}\n`,
    );

    const payload = readLibraryLocalPayload(root);
    expect(payload?.promptSubstitutions).toEqual(rules);
    expect(payload?.archivedCivitaiModels).toHaveLength(2);
    expect(payload?.ignoredCheckpoints).toEqual(['old.safetensors']);
  });
});
