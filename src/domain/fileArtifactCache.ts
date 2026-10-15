import { extractLoraRefs, type LoraRef } from './lora.js';
import { parseFileContent } from './parseRefs.js';
import {
  isStructuredFile,
  parseStructuredFile,
  type StructuredDocument,
} from './structured.js';
import type { FileParseResult, LibraryFile } from './types.js';

type ArtifactEntry = {
  identity: string;
  parse: FileParseResult | null;
  structured: StructuredDocument | null;
  loraRefs: LoraRef[];
};

const byPath = new Map<string, ArtifactEntry>();

function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/** Stable identity for a file version — size+mtime when known, else text hash. */
export function fileContentIdentity(file: LibraryFile): string {
  if (file.size != null && file.mtimeMs != null) {
    return `${file.size}:${file.mtimeMs}:${file.text.length}`;
  }
  return `text:${file.text.length}:${hashText(file.text)}`;
}

export function libraryFilesFingerprint(files: LibraryFile[]): string {
  return files
    .map((file) => `${file.relativePath}\0${fileContentIdentity(file)}`)
    .sort((a, b) => a.localeCompare(b))
    .join('\n');
}

function getEntry(file: LibraryFile): ArtifactEntry {
  const identity = fileContentIdentity(file);
  const prev = byPath.get(file.relativePath);
  if (prev && prev.identity === identity) return prev;
  const structured = isStructuredFile(file) ? parseStructuredFile(file) : null;
  const entry: ArtifactEntry = {
    identity,
    parse: structured
      ? null
      : parseFileContent(file.text, file.key, file.absolutePath),
    structured,
    loraRefs: extractLoraRefs(file.text),
  };
  byPath.set(file.relativePath, entry);
  return entry;
}

export function cachedParseFile(file: LibraryFile): FileParseResult {
  const entry = getEntry(file);
  if (entry.parse) return entry.parse;
  return parseFileContent(file.text, file.key, file.absolutePath);
}

export function cachedStructuredDocument(
  file: LibraryFile,
): StructuredDocument | null {
  return getEntry(file).structured;
}

export function cachedLoraRefs(file: LibraryFile): LoraRef[] {
  return getEntry(file).loraRefs;
}

export function forgetFileArtifacts(relativePath?: string): void {
  if (!relativePath) {
    byPath.clear();
    return;
  }
  byPath.delete(relativePath.replace(/\\/g, '/'));
}

export function retainFileArtifacts(keepRelativePaths: Iterable<string>): void {
  const keep = new Set(
    [...keepRelativePaths].map((p) => p.replace(/\\/g, '/')),
  );
  for (const key of [...byPath.keys()]) {
    if (!keep.has(key)) byPath.delete(key);
  }
}
