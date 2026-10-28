import { describe, expect, it, vi } from 'vitest';
import {
  pickFolderBySeed,
  pickGenerationPrompt,
  appendAdditionalPositive,
  promptsForFileExpand,
  randomFixedGenerationSeed,
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
  it('keeps a positive seed and rolls a new clock seed when the UI seed is random', () => {
    expect(resolveGenerationSeed(42)).toBe(42);
    const first = resolveGenerationSeed(-1);
    const second = resolveGenerationSeed(0);
    expect(first).not.toBe(-1);
    expect(second).not.toBe(first);
    expect(second).toBeGreaterThan(0);
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
    return pickGenerationPrompt({
      promptSource: 'folder',
      promptText: '',
      relativeFolder: 'portraits',
      recursive: false,
      seed: 7,
      listAllFolders: () => Object.keys(lines),
      listFoldersUnder: (folder) =>
        Object.keys(lines).filter(
          (key) => key === folder || key.startsWith(`${folder}/`),
        ),
      loadLines: (folder) => lines[folder] ?? [],
      ...overrides,
    });
  }

  it('sends the typed box as one prompt when Single prompt is on', () => {
    const picked = pick({
      promptSource: 'text',
      promptSingle: true,
      promptText: 'plain line\n[TESTING] debug line',
      relativeFolder: '',
    });
    expect(picked.line).toBe('plain line\n[TESTING] debug line');
    expect(picked.relativeFolder).toBe('_manual');
  });

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

  it('names the folder when !gen.txt has no usable prompts', () => {
    expect(() => pick({ relativeFolder: 'portraits/empty' })).toThrow(
      'portraits/empty/!gen.txt has no usable prompts',
    );
  });

  it('picks a folder under the selection when Recursive is on', () => {
    const first = pick({ recursive: true });
    const again = pick({ recursive: true });
    expect(first.relativeFolder === 'portraits' || first.relativeFolder === 'portraits/indoor').toBe(
      true,
    );
    expect(again).toEqual(first);
  });

  it('picks the folder from the seed alone, including after other seeds', () => {
    const folders = ['d', 'b', 'a', 'c'];
    const input = {
      promptSource: 'folder' as const,
      promptText: '',
      relativeFolder: '',
      recursive: false,
      listAllFolders: () => folders,
      listFoldersUnder: () => [],
      loadLines: (folder: string) => [`line ${folder}`],
    };
    const first = pickGenerationPrompt({ ...input, seed: 7 });
    pickGenerationPrompt({ ...input, seed: 99 });
    pickGenerationPrompt({ ...input, seed: 3 });
    expect(pickGenerationPrompt({ ...input, seed: 7 })).toEqual(first);
    expect(first.relativeFolder).toBe(pickFolderBySeed(folders, 7));
    expect(first.line).toBe(`line ${first.relativeFolder}`);
  });
});

describe('promptsForFileExpand', () => {
  it('keeps every decoded line and strips the testing tag', () => {
    expect(
      promptsForFileExpand('# note\n[TESTING] alpha\n\nbeta\n, more\n[x2] gamma'),
    ).toEqual(['alpha', 'beta, more', 'gamma', 'gamma']);
  });
});

describe('appendAdditionalPositive', () => {
  it('appends the additional field to a multi-line prompt', () => {
    expect(
      appendAdditionalPositive(
        'first paragraph\n\nsecond paragraph # note',
        '4k, ultra-detailed',
      ),
    ).toBe('first paragraph\n\nsecond paragraph # note, 4k, ultra-detailed');
  });

  it('keeps the prompt when the additional field is empty', () => {
    expect(appendAdditionalPositive('one prompt', '  ')).toBe('one prompt');
  });
});
