import { describe, expect, it } from 'vitest';
import {
  addLoraFile,
  countLoraTags,
  expandLoraNameVariants,
  extractLoraRefs,
  filesMatchingLoraName,
  normalizeLoraName,
  resolveLoraName,
  searchLoraIndex,
  stripLoraExtension,
  loraNameHasStackedUnderscores,
  collapseStackedUnderscores,
  loraFileNameIssues,
  validateLoraRefs,
  validateUnusedLoras,
  validateDuplicateLoraAutoV2,
  issueSuggestsStaleLoraIndex,
  issueNeedsLoraIndexWatch,
  type LoraIndex,
} from './lora.js';

function indexFrom(files: { relative: string; absolute: string }[]): LoraIndex {
  const index: LoraIndex = {
    root: '/models/Lora',
    aliases: new Map(),
    files: [],
    fileCount: 0,
  };
  for (const file of files) {
    addLoraFile(index, file.relative, file.absolute);
  }
  return index;
}

describe('extractLoraRefs', () => {
  it('extracts complete A1111 tags with weights and extra fields', () => {
    const refs = extractLoraRefs(
      'portrait <lora:detail_slider:0.8> and <lora:style/oil:0.5:0.2>',
    );
    expect(refs.map((ref) => ref.name)).toEqual([
      'detail_slider',
      'style/oil',
    ]);
    expect(refs[0]?.line).toBe(1);
    expect(refs[0]?.column).toBe(10);
    expect(refs[0]?.raw).toBe('<lora:detail_slider:0.8>');
  });

  it('includes empty-name tags and skips comments / unclosed tags', () => {
    const refs = extractLoraRefs(
      [
        '# <lora:commented:1>',
        'active <lora:real:1>',
        'broken <lora:incomplete',
        'also <lora:>',
        'empty weight <lora::0.5>',
      ].join('\n'),
    );
    expect(refs.map((ref) => ({ name: ref.name, raw: ref.raw }))).toEqual([
      { name: 'real', raw: '<lora:real:1>' },
      { name: '', raw: '<lora:>' },
      { name: '', raw: '<lora::0.5>' },
    ]);
  });

  it('strips supported extensions from the tag name', () => {
    const refs = extractLoraRefs('<lora:foo/bar.safetensors:0.7>');
    expect(refs[0]?.name).toBe('foo/bar');
  });

  it('counts tags for file filtering, including empty names', () => {
    expect(countLoraTags('no tags here')).toBe(0);
    expect(
      countLoraTags('<lora:a:1> text <lora:>\n# <lora:c:1>'),
    ).toBe(2);
  });

  it('keeps Dynamic Prompts choices inside the model name', () => {
    const refs = extractLoraRefs(
      '<lora:LORANAME-00000{1000|1750|2000}>',
    );
    expect(refs).toEqual([
      expect.objectContaining({
        name: 'LORANAME-00000{1000|1750|2000}',
        raw: '<lora:LORANAME-00000{1000|1750|2000}>',
      }),
    ]);
  });
});

describe('expandLoraNameVariants', () => {
  it('expands pipe choices into concrete model names', () => {
    expect(
      expandLoraNameVariants('LORANAME-00000{1000|2000|3000}'),
    ).toEqual([
      'LORANAME-000001000',
      'LORANAME-000002000',
      'LORANAME-000003000',
    ]);
  });

  it('leaves plain names unchanged', () => {
    expect(expandLoraNameVariants('present')).toEqual(['present']);
  });
});

