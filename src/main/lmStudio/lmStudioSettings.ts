import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_LM_STUDIO_CONNECTION,
  type LmStudioConnectionSettings,
} from '../../shared/lmStudio.js';

type StoredLmStudioSettings = {
  host: string;
  port: number;
  secure: boolean;
  model: string;
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'lm-studio-settings.json');
}

function apiKeyPath(): string {
  return path.join(app.getPath('userData'), 'lm-studio-api-key.bin');
}

function readStored(): StoredLmStudioSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Record<
      string,
      unknown
    >;
    return {
      host:
        typeof raw.host === 'string' && raw.host.trim()
          ? raw.host.trim()
          : DEFAULT_LM_STUDIO_CONNECTION.host,
      port:
        typeof raw.port === 'number' && Number.isFinite(raw.port)
          ? Math.max(1, Math.min(65535, Math.round(raw.port)))
          : DEFAULT_LM_STUDIO_CONNECTION.port,
      secure: raw.secure === true,
      model: typeof raw.model === 'string' ? raw.model.trim() : '',
    };
  } catch {
    return {
      host: DEFAULT_LM_STUDIO_CONNECTION.host,
      port: DEFAULT_LM_STUDIO_CONNECTION.port,
      secure: DEFAULT_LM_STUDIO_CONNECTION.secure,
      model: DEFAULT_LM_STUDIO_CONNECTION.model,
    };
  }
}

function writeStored(next: StoredLmStudioSettings): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export function readLmStudioApiKey(): string | null {
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

export function writeLmStudioApiKey(key: string | null): void {
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

export function getLmStudioConnection(): LmStudioConnectionSettings {
  const stored = readStored();
  return {
    host: stored.host,
    port: stored.port,
    secure: stored.secure,
    model: stored.model,
    hasApiKey: Boolean(readLmStudioApiKey()),
  };
}

export function setLmStudioConnection(
  patch: Partial<LmStudioConnectionSettings> & { apiKey?: string | null },
): LmStudioConnectionSettings {
  const current = readStored();
  const next: StoredLmStudioSettings = {
    host:
      typeof patch.host === 'string' && patch.host.trim()
        ? patch.host.trim()
        : current.host,
    port:
      typeof patch.port === 'number' && Number.isFinite(patch.port)
        ? Math.max(1, Math.min(65535, Math.round(patch.port)))
        : current.port,
    secure: typeof patch.secure === 'boolean' ? patch.secure : current.secure,
    model:
      typeof patch.model === 'string' ? patch.model.trim() : current.model,
  };
  writeStored(next);
  if ('apiKey' in patch) {
    writeLmStudioApiKey(patch.apiKey ?? null);
  }
  return getLmStudioConnection();
}
