import path from 'node:path';
import { MODEL_WEIGHT_EXTENSIONS } from './lora.js';

/**
 * Sidecar / preview names we never index. Matched by `path.extname` only
 * (`foo.preview.png` → `.png`).
 */
export const MODEL_SIDECAR_SKIP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.avif',
  '.svg',
  '.txt',
  '.json',
  '.md',
  '.html',
  '.htm',
  '.csv',
  '.log',
  '.mp4',
  '.webm',
  '.mov',
  '.mkv',
  '.nfo',
  '.info',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
]);

const DEFAULT_WEIGHT_EXTS = new Set<string>(MODEL_WEIGHT_EXTENSIONS);

export type ModelWalkNameKind = 'weight' | 'skip' | 'probe';

/**
 * Classify a directory entry by name only — no stat.
 * `weight` = emit as a model file; `skip` = ignore; `probe` = might be a folder.
 */
export function classifyModelWalkName(
  name: string,
  weightExtensions: ReadonlySet<string> = DEFAULT_WEIGHT_EXTS,
): ModelWalkNameKind {
  if (!name || name.startsWith('.')) return 'skip';
  const ext = path.extname(name).toLowerCase();
  if (weightExtensions.has(ext)) return 'weight';
  if (ext && MODEL_SIDECAR_SKIP_EXTENSIONS.has(ext)) return 'skip';
  // No ext, or unknown (folder names like `v1.0`) — stat only these.
  return 'probe';
}

export function defaultWeightExtensionSet(): Set<string> {
  return new Set(MODEL_WEIGHT_EXTENSIONS);
}
