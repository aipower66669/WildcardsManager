import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_COMFY_CONNECTION,
  type ComfyConnectionSettings,
} from '../../shared/comfy.js';

type StoredComfySettings = {
  host: string;
  port: number;
  secure: boolean;
  apiKeyHeader?: string;
  generationFolder?: string | null;
  launchPath?: string | null;
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'comfy-settings.json');
}

function apiKeyPath(): string {
  return path.join(app.getPath('userData'), 'comfy-api-key.bin');
}

function resolveOptionalDir(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return path.resolve(value.trim());
}

function resolveOptionalFile(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return path.resolve(value.trim());
}

function readStored(): StoredComfySettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Record<
      string,
      unknown
    >;
    return {
      host:
        typeof raw.host === 'string' && raw.host.trim()
          ? raw.host.trim()
          : DEFAULT_COMFY_CONNECTION.host,
      port:
        typeof raw.port === 'number' && Number.isFinite(raw.port)
          ? Math.max(1, Math.min(65535, Math.round(raw.port)))
          : DEFAULT_COMFY_CONNECTION.port,
      secure: raw.secure === true,
      ...(typeof raw.apiKeyHeader === 'string' && raw.apiKeyHeader.trim()
        ? { apiKeyHeader: raw.apiKeyHeader.trim() }
        : {}),
      generationFolder: resolveOptionalDir(raw.generationFolder),
      launchPath: resolveOptionalFile(raw.launchPath),
    };
  } catch {
    return {
      host: DEFAULT_COMFY_CONNECTION.host,
      port: DEFAULT_COMFY_CONNECTION.port,
      secure: DEFAULT_COMFY_CONNECTION.secure,
      generationFolder: null,
      launchPath: null,
    };
  }
}

function writeStored(next: StoredComfySettings): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export function readComfyApiKey(): string | null {
  try {
    if (!fs.existsSync(apiKeyPath())) return null;
    const buf = fs.readFileSync(apiKeyPath());
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

export function writeComfyApiKey(key: string | null): void {
  if (!key || !key.trim()) {
    try {
      if (fs.existsSync(apiKeyPath())) fs.unlinkSync(apiKeyPath());
    } catch {
      // ignore
    }
    return;
  }
  const trimmed = key.trim();
  fs.mkdirSync(path.dirname(apiKeyPath()), { recursive: true });
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(apiKeyPath(), safeStorage.encryptString(trimmed));
  } else {
    fs.writeFileSync(apiKeyPath(), trimmed, 'utf8');
  }
}

export function getComfyConnection(): ComfyConnectionSettings {
  const stored = readStored();
  return {
    host: stored.host,
    port: stored.port,
    secure: stored.secure,
    hasApiKey: Boolean(readComfyApiKey()),
    generationFolder: stored.generationFolder ?? null,
    launchPath: stored.launchPath ?? null,
    ...(stored.apiKeyHeader ? { apiKeyHeader: stored.apiKeyHeader } : {}),
  };
}

export function setComfyConnection(
  patch: Partial<ComfyConnectionSettings> & { apiKey?: string | null },
): ComfyConnectionSettings {
  const current = readStored();
  const next: StoredComfySettings = {
    host:
      typeof patch.host === 'string' && patch.host.trim()
        ? patch.host.trim()
        : current.host,
    port:
      typeof patch.port === 'number' && Number.isFinite(patch.port)
        ? Math.max(1, Math.min(65535, Math.round(patch.port)))
        : current.port,
    secure:
      typeof patch.secure === 'boolean' ? patch.secure : current.secure,
    generationFolder:
      patch.generationFolder !== undefined
        ? resolveOptionalDir(patch.generationFolder)
        : (current.generationFolder ?? null),
    launchPath:
      patch.launchPath !== undefined
        ? resolveOptionalFile(patch.launchPath)
        : (current.launchPath ?? null),
  };
  if (patch.apiKeyHeader !== undefined) {
    const header =
      typeof patch.apiKeyHeader === 'string' ? patch.apiKeyHeader.trim() : '';
    if (header) next.apiKeyHeader = header;
  } else if (current.apiKeyHeader) {
    next.apiKeyHeader = current.apiKeyHeader;
  }
  writeStored(next);
  if ('apiKey' in patch) {
    writeComfyApiKey(patch.apiKey ?? null);
  }
  return getComfyConnection();
}
