import path from 'node:path';

/** Folder pointer fields on a library that may need path remapping. */
export const LIBRARY_PATH_FOLDER_FIELDS = [
  'wildcardsRoot',
  'loraFolder',
  'checkpointFolder',
  'imagesFolder',
  'videosFolder',
  'mastersFolder',
  'trainingLibraryFolder',
  'promptsFolder',
  'generationOutputRealistic',
  'generationOutputHentai',
  'generationOutput3d',
  'benchmarkOutputFolder',
] as const;

export type LibraryPathFolderField = (typeof LIBRARY_PATH_FOLDER_FIELDS)[number];

export type LibraryFoldersSnapshot = Record<
  LibraryPathFolderField,
  string | null | undefined
>;

export type FolderRemapPlan = {
  field: LibraryPathFolderField;
  oldPath: string | null;
  newPath: string | null;
  /** True when oldPath was rewritten (prefix or override). */
  changed: boolean;
  /** True when oldPath sat under oldPrefix (before override). */
  underPrefix: boolean;
  /** True when an explicit override supplied the new path. */
  override: boolean;
};

export type LibraryPathMigrationPlan = {
  oldPrefix: string;
  newPrefix: string;
  folders: FolderRemapPlan[];
  warnings: string[];
};

/** Resolve + strip trailing separators (keep filesystem roots intact). */
export function normalizePathPrefix(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  let resolved = path.resolve(trimmed);
  for (;;) {
    if (path.dirname(resolved) === resolved) break;
    if (!/[\\/]$/.test(resolved)) break;
    const next = resolved.replace(/[\\/]+$/, '');
    if (!next || next === resolved) break;
    resolved = next;
  }
  return resolved;
}

