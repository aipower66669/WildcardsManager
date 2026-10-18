import { describe, expect, it } from 'vitest';
import {
  isCheckpointIgnored,
  normalizeCheckpointIgnored,
  withCheckpointEnabled,
} from './checkpointEnabled.js';

describe('checkpoint ignored list', () => {
  it('treats a missing list as none ignored', () => {
    expect(normalizeCheckpointIgnored(undefined)).toEqual([]);
    expect(isCheckpointIgnored('Model.safetensors', [])).toBe(false);
  });

  it('matches a full path or a bare filename', () => {
    const ignored = ['styles/Foo.safetensors', 'other.safetensors'];
    expect(isCheckpointIgnored('styles/Foo.safetensors', ignored)).toBe(true);
    expect(isCheckpointIgnored('Styles\\Foo.safetensors', ignored)).toBe(true);
    expect(isCheckpointIgnored('nested/other.safetensors', ignored)).toBe(true);
    expect(isCheckpointIgnored('styles/Bar.safetensors', ignored)).toBe(false);
  });

  it('adds and removes a checkpoint without touching the rest', () => {
    const off = withCheckpointEnabled(
      ['keep.safetensors'],
      'Redgraft.safetensors',
      false,
    );
    expect(off).toEqual(['keep.safetensors', 'redgraft.safetensors']);
    expect(
      withCheckpointEnabled(off, 'folder/Redgraft.safetensors', true),
    ).toEqual(['keep.safetensors']);
  });
});
