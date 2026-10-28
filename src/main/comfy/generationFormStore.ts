/**
 * Persist Generation tab form fields across reload / app restart.
 */

import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractGenerationPromptsFromImage,
  type GenerationImagePrompts,
} from '../../domain/generationImagePrompt.js';
import {
  clearGenerationPreviewFile,
  generationPreviewUrlForFile,
} from './generationPreview.js';
import {
  GENERATION_STYLE_PROFILE_IDS,
  type GenerationFormLoadedDto,
  type GenerationFormStateDto,
  type GenerationModeDto,
  type GenerationStartRequestDto,
  type GenerationStyleProfileDto,
  type GenerationStyleProfileIdDto,
} from '../../shared/contracts.js';

/** Leftover from when each preview was copied into app data. Never written again. */
const LEGACY_PREVIEW_FILENAME = 'generation-last-preview.png';

const PROFILE_IDS: GenerationStyleProfileIdDto[] = [
  ...GENERATION_STYLE_PROFILE_IDS,
];

function emptyStyleProfile(): GenerationStyleProfileDto {
  return {
    relativeFolder: null,
    promptFoldersRecursive: false,
    checkpoint: '',
    clip: '',
    vae: '',
    seed: -1,
    width: 1024,
    height: 1024,
    steps: 20,
    cfg: 7,
    samplerName: '',
    scheduler: '',
    denoise: 1,
    upscaler: '',
    upscaleFactor: 1.5,
    hiresDenoise: 0.5,
    clipSkip: 2,
    additionalPositivePrompt: '',
    negativePrompt: '',
    promptText: '',
    promptSource: 'folder',
    promptSingle: false,
  };
}

const DEFAULT_FORM: GenerationFormStateDto = {
  activeProfile: 'realistic',
  profiles: {
    realistic: emptyStyleProfile(),
    hentai: emptyStyleProfile(),
    '3d': emptyStyleProfile(),
  },
  relativeFolder: null,
  promptFoldersRecursive: false,
  checkpoint: '',
  clip: '',
  vae: '',
  seed: -1,
  width: 1024,
  height: 1024,
  steps: 20,
  cfg: 7,
  samplerName: '',
  scheduler: '',
  denoise: 1,
  upscaler: '',
  upscaleFactor: 1.5,
  hiresDenoise: 0.5,
  clipSkip: 2,
  additionalPositivePrompt: '',
  negativePrompt: '',
  promptText: '',
  promptSource: 'folder',
  promptSingle: false,
  benchmark: false,
};

function formPath(): string {
  return path.join(app.getPath('userData'), 'generation-form.json');
}

type GenerationFormLibraryScope = {
  activeId: string;
  allIds: string[];
};

let resolveGenerationFormLibraries = (): GenerationFormLibraryScope => ({
  activeId: 'local',
  allIds: ['local'],
});

/** Main process supplies the real library ids. Tests keep the local default. */
export function setGenerationFormLibraryResolver(
  fn: () => GenerationFormLibraryScope,
): void {
  resolveGenerationFormLibraries = fn;
}

function libraryScope(): GenerationFormLibraryScope {
  try {
    const next = resolveGenerationFormLibraries();
    const activeId = next.activeId.trim() || 'local';
    const allIds = [
      ...new Set(
        next.allIds.map((id) => id.trim()).filter((id) => id.length > 0),
      ),
    ];
    if (!allIds.includes(activeId)) allIds.push(activeId);
    return { activeId, allIds };
  } catch {
    return { activeId: 'local', allIds: ['local'] };
  }
}

function emptyForm(): GenerationFormStateDto {
  return withActiveProfile({
    activeProfile: DEFAULT_FORM.activeProfile,
    profiles: {
      realistic: { ...DEFAULT_FORM.profiles.realistic },
      hentai: { ...DEFAULT_FORM.profiles.hentai },
      '3d': { ...DEFAULT_FORM.profiles['3d'] },
    },
    benchmark: false,
  });
}

function legacyPreviewPath(): string {
  return path.join(app.getPath('userData'), LEGACY_PREVIEW_FILENAME);
}

/** Drop the old app-data image copy so that folder cannot fill up with previews. */
export function discardLegacyGenerationPreview(): void {
  fs.rmSync(legacyPreviewPath(), { force: true });
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n = asFiniteNumber(value, fallback);
  return Math.max(1, Math.round(n));
}

