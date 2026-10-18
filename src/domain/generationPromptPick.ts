/**
 * Choose the prompt line Generation's Once button would queue, and turn a
 * `!gen.txt` body into the lines Expand should sample.
 */

import { GenFolderDeck } from './genFolderDeck.js';
import {
  chooseGenPrompt,
  createMulberry32,
  decodeGenPrompts,
  pickGenPrompt,
  stripTestingGenTag,
} from './genPrompts.js';

/**
 * One random seed that stays fixed in the Generation field.
 * 0 and below mean “roll a new seed on every run”, so this is always ≥ 1.
 */
export function randomFixedGenerationSeed(): number {
  return (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0;
}

/** UI seed → job seed. ≤0 (and non-finite) means a fresh random seed. */
export function resolveGenerationSeed(uiSeed: unknown): number {
  const n = typeof uiSeed === 'number' ? uiSeed : Number(uiSeed);
  if (!Number.isFinite(n) || n <= 0) {
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }
  return Math.floor(n) >>> 0;
}

/**
 * Fixed seed → deterministic folder shuffle. Seed ≤ 0 keeps `Math.random`
 * so a later Once still varies. Does not itself roll the job seed.
 */
export function reseedGenerationFolderDeck(
  deck: GenFolderDeck,
  uiSeed: unknown,
): void {
  const n = typeof uiSeed === 'number' ? uiSeed : Number(uiSeed);
  if (Number.isFinite(n) && n > 0) {
    deck.reseed(createMulberry32(Math.floor(n) >>> 0));
  } else {
    deck.reseed(Math.random);
  }
}

export type GenerationPromptPick = {
  /** Prompt body with `[TESTING]` removed. */
  line: string;
  /** Prompts-folder relative path, or `_manual` for a typed prompt. */
  relativeFolder: string;
};

/**
 * Same folder and line selection as a single Generation job.
 * `deck` must already be reseeded for this run.
 */
export function pickGenerationPrompt(input: {
  promptSource: 'text' | 'folder';
  promptText: string;
  relativeFolder: string;
  recursive: boolean;
  seed: number;
  deck: GenFolderDeck;
  listAllFolders: () => string[];
  listFoldersUnder: (folder: string) => string[];
  loadLines: (folder: string) => string[];
}): GenerationPromptPick {
  if (input.promptSource === 'text') {
    let line: string;
    try {
      line = chooseGenPrompt(input.promptText, input.seed);
    } catch {
      throw new Error('Enter a prompt');
    }
    const folder = input.relativeFolder.trim();
    return { line, relativeFolder: folder || '_manual' };
  }

  let folder = input.relativeFolder.trim();
  if (!folder) {
    const choices = input.listAllFolders();
    if (choices.length === 0) {
      throw new Error('No prompt folders with !gen.txt to randomize');
    }
    folder = input.deck.next(() => choices);
  } else if (input.recursive) {
    const parent = folder;
    const choices = input.listFoldersUnder(parent);
    if (choices.length === 0) {
      throw new Error(
        `No !gen.txt under “${parent}” (enable Recursive only when this folder or a sub-folder has prompts)`,
      );
    }
    folder = input.deck.next(() => choices);
  }
  return {
    line: pickGenPrompt(input.loadLines(folder), input.seed),
    relativeFolder: folder,
  };
}

/**
 * Decoded `!gen.txt` lines for Expand. Weight copies stay so random picks
 * match Generation. `[TESTING]` is stripped so every line can expand; Once
 * still prefers that line when it picks.
 */
export function promptsForFileExpand(content: string): string[] {
  return decodeGenPrompts(content)
    .map((line) => stripTestingGenTag(line).trim())
    .filter((line) => line.length > 0);
}
