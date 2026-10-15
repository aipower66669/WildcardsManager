import { describe, expect, it } from 'vitest';
import {
  civitaiImageMatchesTools,
  inferCivitaiImageTool,
} from './civitaiImageTools';

describe('inferCivitaiImageTool', () => {
  it('detects ComfyUI from engine/comfy', () => {
    expect(
      inferCivitaiImageTool({ engine: 'ComfyUI', comfy: { prompt: {} } }),
    ).toBe('comfyui');
    expect(inferCivitaiImageTool({ version: 'ComfyUI' })).toBe('comfyui');
  });

  it('detects Civitai on-site fingerprints', () => {
    expect(inferCivitaiImageTool({ engine: 'Civitai' })).toBe('civitai');
    expect(
      inferCivitaiImageTool({
        workflow: 'txt2img',
        civitaiResources: [{ modelVersionId: 1 }],
      }),
    ).toBe('civitai');
  });

  it('detects Krea (on-site ecosystem / engine)', () => {
    expect(
      inferCivitaiImageTool({
        ecosystem: 'Krea2',
        workflow: 'txt2img',
        civitaiResources: [{ modelVersionId: 1 }],
      }),
    ).toBe('krea');
    expect(inferCivitaiImageTool({ engine: 'Krea' })).toBe('krea');
    expect(
      inferCivitaiImageTool({
        external: { source: { name: 'Krea' } },
      }),
    ).toBe('krea');
  });

  it('detects Forge and AUTOMATIC1111 from version strings', () => {
    expect(
      inferCivitaiImageTool({
        version: 'f2.0.1v1.10.1-previous-669-gdfdcbab6',
      }),
    ).toBe('forge');
    expect(inferCivitaiImageTool({ version: 'neo-2.24' })).toBe('forge');
    expect(inferCivitaiImageTool({ version: 'v1.10.1' })).toBe('automatic1111');
  });

  it('detects SwarmUI and Fooocus', () => {
    expect(inferCivitaiImageTool({ software: 'SwarmUI' })).toBe('swarmui');
    expect(inferCivitaiImageTool({ engine: 'Fooocus' })).toBe('fooocus');
  });

  it('returns null without usable meta', () => {
    expect(inferCivitaiImageTool(null)).toBeNull();
    expect(inferCivitaiImageTool({})).toBeNull();
  });
});

describe('civitaiImageMatchesTools', () => {
  it('passes through when no tools selected', () => {
    expect(civitaiImageMatchesTools(null, undefined)).toBe(true);
    expect(civitaiImageMatchesTools(null, [])).toBe(true);
  });

  it('requires a matching inferred tool', () => {
    expect(
      civitaiImageMatchesTools({ engine: 'ComfyUI' }, ['comfyui']),
    ).toBe(true);
    expect(
      civitaiImageMatchesTools({ engine: 'ComfyUI' }, ['civitai']),
    ).toBe(false);
    expect(civitaiImageMatchesTools(null, ['comfyui'])).toBe(false);
  });
});
