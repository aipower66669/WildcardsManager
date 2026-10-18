import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readMfeFieldRating } from './mfeMetaAds.js';

const win = process.platform === 'win32';

function meta(rating: number): string {
  return JSON.stringify({
    format: 'MyFileExplorer.UserMetadata',
    version: 1,
    values: { field_rating: rating },
  });
}

describe.skipIf(!win)('readMfeFieldRating', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-mfe-meta-'));

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeStream(folderName: string, body: Buffer | string): string {
    const folder = path.join(root, folderName);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      `${folder}:mfe_meta`,
      typeof body === 'string' ? Buffer.from(`${body}\0\r\n`, 'utf8') : body,
    );
    return folder;
  }

  it('reads field_rating from a folder stream written as UTF-8 or UTF-16', () => {
    const utf8 = writeStream('utf8', meta(10));
    const utf16 = writeStream(
      'utf16',
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(meta(8), 'utf16le')]),
    );
    const bare = path.join(root, 'unrated');
    fs.mkdirSync(bare, { recursive: true });

    expect(readMfeFieldRating(utf8)).toBe(10);
    expect(readMfeFieldRating(utf16)).toBe(8);
    expect(readMfeFieldRating(bare)).toBeNull();
  });
});
