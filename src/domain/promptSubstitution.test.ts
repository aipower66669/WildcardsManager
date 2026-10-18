import { describe, expect, it } from 'vitest';
import {
  applyPromptSubstitutions,
  checkpointNameForSubstitution,
  normalizePromptSubstitutions,
} from './promptSubstitution.js';

const kroma = {
  modelContains: 'Kroma',
  find: '__loraname__',
  replace: '__loraname-KromaVersion__',
};

describe('checkpointNameForSubstitution', () => {
  it('uses the file name and drops the extension and folders', () => {
    expect(
      checkpointNameForSubstitution('Illustrious/kromaXL_v7.safetensors'),
    ).toBe('kromaXL_v7');
    expect(checkpointNameForSubstitution('kromaXL_v7')).toBe('kromaXL_v7');
  });
});

describe('applyPromptSubstitutions', () => {
  it('replaces the generic wildcard when the checkpoint name contains the keyword', () => {
    const prompt = 'portrait, __loraname__, smile';
    expect(
      applyPromptSubstitutions(
        prompt,
        'styles/KromaXL_v3.safetensors',
        [kroma],
      ),
    ).toBe('portrait, __loraname-KromaVersion__, smile');
  });

  it('matches the keyword case-insensitively and the prompt text exactly', () => {
    expect(
      applyPromptSubstitutions('__LoraName__', 'kroma.safetensors', [kroma]),
    ).toBe('__LoraName__');
    expect(
      applyPromptSubstitutions('__loraname__', 'KROMA.safetensors', [kroma]),
    ).toBe('__loraname-KromaVersion__');
  });

  it('leaves the prompt alone when the checkpoint name does not match', () => {
    expect(
      applyPromptSubstitutions(
        '__loraname__',
        'otherModel.safetensors',
        [kroma],
      ),
    ).toBe('__loraname__');
  });

  it('does not treat a parent folder as the model name', () => {
    expect(
      applyPromptSubstitutions(
        '__loraname__',
        'Kroma/plainModel.safetensors',
        [kroma],
      ),
    ).toBe('__loraname__');
  });

  it('replaces every occurrence and runs matching rules from top to bottom', () => {
    const rules = [
      kroma,
      {
        modelContains: 'kroma',
        find: '__loraname-KromaVersion__',
        replace: '__loraname-KromaFinal__',
      },
    ];
    expect(
      applyPromptSubstitutions(
        '__loraname__ and __loraname__',
        'kroma.safetensors',
        rules,
      ),
    ).toBe('__loraname-KromaFinal__ and __loraname-KromaFinal__');
  });

  it('skips rules for other models in the same list', () => {
    const rules = [
      kroma,
      {
        modelContains: 'Pony',
        find: '__loraname__',
        replace: '__loraname-Pony__',
      },
    ];
    expect(
      applyPromptSubstitutions('__loraname__', 'ponyXL.safetensors', rules),
    ).toBe('__loraname-Pony__');
  });
});

describe('normalizePromptSubstitutions', () => {
  it('keeps complete rules and drops blanks', () => {
    expect(
      normalizePromptSubstitutions([
        { modelContains: ' Kroma ', find: '__loraname__', replace: '__x__' },
        { modelContains: '', find: 'a', replace: 'b' },
        { modelContains: 'Pony', find: '', replace: 'b' },
        null,
        'nope',
      ]),
    ).toEqual([
      { modelContains: 'Kroma', find: '__loraname__', replace: '__x__' },
    ]);
  });

  it('returns an empty list for non-arrays', () => {
    expect(normalizePromptSubstitutions(undefined)).toEqual([]);
    expect(normalizePromptSubstitutions({ modelContains: 'A' })).toEqual([]);
  });
});
