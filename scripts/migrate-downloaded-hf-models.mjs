/**
 * Idempotent: ensure each library's sibling `library.json` has
 * `downloadedHfModels` (default []). Missing means no Hub repo is marked
 * downloaded for that library.
 *
 * Reads wildcards-folder pointers from AppData settings.json, then rewrites
 * only each library sidecar. Does not print model names or folder paths.
 *
 * Usage: node scripts/migrate-downloaded-hf-models.mjs
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

function libraryJsonPath(wildcardsRoot) {
  const resolved = path.resolve(wildcardsRoot);
  const root = path.parse(resolved).root;
  if (resolved === root) return null;
  const base = path.basename(resolved);
  return path.join(path.dirname(resolved), `${base}.wcm`, 'library.json');
}

const file = settingsPath();
if (!fs.existsSync(file)) {
  console.log('No settings file — nothing to migrate.');
  process.exit(0);
}

const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const libraries = Array.isArray(raw.libraries) ? raw.libraries : [];
const seen = new Set();
let updated = 0;
let already = 0;
let missing = 0;
let skippedRoot = 0;

for (const lib of libraries) {
  if (!lib || typeof lib !== 'object') continue;
  if (typeof lib.wildcardsRoot !== 'string' || !lib.wildcardsRoot.trim()) {
    missing += 1;
    continue;
  }
  const jsonPath = libraryJsonPath(lib.wildcardsRoot);
  if (!jsonPath) {
    skippedRoot += 1;
    continue;
  }
  const key = jsonPath.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  if (!fs.existsSync(jsonPath)) {
    missing += 1;
    continue;
  }
  const store = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    console.log('Skipped a library.json that is not an object.');
    continue;
  }
  if (Array.isArray(store.downloadedHfModels)) {
    already += 1;
    continue;
  }
  store.downloadedHfModels = [];
  const tmp = `${jsonPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(store)}\n`, 'utf8');
  fs.renameSync(tmp, jsonPath);
  updated += 1;
}

console.log(
  `library.json downloadedHfModels: updated ${updated}, already present ${already}, no file ${missing}, drive-root skipped ${skippedRoot}.`,
);