describe('lora alias resolution', () => {
  const index = indexFrom([
    {
      relative: 'styles/OilPaint.safetensors',
      absolute: '/models/Lora/styles/OilPaint.safetensors',
    },
    {
      relative: 'detail.ckpt',
      absolute: '/models/Lora/detail.ckpt',
    },
    {
      relative: 'nested/path/model.pt',
      absolute: '/models/Lora/nested/path/model.pt',
    },
  ]);

  it('matches relative path, basename, and case-insensitively', () => {
    expect(resolveLoraName('styles/OilPaint', index)).toContain('OilPaint');
    expect(resolveLoraName('styles\\oilpaint', index)).toContain('OilPaint');
    expect(resolveLoraName('OilPaint', index)).toContain('OilPaint');
    expect(resolveLoraName('oilpaint.safetensors', index)).toContain(
      'OilPaint',
    );
    expect(resolveLoraName('detail', index)).toContain('detail.ckpt');
    expect(resolveLoraName('nested/path/model', index)).toContain('model.pt');
  });

  it('does not treat Windows (n) copy suffixes as interchangeable', () => {
    const withDup = indexFrom([
      {
        relative: 'k2_v3_000001000 (1).safetensors',
        absolute: '/models/Lora/k2_v3_000001000 (1).safetensors',
      },
    ]);
    expect(resolveLoraName('k2_v3_000001000 (1)', withDup)).toContain(
      'k2_v3_000001000 (1)',
    );
    expect(resolveLoraName('k2_v3_000001000', withDup)).toBeUndefined();

    const plain = indexFrom([
      {
        relative: 'k2_v3_000001000.safetensors',
        absolute: '/models/Lora/k2_v3_000001000.safetensors',
      },
    ]);
    expect(resolveLoraName('k2_v3_000001000 (1)', plain)).toBeUndefined();
    expect(resolveLoraName('k2_v3_000001000', plain)).toContain(
      'k2_v3_000001000.safetensors',
    );
  });

  it('does not resolve V1 (1) to a bare V1 file', () => {
    const index = indexFrom([
      {
        relative: 'V1.safetensors',
        absolute: '/models/Lora/V1.safetensors',
      },
      {
        relative: 'Krea2_v1 (1).safetensors',
        absolute: '/models/Lora/Krea2_v1 (1).safetensors',
      },
    ]);
    expect(resolveLoraName('V1 (1)', index)).toBeUndefined();
    expect(
      validateLoraRefs('<lora:V1 (1):{0.8|0.9|1|1}>', index),
    ).toEqual([expect.objectContaining({ code: 'missing_lora' })]);
  });

  it('keeps bare name and (1) distinct when both files exist', () => {
    // Register the duplicate first — previously stole the bare alias.
    const both = indexFrom([
      {
        relative: 'loraname (1).safetensors',
        absolute: '/models/Lora/loraname (1).safetensors',
      },
      {
        relative: 'loraname.safetensors',
        absolute: '/models/Lora/loraname.safetensors',
      },
    ]);
    expect(resolveLoraName('loraname', both)).toBe(
      '/models/Lora/loraname.safetensors',
    );
    expect(resolveLoraName('loraname (1)', both)).toBe(
      '/models/Lora/loraname (1).safetensors',
    );
  });

  it('normalizes separators and extensions', () => {
    expect(normalizeLoraName('Foo\\Bar')).toBe('foo/bar');
    expect(stripLoraExtension('x.SAFETENSORS')).toBe('x');
    expect(stripLoraExtension('x.pt')).toBe('x');
    expect(stripLoraExtension('flux-q4_k_m.gguf')).toBe('flux-q4_k_m');
    expect(stripLoraExtension('Model.GGUF')).toBe('Model');
  });
});

describe('issueSuggestsStaleLoraIndex', () => {
  it('flags missing and unused LoRA issues only', () => {
    expect(issueSuggestsStaleLoraIndex({ code: 'missing_lora' })).toBe(true);
    expect(issueSuggestsStaleLoraIndex({ code: 'unused_lora' })).toBe(true);
    expect(issueSuggestsStaleLoraIndex({ code: 'invalid_lora' })).toBe(false);
    expect(issueSuggestsStaleLoraIndex({ code: 'missing_file' })).toBe(false);
  });

  it('keeps watching missing tags and missing series steps', () => {
    expect(issueNeedsLoraIndexWatch({ code: 'missing_lora' })).toBe(true);
    expect(
      issueNeedsLoraIndexWatch({
        code: 'unused_lora',
        fixAction: 'extend_lora_series',
      }),
    ).toBe(true);
    expect(issueNeedsLoraIndexWatch({ code: 'unused_lora' })).toBe(false);
  });
});

