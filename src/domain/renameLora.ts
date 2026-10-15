import {
  MODEL_WEIGHT_EXTENSIONS,
  normalizeLoraName,
  resolveLoraName,
  stripLoraExtension,
  type LoraFileEntry,
  type LoraIndex,
} from './lora.js';
import type { LibraryFile } from './types.js';

/** Complete LoRA tags — same shape as extractLoraRefs. */
const LORA_TAG_RE = /<lora:([^:>\n]*)(?::[^>\n]*)?>/gi;

function basename(pathLike: string): string {
  const normalized = pathLike.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? normalized;
}

function dirname(pathLike: string): string {
  const normalized = pathLike.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx < 0 ? '' : normalized.slice(0, idx);
}

function joinRelative(dir: string, name: string): string {
  const d = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  const n = name.replace(/\\/g, '/').replace(/^\/+/, '');
  return d ? `${d}/${n}` : n;
}

function sameAbsPath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();
}

function extensionOf(pathLike: string): string {
  const lower = pathLike.toLowerCase();
  for (const ext of MODEL_WEIGHT_EXTENSIONS) {
    if (lower.endsWith(ext)) return pathLike.slice(pathLike.length - ext.length);
  }
  return '';
}

/**
 * Map a tag's written model name to the post-rename name, preserving whether the
 * reference used a relative stem, basename, and/or file extension.
 */
export function remapLoraRefName(
  oldRefName: string,
  oldFile: LoraFileEntry,
  newStem: string,
): string {
  const written = oldRefName.replace(/\\/g, '/').trim();
  const stripped = stripLoraExtension(written);
  const hadExt = stripped.length !== written.length;
  const ext = hadExt ? written.slice(stripped.length) : '';

  const writtenNorm = normalizeLoraName(stripped);
  const oldStemNorm = normalizeLoraName(oldFile.stem);
  const oldBaseNorm = normalizeLoraName(basename(oldFile.stem));
  const oldRelNorm = normalizeLoraName(stripLoraExtension(oldFile.relativePath));

  let newCore: string;
  if (writtenNorm === oldStemNorm || writtenNorm === oldRelNorm) {
    newCore = newStem.replace(/\\/g, '/');
  } else if (writtenNorm === oldBaseNorm) {
    newCore = basename(newStem);
  } else {
    newCore = basename(newStem);
  }

  return hadExt ? `${stripLoraExtension(newCore)}${ext}` : newCore;
}

/**
 * Rewrite `<lora:…>` tags in text that resolve to `absolutePath` under `index`.
 */
export function rewriteLoraReferences(
  text: string,
  absolutePath: string,
  index: LoraIndex,
  oldFile: LoraFileEntry,
  newStem: string,
): { text: string; count: number } {
  let count = 0;
  const out = text.replace(LORA_TAG_RE, (whole, namePart: string) => {
    const rawName = namePart.trim();
    if (!rawName) return whole;
    const resolved = resolveLoraName(rawName, index);
    if (!resolved || !sameAbsPath(resolved, absolutePath)) return whole;

    const nextName = remapLoraRefName(rawName, oldFile, newStem);
    count += 1;
    const open = /^<lora:/i.exec(whole);
    if (!open) return whole;
    const afterName = whole.slice(open[0].length + namePart.length);
    return `<lora:${nextName}${afterName}`;
  });
  return { text: out, count };
}

/**
 * Remove every complete `<lora:…>` tag in `text` that resolves to `absolutePath`.
 */
export function removeLoraReferences(
  text: string,
  absolutePath: string,
  index: LoraIndex,
): { text: string; count: number } {
  let count = 0;
  const out = text.replace(LORA_TAG_RE, (whole, namePart: string) => {
    const rawName = namePart.trim();
    if (!rawName) return whole;
    const resolved = resolveLoraName(rawName, index);
    if (!resolved || !sameAbsPath(resolved, absolutePath)) return whole;
    count += 1;
    return '';
  });
  return { text: out, count };
}

export type RenameLoraEdit = {
  key: string;
  relativePath: string;
  newText: string;
  occurrences: number;
};

export type RenameLoraPlan = {
  canRename: boolean;
  reason?: string;
  /** Name as it appeared in the tag the user clicked (or passed in). */
  sourceName: string;
  oldFile: LoraFileEntry | null;
  /** Basename stem the user wants (no directory, no extension). */
  newBasename: string;
  /** New relative path under the LoRA folder (with extension). */
  newRelativePath: string;
  newAbsolutePath: string;
  newStem: string;
  edits: RenameLoraEdit[];
  totalOccurrences: number;
  warnings: string[];
};