function compareKey(absolutePath: string): string {
  const n = normalizePathPrefix(absolutePath);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

/** True when `absolutePath` equals `prefix` or is nested under it. */
export function isPathEqualOrUnder(
  absolutePath: string,
  prefix: string,
): boolean {
  const a = compareKey(absolutePath);
  const p = compareKey(prefix);
  if (!a || !p) return false;
  if (a === p) return true;
  const sep = path.sep;
  const withSep = p.endsWith(sep) ? p : p + sep;
  return a.startsWith(withSep);
}

/**
 * Remap `absolutePath` from under `oldPrefix` onto `newPrefix`.
 * Returns null when the path is not under the old prefix.
 */
export function remapPathUnderPrefix(
  absolutePath: string,
  oldPrefix: string,
  newPrefix: string,
): string | null {
  const abs = normalizePathPrefix(absolutePath);
  const oldN = normalizePathPrefix(oldPrefix);
  const newN = normalizePathPrefix(newPrefix);
  if (!abs || !oldN || !newN) return null;
  if (!isPathEqualOrUnder(abs, oldN)) return null;
  if (compareKey(abs) === compareKey(oldN)) return newN;
  const rel = path.relative(oldN, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return newN;
  return path.join(newN, rel);
}

/**
 * Longest common directory prefix of the given absolute paths.
 * Returns null when paths are empty or span different drive roots.
 */
export function longestCommonPathPrefix(
  paths: Array<string | null | undefined>,
): string | null {
  const norms = [
    ...new Set(
      paths
        .filter((p): p is string => Boolean(p?.trim()))
        .map((p) => normalizePathPrefix(p)),
    ),
  ].filter(Boolean);
  if (norms.length === 0) return null;
  if (norms.length === 1) return norms[0]!;

  const split = (p: string) => {
    const root = path.parse(p).root;
    const rest = p.slice(root.length).split(/[\\/]/).filter(Boolean);
    return { root, rest };
  };
  const parsed = norms.map(split);
  const rootKey = compareKey(parsed[0]!.root);
  if (!parsed.every((row) => compareKey(row.root) === rootKey)) return null;

  const first = parsed[0]!.rest;
  let depth = 0;
  while (depth < first.length) {
    const segKey =
      process.platform === 'win32'
        ? first[depth]!.toLowerCase()
        : first[depth]!;
    if (
      !parsed.every((row) => {
        const seg = row.rest[depth];
        if (seg == null) return false;
        return (
          (process.platform === 'win32' ? seg.toLowerCase() : seg) === segKey
        );
      })
    ) {
      break;
    }
    depth += 1;
  }

  if (depth === 0) {
    // Shared drive root only (e.g. `D:\`).
    return normalizePathPrefix(parsed[0]!.root);
  }
  return path.join(parsed[0]!.root, ...first.slice(0, depth));
}

/**
 * Old-prefix to offer for path migration. Never returns null when any folder
 * path is set — cross-drive layouts fall back to the preferred path's drive
 * (usually wildcards), then any single folder.
 */
export function suggestMigrationOldPrefix(
  folders: Array<string | null | undefined>,
  preferred?: string | null,
): string | null {
  const norms = [
    ...new Set(
      folders
        .filter((p): p is string => Boolean(p?.trim()))
        .map((p) => normalizePathPrefix(p)),
    ),
  ].filter(Boolean);
  if (norms.length === 0) return null;

  const allLcp = longestCommonPathPrefix(norms);
  if (allLcp) return allLcp;

  const preferredNorm = preferred?.trim()
    ? normalizePathPrefix(preferred)
    : null;
  const preferredRoot = preferredNorm
    ? compareKey(path.parse(preferredNorm).root)
    : null;

  const byRoot = new Map<string, string[]>();
  for (const p of norms) {
    const key = compareKey(path.parse(p).root);
    const list = byRoot.get(key);
    if (list) list.push(p);
    else byRoot.set(key, [p]);
  }

  let bestGroup: string[] | null = null;
  for (const [rootKey, group] of byRoot) {
    if (preferredRoot && rootKey === preferredRoot) {
      bestGroup = group;
      break;
    }
    if (!bestGroup || group.length > bestGroup.length) bestGroup = group;
  }
  const groupLcp = bestGroup ? longestCommonPathPrefix(bestGroup) : null;
  if (groupLcp) return groupLcp;
  if (preferredNorm) return preferredNorm;
  return norms[0] ?? null;
}

export type PlanLibraryPathMigrationInput = {
  folders: LibraryFoldersSnapshot;
  oldPrefix: string;
  newPrefix: string;
  /** Explicit new path per field (wins over prefix remap). */
  folderOverrides?: Partial<Record<LibraryPathFolderField, string | null>>;
};

/**
 * Pure remap plan for library folder pointers. Existence checks stay in main.
 */
export function planLibraryPathMigration(
  input: PlanLibraryPathMigrationInput,
): LibraryPathMigrationPlan {
  const oldPrefix = normalizePathPrefix(input.oldPrefix);
  const newPrefix = normalizePathPrefix(input.newPrefix);
  const warnings: string[] = [];
  const folders: FolderRemapPlan[] = [];

  if (!oldPrefix) warnings.push('Old path prefix is empty.');
  if (!newPrefix) warnings.push('New path prefix is empty.');
  if (oldPrefix && newPrefix && compareKey(oldPrefix) === compareKey(newPrefix)) {
    warnings.push('Old and new prefixes are the same path.');
  }

  for (const field of LIBRARY_PATH_FOLDER_FIELDS) {
    const raw = input.folders[field];
    const oldPath = raw?.trim() ? normalizePathPrefix(raw) : null;
    const overrideRaw = input.folderOverrides?.[field];
    const hasOverride = overrideRaw !== undefined;
    const underPrefix = Boolean(
      oldPath && oldPrefix && isPathEqualOrUnder(oldPath, oldPrefix),
    );

    let newPath: string | null = oldPath;
    let override = false;
    if (hasOverride) {
      override = true;
      newPath = overrideRaw?.trim()
        ? normalizePathPrefix(overrideRaw)
        : null;
    } else if (oldPath && oldPrefix && newPrefix && underPrefix) {
      newPath = remapPathUnderPrefix(oldPath, oldPrefix, newPrefix) ?? oldPath;
    } else if (oldPath && oldPrefix && !underPrefix) {
      warnings.push(
        `${field} is outside the old prefix and will keep its current path unless you set an override.`,
      );
    }

    const samePath =
      oldPath == null && newPath == null
        ? true
        : Boolean(
            oldPath &&
              newPath &&
              compareKey(oldPath) === compareKey(newPath),
          );

    folders.push({
      field,
      oldPath,
      newPath,
      changed: !samePath,
      underPrefix,
      override,
    });
  }

  if (
    folders.every((f) => !f.changed) &&
    oldPrefix &&
    newPrefix &&
    compareKey(oldPrefix) !== compareKey(newPrefix)
  ) {
    warnings.push(
      'No folder pointers would change. Check the old prefix covers your library folders.',
    );
  }

  return { oldPrefix, newPrefix, folders, warnings };
}

export type MasterImagesEntryLike = {
  masterAbsolutePath: string;
  genAbsolutePaths: string[];
  mastersFolder: string;
  resolvedAt?: string;
};

export type MasterImagesStoreLike = {
  version?: number;
  byPath: Record<string, MasterImagesEntryLike>;
  byAutoV2: Record<string, MasterImagesEntryLike>;
};

function remapMasterEntry(
  entry: MasterImagesEntryLike,
  oldPrefix: string,
  newPrefix: string,
): { entry: MasterImagesEntryLike; changed: boolean } {
  let changed = false;
  const remapOne = (p: string): string => {
    const next = remapPathUnderPrefix(p, oldPrefix, newPrefix);
    if (next && compareKey(next) !== compareKey(p)) {
      changed = true;
      return next;
    }
    return path.resolve(p);
  };
  return {
    entry: {
      ...entry,
      masterAbsolutePath: remapOne(entry.masterAbsolutePath),
      genAbsolutePaths: entry.genAbsolutePaths.map(remapOne),
      mastersFolder: remapOne(entry.mastersFolder),
    },
    changed,
  };
}

/** Rewrite absolute paths inside a master-images store (pure). */
export function remapMasterImagesStore(
  store: MasterImagesStoreLike,
  oldPrefix: string,
  newPrefix: string,
): { store: MasterImagesStoreLike; remappedEntries: number } {
  const byPath: Record<string, MasterImagesEntryLike> = {};
  const byAutoV2: Record<string, MasterImagesEntryLike> = {};
  let remappedEntries = 0;

  for (const [key, entry] of Object.entries(store.byPath ?? {})) {
    const { entry: next, changed } = remapMasterEntry(
      entry,
      oldPrefix,
      newPrefix,
    );
    if (changed) remappedEntries += 1;
    const newKey =
      remapPathUnderPrefix(key, oldPrefix, newPrefix) ?? path.resolve(key);
    byPath[newKey.toLowerCase()] = next;
  }

  for (const [hash, entry] of Object.entries(store.byAutoV2 ?? {})) {
    const { entry: next, changed } = remapMasterEntry(
      entry,
      oldPrefix,
      newPrefix,
    );
    if (changed) remappedEntries += 1;
    byAutoV2[hash] = next;
  }

  return {
    store: {
      version: store.version,
      byPath,
      byAutoV2,
    },
    remappedEntries,
  };
}

/** Remap `trainingLibraryRoot` when it sits under the old prefix. */
export function remapTrainingLibraryRoot(
  trainingLibraryRoot: string,
  oldPrefix: string,
  newPrefix: string,
): { next: string; changed: boolean } {
  if (!trainingLibraryRoot.trim()) {
    return { next: trainingLibraryRoot, changed: false };
  }
  const remapped = remapPathUnderPrefix(
    trainingLibraryRoot,
    oldPrefix,
    newPrefix,
  );
  if (!remapped) {
    return { next: trainingLibraryRoot, changed: false };
  }
  return {
    next: remapped,
    changed: compareKey(remapped) !== compareKey(trainingLibraryRoot),
  };
}

/** Remap entries in `recentRoots` that sit under the old prefix. */
export function remapRecentRoots(
  recentRoots: string[],
  oldPrefix: string,
  newPrefix: string,
): { next: string[]; remappedCount: number } {
  let remappedCount = 0;
  const next = recentRoots.map((root) => {
    const remapped = remapPathUnderPrefix(root, oldPrefix, newPrefix);
    if (remapped && compareKey(remapped) !== compareKey(root)) {
      remappedCount += 1;
      return remapped;
    }
    return root;
  });
  return { next, remappedCount };
}