describe('validateLoraRefs', () => {
  const index = indexFrom([
    {
      relative: 'present.safetensors',
      absolute: '/models/Lora/present.safetensors',
    },
  ]);

  it('emits missing_lora warnings for unresolved tags', () => {
    const issues = validateLoraRefs(
      'ok <lora:present:1> bad <lora:missing:0.5>',
      index,
      'host',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      code: 'missing_lora',
      nodeId: 'host',
      line: 1,
      snippet: '<lora:missing:0.5>',
    });
  });

  it('emits invalid_lora for empty model names', () => {
    const issues = validateLoraRefs('x <lora:> y <lora::1>', index, 'host');
    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.code === 'invalid_lora')).toBe(true);
    expect(issues[0]?.snippet).toBe('<lora:>');
    expect(issues[1]?.snippet).toBe('<lora::1>');
  });

  it('flags stacked underscores in an on-disk LoRA file name', () => {
    expect(loraNameHasStackedUnderscores('style_v2')).toBe(false);
    expect(loraNameHasStackedUnderscores('style__v2')).toBe(true);
    expect(loraNameHasStackedUnderscores('a/b___c')).toBe(true);
    expect(collapseStackedUnderscores('style__v2___x')).toBe('style_v2_x');
    expect(collapseStackedUnderscores('already_ok')).toBe('already_ok');
    const issues = loraFileNameIssues('foo__bar', 'subdir/foo__bar.safetensors');
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'invalid_lora',
        snippet: 'subdir/foo__bar.safetensors',
        message: expect.stringContaining('`foo__bar`'),
      }),
    ]);
    expect(loraFileNameIssues('clean', 'clean.safetensors')).toEqual([]);
  });

  it('flags empty names even without a configured LoRA folder', () => {
    const issues = validateLoraRefs('<lora:> and <lora:ok:1>', null);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('invalid_lora');
  });

  it('reports no issues when every tag resolves', () => {
    expect(validateLoraRefs('<lora:present:1>', index)).toEqual([]);
  });

  it('flags unclosed LoRA tags missing a closing >', () => {
    const issues = validateLoraRefs(
      '<lora:krea2raw_v2:{1|1.3|1.5|1.7} tag',
      index,
      'host',
    );
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'invalid_lora',
        nodeId: 'host',
        line: 1,
        column: 1,
        message: expect.stringContaining('Unclosed LoRA tag'),
        snippet: '<lora:krea2raw_v2:{1|1.3|1.5|1.7} tag',
      }),
    ]);
  });

  it('accepts closed brace-weight LoRA tags', () => {
    expect(
      validateLoraRefs('<lora:present:{1|1.3|1.5}>', index),
    ).toEqual([]);
  });

  it('flags a non-numeric token in a brace weight list', () => {
    const issues = validateLoraRefs(
      '<lora:present:{0.8|0.9|1|1|df}>',
      index,
      'host',
    );
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'invalid_lora',
        nodeId: 'host',
        line: 1,
        snippet: '<lora:present:{0.8|0.9|1|1|df}>',
        message: expect.stringContaining('`df`'),
      }),
    ]);
  });

  it('flags a non-numeric single weight', () => {
    const issues = validateLoraRefs('<lora:present:foo>', index);
    expect(issues[0]).toMatchObject({
      code: 'invalid_lora',
      snippet: '<lora:present:foo>',
    });
    expect(issues[0]?.message).toContain('`foo`');
  });

  it('accepts negative and extra clip weights', () => {
    expect(validateLoraRefs('<lora:present:-0.5:0.2>', index)).toEqual([]);
  });

  it('flags an empty weight field', () => {
    const issues = validateLoraRefs('<lora:present:>', index);
    expect(issues.some((issue) => issue.message.includes('(empty)'))).toBe(
      true,
    );
  });

  it('expands Dynamic Prompts choices in the LoRA model name', () => {
    const stepped = indexFrom([
      {
        relative: 'LORANAME-000001000.safetensors',
        absolute: '/models/Lora/LORANAME-000001000.safetensors',
      },
      {
        relative: 'LORANAME-000002000.safetensors',
        absolute: '/models/Lora/LORANAME-000002000.safetensors',
      },
      {
        relative: 'LORANAME-000003000.safetensors',
        absolute: '/models/Lora/LORANAME-000003000.safetensors',
      },
    ]);
    expect(
      validateLoraRefs(
        '<lora:LORANAME-00000{1000|2000|3000}>',
        stepped,
      ),
    ).toEqual([]);
  });

  it('reports missing expansions from a variant LoRA name', () => {
    const stepped = indexFrom([
      {
        relative: 'LORANAME-000002000.safetensors',
        absolute: '/models/Lora/LORANAME-000002000.safetensors',
      },
    ]);
    const issues = validateLoraRefs(
      '<lora:LORANAME-00000{1000|2000|3000}:1>',
      stepped,
      'host',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'missing_lora',
      nodeId: 'host',
      snippet: '<lora:LORANAME-00000{1000|2000|3000}:1>',
    });
    expect(issues[0]?.message).toContain('LORANAME-000001000');
    expect(issues[0]?.message).toContain('LORANAME-000003000');
    expect(issues[0]?.message).not.toContain('LORANAME-000002000');
  });

  it('rejects LoRA names that contain __ wildcard markers', () => {
    const issues = validateLoraRefs(
      '<lora:foo__bar:1> and <lora:present:1>',
      index,
      'host',
    );
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'invalid_lora',
        nodeId: 'host',
        snippet: '<lora:foo__bar:1>',
        message: expect.stringContaining('__'),
      }),
    ]);
  });
});

