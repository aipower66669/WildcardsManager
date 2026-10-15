import { describe, expect, it } from 'vitest';
import {
  dedupeDownloadPicks,
  dedupeFilesByName,
  fileSnapshotsFromModelVersions,
  formatVersionVariantLabel,
  hashesForVersionInstallMatch,
  hasNewerVersionUpdate,
  installFlagsForVersions,
  isLatestVersionLocallyInstalled,
  mergeVersionSnapshots,
  readFileSizeKB,
  snapshotsFromModelVersions,
  variantLabelFromFileName,
} from './civitaiVersions.js';

describe('variantLabelFromFileName', () => {
  it('extracts nf4 / fp8 tokens', () => {
    expect(variantLabelFromFileName('model_v2_nf4.safetensors', 'v2.0')).toBe(
      'nf4',
    );
    expect(
      variantLabelFromFileName('foo-fp8-e4m3.safetensors', 'v2.0'),
    ).toBe('fp8-e4m3');
  });
});

describe('snapshotsFromModelVersions', () => {
  it('keeps per-file variants under a version', () => {
    const snaps = snapshotsFromModelVersions([
      {
        id: 10,
        name: 'v2.0',
        files: [
          {
            id: 1,
            name: 'model_v2_nf4.safetensors',
            primary: true,
            hashes: { AutoV2: 'AAAAAAAAAA' },
          },
          {
            id: 2,
            name: 'model_v2_fp8.safetensors',
            hashes: { AutoV2: 'BBBBBBBBBB' },
          },
        ],
      },
    ]);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.files).toHaveLength(2);
    expect(snaps[0]?.files?.[0]?.variantLabel).toBe('nf4');
    expect(snaps[0]?.files?.[1]?.variantLabel).toBe('fp8');
  });
});

describe('fileSnapshotsFromModelVersions', () => {
  it('flattens version · variant rows', () => {
    const files = fileSnapshotsFromModelVersions([
      {
        id: 10,
        name: 'v2.0',
        files: [
          {
            id: 1,
            name: 'model_nf4.safetensors',
            primary: true,
            hashes: { AutoV2: 'AAAAAAAAAA' },
          },
          {
            id: 2,
            name: 'model_fp8.safetensors',
            hashes: { AutoV2: 'BBBBBBBBBB' },
          },
        ],
      },
    ]);
    expect(files).toHaveLength(2);
    expect(formatVersionVariantLabel(files[0]!)).toBe('v2.0 · nf4');
    expect(formatVersionVariantLabel(files[1]!)).toBe('v2.0 · fp8');
  });
});

describe('mergeVersionSnapshots', () => {
  it('prefers incoming order and unions hashes', () => {
    const merged = mergeVersionSnapshots(
      [
        {
          id: 2,
          name: 'old',
          autoV2Hashes: ['BBBBBBBBBB'],
        },
      ],
      [
        {
          id: 1,
          name: 'bf16',
          autoV2: 'AAAAAAAAAA',
          autoV2Hashes: ['AAAAAAAAAA'],
        },
        {
          id: 2,
          name: 'fp8',
          autoV2: 'BBBBBBBBBB',
          autoV2Hashes: ['BBBBBBBBBB', 'CCCCCCCCCC'],
        },
      ],
    );
    expect(merged?.map((v) => v.id)).toEqual([1, 2]);
    expect(merged?.[1]?.autoV2Hashes).toEqual(['BBBBBBBBBB', 'CCCCCCCCCC']);
    expect(merged?.[1]?.name).toBe('fp8');
  });

  it('merges same-name files even when only one side has an id', () => {
    const merged = mergeVersionSnapshots(
      [
        {
          id: 10,
          name: 'V5.0',
          autoV2Hashes: [],
          files: [{ name: 'moody_v50.safetensors', primary: true }],
        },
      ],
      [
        {
          id: 10,
          name: 'V5.0',
          autoV2Hashes: ['AAAAAAAAAA'],
          files: [
            {
              id: 99,
              name: 'moody_v50.safetensors',
              primary: true,
              autoV2: 'AAAAAAAAAA',
              sizeKB: 1024,
            },
          ],
        },
      ],
    );
    expect(merged?.[0]?.files).toHaveLength(1);
    expect(merged?.[0]?.files?.[0]?.id).toBe(99);
    expect(merged?.[0]?.files?.[0]?.sizeKB).toBe(1024);
  });
});

describe('dedupeFilesByName / dedupeDownloadPicks', () => {
  it('keeps one row per filename', () => {
    expect(
      dedupeFilesByName([
        { id: undefined, name: 'a.safetensors' },
        { id: 1, name: 'a.safetensors' },
        { id: 2, name: 'b.safetensors' },
      ]),
    ).toEqual([
      { id: 1, name: 'a.safetensors' },
      { id: 2, name: 'b.safetensors' },
    ]);
  });

  it('dedupes download picks by version + filename', () => {
    expect(
      dedupeDownloadPicks([
        {
          key: '10:1',
          versionId: 10,
          fileId: 1,
          fileName: 'v50.safetensors',
        },
        {
          key: '10:v50.safetensors',
          versionId: 10,
          fileId: 0,
          fileName: 'v50.safetensors',
        },
        {
          key: '10:2',
          versionId: 10,
          fileId: 2,
          fileName: 'v50BF16.safetensors',
        },
      ]),
    ).toHaveLength(2);
  });
});

describe('readFileSizeKB', () => {
  it('accepts sizeKB / sizeInKb / byte size', () => {
    expect(readFileSizeKB({ sizeKB: 2048 })).toBe(2048);
    expect(readFileSizeKB({ sizeInKb: 512 })).toBe(512);
    expect(readFileSizeKB({ size: 2 * 1024 * 1024 })).toBe(2048);
  });
});

