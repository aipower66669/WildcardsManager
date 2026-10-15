/**
 * Civitai AutoV2 = first 10 hex characters of the file SHA-256 (uppercase).
 * Computing AutoV2 still requires hashing the whole file once; we cache the
 * result so subsequent lookups are cheap.
 */

export function normalizeAutoV2(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toUpperCase();
  if (!/^[0-9A-F]{10}$/.test(trimmed)) return null;
  return trimmed;
}

/** Derive AutoV2 from a full SHA-256 hex digest. */
export function autoV2FromSha256(sha256Hex: string): string | null {
  const hex = sha256Hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return hex.slice(0, 10).toUpperCase();
}

/** Read AutoV2 from a Civitai `files[].hashes` object. */
export function pickCivitaiAutoV2(
  hashes: Record<string, string> | null | undefined,
): string | null {
  if (!hashes || typeof hashes !== 'object') return null;
  const direct = normalizeAutoV2(hashes.AutoV2 ?? hashes.autov2);
  if (direct) return direct;
  const fromSha = autoV2FromSha256(hashes.SHA256 ?? hashes.sha256 ?? '');
  return fromSha;
}

/** Unique AutoV2 hashes from every file on every model version. */
export function collectAutoV2HashesFromVersions(
  versions:
    | Array<{ files?: Array<{ hashes?: Record<string, string> }> }>
    | null
    | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const version of versions ?? []) {
    for (const file of version.files ?? []) {
      const h = pickCivitaiAutoV2(file.hashes);
      if (!h || seen.has(h)) continue;
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}

/** Merge AutoV2 lists (normalized, unique, order-preserving). */
export function unionAutoV2Hashes(
  ...lists: Array<Iterable<string> | null | undefined>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    if (!list) continue;
    for (const raw of list) {
      const h = normalizeAutoV2(raw);
      if (!h || seen.has(h)) continue;
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}

/**
 * Parse A1111 / download-helper style hash sidecars (`.txt` next to a model).
 * Prefers AutoV2, else derives it from HASH256 / SHA256. Ignores AutoV1/HASH
 * alone (those are the old 8-char partial hashes).
 */
export function parseAutoV2FromHashSidecarText(text: string): string | null {
  if (!text) return null;

  const autoV2Direct = text.match(
    /^\s*(?:auto\s*v?\s*2|autov2)\s*[:=]\s*([0-9a-fA-F]{10})\s*$/im,
  );
  if (autoV2Direct?.[1]) {
    return normalizeAutoV2(autoV2Direct[1]);
  }

  const shaLines = text.matchAll(
    /^\s*(?:hash\s*256|hash256|sha\s*256|sha256)\s*[:=]\s*([0-9a-fA-F]{64})\s*$/gim,
  );
  for (const m of shaLines) {
    const derived = autoV2FromSha256(m[1] ?? '');
    if (derived) return derived;
  }

  // Loose fallback: any 64-hex token labeled nearby as sha/hash256 in the file.
  const loose = text.match(
    /(?:hash\s*256|hash256|sha\s*256|sha256)[^\n0-9a-fA-F]{0,20}([0-9a-fA-F]{64})/i,
  );
  if (loose?.[1]) return autoV2FromSha256(loose[1]);

  return null;
}