function asCfg(value: unknown, fallback: number): number {
  const n = asFiniteNumber(value, fallback);
  return Math.min(100, Math.max(0, n));
}

function asDenoise(value: unknown, fallback: number): number {
  const n = asFiniteNumber(value, fallback);
  return Math.min(1, Math.max(0, n));
}

function asClipSkip(value: unknown, fallback: number): number {
  const n = asFiniteNumber(value, fallback);
  return Math.min(12, Math.max(1, Math.round(n)));
}

function asUpscaleFactor(value: unknown, fallback: number): number {
  const n = asFiniteNumber(value, fallback);
  const clamped = Math.min(4, Math.max(1, n));
  return Math.round(clamped * 10) / 10;
}

function asProfileId(value: unknown): GenerationStyleProfileIdDto | null {
  return value === 'realistic' || value === 'hentai' || value === '3d'
    ? value
    : null;
}

function readStyleProfile(
  value: unknown,
  fallback: GenerationStyleProfileDto,
): GenerationStyleProfileDto {
  if (!value || typeof value !== 'object') return { ...fallback };
  const row = value as Record<string, unknown>;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(row, key);
  const folder = has('relativeFolder')
    ? typeof row.relativeFolder === 'string' && row.relativeFolder.trim()
      ? row.relativeFolder.trim().replaceAll('\\', '/')
      : null
    : fallback.relativeFolder;
  return {
    relativeFolder: folder,
    promptFoldersRecursive: has('promptFoldersRecursive')
      ? row.promptFoldersRecursive === true
      : fallback.promptFoldersRecursive,
    checkpoint: has('checkpoint')
      ? asString(row.checkpoint)
      : fallback.checkpoint,
    clip: has('clip') ? asString(row.clip) : fallback.clip,
    vae: has('vae') ? asString(row.vae) : fallback.vae,
    seed: has('seed')
      ? Math.round(asFiniteNumber(row.seed, fallback.seed))
      : fallback.seed,
    width: has('width')
      ? asPositiveInt(row.width, fallback.width)
      : fallback.width,
    height: has('height')
      ? asPositiveInt(row.height, fallback.height)
      : fallback.height,
    steps: has('steps')
      ? asPositiveInt(row.steps, fallback.steps)
      : fallback.steps,
    cfg: has('cfg') ? asCfg(row.cfg, fallback.cfg) : fallback.cfg,
    samplerName: has('samplerName')
      ? asString(row.samplerName)
      : fallback.samplerName,
    scheduler: has('scheduler')
      ? asString(row.scheduler)
      : fallback.scheduler,
    denoise: has('denoise')
      ? asDenoise(row.denoise, fallback.denoise)
      : fallback.denoise,
    upscaler: has('upscaler') ? asString(row.upscaler) : fallback.upscaler,
    upscaleFactor: has('upscaleFactor')
      ? asUpscaleFactor(row.upscaleFactor, fallback.upscaleFactor)
      : fallback.upscaleFactor,
    hiresDenoise: has('hiresDenoise')
      ? asDenoise(row.hiresDenoise, fallback.hiresDenoise)
      : fallback.hiresDenoise,
    clipSkip: has('clipSkip')
      ? asClipSkip(row.clipSkip, fallback.clipSkip)
      : fallback.clipSkip,
    additionalPositivePrompt: has('additionalPositivePrompt')
      ? asString(row.additionalPositivePrompt)
      : fallback.additionalPositivePrompt,
    negativePrompt: has('negativePrompt')
      ? asString(row.negativePrompt)
      : fallback.negativePrompt,
    promptText: has('promptText')
      ? asString(row.promptText)
      : fallback.promptText,
    promptSource: has('promptSource')
      ? row.promptSource === 'text'
        ? 'text'
        : 'folder'
      : fallback.promptSource,
    promptSingle: has('promptSingle')
      ? row.promptSingle === true
      : fallback.promptSingle,
  };
}

function sharedStyleFromRaw(
  raw: Record<string, unknown>,
): GenerationStyleProfileDto {
  const folder =
    typeof raw.relativeFolder === 'string' && raw.relativeFolder.trim()
      ? raw.relativeFolder.trim().replaceAll('\\', '/')
      : null;
  return readStyleProfile(
    {
      ...raw,
      relativeFolder: folder,
    },
    emptyStyleProfile(),
  );
}

