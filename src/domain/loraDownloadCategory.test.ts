import { describe, expect, it } from 'vitest';
import {
  appendLoraSnippetToWildcardText,
  applyLoraWildcardBufferOp,
  normalizeLoraWeights,
  parseLoraDownloadCategory,
  uniqueExtraLoraCategoryIds,
  upsertLoraSnippetIntoWildcardText,
} from './loraDownloadCategory.js';

describe('loraDownloadCategory', () => {
  it('normalizes weight patterns', () => {
    expect(normalizeLoraWeights('{0.8|0.9|1}')).toBe('{0.8|0.9|1}');
    expect(normalizeLoraWeights('0.8 | 0.9')).toBe('{0.8|0.9}');
    expect(normalizeLoraWeights('0.75')).toBe('0.75');
    expect(normalizeLoraWeights('-0.5')).toBe('-0.5');
    expect(normalizeLoraWeights('{0.5|-0.5|1}')).toBe('{0.5|-0.5|1}');
    expect(normalizeLoraWeights('{3|4|5|5|5|6|7|8|9}')).toBe(
      '{3|4|5|5|5|6|7|8|9}',
    );
    expect(normalizeLoraWeights('3')).toBe('3');
    expect(normalizeLoraWeights('-3')).toBe('-3');
    expect(normalizeLoraWeights('nope')).toBeNull();
  });

  it('dedupes extra LoRA category ids against the primary', () => {
    expect(uniqueExtraLoraCategoryIds('a', ['b', 'a', ' b ', '', 'c', 'b'])).toEqual([
      'b',
      'c',
    ]);
    expect(uniqueExtraLoraCategoryIds(undefined, ['x'])).toEqual(['x']);
  });

  it('parses a category record', () => {
    expect(
      parseLoraDownloadCategory({
        id: 'abc',
        name: ' Swimwear ',
        folder: '../escape',
        wildcardRelativePath: 'clothes\\swim.txt',
        defaultWeights: '{0.7|0.8}',
      }),
    ).toBeNull(); // traversal is rejected
    expect(
      parseLoraDownloadCategory({
        id: 'abc',
        name: 'Swimwear',
        folder: 'clothing/swim',
        wildcardRelativePath: 'clothes/swim.txt',
        defaultWeights: '{0.7|0.8}',
      }),
    ).toEqual({
      id: 'abc',
      name: 'Swimwear',
      folder: 'clothing/swim',
      wildcardRelativePath: 'clothes/swim.txt',
      defaultWeights: '{0.7|0.8}',
    });
  });

  it('appends a snippet once and skips duplicate stems', () => {
    const snippet =
      '# https://civitai.com/models/1/foo\n<lora:Foo:0.8> trigger';
    const first = appendLoraSnippetToWildcardText('', snippet, 'Foo');
    expect(first.appended).toBe(true);
    expect(first.text).toContain('<lora:Foo:0.8>');

    const second = appendLoraSnippetToWildcardText(first.text, snippet, 'Foo');
    expect(second.appended).toBe(false);
    expect(second.text).toBe(first.text);

    const withContent = appendLoraSnippetToWildcardText(
      'line one\n',
      '# https://civitai.com/models/2/bar\n<lora:Bar:{0.8|0.9}>',
      'Bar',
    );
    expect(withContent.appended).toBe(true);
    expect(withContent.text).toBe(
      'line one\n\n# https://civitai.com/models/2/bar\n<lora:Bar:{0.8|0.9}>\n',
    );
  });

  it('extends an existing series root instead of appending a second tag', () => {
    const existing =
      '# LOCAL\n<lora:Styles_FlatLines_00000{1500|1750|2000}:{0.8|0.9|1|1|1}>\n';
    const snippet =
      '# LOCAL\n<lora:Styles_FlatLines_00000{2500|3000}:{0.8|0.9|1|1|1}>\n';
    const result = upsertLoraSnippetIntoWildcardText({
      existing,
      snippet,
      fileStem: 'Styles_FlatLines_00000{2500|3000}',
      series: {
        seriesBase: 'Styles_FlatLines',
        separator: '_',
        stepDigitsList: ['000002500', '000003000'],
      },
    });
    expect(result.mode).toBe('extended');
    expect(result.text).toContain(
      '<lora:Styles_FlatLines_00000{1500|1750|2000|2500|3000}:{0.8|0.9|1|1|1}>',
    );
    expect(result.text).not.toContain('00000{2500|3000}');
  });

  it('appends when the target file has no matching series root', () => {
    const snippet =
      '# LOCAL\n<lora:Styles_FlatLines_00000{2500|3000}:0.8>\n';
    const result = upsertLoraSnippetIntoWildcardText({
      existing: '<lora:OtherThing:0.5>\n',
      snippet,
      fileStem: 'Styles_FlatLines_00000{2500|3000}',
      series: {
        seriesBase: 'Styles_FlatLines',
        separator: '_',
        stepDigitsList: ['000002500', '000003000'],
      },
    });
    expect(result.mode).toBe('appended');
    expect(result.text).toContain(
      '<lora:Styles_FlatLines_00000{2500|3000}:0.8>',
    );
  });

  it('applyLoraWildcardBufferOp appends and is idempotent', () => {
    const first = applyLoraWildcardBufferOp('hats\n', {
      type: 'append',
      snippet: '<lora:Foo:1>',
      fileStem: 'Foo',
    });
    expect(first.changed).toBe(true);
    expect(first.text).toContain('<lora:Foo:1>');
    const second = applyLoraWildcardBufferOp(first.text, {
      type: 'append',
      snippet: '<lora:Foo:1>',
      fileStem: 'Foo',
    });
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
  });
});
