/**
 * Read-only helpers for `.safetensors` JSON headers.
 * Format: https://huggingface.co/docs/safetensors/index
 *   [u64 LE header length][UTF-8 JSON header][tensor bytes…]
 * Training metadata lives in `__metadata__` (string → string map).
 */

export const MAX_SAFETENSORS_HEADER_BYTES = 8 * 1024 * 1024;

export type SafetensorsTensorInfo = {
  name: string;
  dtype: string;
  shape: number[];
  /** Byte length of the tensor payload (END - BEGIN). */
  byteLength: number;
};

export type SafetensorsTagCount = {
  tag: string;
  count: number;
};

export type SafetensorsHeaderParse = {
  /** Raw `__metadata__` string map (values are always strings per format). */
  metadata: Record<string, string>;
  tensors: SafetensorsTensorInfo[];
};

const DTYPE_BYTES: Record<string, number> = {
  F64: 8,
  F32: 4,
  F16: 2,
  BF16: 2,
  I64: 8,
  I32: 4,
  I16: 2,
  U16: 2,
  I8: 1,
  U8: 1,
  BOOL: 1,
};

/** Parse header length from the first 8 little-endian bytes. */
export function readSafetensorsHeaderLength(prefix8: Uint8Array): number {
  if (prefix8.byteLength < 8) {
    throw new Error('Safetensors file too short to contain a header length');
  }
  const view = new DataView(
    prefix8.buffer,
    prefix8.byteOffset,
    prefix8.byteLength,
  );
  // JS number is safe up to 2^53; headers are far smaller.
  const lo = view.getUint32(0, true);
  const hi = view.getUint32(4, true);
  if (hi > 0x1f_ffff) {
    throw new Error('Safetensors header length exceeds safe integer range');
  }
  return hi * 0x1_0000_0000 + lo;
}

/**
 * Parse the JSON header bytes (not including the 8-byte length prefix).
 */
export function parseSafetensorsHeaderJson(
  headerBytes: Uint8Array | string,
): SafetensorsHeaderParse {
  const text =
    typeof headerBytes === 'string'
      ? headerBytes
      : new TextDecoder('utf-8').decode(headerBytes);
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error('Safetensors header is not valid JSON');
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('Safetensors header must be a JSON object');
  }

  const metadata: Record<string, string> = {};
  const tensors: SafetensorsTensorInfo[] = [];
  const record = root as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    if (key === '__metadata__') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [mk, mv] of Object.entries(value as Record<string, unknown>)) {
          if (typeof mv === 'string') metadata[mk] = mv;
          else if (mv != null) metadata[mk] = String(mv);
        }
      }
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const t = value as Record<string, unknown>;
    const dtype = typeof t.dtype === 'string' ? t.dtype : '?';
    const shape = Array.isArray(t.shape)
      ? t.shape.map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0))
      : [];
    let byteLength = 0;
    if (
      Array.isArray(t.data_offsets) &&
      t.data_offsets.length >= 2 &&
      typeof t.data_offsets[0] === 'number' &&
      typeof t.data_offsets[1] === 'number'
    ) {
      byteLength = Math.max(0, t.data_offsets[1] - t.data_offsets[0]);
    }
    tensors.push({ name: key, dtype, shape, byteLength });
  }

  tensors.sort((a, b) => a.name.localeCompare(b.name));
  return { metadata, tensors };
}

/**
 * Extract tag frequencies from Kohya `ss_tag_frequency` (JSON string of
 * dataset → { tag → count }).
 */
