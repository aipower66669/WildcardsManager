/** Early-access end-time helpers shared by main (API) and tests. */

export type EarlyAccessVersionFields = {
  /** Legacy public-API field (often null on paid-EA / Buzz models). */
  earlyAccessEndsAt?: string | null;
  /**
   * Newer website / tRPC field (same meaning as earlyAccessEndsAt).
   * Public REST frequently omits this even when the site shows a countdown.
   */
  earlyAccessDeadline?: string | null;
  /** Newer paid early-access block from the model page payload. */
  paidAccess?: {
    endsAt?: string | null;
    timeframeDays?: number;
  } | null;
  availability?: string;
  publishedAt?: string | null;
  createdAt?: string | null;
  earlyAccessConfig?: {
    timeframe?: number;
    originalPublishedAt?: string;
    downloadPrice?: number;
    generationPrice?: number;
    chargeForDownload?: boolean;
    chargeForGeneration?: boolean;
  } | null;
  /**
   * Mini / authenticated version payloads: true while the resource is gated
   * (active EA or private).
   */
  checkPermission?: boolean | null;
};

function coerceIso(raw: string | null | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return undefined;
  return new Date(ts).toISOString();
}

/**
 * Resolve early-access end time from version fields, or derive it from
 * timeframe (days) + publish start.
 *
 * Civitai has shuffled field names: REST may only expose `availability`,
 * while the site uses `earlyAccessDeadline` / `paidAccess.endsAt`.
 */
export function resolveEarlyAccessEndsAt(
  version: EarlyAccessVersionFields | undefined,
): string | undefined {
  if (!version) return undefined;

  const direct =
    coerceIso(version.earlyAccessEndsAt) ||
    coerceIso(version.earlyAccessDeadline) ||
    coerceIso(version.paidAccess?.endsAt ?? undefined);
  if (direct) return direct;

  const days =
    (typeof version.paidAccess?.timeframeDays === 'number'
      ? version.paidAccess.timeframeDays
      : undefined) ??
    (typeof version.earlyAccessConfig?.timeframe === 'number'
      ? version.earlyAccessConfig.timeframe
      : undefined);
  const startRaw =
    version.earlyAccessConfig?.originalPublishedAt ||
    version.publishedAt ||
    version.createdAt ||
    undefined;
  if (typeof days === 'number' && days > 0 && startRaw) {
    const start = Date.parse(startRaw);
    if (Number.isFinite(start)) {
      return new Date(start + days * 24 * 60 * 60 * 1000).toISOString();
    }
  }
  return undefined;
}

/**
 * Whether early access is still active. A known end time always wins: once it
 * has passed, the model is downloadable even if a stale catalog flag or API
 * `availability: EarlyAccess` still says otherwise.
 */
export function isEarlyAccessActive(
  earlyAccessFlag: boolean,
  earlyAccessEndsAt?: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (earlyAccessEndsAt) {
    const ts = Date.parse(earlyAccessEndsAt);
    if (Number.isFinite(ts)) return ts > nowMs;
  }
  return Boolean(earlyAccessFlag);
}

/**
 * Paid Buzz signals that ignore countdown expiry. Used when a past `endsAt`
 * alone must not unlock Notify without a live page/API confirm — leftover
 * price on free models is common, but active `chargeForDownload` / price on
 * the latest snap still means “don’t auto-unlock from catalog time”.
 */
export function versionHasPaidBuzzResidue(
  version:
    | Pick<EarlyAccessVersionFields, 'earlyAccessConfig'>
    | { downloadPrice?: number | null }
    | undefined
    | null,
): boolean {
  if (!version) return false;
  if (
    'downloadPrice' in version &&
    typeof version.downloadPrice === 'number' &&
    version.downloadPrice > 0
  ) {
    return true;
  }
  if (!('earlyAccessConfig' in version)) return false;
  const cfg = version.earlyAccessConfig;
  if (!cfg || typeof cfg !== 'object') return false;
  if (cfg.chargeForDownload === true) return true;
  if (typeof cfg.downloadPrice === 'number' && cfg.downloadPrice > 0) {
    return true;
  }
  return false;
}

/**
 * Merge catalog EA booleans. Thin list payloads often send `earlyAccess: false`
 * for paid Buzz models that are still gated — never demote a known `true`
 * unless a past end time proves unlock.
 */
export function mergeEarlyAccessFlag(opts: {
  prev?: boolean;
  next?: boolean;
  prevEndsAt?: string | null;
  nextEndsAt?: string | null;
  nowMs?: number;
}): boolean | undefined {
  const ends = opts.nextEndsAt ?? opts.prevEndsAt;
  if (ends && !isEarlyAccessActive(true, ends, opts.nowMs)) {
    return false;
  }
  if (opts.prev === true && opts.next !== true) {
    return true;
  }
  if (opts.next !== undefined) return opts.next;
  return opts.prev;
}

