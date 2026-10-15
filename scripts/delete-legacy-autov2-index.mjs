import fs from 'node:fs';
import path from 'node:path';

const settings = JSON.parse(
  fs.readFileSync(
    path.join(process.env.APPDATA, 'wildcards-manager', 'settings.json'),
    'utf8',
  ),
);

function indexCandidates(wildcardsRoot) {
  const sibling = path.join(
    path.dirname(wildcardsRoot),
    `${path.basename(wildcardsRoot)}.wcm`,
    'cache',
    'civitai-catalog',
    'autoV2-index.json',
  );
  const legacy = path.join(
    wildcardsRoot,
    '!Cache',
    'civitai-catalog',
    'autoV2-index.json',
  );
  return [sibling, legacy];
}

for (const lib of settings.libraries || []) {
  if (!lib.wildcardsRoot) continue;
  let found = null;
  for (const p of indexCandidates(lib.wildcardsRoot)) {
    if (fs.existsSync(p)) {
      found = p;
      break;
    }
  }
  if (!found) {
    console.log(lib.name, 'no index');
    continue;
  }
  const st = fs.statSync(found);
  const fd = fs.openSync(found, 'r');
  const buf = Buffer.alloc(64);
  fs.readSync(fd, buf, 0, 64, 0);
  fs.closeSync(fd);
  const head = buf.toString('utf8');
  const isV2 = /"version"\s*:\s*2\b/.test(head);
  console.log(lib.name, found, `${(st.size / 1e6).toFixed(1)}MB`, 'v2?', isV2);
  if (!isV2) {
    fs.unlinkSync(found);
    console.log('  deleted legacy index');
  }
}
