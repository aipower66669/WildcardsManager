/**
 * Debug local LoRAs whose AutoV2 hash is not present on any cached Civitai model.
 *
 * Usage (from repo root):
 *   node scripts/debug-unmatched-loras.mjs
 *   node scripts/debug-unmatched-loras.mjs --out unmatched-loras.csv
 *   node scripts/debug-unmatched-loras.mjs --limit 50
 *
 * Matching is AutoV2 (first 10 hex chars of SHA-256). A local file only shows as
 * "Installed" when some catalog cache entry has the same AutoV2.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outPath =
  outIdx >= 0 && args[outIdx + 1]
    ? path.resolve(args[outIdx + 1])
    : null;
const limitIdx = args.indexOf('--limit');
const printLimit =
  limitIdx >= 0 && args[limitIdx + 1]
    ? Math.max(1, Number(args[limitIdx + 1]) || 40)
    : 40;

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

function normalizeAutoV2(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toUpperCase();
  return /^[0-9A-F]{10}$/.test(trimmed) ? trimmed : null;
}

function resolveLoraFolder(settings) {
  const libs = settings?.libraries ?? [];
  const activeId = settings?.activeLibraryId;
  const active =
    libs.find((l) => l.id === activeId) ?? libs[0] ?? null;
  return (
    active?.loraFolder ||
    settings?.loraFolder ||
    null
  );
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

function walkModelPages(modelsDir, onModel) {
  if (!fs.existsSync(modelsDir)) return 0;
  let n = 0;
  for (const host of fs.readdirSync(modelsDir)) {
    const hostDir = path.join(modelsDir, host);
    if (!fs.statSync(hostDir).isDirectory()) continue;
    for (const file of fs.readdirSync(hostDir)) {
      if (!file.endsWith('.json')) continue;
      const page = readJson(path.join(hostDir, file));
      if (!page || typeof page !== 'object') continue;
      for (const model of Object.values(page)) {
        if (!model || typeof model !== 'object') continue;
        onModel(model);
        n += 1;
      }
    }
  }
  return n;
}

const root = userDataRoot();
const settingsPath = path.join(root, 'settings.json');
const hashCachePath = path.join(root, 'model-hash-cache.json');
const catalogRoot = path.join(root, 'civitai-catalog');

const settings = readJson(settingsPath);
if (!settings) {
  console.error(`No settings at ${settingsPath}`);
  process.exit(1);
}

const loraFolder = resolveLoraFolder(settings);
const origin = resolveOrigin(settings);
const host = originHost(origin);

if (!loraFolder || !fs.existsSync(loraFolder)) {
  console.error(`LoRA folder missing or not set: ${loraFolder}`);
  process.exit(1);
}

const hashCache = readJson(hashCachePath) ?? { entries: {} };
const entries = hashCache.entries ?? {};

const loraRootKey = path.resolve(loraFolder).toLowerCase();
/** @type {Array<{ abs: string, autoV2: string | null, size: number }>} */
const localFiles = [];

for (const [key, entry] of Object.entries(entries)) {
  if (!key.startsWith(loraRootKey)) continue;
  if (!/\.(safetensors|ckpt|pt)$/i.test(key)) continue;
  localFiles.push({
    abs: key,
    autoV2: normalizeAutoV2(entry?.autoV2),
    size: entry?.size ?? 0,
  });
}

// Also note files on disk that never got hashed (not in cache).
function walkDisk(dir, out) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    if (ent.name.startsWith('.')) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkDisk(abs, out);
      continue;
    }
    if (!/\.(safetensors|ckpt|pt)$/i.test(ent.name)) continue;
    out.push(path.resolve(abs).toLowerCase());
  }
}

const diskPaths = [];
walkDisk(loraFolder, diskPaths);
const cachedKeys = new Set(localFiles.map((f) => f.abs));
const unhashedOnDisk = diskPaths.filter((p) => !cachedKeys.has(p));

/** @type {Map<string, { id: number, name: string, fileName?: string }>} */
const catalogByHash = new Map();
let catalogLora = 0;
let catalogLoraWithHash = 0;
let catalogLoraMissingHash = 0;