function findFileByAbsolutePath(
  index: LoraIndex,
  absolutePath: string,
): LoraFileEntry | undefined {
  return index.files.find((f) => sameAbsPath(f.absolutePath, absolutePath));
}

/**
 * Plan renaming a LoRA file's basename and rewriting every library reference that
 * resolves to that file. Pure — no disk I/O beyond what the caller already loaded.
 */
export function planRenameLora(
  index: LoraIndex | null,
  libraryFiles: LibraryFile[],
  sourceName: string,
  rawNewBasename: string,
): RenameLoraPlan {
  const empty: RenameLoraPlan = {
    canRename: false,
    sourceName: sourceName.trim(),
    oldFile: null,
    newBasename: '',
    newRelativePath: '',
    newAbsolutePath: '',
    newStem: '',
    edits: [],
    totalOccurrences: 0,
    warnings: [],
  };

  if (!index) {
    return { ...empty, reason: 'No LoRA folder configured.' };
  }

  const trimmedSource = sourceName.trim();
  if (!trimmedSource) {
    return { ...empty, reason: 'LoRA name is empty.' };
  }

  const absolutePath = resolveLoraName(trimmedSource, index);
  if (!absolutePath) {
    return {
      ...empty,
      sourceName: trimmedSource,
      reason: `LoRA not found on disk: ${trimmedSource}`,
    };
  }

  const oldFile = findFileByAbsolutePath(index, absolutePath);
  if (!oldFile) {
    return {
      ...empty,
      sourceName: trimmedSource,
      reason: `LoRA not found on disk: ${trimmedSource}`,
    };
  }

  const newBasename = stripLoraExtension(
    (rawNewBasename ?? '').trim().replace(/\\/g, '/'),
  );
  const base = {
    ...empty,
    sourceName: trimmedSource,
    oldFile,
    newBasename,
  };

  if (!newBasename) {
    return { ...base, reason: 'New name is empty.' };
  }
  if (newBasename.includes('/') || newBasename.includes('\\')) {
    return {
      ...base,
      reason: 'New name must be a file name only (no folders).',
    };
  }
  if (newBasename.includes(':') || newBasename.includes('<') || newBasename.includes('>')) {
    return {
      ...base,
      reason: 'New name cannot contain <, >, or :.',
    };
  }
  if (newBasename.includes('__')) {
    return {
      ...base,
      reason: 'New name must not contain __ (Dynamic Prompts wildcard markers).',
    };
  }
  if (!/^[A-Za-z0-9 _().+[\]-]{1,200}$/.test(newBasename)) {
    return {
      ...base,
      reason:
        'New name may only contain letters, numbers, spaces, and _ . - + ( ) [ ]',
    };
  }

  const oldBase = basename(oldFile.stem);
  if (normalizeLoraName(newBasename) === normalizeLoraName(oldBase)) {
    return {
      ...base,
      reason: 'New name matches the current file name.',
    };
  }

  const ext = extensionOf(oldFile.relativePath) || '.safetensors';
  const dir = dirname(oldFile.relativePath);
  const newRelativePath = joinRelative(dir, `${newBasename}${ext}`);
  const newStem = stripLoraExtension(newRelativePath);

  const collision = index.files.find((f) => {
    if (sameAbsPath(f.absolutePath, oldFile.absolutePath)) return false;
    return (
      normalizeLoraName(f.relativePath) === normalizeLoraName(newRelativePath) ||
      normalizeLoraName(basename(f.stem)) === normalizeLoraName(newBasename)
    );
  });
  if (collision) {
    return {
      ...base,
      newRelativePath,
      newStem,
      canRename: false,
      reason: `Another LoRA already uses the name "${newBasename}" (${collision.relativePath}).`,
    };
  }

  const edits: RenameLoraEdit[] = [];
  let totalOccurrences = 0;
  for (const f of libraryFiles) {
    const { text, count } = rewriteLoraReferences(
      f.text,
      oldFile.absolutePath,
      index,
      oldFile,
      newStem,
    );
    if (count > 0) {
      edits.push({
        key: f.key,
        relativePath: f.relativePath,
        newText: text,
        occurrences: count,
      });
      totalOccurrences += count;
    }
  }

  return {
    canRename: true,
    sourceName: trimmedSource,
    oldFile,
    newBasename,
    newRelativePath,
    newAbsolutePath: '', // service fills with path.join
    newStem,
    edits,
    totalOccurrences,
    warnings: [],
  };
}
