import { describe, expect, it } from 'vitest';
import {
  applyPromptCoverageIgnoredKeys,
  createPromptCoverageRun,
  pruneMissingPromptCoverageWildcards,
  refreshPromptCoverageNeverUsed,
  runPromptCoverageSync,
} from './promptCoverage.js';
import type { LibraryFile } from './types.js';

function file(key: string, text: string): LibraryFile {
  return {
    relativePath: `${key}.txt`,
    absolutePath: `/lib/${key}.txt`,
    name: `${key.split('/').pop()}.txt`,
    ext: '.txt',
    key,
    text,
  };
}

describe('promptCoverage', () => {
  it('marks unused library files as never and hits used ones', () => {
    const libraryFiles = [
      file('used', 'red\nblue'),
      file('unused', 'never\nseen'),
      file('nested', '__used__'),
    ];
    const report = runPromptCoverageSync({
      libraryId: 'test',
      libraryFiles,
      iterations: 40,
      seed: 1,
      genFiles: [
        { relativeFolder: 'portraits', lines: ['a __nested__ shot'] },
        { relativeFolder: 'scenes', lines: ['plain text only'] },
      ],
    });

    expect(report.selection).toBe('randomGeneration');
    expect(report.totalWalks).toBe(40);
    expect(report.summary.genLines).toBe(2);
    expect(report.summary.libraryFiles).toBe(3);

    const byKey = new Map(report.wildcards.map((w) => [w.key, w]));
    expect(byKey.get('unused')?.bucket).toBe('never');
    expect(byKey.get('unused')?.hits).toBe(0);
    expect(byKey.get('nested')?.hits).toBeGreaterThan(0);
    expect(byKey.get('used')?.hits).toBeGreaterThan(0);
    expect(byKey.get('nested')?.directGenRefs).toBe(1);
    expect(byKey.get('unused')?.directGenRefs).toBe(0);
    expect(report.neverReached).toContain('unused');
  });

  it('attributes hits to the source gen folder', () => {
    const report = runPromptCoverageSync({
      libraryId: 'test',
      libraryFiles: [file('color', 'red\nblue')],
      iterations: 10,
      seed: 2,
      genFiles: [
        { relativeFolder: 'a', lines: ['__color__'] },
        { relativeFolder: 'b', lines: ['no refs'] },
      ],
    });
    const color = report.wildcards.find((w) => w.key === 'color');
    expect(color?.byFolder.a).toBeGreaterThan(0);
    expect(color?.byFolder.b ?? 0).toBe(0);
    const folderA = report.genFolders.find((f) => f.relativeFolder === 'a');
    expect(folderA?.topKeys.some((t) => t.key === 'color')).toBe(true);
  });

  it('supports chunked cancel', () => {
    const run = createPromptCoverageRun({
      libraryId: 'test',
      libraryFiles: [file('x', 'a\nb\nc')],
      iterations: 100,
      seed: 3,
      genFiles: [{ relativeFolder: 'f', lines: ['__x__', '__x__'] }],
    });
    expect(run.total).toBe(100);
    run.runChunk(10);
    expect(run.done).toBe(10);
    run.runChunk(5, () => true);
    expect(run.cancelled).toBe(true);
    expect(run.finished).toBe(true);
    const report = run.buildReport('cancelled');
    expect(report.status).toBe('cancelled');
  });

  it('prunes missing library keys from a saved report', () => {
    const report = runPromptCoverageSync({
      libraryId: 'test',
      libraryFiles: [file('keep', 'a'), file('gone', 'b')],
      iterations: 5,
      seed: 4,
      genFiles: [{ relativeFolder: 'f', lines: ['plain'] }],
    });
    const pruned = pruneMissingPromptCoverageWildcards(report, ['keep']);
    expect(pruned.removedMissing).toBe(1);
    expect(pruned.report.wildcards.map((w) => w.key)).toEqual(['keep']);
    expect(pruned.report.neverReached).not.toContain('gone');
  });

  it('clears Never when a gen line now names the wildcard', () => {
    const libraryFiles = [file('color', 'red\nblue'), file('unused', 'x')];
    const report = runPromptCoverageSync({
      libraryId: 'test',
      libraryFiles,
      iterations: 8,
      seed: 5,
      genFiles: [{ relativeFolder: 'f', lines: ['no refs here'] }],
    });
    expect(report.wildcards.find((w) => w.key === 'unused')?.bucket).toBe(
      'never',
    );
    const refreshed = refreshPromptCoverageNeverUsed(report, libraryFiles, [
      { relativeFolder: 'f', lines: ['now __unused__'] },
    ]);
    expect(refreshed.clearedNeverByGenRef).toBe(1);
    expect(refreshed.report.wildcards.find((w) => w.key === 'unused')?.bucket).toBe(
      'normal',
    );
    expect(refreshed.report.neverReached).not.toContain('unused');
  });

  it('gives each folder about the same number of walks', () => {
    const fatLines = Array.from({ length: 40 }, (_, i) => `__fat${i}__`);
    const report = runPromptCoverageSync({
      libraryId: 'test',
      libraryFiles: [
        ...fatLines.map((line) => file(line.slice(2, -2), 'x')),
        file('thin', 'x'),
      ],
      iterations: 4_000,
      seed: 11,
      genFiles: [
        { relativeFolder: 'fat', lines: fatLines },
        { relativeFolder: 'thin', lines: ['__thin__'] },
      ],
    });
    const walks = new Map(
      report.genFolders.map((folder) => [
        folder.relativeFolder,
        folder.walksFromFolder,
      ]),
    );
    expect(walks.get('fat')! + walks.get('thin')!).toBe(4_000);
    expect(walks.get('fat')!).toBeGreaterThan(1_600);
    expect(walks.get('thin')!).toBeGreaterThan(1_600);
    expect(report.wildcards.find((w) => w.key === 'thin')?.hits).toBeGreaterThan(
      0,
    );
    for (let i = 0; i < fatLines.length; i += 1) {
      expect(
        report.wildcards.find((w) => w.key === `fat${i}`)?.hits ?? 0,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps weight copies more likely inside one folder', () => {
    const report = runPromptCoverageSync({
      libraryId: 'test',
      libraryFiles: [file('often', 'a'), file('seldom', 'b')],
      iterations: 4_000,
      seed: 12,
      genFiles: [
        {
          relativeFolder: 'weighted',
          lines: ['__often__', '__often__', '__often__', '__seldom__'],
        },
      ],
    });
    const often = report.wildcards.find((w) => w.key === 'often')?.hits ?? 0;
    const seldom = report.wildcards.find((w) => w.key === 'seldom')?.hits ?? 0;
    expect(often).toBeGreaterThan(seldom * 2);
  });

  it('hides ignored keys from actionable Never counts', () => {
    const report = runPromptCoverageSync({
      libraryId: 'test',
      libraryFiles: [file('tool', 'a'), file('style', 'b')],
      iterations: 5,
      seed: 6,
      genFiles: [{ relativeFolder: 'f', lines: ['plain'] }],
    });
    expect(report.summary.neverReachedFiles).toBe(2);
    const ignored = applyPromptCoverageIgnoredKeys(report, ['tool']);
    expect(ignored.ignoredKeys).toEqual(['tool']);
    expect(ignored.summary.neverReachedFiles).toBe(1);
    expect(ignored.summary.ignoredNeverFiles).toBe(1);
  });
});
