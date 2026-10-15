/**
 * If ComfyUI is not reachable, start the configured launch shortcut and wait
 * until HTTP answers (or timeout / cancel).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';
import { ComfyAdapter } from './adapter.js';
import {
  getComfyConnection,
  readComfyApiKey,
} from './comfySettings.js';

const POLL_MS = 1_000;
const WAIT_MS = 300_000;

const LAUNCH_EXTENSIONS = new Set([
  '.bat',
  '.cmd',
  '.exe',
  '.lnk',
  '.ps1',
  '.sh',
]);

export function isComfyLaunchPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return LAUNCH_EXTENSIONS.has(ext);
}

async function pingHttp(): Promise<boolean> {
  const conn = getComfyConnection();
  const adapter = new ComfyAdapter(conn, {
    apiKey: readComfyApiKey(),
    apiKeyHeader: conn.apiKeyHeader,
  });
  return adapter.ping();
}

async function launchConfiguredShortcut(launchPath: string): Promise<void> {
  const resolved = path.resolve(launchPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`ComfyUI launch file not found:\n${resolved}`);
  }
  if (!isComfyLaunchPath(resolved)) {
    throw new Error(
      `ComfyUI launch file must be a .bat, .cmd, .exe, .lnk, .ps1, or .sh:\n${resolved}`,
    );
  }

  const ext = path.extname(resolved).toLowerCase();
  if (process.platform === 'win32') {
    if (ext === '.lnk' || ext === '.url') {
      const err = await shell.openPath(resolved);
      if (err) throw new Error(err);
      return;
    }
    // New console window so the process stays up after this spawn returns.
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', '""', resolved],
      {
        detached: true,
        stdio: 'ignore',
        cwd: path.dirname(resolved),
        windowsHide: true,
      },
    );
    child.unref();
    return;
  }

  const child = spawn(resolved, [], {
    detached: true,
    stdio: 'ignore',
    cwd: path.dirname(resolved),
  });
  child.unref();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure ComfyUI HTTP is up. Launches `launchPath` when offline.
 * `shouldCancel` aborts the wait (generation Cancel).
 * `onStatus` is for UI progress while waiting for boot.
 */
export async function ensureComfyRunning(opts: {
  shouldCancel: () => boolean;
  onStatus?: (label: string) => void;
}): Promise<void> {
  if (await pingHttp()) return;

  const launchPath = getComfyConnection().launchPath?.trim() ?? '';
  if (!launchPath) {
    throw new Error(
      'ComfyUI is not running. Set a launch shortcut in Settings → AI → ComfyUI, or start ComfyUI manually.',
    );
  }

  opts.onStatus?.('Starting ComfyUI…');
  await launchConfiguredShortcut(launchPath);

  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (opts.shouldCancel()) throw new Error('cancelled');
    await sleep(POLL_MS);
    if (opts.shouldCancel()) throw new Error('cancelled');
    if (await pingHttp()) {
      opts.onStatus?.('ComfyUI ready');
      return;
    }
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    opts.onStatus?.(`Waiting for ComfyUI… ${left}s`);
  }

  throw new Error(
    `ComfyUI did not become reachable within ${Math.round(WAIT_MS / 1000)}s after launching:\n${path.resolve(launchPath)}`,
  );
}
