import { describe, expect, it } from 'vitest';
import { analyzeWildcardTree } from './analyze.js';
import { expandPrompts, simulateReach } from './expand.js';
import { planRename } from './rename.js';
import { buildLibraryIndex, resolveWildcard } from './resolveWildcard.js';
import { parseStructuredFile } from './structured.js';
import type { LibraryFile } from './types.js';

function file(
  key: string,
  text: string,
  ext: LibraryFile['ext'] = '.txt',
): LibraryFile {
  return {
    relativePath: `${key}${ext}`,
    absolutePath: `/lib/${key}${ext}`,
    name: `${key.split('/').pop()}${ext}`,
    ext,
    key,
    text,
  };
}

describe('structured wildcard parsing and resolution', () => {
  it('enumerates YAML mappings, scalar lists, and source locations', () => {
    const source = file(
      'collections',
      [
        'palette:',
        '  warm:',
        '    primary:',
        '      - red',
        '      - orange',
        '  cool: blue',
      ].join('\n'),
      '.yaml',
    );
    const parsed = parseStructuredFile(source);

    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map((entry) => entry.key)).toEqual(
      expect.arrayContaining([
        'palette',
        'palette/warm',
        'palette/warm/primary',
        'palette/cool',
      ]),
    );
    const primary = parsed.entries.find(
      (entry) => entry.key === 'palette/warm/primary',
    );
    expect(primary?.values.map((value) => value.text)).toEqual([
      'red',
      'orange',
    ]);
    expect(primary?.line).toBe(3);
  });

  it('validates JSON strictly and reports malformed documents', () => {
    const parsed = parseStructuredFile(
      file('broken', '{"colors": ["red",]}', '.json'),
    );
    expect(parsed.entries).toEqual([]);
    expect(parsed.issues.some((issue) => issue.code === 'structured_parse_error')).toBe(
      true,
    );
    expect(parsed.issues[0]?.line).toBe(1);
  });

  it('parses JSON mapping paths independently of the filename', () => {
    const index = buildLibraryIndex([
      file(
        'anything',
        '{"materials":{"natural":["linen","wool"],"synthetic":"nylon"}}',
        '.json',
      ),
    ]);
    expect(resolveWildcard('materials/natural', index).kind).toBe('yamlKey');
    expect(resolveWildcard('anything/materials/natural', index).kind).toBe(
      'missing',
    );
  });

  it('reports duplicate global keys across structured documents', () => {
    const index = buildLibraryIndex([
      file('one', 'colors:\n  - red', '.yaml'),
      file('two', '{"colors":["blue"]}', '.json'),
    ]);
    expect(
      [...index.structuredDocuments.values()].some((document) =>
        document.issues.some(
          (issue) => issue.code === 'duplicate_structured_key',
        ),
      ),
    ).toBe(true);
  });

  it('requires a referenced nested path to exist', () => {
    const index = buildLibraryIndex([
      file('collections', 'palette:\n  warm:\n    - red', '.yaml'),
    ]);
    expect(resolveWildcard('palette/warm', index).kind).toBe('yamlKey');
    const missing = resolveWildcard('palette/cold', index);
    expect(missing.kind).toBe('missing');
    expect(missing.issues[0]?.message).toMatch(/missing/i);
  });
});

describe('structured wildcard graph and expansion', () => {
  const files = [
    file('root', '__palette/warm__'),
    file(
      'collections',
      [
        'palette:',
        '  warm:',
        '    - red',
        '    - __palette/cool__',
        '  cool: blue',
      ].join('\n'),
      '.yaml',
    ),
  ];

  it('creates first-class nested nodes and follows their references', () => {
    const result = analyzeWildcardTree({
      rootRelativePath: 'root.txt',
      files,
    });
    expect(result.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['root', 'palette/warm', 'palette/cool']),
    );
    expect(
      result.edges.some(
        (edge) =>
          edge.from === 'palette/warm' && edge.to === 'palette/cool',
      ),
    ).toBe(true);
    expect(result.stats.missingCount).toBe(0);
  });

  it('expands scalar/list values and nested references exhaustively', () => {
    const result = expandPrompts({
      rootRelativePath: 'root.txt',
      files,
      mode: 'exhaustive',
    });
    expect(result.samples.sort()).toEqual(['blue', 'red']);
    expect(result.totalCombinations).toBe(2);
    expect(result.issues).toEqual([]);
  });

  it('includes structured keys in simulation visits', () => {
    const simulationFiles = [
      file('root', '__palette/warm__'),
      file(
        'collections',
        'palette:\n  warm:\n    - __palette/cool__\n  cool: blue',
        '.yaml',
      ),
    ];
    const result = simulateReach({
      rootRelativePath: 'root.txt',
      files: simulationFiles,
      iterations: 20,
      seed: 7,
    });
    expect(result.stats.find((stat) => stat.key === 'palette/warm')?.reachRate).toBe(
      1,
    );
    expect(result.stats.find((stat) => stat.key === 'palette/cool')?.reachRate).toBe(
      1,
    );
  });

  it('shows all nested keys when a structured file is the graph root', () => {
    const result = analyzeWildcardTree({
      rootRelativePath: 'collections.yaml',
      files,
    });
    expect(result.rootNodeId).toBe('structured-file:collections');
    expect(result.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        'structured-file:collections',
        'palette',
        'palette/warm',
        'palette/cool',
      ]),
    );
  });
});

describe('structured file refactor semantics', () => {
  it('keeps global nested keys unchanged when the host file is renamed', () => {
    const plan = planRename(
      [
        file(
          'collections',
          'palette:\n  warm:\n    - __palette/cool__\n  cool: blue',
          '.yaml',
        ),
        file('caller', '__palette/warm__ and __palette/cool__'),
      ],
      'collections.yaml',
      'archive/collections',
    );
    expect(plan.canRename).toBe(true);
    expect(plan.sourceText).toContain('__palette/cool__');
    expect(plan.edits).toEqual([]);
    expect(plan.totalOccurrences).toBe(0);
    expect(plan.warnings.some((warning) => /does not rename/i.test(warning))).toBe(
      true,
    );
  });
});
