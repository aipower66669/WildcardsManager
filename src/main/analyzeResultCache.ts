/**
 * Persist the last wildcard graph per root file. Restart should show the
 * previous analysis instantly; a worker rebuilds in the background.
 */
import fs from 'node:fs';
import path from 'node:path';
import { wildcardsCacheDir } from '../domain/librarySidecarPaths.js';
import type { AnalysisResultDto } from '../shared/contracts.js';

const STORE_VERSION = 1 as const;

type DiskEntry = {
  version: typeof STORE_VERSION;
  libraryFp: string;
  platform: string;
  result: AnalysisResultDto;
};

const memory = new Map<string, DiskEntry>();

function cacheKey(rootFile: string, libraryFp: string, platform: string): string {
  return `${rootFile.replace(/\\/g, '/')}\0${libraryFp}\0${platform}`;
}

function filePath(wildcardsRoot: string, rootFile: string): string {
  const slug = rootFile
    .replace(/\\/g, '/')
    .replace(/[^a-zA-Z0-9._/-]/g, '_')
    .replace(/\//g, '__');
  return path.join(
    wildcardsCacheDir(wildcardsRoot),
    'analysis',
    `${slug || 'root'}.json`,
  );
}

export function getCachedAnalysis(opts: {
  wildcardsRoot: string;
  rootFile: string;
  libraryFp: string;
  platform: string;
}): AnalysisResultDto | null {
  const key = cacheKey(opts.rootFile, opts.libraryFp, opts.platform);
  const mem = memory.get(key);
  if (mem) return mem.result;
  try {
    const raw = JSON.parse(
      fs.readFileSync(filePath(opts.wildcardsRoot, opts.rootFile), 'utf8'),
    ) as DiskEntry;
    if (
      raw?.version !== STORE_VERSION ||
      raw.libraryFp !== opts.libraryFp ||
      raw.platform !== opts.platform ||
      !raw.result
    ) {
      return null;
    }
    memory.set(key, raw);
    return raw.result;
  } catch {
    return null;
  }
}

export function rememberAnalysis(opts: {
  wildcardsRoot: string;
  rootFile: string;
  libraryFp: string;
  platform: string;
  result: AnalysisResultDto;
}): void {
  const entry: DiskEntry = {
    version: STORE_VERSION,
    libraryFp: opts.libraryFp,
    platform: opts.platform,
    result: opts.result,
  };
  memory.set(cacheKey(opts.rootFile, opts.libraryFp, opts.platform), entry);
  const file = filePath(opts.wildcardsRoot, opts.rootFile);
  setImmediate(() => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(entry)}\n`, 'utf8');
      try {
        fs.renameSync(temp, file);
      } catch {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        fs.renameSync(temp, file);
      }
    } catch {
      // Cache is optional — analysis already returned in memory.
    }
  });
}

export function clearAnalysisCacheMemory(): void {
  memory.clear();
}
