import { HF_SITE_ORIGIN } from './huggingfaceSearch.js';

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/** Public file URL (inline). Download links add `?download=true` separately. */
export function huggingfaceRepoFileUrl(
  repoId: string,
  filePath: string,
  revision = 'main',
): string {
  const id = repoId.trim().replace(/^\/+|\/+$/g, '');
  const file = filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const rev = revision.trim() || 'main';
  return `${HF_SITE_ORIGIN}/${id}/resolve/${encodeURIComponent(rev)}/${file
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}

/**
 * Best sample image in a Hub repo file list.
 * Prefers cover / hero / thumbnail names, then showcase folders.
 * Returns null when the repo has no image file.
 */
export function pickHfPreviewFile(paths: readonly string[]): string | null {
  let best: { path: string; score: number } | null = null;
  for (const raw of paths) {
    const path = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    if (!path || !IMAGE_EXT.test(path)) continue;
    if (/(^|\/)\./.test(path)) continue;
    const lower = path.toLowerCase();
    const base = lower.split('/').pop() ?? lower;
    let score = 0;
    if (/^(hero|cover|thumbnail|thumb|preview|banner)\b/.test(base)) score += 80;
    if (/(hero|cover|thumbnail|preview|banner)/.test(lower)) score += 30;
    if (/(showcase|sample|example)/.test(lower)) score += 20;
    if (
      /^(images|image|img|assets|asset|media|showcase|examples|example|samples|sample)\//.test(
        lower,
      )
    ) {
      score += 8;
    }
    if (/\/input\//.test(lower)) score -= 25;
    if (lower.endsWith('.gif')) score -= 1;
    score -= lower.split('/').length;
    if (!best || score > best.score) best = { path, score };
  }
  return best?.path ?? null;
}

/** Card image when the model card names one, or a sample file exists. */
export function hfPreviewUrlFromRepoFiles(opts: {
  repoId: string;
  files: readonly string[];
  thumbnail?: string | null;
}): string | null {
  const repoId = opts.repoId.trim();
  if (!repoId) return null;
  const thumbnail = opts.thumbnail?.trim() ?? '';
  if (thumbnail) {
    if (/^https?:\/\//i.test(thumbnail)) return thumbnail;
    return huggingfaceRepoFileUrl(repoId, thumbnail);
  }
  const picked = pickHfPreviewFile(opts.files);
  return picked ? huggingfaceRepoFileUrl(repoId, picked) : null;
}
