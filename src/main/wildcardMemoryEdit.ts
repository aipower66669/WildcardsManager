import {
  applyLoraWildcardBufferOp,
  upsertLoraSnippetIntoWildcardText,
  type LoraWildcardBufferOp,
} from '../domain/loraDownloadCategory.js';
import { libraryService } from './libraryService.js';
import { applyMutation } from './mutationService.js';
import {
  requestOpenFileApplyOp,
  requestOpenFileLiveText,
} from './openFileLiveText.js';

export type WildcardMemoryEditResult = {
  changed: boolean;
  error?: string;
  upsertMode?: 'extended' | 'appended' | 'unchanged';
  upsertSummary?: string;
};

function upsertMeta(
  existing: string,
  op: LoraWildcardBufferOp,
): Pick<WildcardMemoryEditResult, 'upsertMode' | 'upsertSummary'> {
  if (op.type !== 'upsert') return {};
  const detail = upsertLoraSnippetIntoWildcardText({
    existing,
    snippet: op.snippet,
    fileStem: op.fileStem,
    series: op.series,
  });
  return { upsertMode: detail.mode, upsertSummary: detail.summary };
}

/**
 * Apply a LoRA category snippet to a wildcard file in memory.
 *
 * - File open and being edited: mutate the live buffer + RAM. Disk waits for save.
 * - File not open (or open but matching last save): mutate RAM and persist (this is the save).
 * Never reads the category file from disk when memory already has it.
 */
export async function applyLoraWildcardOpInMemory(
  relativePath: string,
  op: LoraWildcardBufferOp,
  label: string,
): Promise<WildcardMemoryEditResult> {
  try {
    const applied = await requestOpenFileApplyOp(relativePath, op);
    if (applied) {
      const meta = upsertMeta(applied.before, op);
      if (!applied.changed) return { changed: false, ...meta };
      const memory = libraryService.readFile(relativePath).text;
      if (applied.before !== memory) {
        libraryService.replaceMemoryText(relativePath, applied.before);
      }
      applyMutation(label, [{ relativePath, text: applied.text }], {
        persist: false,
      });
      return { changed: true, ...meta };
    }

    const live = await requestOpenFileLiveText(relativePath);
    const memory = libraryService.readFile(relativePath).text;
    const base = live ?? memory;
    const result = applyLoraWildcardBufferOp(base, op);
    const meta = upsertMeta(base, op);
    if (!result.changed) return { changed: false, ...meta };

    const beingEdited = live !== null && live !== memory;
    if (beingEdited) {
      libraryService.replaceMemoryText(relativePath, live);
    }
    applyMutation(label, [{ relativePath, text: result.text }], {
      persist: !beingEdited,
    });
    return { changed: true, ...meta };
  } catch (e) {
    return {
      changed: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function appendLoraSnippetInMemory(
  relativePath: string,
  snippet: string,
  fileStem: string,
  label: string,
): Promise<WildcardMemoryEditResult> {
  return applyLoraWildcardOpInMemory(
    relativePath,
    { type: 'append', snippet, fileStem },
    label,
  );
}
