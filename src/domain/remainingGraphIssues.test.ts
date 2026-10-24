import { describe, expect, it } from 'vitest';
import { LOCAL_SYNTAX_ISSUE_CODES } from './parseRefs.js';
import {
  FILE_CHECK_ISSUE_CODES,
  analysisAfterFileEdit,
  issueIdentity,
  issuesAfterFileEdit,
  nodeIdsForFile,
  remainingGraphIssues,
} from './remainingGraphIssues.js';

const openFile = {
  code: 'unbalanced_brace',
  nodeId: 'clothes',
  line: 2,
  message: 'Unbalanced {',
};
const stillThere = {
  code: 'missing_file',
  nodeId: 'missing:hat',
  line: 4,
  message: 'Missing __hat__',
};
const sameFileOther = {
  code: 'unclosed_wildcard',
  nodeId: 'clothes',
  line: 8,
  message: 'Unclosed wildcard',
};

describe('remainingGraphIssues', () => {
  it('keeps the other errors while the open file is still validating', () => {
    const shown = new Set([issueIdentity(openFile)]);
    expect(
      remainingGraphIssues([openFile, stillThere, sameFileOther], {
        shownIdentities: shown,
        liveFileReady: false,
        openNodeIds: new Set(['clothes']),
      }),
    ).toEqual([stillThere, sameFileOther]);
  });

  it('drops only the open file once its live check has finished', () => {
    expect(
      remainingGraphIssues([openFile, stillThere, sameFileOther], {
        shownIdentities: new Set(),
        liveFileReady: true,
        openNodeIds: new Set(['clothes']),
      }),
    ).toEqual([stillThere]);
  });

  it('keeps library-wide rows that have no node id', () => {
    const unused = {
      code: 'unused_lora',
      message: 'LoRA on disk is not referenced',
      snippet: 'hair/bob.safetensors',
    };
    expect(
      remainingGraphIssues([unused, sameFileOther], {
        shownIdentities: new Set(),
        liveFileReady: true,
        openNodeIds: new Set(['clothes']),
      }),
    ).toEqual([unused]);
  });

  it('hides a fixed missing ref once the live check no longer reports it', () => {
    const hat = { ...stillThere, snippet: '__hat__' };
    const other = {
      code: 'missing_file',
      nodeId: 'missing:shoe',
      line: 1,
      message: 'Missing __shoe__',
    };
    expect(
      remainingGraphIssues([hat, other], {
        shownIdentities: new Set(),
        liveFileReady: true,
        openNodeIds: new Set(['clothes']),
        fileNodeIds: new Set(['clothes']),
        edges: [{ from: 'clothes', to: 'missing:hat', line: 4, snippet: '__hat__' }],
        resolvedIdentities: new Set(),
      }),
    ).toEqual([other]);
  });

  it('keeps that missing ref while the check is still running', () => {
    const hat = { ...stillThere, snippet: '__hat__' };
    expect(
      remainingGraphIssues([hat], {
        shownIdentities: new Set(),
        liveFileReady: false,
        openNodeIds: new Set(['clothes']),
        fileNodeIds: new Set(['clothes']),
        edges: [{ from: 'clothes', to: 'missing:hat', line: 4, snippet: '__hat__' }],
        resolvedIdentities: new Set(),
      }),
    ).toEqual([hat]);
  });
});

describe('issuesAfterFileEdit', () => {
  const nodes = [
    { id: 'clothes', relativeKey: 'clothes', hostKey: 'clothes' },
    { id: 'clothes/sleeve', relativeKey: 'clothes/sleeve', hostKey: 'clothes' },
    { id: 'missing:hat', relativeKey: 'hat' },
    { id: 'other', relativeKey: 'other', hostKey: 'other' },
  ];
  const edges = [
    { from: 'clothes', to: 'missing:hat', line: 4, snippet: '__hat__' },
  ];
  const openNodeIds = nodeIdsForFile(nodes, 'clothes');

  it('drops the open file missing ref and keeps another file plus a cycle', () => {
    const hat = { ...stillThere, snippet: '__hat__', severity: 'error' as const };
    const otherMissing = {
      code: 'missing_file',
      nodeId: 'missing:shoe',
      line: 2,
      message: 'Missing __shoe__',
      snippet: '__shoe__',
      severity: 'error' as const,
    };
    const cycle = {
      code: 'cycle',
      nodeId: 'clothes',
      line: 4,
      message: 'Cycle',
      severity: 'warning' as const,
    };
    const keptSyntax = { ...sameFileOther, severity: 'error' as const };
    expect(
      issuesAfterFileEdit([hat, otherMissing, cycle, keptSyntax], [keptSyntax], {
        openNodeIds,
        edges,
        codes: FILE_CHECK_ISSUE_CODES,
      }),
    ).toEqual([otherMissing, cycle, keptSyntax]);
  });

  it('a syntax-only pass drops a child-key brace error and keeps the missing ref', () => {
    const child = {
      code: 'unbalanced_brace',
      nodeId: 'clothes/sleeve',
      line: 3,
      message: 'Unbalanced {',
    };
    const hat = { ...stillThere, snippet: '__hat__' };
    const unused = {
      code: 'unused_lora',
      message: 'LoRA on disk is not referenced',
    };
    expect(
      issuesAfterFileEdit([child, hat, unused, sameFileOther], [sameFileOther], {
        openNodeIds,
        edges,
        codes: LOCAL_SYNTAX_ISSUE_CODES,
      }),
    ).toEqual([hat, unused, sameFileOther]);
  });

  it('appends a live issue the graph did not have yet', () => {
    const fresh = {
      code: 'missing_lora',
      nodeId: 'clothes',
      line: 9,
      message: 'Missing LoRA',
    };
    expect(
      issuesAfterFileEdit([sameFileOther], [sameFileOther, fresh], {
        openNodeIds,
        edges,
        codes: FILE_CHECK_ISSUE_CODES,
      }),
    ).toEqual([sameFileOther, fresh]);
  });

  it('writes the same removal onto the stored analysis list', () => {
    const hat = { ...stillThere, snippet: '__hat__', severity: 'error' as const };
    const otherMissing = {
      code: 'missing_file',
      nodeId: 'missing:shoe',
      line: 2,
      message: 'Missing __shoe__',
      severity: 'error' as const,
    };
    const analysis = {
      nodes: [
        {
          id: 'clothes',
          relativeKey: 'clothes',
          hostKey: 'clothes',
          issues: [] as Array<typeof hat | typeof otherMissing>,
        },
        { id: 'missing:hat', relativeKey: 'hat', issues: [hat] },
        {
          id: 'other',
          relativeKey: 'other',
          hostKey: 'other',
          issues: [otherMissing],
        },
      ],
      edges,
      issues: [hat, otherMissing],
      stats: { errorCount: 2, warningCount: 0 },
    };
    const live: Array<typeof hat | typeof otherMissing> = [];
    const next = analysisAfterFileEdit(
      analysis,
      'clothes',
      live,
      FILE_CHECK_ISSUE_CODES,
    );
    expect(next.issues).toEqual([otherMissing]);
    expect(next.nodes.find((node) => node.id === 'missing:hat')?.issues).toEqual([]);
    expect(next.nodes.find((node) => node.id === 'other')?.issues).toEqual([
      otherMissing,
    ]);
    expect(next.stats.errorCount).toBe(1);
  });
});