function availabilityToken(
  version: EarlyAccessVersionFields | undefined,
): string {
  return (version?.availability ?? '').trim().toLowerCase();
}

/**
 * True when this version is still early-access gated.
 *
 * Locked decision order (do not reorder casually — both false-Bell and
 * false-Download regressions come from shuffling these):
 * 1. Parsed end time → future = EA, past = not EA
 * 2. Paid Buzz gate (download/generation price or charge flags) → EA
 * 3. availability EarlyAccess → EA
 * 4. paidAccess / earlyAccessDeadline residue → EA
 * 5. availability Public/Unsearchable → not EA (leftover timeframe alone ≠ EA)
 * 6. Unknown availability + timeframe → EA
 */
export function isVersionEarlyAccess(
  version: EarlyAccessVersionFields | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!version) return false;
  const cfg = version.earlyAccessConfig;
  const ends = resolveEarlyAccessEndsAt(version);
  if (ends) {
    const ts = Date.parse(ends);
    if (Number.isFinite(ts)) {
      if (ts > nowMs) return true;
      // Past end: leftover downloadPrice alone must not re-lock, but an
      // explicit charge flag means Buzz is still collecting.
      if (cfg && typeof cfg === 'object' && cfg.chargeForDownload === true) {
        return true;
      }
      return false;
    }
    // Unparseable end — fall through to other signals.
  }

  // Paid download / generation gate — active Buzz EA even when availability
  // still says Public on thin REST payloads.
  if (cfg && typeof cfg === 'object') {
    if (cfg.chargeForDownload === true) return true;
    if (cfg.chargeForGeneration === true) return true;
    if (typeof cfg.downloadPrice === 'number' && cfg.downloadPrice > 0) {
      return true;
    }
    if (typeof cfg.generationPrice === 'number' && cfg.generationPrice > 0) {
      return true;
    }
  }

  if (version.checkPermission === true) return true;

  const avail = availabilityToken(version);
  if (avail === 'earlyaccess') return true;

  if (version.paidAccess && typeof version.paidAccess === 'object') {
    if (
      typeof version.paidAccess.timeframeDays === 'number' &&
      version.paidAccess.timeframeDays > 0
    ) {
      return true;
    }
    if (version.paidAccess.endsAt) return true;
  }
  if (version.earlyAccessDeadline) return true;

  // Explicit public unlock: leftover timeframe alone must not keep Bell.
  if (avail === 'public' || avail === 'unsearchable') return false;

  // Unknown availability + timeframe with no resolved end → still gated.
  if (cfg && typeof cfg === 'object') {
    if (typeof cfg.timeframe === 'number' && cfg.timeframe > 0) return true;
  }
  return false;
}

/**
 * Positive proof that early access has ended (safe to return a watched card
 * to Browse). Missing data must NOT count as unlocked.
 */
export function isVersionConfirmedPublic(
  version: EarlyAccessVersionFields | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!version) return false;
  if (isVersionEarlyAccess(version, nowMs)) return false;
  const ends = resolveEarlyAccessEndsAt(version);
  if (ends) {
    const ts = Date.parse(ends);
    if (Number.isFinite(ts) && ts <= nowMs) return true;
  }
  const avail = availabilityToken(version);
  return avail === 'public' || avail === 'unsearchable';
}

/**
 * Pull EA deadline from a Civitai model-page `__NEXT_DATA__` blob (or any
 * nested JSON). Used when public REST omits end times for paid EA.
 */
export function extractEarlyAccessEndsAtFromPageJson(
  raw: unknown,
): string | undefined {
  const hits: string[] = [];

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const row = node as Record<string, unknown>;
    const deadline = coerceIso(
      typeof row.earlyAccessDeadline === 'string'
        ? row.earlyAccessDeadline
        : null,
    );
    if (deadline) hits.push(deadline);
    const paid = row.paidAccess;
    if (paid && typeof paid === 'object' && !Array.isArray(paid)) {
      const ends = coerceIso(
        typeof (paid as { endsAt?: unknown }).endsAt === 'string'
          ? (paid as { endsAt: string }).endsAt
          : null,
      );
      if (ends) hits.push(ends);
    }
    const legacy = coerceIso(
      typeof row.earlyAccessEndsAt === 'string' ? row.earlyAccessEndsAt : null,
    );
    if (legacy) hits.push(legacy);
    for (const value of Object.values(row)) visit(value);
  };

  visit(raw);
  if (hits.length === 0) return undefined;
  hits.sort((a, b) => Date.parse(a) - Date.parse(b));
  return hits[0];
}

