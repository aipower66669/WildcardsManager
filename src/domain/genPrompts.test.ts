import { describe, expect, it } from 'vitest';
import {
  appendGenPromptIfMissing,
  chooseGenPrompt,
  decodeGenPrompts,
  expandWeightedGenPrompt,
  findTestingGenPrompt,
  parseGenPromptLeadTags,
  pickGenPrompt,
  stripTestingGenTag,
} from './genPrompts.js';

describe('decodeGenPrompts', () => {
  it('merges comma-continuation lines into one prompt', () => {
    const prompts = decodeGenPrompts(`
a beautiful woman
, wearing a red dress
, standing outside

another prompt
, with more details
`);
    expect(prompts).toEqual([
      'a beautiful woman, wearing a red dress, standing outside',
      'another prompt, with more details',
    ]);
  });

  it('skips blank lines and # comments', () => {
    const prompts = decodeGenPrompts(`
# header
first

# note
, continued

second
`);
    expect(prompts).toEqual(['first, continued', 'second']);
  });

  it('treats a leading-comma first line as its own prompt', () => {
    expect(decodeGenPrompts(', orphan\nnext')).toEqual([', orphan', 'next']);
  });

  it('expands [xN] / [W=N] / [WEIGHT=N] into N copies and strips the tag', () => {
    expect(decodeGenPrompts('[x3] rare\ncommon\n')).toEqual([
      'rare',
      'rare',
      'rare',
      'common',
    ]);
    expect(decodeGenPrompts('[W=2] a\n[WEIGHT=1] b\n')).toEqual(['a', 'a', 'b']);
    expect(decodeGenPrompts('[x0] gone\nkeep\n')).toEqual(['keep']);
  });

  it('applies weight after comma continuations', () => {
    expect(
      decodeGenPrompts('[x2] one\n, two\nother\n'),
    ).toEqual(['one, two', 'one, two', 'other']);
  });

  it('keeps [TESTING] when expanding weight', () => {
    expect(decodeGenPrompts('[x2][TESTING] debug me\n')).toEqual([
      '[TESTING] debug me',
      '[TESTING] debug me',
    ]);
    expect(decodeGenPrompts('[TESTING][x2] debug me\n')).toEqual([
      '[TESTING] debug me',
      '[TESTING] debug me',
    ]);
  });

  it('does not continue a comma line across a blank line', () => {
    expect(decodeGenPrompts('first\n\n, after blank\n')).toEqual([
      'first',
      ', after blank',
    ]);
  });

  it('joins a comma line that only has leading spaces', () => {
    expect(decodeGenPrompts('first\n   , continued\n')).toEqual([
      'first, continued',
    ]);
  });
});

describe('appendGenPromptIfMissing', () => {
  it('creates content when the file is empty', () => {
    expect(appendGenPromptIfMissing('', 'hello world')).toEqual({
      content: 'hello world\n',
      added: true,
      alreadyExists: false,
    });
  });

  it('appends with a blank-line separator', () => {
    expect(appendGenPromptIfMissing('first\n', 'second')).toEqual({
      content: 'first\n\nsecond\n',
      added: true,
      alreadyExists: false,
    });
  });

  it('skips when the exact decoded prompt already exists', () => {
    const body = 'hello world\n\nother\n';
    expect(appendGenPromptIfMissing(body, '  hello world  ')).toEqual({
      content: body,
      added: false,
      alreadyExists: true,
    });
  });

  it('keeps comma continuation lines when appending a multi-line prompt', () => {
    const block = 'a beautiful woman\n, wearing a red dress\n';
    const added = appendGenPromptIfMissing('existing\n', block);
    expect(added.added).toBe(true);
    expect(added.content).toBe(
      'existing\n\na beautiful woman\n, wearing a red dress\n',
    );
    expect(decodeGenPrompts(added.content)).toEqual([
      'existing',
      'a beautiful woman, wearing a red dress',
    ]);
    expect(
      appendGenPromptIfMissing(added.content, block).alreadyExists,
    ).toBe(true);
  });

  it('no-ops on blank prompt', () => {
    expect(appendGenPromptIfMissing('keep\n', '   ')).toEqual({
      content: 'keep\n',
      added: false,
      alreadyExists: false,
    });
  });
});

describe('chooseGenPrompt', () => {
  const body = `
# header
prompt one
, extra detail

# skipped
prompt two

prompt three
`;

  it('sends one decoded prompt, never a comment or a raw continuation line', () => {
    const decoded = decodeGenPrompts(body);
    expect(decoded).toEqual([
      'prompt one, extra detail',
      'prompt two',
      'prompt three',
    ]);
    for (let seed = 1; seed <= 40; seed += 1) {
      expect(decoded).toContain(chooseGenPrompt(body, seed));
    }
  });

  it('matches picking from the same decoded list a !gen.txt file would use', () => {
    const decoded = decodeGenPrompts(body);
    expect(chooseGenPrompt(body, 7)).toBe(pickGenPrompt(decoded, 7));
  });
});

describe('pickGenPrompt', () => {
  it('is deterministic for a fixed seed', () => {
    const prompts = ['a', 'b', 'c', 'd', 'e'];
    expect(pickGenPrompt(prompts, 42)).toBe(pickGenPrompt(prompts, 42));
  });

  it('can pick different entries for different seeds', () => {
    const prompts = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const a = pickGenPrompt(prompts, 1);
    const b = pickGenPrompt(prompts, 2);
    expect(prompts).toContain(a);
    expect(prompts).toContain(b);
  });

  it('prefers a [TESTING] line over a seeded random pick', () => {
    const prompts = [
      'normal a',
      '[TESTING] forced debug line',
      'normal b',
    ];
    for (let seed = 1; seed <= 20; seed += 1) {
      expect(pickGenPrompt(prompts, seed)).toBe('forced debug line');
    }
  });

  it('strips [TESTING] case-insensitively and keeps the rest of the prompt', () => {
    expect(
      pickGenPrompt(['[testing]  portrait, detailed', 'other'], 1),
    ).toBe('portrait, detailed');
    expect(stripTestingGenTag('[TESTING]\tfoo')).toBe('foo');
    expect(findTestingGenPrompt(['a', '[TESTING] b'])).toBe('[TESTING] b');
    expect(findTestingGenPrompt(['a', 'b'])).toBeNull();
  });
});

describe('parseGenPromptLeadTags / expandWeightedGenPrompt', () => {
  it('parses weight forms case-insensitively', () => {
    expect(parseGenPromptLeadTags('[x5] hello')).toEqual({
      body: 'hello',
      weight: 5,
      testing: false,
    });
    expect(parseGenPromptLeadTags('[w=4] hello')).toEqual({
      body: 'hello',
      weight: 4,
      testing: false,
    });
    expect(parseGenPromptLeadTags('[Weight=2] hello')).toEqual({
      body: 'hello',
      weight: 2,
      testing: false,
    });
  });

  it('defaults weight to 1 when no tag', () => {
    expect(expandWeightedGenPrompt('plain')).toEqual(['plain']);
  });
});
