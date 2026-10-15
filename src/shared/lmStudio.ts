/**
 * Local LM Studio (OpenAI-compatible) connection settings.
 * Defaults match LM Studio’s usual local server: http://localhost:1234/v1
 */

export type LmStudioConnectionSettings = {
  host: string;
  port: number;
  secure: boolean;
  /** Selected model id (empty = let the server pick / use loaded model). */
  model: string;
  /** Whether an API key is stored (value lives in safeStorage). */
  hasApiKey: boolean;
};

export const DEFAULT_LM_STUDIO_CONNECTION: LmStudioConnectionSettings = {
  host: '127.0.0.1',
  port: 1234,
  secure: false,
  model: '',
  hasApiKey: false,
};

export type LmStudioConnectionTestResult = {
  ok: boolean;
  latencyMs?: number;
  models: string[];
  errors: string[];
  warnings: string[];
};

export type LmStudioAssistPresetId =
  | 'review'
  | 'find_errors'
  | 'add_variations'
  | 'polish'
  | 'custom';

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
  selectedPromptId: string | null;
};

export const LM_STUDIO_ASSIST_PRESETS: Array<{
  id: LmStudioAssistPresetId;
  label: string;
  description: string;
}> = [
  {
    id: 'review',
    label: 'Review',
    description:
      'Critique quality, consistency, and Dynamic Prompts style. Suggest edits only when clearly helpful.',
  },
  {
    id: 'find_errors',
    label: 'Find errors',
    description:
      'Hunt broken __refs__, typos, duplicates, and invalid brace/weight syntax.',
  },
  {
    id: 'add_variations',
    label: 'Add variations',
    description:
      'Keep every existing line and append more lines in the same style/theme.',
  },
  {
    id: 'polish',
    label: 'Polish',
    description:
      'Light cleanup: dedupe near-identical lines, tidy spacing — preserve meaning.',
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Free-form instruction about this wildcard file.',
  },
];

export function lmStudioHttpBase(conn: LmStudioConnectionSettings): string {
  const scheme = conn.secure ? 'https' : 'http';
  return `${scheme}://${conn.host}:${conn.port}`;
}

export function lmStudioIsLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '[::1]' ||
    h.endsWith('.local')
  );
}