describe('isLatestVersionLocallyInstalled', () => {
  it('is true when any file of the newest version is local', () => {
    expect(
      isLatestVersionLocallyInstalled([
        { versionId: 30, installed: false },
        { versionId: 30, installed: true },
        { versionId: 20, installed: false },
      ]),
    ).toBe(true);
  });

  it('is false when only older versions are local', () => {
    expect(
      isLatestVersionLocallyInstalled([
        { versionId: 30, installed: false },
        { versionId: 20, installed: true },
      ]),
    ).toBe(false);
  });

  it('uses max version id from the scoped list only', () => {
    // Library-filtered list: Krea (10) installed; global Flux (40) not present.
    expect(
      isLatestVersionLocallyInstalled([{ versionId: 10, installed: true }]),
    ).toBe(true);
    expect(
      isLatestVersionLocallyInstalled([
        { versionId: 10, installed: true },
        { versionId: 40, installed: false },
      ]),
    ).toBe(false);
  });
});

describe('hashesForVersionInstallMatch', () => {
  it('uses the full model hash bag only for single-version cards', () => {
    expect(
      hashesForVersionInstallMatch({
        fileHashes: [],
        versionCount: 1,
        isTipVersion: true,
        tipPrimaryAutoV2: 'AAAAAAAAAA',
        allModelAutoV2Hashes: ['AAAAAAAAAA', 'BBBBBBBBBB'],
      }),
    ).toEqual(['AAAAAAAAAA', 'BBBBBBBBBB']);
  });

  it('does not let an older version hash install the tip on multi-version cards', () => {
    expect(
      hashesForVersionInstallMatch({
        fileHashes: [],
        versionCount: 3,
        isTipVersion: true,
        tipPrimaryAutoV2: 'CCCCCCCCCC',
        allModelAutoV2Hashes: ['AAAAAAAAAA', 'BBBBBBBBBB', 'CCCCCCCCCC'],
      }),
    ).toEqual(['CCCCCCCCCC']);
  });

  it('keeps per-file hashes for non-tip versions and never falls back to the bag', () => {
    expect(
      hashesForVersionInstallMatch({
        fileHashes: ['BBBBBBBBBB'],
        versionCount: 3,
        isTipVersion: false,
        tipPrimaryAutoV2: 'CCCCCCCCCC',
        allModelAutoV2Hashes: ['AAAAAAAAAA', 'BBBBBBBBBB', 'CCCCCCCCCC'],
      }),
    ).toEqual(['BBBBBBBBBB']);
    expect(
      hashesForVersionInstallMatch({
        fileHashes: [],
        versionCount: 3,
        isTipVersion: false,
        tipPrimaryAutoV2: 'CCCCCCCCCC',
        allModelAutoV2Hashes: ['AAAAAAAAAA', 'BBBBBBBBBB', 'CCCCCCCCCC'],
      }),
    ).toBeNull();
  });
});

describe('hasNewerVersionUpdate', () => {
  it('is false when a sibling quant of the latest version is missing', () => {
    expect(
      hasNewerVersionUpdate([
        { versionId: 10, installed: true },
        { versionId: 10, installed: false },
      ]),
    ).toBe(false);
  });

  it('is true when an older version is local and a newer version is not', () => {
    expect(
      hasNewerVersionUpdate([
        { versionId: 30, installed: false },
        { versionId: 20, installed: true },
      ]),
    ).toBe(true);
  });

  it('is false when nothing is attributed to a version row', () => {
    // Card-level match with thin snaps — do not invent an “update”.
    expect(
      hasNewerVersionUpdate([
        { versionId: 10, installed: false },
      ]),
    ).toBe(false);
  });

  it('is false when the newer version is a different base model', () => {
    expect(
      hasNewerVersionUpdate([
        {
          versionId: 20,
          installed: true,
          baseModel: 'Krea 2',
          versionName: 'v1.0 Krea 2',
        },
        {
          versionId: 40,
          installed: false,
          baseModel: 'Krea 2',
          versionName: 'v1.0 Illustrious',
        },
      ]),
    ).toBe(false);
    expect(
      isLatestVersionLocallyInstalled([
        {
          versionId: 20,
          installed: true,
          baseModel: 'Krea 2',
          versionName: 'v1.0 Krea 2',
        },
        {
          versionId: 40,
          installed: false,
          baseModel: 'Illustrious',
          versionName: 'v1.0 Illustrious',
        },
      ]),
    ).toBe(true);
  });
});

describe('installFlagsForVersions', () => {
  it('is a plain downloaded card when Krea 2 is installed and Illustrious is still early access', () => {
    expect(
      installFlagsForVersions([
        {
          versionId: 20,
          installed: true,
          baseModel: 'Krea 2',
          versionName: 'v1.0 Krea 2',
          earlyAccess: true,
        },
        {
          versionId: 21,
          installed: true,
          baseModel: 'Krea 2',
          versionName: 'v1.0 Krea 2',
          earlyAccess: false,
        },
      ]),
    ).toEqual({
      latestVersionInstalled: true,
      updateAvailable: false,
      notifyEarlyAccess: false,
      hasDownloadableVersion: false,
    });
  });

  it('notifies only for an uninstalled early-access version of this base model', () => {
    expect(
      installFlagsForVersions([
        {
          versionId: 20,
          installed: false,
          baseModel: 'Krea 2',
          versionName: 'v1.0 Krea 2',
          earlyAccess: true,
        },
      ]).notifyEarlyAccess,
    ).toBe(true);
  });
});