describe('searchLoraIndex', () => {
  const index = indexFrom([
    {
      relative: 'detail_slider.safetensors',
      absolute: '/models/Lora/detail_slider.safetensors',
    },
    {
      relative: 'styles/oil_paint.safetensors',
      absolute: '/models/Lora/styles/oil_paint.safetensors',
    },
    {
      relative: 'styles/watercolor.safetensors',
      absolute: '/models/Lora/styles/watercolor.safetensors',
    },
  ]);

  it('matches stem, basename, and relative path prefixes (not substrings)', () => {
    expect(searchLoraIndex(index, 'oil').map((h) => h.stem)).toEqual([
      'styles/oil_paint',
    ]);
    expect(searchLoraIndex(index, 'styles').map((h) => h.stem)).toEqual([
      'styles/oil_paint',
      'styles/watercolor',
    ]);
    expect(searchLoraIndex(index, 'DETAIL').map((h) => h.stem)).toEqual([
      'detail_slider',
    ]);
    // Mid-name substring must not match (Open LoRA / validation safety).
    expect(searchLoraIndex(index, 'paint').map((h) => h.stem)).toEqual([]);
    expect(searchLoraIndex(index, 'slider').map((h) => h.stem)).toEqual([]);
  });

  it('does not treat V1 (1) as a match for Krea2_v1 (1)', () => {
    const withSuffix = indexFrom([
      {
        relative: 'Krea2_v1 (1).safetensors',
        absolute: '/models/Lora/Krea2_v1 (1).safetensors',
      },
    ]);
    expect(searchLoraIndex(withSuffix, 'V1 (1)')).toEqual([]);
    expect(resolveLoraName('V1 (1)', withSuffix)).toBeUndefined();
    expect(validateLoraRefs('<lora:V1 (1):1>', withSuffix)).toEqual([
      expect.objectContaining({ code: 'missing_lora' }),
    ]);
  });

  it('ranks exact stem matches first and ignores empty queries', () => {
    expect(searchLoraIndex(index, '')).toEqual([]);
    expect(searchLoraIndex(index, '   ')).toEqual([]);
    const hits = searchLoraIndex(index, 'detail_slider');
    expect(hits[0]).toMatchObject({ stem: 'detail_slider', exact: true });
  });

  it('resolves Dynamic Prompts multi-step brace picks to on-disk files', () => {
    const stepped = indexFrom([
      {
        relative: 'Akira_000000100.safetensors',
        absolute: '/models/Lora/Akira_000000100.safetensors',
      },
      {
        relative: 'Akira_000000200.safetensors',
        absolute: '/models/Lora/Akira_000000200.safetensors',
      },
      {
        relative: 'Akira_000000250.safetensors',
        absolute: '/models/Lora/Akira_000000250.safetensors',
      },
      {
        relative: 'other.safetensors',
        absolute: '/models/Lora/other.safetensors',
      },
    ]);
    const hits = searchLoraIndex(
      stepped,
      'Akira_000000{100|200|250|300}',
    );
    expect(hits.map((h) => h.stem)).toEqual([
      'Akira_000000100',
      'Akira_000000200',
      'Akira_000000250',
    ]);
    expect(hits.every((h) => h.exact)).toBe(true);
  });
});

