import { describe, expect, it } from 'vitest';
import { pickMasterAndGens } from './checkpointMasterPick.js';

describe('pickMasterAndGens', () => {
  it('picks the largest file as master and up to 12 gens', () => {
    const hits = Array.from({ length: 15 }, (_, i) => ({
      absolutePath: `/m/img${i}.jpg`,
      size: (i + 1) * 1000,
    }));
    const result = pickMasterAndGens(hits);
    expect(result?.masterAbsolutePath).toBe('/m/img14.jpg');
    expect(result?.genAbsolutePaths).toHaveLength(12);
    expect(result?.genAbsolutePaths[0]).toBe('/m/img13.jpg');
  });

  it('returns null for empty hits', () => {
    expect(pickMasterAndGens([])).toBeNull();
  });
});
