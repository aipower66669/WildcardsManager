/**
 * Ensure `blockedCivitaiCreators` exists on each library.json payload.
 * Idempotent — only writes when the field is missing.
 *
 * Usage: node scripts/migrate-blocked-civitai-creators.mjs
 *
 * Reads library root pointers from AppData settings.json and rewrites
 * sibling `<basename>.wcm/library.json` files. Does not inspect model content.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const appData =
  process.env.APPDATA ||
  (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : path.join(os.homedir(), '.config'));
const settingsPath = path.join(appData, 'wildcards-manager', 'settings.json');

function libraryJsonPath(wildcardsRoot) {
  const base = path.basename(path.resolve(wildcardsRoot));
  return path.join(path.dirname(path.resolve(wildcardsRoot)), `${base}.wcm`, 'library.json');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(temp, file);
  } catch {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.renameSync(temp, file);
  }
}

const settings = readJson(settingsPath);
if (!settings) {
  console.log(`No settings at ${settingsPath} — nothing to migrate.`);
  process.exit(0);
}

const libraries = Array.isArray(settings.libraries) ? settings.libraries : [];
let touched = 0;
let skipped = 0;

for (const lib of libraries) {
  const root =
    typeof lib?.wildcardsRoot === 'string' ? lib.wildcardsRoot.trim() : '';
  if (!root) {
    skipped += 1;
    continue;
  }
  const file = libraryJsonPath(root);
  const payload = readJson(file);
  if (!payload || payload.version !== 1) {
    skipped += 1;
    continue;
  }
  if (Array.isArray(payload.blockedCivitaiCreators)) {
    skipped += 1;
    continue;
  }
  writeJson(file, { ...payload, blockedCivitaiCreators: [] });
  touched += 1;
  console.log(`Updated ${file}`);
}

console.log(
  `blockedCivitaiCreators migration done: ${touched} updated, ${skipped} skipped.`,
);
