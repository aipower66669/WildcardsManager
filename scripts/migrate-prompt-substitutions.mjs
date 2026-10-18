/**
 * Idempotent: ensure each library's sibling `library.json` has
 * `promptSubstitutions` (default []). Missing means generation sends prompts
 * unchanged. Existing rule arrays are left as-is.
 *
 * Reads wildcards-folder pointers from AppData settings.json, then rewrites
 * only each library sidecar. Does not print model names, rules, or folder paths.
 *
 * Usage: node scripts/migrate-prompt-substitutions.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export function settingsPath() {
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

export function libraryJsonPath(wildcardsRoot) {
  const resolved = path.resolve(wildcardsRoot);
  const root = path.parse(resolved).root;
  if (resolved === root) return null;
  const base = path.basename(resolved);
  return path.join(path.dirname(resolved), `${base}.wcm`, 'library.json');
}

/**
 * @param {string} settingsFile
 * @returns {{ updated: number, already: number, missing: number, skippedRoot: number, absent: boolean }}
 */
export function migrateFromSettingsFile(settingsFile) {
  const counts = {
    updated: 0,
    already: 0,
    missing: 0,
    skippedRoot: 0,
    absent: false,
  };
  if (!fs.existsSync(settingsFile)) {
    counts.absent = true;
    return counts;
  }

  const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const libraries = Array.isArray(raw.libraries) ? raw.libraries : [];
  const seen = new Set();

  for (const lib of libraries) {
    if (!lib || typeof lib !== 'object') continue;
    if (typeof lib.wildcardsRoot !== 'string' || !lib.wildcardsRoot.trim()) {
      counts.missing += 1;
      continue;
    }
    const jsonPath = libraryJsonPath(lib.wildcardsRoot);
    if (!jsonPath) {
      counts.skippedRoot += 1;
      continue;
    }
    const key = jsonPath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!fs.existsSync(jsonPath)) {
      counts.missing += 1;
      continue;
    }
    const store = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (!store || typeof store !== 'object' || Array.isArray(store)) {
      console.log('Skipped a library.json that is not an object.');
      continue;
    }
    if (Array.isArray(store.promptSubstitutions)) {
      counts.already += 1;
      continue;
    }
    store.promptSubstitutions = [];
    const tmp = `${jsonPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(store)}\n`, 'utf8');
    fs.renameSync(tmp, jsonPath);
    counts.updated += 1;
  }

  return counts;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  const file = settingsPath();
  const counts = migrateFromSettingsFile(file);
  if (counts.absent) {
    console.log('No settings file — nothing to migrate.');
  } else {
    console.log(
      `library.json promptSubstitutions: updated ${counts.updated}, already present ${counts.already}, no file ${counts.missing}, drive-root skipped ${counts.skippedRoot}.`,
    );
  }
}