/**
 * Older saves stored one form. That form is Realistic. Hentai starts empty.
 * A profile that predates per-field storage keeps the shared values only on
 * the profile that was active.
 */
function profilesFromRaw(raw: Record<string, unknown>): {
  activeProfile: GenerationStyleProfileIdDto;
  profiles: GenerationFormStateDto['profiles'];
} {
  const shared = sharedStyleFromRaw(raw);
  const bag =
    raw.profiles && typeof raw.profiles === 'object'
      ? (raw.profiles as Record<string, unknown>)
      : null;
  if (bag && (bag.realistic || bag.hentai || bag['3d'])) {
    const active = asProfileId(raw.activeProfile) ?? 'realistic';
    return {
      activeProfile: active,
      profiles: {
        realistic: readStyleProfile(
          bag.realistic,
          active === 'realistic' ? shared : emptyStyleProfile(),
        ),
        hentai: readStyleProfile(
          bag.hentai,
          active === 'hentai' ? shared : emptyStyleProfile(),
        ),
        '3d': readStyleProfile(
          bag['3d'],
          active === '3d' ? shared : emptyStyleProfile(),
        ),
      },
    };
  }
  return {
    activeProfile: 'realistic',
    profiles: {
      realistic: shared,
      hentai: emptyStyleProfile(),
      '3d': emptyStyleProfile(),
    },
  };
}

function withActiveProfile(
  form: Omit<
    GenerationFormStateDto,
    | 'relativeFolder'
    | 'promptFoldersRecursive'
    | 'checkpoint'
    | 'clip'
    | 'vae'
    | 'seed'
    | 'width'
    | 'height'
    | 'steps'
    | 'cfg'
    | 'samplerName'
    | 'scheduler'
    | 'denoise'
    | 'upscaler'
    | 'upscaleFactor'
    | 'hiresDenoise'
    | 'clipSkip'
    | 'additionalPositivePrompt'
    | 'negativePrompt'
    | 'promptText'
    | 'promptSource'
    | 'promptSingle'
  >,
): GenerationFormStateDto {
  const active = form.profiles[form.activeProfile];
  return {
    ...form,
    relativeFolder: active.relativeFolder,
    promptFoldersRecursive: active.promptFoldersRecursive,
    checkpoint: active.checkpoint,
    clip: active.clip,
    vae: active.vae,
    seed: active.seed,
    width: active.width,
    height: active.height,
    steps: active.steps,
    cfg: active.cfg,
    samplerName: active.samplerName,
    scheduler: active.scheduler,
    denoise: active.denoise,
    upscaler: active.upscaler,
    upscaleFactor: active.upscaleFactor,
    hiresDenoise: active.hiresDenoise,
    clipSkip: active.clipSkip,
    additionalPositivePrompt: active.additionalPositivePrompt,
    negativePrompt: active.negativePrompt,
    promptText: active.promptText,
    promptSource: active.promptSource,
    promptSingle: active.promptSingle === true,
  };
}

function parseForm(raw: Record<string, unknown>): GenerationFormStateDto {
  const { activeProfile, profiles } = profilesFromRaw(raw);
  const lastOutputPath =
    typeof raw.lastOutputPath === 'string' && raw.lastOutputPath.trim()
      ? raw.lastOutputPath.trim()
      : undefined;
  return withActiveProfile({
    activeProfile,
    profiles,
    benchmark: raw.benchmark === true,
    ...(typeof raw.lastPrompt === 'string' && raw.lastPrompt.trim()
      ? { lastPrompt: raw.lastPrompt }
      : {}),
    ...(typeof raw.lastNegativePrompt === 'string' &&
    raw.lastNegativePrompt.trim()
      ? { lastNegativePrompt: raw.lastNegativePrompt }
      : {}),
    ...(typeof raw.lastRelativeFolder === 'string' &&
    raw.lastRelativeFolder.trim() &&
    raw.lastRelativeFolder.trim() !== '_manual'
      ? {
          lastRelativeFolder: raw.lastRelativeFolder
            .trim()
            .replaceAll('\\', '/'),
        }
      : {}),
    ...(typeof raw.lastSeed === 'number' &&
    Number.isFinite(raw.lastSeed) &&
    raw.lastSeed > 0
      ? { lastSeed: Math.floor(raw.lastSeed) >>> 0 }
      : {}),
    ...(lastOutputPath ? { lastOutputPath } : {}),
  });
}

