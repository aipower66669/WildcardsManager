/**
 * Resolve per-style Generation output roots from the active library.
 */

import path from 'node:path';
import {
  GENERATION_STYLE_PROFILE_LABELS,
  type GenerationStyleProfileIdDto,
} from '../../shared/contracts.js';
import { getComfyConnection } from './comfySettings.js';
import { getActiveLibrary } from '../settingsStore.js';

export function generationOutputFieldForProfile(
  profile: GenerationStyleProfileIdDto,
):
  | 'generationOutputRealistic'
  | 'generationOutputHentai'
  | 'generationOutput3d' {
  if (profile === 'hentai') return 'generationOutputHentai';
  if (profile === '3d') return 'generationOutput3d';
  return 'generationOutputRealistic';
}

/**
 * Absolute output root for a style.
 * Folder mode → `{root}/{promptRelative}/New`; typed prompt → `{root}`.
 * Realistic falls back to prompts folder, then legacy Comfy generation folder.
 */
export function resolveGenerationOutputRoot(
  profile: GenerationStyleProfileIdDto,
): string {
  const lib = getActiveLibrary();
  const field = generationOutputFieldForProfile(profile);
  const configured = lib[field]?.trim();
  if (configured) return path.resolve(configured);

  if (profile === 'realistic') {
    const prompts = lib.promptsFolder?.trim();
    if (prompts) return path.resolve(prompts);
    const legacy = getComfyConnection().generationFolder?.trim();
    if (legacy) return path.resolve(legacy);
  }

  const label = GENERATION_STYLE_PROFILE_LABELS[profile];
  throw new Error(
    `Set Generation output (${label}) in Library Manager before generating with this style`,
  );
}
