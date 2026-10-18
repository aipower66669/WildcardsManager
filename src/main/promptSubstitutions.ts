/**
 * Active-library prompt substitutions (`promptSubstitutions` in that
 * library’s `library.json`).
 */

import {
  applyPromptSubstitutions,
  normalizePromptSubstitutions,
  type PromptSubstitution,
} from '../domain/promptSubstitution.js';
import { getActiveLibrary, patchActiveLibrary } from './settingsStore.js';

export function getPromptSubstitutions(): PromptSubstitution[] {
  return normalizePromptSubstitutions(getActiveLibrary().promptSubstitutions);
}

export function setPromptSubstitutions(raw: unknown): PromptSubstitution[] {
  const rules = normalizePromptSubstitutions(raw);
  patchActiveLibrary({ promptSubstitutions: rules }, { flushImmediate: true });
  return rules;
}

/** Substitute the selected prompt for the checkpoint about to be queued. */
export function applyLibraryPromptSubstitutions(
  prompt: string,
  checkpointRelativePath: string,
): string {
  return applyPromptSubstitutions(
    prompt,
    checkpointRelativePath,
    getPromptSubstitutions(),
  );
}
