/**
 * Slim read of a Comfy `/history/{id}` payload.
 * The raw document echoes the whole submitted workflow and must be parsed
 * off the Electron main thread.
 */

export type HistoryImageRef = {
  filename: string;
  subfolder: string;
  type: string;
};

export type HistoryBrief = {
  completed: boolean;
  /** `success` | `error` | null when the job is not in history yet. */
  statusStr: string | null;
  image: HistoryImageRef | null;
};

function firstImage(entry: Record<string, unknown>): HistoryImageRef | null {
  const outputs = (entry['outputs'] ?? {}) as Record<string, unknown>;
  for (const nodeOut of Object.values(outputs)) {
    if (!nodeOut || typeof nodeOut !== 'object') continue;
    const row = nodeOut as {
      images?: Array<Record<string, unknown>>;
      gifs?: Array<Record<string, unknown>>;
    };
    const img = row.images?.[0] ?? row.gifs?.[0];
    if (img && typeof img['filename'] === 'string' && img['filename']) {
      return {
        filename: img['filename'],
        subfolder: typeof img['subfolder'] === 'string' ? img['subfolder'] : '',
        type: typeof img['type'] === 'string' ? img['type'] : 'output',
      };
    }
  }
  return null;
}

export function historyBriefFromJson(
  json: unknown,
  promptId: string,
): HistoryBrief {
  const empty: HistoryBrief = {
    completed: false,
    statusStr: null,
    image: null,
  };
  if (!json || typeof json !== 'object') return empty;
  const root = json as Record<string, unknown>;
  const entry = (root[promptId] ?? null) as Record<string, unknown> | null;
  if (!entry || typeof entry !== 'object') return empty;
  const status = (entry['status'] ?? {}) as {
    completed?: boolean;
    status_str?: string;
  };
  const statusStr =
    typeof status.status_str === 'string' ? status.status_str : null;
  return {
    completed: status.completed === true,
    statusStr,
    image: firstImage(entry),
  };
}
