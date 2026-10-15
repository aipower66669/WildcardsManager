import {
  hasNoValidationMarker,
  HONOR_NO_VALIDATION_MARKER,
} from './parseRefs.js';
import { hasDynamicWildcardLogic } from './dynamicWildcardName.js';
import type { Issue } from './types.js';

export type ValidationPlatform = 'comfyui' | 'stable-diffusion';

const WILDCARD_RE = /__([^_\n](?:[^_\n]|_(?!_))*)__/g;

/**
 * ComfyUI wildcard nodes treat everything between `__` as a literal key.
 * Stable Diffusion Dynamic Prompts additionally allows variant expressions
 * inside the reference, such as `__where{|-indoor}__` or `__color(|-basic)__`.
 */
export function validatePlatformWildcardSyntax(
  text: string,
  platform: ValidationPlatform,
  nodeId?: string,
): Issue[] {
  if (
    platform !== 'comfyui' ||
    (HONOR_NO_VALIDATION_MARKER && hasNoValidationMarker(text))
  ) {
    return [];
  }

  const issues: Issue[] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    WILDCARD_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WILDCARD_RE.exec(line)) !== null) {
      const name = match[1] ?? '';
      if (!hasDynamicWildcardLogic(name)) continue;
      issues.push({
        severity: 'error',
        code: 'unsupported_wildcard_logic',
        message:
          'Dynamic Prompt logic inside `__wildcard__` references is supported by Stable Diffusion, but not by ComfyUI',
        nodeId,
        line: lineIndex + 1,
        column: match.index + 1,
        snippet: match[0],
      });
    }
  }
  return issues;
}