type GenerationFormDisk = {
  version: 2;
  libraries: Record<string, unknown>;
};

function writeDisk(disk: GenerationFormDisk): void {
  fs.mkdirSync(path.dirname(formPath()), { recursive: true });
  fs.writeFileSync(formPath(), `${JSON.stringify(disk, null, 2)}\n`, 'utf8');
}

function readDisk(): GenerationFormDisk {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(formPath(), 'utf8')) as unknown;
  } catch {
    return { version: 2, libraries: {} };
  }
  if (
    raw &&
    typeof raw === 'object' &&
    (raw as { version?: unknown }).version === 2 &&
    (raw as { libraries?: unknown }).libraries &&
    typeof (raw as { libraries?: unknown }).libraries === 'object' &&
    !Array.isArray((raw as { libraries?: unknown }).libraries)
  ) {
    return {
      version: 2,
      libraries: (raw as { libraries: Record<string, unknown> }).libraries,
    };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const libraries: Record<string, unknown> = {};
    for (const id of libraryScope().allIds) libraries[id] = raw;
    const disk: GenerationFormDisk = { version: 2, libraries };
    writeDisk(disk);
    return disk;
  }
  return { version: 2, libraries: {} };
}

export function loadGenerationForm(libraryId?: string): GenerationFormStateDto {
  const id = libraryId?.trim() || libraryScope().activeId;
  const row = readDisk().libraries[id];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return emptyForm();
  try {
    return parseForm(row as Record<string, unknown>);
  } catch {
    return emptyForm();
  }
}

export function loadGenerationFormWithPreview(): GenerationFormLoadedDto {
  discardLegacyGenerationPreview();
  const form = loadGenerationForm();
  const outputPath = form.lastOutputPath?.trim();
  if (!outputPath) return form;
  try {
    if (!fs.existsSync(outputPath) || !fs.statSync(outputPath).isFile()) {
      return form;
    }
    const fromImage = readPromptsFromImage(outputPath);
    if (
      fromImage &&
      (fromImage.positive !== form.lastPrompt ||
        (fromImage.negative ?? '') !== (form.lastNegativePrompt ?? ''))
    ) {
      // Keep the stored captions aligned with the file metadata.
      saveGenerationForm({
        lastPrompt: fromImage.positive,
        lastNegativePrompt: fromImage.negative ?? '',
      });
    }
    return {
      ...form,
      ...(fromImage
        ? {
            lastPrompt: fromImage.positive,
            ...(fromImage.negative
              ? { lastNegativePrompt: fromImage.negative }
              : { lastNegativePrompt: undefined }),
          }
        : {}),
      lastImageUrl: generationPreviewUrlForFile(outputPath),
    };
  } catch {
    return form;
  }
}

function readPromptsFromImage(
  absolutePath: string,
): GenerationImagePrompts | null {
  try {
    return extractGenerationPromptsFromImage(fs.readFileSync(absolutePath));
  } catch {
    return null;
  }
}

/**
 * Remember which workflow file to show next launch.
 * Does not copy image bytes into app data — that file is the only preview.
 */
export function saveGenerationPreview(
  lastPrompt: string,
  outputPath: string,
  lastNegativePrompt?: string | null,
  lastRelativeFolder?: string | null,
  lastSeed?: number | null,
): void {
  discardLegacyGenerationPreview();
  const folder = lastRelativeFolder?.trim().replaceAll('\\', '/') ?? '';
  const seed =
    typeof lastSeed === 'number' && Number.isFinite(lastSeed) && lastSeed > 0
      ? Math.floor(lastSeed) >>> 0
      : undefined;
  saveGenerationForm({
    lastPrompt,
    lastNegativePrompt: lastNegativePrompt?.trim() || '',
    lastRelativeFolder:
      folder && folder !== '_manual' ? folder : '',
    lastSeed: seed ?? 0,
    lastOutputPath: outputPath,
  });
}

const LAST_OUTPUT_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

export function lastGenerationOutputBasename(): string | null {
  const abs = lastGenerationOutputAbsolutePath();
  return abs ? path.basename(abs) : null;
}

