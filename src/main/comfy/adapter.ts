/**
 * ComfyUI adapter (specification sections 21.3–21.12).
 *
 * All ComfyUI traffic goes through the main process. This adapter wraps the HTTP
 * and WebSocket surface: connection test, image upload, prompt submission,
 * execution events, history/output retrieval, and interruption. Local and remote
 * differ only by URL/credentials here; response-shape quirks are tolerated
 * defensively because ComfyUI builds vary (section 53).
 */

import WebSocket from 'ws';
import {
  comfyHttpBase,
  comfyWsUrl,
  type ComfyConnectionSettings,
  type ConnectionTestResult,
  type ModelCatalog,
  type NumericRange,
} from '../../shared/comfy.js';
import { fetchHistoryBriefInWorker } from './historyBriefWorkerClient.js';
import type { HistoryBrief } from './historyBrief.js';

export interface AdapterCredentials {
  apiKey?: string | null;
  apiKeyHeader?: string | undefined;
}

export interface QueuePromptResult {
  promptId: string;
  number?: number;
}

export interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

export type ExecutionEvent =
  | { type: 'status'; queueRemaining?: number }
  | { type: 'execution_start'; promptId: string }
  | { type: 'executing'; promptId: string; node: string | null }
  | { type: 'progress'; value: number; max: number }
  | { type: 'executed'; promptId: string; node: string; images: ComfyImageRef[] }
  | { type: 'execution_success'; promptId: string }
  | { type: 'execution_error'; promptId: string; message: string }
  | { type: 'execution_cached'; promptId: string }
  | { type: 'raw'; data: unknown };

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export class ComfyAdapter {
  constructor(
    private readonly connection: ComfyConnectionSettings,
    private readonly credentials: AdapterCredentials = {},
  ) {}

  private base(): string {
    return comfyHttpBase(this.connection);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    const key = this.credentials.apiKey;
    if (key) {
      const headerName = this.credentials.apiKeyHeader;
      if (headerName) {
        headers[headerName] = key;
      } else {
        headers['Authorization'] = `Bearer ${key}`;
      }
    }
    return headers;
  }

  /** Verify HTTP + WebSocket reachability and gather basic system info. */
  async testConnection(clientId: string): Promise<ConnectionTestResult> {
    const result: ConnectionTestResult = {
      ok: false,
      httpReachable: false,
      wsReachable: false,
      errors: [],
      warnings: [],
    };

    if (
      this.connection.secure === false &&
      this.connection.host !== '127.0.0.1' &&
      this.connection.host !== 'localhost'
    ) {
      result.warnings.push('Connecting to a remote host over unencrypted HTTP. Prefer HTTPS.');
    }

    // HTTP: /system_stats
    const started = Date.now();
    try {
      const { signal, cancel } = withTimeout(5000);
      try {
        const res = await fetch(`${this.base()}/system_stats`, { headers: this.headers(), signal });
        if (res.ok) {
          result.httpReachable = true;
          result.latencyMs = Date.now() - started;
          result.systemInfo = this.parseSystemStats(await res.json().catch(() => ({})));
        } else {
          result.errors.push(`HTTP ${res.status} from /system_stats.`);
        }
      } finally {
        cancel();
      }
    } catch (error) {
      result.errors.push(`Cannot reach ${this.base()} (${(error as Error).message}).`);
    }

    // HTTP: /object_info (node class availability)
    if (result.httpReachable) {
      try {
        const { signal, cancel } = withTimeout(8000);
        try {
          const res = await fetch(`${this.base()}/object_info`, { headers: this.headers(), signal });
          if (res.ok) {
            const info = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            result.nodeClassCount = Object.keys(info).length;
          }
        } finally {
          cancel();
        }
      } catch {
        result.warnings.push('Could not read /object_info (node introspection unavailable).');
      }
    }

    // WebSocket check
    if (result.httpReachable) {
      result.wsReachable = await this.checkWebSocket(clientId);
      if (!result.wsReachable) {
        result.errors.push('WebSocket endpoint /ws is not reachable.');
      }
    }

    result.ok = result.httpReachable && result.wsReachable;
    return result;
  }

  /**
   * Cheap liveness check. Generation calls this on every job — it must not
   * download `/object_info` (multi‑MB JSON.parse on the main thread) or open
   * a WebSocket. That work overlapped ComfyUI "Model Initializing" and froze
   * the window.
   */
  async ping(): Promise<boolean> {
    try {
      const { signal, cancel } = withTimeout(2500);
      try {
        const res = await fetch(`${this.base()}/system_stats`, {
          headers: this.headers(),
          signal,
        });
        return res.ok;
      } finally {
        cancel();
      }
    } catch {
      return false;
    }
  }

  private parseSystemStats(raw: unknown): ConnectionTestResult['systemInfo'] {
    const data = (raw ?? {}) as Record<string, unknown>;
    const system = (data['system'] ?? {}) as Record<string, unknown>;
    const devices = Array.isArray(data['devices'])
      ? (data['devices'] as Array<Record<string, unknown>>).map((d) => String(d['name'] ?? 'device'))
      : undefined;
    const info: NonNullable<ConnectionTestResult['systemInfo']> = {};
    const comfyVersion = system['comfyui_version'];
    if (typeof comfyVersion === 'string') info.comfyVersion = comfyVersion;
    const python = system['python_version'];
    if (typeof python === 'string') info.python = python;
    const os = system['os'];
    if (typeof os === 'string') info.os = os;
    if (devices) info.devices = devices;
    return info;
  }

  private checkWebSocket(clientId: string): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {
          /* noop */
        }
        resolve(value);
      };
      const ws = new WebSocket(comfyWsUrl(this.connection, clientId), {
        headers: this.headers(),
        handshakeTimeout: 5000,
      });
      const timer = setTimeout(() => finish(false), 6000);
      ws.on('open', () => {
        clearTimeout(timer);
        finish(true);
      });
      ws.on('error', () => {
        clearTimeout(timer);
        finish(false);
      });
    });
  }

  /** Upload an image (context or mask) to ComfyUI's input space. */
  async uploadImage(name: string, data: Buffer, subfolder: string): Promise<ComfyImageRef> {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(data)], { type: 'image/png' });
    form.append('image', blob, name);
    form.append('overwrite', 'true');
    if (subfolder) form.append('subfolder', subfolder);
    const res = await fetch(`${this.base()}/upload/image`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Image upload failed (HTTP ${res.status}).`);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      filename: String(json['name'] ?? name),
      subfolder: String(json['subfolder'] ?? subfolder),
      type: String(json['type'] ?? 'input'),
    };
  }

  /**
   * Submit a prompt (API-format workflow graph) for execution.
   * Always includes extra_pnginfo.workflow — many save/metadata nodes require it
   * (UI queues always send it; API-only queues omit it and crash those nodes).
   */
  async queuePrompt(
    workflow: Record<string, unknown>,
    clientId: string,
    opts?: { uiWorkflow?: unknown },
  ): Promise<QueuePromptResult> {
    const uiWorkflow =
      opts?.uiWorkflow && typeof opts.uiWorkflow === 'object'
        ? opts.uiWorkflow
        : { nodes: [], links: [], groups: [], config: {}, extra: {}, version: 0.4 };

    const res = await fetch(`${this.base()}/prompt`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        prompt: workflow,
        client_id: clientId,
        extra_data: {
          extra_pnginfo: {
            workflow: uiWorkflow,
          },
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `ComfyUI rejected the prompt (HTTP ${res.status}): ${text.slice(0, 500)}`,
      );
    }
    const json = (await res.json()) as Record<string, unknown>;
    return {
      promptId: String(json['prompt_id']),
      number: typeof json['number'] === 'number' ? json['number'] : undefined,
    };
  }

  /**
   * Completion + first image ref. The history document includes the submitted
   * workflow, so the download and JSON parse run on a worker thread.
   */
  getHistoryBrief(promptId: string): Promise<HistoryBrief> {
    return fetchHistoryBriefInWorker({
      url: `${this.base()}/history/${encodeURIComponent(promptId)}`,
      headers: this.headers(),
      promptId,
    });
  }

  async getImage(ref: ComfyImageRef): Promise<Buffer> {
    const params = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder, type: ref.type });
    const res = await fetch(`${this.base()}/view?${params.toString()}`, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Failed to retrieve output image (HTTP ${res.status}).`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async interrupt(): Promise<void> {
    await fetch(`${this.base()}/interrupt`, { method: 'POST', headers: this.headers() }).catch(
      () => undefined,
    );
  }

  async getObjectInfo(): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.base()}/object_info`, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Could not read /object_info (HTTP ${res.status}).`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  /** Fetch and parse the available models, LoRAs, samplers, schedulers, and numeric ranges. */
  async getModelCatalog(): Promise<ModelCatalog> {
    const catalog = parseModelCatalog(await this.getObjectInfo());
    // Newer Comfy builds may omit combo option lists from /object_info (lazy
    // COMBO) or only expose ["COMBO", { options }]. Fall back to /models/*.
    if (catalog.vaes.length === 0 || catalog.clips.length === 0) {
      const [vaes, textEncoders, clipFolder] = await Promise.all([
        catalog.vaes.length === 0 ? this.listModelFolder('vae') : Promise.resolve([]),
        catalog.clips.length === 0
          ? this.listModelFolder('text_encoders')
          : Promise.resolve([]),
        catalog.clips.length === 0
          ? this.listModelFolder('clip')
          : Promise.resolve([]),
      ]);
      const clips = [...new Set([...textEncoders, ...clipFolder])].sort((a, b) =>
        a.localeCompare(b),
      );
      return {
        ...catalog,
        vaes: catalog.vaes.length > 0 ? catalog.vaes : vaes,
        clips: catalog.clips.length > 0 ? catalog.clips : clips,
      };
    }
    return catalog;
  }

  /** Filenames from GET /models/{folder} (empty when folder unknown / offline). */
  async listModelFolder(folder: string): Promise<string[]> {
    try {
      const res = await fetch(`${this.base()}/models/${encodeURIComponent(folder)}`, {
        headers: this.headers(),
      });
      if (!res.ok) return [];
      const raw = (await res.json().catch(() => null)) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw
        .map((row) => {
          if (typeof row === 'string') return row.trim();
          if (row && typeof row === 'object' && typeof (row as { name?: unknown }).name === 'string') {
            return (row as { name: string }).name.trim();
          }
          return '';
        })
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  /**
   * Open a WebSocket and stream execution events until `onEvent` returns true
   * (done) or the connection closes. Returns a disposer.
   */
  monitor(clientId: string, onEvent: (event: ExecutionEvent) => void): () => void {
    const ws = new WebSocket(comfyWsUrl(this.connection, clientId), { headers: this.headers() });
    ws.on('message', (raw: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        return; // preview blobs; ignored — do not decode them on the main thread
      }
      const text = raw.toString();
      // Status/progress events are small. Drop anything large so a preview
      // payload cannot stall the event loop while a model is loading.
      if (text.length > 65_536) return;
      try {
        const msg = JSON.parse(text) as { type: string; data?: Record<string, unknown> };
        onEvent(this.translate(msg));
      } catch {
        onEvent({ type: 'raw', data: text });
      }
    });
    ws.on('error', () => {
      /* connection errors surface via closed monitor */
    });
    return () => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }

  private translate(msg: { type: string; data?: Record<string, unknown> }): ExecutionEvent {
    const d = msg.data ?? {};
    switch (msg.type) {
      case 'status': {
        const status = (d['status'] ?? {}) as Record<string, unknown>;
        const execInfo = (status['exec_info'] ?? {}) as Record<string, unknown>;
        return { type: 'status', queueRemaining: Number(execInfo['queue_remaining'] ?? 0) };
      }
      case 'execution_start':
        return { type: 'execution_start', promptId: String(d['prompt_id']) };
      case 'executing':
        return {
          type: 'executing',
          promptId: String(d['prompt_id']),
          node: d['node'] == null ? null : String(d['node']),
        };
      case 'progress':
        return { type: 'progress', value: Number(d['value'] ?? 0), max: Number(d['max'] ?? 1) };
      case 'executed': {
        const output = (d['output'] ?? {}) as Record<string, unknown>;
        const images = Array.isArray(output['images'])
          ? (output['images'] as Array<Record<string, unknown>>).map((i) => ({
              filename: String(i['filename']),
              subfolder: String(i['subfolder'] ?? ''),
              type: String(i['type'] ?? 'output'),
            }))
          : [];
        return { type: 'executed', promptId: String(d['prompt_id']), node: String(d['node']), images };
      }
      case 'execution_success':
        return { type: 'execution_success', promptId: String(d['prompt_id']) };
      case 'execution_error':
        return {
          type: 'execution_error',
          promptId: String(d['prompt_id']),
          message: String(d['exception_message'] ?? 'Execution error'),
        };
      case 'execution_cached':
        return { type: 'execution_cached', promptId: String(d['prompt_id']) };
      default:
        return { type: 'raw', data: msg };
    }
  }
}

