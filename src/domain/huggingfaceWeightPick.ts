import { proposeDownloadSaveFileName } from './civitaiDownloadFileName.js';

/**
 * Pick which Hub weight file to download, and the catalog name to save it as.
 * Trainer repos often list `optimizer.bin` before `pytorch_lora_weights.safetensors`.
 * A `.safetensors` file wins over `.bin`. The saved name is the repo id with
 * `/` replaced by `-`, plus that file's extension.
 */

export type HfWeightCandidate = {
  path: string;
  size?: number | null;
};

const EXT_RANK: Record<string, number> = {
  safetensors: 0,
  ckpt: 1,
  pt: 2,
  pth: 3,
  gguf: 4,
  bin: 5,
};

const PREFERRED_STEMS = [
  'pytorch_lora_weights',
  'adapter_model',
  'diffusion_pytorch_model',
  'model',
  'pytorch_model',
];

const JUNK_STEM =
  /^(optimizer|scheduler|rng_state|scaler|training_args|zero_to_fp32)(\.|$)/i;

function baseName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function extension(filePath: string): string {
  const name = baseName(filePath);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isCheckpointSnapshot(filePath: string): boolean {
  return filePath
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => /^checkpoint-\d+$/i.test(segment));
}

function stemRank(filePath: string): number {
  const stem = baseName(filePath).replace(/\.[^.]+$/, '').toLowerCase();
  const index = PREFERRED_STEMS.indexOf(stem);
  return index === -1 ? PREFERRED_STEMS.length : index;
}

export function compareHfWeightFiles(
  a: HfWeightCandidate,
  b: HfWeightCandidate,
): number {
  const extDelta =
    (EXT_RANK[extension(a.path)] ?? 9) - (EXT_RANK[extension(b.path)] ?? 9);
  if (extDelta !== 0) return extDelta;

  const junkDelta =
    (JUNK_STEM.test(baseName(a.path)) ? 1 : 0) -
    (JUNK_STEM.test(baseName(b.path)) ? 1 : 0);
  if (junkDelta !== 0) return junkDelta;

  const snapshotDelta =
    (isCheckpointSnapshot(a.path) ? 1 : 0) -
    (isCheckpointSnapshot(b.path) ? 1 : 0);
  if (snapshotDelta !== 0) return snapshotDelta;

  const depthDelta =
    a.path.replace(/\\/g, '/').split('/').length -
    b.path.replace(/\\/g, '/').split('/').length;
  if (depthDelta !== 0) return depthDelta;

  const nameDelta = stemRank(a.path) - stemRank(b.path);
  if (nameDelta !== 0) return nameDelta;

  const sizeDelta = (b.size ?? 0) - (a.size ?? 0);
  if (sizeDelta !== 0) return sizeDelta;

  return a.path.localeCompare(b.path);
}

export function pickPreferredHfWeight<T extends HfWeightCandidate>(
  files: readonly T[],
): T | null {
  if (files.length === 0) return null;
  return [...files].sort(compareHfWeightFiles)[0] ?? null;
}

/**
 * `org/name` + `pytorch_lora_weights.safetensors`
 * → `org-name.safetensors`.
 */
export function hfRepoSaveFileName(repoId: string, sourcePath: string): string {
  const ext = extension(sourcePath);
  const suffix =
    ext === 'safetensors' ||
    ext === 'ckpt' ||
    ext === 'pt' ||
    ext === 'pth' ||
    ext === 'bin' ||
    ext === 'gguf'
      ? `.${ext}`
      : '.safetensors';
  const stem = repoId
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/[/\\]+/g, '-')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/\.+$/g, '')
    .trim();
  const raw = `${stem || 'model'}${suffix}`;
  if (/\.(safetensors|ckpt|pt)$/i.test(raw)) {
    return proposeDownloadSaveFileName(raw, `model${suffix}`);
  }
  return raw;
}
