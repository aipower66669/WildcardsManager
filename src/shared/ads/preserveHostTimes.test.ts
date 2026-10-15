import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  withPreservedHostTimes,
  withPreservedHostTimesSync,
} from './preserveHostTimes.js';

describe('withPreservedHostTimes', () => {
  let dir: string;
  let file: string;
  const past = new Date('2020-06-15T12:34:56.000Z');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-host-times-'));
    file = path.join(dir, 'item.bin');
    fs.writeFileSync(file, 'payload');
    fs.utimesSync(file, past, past);
    fs.utimesSync(dir, past, past);
  });

  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('restores file atime/mtime after a mutation that bumps them', () => {
    const before = fs.statSync(file);
    withPreservedHostTimesSync(file, () => {
      const now = new Date();
      fs.utimesSync(file, now, now);
      fs.writeFileSync(file, 'payload');
    });
    const after = fs.statSync(file);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.atimeMs).toBe(before.atimeMs);
  });

  it('restores folder atime/mtime after a mutation that bumps them', async () => {
    const before = fs.statSync(dir);
    await withPreservedHostTimes(dir, async () => {
      const child = path.join(dir, 'tmp');
      fs.writeFileSync(child, 'x');
      fs.unlinkSync(child);
    });
    const after = fs.statSync(dir);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.atimeMs).toBe(before.atimeMs);
  });
});
