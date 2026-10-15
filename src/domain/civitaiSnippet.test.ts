import { describe, expect, it } from 'vitest';
import {
  appendLoraExtraPrompt,
  buildLoraClipboardSnippet,
  civitaiModelPageUrl,
  civitaiModelSlug,
  findCivitaiModelUrlAbove,
  normalizeCivitaiOrigin,
  parseCivitaiModelPageUrl,
  parseCivitaiModelUrlFromLine,
} from './civitaiSnippet.js';

describe('civitaiSnippet', () => {
  it('normalizes site origins to the two presets', () => {
    expect(normalizeCivitaiOrigin('https://civitai.red/')).toBe(
      'https://civitai.red',
    );
    expect(normalizeCivitaiOrigin('https://civitai.com')).toBe(
      'https://civitai.com',
    );
    expect(normalizeCivitaiOrigin('https://evil.example')).toBe(
      'https://civitai.com',
    );
  });

  it('builds model page URLs with kebab slugs', () => {
    expect(civitaiModelSlug('WAI Illustrious SDXL', 827184)).toBe(
      'wai-illustrious-sdxl',
    );
    expect(
      civitaiModelPageUrl('https://civitai.com', 12, 'My LoRA!'),
    ).toBe('https://civitai.com/models/12/my-lora');
  });

  it('parses model page URLs from both sites', () => {
    expect(
      parseCivitaiModelPageUrl(
        'https://civitai.red/models/1240263/lalique?utm=1',
      ),
    ).toEqual({
      origin: 'https://civitai.red',
      modelId: 1240263,
      slug: 'lalique',
    });
    expect(parseCivitaiModelPageUrl('https://www.civitai.com/models/99')).toEqual(
      {
        origin: 'https://civitai.com',
        modelId: 99,
        slug: undefined,
      },
    );
    expect(parseCivitaiModelPageUrl('https://evil.example/models/1')).toBeNull();
    expect(parseCivitaiModelPageUrl('not a url')).toBeNull();
  });

  it('parses model URLs from comment lines', () => {
    expect(
      parseCivitaiModelUrlFromLine(
        '# https://civitai.red/models/2769840/busty-chinese-schoolgirl-fictional-character',
      ),
    ).toEqual({
      origin: 'https://civitai.red',
      modelId: 2769840,
      slug: 'busty-chinese-schoolgirl-fictional-character',
    });
  });

  it('finds the URL on the previous or before-previous line above a LoRA tag', () => {
    const text = [
      '# https://civitai.red/models/99/detail-slider',
      '<lora:detail_slider:{0.8|0.9|1|1}>',
      '',
      '# https://civitai.com/models/12/other',
      '',
      '<lora:other:1>',
    ].join('\n');
    const firstTag = text.indexOf('<lora:detail_slider');
    expect(findCivitaiModelUrlAbove(text, firstTag)?.modelId).toBe(99);
    const secondTag = text.indexOf('<lora:other');
    expect(findCivitaiModelUrlAbove(text, secondTag)?.modelId).toBe(12);
    expect(findCivitaiModelUrlAbove(text, 0)).toBeNull();
  });

  it('builds the two-line LoRA clipboard snippet with 1..N keyword picks', () => {
    expect(
      buildLoraClipboardSnippet({
        origin: 'https://civitai.com',
        modelId: 99,
        modelName: 'Detail Slider',
        fileStem: 'detail_slider_v2',
        trainedWords: ['detailed', 'sharp'],
      }),
    ).toBe(
      [
        '# https://civitai.com/models/99/detail-slider',
        '<lora:detail_slider_v2:{0.8|0.9|1|1}> {1-2$$detailed | sharp}',
      ].join('\n'),
    );
  });

  it('keeps a single trigger plain', () => {
    expect(
      buildLoraClipboardSnippet({
        origin: 'https://civitai.com',
        modelId: 2,
        modelName: 'Solo',
        fileStem: 'solo',
        trainedWords: ['solotrigger'],
      }),
    ).toBe(
      [
        '# https://civitai.com/models/2/solo',
        '<lora:solo:{0.8|0.9|1|1}> solotrigger',
      ].join('\n'),
    );
  });

  it('omits triggers when trainedWords is empty', () => {
    expect(
      buildLoraClipboardSnippet({
        origin: 'https://civitai.red',
        modelId: 1,
        modelName: 'x',
        fileStem: 'x',
        trainedWords: [],
      }),
    ).toBe(
      ['# https://civitai.red/models/1/x', '<lora:x:{0.8|0.9|1|1}>'].join('\n'),
    );
  });

  it('uses custom weights when provided', () => {
    expect(
      buildLoraClipboardSnippet({
        origin: 'https://civitai.com',
        modelId: 5,
        modelName: 'Custom',
        fileStem: 'custom_v1',
        trainedWords: [],
        weights: '0.55',
      }),
    ).toBe(
      [
        '# https://civitai.com/models/5/custom',
        '<lora:custom_v1:0.55>',
      ].join('\n'),
    );
    expect(
      buildLoraClipboardSnippet({
        origin: 'https://civitai.com',
        modelId: 5,
        modelName: 'Custom',
        fileStem: 'custom_v1',
        trainedWords: ['t'],
        weights: '{0.5|-0.5|1}',
      }),
    ).toBe(
      [
        '# https://civitai.com/models/5/custom',
        '<lora:custom_v1:{0.5|-0.5|1}> t',
      ].join('\n'),
    );
  });

  it('inserts optional extra comment and extra prompt', () => {
    expect(
      buildLoraClipboardSnippet({
        origin: 'https://civitai.com',
        modelId: 42,
        modelName: 'Light',
        fileStem: 'light_slider',
        trainedWords: [],
        weights: '{-3|0|3|6}',
        extraComment:
          'Value range from -10 (darkest) to +10 (brightest) but I don\'t like it too dark or too bright, clamping values between -3 and 6',
        extraPrompt: 'atmospheric, dynamic lighting, shadows, bokeh',
      }),
    ).toBe(
      [
        '# https://civitai.com/models/42/light',
        '# Value range from -10 (darkest) to +10 (brightest) but I don\'t like it too dark or too bright, clamping values between -3 and 6',
        '<lora:light_slider:{-3|0|3|6}> atmospheric, dynamic lighting, shadows, bokeh',
      ].join('\n'),
    );
  });

  it('keeps a leading # on extra comments and places prompt after triggers', () => {
    expect(
      buildLoraClipboardSnippet({
        origin: 'https://civitai.com',
        modelId: 7,
        modelName: 'Detail',
        fileStem: 'detail',
        trainedWords: ['detailed', 'sharp'],
        extraComment: '# already hashed\nsecond line',
        extraPrompt: 'crisp details',
      }),
    ).toBe(
      [
        '# https://civitai.com/models/7/detail',
        '# already hashed',
        '# second line',
        '<lora:detail:{0.8|0.9|1|1}> {1-2$$detailed | sharp}, crisp details',
      ].join('\n'),
    );
  });

  it('joins extra prompt with a comma and avoids double commas', () => {
    expect(
      appendLoraExtraPrompt(
        '<lora:x:{0.8|0.9|1|1}> trigger',
        'atmospheric, bokeh',
      ),
    ).toBe('<lora:x:{0.8|0.9|1|1}> trigger, atmospheric, bokeh');

    expect(
      appendLoraExtraPrompt(
        '<lora:x:{0.8|0.9|1|1}> trigger,',
        'atmospheric',
      ),
    ).toBe('<lora:x:{0.8|0.9|1|1}> trigger, atmospheric');

    expect(
      appendLoraExtraPrompt(
        '<lora:x:{0.8|0.9|1|1}> trigger',
        ', atmospheric',
      ),
    ).toBe('<lora:x:{0.8|0.9|1|1}> trigger, atmospheric');

    expect(
      appendLoraExtraPrompt('<lora:x:{0.8|0.9|1|1}>', 'atmospheric'),
    ).toBe('<lora:x:{0.8|0.9|1|1}> atmospheric');

    expect(
      appendLoraExtraPrompt('<lora:x:{0.8|0.9|1|1}>', ', atmospheric'),
    ).toBe('<lora:x:{0.8|0.9|1|1}> atmospheric');
  });
});