function isComboSpec(spec: unknown): boolean {
  if (!Array.isArray(spec) || spec.length === 0) return false;
  // Legacy: [["opt1", "opt2"], { default: ... }]
  if (Array.isArray(spec[0])) return true;
  // V2: ["COMBO", { options: [...] }]
  return spec[0] === 'COMBO';
}

/** Options from legacy or COMBO-v2 input specs. Numbers coerced to strings. */
function comboOptions(spec: unknown): string[] {
  if (!Array.isArray(spec) || spec.length === 0) return [];
  let raw: unknown[] = [];
  if (Array.isArray(spec[0])) {
    raw = spec[0] as unknown[];
  } else if (spec[0] === 'COMBO') {
    const opts = (spec[1] as { options?: unknown } | undefined)?.options;
    if (Array.isArray(opts)) raw = opts;
  }
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && v.trim()) out.push(v);
    else if (typeof v === 'number' && Number.isFinite(v)) out.push(String(v));
  }
  return out;
}

function numericRange(spec: unknown): NumericRange | undefined {
  if (!Array.isArray(spec)) return undefined;
  const kind = spec[0];
  if (kind !== 'INT' && kind !== 'FLOAT') return undefined;
  const cfg = (spec[1] ?? {}) as Record<string, unknown>;
  const range: NumericRange = {};
  if (typeof cfg['default'] === 'number') range.default = cfg['default'];
  if (typeof cfg['min'] === 'number') range.min = cfg['min'];
  if (typeof cfg['max'] === 'number') range.max = cfg['max'];
  if (typeof cfg['step'] === 'number') range.step = cfg['step'];
  return range;
}

