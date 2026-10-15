import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

app.setPath('userData', path.join(app.getPath('appData'), 'wildcards-manager'));

app.whenReady().then(() => {
  const dir = path.join(app.getPath('userData'), 'civitai-preview-cache');
  const large = fs
    .readdirSync(dir)
    .filter((n) => !n.startsWith('.') && n.endsWith('.jpg'))
    .map((n) => {
      const abs = path.join(dir, n);
      const size = fs.statSync(abs).size;
      return { n, abs, size };
    })
    .filter((f) => f.size > 300_000)
    .sort((a, b) => b.size - a.size);

  console.log(`oversized files (>300KB): ${large.length}`);
  for (const f of large.slice(0, 15)) {
    const img = nativeImage.createFromPath(f.abs);
    const sz = img.isEmpty() ? null : img.getSize();
    console.log(
      `${(f.size / 1024 / 1024).toFixed(2)}MB empty=${img.isEmpty()} size=${sz ? `${sz.width}x${sz.height}` : 'n/a'} ${f.n.slice(0, 12)}…`,
    );
  }
  app.exit(0);
});
