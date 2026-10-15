import { normalizeModelStem } from './civitaiLocalMatch.js';
import { stripLoraExtension } from './lora.js';
import { parseLoraTrainingStep } from './loraSeries.js';

export type CatalogFilenameMatchKind = 'exact' | 'similar';

export type CatalogFilenameMatchCandidate = {
  modelId: number;
  modelName: string;
  pageUrl: string;
  previewUrl?: string;
  /** Catalog filename (or model name) that matched the local stem. */
  matchedFileName: string;
  matchKind: CatalogFilenameMatchKind;
  score: number;
};

export type CatalogFilenameMatchInput = {
  id: number;
  name: string;
  pageUrl: string;
  previewUrl?: string;
  type?: string;
  fileName?: string;
  versions?: Array<{
    fileName?: string;
    files?: Array<{ name?: string }>;
  }>;
};

function compactStem(stem: string): string {
  return normalizeModelStem(stem).replace(/\s+/g, '');
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

/** Local basename without extension, plus series base when it's a step checkpoint. */
export function localStemMatchKeys(localStemOrFileName: string): string[] {
  const stem = stripLoraExtension(localStemOrFileName.trim());
  const base = stem.split(/[/\\]/).pop() ?? stem;
  const keys = new Set<string>([
    normalizeModelStem(base),
    compactStem(base),
  ]);
  const step = parseLoraTrainingStep(base);
  if (step?.seriesBase) {
    keys.add(normalizeModelStem(step.seriesBase));
    keys.add(compactStem(step.seriesBase));
  }
  return [...keys].filter(Boolean);
}

function catalogNameCandidates(model: CatalogFilenameMatchInput): string[] {
  const names: string[] = [];
  if (model.fileName?.trim()) names.push(model.fileName.trim());
  for (const version of model.versions ?? []) {
    if (version.fileName?.trim()) names.push(version.fileName.trim());
    for (const file of version.files ?? []) {
      if (file.name?.trim()) names.push(file.name.trim());
    }
  }
  // Model display name is a weaker signal (used only for similar matches).
  if (model.name?.trim()) names.push(model.name.trim());
  return [...new Set(names)];
}

function scoreAgainstLocal(
  catalogName: string,
  localKeys: string[],
): { matchKind: CatalogFilenameMatchKind; score: number } | null {
  const catalogStem = normalizeModelStem(catalogName);
  const catalogCompact = compactStem(catalogName);
  if (!catalogStem) return null;

  let bestExact = 0;
  let bestSimilar = 0;
  for (const local of localKeys) {
    const localCompact = local.replace(/\s+/g, '');
    if (
      catalogStem === local ||
      catalogCompact === localCompact ||
      catalogCompact === local ||
      catalogStem === localCompact
    ) {
      bestExact = 1;
      break;
    }
    bestSimilar = Math.max(
      bestSimilar,
      similarityScore(catalogStem, local),
      similarityScore(catalogCompact, localCompact),
    );
  }

  // Display-name-only hits must be strong (≥0.85); file stems use 0.72.
  if (bestExact >= 1) return { matchKind: 'exact', score: 1 };
  if (bestSimilar >= 0.72) return { matchKind: 'similar', score: bestSimilar };
  return null;
}

/**
 * Find catalog cards whose stored filename / name matches a local LoRA stem.
 * Does not auto-link — callers must confirm with the user.
 */
export function findCatalogMatchesByLocalFilename(
  models: Iterable<CatalogFilenameMatchInput>,
  localStemOrFileName: string,
  opts?: { type?: 'LORA' | 'Checkpoint'; max?: number },
): CatalogFilenameMatchCandidate[] {
  const localKeys = localStemMatchKeys(localStemOrFileName);
  if (localKeys.length === 0) return [];
  const max = Math.max(1, opts?.max ?? 12);
  const wantType = opts?.type?.toLowerCase();

  const byId = new Map<number, CatalogFilenameMatchCandidate>();

  for (const model of models) {
    if (wantType) {
      const t = (model.type ?? '').toLowerCase();
      if (t) {
        const isLora = t === 'lora' || t.includes('lora');
        const isCkpt = t === 'checkpoint' || t.includes('checkpoint');
        if (wantType === 'lora' && isCkpt && !isLora) continue;
        if (wantType === 'checkpoint' && isLora && !isCkpt) continue;
      }
    }

    let best: CatalogFilenameMatchCandidate | null = null;
    for (const catalogName of catalogNameCandidates(model)) {
      const scored = scoreAgainstLocal(catalogName, localKeys);
      if (!scored) continue;
      // Prefer matches against actual filenames over the model display name.
      const isDisplayName =
        normalizeModelStem(catalogName) === normalizeModelStem(model.name) &&
        !model.fileName &&
        !(model.versions ?? []).some(
          (v) =>
            v.fileName ||
            (v.files ?? []).some((f) => f.name?.trim()),
        );
      const score = isDisplayName
        ? scored.matchKind === 'exact'
          ? scored.score * 0.95
          : scored.score < 0.85
            ? 0
            : scored.score * 0.9
        : scored.score;
      if (score <= 0) continue;
      const candidate: CatalogFilenameMatchCandidate = {
        modelId: model.id,
        modelName: model.name,
        pageUrl: model.pageUrl,
        previewUrl: model.previewUrl,
        matchedFileName: catalogName,
        matchKind: scored.matchKind,
        score,
      };
      if (!best || candidate.score > best.score) best = candidate;
    }
    if (!best) continue;
    const prev = byId.get(best.modelId);
    if (!prev || best.score > prev.score) byId.set(best.modelId, best);
  }

  return [...byId.values()]
    .sort((a, b) => {
      if (a.matchKind !== b.matchKind) {
        return a.matchKind === 'exact' ? -1 : 1;
      }
      if (b.score !== a.score) return b.score - a.score;
      return a.modelName.localeCompare(b.modelName);
    })
    .slice(0, max);
}
