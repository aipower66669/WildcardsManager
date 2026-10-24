import {
  isEarlyAccessActive,
  versionHasPaidBuzzResidue,
  type EarlyAccessVersionFields,
} from './civitaiEarlyAccess.js';

export type TriageVersion = EarlyAccessVersionFields & {
  earlyAccess?: boolean;
};

export type TriageModel = {
  earlyAccess?: boolean;
  earlyAccessEndsAt?: string;
  versions?: TriageVersion[];
};

function versionIsGated(version: TriageVersion, nowMs: number): boolean {
  const ends = version.earlyAccessEndsAt;
  if (ends) {
    const ts = Date.parse(ends);
    if (Number.isFinite(ts)) {
      if (ts > nowMs) return true;
      return version.earlyAccessConfig?.chargeForDownload === true;
    }
  }
  if (isEarlyAccessActive(Boolean(version.earlyAccess), ends, nowMs)) {
    return true;
  }
  return versionHasPaidBuzzResidue(version);
}

/**
 * Notify when nothing on the card can be downloaded yet: an early-access
 * countdown, or a Buzz payment still required. A free version sends the
 * card to Archive instead.
 */
export function browseCardNeedsNotify(
  model: TriageModel,
  nowMs: number = Date.now(),
): boolean {
  const versions = model.versions ?? [];
  const modelGated = isEarlyAccessActive(
    Boolean(model.earlyAccess),
    model.earlyAccessEndsAt,
    nowMs,
  );
  if (versions.length === 0) return modelGated;
  const gated = modelGated || versions.some((version) => versionIsGated(version, nowMs));
  if (!gated) return false;
  const freelyDownloadable = versions.some(
    (version) => !versionIsGated(version, nowMs),
  );
  return !freelyDownloadable;
}