describe('validateUnusedLoras', () => {
  const index = indexFrom([
    {
      relative: 'used.safetensors',
      absolute: '/models/Lora/used.safetensors',
    },
    {
      relative: 'styles/orphan.safetensors',
      absolute: '/models/Lora/styles/orphan.safetensors',
    },
  ]);

  it('warns for on-disk LoRAs that no wildcard file references', () => {
    const issues = validateUnusedLoras(index, ['a <lora:used:0.8> prompt']);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      code: 'unused_lora',
      snippet: 'styles/orphan.safetensors',
      message: expect.stringContaining('styles/orphan'),
    });
    expect(issues[0]?.nodeId).toBeUndefined();
  });

  it('treats basename references as usage', () => {
    expect(
      validateUnusedLoras(index, ['<lora:orphan:1>', '<lora:used:1>']),
    ).toEqual([]);
  });

  it('treats basename refs as usage for nested folder LoRAs', () => {
    const nested = indexFrom([
      {
        relative: 'MyGirls/NewFace.safetensors',
        absolute: '/models/Lora/MyGirls/NewFace.safetensors',
      },
    ]);
    expect(resolveLoraName('NewFace', nested)).toContain('NewFace');
    expect(
      validateUnusedLoras(nested, ['portrait <lora:NewFace:0.8>']),
    ).toEqual([]);
  });

  it('treats basename refs as usage when another file owns the alias first', () => {
    const nested = indexFrom([
      {
        relative: 'Other/NewFace.safetensors',
        absolute: '/models/Lora/Other/NewFace.safetensors',
      },
      {
        relative: 'MyGirls/NewFace.safetensors',
        absolute: '/models/Lora/MyGirls/NewFace.safetensors',
      },
    ]);
    expect(
      validateUnusedLoras(nested, ['<lora:NewFace>']),
    ).toEqual([]);
    expect(
      filesMatchingLoraName('NewFace', nested).map((f) => f.relativePath).sort(),
    ).toEqual([
      'MyGirls/NewFace.safetensors',
      'Other/NewFace.safetensors',
    ]);
  });

  it('does not warn for explicitly ignored LoRAs', () => {
    expect(
      validateUnusedLoras(
        index,
        ['<lora:used:1>'],
        ['styles\\orphan.safetensors'],
      ),
    ).toEqual([]);
  });

  it('treats Dynamic Prompts name variants as usage of each expansion', () => {
    const stepped = indexFrom([
      {
        relative: 'LORANAME-000001000.safetensors',
        absolute: '/models/Lora/LORANAME-000001000.safetensors',
      },
      {
        relative: 'LORANAME-000002000.safetensors',
        absolute: '/models/Lora/LORANAME-000002000.safetensors',
      },
      {
        relative: 'other.safetensors',
        absolute: '/models/Lora/other.safetensors',
      },
    ]);
    const issues = validateUnusedLoras(stepped, [
      '<lora:LORANAME-00000{1000|2000}>',
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.snippet).toBe('other.safetensors');
  });

  it('collapses unused training-step series into one issue', () => {
    const stepped = indexFrom([
      {
        relative: '!Testing/Melly_000000250.safetensors',
        absolute: '/models/Lora/!Testing/Melly_000000250.safetensors',
      },
      {
        relative: '!Testing/Melly_000000500.safetensors',
        absolute: '/models/Lora/!Testing/Melly_000000500.safetensors',
      },
      {
        relative: '!Testing/Melly_0000001000.safetensors',
        absolute: '/models/Lora/!Testing/Melly_0000001000.safetensors',
      },
    ]);
    const issues = validateUnusedLoras(stepped, []);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'unused_lora',
      snippet: '!Testing/Melly_000000250.safetensors',
      message: expect.stringContaining('!Testing/Melly_*'),
    });
    expect(issues[0]?.relatedPaths).toEqual([
      '!Testing/Melly_000000500.safetensors',
      '!Testing/Melly_0000001000.safetensors',
    ]);
  });

  it('flags missing steps when the series root is already referenced', () => {
    const stepped = indexFrom([
      {
        relative: 'Styles/Styles_FlatLines_000002500.safetensors',
        absolute: '/models/Lora/Styles/Styles_FlatLines_000002500.safetensors',
      },
      {
        relative: 'Styles/Styles_FlatLines_000003000.safetensors',
        absolute: '/models/Lora/Styles/Styles_FlatLines_000003000.safetensors',
      },
    ]);
    const issues = validateUnusedLoras(stepped, [
      '<lora:Styles_FlatLines_00000{1500|1750|2000}:{0.8|0.9|1|1|1}>',
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'unused_lora',
      fixAction: 'extend_lora_series',
      message: expect.stringContaining('missing training steps'),
    });
  });
});

