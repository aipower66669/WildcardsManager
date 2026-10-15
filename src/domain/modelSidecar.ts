import path from 'node:path';
import fs from 'node:fs';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'] as const;

export type ModelSidecarScan = {
  imageAbsolutePath?: string;
  imageRelativePath?: string;
  jsonAbsolutePath?: string;
  jsonRelativePath?: string;
  json?: unknown;
  jsonParseError?: string;
};

function siblingWithExt(modelAbsolutePath: string, ext: string): string {
  const dir = path.dirname(modelAbsolutePath);
  const base = path.basename(modelAbsolutePath, path.extname(modelAbsolutePath));
  return path.join(dir, `${base}${ext}`);
}

function firstExistingSibling(
  modelAbsolutePath: string,
  exts: readonly string[],
): string | undefined {
  for (const ext of exts) {
    const abs = siblingWithExt(modelAbsolutePath, ext);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
    } catch {
      // ignore
    }
  }
  return undefined;
}

/**
 * Fast path for list views: detect companions without reading/parsing JSON.
 */
export function scanModelSidecarsLite(
  modelAbsolutePath: string,
  modelRoot: string,
): Pick<
  ModelSidecarScan,
  | 'imageAbsolutePath'
  | 'imageRelativePath'
  | 'jsonAbsolutePath'
  | 'jsonRelativePath'
> {
  const out: ReturnType<typeof scanModelSidecarsLite> = {};
  const imageAbs = firstExistingSibling(modelAbsolutePath, IMAGE_EXTS);
  if (imageAbs) {
    out.imageAbsolutePath = imageAbs;
    out.imageRelativePath = path
      .relative(modelRoot, imageAbs)
      .split(path.sep)
      .join('/');
  }
  const jsonAbs = firstExistingSibling(modelAbsolutePath, ['.json']);
  if (jsonAbs) {
    out.jsonAbsolutePath = jsonAbs;
    out.jsonRelativePath = path
      .relative(modelRoot, jsonAbs)
      .split(path.sep)
      .join('/');
  }
  return out;
}

/**
 * Find same-stem companions next to a model file (preview image / metadata JSON).
 * Prefers `.jpg` then `.jpeg` / `.png` / `.webp` / `.gif` for images.
 */
export function scanModelSidecars(
  modelAbsolutePath: string,
  modelRoot: string,
): ModelSidecarScan {
  const lite = scanModelSidecarsLite(modelAbsolutePath, modelRoot);
  const out: ModelSidecarScan = { ...lite };
  if (!lite.jsonAbsolutePath) return out;
  try {
    const raw = fs.readFileSync(lite.jsonAbsolutePath, 'utf8');
    out.json = JSON.parse(raw) as unknown;
  } catch (e) {
    out.jsonParseError =
      e instanceof Error ? e.message : 'Failed to parse JSON';
  }
  return out;
}
