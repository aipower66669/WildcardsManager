/**
 * Idempotent: ensure each library's LoRA and checkpoint `!.wcm/models.json`
 * has an `ignored` array. Missing means "none ignored"; this writes `[]`
 * so the field is there to edit. Existing entries are left unchanged.
 *
 * Reads folder pointers from AppData settings.json, then rewrites only the
 * sidecar JSON. Does not list or print model names.
 *
 * Usage: node scripts/migrate-models-ignored.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function settingsPath() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error('APPDATA is not set');
    return path.join(appData, 'wildcards-manager', 'settings.json');
  }
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'wildcards-manager',
      'settings.json',
    );
  }
  return path.join(os.homedir(), '.config', 'wildcards-manager', 'settings.json');
}

function resolveOptionalDir(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return path.resolve(raw.trim());
}

const file = settingsPath();
if (!fs.existsSync(file)) {
  console.log('No settings file — nothing to migrate.');
  process.exit(0);
}

const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const libraries = Array.isArray(raw.libraries) ? raw.libraries : [];
const roots = new Set();
for (const lib of libraries) {
  if (!lib || typeof lib !== 'object') continue;
  const lora = resolveOptionalDir(lib.loraFolder);
  const checkpoint = resolveOptionalDir(lib.checkpointFolder);
  if (lora) roots.add(lora);
  if (checkpoint) roots.add(checkpoint);
}

let updated = 0;
let already = 0;
let missing = 0;

for (const root of roots) {
  const modelsFile = path.join(root, '!.wcm', 'models.json');
  if (!fs.existsSync(modelsFile)) {
    missing += 1;
    continue;
  }
  const store = JSON.parse(fs.readFileSync(modelsFile, 'utf8'));
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    console.log('Skipped a models.json that is not an object.');
    continue;
  }
  if (Array.isArray(store.ignored)) {
    already += 1;
    continue;
  }
  store.ignored = [];
  const tmp = `${modelsFile}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, modelsFile);
  updated += 1;
}

console.log(
  `models.json ignored: updated ${updated}, already present ${already}, no file ${missing}.`,
);
