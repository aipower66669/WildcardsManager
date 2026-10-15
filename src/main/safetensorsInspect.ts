import fs from 'node:fs';
import path from 'node:path';
import {
  estimateParameterCount,
  extractPromptKeywords,
  extractTagFrequencies,
  extractTriggerWords,
  MAX_SAFETENSORS_HEADER_BYTES,
  parseSafetensorsHeaderJson,
  readSafetensorsHeaderLength,
  summarizeDtypes,
  summarizeLoraMetadata,
  type SafetensorsHeaderParse,
} from '../domain/safetensorsMetadata.js';
import type { LoraInspectDto } from '../shared/contracts.js';
import { requireConfiguredLoraIndex } from './loraService.js';

function isSafetensorsPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.safetensors' || ext === '.sft';
}

export function readSafetensorsHeaderFromFile(
  absolutePath: string,
): SafetensorsHeaderParse {
  const fd = fs.openSync(absolutePath, 'r');
  try {
    const lenBuf = Buffer.alloc(8);
    const n = fs.readSync(fd, lenBuf, 0, 8, 0);
    if (n < 8) throw new Error('File too short for a safetensors header');
    const headerLen = readSafetensorsHeaderLength(lenBuf);
    if (headerLen <= 0) throw new Error('Invalid safetensors header length');
    if (headerLen > MAX_SAFETENSORS_HEADER_BYTES) {
      throw new Error(
        `Safetensors header too large (${headerLen} bytes; max ${MAX_SAFETENSORS_HEADER_BYTES})`,
      );
    }
    const headerBuf = Buffer.alloc(headerLen);
    const read = fs.readSync(fd, headerBuf, 0, headerLen, 8);
    if (read < headerLen) {
      throw new Error('Truncated safetensors header');
    }
    return parseSafetensorsHeaderJson(headerBuf);
  } finally {
    fs.closeSync(fd);
  }
}

/** Prompt keywords from a `.safetensors` file (empty on failure / non-st). */
export function readPromptKeywordsFromSafetensors(
  absolutePath: string,
  preferName?: string,
): string[] {
  const ext = path.extname(absolutePath).toLowerCase();
  if (ext !== '.safetensors' && ext !== '.sft') return [];
  try {
    const { metadata } = readSafetensorsHeaderFromFile(absolutePath);
    return extractPromptKeywords(metadata, { preferName });
  } catch {
    return [];
  }
}

/**
 * Inspect a LoRA under the configured folder: read only the safetensors
 * JSON header (no tensor weights loaded into memory).
 */
export async function inspectLoraFile(
  relativePath: string,
): Promise<LoraInspectDto> {
  const rel = relativePath.trim().replaceAll('\\', '/');
  if (!rel) throw new Error('Invalid LoRA path');

  const index = await requireConfiguredLoraIndex();

  const file = index.files.find(
    (f) => f.relativePath.replaceAll('\\', '/').toLowerCase() === rel.toLowerCase(),
  );
  if (!file) throw new Error(`LoRA not found: ${rel}`);

  const base: LoraInspectDto = {
    relativePath: file.relativePath.replaceAll('\\', '/'),
    absolutePath: file.absolutePath,
    stem: file.stem,
    format: isSafetensorsPath(file.absolutePath) ? 'safetensors' : 'unsupported',
    keywords: [],
    triggerWords: [],
    promptKeywords: [],
    fields: [],
    otherFields: [],
    tensorCount: 0,
    dtypes: [],
  };

  if (base.format !== 'safetensors') {
    return {
      ...base,
      error:
        'Inspect reads embedded training metadata from `.safetensors` files. This file type is not supported.',
    };
  }

  try {
    const { metadata, tensors } = readSafetensorsHeaderFromFile(
      file.absolutePath,
    );
    const summary = summarizeLoraMetadata(metadata);
    const keywords = extractTagFrequencies(metadata);
    const triggerWords =
      keywords.length > 0
        ? keywords.map((k) => k.tag)
        : extractTriggerWords(metadata);
    const preferName =
      summary.outputName ||
      path.basename(file.stem).replace(/[_-]\d{3,}$/, '');
    const promptKeywords = extractPromptKeywords(metadata, {
      preferName,
    });
    const paramCount = estimateParameterCount(tensors);
    const dtypes = summarizeDtypes(tensors);

    const fields: LoraInspectDto['fields'] = [];
    const push = (label: string, value: string | undefined) => {
      if (value?.trim()) fields.push({ label, value: value.trim() });
    };
    push('Title', summary.title);
    push('Output name', summary.outputName);
    push('Base model', summary.baseModel);
    push('Network', summary.networkModule);
    push('Network dim', summary.networkDim);
    push('Network alpha', summary.networkAlpha);
    push('Resolution', summary.resolution);
    push('Epoch', summary.epoch);
    push('Steps', summary.steps);
    push('Learning rate', summary.learningRate);
    push('Optimizer', summary.optimizer);
    push('Base checkpoint', summary.sdModelName);
    push('Author', summary.author);
    push('Usage hint', summary.usageHint);
    push('Description', summary.description);

    return {
      ...base,
      keywords,
      triggerWords,
      promptKeywords,
      fields,
      otherFields: summary.otherFields,
      tensorCount: tensors.length,
      parameterCount: paramCount ?? undefined,
      dtypes: dtypes.map((d) => ({
        dtype: d.dtype,
        tensors: d.tensors,
        bytes: d.bytes,
      })),
    };
  } catch (e) {
    return {
      ...base,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
