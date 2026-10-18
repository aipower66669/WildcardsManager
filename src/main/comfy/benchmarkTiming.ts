/**
 * Benchmark durations are the sampler's own step counter: the first step
 * through the last. Model load happens before step 1, and decode/save happen
 * after the last step, so neither is included.
 *
 * A run we joined after step 1 is not a duration. Callers must skip it instead
 * of storing the tail of the loop.
 */

export function isGenerationSamplerClass(classType: string): boolean {
  const name = classType.toLowerCase();
  if (!name.includes('sampler')) return false;
  // Seed widgets and sampler pickers are not the denoising loop.
  if (name.includes('seed') || name.includes('select')) return false;
  return true;
}

export function samplerNodeIds(
  graph: Record<string, { class_type?: string } | null | undefined>,
): Set<string> {
  const ids = new Set<string>();
  for (const [id, node] of Object.entries(graph)) {
    const classType = node?.class_type;
    if (typeof classType === 'string' && isGenerationSamplerClass(classType)) {
      ids.add(id);
    }
  }
  return ids;
}

export type SampleProgressEvent = {
  type: 'progress';
  value: number;
  max: number;
  node?: string | null;
};

type SampleNodeClock = {
  startedMs: number | null;
  /** Progress value that opened the span (0 or 1). */
  startValue: number | null;
  finishedMs: number | null;
  max: number | null;
  /** First progress was already past the opening step. */
  late: boolean;
};

export type SampleClock = {
  nodes: Readonly<Record<string, SampleNodeClock>>;
};

export function emptySampleClock(): SampleClock {
  return { nodes: {} };
}

function blankNode(): SampleNodeClock {
  return {
    startedMs: null,
    startValue: null,
    finishedMs: null,
    max: null,
    late: false,
  };
}

/**
 * Known sampler → only that node's step bar.
 * No recognizable sampler → an untagged step bar (the only signal we have).
 */
function progressNodeKey(
  node: string | null,
  samplerIds: ReadonlySet<string>,
): string | null {
  if (samplerIds.size > 0) {
    if (node && samplerIds.has(node)) return node;
    return null;
  }
  if (node) return null;
  return '*';
}

function advanceNode(
  prev: SampleNodeClock,
  value: number,
  max: number,
  now: number,
): SampleNodeClock {
  if (prev.late || prev.finishedMs != null) return prev;
  if (!Number.isFinite(value) || !Number.isFinite(max) || max < 2 || value < 0) {
    return prev;
  }
  if (prev.startedMs == null) {
    // Comfy sends 1 after the first step, some nodes send 0 at the start.
    // Anything later means the opening steps were missed.
    if (value > 1) return { ...prev, late: true };
    return { ...prev, startedMs: now, startValue: value, max };
  }
  if (value >= max) return { ...prev, finishedMs: now, max };
  return prev;
}

export function noteSampleProgress(
  clock: SampleClock,
  event: SampleProgressEvent,
  samplerIds: ReadonlySet<string>,
  now: number,
): SampleClock {
  const key = progressNodeKey(event.node ?? null, samplerIds);
  if (!key) return clock;
  const prev = clock.nodes[key] ?? blankNode();
  const next = advanceNode(prev, event.value, event.max, now);
  if (next === prev) return clock;
  return { nodes: { ...clock.nodes, [key]: next } };
}

/**
 * Milliseconds from the opening step to the last, scaled so a counter that
 * starts at 1 (after step 1 has already finished) still covers every step.
 * Null when no sampler reported a full range.
 */
export function sampleClockDurationMs(clock: SampleClock): number | null {
  let best: { ms: number; max: number } | null = null;
  for (const node of Object.values(clock.nodes)) {
    if (
      node.late ||
      node.startedMs == null ||
      node.finishedMs == null ||
      node.max == null ||
      node.startValue == null
    ) {
      continue;
    }
    const span = node.finishedMs - node.startedMs;
    const covered = node.max - node.startValue;
    if (!Number.isFinite(span) || span <= 0 || covered <= 0) continue;
    const ms = Math.round(span * (node.max / covered));
    if (!best || node.max > best.max) best = { ms, max: node.max };
  }
  return best?.ms ?? null;
}