describe('validateDuplicateLoraAutoV2', () => {
  it('warns each file that shares an AutoV2 with another', () => {
    const index = indexFrom([
      {
        relative: 'a.safetensors',
        absolute: '/models/Lora/a.safetensors',
      },
      {
        relative: 'copies/a (1).safetensors',
        absolute: '/models/Lora/copies/a (1).safetensors',
      },
      {
        relative: 'unique.safetensors',
        absolute: '/models/Lora/unique.safetensors',
      },
    ]);
    index.files[0]!.autoV2 = 'AAAAAAAAAA';
    index.files[1]!.autoV2 = 'aaaaaaaaaa';
    index.files[2]!.autoV2 = 'BBBBBBBBBB';

    const issues = validateDuplicateLoraAutoV2(index);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.code === 'duplicate_lora_hash')).toBe(true);
    expect(issues.map((i) => i.snippet).sort()).toEqual([
      'a.safetensors',
      'copies/a (1).safetensors',
    ]);
    expect(issues[0]?.message).toContain('AAAAAAAAAA');
    const forA = issues.find((i) => i.snippet === 'a.safetensors');
    expect(forA?.relatedPaths).toEqual(['copies/a (1).safetensors']);
  });

  it('ignores files without AutoV2', () => {
    const index = indexFrom([
      {
        relative: 'a.safetensors',
        absolute: '/models/Lora/a.safetensors',
      },
      {
        relative: 'b.safetensors',
        absolute: '/models/Lora/b.safetensors',
      },
    ]);
    expect(validateDuplicateLoraAutoV2(index)).toEqual([]);
  });
});
