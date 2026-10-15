/**
 * Pure helpers for global library search (wildcard name + content).
 */

export type WildcardNameHit = {
  kind: 'wildcard-name';
  relativePath: string;
  name: string;
};

export type WildcardContentHit = {
  kind: 'wildcard-content';
  relativePath: string;
  name: string;
  /** 1-based line number. */
  line: number;
  snippet: string;
};

export type WildcardSearchFile = {
  relativePath: string;
  name: string;
  text: string;
};

const SNIPPET_MAX = 120;

function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

function clipSnippet(line: string, queryLower: string): string {
  const trimmed = line.trim();
  if (trimmed.length <= SNIPPET_MAX) return trimmed;
  const idx = trimmed.toLowerCase().indexOf(queryLower);
  if (idx < 0) return `${trimmed.slice(0, SNIPPET_MAX - 1)}…`;
  const start = Math.max(0, idx - 24);
  const end = Math.min(trimmed.length, start + SNIPPET_MAX);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < trimmed.length ? '…' : '';
  return `${prefix}${trimmed.slice(start, end)}${suffix}`;
}

/**
 * Case-insensitive substring search over wildcard file names/paths and text.
 * Caps name hits and content hits separately.
 */
export function searchWildcardFiles(
  files: WildcardSearchFile[],
  rawQuery: string,
  limitPerKind = 100,
): { nameHits: WildcardNameHit[]; contentHits: WildcardContentHit[] } {
  const query = normalizeQuery(rawQuery);
  if (!query) return { nameHits: [], contentHits: [] };

  const limit = Math.max(1, limitPerKind);
  const nameHits: WildcardNameHit[] = [];
  const contentHits: WildcardContentHit[] = [];

  for (const file of files) {
    const pathKey = file.relativePath.toLowerCase();
    const nameKey = file.name.toLowerCase();
    if (
      nameHits.length < limit &&
      (pathKey.includes(query) || nameKey.includes(query))
    ) {
      nameHits.push({
        kind: 'wildcard-name',
        relativePath: file.relativePath,
        name: file.name,
      });
    }

    if (contentHits.length >= limit) {
      if (nameHits.length >= limit) break;
      continue;
    }

    const lines = file.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (contentHits.length >= limit) break;
      const line = lines[i]!;
      if (!line.toLowerCase().includes(query)) continue;
      contentHits.push({
        kind: 'wildcard-content',
        relativePath: file.relativePath,
        name: file.name,
        line: i + 1,
        snippet: clipSnippet(line, query),
      });
    }
  }

  nameHits.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { nameHits, contentHits };
}

export type GenSearchFile = {
  relativeFolder: string;
  text: string;
};

export type PromptNameHit = {
  kind: 'prompt-name';
  relativeFolder: string;
  relativePath: string;
};

export type PromptContentHit = {
  kind: 'prompt-content';
  relativeFolder: string;
  relativePath: string;
  /** 1-based line number in `!gen.txt`. */
  line: number;
  snippet: string;
};

function genRelativePath(relativeFolder: string): string {
  return relativeFolder ? `${relativeFolder}/!gen.txt` : '!gen.txt';
}

function folderFromGenPath(relativePath: string): string {
  if (relativePath === '!gen.txt') return '';
  return relativePath.replace(/\/!gen\.txt$/i, '');
}

/** Case-insensitive search of prompt-folder paths and `!gen.txt` lines. */
export function searchGenFiles(
  files: GenSearchFile[],
  rawQuery: string,
  limitPerKind = 100,
): { nameHits: PromptNameHit[]; contentHits: PromptContentHit[] } {
  const mapped = files.map((file) => ({
    relativePath: genRelativePath(file.relativeFolder),
    name: file.relativeFolder || '!gen.txt',
    text: file.text,
  }));
  const { nameHits, contentHits } = searchWildcardFiles(
    mapped,
    rawQuery,
    limitPerKind,
  );
  return {
    nameHits: nameHits.map((hit) => ({
      kind: 'prompt-name',
      relativeFolder: folderFromGenPath(hit.relativePath),
      relativePath: hit.relativePath,
    })),
    contentHits: contentHits.map((hit) => ({
      kind: 'prompt-content',
      relativeFolder: folderFromGenPath(hit.relativePath),
      relativePath: hit.relativePath,
      line: hit.line,
      snippet: hit.snippet,
    })),
  };
}
