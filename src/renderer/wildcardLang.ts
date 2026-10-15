import { StreamLanguage } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * Lightweight tokenizer for Dynamic Prompts / ComfyUI wildcard text files.
 * Highlights comments, `__wildcard__` refs, LoRA tags, brace variants,
 * weights, and multi-select markers without requiring a full grammar.
 */
type WildcardState = {
  loraPart: 'none' | 'name' | 'weight';
};

export const wildcardLanguage = StreamLanguage.define<WildcardState>({
  name: 'wildcard',
  startState: () => ({ loraPart: 'none' }),
  token(stream, state) {
    if (stream.sol() && stream.match(/^#.*/, false)) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/<lora:/i)) {
      state.loraPart = 'name';
      return 'loraTag';
    }
    if (state.loraPart !== 'none') {
      if (stream.match(/>/)) {
        state.loraPart = 'none';
        return 'loraTag';
      }
      if (stream.match(/:/)) {
        state.loraPart = 'weight';
        return 'loraTag';
      }
      if (state.loraPart === 'name' && stream.match(/[^:>\n]+/)) {
        if (stream.eol()) state.loraPart = 'none';
        return 'loraName';
      }
      // Weight section: highlight numbers and `{ | }` variants distinctly.
      if (state.loraPart === 'weight') {
        let token: string | null = null;
        if (stream.match(/-?\d+(?:\.\d+)?/)) token = 'number';
        else if (stream.match(/[{}|]/)) token = 'bracket';
        else if (stream.match(/[^:>{}|\d\n-]+|-/)) token = null;
        else stream.next();
        if (stream.eol()) state.loraPart = 'none';
        return token;
      }
    }
    if (stream.match(/__[^_\n](?:[^_\n]|_(?!_))*__/)) {
      return 'keyword';
    }
    if (stream.match(/\d+(?:\.\d+)?::/)) {
      return 'number';
    }
    if (stream.match(/\d+(?:\s*-\s*\d+)?\$\$/)) {
      return 'meta';
    }
    if (stream.match(/\$\$/)) {
      return 'meta';
    }
    if (stream.match(/[{}|]/)) {
      return 'bracket';
    }
    if (stream.match(/"[^"\n]*"?/)) {
      return 'string';
    }
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: '#' },
  },
  tokenTable: {
    comment: t.comment,
    keyword: t.keyword,
    number: t.number,
    meta: t.meta,
    bracket: t.bracket,
    string: t.string,
    loraTag: t.tagName,
    loraName: t.special(t.variableName),
  },
});
