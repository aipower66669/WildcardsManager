export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCode =
  | 'missing_file'
  | 'cycle'
  | 'unclosed_wildcard'
  | 'unbalanced_brace'
  | 'unbalanced_paren'
  | 'unbalanced_bracket'
  | 'unbalanced_quote'
  | 'bad_multiselect'
  | 'orphan_pipe'
  | 'empty_file'
  | 'read_error'
  | 'glob_no_match'
  | 'structured_parse_error'
  | 'unsupported_structured_value'
  | 'duplicate_structured_key'
  | 'missing_lora'
  | 'invalid_lora'
  | 'unused_lora'
  | 'duplicate_lora_hash'
  | 'unsupported_wildcard_logic';

export type Issue = {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  nodeId?: string;
  line?: number;
  column?: number;
  snippet?: string;
  /** Extra navigable paths (e.g. other LoRAs sharing an AutoV2). */
  relatedPaths?: string[];
  /**
   * Suggested one-click fix. `extend_lora_series` = add missing training steps
   * to an existing `<lora:…>` pick list (Categorize button).
   */
  fixAction?: 'extend_lora_series';
};

export type WildcardRef = {
  name: string;
  line: number;
  column: number;
  endColumn: number;
  raw: string;
};

export type SyntaxIssue = Issue;

export type LineParseResult = {
  line: number;
  text: string;
  isComment: boolean;
  refs: WildcardRef[];
  issues: SyntaxIssue[];
};

export type FileParseResult = {
  relativeKey: string;
  absolutePath: string;
  lines: LineParseResult[];
  refs: WildcardRef[];
  issues: SyntaxIssue[];
};

export type ResolveKind = 'file' | 'yamlKey' | 'glob' | 'missing';

export type ResolveResult = {
  kind: ResolveKind;
  /** Canonical graph node id (relative key or missing:name). */
  id: string;
  label: string;
  absolutePath?: string;
  relativeKey?: string;
  /** Physical file key that owns this node (differs for nested structured keys). */
  hostKey?: string;
  /** For glob matches — child keys that expand. */
  matchedKeys?: string[];
  issues: Issue[];
};

export type GraphNode = {
  id: string;
  kind: ResolveKind | 'root';
  label: string;
  path?: string;
  relativeKey?: string;
  hostKey?: string;
  depth: number;
  lineCount?: number;
  outboundCount: number;
  inboundCount: number;
  issues: Issue[];
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  line: number;
  column?: number;
  snippet: string;
  isCycle: boolean;
};

export type LibraryFile = {
  relativePath: string;
  absolutePath: string;
  name: string;
  ext: '.txt' | '.yaml' | '.yml' | '.json';
  key: string;
  text: string;
  /** Disk size when loaded from a fingerprint cache hit/miss. */
  size?: number;
  /** Disk mtime (ms) when loaded from a fingerprint cache. */
  mtimeMs?: number;
};

export type AnalysisGraph = {
  rootNodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  issues: Issue[];
};
