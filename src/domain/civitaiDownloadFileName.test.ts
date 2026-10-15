import { describe, expect, it } from 'vitest';
import {
  forbiddenDownloadFileNameReason,
  isForbiddenDownloadFileName,
  resolveDownloadSaveFileName,
  sanitizeDownloadFileName,
} from './civitaiDownloadFileName.js';

describe('sanitizeDownloadFileName', () => {
  it('keeps a normal safetensors name', () => {
    expect(
      sanitizeDownloadFileName(
        'Elayne Trakand.safetensors',
        'V1.safetensors',
      ),
    ).toBe('Elayne Trakand.safetensors');
  });

  it('strips path segments and illegal characters', () => {
    expect(
      sanitizeDownloadFileName('Girls/foo:bar?.safetensors', 'V1.safetensors'),
    ).toBe('foobar.safetensors');
  });

  it('adds the fallback extension when missing', () => {
    expect(sanitizeDownloadFileName('MyLora', 'fallback.safetensors')).toBe(
      'MyLora.safetensors',
    );
  });

  it('rejects empty names', () => {
    expect(sanitizeDownloadFileName('   ', 'V1.safetensors')).toBeNull();
    expect(sanitizeDownloadFileName('...', 'V1.safetensors')).toBeNull();
  });

  it('collapses stacked underscores in the stem', () => {
    expect(
      sanitizeDownloadFileName(
        'Natural__Lighting___v2.safetensors',
        'model.safetensors',
      ),
    ).toBe('Natural_Lighting_v2.safetensors');
    expect(
      resolveDownloadSaveFileName('foo__bar', 'model.safetensors'),
    ).toEqual({ ok: true, fileName: 'foo_bar.safetensors' });
  });
});

describe('forbidden download names', () => {
  it('flags stems starting with V1', () => {
    expect(isForbiddenDownloadFileName('V1.safetensors')).toBe(true);
    expect(isForbiddenDownloadFileName('v1')).toBe(true);
    expect(isForbiddenDownloadFileName('V1_foo.safetensors')).toBe(true);
    expect(isForbiddenDownloadFileName('V10.safetensors')).toBe(true);
    expect(isForbiddenDownloadFileName('Elayne.safetensors')).toBe(false);
    expect(isForbiddenDownloadFileName('rev1.safetensors')).toBe(false);
  });

  it('flags stems starting with optimizer', () => {
    expect(isForbiddenDownloadFileName('optimizer.bin')).toBe(true);
    expect(isForbiddenDownloadFileName('Optimizer.safetensors')).toBe(true);
    expect(isForbiddenDownloadFileName('optimizer_state.pt')).toBe(true);
    expect(isForbiddenDownloadFileName('MyOptimizer.safetensors')).toBe(false);
  });

  it('resolveDownloadSaveFileName rejects V1 and optimizer', () => {
    const badV1 = resolveDownloadSaveFileName('V1', 'model.safetensors');
    expect(badV1.ok).toBe(false);
    if (!badV1.ok) {
      expect(forbiddenDownloadFileNameReason('V1.safetensors')).toMatch(/V1/);
      expect(badV1.error).toMatch(/V1/);
    }
    const badOpt = resolveDownloadSaveFileName(
      'optimizer.bin',
      'model.safetensors',
    );
    expect(badOpt.ok).toBe(false);
    if (!badOpt.ok) {
      expect(badOpt.error).toMatch(/optimizer/i);
    }
    const good = resolveDownloadSaveFileName('Melly', 'V1.safetensors');
    expect(good).toEqual({ ok: true, fileName: 'Melly.safetensors' });
  });
});
