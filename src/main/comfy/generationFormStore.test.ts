import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-gen-form-'));

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
  shell: {
    trashItem: async (file: string) => {
      fs.unlinkSync(file);
    },
  },
  net: { fetch: () => Promise.resolve(new Response()) },
  protocol: {
    registerSchemesAsPrivileged: () => undefined,
    handle: () => undefined,
  },
}));

const {
  canRunGenerationRequest,
  deleteLastGenerationOutput,
  generationRequestFromForm,
  loadGenerationForm,
  loadGenerationFormWithPreview,
  saveGenerationForm,
  saveGenerationPreview,
  setGenerationFormLibraryResolver,
} = await import('./generationFormStore.js');

describe('generationFormStore', () => {
  beforeEach(() => {
    for (const name of fs.readdirSync(userData)) {
      fs.rmSync(path.join(userData, name), { force: true, recursive: true });
    }
  });

  afterEach(() => {
    setGenerationFormLibraryResolver(() => ({
      activeId: 'local',
      allIds: ['local'],
    }));
    vi.clearAllMocks();
  });

  it('generationRequestFromForm reflects saved prompt source and text', () => {
    saveGenerationForm({
      promptSource: 'text',
      promptText: '<lora:Foo:1> bar',
      checkpoint: 'model.safetensors',
      seed: 42,
      width: 1200,
      height: 1600,
      additionalPositivePrompt: 'photo',
      negativePrompt: 'bad',
    });

    expect(generationRequestFromForm('infinite')).toEqual({
      mode: 'infinite',
      styleProfile: 'realistic',
      promptSource: 'text',
      relativeFolder: undefined,
      promptFoldersRecursive: undefined,
      promptText: '<lora:Foo:1> bar',
      promptSingle: false,
      checkpoint: 'model.safetensors',
      clip: undefined,
      vae: undefined,
      seed: 42,
      width: 1200,
      height: 1600,
      steps: 20,
      cfg: 7,
      samplerName: undefined,
      scheduler: undefined,
      denoise: 1,
      upscaler: undefined,
      upscaleFactor: 1.5,
      hiresDenoise: 0.5,
      clipSkip: 2,
      additionalPositivePrompt: 'photo',
      negativePrompt: 'bad',
      benchmark: false,
    });
  });

  it('persists promptFoldersRecursive on the active profile', () => {
    saveGenerationForm({
      promptSource: 'folder',
      relativeFolder: 'portraits',
      promptFoldersRecursive: true,
      checkpoint: 'model.safetensors',
      seed: -1,
      width: 1024,
      height: 1024,
    });
    expect(generationRequestFromForm('once')).toMatchObject({
      promptSource: 'folder',
      relativeFolder: 'portraits',
      promptFoldersRecursive: true,
    });
  });

  it('canRunGenerationRequest requires text or folder', () => {
    expect(
      canRunGenerationRequest({
        mode: 'once',
        promptSource: 'text',
        promptText: '',
        checkpoint: 'x',
        seed: -1,
        width: 1024,
        height: 1024,
      }),
    ).toBe(false);
    expect(
      canRunGenerationRequest({
        mode: 'once',
        promptSource: 'text',
        promptText: 'hello',
        checkpoint: 'x',
        seed: -1,
        width: 1024,
        height: 1024,
      }),
    ).toBe(true);
    expect(
      canRunGenerationRequest({
        mode: 'once',
        promptSource: 'folder',
        checkpoint: 'x',
        seed: -1,
        width: 1024,
        height: 1024,
      }),
    ).toBe(true);
  });

  it('keeps Realistic and Hentai checkpoints and prompts separate', () => {
    saveGenerationForm({
      checkpoint: 'realistic.safetensors',
      additionalPositivePrompt: 'photo',
      negativePrompt: 'cartoon',
      activeProfile: 'realistic',
    });
    saveGenerationForm({
      activeProfile: 'hentai',
      clip: 'hentai-clip.safetensors',
      vae: 'hentai-vae.safetensors',
      seed: 7,
      width: 768,
      height: 768,
      relativeFolder: 'Hentai',
      profiles: {
        realistic: {
          relativeFolder: 'Photo',
          promptFoldersRecursive: false,
          checkpoint: 'realistic.safetensors',
          clip: 'photo-clip.safetensors',
          vae: 'photo-vae.safetensors',
          seed: 42,
          width: 1200,
          height: 1600,
          steps: 20,
          cfg: 7,
          samplerName: 'euler',
          scheduler: 'normal',
          denoise: 1,
          upscaler: '',
          upscaleFactor: 1.5,
          hiresDenoise: 0.5,
          clipSkip: 2,
          additionalPositivePrompt: 'photo',
          negativePrompt: 'cartoon',
          promptText: '',
          promptSource: 'folder',
          promptSingle: false,
        },
        hentai: {
          relativeFolder: 'Hentai',
          promptFoldersRecursive: false,
          checkpoint: 'anime.safetensors',
          clip: 'hentai-clip.safetensors',
          vae: 'hentai-vae.safetensors',
          seed: 7,
          width: 768,
          height: 768,
          steps: 8,
          cfg: 1,
          samplerName: 'exp_heun_2_x0',
          scheduler: 'sgm_uniform',
          denoise: 1,
          upscaler: '',
          upscaleFactor: 1.5,
          hiresDenoise: 0.5,
          clipSkip: 2,
          additionalPositivePrompt: '__style-hentai__',
          negativePrompt: 'photo',
          promptText: 'typed',
          promptSource: 'text',
          promptSingle: false,
        },
        '3d': {
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
        },
      },
    });

    const hentai = generationRequestFromForm('once');
    expect(hentai.styleProfile).toBe('hentai');
    expect(hentai.checkpoint).toBe('anime.safetensors');
    expect(hentai.clip).toBe('hentai-clip.safetensors');
    expect(hentai.vae).toBe('hentai-vae.safetensors');
    expect(hentai.relativeFolder).toBe('Hentai');
    expect(hentai.seed).toBe(7);
    expect(hentai.width).toBe(768);
    expect(hentai.steps).toBe(8);
    expect(hentai.cfg).toBe(1);
    expect(hentai.samplerName).toBe('exp_heun_2_x0');
    expect(hentai.scheduler).toBe('sgm_uniform');
    expect(hentai.denoise).toBe(1);
    expect(hentai.additionalPositivePrompt).toBe('__style-hentai__');
    expect(hentai.negativePrompt).toBe('photo');

    const switched = saveGenerationForm({ activeProfile: 'realistic' });
    expect(switched.checkpoint).toBe('realistic.safetensors');
    expect(switched.clip).toBe('photo-clip.safetensors');
    expect(switched.relativeFolder).toBe('Photo');
    expect(switched.width).toBe(1200);
    expect(switched.additionalPositivePrompt).toBe('photo');
    expect(switched.negativePrompt).toBe('cartoon');
    expect(switched.profiles.hentai.additionalPositivePrompt).toBe(
      '__style-hentai__',
    );
    expect(switched.profiles.hentai.clip).toBe('hentai-clip.safetensors');
    expect(switched.profiles.hentai.steps).toBe(8);
    expect(switched.steps).toBe(20);
    expect(switched.samplerName).toBe('euler');
  });

  it('keeps an existing form on Realistic', () => {
    const file = path.join(userData, 'generation-form.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        relativeFolder: 'Photo',
        checkpoint: 'krea.safetensors',
        clip: 'clip.safetensors',
        vae: 'vae.safetensors',
        additionalPositivePrompt: '__style-hentai__',
        negativePrompt: 'lowres',
        seed: -1,
        width: 1200,
        height: 1600,
      }),
    );
    const loaded = loadGenerationFormWithPreview();
    expect(loaded.activeProfile).toBe('realistic');
    expect(loaded.checkpoint).toBe('krea.safetensors');
    expect(loaded.clip).toBe('clip.safetensors');
    expect(loaded.vae).toBe('vae.safetensors');
    expect(loaded.width).toBe(1200);
    expect(loaded.height).toBe(1600);
    expect(loaded.additionalPositivePrompt).toBe('__style-hentai__');
    expect(loaded.negativePrompt).toBe('lowres');
    expect(loaded.relativeFolder).toBe('Photo');
    expect(loaded.profiles.hentai.checkpoint).toBe('');
    expect(loaded.profiles.hentai.clip).toBe('');
    expect(loaded.profiles.hentai.relativeFolder).toBeNull();
    expect(loaded.profiles.hentai.additionalPositivePrompt).toBe('');
    expect(loaded.profiles.hentai.negativePrompt).toBe('');
    expect(loaded.profiles['3d'].checkpoint).toBe('');
  });

  it('keeps shared fields on the active profile when older profiles omit them', () => {
    const file = path.join(userData, 'generation-form.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        activeProfile: 'realistic',
        relativeFolder: 'Baby/Boys',
        clip: 'clip.safetensors',
        vae: 'vae.safetensors',
        seed: -1,
        width: 1200,
        height: 1600,
        promptSource: 'text',
        promptText: 'typed',
        profiles: {
          realistic: {
            checkpoint: 'real.safetensors',
            additionalPositivePrompt: 'photo',
            negativePrompt: '',
          },
          hentai: {
            checkpoint: 'anime.safetensors',
            additionalPositivePrompt: '',
            negativePrompt: 'bad',
          },
        },
      }),
    );
    const loaded = loadGenerationFormWithPreview();
    expect(loaded.relativeFolder).toBe('Baby/Boys');
    expect(loaded.clip).toBe('clip.safetensors');
    expect(loaded.vae).toBe('vae.safetensors');
    expect(loaded.width).toBe(1200);
    expect(loaded.height).toBe(1600);
    expect(loaded.promptSource).toBe('text');
    expect(loaded.promptText).toBe('typed');
    expect(loaded.promptSingle).toBe(false);
    expect(loaded.profiles.realistic.checkpoint).toBe('real.safetensors');
    expect(loaded.profiles.hentai.checkpoint).toBe('anime.safetensors');
    expect(loaded.profiles.hentai.clip).toBe('');
    expect(loaded.profiles.hentai.vae).toBe('');
    expect(loaded.profiles.hentai.relativeFolder).toBeNull();
    expect(loaded.profiles.hentai.width).toBe(1024);
    expect(loaded.profiles.hentai.height).toBe(1024);
    expect(loaded.profiles.hentai.negativePrompt).toBe('bad');
    expect(loaded.profiles.hentai.promptSource).toBe('folder');
  });

  it('restores the preview from the workflow file and drops the app-data copy', () => {
    const output = path.join(userData, 'workflow-out.jpg');
    fs.writeFileSync(output, Buffer.from('jpg-bytes'));
    fs.writeFileSync(
      path.join(userData, 'generation-last-preview.png'),
      Buffer.from('stale-copy'),
    );
    saveGenerationPreview(
      'final prompt',
      output,
      'watermark',
      'portraits/boys',
      42,
    );
    expect(
      fs.existsSync(path.join(userData, 'generation-last-preview.png')),
    ).toBe(false);
    const loaded = loadGenerationFormWithPreview();
    expect(loaded.lastPrompt).toBe('final prompt');
    expect(loaded.lastNegativePrompt).toBe('watermark');
    expect(loaded.lastRelativeFolder).toBe('portraits/boys');
    expect(loaded.lastSeed).toBe(42);
    expect(loaded.lastOutputPath).toBe(output);
    expect(loaded.lastImageUrl).toMatch(/^wcm-gen:\/\/preview\/\d+$/);
    expect(
      fs.readdirSync(userData).filter((name) => name.endsWith('.png')),
    ).toEqual([]);
  });

  it('deletes the last output file and clears the preview pointer', async () => {
    const output = path.join(userData, 'WCG_00001_.png');
    fs.writeFileSync(output, Buffer.from('img'));
    saveGenerationPreview('bad take', output);
    const result = await deleteLastGenerationOutput();
    expect(result).toEqual({ deleted: true });
    expect(fs.existsSync(output)).toBe(false);
    const loaded = loadGenerationFormWithPreview();
    expect(loaded.lastOutputPath).toBeUndefined();
    expect(loaded.lastImageUrl).toBeUndefined();
    expect(loaded.lastPrompt).toBeUndefined();
  });

  it('keeps parameters and options on the library that saved them', () => {
    setGenerationFormLibraryResolver(() => ({
      activeId: 'krea',
      allIds: ['krea', 'sdxl'],
    }));
    saveGenerationForm(
      { checkpoint: 'krea.safetensors', steps: 20, cfg: 7, samplerName: 'euler' },
      'krea',
    );
    saveGenerationForm(
      {
        checkpoint: 'pony.safetensors',
        steps: 30,
        cfg: 4,
        samplerName: 'lcm',
        clipSkip: 1,
      },
      'sdxl',
    );
    expect(loadGenerationForm('krea').checkpoint).toBe('krea.safetensors');
    expect(loadGenerationForm('krea').steps).toBe(20);
    expect(loadGenerationForm('krea').samplerName).toBe('euler');
    expect(loadGenerationForm('sdxl').checkpoint).toBe('pony.safetensors');
    expect(loadGenerationForm('sdxl').steps).toBe(30);
    expect(loadGenerationForm('sdxl').cfg).toBe(4);
    expect(loadGenerationForm('sdxl').samplerName).toBe('lcm');
    expect(loadGenerationForm('sdxl').clipSkip).toBe(1);
  });
});