/** Absolute file Last output is showing, or null if none is stored. */
export function lastGenerationOutputAbsolutePath(): string | null {
  const outputPath = loadGenerationForm().lastOutputPath?.trim();
  if (!outputPath) return null;
  return path.resolve(outputPath);
}

/**
 * Delete the last Generation output image (the file Last output is showing).
 * Renderer cannot pick a path — only the stored pointer is removed.
 */
export async function deleteLastGenerationOutput(): Promise<{
  deleted: boolean;
}> {
  const form = loadGenerationForm();
  const raw = form.lastOutputPath?.trim();
  if (!raw) return { deleted: false };
  const abs = path.resolve(raw);
  const ext = path.extname(abs).toLowerCase();
  if (!LAST_OUTPUT_EXTS.has(ext)) {
    throw new Error('Last generation is not an image file');
  }
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      try {
        await shell.trashItem(abs);
      } catch {
        fs.rmSync(abs, { force: true });
      }
    }
  } catch (e) {
    throw new Error(
      e instanceof Error ? e.message : 'Could not delete last generation',
    );
  }
  clearGenerationPreviewFile();
  saveGenerationForm({
    lastPrompt: '',
    lastNegativePrompt: '',
    lastRelativeFolder: '',
    lastSeed: 0,
    lastOutputPath: '',
  });
  return { deleted: true };
}

/** Build a generation request from the persisted form (infinite re-read). */
export function generationRequestFromForm(
  mode: GenerationModeDto,
): GenerationStartRequestDto {
  const form = loadGenerationForm();
  const promptSource = form.promptSource === 'text' ? 'text' : 'folder';
  return {
    mode,
    styleProfile: form.activeProfile,
    promptSource,
    relativeFolder: form.relativeFolder ?? undefined,
    promptFoldersRecursive:
      promptSource === 'folder' ? form.promptFoldersRecursive === true : undefined,
    promptText: promptSource === 'text' ? form.promptText : undefined,
    promptSingle: promptSource === 'text' ? form.promptSingle === true : undefined,
    checkpoint: form.checkpoint,
    clip: form.clip || undefined,
    vae: form.vae || undefined,
    seed: form.seed,
    width: form.width,
    height: form.height,
    steps: form.steps,
    cfg: form.cfg,
    samplerName: form.samplerName.trim() || undefined,
    scheduler: form.scheduler.trim() || undefined,
    denoise: form.denoise,
    upscaler: form.upscaler.trim() || undefined,
    upscaleFactor: form.upscaleFactor,
    hiresDenoise: form.hiresDenoise,
    clipSkip: form.clipSkip,
    additionalPositivePrompt: form.additionalPositivePrompt || undefined,
    negativePrompt: form.negativePrompt || undefined,
    benchmark: form.benchmark === true,
  };
}

export function canRunGenerationRequest(
  request: GenerationStartRequestDto,
): boolean {
  if (!request.benchmark && !request.checkpoint?.trim()) return false;
  const promptSource = request.promptSource === 'text' ? 'text' : 'folder';
  if (promptSource === 'text' && !request.promptText?.trim()) return false;
  return true;
}

export function assertGenerationRequest(
  request: GenerationStartRequestDto,
): void {
  const promptSource = request.promptSource === 'text' ? 'text' : 'folder';
  if (promptSource === 'text' && !request.promptText?.trim()) {
    throw new Error('Enter a prompt');
  }
  if (!request.benchmark && !request.checkpoint?.trim()) {
    throw new Error('Select a checkpoint');
  }
}

