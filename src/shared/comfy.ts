/**
 * ComfyUI connection and integration types (specification section 21).
 */

export interface ComfyConnectionSettings {
  /** Hostname or IP address of the ComfyUI server, e.g. "127.0.0.1". */
  host: string;
  /** TCP port, e.g. 8188. */
  port: number;
  /** When true, use https/wss instead of http/ws. */
  secure: boolean;
  /** Whether an API key/token is stored (the value itself lives in safeStorage). */
  hasApiKey: boolean;
  /** Optional custom header name to carry the API key (defaults to Authorization: Bearer). */
  apiKeyHeader?: string;
  /**
   * Absolute folder for Generation “Use this prompt” outputs (LT · Output Folder).
   * Folder mode uses `{styleOutput}/{prompt folder}`, or `…/New` when that option is on.
   */
  generationFolder: string | null;
  /**
   * Absolute path to a ComfyUI start shortcut (`.bat` / `.cmd` / `.exe` / `.lnk`).
   * Used when Generation finds the server offline.
   */
  launchPath: string | null;
}

export const DEFAULT_COMFY_CONNECTION: ComfyConnectionSettings = {
  host: '127.0.0.1',
  port: 8188,
  secure: false,
  hasApiKey: false,
  generationFolder: null,
  launchPath: null,
};

/** Stem injected into LT · Output Filename on every Generation job. */
export const GENERATION_OUTPUT_FILENAME = 'WCG';

export interface ConnectionTestResult {
  ok: boolean;
  httpReachable: boolean;
  wsReachable: boolean;
  /** Round-trip latency in ms for the HTTP check, when reachable. */
  latencyMs?: number;
  /** Selected system information from ComfyUI, when available. */
  systemInfo?: {
    comfyVersion?: string;
    python?: string;
    os?: string;
    devices?: string[];
  };
  /** Number of node classes reported by /object_info, when available. */
  nodeClassCount?: number;
  errors: string[];
  warnings: string[];
}

export interface NumericRange {
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

/** Available models/samplers/schedulers discovered from ComfyUI /object_info. */
export interface ModelCatalog {
  checkpoints: string[];
  unets: string[];
  vaes: string[];
  clips: string[];
  loras: string[];
  samplers: string[];
  schedulers: string[];
  ranges: {
    steps?: NumericRange;
    cfg?: NumericRange;
    denoise?: NumericRange;
  };
  fetchedAt: string;
}

/** Build the base HTTP(S) URL for a connection (no trailing slash). */
export function comfyHttpBase(conn: ComfyConnectionSettings): string {
  const scheme = conn.secure ? 'https' : 'http';
  return `${scheme}://${conn.host}:${conn.port}`;
}

/** Build the WebSocket URL for a connection, including the client id. */
export function comfyWsUrl(conn: ComfyConnectionSettings, clientId: string): string {
  const scheme = conn.secure ? 'wss' : 'ws';
  return `${scheme}://${conn.host}:${conn.port}/ws?clientId=${encodeURIComponent(clientId)}`;
}
