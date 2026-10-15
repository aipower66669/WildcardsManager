import {
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  type Node,
} from 'yaml';
import { parseLine } from './parseRefs.js';
import type { Issue, LibraryFile, WildcardRef } from './types.js';

export type StructuredValue = {
  text: string;
  line: number;
  column: number;
};

export type StructuredEntry = {
  /** Canonical global wildcard key from the document's nested mapping path. */
  key: string;
  hostKey: string;
  path: string[];
  line: number;
  column: number;
  values: StructuredValue[];
  childKeys: string[];
  refs: WildcardRef[];
  issues: Issue[];
};

export type StructuredDocument = {
  file: LibraryFile;
  entries: StructuredEntry[];
  rootKeys: string[];
  issues: Issue[];
};

type RangedNode = Node & { range?: [number, number, number?] };

function location(
  node: unknown,
  lineCounter: LineCounter,
): { line: number; column: number } {
  const offset = (node as RangedNode | null)?.range?.[0] ?? 0;
  const position = lineCounter.linePos(offset);
  return { line: position.line, column: position.col };
}

function scalarText(node: unknown): string | null {
  if (!isScalar(node)) return null;
  const value = node.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function parseValue(value: StructuredValue): {
  refs: WildcardRef[];
  issues: Issue[];
} {
  const parsedLines = value.text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((text, index) => {
      const parsed = parseLine(text, value.line + index);
      if (index === 0 && value.column > 1) {
        return {
          refs: parsed.refs.map((ref) => ({
            ...ref,
            column: ref.column + value.column - 1,
            endColumn: ref.endColumn + value.column - 1,
          })),
          issues: parsed.issues.map((issue) => ({
            ...issue,
            column: issue.column
              ? issue.column + value.column - 1
              : issue.column,
          })),
        };
      }
      return { refs: parsed.refs, issues: parsed.issues };
    });
  return {
    refs: parsedLines.flatMap((parsed) => parsed.refs),
    issues: parsedLines.flatMap((parsed) => parsed.issues),
  };
}

function errorLocation(error: {
  linePos?: Array<{ line: number; col: number }>;
}): { line?: number; column?: number } {
  const start = error.linePos?.[0];
  return start ? { line: start.line, column: start.col } : {};
}

function offsetLocation(
  text: string,
  offset: number,
): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, offset));
  const lines = before.split(/\r\n|\r|\n/);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

/** Parse one YAML/JSON file into addressable `host/path` wildcard entries. */
export function parseStructuredFile(file: LibraryFile): StructuredDocument {
  const issues: Issue[] = [];
  const lineCounter = new LineCounter();

  if (file.ext === '.json') {
    try {
      JSON.parse(file.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const offset = /position\s+(\d+)/i.exec(message)?.[1];
      const lineColumn = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message);
      const jsonLocation = lineColumn
        ? { line: Number(lineColumn[1]), column: Number(lineColumn[2]) }
        : offset
          ? offsetLocation(file.text, Number(offset))
          : { line: 1, column: 1 };
      issues.push({
        severity: 'error',
        code: 'structured_parse_error',
        message: `Invalid JSON: ${message}`,
        nodeId: file.key,
        ...jsonLocation,
      });
      return { file, entries: [], rootKeys: [], issues };
    }
  }

  const document = parseDocument(file.text, {
    lineCounter,
    prettyErrors: true,
    uniqueKeys: true,
  });
  for (const error of document.errors) {
    issues.push({
      severity: 'error',
      code: 'structured_parse_error',
      message: error.message,
      nodeId: file.key,
      ...errorLocation(error),
    });
  }
  for (const warning of document.warnings) {
    issues.push({
      severity: 'warning',
      code: 'structured_parse_error',
      message: warning.message,
      nodeId: file.key,
      ...errorLocation(warning),
    });
  }
  if (document.errors.length > 0 || !document.contents) {
    if (!document.contents && document.errors.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'empty_file',
        message: 'Structured file has no values',
        nodeId: file.key,
      });
    }
    return { file, entries: [], rootKeys: [], issues };
  }

  const entries: StructuredEntry[] = [];

  const walk = (node: unknown, path: string[], keyNode?: unknown): string[] => {
    const key = path.join('/');
    const at = location(keyNode ?? node, lineCounter);
    const values: StructuredValue[] = [];
    const childKeys: string[] = [];

    if (isMap(node)) {
      for (const pair of node.items) {
        const segment = scalarText(pair.key);
        if (segment === null || segment.length === 0 || segment.includes('/')) {
          const where = location(pair.key, lineCounter);
          issues.push({
            severity: 'error',
            code: 'unsupported_structured_value',
            message: 'Structured wildcard keys must be non-empty scalar values without `/`',
            nodeId: key,
            line: where.line,
            column: where.column,
          });
          continue;
        }
        childKeys.push(...walk(pair.value, [...path, segment], pair.key));
      }
    } else if (isSeq(node)) {
      for (const item of node.items) {
        const text = scalarText(item);
        if (text === null) {
          const where = location(item, lineCounter);
          issues.push({
            severity: 'error',
            code: 'unsupported_structured_value',
            message: `Structured wildcard list \`${key}\` may contain only scalar values`,
            nodeId: key,
            line: where.line,
            column: where.column,
          });
          continue;
        }
        const where = location(item, lineCounter);
        values.push({ text, line: where.line, column: where.column });
      }
    } else {
      const text = scalarText(node);
      if (text !== null) {
        values.push({ text, line: at.line, column: at.column });
      } else {
        issues.push({
          severity: 'error',
          code: 'unsupported_structured_value',
          message: `Structured wildcard \`${key}\` must be a scalar, list, or mapping`,
          nodeId: key,
          line: at.line,
          column: at.column,
        });
      }
    }

    const parsedValues = values.map(parseValue);
    const entryIssues = parsedValues.flatMap((parsed) =>
      parsed.issues.map((issue) => ({ ...issue, nodeId: key })),
    );
    issues.push(...entryIssues);
    const entry: StructuredEntry = {
      key,
      hostKey: file.key,
      path,
      line: at.line,
      column: at.column,
      values,
      childKeys,
      refs: parsedValues.flatMap((parsed) => parsed.refs),
      issues: entryIssues,
    };
    entries.push(entry);
    return [key];
  };

  if (!isMap(document.contents)) {
    const where = location(document.contents, lineCounter);
    issues.push({
      severity: 'error',
      code: 'unsupported_structured_value',
      message: 'A structured wildcard document must contain a top-level mapping',
      nodeId: file.key,
      line: where.line,
      column: where.column,
    });
    return { file, entries: [], rootKeys: [], issues };
  }

  const rootKeys: string[] = [];
  for (const pair of document.contents.items) {
    const segment = scalarText(pair.key);
    if (segment === null || segment.length === 0 || segment.includes('/')) {
      const where = location(pair.key, lineCounter);
      issues.push({
        severity: 'error',
        code: 'unsupported_structured_value',
        message: 'Structured wildcard keys must be non-empty scalar values without `/`',
        nodeId: file.key,
        line: where.line,
        column: where.column,
      });
      continue;
    }
    rootKeys.push(...walk(pair.value, [segment], pair.key));
  }
  return { file, entries, rootKeys, issues };
}

export function isStructuredFile(
  file: LibraryFile,
): file is LibraryFile & { ext: '.yaml' | '.yml' | '.json' } {
  return file.ext === '.yaml' || file.ext === '.yml' || file.ext === '.json';
}
