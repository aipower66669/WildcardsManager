/**
 * After electron-builder, delete older WildcardsManager-* artifacts from the
 * release output folder so patch bumps do not pile up .exe / .blockmap files.
 * Keeps files for the current package.json version plus non-versioned helpers
 * (latest.yml, builder-*.yml, etc.).
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const version =
  typeof pkg.version === 'string' ? pkg.version.trim() : '';
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(
    `[clean-old-releases] cannot parse version: ${JSON.stringify(version)}`,
  );
  process.exit(1);
}

const outDir =
  typeof pkg.build?.directories?.output === 'string'
    ? path.resolve(root, pkg.build.directories.output)
    : path.join(root, 'release');

if (!fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
  console.log(`[clean-old-releases] no output folder at ${outDir}`);
  process.exit(0);
}

const keepNeedle = `-${version}-`;
const artifactRe = /^WildcardsManager-/i;
let removed = 0;

for (const name of fs.readdirSync(outDir)) {
  if (!artifactRe.test(name)) continue;
  if (name.includes(keepNeedle)) continue;
  const full = path.join(outDir, name);
  try {
    if (!fs.statSync(full).isFile()) continue;
    fs.unlinkSync(full);
    console.log(`[clean-old-releases] removed ${name}`);
    removed += 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[clean-old-releases] could not remove ${name}: ${message}`);
  }
}

if (removed === 0) {
  console.log(
    `[clean-old-releases] nothing to remove (kept WildcardsManager-* for ${version})`,
  );
} else {
  console.log(
    `[clean-old-releases] removed ${removed} old artifact(s); kept version ${version}`,
  );
}
