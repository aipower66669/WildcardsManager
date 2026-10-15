import { describe, expect, it } from 'vitest';
import {
  collectPrecedingCommentLines,
  findDefinedLoraReference,
} from './definedLoraReference.js';
import { addLoraFile, type LoraIndex } from './lora.js';

function indexWith(...stems: string[]): LoraIndex {
  const index: LoraIndex = {
    root: 'D:/loras',
    files: [],
    fileCount: 0,
    aliases: new Map(),
  };
  for (const stem of stems) {
    addLoraFile(
      index,
      `${stem}.safetensors`,
      `D:/loras/${stem}.safetensors`,
    );
  }
  return index;
}

describe('collectPrecedingCommentLines', () => {
  it('collects consecutive # lines immediately above the tag', () => {
    const lines = [
      'noise',
      '# https://civitai.red/models/1/foo',
      '# -7 poor, +7 rich',
      '<lora:Foo:{-7|0|7}>',
    ];
    expect(collectPrecedingCommentLines(lines, 3)).toEqual([
      '# https://civitai.red/models/1/foo',
      '# -7 poor, +7 rich',
    ]);
  });

  it('stops at a blank line', () => {
    const lines = ['# orphan', '', '# note', '<lora:Foo:1>'];
    expect(collectPrecedingCommentLines(lines, 3)).toEqual(['# note']);
  });
});

describe('findDefinedLoraReference', () => {
  it('prefers the documented full-range tag over a generic :1 elsewhere', () => {
    const index = indexWith('Economic_Capital_v1');
    const found = findDefinedLoraReference(
      [
        {
          relativePath: 'tools/sliders.txt',
          text: [
            '# https://civitai.red/models/2777019/economic-status-slider',
            '# -7 (poor), +7 (rich)',
            '<lora:Economic_Capital_v1:{-7|-5|-3|-1|0|1|3|5|7}>',
          ].join('\n'),
        },
        {
          relativePath: 'misc.txt',
          text: 'also <lora:Economic_Capital_v1:1> briefly',
        },
      ],
      index,
      'D:/loras/Economic_Capital_v1.safetensors',
    );

    expect(found?.tag).toBe(
      '<lora:Economic_Capital_v1:{-7|-5|-3|-1|0|1|3|5|7}>',
    );
    expect(found?.block).toBe(
      [
        '# https://civitai.red/models/2777019/economic-status-slider',
        '# -7 (poor), +7 (rich)',
        '<lora:Economic_Capital_v1:{-7|-5|-3|-1|0|1|3|5|7}>',
      ].join('\n'),
    );
    expect(found?.hasDocComments).toBe(true);
    expect(found?.relativePath).toBe('tools/sliders.txt');
  });

  it('falls back to the richest undocumentated tag when no comments exist', () => {
    const index = indexWith('Style');
    const found = findDefinedLoraReference(
      [
        {
          relativePath: 'a.txt',
          text: '<lora:Style:1>',
        },
        {
          relativePath: 'b.txt',
          text: '<lora:Style:{0.8|0.9|1|1}>',
        },
      ],
      index,
      'D:/loras/Style.safetensors',
    );
    expect(found?.tag).toBe('<lora:Style:{0.8|0.9|1|1}>');
    expect(found?.hasDocComments).toBe(false);
  });

  it('returns null when the LoRA is unused', () => {
    const index = indexWith('Unused');
    expect(
      findDefinedLoraReference(
        [{ relativePath: 'a.txt', text: '<lora:Other:1>' }],
        index,
        'D:/loras/Unused.safetensors',
      ),
    ).toBeNull();
  });

  it('includes trailing prompt text on the LoRA line in the block', () => {
    const index = indexWith('Hero');
    const found = findDefinedLoraReference(
      [
        {
          relativePath: 'cat.txt',
          text: '# LOCAL\n<lora:Hero:{0.8|1}> trigger, cinematic',
        },
      ],
      index,
      'D:/loras/Hero.safetensors',
    );
    expect(found?.tag).toBe('<lora:Hero:{0.8|1}>');
    expect(found?.block).toBe(
      '# LOCAL\n<lora:Hero:{0.8|1}> trigger, cinematic',
    );
  });
});