/**
 * Prefer cheap HTML regex (works even when `__NEXT_DATA__` parse fails),
 * then fall back to walking the Next.js JSON blob.
 */
export function extractEarlyAccessEndsAtFromModelPageHtml(
  html: string,
): string | undefined {
  return extractEarlyAccessGateFromModelPageHtml(html).endsAt;
}

/** Gate signal scraped from a Civitai model page (REST often lies). */
export type EarlyAccessPageGate = {
  endsAt?: string;
  /**
   * True when the page shows an active gate — countdown and/or paid Buzz —
   * even if REST said `Public` with no deadline.
   */
  gated: boolean;
  downloadPrice?: number;
};

/**
 * Full EA gate from model-page HTML. Use this instead of endsAt-only scrapes:
 * paid Buzz often has `downloadPrice` / `paidAccess` with no deadline.
 */
export function extractEarlyAccessGateFromModelPageHtml(
  html: string,
  nowMs: number = Date.now(),
): EarlyAccessPageGate {
  if (!html) return { gated: false };

  let endsAt: string | undefined;
  const deadlineMatch = html.match(/"earlyAccessDeadline":"([^"]+)"/);
  endsAt = coerceIso(deadlineMatch?.[1]);
  if (!endsAt) {
    const paidMatch = html.match(
      /"paidAccess"\s*:\s*\{[^}]*?"endsAt"\s*:\s*"([^"]+)"/,
    );
    endsAt = coerceIso(paidMatch?.[1]);
  }
  if (!endsAt) {
    const legacyMatch = html.match(/"earlyAccessEndsAt":"([^"]+)"/);
    endsAt = coerceIso(legacyMatch?.[1]);
  }
  if (!endsAt) {
    const nextMatch = html.match(
      /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
    );
    if (nextMatch?.[1]) {
      try {
        endsAt = extractEarlyAccessEndsAtFromPageJson(JSON.parse(nextMatch[1]));
      } catch {
        // ignore
      }
    }
  }

  let downloadPrice: number | undefined;
  const priceMatch = html.match(/"downloadPrice"\s*:\s*(\d+)/);
  if (priceMatch) {
    const n = Number(priceMatch[1]);
    if (Number.isFinite(n) && n > 0) downloadPrice = n;
  }
  const chargeForDownload = /"chargeForDownload"\s*:\s*true/.test(html);
  const availabilityEarlyAccess =
    /"availability"\s*:\s*"EarlyAccess"/i.test(html);
  const paidAccessBlock = /"paidAccess"\s*:\s*\{/.test(html);

  // Past countdown clears the time gate. Leftover downloadPrice alone must not
  // re-lock, but an explicit chargeForDownload means Buzz is still active.
  if (endsAt && !isEarlyAccessActive(true, endsAt, nowMs)) {
    if (chargeForDownload) {
      return { endsAt, gated: true, downloadPrice };
    }
    return { endsAt, gated: false, downloadPrice };
  }

  const gated =
    (endsAt ? isEarlyAccessActive(true, endsAt, nowMs) : false) ||
    downloadPrice != null ||
    chargeForDownload ||
    availabilityEarlyAccess ||
    (paidAccessBlock && !endsAt);

  return { endsAt, gated, downloadPrice };
}

/**
 * Cached version-snap EA for Browse / Download / Bell.
 * One rule: past endsAt unlocks; downloadPrice / flag keep the gate.
 */
export function projectVersionSnapEarlyAccess(opts: {
  earlyAccess?: boolean;
  earlyAccessEndsAt?: string | null;
  downloadPrice?: number | null;
  /** Model-level fallback — only for the library’s latest version. */
  inheritModelEarlyAccess?: boolean;
  inheritModelEndsAt?: string | null;
  nowMs?: number;
}): { earlyAccess: boolean; earlyAccessEndsAt?: string } {
  const nowMs = opts.nowMs ?? Date.now();
  const paid =
    typeof opts.downloadPrice === 'number' && opts.downloadPrice > 0;
  // Never inherit a model past-end onto a paid Buzz version.
  const endsAt =
    coerceIso(opts.earlyAccessEndsAt) ??
    (paid ? undefined : coerceIso(opts.inheritModelEndsAt)) ??
    undefined;
  const flag =
    Boolean(opts.earlyAccess) ||
    paid ||
    Boolean(opts.inheritModelEarlyAccess);
  const earlyAccess = isEarlyAccessActive(flag, endsAt, nowMs);
  return { earlyAccess, earlyAccessEndsAt: endsAt };
}
