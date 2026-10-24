import {
  collectAutoV2HashesFromVersions,
  normalizeAutoV2,
  pickCivitaiAutoV2,
  unionAutoV2Hashes,
} from './modelHash.js';
import { resolveVersionBaseModel } from './civitaiBaseModels.js';
import {
  isEarlyAccessActive,
  isVersionEarlyAccess,
  mergeEarlyAccessFlag,
  resolveEarlyAccessEndsAt,
  type EarlyAccessVersionFields,
} from './civitaiEarlyAccess.js';

/** One weight file under a Civitai model version. */
export type CivitaiFileHashSnapshot = {
  versionId: number;
  versionName: string;
  baseModel?: string;
  fileId?: number;
  fileName?: string;
  /** Short label (nf4, fp8, …) when distinguishable. */
  variantLabel?: string;
  autoV2?: string;
  primary: boolean;
  earlyAccess?: boolean;
  earlyAccessEndsAt?: string;
};

/** Per-version AutoV2 snapshot stored on catalog cards (with file variants). */
export type CivitaiVersionHashSnapshot = {
  id: number;
  name: string;
  baseModel?: string;
  fileName?: string;
  /** Primary weight file AutoV2 for this version. */
  autoV2?: string;
  /** All weight-file AutoV2 hashes on this version. */
  autoV2Hashes: string[];
  earlyAccess?: boolean;
  earlyAccessEndsAt?: string;
  /** Buzz cost to unlock download while EA is active (0 / omit when free). */
  downloadPrice?: number;
  files?: Array<{
    id?: number;
    name: string;
    autoV2?: string;
    primary: boolean;
    variantLabel?: string;
    sizeKB?: number;
  }>;
};

type FileLike = {
  id?: number;
  name?: string;
  primary?: boolean;
  downloadUrl?: string;
  hashes?: Record<string, string>;
  sizeKB?: number;
  sizeInKb?: number;
  size?: number;
};

type VersionLike = EarlyAccessVersionFields & {
  id: number;
  name?: string;
  baseModel?: string;
  files?: FileLike[];
};

const WEIGHT_EXT = /\.(safetensors|ckpt|pt)$/i;
const VARIANT_TOKEN =
  /(?:^|[_\-.])(nf4|fp8(?:[_-]?e4m3)?|fp16|bf16|int8|q[34568]|gguf)(?:$|[_\-.])/i;

function isWeightFile(file: FileLike): boolean {
  if (!file.name) return false;
  return (
    file.primary === true ||
    WEIGHT_EXT.test(file.name) ||
    Boolean(file.downloadUrl)
  );
}

/** Derive a short variant label from a weight filename. */
export function variantLabelFromFileName(
  fileName: string | undefined,
  versionName?: string,
): string | undefined {
  if (!fileName) return undefined;
  const stem = fileName.replace(WEIGHT_EXT, '');
  const token = stem.match(VARIANT_TOKEN)?.[1];
  if (token) return token.replace(/_/g, '-');
  const ver = (versionName ?? '').trim().toLowerCase();
  if (ver && stem.toLowerCase() !== ver && !stem.toLowerCase().includes(ver)) {
    // Filename is meaningfully different from the version name.
    return stem.length > 28 ? `${stem.slice(0, 26)}…` : stem;
  }
  return undefined;
}

function pickWeightFiles(version: VersionLike): FileLike[] {
  const weights = (version.files ?? []).filter(isWeightFile);
  const raw =
    weights.length > 0
      ? weights
      : (version.files ?? []).filter((f) => Boolean(f.name));
  return dedupeFilesByName(raw);
}

/** Prefer the entry with a numeric id / AutoV2 when the same filename appears twice. */
export function dedupeFilesByName<T extends { id?: number; name?: string }>(
  files: T[],
): T[] {
  const byName = new Map<string, T>();
  for (const file of files) {
    const name = file.name?.trim().toLowerCase();
    if (!name) continue;
    const prev = byName.get(name);
    if (!prev) {
      byName.set(name, file);
      continue;
    }
    const prevHasId = typeof prev.id === 'number' && Number.isFinite(prev.id);
    const nextHasId = typeof file.id === 'number' && Number.isFinite(file.id);
    // Keep the richer row (id wins; otherwise later wins so API refresh sticks).
    byName.set(name, !prevHasId && nextHasId ? file : { ...prev, ...file });
  }
  return [...byName.values()];
}

