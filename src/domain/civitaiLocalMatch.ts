import {
  stripLoraExtension,
  type LoraFileEntry,
  type LoraIndex,
} from './lora.js';

export type CivitaiLocalMatchKind = 'exact' | 'similar';

export type CivitaiLocalMatch = {
  relativePath: string;
  stem: string;
  matchKind: CivitaiLocalMatchKind;
};

/** Normalize a model stem for fuzzy comparison. */
export function normalizeModelStem(stem: string): string {
  return stripLoraExtension(stem)
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function similarityScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (longer.includes(shorter)) {
    return shorter.length / longer.length;
  }
  return 0;
}

function compactStem(stem: string): string {
  return normalizeModelStem(stem).replace(/\s+/g, '');
}

function fileStemKeys(file: LoraFileEntry): string[] {
  const base = file.stem.split('/').pop() ?? file.stem;
  return [
    normalizeModelStem(file.stem),
    normalizeModelStem(base),
    compactStem(file.stem),
    compactStem(base),
  ].filter(Boolean);
}

/**
 * Precomputed lookup for exact potential-local matches.
 * Build once per catalog load — never scan the whole folder per card.
 */
export type PotentialMatchIndex = {
  byKey: Map<string, LoraFileEntry[]>;
};

export function buildPotentialMatchIndex(
  index: LoraIndex | null,
): PotentialMatchIndex | null {
  if (!index) return null;
  const byKey = new Map<string, LoraFileEntry[]>();
  for (const file of index.files) {
    for (const key of fileStemKeys(file)) {
      const list = byKey.get(key);
      if (list) list.push(file);
      else byKey.set(key, [file]);
    }
  }
  return { byKey };
}

function matchesFromNeedles(
  files: Iterable<LoraFileEntry>,
  needles: string[],
  allowSimilar: boolean,
): CivitaiLocalMatch[] {
  const matches: CivitaiLocalMatch[] = [];
  const seen = new Set<string>();
  const needleCompacts = needles.map((n) => compactStem(n));

  for (const file of files) {
    const fileStem = normalizeModelStem(file.stem);
    const fileBase = normalizeModelStem(file.stem.split('/').pop() ?? file.stem);
    const fileCompact = compactStem(file.stem);
    const fileBaseCompact = compactStem(
      file.stem.split('/').pop() ?? file.stem,
    );

    for (let i = 0; i < needles.length; i++) {
      const needle = needles[i]!;
      const needleCompact = needleCompacts[i]!;
      let matchKind: CivitaiLocalMatchKind | null = null;
      if (
        fileStem === needle ||
        fileBase === needle ||
        fileCompact === needleCompact ||
        fileBaseCompact === needleCompact
      ) {
        matchKind = 'exact';
      } else if (allowSimilar) {
        const score = Math.max(
          similarityScore(fileStem, needle),
          similarityScore(fileBase, needle),
          similarityScore(fileCompact, needleCompact),
          similarityScore(fileBaseCompact, needleCompact),
        );
        if (score >= 0.72) matchKind = 'similar';
      }
      if (!matchKind) continue;
      const key = file.relativePath.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        relativePath: file.relativePath,
        stem: file.stem,
        matchKind,
      });
      break;
    }
  }

  return matches.sort((a, b) => {
    if (a.matchKind !== b.matchKind) {
      return a.matchKind === 'exact' ? -1 : 1;
    }
    return a.relativePath.localeCompare(b.relativePath);
  });
}

/**
 * Exact-only potential matches via a precomputed index (O(needles) lookups).
 * Used on the browse catalog hot path.
 */
export function findPotentialLocalMatchesExact(
  matchIndex: PotentialMatchIndex | null,
  civitaiFileName: string,
  options?: { modelName?: string },
): CivitaiLocalMatch[] {
  if (!matchIndex || !civitaiFileName.trim()) return [];
  const targetStem = normalizeModelStem(civitaiFileName);
  const nameStem = options?.modelName
    ? normalizeModelStem(options.modelName)
    : '';
  const needles = [...new Set([targetStem, nameStem].filter(Boolean))];
  if (needles.length === 0) return [];

  const candidates: LoraFileEntry[] = [];
  const seen = new Set<string>();
  for (const needle of needles) {
    for (const key of [needle, compactStem(needle)]) {
      const hits = matchIndex.byKey.get(key);
      if (!hits) continue;
      for (const file of hits) {
        const pathKey = file.relativePath.toLowerCase();
        if (seen.has(pathKey)) continue;
        seen.add(pathKey);
        candidates.push(file);
      }
    }
  }
  return matchesFromNeedles(candidates, needles, false);
}

/**
 * Find local files that might already be this Civitai model.
 * Skips when an exact installed stem match already exists (handled separately).
 * Prefer {@link findPotentialLocalMatchesExact} on bulk catalog paths.
 */
export function findPotentialLocalMatches(
  index: LoraIndex | null,
  civitaiFileName: string,
  options?: { modelName?: string },
): CivitaiLocalMatch[] {
  if (!index || !civitaiFileName.trim()) return [];

  const targetStem = normalizeModelStem(civitaiFileName);
  const nameStem = options?.modelName
    ? normalizeModelStem(options.modelName)
    : '';
  const needles = [...new Set([targetStem, nameStem].filter(Boolean))];
  if (needles.length === 0) return [];

  return matchesFromNeedles(index.files, needles, true);
}
