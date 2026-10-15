import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'wcm-miss-unused'),
  },
}));

import {
  configureModelHashMissCacheRoot,
  flushModelHashMissCacheSync,
  isKnownModelHashMiss,
  isPermanentCivitaiHashMiss,
  rememberModelHashMiss,
  clearModelHashMiss,
} from './modelHashMissCache.js';

describe('modelHashMissCache', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-miss-'));
    configureModelHashMissCacheRoot(root);
  });

  afterEach(() => {
    flushModelHashMissCacheSync();
    configureModelHashMissCacheRoot(null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('remembers permanent misses and skips them forever', () => {
    expect(isKnownModelHashMiss('0806E91728')).toBe(false);
    rememberModelHashMiss('0806e91728');
    flushModelHashMissCacheSync();
    expect(isKnownModelHashMiss('0806E91728')).toBe(true);
    expect(fs.existsSync(path.join(root, 'model-hash-misses.json'))).toBe(
      true,
    );
  });

  it('detects permanent Civitai status codes in error messages', () => {
    expect(
      isPermanentCivitaiHashMiss(
        new Error('Civitai request failed (404): Not Found'),
      ),
    ).toBe(true);
    expect(
      isPermanentCivitaiHashMiss(new Error('Civitai request failed (429)')),
    ).toBe(false);
  });

  it('clearModelHashMiss allows a later Rematch retry', () => {
    rememberModelHashMiss('AABBCCDDEE');
    flushModelHashMissCacheSync();
    expect(isKnownModelHashMiss('AABBCCDDEE')).toBe(true);
    clearModelHashMiss('AABBCCDDEE');
    flushModelHashMissCacheSync();
    expect(isKnownModelHashMiss('AABBCCDDEE')).toBe(false);
  });
});
