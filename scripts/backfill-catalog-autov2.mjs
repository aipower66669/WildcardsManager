/**
 * Backfill missing AutoV2 hashes on cached catalog models via Civitai API only.
 * Does NOT download or touch preview images.
 *
 * Usage (from repo root):
 *   node scripts/backfill-catalog-autov2.mjs
 *   node scripts/backfill-catalog-autov2.mjs --limit 50
 *   node scripts/backfill-catalog-autov2.mjs --dry-run
 *   node scripts/backfill-catalog-autov2.mjs --types LORA,Checkpoint
 *
 * Pace: ~1 request/sec (same as the app client). ~2k missing ≈ ~35 min.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit =
  limitIdx >= 0 && args[limitIdx + 1]
    ? Math.max(1, Number(args[limitIdx + 1]) || 0)
    : 0;
const typesIdx = args.indexOf('--types');
const typeFilter = (
  typesIdx >= 0 && args[typesIdx + 1]
    ? args[typesIdx + 1]
    : 'LORA,Checkpoint'
)
  .split(',')
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);

function userDataRoot() {
  if (process.env.WCM_USER_DATA) return process.env.WCM_USER_DATA;
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'wildcards-manager',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'wildcards-manager',
    );
  }
  return path.join(os.homedir(), '.config', 'wildcards-manager');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data)}\n`, 'utf8');
}

function resolveOrigin(settings) {
  const origin = settings?.civitaiOrigin || 'https://civitai.com';
  try {
    return new URL(origin).origin;
  } catch {
    return 'https://civitai.com';
  }
}

function originHost(origin) {
  try {
    return new URL(origin).host.replace(/[^a-zA-Z0-9.-]/g, '_') || 'unknown';
  } catch {
    return 'civitai.com';
  }
}

function pickAutoV2(hashes) {
  if (!hashes || typeof hashes !== 'object') return null;
  const raw = hashes.AutoV2 ?? hashes.autov2 ?? hashes.AUTOV2;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toUpperCase();
  return /^[0-9A-F]{10}$/.test(trimmed) ? trimmed : null;
}

function pickPrimaryFile(version) {
  const files = version?.files;
  if (!Array.isArray(files) || files.length === 0) return null;
  return (
    files.find((f) => f.primary) ??
    files.find((f) => /\.(safetensors|ckpt|pt)$/i.test(f.name ?? '')) ??
    files[0] ??
    null
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function civitaiGet(origin, apiKey, pathAndQuery) {
  const url = `${origin.replace(/\/$/, '')}/api/v1${pathAndQuery}`;
  let backoff = 1000;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await sleep(1000);
    const headers = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    const body = await res.text().catch(() => '');
    if (res.status === 429 || res.status >= 500) {
      await sleep(backoff);
      backoff = Math.min(30_000, backoff * 2);
      continue;
    }
    throw new Error(
      `Civitai ${res.status}: ${body.slice(0, 160) || res.statusText}`,
    );
  }
  throw new Error('Civitai request failed after retries');
}

const root = userDataRoot();
const settingsPath = path.join(root, 'settings.json');
const settings = readJson(settingsPath);
if (!settings) {
  console.error(`No settings at ${settingsPath}`);
  process.exit(1);
}

const origin = resolveOrigin(settings);
const host = originHost(origin);
const apiKey =
  typeof settings.civitaiApiKey === 'string' ? settings.civitaiApiKey : '';
const modelsDir = path.join(root, 'civitai-catalog', 'models', host);

if (!fs.existsSync(modelsDir)) {
  console.error(`Catalog models dir missing: ${modelsDir}`);
  process.exit(1);
}

/** @type {Array<{ file: string, key: string, id: number, versionId?: number, name: string, type: string }>} */
const missing = [];

for (const name of fs.readdirSync(modelsDir)) {
  if (!name.endsWith('.json')) continue;
  const file = path.join(modelsDir, name);
  const page = readJson(file);
  if (!page || typeof page !== 'object') continue;
  for (const [key, model] of Object.entries(page)) {
    if (!model || typeof model !== 'object') continue;
    if (model.origin && model.origin !== origin) continue;
    if (model.autoV2) continue;
    const type = String(model.type ?? '');
    if (typeFilter.length && !typeFilter.includes(type.toLowerCase())) {
      continue;
    }
    missing.push({
      file,
      key,
      id: model.id,
      versionId: model.versionId,
      name: model.name ?? '',
      type,
    });
  }
}

const work = limit > 0 ? missing.slice(0, limit) : missing;
console.log(`UserData:  ${root}`);
console.log(`Origin:    ${origin}`);
console.log(`Missing:   ${missing.length.toLocaleString()} (doing ${work.length.toLocaleString()})`);
console.log(`Mode:      ${dryRun ? 'dry-run' : 'patch cache'}`);
console.log('');

if (work.length === 0) {
  console.log('Nothing to backfill.');
  process.exit(0);
}

let patched = 0;
let failed = 0;
/** @type {Map<string, object>} */
const dirtyPages = new Map();

for (let i = 0; i < work.length; i += 1) {
  const entry = work[i];
  process.stdout.write(
    `\r[${i + 1}/${work.length}] id=${entry.id} patched=${patched} failed=${failed}   `,
  );
  try {
    let autoV2 = null;
    let fileName;
    if (entry.versionId) {
      try {
        const version = await civitaiGet(
          origin,
          apiKey,
          `/model-versions/${entry.versionId}`,
        );
        const file = pickPrimaryFile(version);
        autoV2 = pickAutoV2(file?.hashes);
        fileName = file?.name;
      } catch {
        // fall through
      }
    }
    if (!autoV2) {
      const model = await civitaiGet(origin, apiKey, `/models/${entry.id}`);
      const version = model.modelVersions?.[0];
      const file = pickPrimaryFile(version);
      autoV2 = pickAutoV2(file?.hashes);
      fileName = file?.name ?? fileName;
    }
    if (!autoV2) {
      failed += 1;
      continue;
    }
    patched += 1;
    if (dryRun) continue;
    let page = dirtyPages.get(entry.file);
    if (!page) {
      page = readJson(entry.file) ?? {};
      dirtyPages.set(entry.file, page);
    }
    const existing = page[entry.key];
    if (!existing) continue;
    page[entry.key] = {
      ...existing,
      autoV2,
      ...(fileName ? { fileName } : {}),
      updatedAt: new Date().toISOString(),
    };
    if (dirtyPages.size >= 20) {
      for (const [f, p] of dirtyPages) writeJson(f, p);
      dirtyPages.clear();
    }
  } catch (e) {
    failed += 1;
    console.error(`\n  fail ${entry.id}: ${e instanceof Error ? e.message : e}`);
  }
}

for (const [f, p] of dirtyPages) writeJson(f, p);

console.log('');
console.log(`Done. patched=${patched} failed=${failed}${dryRun ? ' (dry-run)' : ''}`);