export function extractTagFrequencies(
  metadata: Record<string, string>,
): SafetensorsTagCount[] {
  const raw = metadata.ss_tag_frequency?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];

  const totals = new Map<string, number>();
  for (const dataset of Object.values(parsed as Record<string, unknown>)) {
    if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) {
      continue;
    }
    for (const [tag, count] of Object.entries(
      dataset as Record<string, unknown>,
    )) {
      const n =
        typeof count === 'number'
          ? count
          : typeof count === 'string'
            ? Number(count)
            : NaN;
      if (!tag.trim() || !Number.isFinite(n)) continue;
      totals.set(tag, (totals.get(tag) ?? 0) + n);
    }
  }

  return [...totals.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function parseWordListField(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x).trim()).filter(Boolean);
      }
    } catch {
      // fall through to split
    }
  }
  return trimmed
    .split(/[,|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupeWords(words: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of words) {
    const w = raw.trim();
    if (!w) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/**
 * Explicit trigger / activation fields (not the full `ss_tag_frequency` soup).
 */
export function extractExplicitTriggerWords(
  metadata: Record<string, string>,
): string[] {
  const candidates = [
    metadata.trained_words,
    metadata['modelspec.trigger_phrase'],
    metadata.trigger_words,
    metadata.activation_text,
    metadata.ss_tag_strings,
  ];
  const out: string[] = [];
  for (const raw of candidates) {
    if (!raw?.trim()) continue;
    out.push(...parseWordListField(raw));
  }
  return dedupeWords(out);
}

/**
 * Fallback trigger words when `ss_tag_frequency` is absent
 * (`trained_words`, `modelspec.trigger_phrase`, comma lists, JSON arrays).
 * When frequency data exists, returns all unique tags (for Inspect UI).
 */
export function extractTriggerWords(
  metadata: Record<string, string>,
): string[] {
  const fromFreq = extractTagFrequencies(metadata).map((t) => t.tag);
  if (fromFreq.length > 0) return fromFreq;
  return extractExplicitTriggerWords(metadata);
}

/**
 * Keywords suitable for a wildcard `<lora:…>` prompt suffix.
 * Prefers explicit trigger fields; otherwise tags that share the highest
 * training frequency (typically the activation token(s)).
 */
export function extractPromptKeywords(
  metadata: Record<string, string>,
  opts?: { max?: number; preferName?: string },
): string[] {
  const max = Math.max(1, opts?.max ?? 12);
  const explicit = extractExplicitTriggerWords(metadata);
  if (explicit.length > 0) return explicit.slice(0, max);

  const freqs = extractTagFrequencies(metadata);
  if (freqs.length === 0) return [];

  const topCount = freqs[0]!.count;
  let picks = freqs.filter((t) => t.count === topCount).map((t) => t.tag);

  // If every tag appears once, frequency ties are useless — keep a short top list.
  if (picks.length > max) {
    picks = freqs.slice(0, max).map((t) => t.tag);
  }

  const prefer = opts?.preferName?.trim().toLowerCase();
  if (prefer) {
    picks = [
      ...picks.filter((t) => t.toLowerCase() === prefer),
      ...picks.filter((t) => t.toLowerCase() !== prefer),
    ];
    // Also surface a tag that equals / contains the LoRA base name when present.
    const named = freqs.find(
      (t) =>
        t.tag.toLowerCase() === prefer ||
        prefer.includes(t.tag.toLowerCase()) ||
        t.tag.toLowerCase().includes(prefer),
    );
    if (named && !picks.some((t) => t.toLowerCase() === named.tag.toLowerCase())) {
      picks = [named.tag, ...picks];
    }
  }

  return dedupeWords(picks).slice(0, max);
}

export function estimateParameterCount(
  tensors: SafetensorsTensorInfo[],
): number | null {
  let total = 0;
  for (const t of tensors) {
    if (t.shape.length === 0) {
      total += 1;
      continue;
    }
    let n = 1;
    for (const d of t.shape) {
      if (!Number.isFinite(d) || d < 0) return null;
      n *= d;
    }
    total += n;
  }
  return total;
}

export function summarizeDtypes(
  tensors: SafetensorsTensorInfo[],
): Array<{ dtype: string; tensors: number; bytes: number }> {
  const map = new Map<string, { tensors: number; bytes: number }>();
  for (const t of tensors) {
    const cur = map.get(t.dtype) ?? { tensors: 0, bytes: 0 };
    cur.tensors += 1;
    cur.bytes += t.byteLength;
    if (t.byteLength === 0 && t.shape.length > 0) {
      const elem = DTYPE_BYTES[t.dtype];
      if (elem) {
        let n = 1;
        for (const d of t.shape) n *= d;
        cur.bytes += n * elem;
      }
    }
    map.set(t.dtype, cur);
  }
  return [...map.entries()]
    .map(([dtype, v]) => ({ dtype, tensors: v.tensors, bytes: v.bytes }))
    .sort((a, b) => a.dtype.localeCompare(b.dtype));
}

export type LoraInspectSummary = {
  baseModel?: string;
  outputName?: string;
  networkModule?: string;
  networkDim?: string;
  networkAlpha?: string;
  resolution?: string;
  epoch?: string;
  steps?: string;
  learningRate?: string;
  optimizer?: string;
  sdModelName?: string;
  title?: string;
  description?: string;
  usageHint?: string;
  author?: string;
  /** Remaining metadata keys not promoted into the summary fields above. */
  otherFields: Array<{ key: string; value: string }>;
};

const PROMOTED_KEYS = new Set([
  'ss_base_model_version',
  'modelspec.base_model',
  'base_model',
  'ss_output_name',
  'ss_network_module',
  'ss_network_dim',
  'ss_network_alpha',
  'ss_resolution',
  'modelspec.resolution',
  'ss_epoch',
  'ss_num_epochs',
  'ss_max_train_steps',
  'ss_steps',
  'ss_learning_rate',
  'ss_unet_lr',
  'ss_text_encoder_lr',
  'ss_optimizer',
  'ss_sd_model_name',
  'modelspec.title',
  'modelspec.description',
  'modelspec.usage_hint',
  'modelspec.author',
  'ss_tag_frequency',
  'trained_words',
  'modelspec.trigger_phrase',
  'trigger_words',
  'activation_text',
  'ss_tag_strings',
]);

function metaGet(
  metadata: Record<string, string>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const v = metadata[key]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function summarizeLoraMetadata(
  metadata: Record<string, string>,
): LoraInspectSummary {
  const otherFields = Object.entries(metadata)
    .filter(([k]) => !PROMOTED_KEYS.has(k))
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    baseModel: metaGet(
      metadata,
      'ss_base_model_version',
      'modelspec.base_model',
      'base_model',
    ),
    outputName: metaGet(metadata, 'ss_output_name'),
    networkModule: metaGet(metadata, 'ss_network_module'),
    networkDim: metaGet(metadata, 'ss_network_dim'),
    networkAlpha: metaGet(metadata, 'ss_network_alpha'),
    resolution: metaGet(metadata, 'ss_resolution', 'modelspec.resolution'),
    epoch: metaGet(metadata, 'ss_epoch', 'ss_num_epochs'),
    steps: metaGet(metadata, 'ss_max_train_steps', 'ss_steps'),
    learningRate: metaGet(
      metadata,
      'ss_learning_rate',
      'ss_unet_lr',
      'ss_text_encoder_lr',
    ),
    optimizer: metaGet(metadata, 'ss_optimizer'),
    sdModelName: metaGet(metadata, 'ss_sd_model_name'),
    title: metaGet(metadata, 'modelspec.title'),
    description: metaGet(metadata, 'modelspec.description'),
    usageHint: metaGet(metadata, 'modelspec.usage_hint'),
    author: metaGet(metadata, 'modelspec.author'),
    otherFields,
  };
}