const modelsDir = path.join(catalogRoot, 'models');
walkModelPages(modelsDir, (model) => {
  const type = String(model.type ?? '');
  if (type.toLowerCase() === 'checkpoint') return;
  if (type && type.toUpperCase() !== 'LORA' && type.toLowerCase() !== 'lora') {
    // Skip non-LoRA (Checkpoint, Embedding, …). Empty type still counted.
    if (type.length > 0) return;
  }

  catalogLora += 1;
  const autoV2 = normalizeAutoV2(model.autoV2);
  if (!autoV2) {
    catalogLoraMissingHash += 1;
    return;
  }
  catalogLoraWithHash += 1;
  if (!catalogByHash.has(autoV2)) {
    catalogByHash.set(autoV2, {
      id: model.id,
      name: model.name ?? '',
      fileName: model.fileName,
    });
  }
});

const localWithHash = localFiles.filter((f) => f.autoV2);
const localMatched = localWithHash.filter((f) => catalogByHash.has(f.autoV2));
const localUnmatched = localWithHash.filter((f) => !catalogByHash.has(f.autoV2));

const matchedCatalogIds = new Set();
for (const f of localMatched) {
  const hit = catalogByHash.get(f.autoV2);
  if (hit) matchedCatalogIds.add(hit.id);
}

console.log(`UserData:     ${root}`);
console.log(`Origin:       ${origin} (host ${host})`);
console.log(`LoRA folder:  ${loraFolder}`);
console.log('');
console.log('--- Local ---');
console.log(`Disk model files:           ${diskPaths.length.toLocaleString()}`);
console.log(`In hash cache (under folder): ${localFiles.length.toLocaleString()}`);
console.log(`  with AutoV2:              ${localWithHash.length.toLocaleString()}`);
console.log(`  missing from hash cache:  ${unhashedOnDisk.length.toLocaleString()}`);
console.log('');
console.log('--- Catalog cache (LoRA-like) ---');
console.log(`LoRA models in cache:       ${catalogLora.toLocaleString()}`);
console.log(`  with AutoV2:              ${catalogLoraWithHash.toLocaleString()}`);
console.log(`  WITHOUT AutoV2:           ${catalogLoraMissingHash.toLocaleString()}`);
console.log('');
console.log('--- Match (local AutoV2 ∈ catalog) ---');
console.log(`Matched local files:        ${localMatched.length.toLocaleString()}`);
console.log(`Unmatched local files:      ${localUnmatched.length.toLocaleString()}`);
console.log(
  `Distinct catalog models hit: ${matchedCatalogIds.size.toLocaleString()}`,
);
console.log('');
console.log('Likely reasons a local file does not match:');
console.log('  1. Not in your synced catalog (wrong site, or never filled that slice)');
console.log('  2. Catalog row lacks AutoV2 (API sync before hashes / primary file gap)');
console.log('  3. Different file than Civitai primary (older/newer version, HF re-upload)');
console.log('  4. Removed from Civitai / self-trained / non-Civitai source');
console.log('');

if (unhashedOnDisk.length > 0) {
  console.log(
    `Unhashed on disk (open Browse once to finish hashing), first ${Math.min(printLimit, unhashedOnDisk.length)}:`,
  );
  for (const p of unhashedOnDisk.slice(0, printLimit)) {
    console.log(`  ${p}`);
  }
  console.log('');
}

console.log(
  `Unmatched hashed locals, first ${Math.min(printLimit, localUnmatched.length)}:`,
);
for (const f of localUnmatched.slice(0, printLimit)) {
  const rel = f.abs.startsWith(loraRootKey)
    ? f.abs.slice(loraRootKey.length).replace(/^[\\/]/, '')
    : f.abs;
  console.log(`  ${f.autoV2}  ${rel}`);
}

if (outPath) {
  const lines = [
    'autoV2,relativePath,absolutePath,sizeBytes',
    ...localUnmatched.map((f) => {
      const rel = f.abs.startsWith(loraRootKey)
        ? f.abs.slice(loraRootKey.length).replace(/^[\\/]/, '')
        : f.abs;
      const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
      return [f.autoV2, esc(rel), esc(f.abs), f.size].join(',');
    }),
  ];
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`\nWrote ${localUnmatched.length} rows → ${outPath}`);
}

if (catalogLoraMissingHash > 1000) {
  console.log(
    `\nNote: ${catalogLoraMissingHash.toLocaleString()} cached LoRAs have no AutoV2 — ` +
      'those can never hash-match. Re-sync / fill the catalog (or backfill) to improve coverage.',
  );
}