export function readFileSizeKB(file: {
  sizeKB?: unknown;
  sizeInKb?: unknown;
  size?: unknown;
}): number | undefined {
  if (typeof file.sizeKB === 'number' && Number.isFinite(file.sizeKB) && file.sizeKB > 0) {
    return file.sizeKB;
  }
  if (
    typeof file.sizeInKb === 'number' &&
    Number.isFinite(file.sizeInKb) &&
    file.sizeInKb > 0
  ) {
    return file.sizeInKb;
  }
  // Some payloads use raw bytes.
  if (typeof file.size === 'number' && Number.isFinite(file.size) && file.size > 1024) {
    return file.size / 1024;
  }
  return undefined;
}

/** Collapse duplicate download-picker rows (same version + filename). */
export function dedupeDownloadPicks<
  T extends { versionId: number; fileId?: number; fileName?: string; key?: string },
>(picks: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const pick of picks) {
    const name = pick.fileName?.trim().toLowerCase() || '';
    const key =
      name.length > 0
        ? `${pick.versionId}:${name}`
        : typeof pick.fileId === 'number' && pick.fileId > 0
          ? `${pick.versionId}:id:${pick.fileId}`
          : pick.key ?? `${pick.versionId}:${out.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pick);
  }
  return out;
}

/** Flat file snapshots (newest version first; primary file first within version). */
export function fileSnapshotsFromModelVersions(
  versions: VersionLike[] | null | undefined,
): CivitaiFileHashSnapshot[] {
  const out: CivitaiFileHashSnapshot[] = [];
  for (const version of versions ?? []) {
    if (typeof version.id !== 'number' || !Number.isFinite(version.id)) {
      continue;
    }
    const versionName = version.name?.trim() || `Version ${version.id}`;
    const earlyAccessEndsAt = resolveEarlyAccessEndsAt(version);
    const earlyAccess = isVersionEarlyAccess(version);
    const files = pickWeightFiles(version);
    const ordered = [...files].sort((a, b) => {
      if (a.primary === b.primary) return 0;
      return a.primary ? -1 : 1;
    });
    for (const file of ordered) {
      if (!file.name) continue;
      out.push({
        versionId: version.id,
        versionName,
        baseModel: version.baseModel,
        fileId: typeof file.id === 'number' ? file.id : undefined,
        fileName: file.name,
        variantLabel: variantLabelFromFileName(file.name, versionName),
        autoV2: pickCivitaiAutoV2(file.hashes) ?? undefined,
        primary: Boolean(file.primary),
        earlyAccess,
        earlyAccessEndsAt: earlyAccessEndsAt || undefined,
      });
    }
  }
  return out;
}

/** Build version snapshots from a Civitai model payload (order = API order). */
export function snapshotsFromModelVersions(
  versions: VersionLike[] | null | undefined,
): CivitaiVersionHashSnapshot[] {
  const out: CivitaiVersionHashSnapshot[] = [];
  for (const version of versions ?? []) {
    if (typeof version.id !== 'number' || !Number.isFinite(version.id)) {
      continue;
    }
    const files = pickWeightFiles(version);
    const hashes = collectAutoV2HashesFromVersions([{ files }]);
    const primaryFile =
      files.find((f) => f.primary) ?? files[0] ?? undefined;
    const autoV2 =
      pickCivitaiAutoV2(primaryFile?.hashes) ?? hashes[0] ?? undefined;
    const earlyAccessEndsAt = resolveEarlyAccessEndsAt(version);
    const versionName = version.name?.trim() || `Version ${version.id}`;
    const downloadPrice =
      typeof version.earlyAccessConfig?.downloadPrice === 'number' &&
      version.earlyAccessConfig.downloadPrice > 0
        ? version.earlyAccessConfig.downloadPrice
        : undefined;
    out.push({
      id: version.id,
      name: versionName,
      baseModel: version.baseModel,
      fileName: primaryFile?.name,
      autoV2,
      autoV2Hashes: hashes,
      earlyAccess: isVersionEarlyAccess(version),
      earlyAccessEndsAt: earlyAccessEndsAt || undefined,
      downloadPrice,
      files: files
        .filter((f): f is FileLike & { name: string } => Boolean(f.name))
        .map((f) => ({
          id: typeof f.id === 'number' ? f.id : undefined,
          name: f.name,
          autoV2: pickCivitaiAutoV2(f.hashes) ?? undefined,
          primary: Boolean(f.primary),
          variantLabel: variantLabelFromFileName(f.name, versionName),
          sizeKB: readFileSizeKB(f),
        })),
    });
  }
  return out;
}

/** Merge version snapshots by id; incoming wins on overlap; preserve incoming order. */
export function mergeVersionSnapshots(
  existing: CivitaiVersionHashSnapshot[] | null | undefined,
  incoming: CivitaiVersionHashSnapshot[] | null | undefined,
): CivitaiVersionHashSnapshot[] | undefined {
  if (!incoming?.length) return existing?.length ? existing : undefined;
  if (!existing?.length) return incoming;
  const byId = new Map(existing.map((v) => [v.id, v]));
  const out: CivitaiVersionHashSnapshot[] = [];
  const seen = new Set<number>();
  for (const next of incoming) {
    const prev = byId.get(next.id);
    const mergedFiles = mergeFileLists(prev?.files, next.files);
    out.push(
      prev
        ? {
            ...prev,
            ...next,
            autoV2Hashes: unionAutoV2Hashes(prev.autoV2Hashes, next.autoV2Hashes),
            autoV2: next.autoV2 ?? prev.autoV2,
            fileName: next.fileName ?? prev.fileName,
            name: next.name || prev.name,
            baseModel: next.baseModel ?? prev.baseModel,
            earlyAccessEndsAt:
              next.earlyAccessEndsAt ?? prev.earlyAccessEndsAt,
            downloadPrice:
              typeof next.downloadPrice === 'number' && next.downloadPrice > 0
                ? next.downloadPrice
                : typeof prev.downloadPrice === 'number' &&
                    prev.downloadPrice > 0 &&
                  // Cleared EA with a past end should drop the price residue.
                  !(
                    next.earlyAccessEndsAt &&
                    !isEarlyAccessActive(true, next.earlyAccessEndsAt)
                  ) &&
                  !(
                    prev.earlyAccessEndsAt &&
                    !isEarlyAccessActive(true, prev.earlyAccessEndsAt)
                  )
                ? prev.downloadPrice
                : next.downloadPrice,
            earlyAccess: mergeEarlyAccessFlag({
              prev:
                prev.earlyAccess ||
                (typeof prev.downloadPrice === 'number' &&
                  prev.downloadPrice > 0),
              next:
                next.earlyAccess ||
                (typeof next.downloadPrice === 'number' &&
                  next.downloadPrice > 0),
              prevEndsAt: prev.earlyAccessEndsAt,
              nextEndsAt: next.earlyAccessEndsAt,
            }),
            files: mergedFiles,
          }
        : next,
    );
    seen.add(next.id);
  }
  for (const prev of existing) {
    if (seen.has(prev.id)) continue;
    out.push(prev);
  }
  return out;
}

function mergeFileLists(
  existing:
    | NonNullable<CivitaiVersionHashSnapshot['files']>
    | null
    | undefined,
  incoming:
    | NonNullable<CivitaiVersionHashSnapshot['files']>
    | null
    | undefined,
): NonNullable<CivitaiVersionHashSnapshot['files']> | undefined {
  if (!incoming?.length) return existing?.length ? existing : undefined;
  if (!existing?.length) return dedupeFilesByName(incoming);
  // Key by filename so an id-bearing row and a name-only row for the same
  // weight do not both survive (that was duplicating download-picker entries).
  const byName = new Map(
    existing.map((f) => [f.name.trim().toLowerCase(), f]),
  );
  for (const next of incoming) {
    const key = next.name.trim().toLowerCase();
    const prev = byName.get(key);
    byName.set(
      key,
      prev
        ? {
            ...prev,
            ...next,
            id: next.id ?? prev.id,
            autoV2: next.autoV2 ?? prev.autoV2,
            variantLabel: next.variantLabel ?? prev.variantLabel,
            sizeKB: next.sizeKB ?? prev.sizeKB,
          }
        : next,
    );
  }
  return [...byName.values()];
}

/** Display label for a version+variant option. */
export function formatVersionVariantLabel(opts: {
  versionName: string;
  variantLabel?: string;
  fileName?: string;
}): string {
  if (opts.variantLabel) return `${opts.versionName} · ${opts.variantLabel}`;
  if (opts.fileName) {
    const stem = opts.fileName.replace(WEIGHT_EXT, '');
    if (stem.toLowerCase() !== opts.versionName.trim().toLowerCase()) {
      return `${opts.versionName} · ${stem}`;
    }
  }
  return opts.versionName;
}

type VersionInstallRow = {
  versionId: number;
  installed: boolean;
  baseModel?: string;
  versionName?: string;
  name?: string;
  earlyAccess?: boolean;
  earlyAccessEndsAt?: string;
};

/** Same base model shares a group. Missing base model stays one legacy group. */
function groupVersionInstalls<T extends VersionInstallRow>(
  rows: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = (resolveVersionBaseModel(row) ?? '').trim().toLowerCase();
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/**
 * AutoV2 hashes that may attribute a local file to one version row.
 *
 * Multi-version cards must never fall back to the whole model hash bag — that
 * made the tip (first / newest) look installed whenever *any* older version
 * was on disk, hiding real updates. Thin single-version catalog rows still
 * use the model-level bag.
 */
export function hashesForVersionInstallMatch(opts: {
  fileHashes: Array<string | undefined | null>;
  versionCount: number;
  isTipVersion: boolean;
  tipPrimaryAutoV2?: string | null;
  allModelAutoV2Hashes?: Array<string | undefined | null>;
}): string[] | null {
  const fileHashes = unionAutoV2Hashes(
    opts.fileHashes.filter((h): h is string => typeof h === 'string'),
  );
  const tipPrimary = normalizeAutoV2(opts.tipPrimaryAutoV2);
  const modelBag = unionAutoV2Hashes(
    (opts.allModelAutoV2Hashes ?? []).filter(
      (h): h is string => typeof h === 'string',
    ),
  );

  if (opts.versionCount <= 1) {
    const merged = unionAutoV2Hashes(fileHashes, modelBag);
    return merged.length > 0 ? merged : null;
  }

  if (fileHashes.length > 0) return fileHashes;
  // Tip snap omitted hashes: allow only the tip primary AutoV2, never every
  // historical hash on the card.
  if (opts.isTipVersion && tipPrimary) return [tipPrimary];
  return null;
}

function groupHasLatestInstalled(
  rows: Array<{ versionId: number; installed: boolean }>,
): boolean {
  const latestId = Math.max(...rows.map((row) => row.versionId));
  return rows.some((row) => row.versionId === latestId && row.installed);
}

/**
 * True when every base model you already have is current.
 * A missing sibling architecture (Illustrious while Krea 2 is installed) is
 * not an older install. Missing quants of the newest version are not either.
 */
export function isLatestVersionLocallyInstalled(
  versionInstalls: VersionInstallRow[],
  _opts?: {
    fallbackVersionId?: number | null;
  },
): boolean {
  if (versionInstalls.length === 0) return false;
  let anyInstalledGroup = false;
  for (const group of groupVersionInstalls(versionInstalls).values()) {
    if (!group.some((row) => row.installed)) continue;
    anyInstalledGroup = true;
    if (!groupHasLatestInstalled(group)) return false;
  }
  return anyInstalledGroup;
}

/**
 * True when a strictly newer version of a base model you already have is
 * missing. Sibling quants of that version are not updates. A different base
 * model (Illustrious vs Krea 2) is not an update either.
 */
export function hasNewerVersionUpdate(
  versionInstalls: VersionInstallRow[],
): boolean {
  if (versionInstalls.length === 0) return false;
  for (const group of groupVersionInstalls(versionInstalls).values()) {
    const latestId = Math.max(...group.map((row) => row.versionId));
    if (group.some((row) => row.versionId === latestId && row.installed)) {
      continue;
    }
    if (group.some((row) => row.versionId < latestId && row.installed)) {
      return true;
    }
  }
  return false;
}

/**
 * True when every version the card can download right now is installed.
 * Early-access rows are skipped. No downloadable row means false, so a
 * version added later that is not installed is not treated as done.
 */
export function everyListedDownloadableVersionInstalled(
  rows: Array<{ installed: boolean; earlyAccess?: boolean }>,
): boolean {
  const downloadable = rows.filter((row) => !row.earlyAccess);
  return (
    downloadable.length > 0 && downloadable.every((row) => row.installed)
  );
}

/** Update / Notify chrome for the versions visible on the current base-model chip. */
export function installFlagsForVersions(
  rows: VersionInstallRow[],
): {
  latestVersionInstalled: boolean;
  updateAvailable: boolean;
  notifyEarlyAccess: boolean;
  hasDownloadableVersion: boolean;
} {
  if (rows.length === 0) {
    return {
      latestVersionInstalled: true,
      updateAvailable: false,
      notifyEarlyAccess: false,
      hasDownloadableVersion: false,
    };
  }
  const anyInstalled = rows.some((row) => row.installed);
  const updateAvailable = hasNewerVersionUpdate(rows);
  return {
    latestVersionInstalled: anyInstalled && !updateAvailable,
    updateAvailable,
    notifyEarlyAccess: rows.some(
      (row) =>
        !row.installed &&
        isEarlyAccessActive(Boolean(row.earlyAccess), row.earlyAccessEndsAt),
    ),
    hasDownloadableVersion: rows.some(
      (row) =>
        !row.installed &&
        !isEarlyAccessActive(Boolean(row.earlyAccess), row.earlyAccessEndsAt),
    ),
  };
}
