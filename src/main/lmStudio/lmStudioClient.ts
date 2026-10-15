/**
 * LM Studio OpenAI-compatible client (main process only).
 * Assist never writes library files — it only returns a proposal for the UI.
 */

import {
  lmStudioHttpBase,
  lmStudioIsLocalHost,
  type LmStudioAssistPresetId,
  type LmStudioConnectionSettings,
  type LmStudioConnectionTestResult,
} from '../../shared/lmStudio.js';
import { parseLmStudioAssistResponse } from '../../domain/lmStudioAssistParse.js';
import {
  getLmStudioConnection,
  readLmStudioApiKey,
} from './lmStudioSettings.js';

export type LmStudioAssistRequest = {
  relativePath: string;
  currentText: string;
  preset: LmStudioAssistPresetId;
  /** Extra user instruction (required for custom; optional notes for others). */
  instruction?: string;
  /** Override connection.model for this request. */
  model?: string;
};

export type LmStudioAssistResult = {
  relativePath: string;
  model: string;
  /** Short human summary of what the model did / found. */
  summary: string;
  /** Optional longer notes (review findings, etc.). */
  notes: string;
  /**
   * Full proposed file text when the model wants an edit.
   * Null when review-only (no file change proposed).
   */
  proposedText: string | null;
  /** True when proposedText differs from currentText. */
  hasEdits: boolean;
};

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function authHeaders(apiKey: string | null): Record<string, string> {
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

async function lmFetch(
  conn: LmStudioConnectionSettings,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, ...rest } = init;
  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    return await fetch(`${lmStudioHttpBase(conn)}${path}`, {
      ...rest,
      signal,
      headers: {
        Accept: 'application/json',
        ...authHeaders(readLmStudioApiKey()),
        ...(rest.headers as Record<string, string> | undefined),
      },
    });
  } finally {
    cancel();
  }
}

export async function listLmStudioModels(
  conn: LmStudioConnectionSettings = getLmStudioConnection(),
): Promise<string[]> {
  const res = await lmFetch(conn, '/v1/models', { timeoutMs: 15_000 });
  if (!res.ok) {
    throw new Error(`LM Studio /v1/models failed (${res.status})`);
  }
  const body = (await res.json()) as {
    data?: Array<{ id?: string }>;
  };
  const ids = (body.data ?? [])
    .map((row) => (typeof row.id === 'string' ? row.id.trim() : ''))
    .filter(Boolean);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export async function testLmStudioConnection(): Promise<LmStudioConnectionTestResult> {
  const conn = getLmStudioConnection();
  const result: LmStudioConnectionTestResult = {
    ok: false,
    models: [],
    errors: [],
    warnings: [],
  };
  if (!lmStudioIsLocalHost(conn.host)) {
    result.warnings.push(
      'Host is not localhost — traffic still goes through the app main process, but confirm you trust this server.',
    );
  }
  const started = Date.now();
  try {
    const models = await listLmStudioModels(conn);
    result.latencyMs = Date.now() - started;
    result.models = models;
    result.ok = true;
    if (models.length === 0) {
      result.warnings.push(
        'Server reachable, but no models listed. Load a model in LM Studio.',
      );
    } else if (conn.model && !models.includes(conn.model)) {
      result.warnings.push(
        `Saved model “${conn.model}” is not in the server list. Pick one from the dropdown or clear the field.`,
      );
    }
  } catch (err) {
    result.errors.push(
      err instanceof Error
        ? err.message
        : 'Could not reach LM Studio. Is the local server running?',
    );
  }
  return result;
}

function presetSystemBlurb(preset: LmStudioAssistPresetId): string {
  switch (preset) {
    case 'review':
      return 'Task: REVIEW this wildcard file. Comment on quality, consistency, Dynamic Prompts / brace syntax, and usefulness. Prefer mode "review" unless a small concrete fix is clearly warranted.';
    case 'find_errors':
      return 'Task: FIND ERRORS — broken __wildcard__ refs, typos, duplicate lines, invalid {a|b} / weight syntax, empty lines that look accidental. Propose a full corrected file only when you can fix concrete issues.';
    case 'add_variations':
      return 'Task: ADD VARIATIONS. Keep every existing non-comment line unchanged. Append new lines that match the theme, tone, and style of the file. Do not delete or reorder existing content.';
    case 'polish':
      return 'Task: POLISH lightly — remove exact/near-duplicate lines, tidy spacing, keep meaning. Do not invent a new theme.';
    case 'custom':
      return 'Task: Follow the user instruction for this wildcard file.';
  }
}

function buildMessages(req: LmStudioAssistRequest): Array<{
  role: 'system' | 'user';
  content: string;
}> {
  const instruction = req.instruction?.trim() ?? '';
  const system = [
    'You assist with Dynamic Prompts wildcard library files (.txt lines of prompt fragments).',
    'Lines may include __nested_wildcards__, {a|b|c} alternation, and weighting.',
    'Comments start with #.',
    'You MUST respond with a single JSON object only (no markdown fences), shape:',
    '{"mode":"review"|"edit","summary":"short","notes":"optional longer notes","proposedText":"full file when mode is edit"}',
    'Rules:',
    '- Keys and string values MUST use double quotes (valid JSON). Never use bare keys like {mode: ...}.',
    '- When mode is "edit", proposedText MUST be the COMPLETE file contents to write (not a patch/diff).',
    '- Escape newlines inside proposedText as \\n (do not put raw line breaks inside the JSON string).',
    '- When mode is "review", omit proposedText or set it null — do not invent edits.',
    '- Never invent paths outside this file. Never claim you wrote to disk.',
    '- Preserve intentional structure unless the task requires otherwise.',
    '- Put the final JSON in your answer content (not only inside thinking/reasoning).',
    presetSystemBlurb(req.preset),
  ].join('\n');

  const user = [
    `File: ${req.relativePath}`,
    instruction ? `User instruction:\n${instruction}` : null,
    'Current file contents:',
    '-----BEGIN FILE-----',
    req.currentText,
    '-----END FILE-----',
  ]
    .filter(Boolean)
    .join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function temperatureForPreset(preset: LmStudioAssistPresetId): number {
  if (preset === 'add_variations') return 0.75;
  if (preset === 'custom') return 0.5;
  if (preset === 'polish') return 0.3;
  return 0.2;
}

/** Reasoning models often burn tokens before the final answer. */
function maxTokensForRequest(
  currentText: string,
  preset: LmStudioAssistPresetId,
): number {
  const needsFullEcho = preset !== 'review';
  const echoBudget = needsFullEcho
    ? Math.ceil(currentText.length / 2.5) + 4096
    : 4096;
  return Math.min(65_536, Math.max(8_192, echoBudget));
}

function coerceTextPart(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const row = part as Record<string, unknown>;
        if (typeof row.text === 'string') return row.text;
        if (typeof row.content === 'string') return row.content;
        return '';
      })
      .join('');
  }
  return '';
}

