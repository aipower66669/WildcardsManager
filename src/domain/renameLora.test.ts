import { describe, expect, it } from 'vitest';
import {
  addLoraFile,
  type LoraIndex,
} from './lora.js';
import {
  planRenameLora,
  remapLoraRefName,
  removeLoraReferences,
  rewriteLoraReferences,
} from './renameLora.js';
import type { LibraryFile } from './types.js';

function makeIndex(
  root: string,
  files: Array<{ relative: string; absolute: string }>,
): LoraIndex {
  const index: LoraIndex = {
    root,
    aliases: new Map(),
    files: [],
    fileCount: 0,
  };
  for (const f of files) {
    addLoraFile(index, f.relative, f.absolute);
  }
  return index;
}

describe('remapLoraRefName', () => {
  const file = {
    relativePath: 'styles/V1.safetensors',
    absolutePath: 'C:/loras/styles/V1.safetensors',
    stem: 'styles/V1',
  };

  it('preserves basename-style refs', () => {
    expect(remapLoraRefName('V1', file, 'styles/Hero')).toBe('Hero');
  });

  it('preserves relative stem refs', () => {
    expect(remapLoraRefName('styles/V1', file, 'styles/Hero')).toBe(
      'styles/Hero',
    );
  });

  it('preserves extension when present', () => {
    expect(remapLoraRefName('V1.safetensors', file, 'styles/Hero')).toBe(
      'Hero.safetensors',
    );
  });
});

describe('rewriteLoraReferences', () => {
  it('rewrites tags that resolve to the file, including brace weights', () => {
    const index = makeIndex('C:/loras', [
      {
        relative: 'V1.safetensors',
        absolute: 'C:/loras/V1.safetensors',
      },
      {
        relative: 'other.safetensors',
        absolute: 'C:/loras/other.safetensors',
      },
    ]);
    const oldFile = index.files[0]!;
    const { text, count } = rewriteLoraReferences(
      'a <lora:V1:{0.8|0.9|1|1}> and <lora:other:1> and <lora:V1:0.5>',
      oldFile.absolutePath,
      index,
      oldFile,
      'Hero_V1',
    );
    expect(count).toBe(2);
    expect(text).toBe(
      'a <lora:Hero_V1:{0.8|0.9|1|1}> and <lora:other:1> and <lora:Hero_V1:0.5>',
    );
  });
});

describe('removeLoraReferences', () => {
  it('strips tags that resolve to the target file only', () => {
    const index = makeIndex('C:/loras', [
      {
        relative: 'V1.safetensors',
        absolute: 'C:/loras/V1.safetensors',
      },
      {
        relative: 'other.safetensors',
        absolute: 'C:/loras/other.safetensors',
      },
    ]);
    const { text, count } = removeLoraReferences(
      'a <lora:V1:0.8> and <lora:other:1> plus <lora:V1:{0.5|1}>',
      'C:/loras/V1.safetensors',
      index,
    );
    expect(count).toBe(2);
    expect(text).toBe('a  and <lora:other:1> plus ');
  });

  it('does not strip bare-name refs when deleting the (1) duplicate', () => {
    const index = makeIndex('C:/loras', [
      {
        relative: 'loraname (1).safetensors',
        absolute: 'C:/loras/loraname (1).safetensors',
      },
      {
        relative: 'loraname.safetensors',
        absolute: 'C:/loras/loraname.safetensors',
      },
    ]);
    const { text, count } = removeLoraReferences(
      '<lora:loraname:1> keep · <lora:loraname (1):0.8> gone',
      'C:/loras/loraname (1).safetensors',
      index,
    );
    expect(count).toBe(1);
    expect(text).toBe('<lora:loraname:1> keep ·  gone');
  });
});

describe('planRenameLora', () => {
  const index = makeIndex('C:/loras', [
    {
      relative: 'subdir/V1.safetensors',
      absolute: 'C:/loras/subdir/V1.safetensors',
    },
  ]);
  const library: LibraryFile[] = [
    {
      key: 'prompt',
      relativePath: 'prompt.txt',
      absolutePath: 'C:/wildcards/prompt.txt',
      name: 'prompt.txt',
      ext: '.txt',
      text: '<lora:V1:{0.8|1}> also <lora:subdir/V1:0.5>',
    },
  ];

  it('plans basename rename in the same folder and rewrites refs', () => {
    const plan = planRenameLora(index, library, 'V1', 'Hero_V1');
    expect(plan.canRename).toBe(true);
    expect(plan.newRelativePath).toBe('subdir/Hero_V1.safetensors');
    expect(plan.newStem).toBe('subdir/Hero_V1');
    expect(plan.totalOccurrences).toBe(2);
    expect(plan.edits[0]?.newText).toBe(
      '<lora:Hero_V1:{0.8|1}> also <lora:subdir/Hero_V1:0.5>',
    );
  });

  it('rejects collisions and empty names', () => {
    const crowded = makeIndex('C:/loras', [
      { relative: 'V1.safetensors', absolute: 'C:/loras/V1.safetensors' },
      { relative: 'Hero.safetensors', absolute: 'C:/loras/Hero.safetensors' },
    ]);
    expect(planRenameLora(crowded, [], 'V1', 'Hero').canRename).toBe(false);
    expect(planRenameLora(index, [], 'V1', '').canRename).toBe(false);
    expect(planRenameLora(index, [], 'missing', 'X').canRename).toBe(false);
  });
});
