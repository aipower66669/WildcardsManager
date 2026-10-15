import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { LmStudioAssistPresetId } from '../../shared/lmStudio.js';

const PRESETS: ReadonlySet<LmStudioAssistPresetId> = new Set([
  'review',
  'find_errors',
  'add_variations',
  'polish',
  'custom',
]);

export type LmStudioSavedPrompt = {
  id: string;
  name: string;
  preset: LmStudioAssistPresetId;
  instruction: string;
  updatedAt: string;
};

export type LmStudioPromptSession = {
  preset: LmStudioAssistPresetId;
  instruction: string;
  /** Saved library entry last loaded/used, if any. */
  selectedPromptId: string | null;
};

export type LmStudioPromptLibraryState = {
  prompts: LmStudioSavedPrompt[];
  lastSession: LmStudioPromptSession;
};

const DEFAULT_SESSION: LmStudioPromptSession = {
  preset: 'add_variations',
  instruction: '',
  selectedPromptId: null,
};

function libraryPath(): string {
  return path.join(app.getPath('userData'), 'lm-studio-prompt-library.json');
}

function isPreset(value: unknown): value is LmStudioAssistPresetId {
  return typeof value === 'string' && PRESETS.has(value as LmStudioAssistPresetId);
}

function normalizePrompt(raw: unknown): LmStudioSavedPrompt | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  if (!id || !name || !isPreset(row.preset)) return null;
  return {
    id,
    name,
    preset: row.preset,
    instruction: typeof row.instruction === 'string' ? row.instruction : '',
    updatedAt:
      typeof row.updatedAt === 'string' && row.updatedAt
        ? row.updatedAt
        : new Date().toISOString(),
  };
}

function normalizeSession(raw: unknown): LmStudioPromptSession {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SESSION };
  const row = raw as Record<string, unknown>;
  return {
    preset: isPreset(row.preset) ? row.preset : DEFAULT_SESSION.preset,
    instruction:
      typeof row.instruction === 'string' ? row.instruction : '',
    selectedPromptId:
      typeof row.selectedPromptId === 'string' && row.selectedPromptId.trim()
        ? row.selectedPromptId.trim()
        : null,
  };
}

function readStored(): LmStudioPromptLibraryState {
  try {
    const raw = JSON.parse(fs.readFileSync(libraryPath(), 'utf8')) as Record<
      string,
      unknown
    >;
    const prompts = Array.isArray(raw.prompts)
      ? raw.prompts
          .map(normalizePrompt)
          .filter((p): p is LmStudioSavedPrompt => p != null)
      : [];
    const lastSession = normalizeSession(raw.lastSession);
    if (
      lastSession.selectedPromptId &&
      !prompts.some((p) => p.id === lastSession.selectedPromptId)
    ) {
      lastSession.selectedPromptId = null;
    }
    prompts.sort((a, b) => a.name.localeCompare(b.name));
    return { prompts, lastSession };
  } catch {
    return { prompts: [], lastSession: { ...DEFAULT_SESSION } };
  }
}

function writeStored(state: LmStudioPromptLibraryState): void {
  fs.mkdirSync(path.dirname(libraryPath()), { recursive: true });
  fs.writeFileSync(
    libraryPath(),
    `${JSON.stringify(
      {
        prompts: state.prompts,
        lastSession: state.lastSession,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

export function getLmStudioPromptLibrary(): LmStudioPromptLibraryState {
  return readStored();
}

export function setLmStudioPromptSession(
  session: Partial<LmStudioPromptSession>,
): LmStudioPromptLibraryState {
  const state = readStored();
  const next: LmStudioPromptSession = {
    preset: isPreset(session.preset) ? session.preset : state.lastSession.preset,
    instruction:
      typeof session.instruction === 'string'
        ? session.instruction
        : state.lastSession.instruction,
    selectedPromptId:
      session.selectedPromptId === null
        ? null
        : typeof session.selectedPromptId === 'string'
          ? session.selectedPromptId.trim() || null
          : state.lastSession.selectedPromptId,
  };
  if (
    next.selectedPromptId &&
    !state.prompts.some((p) => p.id === next.selectedPromptId)
  ) {
    next.selectedPromptId = null;
  }
  state.lastSession = next;
  writeStored(state);
  return state;
}

export function upsertLmStudioSavedPrompt(input: {
  id?: string;
  name: string;
  preset: LmStudioAssistPresetId;
  instruction: string;
}): LmStudioPromptLibraryState {
  const name = input.name.trim();
  if (!name) throw new Error('Prompt name is required');
  if (!isPreset(input.preset)) throw new Error('Invalid assist preset');

  const state = readStored();
  const now = new Date().toISOString();
  const existingId = input.id?.trim();
  if (existingId) {
    const idx = state.prompts.findIndex((p) => p.id === existingId);
    if (idx < 0) throw new Error('Saved prompt not found');
    state.prompts[idx] = {
      id: existingId,
      name,
      preset: input.preset,
      instruction: input.instruction,
      updatedAt: now,
    };
    state.lastSession = {
      preset: input.preset,
      instruction: input.instruction,
      selectedPromptId: existingId,
    };
  } else {
    const created: LmStudioSavedPrompt = {
      id: randomUUID(),
      name,
      preset: input.preset,
      instruction: input.instruction,
      updatedAt: now,
    };
    state.prompts.push(created);
    state.lastSession = {
      preset: created.preset,
      instruction: created.instruction,
      selectedPromptId: created.id,
    };
  }
  state.prompts.sort((a, b) => a.name.localeCompare(b.name));
  writeStored(state);
  return state;
}

export function renameLmStudioSavedPrompt(
  id: string,
  name: string,
): LmStudioPromptLibraryState {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Prompt name is required');
  const state = readStored();
  const idx = state.prompts.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error('Saved prompt not found');
  state.prompts[idx] = {
    ...state.prompts[idx],
    name: trimmed,
    updatedAt: new Date().toISOString(),
  };
  state.prompts.sort((a, b) => a.name.localeCompare(b.name));
  writeStored(state);
  return state;
}

export function deleteLmStudioSavedPrompt(
  id: string,
): LmStudioPromptLibraryState {
  const state = readStored();
  const next = state.prompts.filter((p) => p.id !== id);
  if (next.length === state.prompts.length) {
    throw new Error('Saved prompt not found');
  }
  state.prompts = next;
  if (state.lastSession.selectedPromptId === id) {
    state.lastSession.selectedPromptId = null;
  }
  writeStored(state);
  return state;
}
