import { describe, expect, it } from 'vitest';
import { addLoraFile, type LoraIndex } from '../domain/lora.js';
import {
  findLocalInstallMatches,
  isModelInstalledInIndex,
} from './checkpointService.js';

function emptyIndex(): LoraIndex {
  return {
    root: '/loras',
    aliases: new Map(),
    files: [],
    fileCount: 0,
  };
}

describe('isModelInstalledInIndex', () => {
  it('matches when a non-primary autoV2Hashes entry is local', () => {
    const index = emptyIndex();
    addLoraFile(
      index,
      'Girls/Elayne.safetensors',
      '/loras/Girls/Elayne.safetensors',
    );
    index.byAutoV2 = new Map([
      ['0806E91728', '/loras/Girls/Elayne.safetensors'],
    ]);

    expect(
      isModelInstalledInIndex(
        index,
        'OtherPrimaryName.safetensors',
        { AutoV2: 'AAAAAAAAAA' },
        ['AAAAAAAAAA', '0806E91728'],
      ),
    ).toBe(true);
  });

  it('returns the matched relative path for AutoV2 hits', () => {
    const index = emptyIndex();
    addLoraFile(
      index,
      'Girls/Elayne.safetensors',
      '/loras/Girls/Elayne.safetensors',
    );
    index.byAutoV2 = new Map([
      ['0806E91728', '/loras/Girls/Elayne.safetensors'],
    ]);

    expect(
      findLocalInstallMatches(
        index,
        'OtherPrimaryName.safetensors',
        { AutoV2: 'AAAAAAAAAA' },
        ['AAAAAAAAAA', '0806E91728'],
      ),
    ).toEqual([
      {
        relativePath: 'Girls/Elayne.safetensors',
        absolutePath: '/loras/Girls/Elayne.safetensors',
        via: 'autoV2',
      },
    ]);
  });

  it('does not match when only an unrelated primary hash is provided', () => {
    const index = emptyIndex();
    index.byAutoV2 = new Map([
      ['0806E91728', '/loras/Girls/Elayne.safetensors'],
    ]);

    expect(
      isModelInstalledInIndex(index, 'Other.safetensors', {
        AutoV2: 'AAAAAAAAAA',
      }),
    ).toBe(false);
  });

  it('does not treat shared stems like V1 as installed', () => {
    const index = emptyIndex();
    addLoraFile(index, 'Other/V1.safetensors', '/loras/Other/V1.safetensors');

    expect(isModelInstalledInIndex(index, 'V1.safetensors')).toBe(false);
    expect(findLocalInstallMatches(index, 'V1.safetensors')).toEqual([]);
  });
});
