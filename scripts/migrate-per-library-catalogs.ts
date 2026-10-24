/**
 * Split a shared Civitai catalog and library.json into one copy per library.
 * Reads library ids and wildcards folder pointers from AppData settings.json.
 * Does not print library contents.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migratePerLibraryCatalogs } from '../src/main/perLibraryCatalogMigration.js';

type Pointer = { id: string; wildcardsRoot: string };

function settingsPath(): string {
  const appData = process.env.APPDATA?.trim();
  if (appData) return path.join(appData, 'wildcards-manager', 'settings.json');
  return path.join(os.homedir(), '.config', 'wildcards-manager', 'settings.json');
}

function pointers(file: string): Pointer[] {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    libraries?: Array<{ id?: unknown; wildcardsRoot?: unknown }>;
  };
  const out: Pointer[] = [];
  for (const row of raw.libraries ?? []) {
    if (typeof row.id !== 'string' || !row.id.trim()) continue;
    if (typeof row.wildcardsRoot !== 'string' || !row.wildcardsRoot.trim()) continue;
    out.push({ id: row.id.trim(), wildcardsRoot: row.wildcardsRoot.trim() });
  }
  return out;
}

const file = settingsPath();
if (!fs.existsSync(file)) {
  console.log('per-library catalogs: no settings file, nothing to migrate');
  process.exit(0);
}

const libs = pointers(file);
const groups = new Map<string, { root: string; ids: string[] }>();
for (const lib of libs) {
  const key = path.resolve(lib.wildcardsRoot).toLowerCase();
  const group = groups.get(key) ?? { root: lib.wildcardsRoot, ids: [] };
  group.ids.push(lib.id);
  groups.set(key, group);
}

let roots = 0;
for (const group of groups.values()) {
  migratePerLibraryCatalogs(group.root, group.ids);
  roots += 1;
}
console.log(
  `per-library catalogs: libraries=${libs.length} wildcardsFolders=${roots}`,
);
