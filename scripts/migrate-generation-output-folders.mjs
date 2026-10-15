/**
 * Idempotent: for each library in AppData settings.json, set
 * generationOutputRealistic from promptsFolder when unset (previous default
 * wrote Generation folder-mode images under the prompts tree).
 *
 * Does not open library content trees — only rewrites path pointers.
 *
 * Usage: node scripts/migrate-generation-output-folders.mjs
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
  return path.join(
    os.homedir(),
    '.config',
    'wildcards-manager',
    'settings.json',
  );
}

function resolveOptionalDir(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return path.resolve(raw.trim());
}

const file = settingsPath();
if (!fs.existsSync(file)) {
  console.log(`No settings at ${file} — nothing to migrate.`);
  process.exit(0);
}

const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const libraries = Array.isArray(raw.libraries) ? raw.libraries : [];
let changed = 0;

for (const lib of libraries) {
  if (!lib || typeof lib !== 'object') continue;
  const prompts = resolveOptionalDir(lib.promptsFolder);
  const current = resolveOptionalDir(lib.generationOutputRealistic);
  if (!current && prompts) {
    lib.generationOutputRealistic = prompts;
    changed += 1;
    console.log(
      `Library “${lib.name ?? lib.id}”: generationOutputRealistic → ${prompts}`,
    );
  }
}

if (changed === 0) {
  console.log('No libraries needed generationOutputRealistic defaults.');
  process.exit(0);
}

const tmp = `${file}.tmp-${process.pid}`;
fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
fs.renameSync(tmp, file);
console.log(`Updated ${changed} library(ies) in ${file}`);
