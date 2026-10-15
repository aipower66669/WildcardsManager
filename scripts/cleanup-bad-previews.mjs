import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

app.setPath('userData', path.join(app.getPath('appData'), 'wildcards-manager'));

app.whenReady().then(() => {
  const dir = path.join(app.getPath('userData'), 'civitai-preview-cache');
  let removed = 0;
  let bytes = 0;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.') || !/\.(jpe?g|png|webp|gif|avif|bin)$/i.test(name)) {
      continue;
    }
    const abs = path.join(dir, name);
    const size = fs.statSync(abs).size;
    const img = nativeImage.createFromPath(abs);
    let oversized = false;
    if (!img.isEmpty()) {
      const s = img.getSize();
      oversized = s.width > 360 || s.height > 540;
    }
    if (img.isEmpty() || oversized) {
      bytes += size;
      fs.unlinkSync(abs);
      removed += 1;
    }
  }
  const left = fs.readdirSync(dir).filter((n) => !n.startsWith('.'));
  const leftBytes = left.reduce(
    (sum, n) => sum + fs.statSync(path.join(dir, n)).size,
    0,
  );
  console.log(
    JSON.stringify({
      removed,
      mbFreed: Number((bytes / 1024 / 1024).toFixed(1)),
      remaining: left.length,
      mbLeft: Number((leftBytes / 1024 / 1024).toFixed(1)),
    }),
  );
  app.exit(0);
});