type ChatChoiceMessage = {
  content?: unknown;
  reasoning_content?: unknown;
  reasoning?: unknown;
};

/**
 * Collect possible answer texts. Prefer `content`, but also try reasoning
 * fields — some LM Studio builds put the JSON only there, or put a broken
 * stub in content while reasoning has the real payload.
 */
function collectAssistantTexts(
  message: ChatChoiceMessage | undefined,
): string[] {
  if (!message) return [];
  const out: string[] = [];
  const push = (value: unknown) => {
    const text = coerceTextPart(value).trim();
    if (text && !out.includes(text)) out.push(text);
  };
  push(message.content);
  push(message.reasoning_content);
  push(message.reasoning);
  return out;
}

/**
 * Ask LM Studio for a review and/or proposed replacement text.
 * Does not read or write the library — caller supplies currentText.
 */
export async function assistWildcardWithLmStudio(
  req: LmStudioAssistRequest,
): Promise<LmStudioAssistResult> {
  const conn = getLmStudioConnection();
  if (req.preset === 'custom' && !req.instruction?.trim()) {
    throw new Error('Custom preset needs an instruction.');
  }

  const model = (req.model?.trim() || conn.model || '').trim();
  const body: Record<string, unknown> = {
    messages: buildMessages(req),
    temperature: temperatureForPreset(req.preset),
    max_tokens: maxTokensForRequest(req.currentText, req.preset),
    stream: false,
  };
  if (model) body.model = model;

  const res = await lmFetch(conn, '/v1/chat/completions', {
    method: 'POST',
    timeoutMs: 180_000,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `LM Studio chat failed (${res.status})${
        errText ? `: ${errText.slice(0, 240)}` : ''
      }`,
    );
  }

  const payload = (await res.json()) as {
    model?: string;
    choices?: Array<{
      finish_reason?: string;
      message?: ChatChoiceMessage;
    }>;
  };
  const choice = payload.choices?.[0];
  const candidates = collectAssistantTexts(choice?.message);
  if (candidates.length === 0) {
    const finish = choice?.finish_reason
      ? ` (finish_reason: ${choice.finish_reason})`
      : '';
    throw new Error(
      `LM Studio returned an empty response${finish}. ` +
        'If you use a reasoning model, raise max tokens in LM Studio / disable ' +
        '“separate reasoning_content and content”, or try again — thinking often ' +
        'consumes the whole token budget before any answer.',
    );
  }

  let parsed = null as ReturnType<typeof parseLmStudioAssistResponse> | null;
  let lastParseError: unknown = null;
  for (const text of candidates) {
    try {
      parsed = parseLmStudioAssistResponse(text);
      break;
    } catch (err) {
      lastParseError = err;
    }
  }
  if (!parsed) {
    throw lastParseError instanceof Error
      ? lastParseError
      : new Error('Model response was not valid JSON');
  }

  const summary = parsed.summary;
  const notes = parsed.notes;
  const proposedText = parsed.proposedText;

  const currentNorm = normalizeNewlines(req.currentText);
  const hasEdits =
    proposedText != null && proposedText !== currentNorm;

  return {
    relativePath: req.relativePath,
    model: typeof payload.model === 'string' ? payload.model : model || 'default',
    summary,
    notes,
    proposedText: hasEdits ? proposedText : null,
    hasEdits,
  };
}
