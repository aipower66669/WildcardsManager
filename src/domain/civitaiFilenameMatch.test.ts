import { describe, expect, it } from 'vitest';
import {
  findCatalogMatchesByLocalFilename,
  localStemMatchKeys,
} from './civitaiFilenameMatch.js';

describe('localStemMatchKeys', () => {
  it('includes series base for training-step names', () => {
    const keys = localStemMatchKeys('Melly_000001000.safetensors');
    expect(keys).toContain('melly');
    expect(keys.some((k) => k.replace(/\s+/g, '').includes('000001000'))).toBe(
      true,
    );
  });
});

describe('findCatalogMatchesByLocalFilename', () => {
  const models = [
    {
      id: 1,
      name: 'Melly Character',
      pageUrl: 'https://civitai.com/models/1/melly',
      type: 'LORA',
      fileName: 'Melly.safetensors',
    },
    {
      id: 2,
      name: 'Other',
      pageUrl: 'https://civitai.com/models/2/other',
      type: 'LORA',
      fileName: 'totally_different.safetensors',
    },
    {
      id: 3,
      name: 'Melly Character',
      pageUrl: 'https://civitai.com/models/3/melly-v2',
      type: 'LORA',
      versions: [
        {
          files: [{ name: 'Melly_v2.safetensors' }],
        },
      ],
    },
  ];

  it('matches local step checkpoint to catalog Melly.safetensors', () => {
    const hits = findCatalogMatchesByLocalFilename(
      models,
      '!Testing/Melly_000001000.safetensors',
      { type: 'LORA' },
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.modelId).toBe(1);
    expect(hits[0]?.matchKind).toBe('exact');
  });

  it('does not return unrelated filenames', () => {
    const hits = findCatalogMatchesByLocalFilename(models, 'zzz_unique_name', {
      type: 'LORA',
    });
    expect(hits).toEqual([]);
  });
});
