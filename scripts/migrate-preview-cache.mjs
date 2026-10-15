/**
 * One-shot: downscale existing civitai preview cache in place.
 * Usage: npx electron scripts/migrate-preview-cache.mjs
 */
import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const PREVIEW_MAX_WIDTH = 360;
const PREVIEW_MAX_HEIGHT = 540;
const JPEG_QUALITY = 82;
const CACHE_VERSION = 3;

// Match the packaged / electron-vite app userData folder.
app.setPath(
  'userData',
  path.join(app.getPath('appData'), 'wildcards-manager'),
);

app.whenReady().then(() => {
  const dir = path.join(app.getPath('userData'), 'civitai-preview-cache');
  if (!fs.existsSync(dir)) {
    console.log(`No cache dir: ${dir}`);
    app.exit(0);
    return;
  }

  const versionPath = path.join(dir, '.cache-version');
  const entries = fs.readdirSync(dir).filter((name) => {
    if (name.startsWith('.')) return false;
    if (name.endsWith('.partial')) return false;
    return /^[a-f0-9]{40}/i.test(name);
  });

  const byHash = new Map();
  for (const name of entries) {
    const hash = name.slice(0, 40).toLowerCase();
    const list = byHash.get(hash) ?? [];
    list.push(name);
    byHash.set(hash, list);
  }

  let converted = 0;
  let removed = 0;
  let failed = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (const [urlHash, names] of byHash) {
    let sourceName = names[0];
    let sourceSize = 0;
    for (const name of names) {
      const abs = path.join(dir, name);
      const size = fs.statSync(abs).size;
      bytesBefore += size;
      if (size > sourceSize) {
        sourceSize = size;
        sourceName = name;
      }
    }

    const sourceAbs = path.join(dir, sourceName);
    const destName = `${urlHash}.jpg`;
    const destAbs = path.join(dir, destName);
    const tempAbs = `${destAbs}.partial`;

    try {
      const raw = fs.readFileSync(sourceAbs);
      let image = nativeImage.createFromBuffer(raw);
      if (image.isEmpty()) {
        image = nativeImage.createFromPath(sourceAbs);
      }
      if (image.isEmpty()) {
        // Undecodable — delete so the app re-fetches a proper thumb later.
        for (const name of names) {
          try {
            fs.unlinkSync(path.join(dir, name));
            removed += 1;
          } catch {
            // ignore
          }
        }
        failed += 1;
        continue;
      }
      const { width, height } = image.getSize();
      if (width > PREVIEW_MAX_WIDTH || height > PREVIEW_MAX_HEIGHT) {
        const scale = Math.min(
          PREVIEW_MAX_WIDTH / width,
          PREVIEW_MAX_HEIGHT / height,
        );
        image = image.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: 'better',
        });
      }
      const jpeg = image.toJPEG(JPEG_QUALITY);
      fs.writeFileSync(tempAbs, jpeg);
      for (const name of names) {
        const abs = path.join(dir, name);
        if (abs === tempAbs) continue;
        try {
          fs.unlinkSync(abs);
          removed += 1;
        } catch {
          // ignore
        }
      }
      if (fs.existsSync(destAbs) && destAbs !== tempAbs) {
        try {
          fs.unlinkSync(destAbs);
        } catch {
          // ignore
        }
      }
      fs.renameSync(tempAbs, destAbs);
      bytesAfter += fs.statSync(destAbs).size;
      converted += 1;
    } catch (e) {
      failed += 1;
      console.warn(`Failed ${urlHash}:`, e instanceof Error ? e.message : e);
      try {
        if (fs.existsSync(tempAbs)) fs.unlinkSync(tempAbs);
      } catch {
        // ignore
      }
    }
  }

  fs.writeFileSync(versionPath, `${CACHE_VERSION}\n`, 'utf8');

  const mb = (n) => (n / (1024 * 1024)).toFixed(1);
  console.log(
    JSON.stringify(
      {
        dir,
        hashes: byHash.size,
        converted,
        removed,
        failed,
        mbBefore: Number(mb(bytesBefore)),
        mbAfter: Number(mb(bytesAfter)),
      },
      null,
      2,
    ),
  );
  app.exit(failed > 0 && converted === 0 ? 1 : 0);
});
