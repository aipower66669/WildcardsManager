import { describe, expect, it, vi } from 'vitest';
import { GenFolderDeck } from './genFolderDeck.js';
import { createMulberry32 } from './genPrompts.js';
import {
  pickGenerationPrompt,
  promptsForFileExpand,
  randomFixedGenerationSeed,
  reseedGenerationFolderDeck,
  resolveGenerationSeed,
} from './generationPromptPick.js';

describe('randomFixedGenerationSeed', () => {
  it('writes a positive seed that later runs keep', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const low = randomFixedGenerationSeed();
    expect(low).toBe(1);
    expect(resolveGenerationSeed(low)).toBe(low);
    spy.mockReturnValue(0.999999999);
    const high = randomFixedGenerationSeed();
    expect(high).toBeGreaterThan(1);
    expect(high).toBeLessThanOrEqual(0xffffffff);
    expect(resolveGenerationSeed(high)).toBe(high);
    spy.mockRestore();
  });
});

describe('resolveGenerationSeed', () => {
  it('keeps a positive seed and rolls when the UI seed is random', () => {
    expect(resolveGenerationSeed(42)).toBe(42);
    expect(resolveGenerationSeed(0)).toBeGreaterThanOrEqual(0);
    expect(resolveGenerationSeed(-1)).not.toBe(-1);
  });
});

describe('pickGenerationPrompt', () => {
  const lines: Record<string, string[]> = {
    portraits: ['from portraits', '[TESTING] forced'],
    'portraits/indoor': ['indoor line'],
    city: ['city line'],
  };

  function pick(
    overrides: Partial<Parameters<typeof pickGenerationPrompt>[0]> = {},
  ) {
    const deck = new GenFolderDeck();
    reseedGenerationFolderDeck(deck, 7);
    return pickGenerationPrompt({
      promptSource: 'folder',
      promptText: '',
      relativeFolder: 'portraits',
      recursive: false,
      seed: 7,
      deck,
      listAllFolders: () => Object.keys(lines),
      listFoldersUnder: (folder) =>
        Object.keys(lines).filter(
          (key) => key === folder || key.startsWith(`${folder}/`),
        ),
      loadLines: (folder) => lines[folder] ?? [],
      ...overrides,
    });
  }

  it('uses the typed prompt and prefers [TESTING]', () => {
    const picked = pick({
      promptSource: 'text',
      promptText: 'plain line\n[TESTING] debug line',
      relativeFolder: '',
    });
    expect(picked.line).toBe('debug line');
    expect(picked.relativeFolder).toBe('_manual');
  });

  it('expands the selected folder when Recursive is off', () => {
    expect(pick().line).toBe('forced');
    expect(pick().relativeFolder).toBe('portraits');
  });

  it('picks a folder under the selection when Recursive is on', () => {
    const first = pick({ recursive: true });
    const again = pick({ recursive: true });
    expect(first.relativeFolder === 'portraits' || first.relativeFolder === 'portraits/indoor').toBe(
      true,
    );
    expect(again).toEqual(first);
  });

  it('shuffles every prompt folder when none is selected', () => {
    const deck = new GenFolderDeck(createMulberry32(7));
    const picked = pickGenerationPrompt({
      promptSource: 'folder',
      promptText: '',
      relativeFolder: '',
      recursive: false,
      seed: 7,
      deck,
      listAllFolders: () => ['a', 'b', 'c'],
      listFoldersUnder: () => [],
      loadLines: () => ['only'],
    });
    const deck2 = new GenFolderDeck(createMulberry32(7));
    const again = deck2.next(() => ['a', 'b', 'c']);
    expect(picked.relativeFolder).toBe(again);
    expect(picked.line).toBe('only');
  });
});

describe('promptsForFileExpand', () => {
  it('keeps every decoded line and strips the testing tag', () => {
    expect(
      promptsForFileExpand('# note\n[TESTING] alpha\n\nbeta\n, more\n[x2] gamma'),
    ).toEqual(['alpha', 'beta, more', 'gamma', 'gamma']);
  });
});