/**
 * Parse /object_info into a catalog. We scan every node's inputs and collect
 * combo (enum) option lists by input-key name, so custom sampler nodes such as
 * ClownsharkKSampler contribute their sampler_name/scheduler options too.
 * Supports legacy `[[...opts], cfg]` and COMBO-v2 `["COMBO", { options }]`.
 */
export function parseModelCatalog(info: Record<string, unknown>): ModelCatalog {
  const combos = new Map<string, Set<string>>();
  const ranges: ModelCatalog['ranges'] = {};

  const collect = (key: string, options: string[]) => {
    let set = combos.get(key);
    if (!set) {
      set = new Set<string>();
      combos.set(key, set);
    }
    for (const opt of options) set.add(opt);
  };

  for (const node of Object.values(info)) {
    const def = node as {
      input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> };
    };
    const groups = [def.input?.required ?? {}, def.input?.optional ?? {}];
    for (const group of groups) {
      for (const [inputKey, spec] of Object.entries(group)) {
        if (isComboSpec(spec)) {
          collect(inputKey, comboOptions(spec));
        } else if (inputKey === 'steps' && !ranges.steps) {
          ranges.steps = numericRange(spec);
        } else if (inputKey === 'cfg' && !ranges.cfg) {
          ranges.cfg = numericRange(spec);
        } else if (inputKey === 'denoise' && !ranges.denoise) {
          ranges.denoise = numericRange(spec);
        }
      }
    }
  }

  const get = (key: string) => Array.from(combos.get(key) ?? []).sort((a, b) => a.localeCompare(b));
  const clips = new Set<string>([...get('clip_name'), ...get('clip_name1'), ...get('clip_name2')]);

  return {
    checkpoints: get('ckpt_name'),
    unets: get('unet_name'),
    vaes: get('vae_name'),
    clips: Array.from(clips).sort((a, b) => a.localeCompare(b)),
    loras: get('lora_name'),
    samplers: get('sampler_name'),
    schedulers: get('scheduler'),
    ranges,
    fetchedAt: new Date().toISOString(),
  };
}
