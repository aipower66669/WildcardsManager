import { describe, expect, it } from 'vitest';
import {
  extractAssistFieldsLoose,
  parseLmStudioAssistResponse,
  repairLooseJson,
} from './lmStudioAssistParse.js';

describe('repairLooseJson', () => {
  it('quotes bare keys', () => {
    expect(repairLooseJson('{mode: "review", summary: "ok"}')).toBe(
      '{"mode": "review", "summary": "ok"}',
    );
  });

  it('removes trailing commas', () => {
    expect(repairLooseJson('{"mode":"review",}')).toBe('{"mode":"review"}');
  });
});

describe('parseLmStudioAssistResponse', () => {
  it('parses strict JSON', () => {
    const parsed = parseLmStudioAssistResponse(
      '{"mode":"review","summary":"Looks fine","notes":"n"}',
    );
    expect(parsed).toEqual({
      mode: 'review',
      summary: 'Looks fine',
      notes: 'n',
      proposedText: null,
    });
  });

  it('parses unquoted keys (position-1 SyntaxError case)', () => {
    const parsed = parseLmStudioAssistResponse(
      '{mode: "edit", summary: "Added lines", notes: "", proposedText: "a\\nb\\n"}',
    );
    expect(parsed.mode).toBe('edit');
    expect(parsed.summary).toBe('Added lines');
    expect(parsed.proposedText).toBe('a\nb\n');
  });

  it('parses fenced JSON', () => {
    const parsed = parseLmStudioAssistResponse(
      'Sure.\n```json\n{"mode":"review","summary":"ok","notes":""}\n```\n',
    );
    expect(parsed.mode).toBe('review');
    expect(parsed.summary).toBe('ok');
  });

  it('extracts when proposedText has raw newlines', () => {
    const raw = `{
  "mode": "edit",
  "summary": "More socks",
  "notes": "appended",
  "proposedText": "red socks
blue socks
"
}`;
    const loose = extractAssistFieldsLoose(raw);
    expect(loose?.mode).toBe('edit');
    expect(String(loose?.proposedText)).toContain('red socks');
    const parsed = parseLmStudioAssistResponse(raw);
    expect(parsed.mode).toBe('edit');
    expect(parsed.proposedText).toContain('red socks');
  });

  it('throws a helpful error instead of SyntaxError', () => {
    expect(() => parseLmStudioAssistResponse('not json at all')).toThrow(
      /not valid JSON/,
    );
  });
});
