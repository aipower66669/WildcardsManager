/**
 * Increment package.json patch (Major.Minor.Patch → +1 Patch) and sync the
 * root package-lock version. Used by `npm run dist*` so each local build is
 * newer than the last for in-app Check for update.
 *
 * Skipped in CI (GITHUB_ACTIONS) and when SKIP_VERSION_BUMP=1 so tagged
 * GitHub releases keep the version that matches the tag.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const skip =
  process.env.SKIP_VERSION_BUMP === '1' ||
  process.env.GITHUB_ACTIONS === 'true' ||
  process.env.CI === 'true';

if (skip) {
  console.log(
    '[bump-patch] skipped (CI or SKIP_VERSION_BUMP=1) — leaving package version as-is',
  );
  process.exit(0);
}

const pkgPath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const current = typeof pkg.version === 'string' ? pkg.version.trim() : '';
const m = current.match(/^(\d+)\.(\d+)\.(\d+)(.*)?$/);
if (!m) {
  console.error(`[bump-patch] cannot parse version: ${JSON.stringify(current)}`);
  process.exit(1);
}

const next = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
pkg.version = next;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = next;
  if (lock.packages && typeof lock.packages === 'object' && lock.packages['']) {
    lock.packages[''].version = next;
  }
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

console.log(`[bump-patch] ${current} → ${next}`);