export function saveGenerationForm(
  patch: Partial<GenerationFormStateDto>,
  libraryId?: string,
): GenerationFormStateDto {
  const id = libraryId?.trim() || libraryScope().activeId;
  const current = loadGenerationForm(id);
  const activeProfile =
    patch.activeProfile !== undefined
      ? (asProfileId(patch.activeProfile) ?? current.activeProfile)
      : current.activeProfile;
  const profiles: GenerationFormStateDto['profiles'] = {
    realistic: { ...current.profiles.realistic },
    hentai: { ...current.profiles.hentai },
    '3d': { ...current.profiles['3d'] },
  };
  if (patch.profiles) {
    for (const id of PROFILE_IDS) {
      const incoming = patch.profiles[id];
      if (!incoming) continue;
      profiles[id] = readStyleProfile(incoming, profiles[id]);
    }
  }
  const flattenedTargetsActive = patch.profiles?.[activeProfile] == null;
  if (flattenedTargetsActive) {
    const target = profiles[activeProfile];
    if (patch.relativeFolder !== undefined) {
      target.relativeFolder =
        patch.relativeFolder && patch.relativeFolder.trim()
          ? patch.relativeFolder.trim().replaceAll('\\', '/')
          : null;
    }
    if (patch.promptFoldersRecursive !== undefined) {
      target.promptFoldersRecursive = patch.promptFoldersRecursive === true;
    }
    if (patch.checkpoint !== undefined) {
      target.checkpoint = asString(patch.checkpoint);
    }
    if (patch.clip !== undefined) target.clip = asString(patch.clip);
    if (patch.vae !== undefined) target.vae = asString(patch.vae);
    if (patch.seed !== undefined) {
      target.seed = Math.round(asFiniteNumber(patch.seed, target.seed));
    }
    if (patch.width !== undefined) {
      target.width = asPositiveInt(patch.width, target.width);
    }
    if (patch.height !== undefined) {
      target.height = asPositiveInt(patch.height, target.height);
    }
    if (patch.steps !== undefined) {
      target.steps = asPositiveInt(patch.steps, target.steps);
    }
    if (patch.cfg !== undefined) target.cfg = asCfg(patch.cfg, target.cfg);
    if (patch.samplerName !== undefined) {
      target.samplerName = asString(patch.samplerName);
    }
    if (patch.scheduler !== undefined) {
      target.scheduler = asString(patch.scheduler);
    }
    if (patch.denoise !== undefined) {
      target.denoise = asDenoise(patch.denoise, target.denoise);
    }
    if (patch.upscaler !== undefined) target.upscaler = asString(patch.upscaler);
    if (patch.upscaleFactor !== undefined) {
      target.upscaleFactor = asUpscaleFactor(
        patch.upscaleFactor,
        target.upscaleFactor,
      );
    }
    if (patch.hiresDenoise !== undefined) {
      target.hiresDenoise = asDenoise(patch.hiresDenoise, target.hiresDenoise);
    }
    if (patch.clipSkip !== undefined) {
      target.clipSkip = asClipSkip(patch.clipSkip, target.clipSkip);
    }
    if (patch.additionalPositivePrompt !== undefined) {
      target.additionalPositivePrompt = asString(patch.additionalPositivePrompt);
    }
    if (patch.negativePrompt !== undefined) {
      target.negativePrompt = asString(patch.negativePrompt);
    }
    if (patch.promptText !== undefined) {
      target.promptText = asString(patch.promptText);
    }
    if (patch.promptSource !== undefined) {
      target.promptSource = patch.promptSource === 'text' ? 'text' : 'folder';
    }
    if (patch.promptSingle !== undefined) {
      target.promptSingle = patch.promptSingle === true;
    }
  }
  const next = withActiveProfile({
    activeProfile,
    profiles,
    benchmark:
      patch.benchmark !== undefined
        ? patch.benchmark === true
        : current.benchmark === true,
    lastPrompt:
      patch.lastPrompt !== undefined
        ? asString(patch.lastPrompt)
        : current.lastPrompt,
    lastNegativePrompt:
      patch.lastNegativePrompt !== undefined
        ? asString(patch.lastNegativePrompt).trim() || undefined
        : current.lastNegativePrompt,
    lastRelativeFolder:
      patch.lastRelativeFolder !== undefined
        ? (() => {
            const folder = asString(patch.lastRelativeFolder)
              .trim()
              .replaceAll('\\', '/');
            return folder && folder !== '_manual' ? folder : undefined;
          })()
        : current.lastRelativeFolder,
    lastSeed:
      patch.lastSeed !== undefined
        ? (() => {
            const n = asFiniteNumber(patch.lastSeed, 0);
            return n > 0 ? Math.floor(n) >>> 0 : undefined;
          })()
        : current.lastSeed,
    lastOutputPath:
      patch.lastOutputPath !== undefined
        ? asString(patch.lastOutputPath).trim() || undefined
        : current.lastOutputPath,
  });
  const disk = readDisk();
  disk.libraries[id] = next;
  writeDisk(disk);
  return next;
}
