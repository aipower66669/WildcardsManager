/**
 * Choose the prompt line Generation's Once button would queue, and turn a
 * `!gen.txt` body into the lines Expand should sample.
 */

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

/** Advances on every random roll so two jobs in the same millisecond differ. */
let nextRandomSeedTick = 0;

/**
 * UI seed → job seed. ≤0 (and non-finite) means a fresh seed from the clock.
 * A fixed seed (≥ 1) is kept.
 */
export function resolveGenerationSeed(uiSeed: unknown): number {
  const n = typeof uiSeed === 'number' ? uiSeed : Number(uiSeed);
  if (!Number.isFinite(n) || n <= 0) {
    nextRandomSeedTick = (nextRandomSeedTick + 1) >>> 0;
    return (Date.now() + nextRandomSeedTick) >>> 0;
  }
  return Math.floor(n) >>> 0;
}

/** One folder from `folders`, chosen only from `seed`. Same seed → same folder. */
export function pickFolderBySeed(folders: readonly string[], seed: number): string {
  const ordered = folders.slice().sort();
  const rng = createMulberry32(seed >>> 0);
  return ordered[Math.floor(rng() * ordered.length)]!;
}

export type GenerationPromptPick = {
  /** Prompt body with `[TESTING]` removed. */
  line: string;
  /** Prompts-folder relative path, or `_manual` for a typed prompt. */
  relativeFolder: string;
};

/**
 * Same folder and line selection as one Generation job.
 * Randomize and Recursive each draw one folder from `seed`. Nothing is
 * remembered from the previous image.
 */
export function pickGenerationPrompt(input: {
  promptSource: 'text' | 'folder';
  /**
   * Use this prompt only. True sends the box as one prompt.
   * False decodes it like a `!gen.txt` file.
   */
  promptSingle?: boolean;
  promptText: string;
  relativeFolder: string;
  recursive: boolean;
  seed: number;
  listAllFolders: () => string[];
  listFoldersUnder: (folder: string) => string[];
  loadLines: (folder: string) => string[];
}): GenerationPromptPick {
  if (input.promptSource === 'text') {
    let line: string;
    if (input.promptSingle) {
      line = input.promptText.trim();
      if (!line) throw new Error('Enter a prompt');
    } else {
      try {
        line = chooseGenPrompt(input.promptText, input.seed);
      } catch {
        throw new Error('Enter a prompt');
      }
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
    folder = pickFolderBySeed(choices, input.seed);
  } else if (input.recursive) {
    const parent = folder;
    const choices = input.listFoldersUnder(parent);
    if (choices.length === 0) {
      throw new Error(
        `No !gen.txt under “${parent}” (enable Recursive only when this folder or a sub-folder has prompts)`,
      );
    }
    folder = pickFolderBySeed(choices, input.seed);
  }
  let line: string;
  try {
    line = pickGenPrompt(input.loadLines(folder), input.seed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('!gen.txt')) {
      throw new Error(`${folder}/${message}`);
    }
    throw error;
  }
  return { line, relativeFolder: folder };
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

/** Additional Positive is part of the one prompt that is about to be queued. */
export function appendAdditionalPositive(
  prompt: string,
  additional: string,
): string {
  const body = prompt.trim();
  const extra = additional.trim();
  if (!body) return extra;
  if (!extra) return body;
  return `${body}, ${extra}`;
}
