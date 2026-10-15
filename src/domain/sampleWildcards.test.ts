/**
 * Validates the shipped sample_wildcards library.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeWildcardTree } from './analyze.js';
import { hasNoValidationMarker } from './parseRefs.js';
import { computeReferenceStats } from './references.js';
import type { LibraryFile } from './types.js';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../sample_wildcards',
);

function loadLibrary(dir: string): LibraryFile[] {
  const out: LibraryFile[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.txt', '.yaml', '.yml', '.json'].includes(ext)) continue;
      const relativePath = path.relative(dir, abs).split(path.sep).join('/');
      out.push({
        relativePath,
        absolutePath: abs,
        name: entry.name,
        ext: ext as LibraryFile['ext'],
        key: relativePath.replace(/\.(txt|ya?ml|json)$/i, ''),
        text: fs.readFileSync(abs, 'utf8'),
      });
    }
  };
  walk(dir);
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

const NSFW_HINTS =
  /\b(nsfw|nude|naked|lingerie|bdsm|erotic|porn|xxx|sex\b|sexual|topless|bottomless|fetish)\b/i;

describe('sample_wildcards library', () => {
  const files = loadLibrary(root);

  it('exists and is non-trivial', () => {
    expect(fs.existsSync(root)).toBe(true);
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.key === '0main')).toBe(true);
  });

  it('keeps 0main first alphabetically among top-level keys', () => {
    const top = files
      .filter((f) => !f.key.includes('/'))
      .map((f) => f.key)
      .sort((a, b) => a.localeCompare(b));
    expect(top[0]).toBe('0main');
  });

  it('has no missing references or cycles from 0main', () => {
    const analysis = analyzeWildcardTree({
      rootRelativePath: '0main.txt',
      files,
    });
    const missing = analysis.issues.filter((i) => i.code === 'missing_file');
    const cycles = analysis.issues.filter((i) => i.code === 'cycle');
    expect(missing).toEqual([]);
    expect(cycles).toEqual([]);
    expect(analysis.stats.missingCount).toBe(0);
    expect(analysis.stats.cycleCount).toBe(0);
  });

  it('has no empty/invalid files outside NO VALIDATION markers', () => {
    const stats = computeReferenceStats(files);
    const invalid = stats.filter((s) => s.issueCount > 0);
    const details = invalid.map((s) => {
      const file = files.find((f) => f.key === s.key)!;
      return `${s.key} (${s.issueCount}) noValidation=${hasNoValidationMarker(file.text)}`;
    });
    expect(details, details.join('\n')).toEqual([]);
  });

  it('contains no obvious NSFW vocabulary', () => {
    const hits: string[] = [];
    for (const file of files) {
      if (NSFW_HINTS.test(file.text) || NSFW_HINTS.test(file.relativePath)) {
        hits.push(file.relativePath);
      }
    }
    expect(hits).toEqual([]);
  });

  it('covers the required concept branches from 0main', () => {
    const keys = new Set(files.map((f) => f.key));
    for (const required of [
      'people-count',
      'age',
      'race',
      'gender-male',
      'gender-female',
      'clothes-male',
      'clothes-female',
      'hairstyle-male',
      'hairstyle-female',
      'jewelry',
      'view',
      'pose',
      'location',
      'indoor',
      'outdoor',
      'lighting',
      'style',
      'color',
      'print-patterns',
      'time-period',
    ]) {
      expect(keys.has(required), `missing ${required}`).toBe(true);
    }
  });
});
