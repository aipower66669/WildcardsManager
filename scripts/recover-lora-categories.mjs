/**
 * Recover empty loraDownloadCategories from on-disk LoRA folders +
 * best-effort wildcard name matches. Counts/names only in logs.
 *
 * Usage:
 *   node scripts/recover-lora-categories.mjs --dry-run
 *   node scripts/recover-lora-categories.mjs --write --library ComfyUI
 *   node scripts/recover-lora-categories.mjs --write --library all
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_WEIGHTS = '{0.8|0.9|1|1}';

const args = new Set(process.argv.slice(2));
const write = args.has('--write');
const force = args.has('--force');
const libraryArg = (() => {
  const i = process.argv.indexOf('--library');
  return i >= 0 ? process.argv[i + 1] : 'ComfyUI';
})();

const settingsPath = path.join(
  process.env.APPDATA,
  'wildcards-manager',
  'settings.json',
);
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

function listWildcardFiles(root) {
  const out = [];
  function walk(dir) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === '!.wcm' || name === '!Cache' || name === '!Thumbnails') {
        continue;
      }
      const p = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (/\.(txt|ya?ml|json)$/i.test(name)) {
        out.push(path.relative(root, p).split(path.sep).join('/'));
      }
    }
  }
  walk(root);
  return out;
}

function stem(rel) {
  const base = rel.split('/').pop() ?? rel;
  return base.replace(/\.(txt|ya?ml|json)$/i, '');
}

function bestWildcard(folder, wcFiles) {
  const lower = folder.toLowerCase();
  const candidates = [lower, `${lower}s`, `x-${lower}`];
  for (const want of candidates) {
    const hits = wcFiles
      .filter((f) => stem(f).toLowerCase() === want)
      .sort((a, b) => {
        // Prefer top-level files over nested.
        const ad = a.includes('/') ? 1 : 0;
        const bd = b.includes('/') ? 1 : 0;
        return ad - bd || a.length - b.length || a.localeCompare(b);
      });
    if (hits[0]) return { path: hits[0], guessed: false };
  }
  // Placeholder so the category row exists; user must point it at a real wildcard.
  return { path: `${folder.toLowerCase()}.txt`, guessed: true };
}

function proposeForLibrary(lib) {
  if (!lib.loraFolder || !lib.wildcardsRoot) {
    return { lib, error: 'missing folders', proposed: [] };
  }
  const folders = fs
    .readdirSync(lib.loraFolder, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() && !e.name.startsWith('!') && !e.name.startsWith('.'),
    )
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const wcFiles = listWildcardFiles(lib.wildcardsRoot);
  const proposed = folders.map((folder) => {
    const match = bestWildcard(folder, wcFiles);
    return {
      id: crypto.randomUUID(),
      name: folder,
      folder,
      wildcardRelativePath: match.path,
      defaultWeights: DEFAULT_WEIGHTS,
      guessedWildcard: match.guessed,
    };
  });
  return { lib, wcFiles: wcFiles.length, proposed };
}

const targets = (settings.libraries ?? []).filter((lib) => {
  if (libraryArg === 'all') return true;
  return lib.name === libraryArg;
});

if (targets.length === 0) {
  console.error('No matching library for', libraryArg);
  process.exit(1);
}

for (const lib of targets) {
  const result = proposeForLibrary(lib);
  console.log('===', lib.name, '===');
  if (result.error) {
    console.log(result.error);
    continue;
  }
  console.log('wildcard files indexed', result.wcFiles);
  const matched = result.proposed.filter((p) => !p.guessedWildcard);
  const guessed = result.proposed.filter((p) => p.guessedWildcard);
  console.log(
    'proposed categories',
    result.proposed.length,
    'matched wildcard',
    matched.length,
    'placeholder wildcard',
    guessed.length,
  );
  for (const p of result.proposed) {
    console.log(
      `  ${p.name} -> folder=${p.folder} wildcard=${p.wildcardRelativePath}${p.guessedWildcard ? ' (PLACEHOLDER — edit me)' : ''}`,
    );
  }

  if (!write) continue;

  const siblingLibrary = path.join(
    path.dirname(lib.wildcardsRoot),
    `${path.basename(lib.wildcardsRoot)}.wcm`,
    'library.json',
  );
  const legacyLibrary = path.join(lib.wildcardsRoot, '!.wcm', 'library.json');
  const libraryPath = fs.existsSync(siblingLibrary)
    ? siblingLibrary
    : legacyLibrary;
  const raw = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
  const existing = Array.isArray(raw.loraDownloadCategories)
    ? raw.loraDownloadCategories
    : [];
  if (existing.length > 0 && !force) {
    console.log(
      'REFUSING write: library.json already has',
      existing.length,
      'categories (pass --force to merge by folder)',
    );
    continue;
  }

  const bak = `${libraryPath}.pre-category-recover.${Date.now()}.bak`;
  fs.copyFileSync(libraryPath, bak);
  console.log('backed up', path.basename(bak));

  const byFolder = new Map();
  for (const cat of existing) {
    if (cat && typeof cat.folder === 'string' && cat.folder.trim()) {
      byFolder.set(cat.folder.trim().toLowerCase(), cat);
    }
  }

  const valid = [];
  for (const p of result.proposed) {
    const kept = byFolder.get(p.folder.toLowerCase());
    if (kept) {
      valid.push(kept);
      console.log(`  keeping existing: ${kept.name} (${kept.folder})`);
      continue;
    }
    const { guessedWildcard: _g, ...cat } = p;
    valid.push(cat);
  }

  raw.loraDownloadCategories = valid;
  if (
    lib.name === 'A1111' &&
    raw.lastCivitaiDownloadCategory?.LORA &&
    !raw.lastLoraDownloadCategoryId
  ) {
    const hit = valid.find(
      (c) => c.name === raw.lastCivitaiDownloadCategory.LORA,
    );
    if (hit) raw.lastLoraDownloadCategoryId = hit.id;
  }
  fs.writeFileSync(libraryPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  console.log('wrote', valid.length, 'categories to', libraryPath);
}

if (!write) {
  console.log('\nDry run only. Re-run with --write to apply.');
}
