import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Combine,
  Copy,
  CornerDownRight,
  Crosshair,
  Dices,
  Eraser,
  ExternalLink,
  FileDown,
  Eye,
  EyeOff,
  FileInput,
  FilePlus,
  Filter,
  FolderOpen,
  GitMerge,
  Library,
  ListPlus,
  Pencil,
  PieChart,
  RefreshCw,
  Redo2,
  Repeat,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  Tags,
  X,
} from 'lucide-react';
import {
  DAGRE_NODE_THRESHOLD,
  DEFAULT_MAX_LEVELS,
  GHOST_PREFIX,
  MINIMAP_NODE_THRESHOLD,
  WIDE_GRAPH_UNCAPPED_THRESHOLD,
  buildAdjacency,
  estimateUncappedVisibleCount,
  selectFocusedGraphSlice,
} from '../domain/graphView';
import {
  layoutCompactTree,
  treeChildrenFromParents,
} from '../domain/tidyTreeLayout';
import {
  DEFAULT_CONVERT_CHILD_SUFFIX,
  defaultConvertChildKey,
} from '../domain/convertToChild';
import {
  DEFAULT_CIVITAI_ORIGIN,
} from '../domain/civitaiSnippet';
import { siblingBalanceScores } from '../domain/simulateBalance';
import { mergeLibraryTextBuffers } from '../domain/libraryTextMerge';
import {
  applyLoraWildcardBufferOp,
  type LoraWildcardBufferOp,
} from '../domain/loraDownloadCategory';
import {
  graphRelationshipFingerprint,
  localWildcardSyntaxIssues,
  mergeLocalSyntaxIssues,
} from '../domain/parseRefs';
import type {
  AbsorbPreviewDto,
  AnalysisResultDto,
  ConsolidationPreviewDto,
  ConvertToChildPreviewDto,
  CycleFixPreviewDto,
  CycleFixSuggestionDto,
  ExpandMode,
  ExpandRequestDto,
  ExpandResultDto,
  FileContentDto,
  FileEntryDto,
  FileRefStatDto,
  GraphLayoutStyle,
  GraphNodeDto,
  HistoryStateDto,
  IssueDto,
  LibraryConfigDto,
  LibrarySwitchResultDto,
  GlobalSearchHitDto,
  GlobalSearchScopesDto,
  RenameLoraPreviewDto,
  RenamePreviewDto,
  PromptCoverageProgressDto,
  PromptCoverageReportDto,
  SimulateResultDto,
  CivitaiOriginDto,
  CivitaiFocusModelDto,
  BlockedCivitaiCreatorDto,
  LoraDownloadCategoryListDto,
  WildcardValidationReportDto,
  WorkspaceTabId,
  TabPanelWidthsDto,
} from '../shared/contracts';
import {
  DEFAULT_WORKSPACE_LIST_FILTERS,
  WORKSPACE_TAB_IDS,
} from '../shared/contracts';
import { usePersistedWorkspaceListFilter } from './usePersistedWorkspaceListFilter';
import { civitaiModelPageUrl } from '../domain/civitaiSnippet';
import {
  buildUnusedLoraLocalSnippet,
} from '../domain/loraSeries';
import {
  LORA_INDEX_STALE_ISSUE_MAX_AGE_MS,
  issueNeedsLoraIndexWatch,
  issueSuggestsStaleLoraIndex,
} from '../domain/lora';
import {
  WildcardEditor,
  type WildcardEditorHandle,
} from './WildcardEditor';
import { CivitaiBrowserModal } from './CivitaiBrowserModal';
import { ApplicationSettingsModal } from './ApplicationSettingsModal';
import { LmStudioPromptModal } from './LmStudioPromptModal';
import { LibraryManagerModal } from './LibraryManagerModal';
import { LoraFilesWorkspace } from './LoraFilesWorkspace';
import { CheckpointFilesWorkspace } from './CheckpointFilesWorkspace';
import { PromptsWorkspace } from './PromptsWorkspace';
import type { GenerationRunHandle } from './generationRun';
import { PromptCoverageModal } from './PromptCoverageModal';
import { GenerationWorkspace } from './GenerationWorkspace';
import { LoraDownloadCategoryManagerModal } from './LoraDownloadCategoryManagerModal';
import {
  DEFAULT_SEARCH_SCOPES,
  GlobalSearchLauncherModal,
  SearchWorkspace,
} from './SearchWorkspace';
import { modalOverlayDismiss } from './modalOverlayDismiss';

const WORKSPACE_TAB_TITLE: Record<WorkspaceTabId, string> = {
  prompts: 'Prompts Library',
  generation: 'Image Generation',
  wildcards: 'Wildcards file manager',
  loras: 'LoRAs file manager',
  checkpoints: 'Checkpoints file manager',
  search: 'Advanced Search',
};

const DEFAULT_TAB_PANEL_WIDTHS: Record<WorkspaceTabId, TabPanelWidthsDto> = {
  prompts: { filesPanelWidth: 240, detailsPanelWidth: 330 },
  generation: { filesPanelWidth: 240, detailsPanelWidth: 420 },
  wildcards: { filesPanelWidth: 240, detailsPanelWidth: 330 },
  loras: { filesPanelWidth: 240, detailsPanelWidth: 420 },
  checkpoints: { filesPanelWidth: 240, detailsPanelWidth: 420 },
  search: { filesPanelWidth: 240, detailsPanelWidth: 420 },
};

function clonePanelWidthsByTab(
  source: Record<WorkspaceTabId, TabPanelWidthsDto>,
): Record<WorkspaceTabId, TabPanelWidthsDto> {
  const out = {} as Record<WorkspaceTabId, TabPanelWidthsDto>;
  for (const tab of WORKSPACE_TAB_IDS) {
    out[tab] = { ...source[tab] };
  }
  return out;
}

type RefStat = {
  inbound: number;
  outbound: number;
  issueCount: number;
  loraTagCount: number;
};
type FileContextMenu = {
  file: FileEntryDto;
  x: number;
  y: number;
};
type GraphNodeContextMenu = {
  nodeId: string;
  x: number;
  y: number;
};

function fileEntryForGraphNode(
  node: GraphNodeDto,
  fileList: FileEntryDto[],
): FileEntryDto | null {
  const key = node.hostKey ?? node.relativeKey;
  if (!key) return null;
  return fileList.find((f) => f.key === key) ?? null;
}

/** Same gate as the Details → Manage toolbar (file-level wildcard). */
function isManageableGraphNode(
  node: GraphNodeDto,
  entry: FileEntryDto | null,
): boolean {
  return Boolean(entry && node.relativeKey === entry.key);
}
type LiveValidation = {
  relativePath: string;
  issues: IssueDto[];
  pending: boolean;
};
type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';
type AutosaveDraft = {
  relativePath: string;
  text: string;
  savedText: string;
  sessionId: string;
  timer: number | null;
  saving: Promise<void> | null;
};
type FlushDraftOptions = {
  /**
   * Reserved for callers that previously forced a graph rebuild.
   * Graph refresh after save is driven by outgoing-ref fingerprint changes.
   */
  rebuild?: boolean;
};

/** Keep typing snappy — avoid full-app work on every keystroke. */
const AUTOSAVE_DEBOUNCE_MS = 2_000;
const LIVE_VALIDATE_DEBOUNCE_MS = 1_200;
/** Local brace/variant parse — in-memory, no IPC. */
const LOCAL_SYNTAX_DEBOUNCE_MS = 80;

type FlowNodeData = Record<string, unknown> & {
  label: string;
  kind: GraphNodeDto['kind'];
  issueCount: number;
  isCaller?: boolean;
};

function formatSharePct(share: number): string {
  const pct = share * 100;
  if (pct >= 99.5) return '100%';
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(0)}%`;
}

/** Smooth red (0) → yellow (0.5) → green (1) gradient for sibling-balance scores. */
function balanceColor(score: number): { bg: string; border: string; text: string } {
  const t = Math.max(0, Math.min(1, score));
  const lerp = (a: number, b: number, x: number) => Math.round(a + (b - a) * x);
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.5) {
    const x = t / 0.5;
    r = lerp(0xe5, 0xf5, x);
    g = lerp(0x48, 0xc5, x);
    b = lerp(0x4d, 0x18, x);
  } else {
    const x = (t - 0.5) / 0.5;
    r = lerp(0xf5, 0x30, x);
    g = lerp(0xc5, 0xa4, x);
    b = lerp(0x18, 0x6c, x);
  }
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const text = luminance > 0.6 ? '#141414' : '#ffffff';
  return {
    bg: `rgb(${r}, ${g}, ${b})`,
    border: `rgb(${lerp(r, 0, 0.25)}, ${lerp(g, 0, 0.25)}, ${lerp(b, 0, 0.25)})`,
    text,
  };
}

const FLOW_NODE_WIDTH = 180;
const FLOW_NODE_HEIGHT = 42;
const FLOW_GHOST_WIDTH = 92;
const FLOW_GHOST_HEIGHT = 30;
const DEFAULT_DETAILS_WIDTH = 330;
const MIN_DETAILS_WIDTH = 240;
const DEFAULT_FILES_WIDTH = 240;
const MIN_FILES_WIDTH = 180;
const MAX_FILES_WIDTH = 520;
const GRAPH_MIN_WIDTH = 360;
const SPLITTER_WIDTH = 7;

function clampFilesWidth(width: number, detailsWidth: number): number {
  const available =
    window.innerWidth - detailsWidth - GRAPH_MIN_WIDTH - SPLITTER_WIDTH * 2;
  const max = Math.max(
    MIN_FILES_WIDTH,
    Math.min(MAX_FILES_WIDTH, available),
  );
  return Math.max(MIN_FILES_WIDTH, Math.min(max, Math.round(width)));
}

/** Right panel may grow freely; only the graph’s minimum width is reserved. */
function maxDetailsWidth(filesWidth: number): number {
  return Math.max(
    MIN_DETAILS_WIDTH,
    window.innerWidth - filesWidth - GRAPH_MIN_WIDTH - SPLITTER_WIDTH * 2,
  );
}

function clampDetailsWidth(width: number, filesWidth: number): number {
  const max = maxDetailsWidth(filesWidth);
  return Math.max(MIN_DETAILS_WIDTH, Math.min(max, Math.round(width)));
}

type GraphView = {
  focusId: string;
  focusLabel: string;
  maxLevels: number;
  visibleCount: number;
  truncatedCount: number;
  hasAncestors: boolean;
  breadthLimited: boolean;
  depthLimited: boolean;
  usedDagre: boolean;
};

function flowElements(
  analysis: AnalysisResultDto,
  opts?: {
    /** parentKey\0childKey → share of parent selections. */
    parentShareByPair?: Map<string, number>;
    /** Node-id → sibling-balance score in [0, 1]. Used for colours. */
    balanceById?: Map<string, number>;
    focusId?: string;
    maxLevels?: number;
    layoutStyle?: GraphLayoutStyle;
  },
): {
  nodes: Array<Node<FlowNodeData>>;
  edges: Edge[];
  view: GraphView;
} {
  const parentShareByPair = opts?.parentShareByPair;
  const balanceById = opts?.balanceById;
  const maxLevels = opts?.maxLevels ?? DEFAULT_MAX_LEVELS;
  const layoutStyle = opts?.layoutStyle ?? 'optimized';
  const nodeById = new Map(analysis.nodes.map((n) => [n.id, n] as const));
  const keyOf = (id: string) => nodeById.get(id)?.relativeKey ?? id;
  const focusId =
    opts?.focusId && nodeById.has(opts.focusId)
      ? opts.focusId
      : analysis.rootNodeId;

  const adjacency = buildAdjacency(analysis.edges);
  const slice = selectFocusedGraphSlice(adjacency, {
    focusId,
    maxLevels,
    labelOf: (id) => nodeById.get(id)?.label ?? id,
  });
  const {
    ancLevel,
    descLevel,
    treeParent,
    visibleIds,
    truncated,
    breadthLimited,
    depthLimited,
    hasAncestors,
  } = slice;

  const pushTo = <K,>(map: Map<K, string[]>, key: K, value: string) => {
    const arr = map.get(key);
    if (arr) arr.push(value);
    else map.set(key, [value]);
  };

  const levelOf = (id: string): number =>
    descLevel.has(id) ? descLevel.get(id)! : -(ancLevel.get(id) ?? 0);
  const visibleEdgeDirection = (
    edge: AnalysisResultDto['edges'][number],
  ): { isDesc: boolean; isAnc: boolean } | null => {
    if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) return null;
    const df = descLevel.get(edge.from);
    const dt = descLevel.get(edge.to);
    const af = ancLevel.get(edge.from);
    const at = ancLevel.get(edge.to);
    const isDesc = df !== undefined && dt !== undefined && dt === df + 1;
    const isAnc = af !== undefined && at !== undefined && af === at + 1;
    return isDesc || isAnc || edge.isCycle ? { isDesc, isAnc } : null;
  };

  const colorable = new Set<GraphNodeDto['kind']>(['file', 'yamlKey', 'root']);
  const byLevel = new Map<number, string[]>();
  for (const id of visibleIds) pushTo(byLevel, levelOf(id), id);

  const nodes: Array<Node<FlowNodeData>> = [];
  const position = new Map<string, { x: number; y: number }>();
  for (const [lvl, ids] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    ids.sort((a, b) =>
      (nodeById.get(a)?.label ?? '').localeCompare(nodeById.get(b)?.label ?? ''),
    );
    const totalWidth = Math.max(1, ids.length - 1) * 240;
    ids.forEach((id, index) => {
      const node = nodeById.get(id)!;
      const x = index * 240 - totalWidth / 2;
      const y = lvl * 150;
      position.set(id, { x, y });

      const hasSim =
        Boolean(parentShareByPair) &&
        colorable.has(node.kind) &&
        !node.isCaller;
      const parentId = treeParent.get(id);
      const parentShare =
        hasSim && parentId && id !== analysis.rootNodeId
          ? (parentShareByPair!.get(`${keyOf(parentId)}\0${keyOf(id)}`) ?? 0)
          : undefined;
      const balance =
        hasSim && balanceById ? (balanceById.get(id) ?? (parentId ? 0 : 1)) : undefined;
      const style =
        balance === undefined
          ? undefined
          : (() => {
              const c = balanceColor(balance);
              return {
                ['--sim-bg' as string]: c.bg,
                ['--sim-border' as string]: c.border,
                ['--sim-text' as string]: c.text,
              };
            })();
      // No % on the top of the view (no parent) — it's always the reference.
      const label =
        parentShare === undefined
          ? node.isCaller
            ? `↑ ${node.label}`
            : node.label
          : `${node.label}  ·  ${formatSharePct(parentShare)}`;

      nodes.push({
        id: node.id,
        position: { x, y },
        width: FLOW_NODE_WIDTH,
        height: FLOW_NODE_HEIGHT,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        data: {
          label,
          kind: node.kind,
          issueCount: node.issues.length,
          isCaller: node.isCaller,
        },
        style,
        className: [
          'graph-node',
          `kind-${node.kind}`,
          node.issues.length ? 'has-issues' : '',
          balance !== undefined ? 'sim-node' : '',
          node.isCaller ? 'caller-node' : '',
          id === focusId ? 'focus-node' : '',
          levelOf(id) < 0 ? 'ancestor-node' : '',
          truncated.has(id) ? 'truncated-node' : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
    });
  }

  const useDagre =
    layoutStyle === 'optimized' && visibleIds.size < DAGRE_NODE_THRESHOLD;
  const useTidy =
    layoutStyle === 'compact' && visibleIds.size < DAGRE_NODE_THRESHOLD;

  if (useDagre) {
    // Original Dagre settings — do not tune here; iterate on `compact` instead.
    const graph = new dagre.graphlib.Graph()
      .setDefaultEdgeLabel(() => ({}))
      .setGraph({
        rankdir: 'TB',
        ranker: 'network-simplex',
        acyclicer: 'greedy',
        nodesep: 48,
        edgesep: 24,
        ranksep: 82,
        marginx: 24,
        marginy: 24,
      });
    const dimensions = new Map<string, { width: number; height: number }>();
    const nodeDimensions = (id: string) => {
      const labelLength = nodeById.get(id)?.label.length ?? 12;
      return {
        width: Math.max(160, Math.min(280, 54 + labelLength * 7)),
        height: FLOW_NODE_HEIGHT,
      };
    };

    for (const id of [...visibleIds].sort()) {
      const size = nodeDimensions(id);
      dimensions.set(id, size);
      graph.setNode(id, size);
    }
    for (const id of [...truncated.keys()].sort()) {
      const ghostId = `${GHOST_PREFIX}${id}`;
      const size = { width: FLOW_GHOST_WIDTH, height: FLOW_GHOST_HEIGHT };
      dimensions.set(ghostId, size);
      graph.setNode(ghostId, size);
      graph.setEdge(id, ghostId);
    }
    for (const edge of analysis.edges) {
      if (visibleEdgeDirection(edge)) graph.setEdge(edge.from, edge.to);
    }

    dagre.layout(graph);
    for (const id of graph.nodes()) {
      const laidOut = graph.node(id);
      const size = dimensions.get(id);
      if (!laidOut || !size) continue;
      position.set(id, {
        x: laidOut.x - size.width / 2,
        y: laidOut.y - size.height / 2,
      });
    }
    for (const node of nodes) {
      const laidOut = position.get(node.id);
      if (laidOut) {
        node.position = laidOut;
        const size = dimensions.get(node.id);
        if (size) {
          node.width = size.width;
          node.height = size.height;
        }
      }
    }
  } else if (useTidy) {
    const RANK_SEP = 64;
    const NODE_SEP = 24;
    const dimensions = new Map<string, { width: number; height: number }>();
    const nodeDimensions = (id: string) => {
      if (id.startsWith(GHOST_PREFIX)) {
        return { width: FLOW_GHOST_WIDTH, height: FLOW_GHOST_HEIGHT };
      }
      const labelLength = nodeById.get(id)?.label.length ?? 12;
      return {
        width: Math.max(160, Math.min(280, 54 + labelLength * 7)),
        height: FLOW_NODE_HEIGHT,
      };
    };

    for (const id of visibleIds) {
      dimensions.set(id, nodeDimensions(id));
    }
    for (const id of truncated.keys()) {
      const ghostId = `${GHOST_PREFIX}${id}`;
      dimensions.set(ghostId, nodeDimensions(ghostId));
    }

    const treeChildren = treeChildrenFromParents(
      treeParent,
      visibleIds,
      (id) => nodeById.get(id)?.label ?? id,
    );
    for (const id of truncated.keys()) {
      const ghostId = `${GHOST_PREFIX}${id}`;
      const siblings = treeChildren.get(id) ?? [];
      siblings.push(ghostId);
      treeChildren.set(id, siblings);
    }

    const compactPositions = layoutCompactTree({
      rootId: focusId,
      children: treeChildren,
      nodeSize: (id) => dimensions.get(id) ?? nodeDimensions(id),
      nodeSep: NODE_SEP,
      rankSep: RANK_SEP,
    });
    for (const [id, p] of compactPositions) {
      position.set(id, p);
    }

    // Stack ancestors in a vertical chain above the focus (centered on it).
    let below = focusId;
    let guard = 0;
    while (treeParent.has(below) && guard++ < 64) {
      const ancestor = treeParent.get(below)!;
      if (!visibleIds.has(ancestor) || compactPositions.has(ancestor)) break;
      const childPos = position.get(below);
      const childSize = dimensions.get(below);
      const ancestorSize = dimensions.get(ancestor) ?? nodeDimensions(ancestor);
      if (!childPos || !childSize) break;
      position.set(ancestor, {
        x: childPos.x + childSize.width / 2 - ancestorSize.width / 2,
        y: childPos.y - ancestorSize.height - RANK_SEP,
      });
      below = ancestor;
    }

    let minX = Infinity;
    let minY = Infinity;
    for (const p of position.values()) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
    }
    if (Number.isFinite(minX) && Number.isFinite(minY)) {
      for (const [id, p] of position) {
        position.set(id, { x: p.x - minX, y: p.y - minY });
      }
    }

    for (const node of nodes) {
      const laidOut = position.get(node.id);
      if (laidOut) {
        node.position = laidOut;
        const size = dimensions.get(node.id);
        if (size) {
          node.width = size.width;
          node.height = size.height;
        }
      }
    }
  }

  // Ghost "+N more" markers under truncated frontier nodes.
  for (const [id, count] of truncated) {
    const p = position.get(id);
    if (!p) continue;
    const node = nodeById.get(id)!;
    const ghostId = `${GHOST_PREFIX}${id}`;
    const ghostPosition =
      position.get(ghostId) ?? { x: p.x, y: p.y + 150 };
    nodes.push({
      id: ghostId,
      position: ghostPosition,
      width: FLOW_GHOST_WIDTH,
      height: FLOW_GHOST_HEIGHT,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: { label: `+${count} more`, kind: node.kind, issueCount: 0 },
      className: 'graph-node ghost-node',
    });
  }

  const edges: Edge[] = [];
  for (const edge of analysis.edges) {
    const direction = visibleEdgeDirection(edge);
    if (!direction) continue;
    const { isDesc, isAnc } = direction;
    edges.push({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      data: { tip: `${edge.snippet} on line ${edge.line}` },
      // Never use React Flow `animated` — it drives a continuous stroke-dash
      // CSS animation that keeps large graphs repainting / feeling sluggish.
      animated: false,
      className: [
        edge.isCycle ? 'cycle-edge' : '',
        isAnc && !isDesc ? 'ancestor-edge' : '',
      ]
        .filter(Boolean)
        .join(' '),
      markerEnd: edge.isCycle
        ? { type: MarkerType.ArrowClosed, color: '#ff5f6d' }
        : { type: MarkerType.ArrowClosed },
      zIndex: edge.isCycle ? 2 : undefined,
    });
  }

  for (const id of truncated.keys()) {
    edges.push({
      id: `e-more-${id}`,
      source: id,
      target: `${GHOST_PREFIX}${id}`,
      className: 'truncated-edge',
      markerEnd: { type: MarkerType.ArrowClosed },
    });
  }

  const focusNode = nodeById.get(focusId);
  return {
    nodes,
    edges,
    view: {
      focusId,
      focusLabel: focusNode?.label ?? focusId,
      maxLevels,
      visibleCount: visibleIds.size,
      truncatedCount: truncated.size,
      hasAncestors,
      breadthLimited,
      depthLimited,
      usedDagre: useDagre,
    },
  };
}

type ExpandTarget =
  | { kind: 'wildcard'; relativePath: string }
  | { kind: 'gen-file'; relativeFolder: string; content?: string }
  | {
      kind: 'generation';
      promptSource: 'text' | 'folder';
      promptText: string;
      relativeFolder: string | null;
      promptFoldersRecursive: boolean;
      additionalPositivePrompt: string;
      seed: number;
      checkpoint: string;
    };

export function App() {
  const [root, setRoot] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntryDto[]>([]);
  const [wildcardKeys, setWildcardKeys] = useState<string[]>([]);
  const [refStats, setRefStats] = useState<Map<string, RefStat>>(new Map());
  const { filter, setFilter, filterMode, setFilterMode } =
    usePersistedWorkspaceListFilter('wildcards');
  const [validationReport, setValidationReport] =
    useState<WildcardValidationReportDto | null>(null);
  const [validationBusy, setValidationBusy] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTabId>('wildcards');
  const workspaceTabRef = useRef<WorkspaceTabId>('wildcards');
  workspaceTabRef.current = workspaceTab;
  const panelWidthsByTabRef = useRef(
    clonePanelWidthsByTab(DEFAULT_TAB_PANEL_WIDTHS),
  );
  const [promptsSelectedFolder, setPromptsSelectedFolder] = useState<
    string | null
  >(null);
  const [generationSelectedFolder, setGenerationSelectedFolder] = useState<
    string | null
  >(null);
  const [generationFolderPick, setGenerationFolderPick] = useState<{
    folder: string;
    nonce: number;
  } | null>(null);
  const generationRunRef = useRef<GenerationRunHandle | null>(null);
  const [loraTabSelectPath, setLoraTabSelectPath] = useState<string | null>(
    null,
  );
  const [checkpointTabSelectPath, setCheckpointTabSelectPath] = useState<
    string | null
  >(null);
  /** Keep workspaces mounted after first visit so tab switches don’t wipe UI. */
  const [promptsTabMounted, setPromptsTabMounted] = useState(false);
  const [generationTabMounted, setGenerationTabMounted] = useState(false);
  const useFolderForGeneration = useCallback(
    (folder: string) => {
      const relativeFolder = folder.trim().replaceAll('\\', '/');
      if (!relativeFolder) return;
      setGenerationSelectedFolder(relativeFolder);
      setGenerationFolderPick({ folder: relativeFolder, nonce: Date.now() });
      if (!generationTabMounted) {
        void window.wcm.comfy.setGenerationForm({
          relativeFolder,
          promptSource: 'folder',
        });
      }
    },
    [generationTabMounted],
  );
  const [searchTabMounted, setSearchTabMounted] = useState(false);
  const [lorasTabMounted, setLorasTabMounted] = useState(false);
  const [checkpointsTabMounted, setCheckpointsTabMounted] = useState(false);
  const [modelPopulateStatus, setModelPopulateStatus] = useState<string | null>(
    null,
  );
  const [recent, setRecent] = useState<string[]>([]);
  const [libraries, setLibraries] = useState<LibraryConfigDto[]>([]);
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null);
  const [activeLibraryName, setActiveLibraryName] = useState<string | null>(
    null,
  );
  const [libraryManagerOpen, setLibraryManagerOpen] = useState(false);
  const [loraCategoryManager, setLoraCategoryManager] = useState<{
    open: boolean;
    focusWildcardPath?: string | null;
  }>({ open: false });
  const [loraDownloadCategories, setLoraDownloadCategories] =
    useState<LoraDownloadCategoryListDto | null>(null);
  const [openLibraryMenu, setOpenLibraryMenu] = useState(false);
  const openLibraryMenuRef = useRef<HTMLDivElement | null>(null);
  const [rootFile, setRootFile] = useState<string | null>(null);
  const rootFileRef = useRef<string | null>(null);
  rootFileRef.current = rootFile;
  const [analysis, setAnalysis] = useState<AnalysisResultDto | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContentDto | null>(null);
  const [busy, setBusy] = useState(false);
  /** Specific status-bar text while `busy` — never a generic “Working…”. */
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  /** Named main-process job (folder scan, etc.) — never “Working…”. */
  const [mainActivity, setMainActivity] = useState<string | null>(null);
  /** After Rebuild, LoRA/Checkpoint tabs reload from a forced folder rescan. */
  const [modelFolderEpoch, setModelFolderEpoch] = useState(0);
  const [issuesRefreshing, setIssuesRefreshing] = useState(false);
  const issuesRefreshingRef = useRef(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [consolidateTarget, setConsolidateTarget] = useState<string | null>(null);
  const [absorbTarget, setAbsorbTarget] = useState<string | null>(null);
  const [convertChildTarget, setConvertChildTarget] = useState<string | null>(
    null,
  );
  const [history, setHistory] = useState<HistoryStateDto>({
    canUndo: false,
    canRedo: false,
  });
  const [editText, setEditText] = useState('');
  const [validationText, setValidationText] = useState('');
  const [liveValidation, setLiveValidation] =
    useState<LiveValidation | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const autosaveDraftRef = useRef<AutosaveDraft | null>(null);
  const editTextRef = useRef('');
  const validationTimerRef = useRef<number | null>(null);
  const localSyntaxTimerRef = useRef<number | null>(null);
  const validatedSnapshotRef = useRef<{ path: string; text: string } | null>(
    null,
  );
  const flushDraftRef = useRef<
    (options?: FlushDraftOptions) => Promise<void>
  >(async () => {});
  const editorRef = useRef<WildcardEditorHandle | null>(null);
  const pendingJumpRef = useRef<{
    line: number;
    column?: number;
    /** Prefer jumping once this node (or its file key) is selected. */
    nodeId?: string;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameLoraTarget, setRenameLoraTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [lmStudioPromptOpen, setLmStudioPromptOpen] = useState(false);
  const [cleanupMissingTarget, setCleanupMissingTarget] = useState<string | null>(
    null,
  );
  const [cycleIssue, setCycleIssue] = useState<IssueDto | null>(null);
  const [ignoreLoraIssue, setIgnoreLoraIssue] = useState<IssueDto | null>(null);
  const [categorizeLoraIssue, setCategorizeLoraIssue] =
    useState<IssueDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  /** When set, Create File also inserts `__child__` into this parent. */
  const [createDescendantParent, setCreateDescendantParent] = useState<
    string | null
  >(null);
  const [createInitialPath, setCreateInitialPath] = useState('');
  const [expandTarget, setExpandTarget] = useState<ExpandTarget | null>(null);
  const promptsGenRef = useRef<{
    relativeFolder: string | null;
    content: string;
  } | null>(null);
  const generationExpandRef = useRef<Extract<
    ExpandTarget,
    { kind: 'generation' }
  > | null>(null);
  const [simSettingsOpen, setSimSettingsOpen] = useState(false);
  const [globalSearchLauncherOpen, setGlobalSearchLauncherOpen] =
    useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchScopes, setGlobalSearchScopes] =
    useState<GlobalSearchScopesDto>(DEFAULT_SEARCH_SCOPES);
  const [searchRefreshNonce, setSearchRefreshNonce] = useState(0);
  const [civitaiOpen, setCivitaiOpen] = useState(false);
  const [civitaiFocusModel, setCivitaiFocusModel] =
    useState<CivitaiFocusModelDto | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [simExportBusy, setSimExportBusy] = useState(false);
  const [simSettings, setSimSettings] = useState({
    iterations: 10_000,
    seed: 1,
  });
  const [graphLayoutStyle, setGraphLayoutStyle] =
    useState<GraphLayoutStyle>('optimized');
  const [convertChildSuffix, setConvertChildSuffix] = useState(
    DEFAULT_CONVERT_CHILD_SUFFIX,
  );
  const [simResult, setSimResult] = useState<SimulateResultDto | null>(null);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [coverageProgress, setCoverageProgress] =
    useState<PromptCoverageProgressDto | null>(null);
  const [coverageReport, setCoverageReport] =
    useState<PromptCoverageReportDto | null>(null);
  const [coverageStarting, setCoverageStarting] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  /** Soft depth for wide roots; drilling restores DEFAULT_MAX_LEVELS. */
  const [graphMaxLevels, setGraphMaxLevels] = useState(DEFAULT_MAX_LEVELS);
  const [detailsWidth, setDetailsWidth] = useState(DEFAULT_DETAILS_WIDTH);
  const [filesWidth, setFilesWidth] = useState(DEFAULT_FILES_WIDTH);
  const [resizingDetails, setResizingDetails] = useState(false);
  const [resizingFiles, setResizingFiles] = useState(false);
  const detailsResizeStart = useRef({ x: 0, width: DEFAULT_DETAILS_WIDTH });
  const filesResizeStart = useRef({ x: 0, width: DEFAULT_FILES_WIDTH });
  const liveDetailsWidth = useRef(DEFAULT_DETAILS_WIDTH);
  const liveFilesWidth = useRef(DEFAULT_FILES_WIDTH);
  const shouldFitViewRef = useRef(true);
  const pendingCenterNodeRef = useRef<string | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<Node<FlowNodeData>, Edge> | null>(
    null,
  );
  const [fileContextMenu, setFileContextMenu] =
    useState<FileContextMenu | null>(null);
  const fileContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [graphNodeContextMenu, setGraphNodeContextMenu] =
    useState<GraphNodeContextMenu | null>(null);
  const graphNodeContextMenuRef = useRef<HTMLDivElement | null>(null);

  const loadRefStats = useCallback(async () => {
    try {
      const stats: FileRefStatDto[] = await window.wcm.library.refStats();
      setRefStats(
        new Map(
          stats.map((s) => [
            s.key,
            {
              inbound: s.inbound,
              outbound: s.outbound,
              issueCount: s.issueCount,
              loraTagCount: s.loraTagCount,
            },
          ]),
        ),
      );
    } catch {
      setRefStats(new Map());
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await window.wcm.history.state());
    } catch {
      setHistory({ canUndo: false, canRedo: false });
    }
  }, []);

  const flashNotice = useCallback((message: string) => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, 6000);
  }, []);

  /** Drop / update one file in the “Files with issues” list without a full rescan. */
  const patchValidationFile = useCallback(
    (relativePath: string, issues: IssueDto[]) => {
      setValidationReport((prev) => {
        if (!prev) return prev;
        const entry = files.find((f) => f.relativePath === relativePath);
        const key = entry?.key ?? relativePath.replace(/\.[^.]+$/, '');
        let errorCount = 0;
        let warningCount = 0;
        for (const issue of issues) {
          if (issue.severity === 'error') errorCount += 1;
          else if (issue.severity === 'warning') warningCount += 1;
        }
        const without = prev.files.filter((f) => f.key !== key);
        const nextFiles =
          errorCount > 0 || warningCount > 0
            ? [
                ...without,
                {
                  relativePath,
                  key,
                  errorCount,
                  warningCount,
                  issues,
                },
              ].sort((a, b) => {
                if (b.errorCount !== a.errorCount) {
                  return b.errorCount - a.errorCount;
                }
                if (b.warningCount !== a.warningCount) {
                  return b.warningCount - a.warningCount;
                }
                return a.relativePath.localeCompare(b.relativePath);
              })
            : without;
        let totalErrors = 0;
        let totalWarnings = 0;
        for (const row of nextFiles) {
          totalErrors += row.errorCount;
          totalWarnings += row.warningCount;
        }
        return {
          ...prev,
          files: nextFiles,
          filesWithIssues: nextFiles.length,
          errorCount: totalErrors,
          warningCount: totalWarnings,
        };
      });
    },
    [files],
  );

  // “Files with issues” — scan when the filter is selected (fast enough live).
  useEffect(() => {
    if (filterMode !== 'errors' || !root) return;
    let cancelled = false;
    setValidationBusy(true);
    void window.wcm.analyze
      .validateAll()
      .then((report) => {
        if (!cancelled) setValidationReport(report);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setValidationBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filterMode, root, activeLibraryId]);

  useEffect(() => {
    setPromptsTabMounted(false);
    setGenerationTabMounted(false);
    setSearchTabMounted(false);
    setLorasTabMounted(false);
    setCheckpointsTabMounted(false);
  }, [activeLibraryId]);

  // Mount the active tab (and deep-link targets) immediately.
  useEffect(() => {
    if (workspaceTab === 'prompts') setPromptsTabMounted(true);
    if (workspaceTab === 'generation') setGenerationTabMounted(true);
    if (workspaceTab === 'search') setSearchTabMounted(true);
    if (workspaceTab === 'loras' || loraTabSelectPath) setLorasTabMounted(true);
    if (workspaceTab === 'checkpoints' || checkpointTabSelectPath) {
      setCheckpointsTabMounted(true);
    }
  }, [workspaceTab, loraTabSelectPath, checkpointTabSelectPath]);

  // Keep-alive after the user visits a tab (effect above). Do not pre-mount
  // LoRA/checkpoint lists at startup — that walked/hashed the library and
  // froze the UI for minutes.

  useEffect(() => {
    return window.wcm.ui.onMainActivity((activity) => {
      setMainActivity(activity.label);
    });
  }, []);

  // TEMPORARY LoRA/Checkpoint populate + hash-warm progress → main status bar.
  useEffect(() => {
    if (workspaceTab !== 'loras' && workspaceTab !== 'checkpoints') {
      setModelPopulateStatus(null);
      return;
    }
    const kind = workspaceTab === 'loras' ? 'LORA' : 'Checkpoint';
    const noun = kind === 'LORA' ? 'LoRA' : 'Checkpoint';
    let clearTimer: number | undefined;
    /** While hashing, populate status must not overwrite the hash line. */
    let hashingActive = false;
    const unsubPopulate = window.wcm.modelFiles.onPopulateProgress((progress) => {
      if (progress.kind !== kind) return;
      if (hashingActive) return;
      if (clearTimer) window.clearTimeout(clearTimer);
      if (progress.status === 'running') {
        const phaseLabel =
          progress.phase === 'fetching'
            ? `Looking up unmatched ${noun}s…`
            : `Matching ${noun}s to catalog…`;
        setModelPopulateStatus(
          `${phaseLabel} ${progress.done.toLocaleString()}/${progress.total.toLocaleString()}` +
            ` · ${progress.matched.toLocaleString()} matched` +
            (progress.fetchedMatch > 0
              ? ` · +${progress.fetchedMatch.toLocaleString()} via API`
              : '') +
            (progress.failed > 0
              ? ` · ${progress.failed.toLocaleString()} not in catalog`
              : '') +
            (progress.queuedPreviews > 0
              ? ` · ${progress.queuedPreviews.toLocaleString()} previews queued`
              : '') +
            (progress.skippedNoHash > 0
              ? ` · ${progress.skippedNoHash.toLocaleString()} awaiting hash`
              : '') +
            (progress.currentStem ? ` · ${progress.currentStem}` : ''),
        );
        return;
      }
      if (progress.status === 'done') {
        setModelPopulateStatus(
          `${noun} match done · ${progress.matched.toLocaleString()} matched` +
            (progress.fetchedMatch > 0
              ? ` · +${progress.fetchedMatch.toLocaleString()} version hashes saved`
              : '') +
            (progress.failed > 0
              ? ` · ${progress.failed.toLocaleString()} not in catalog`
              : '') +
            (progress.queuedPreviews > 0
              ? ` · ${progress.queuedPreviews.toLocaleString()} previews queued`
              : '') +
            (progress.skippedNoHash > 0
              ? ` · ${progress.skippedNoHash.toLocaleString()} awaiting hash`
              : ''),
        );
        clearTimer = window.setTimeout(() => setModelPopulateStatus(null), 8000);
        return;
      }
      if (progress.status === 'cancelled') {
        setModelPopulateStatus(`${noun} populate cancelled`);
        clearTimer = window.setTimeout(() => setModelPopulateStatus(null), 4000);
        return;
      }
      if (progress.status === 'error') {
        setError(progress.error ?? `${noun} populate failed`);
        setModelPopulateStatus(null);
      }
    });
    const unsubHash = window.wcm.civitai.onHashWarmProgress((progress) => {
      if (progress.kind !== kind) return;
      if (clearTimer) window.clearTimeout(clearTimer);
      if (progress.status === 'hashing') {
        hashingActive = true;
        const missing = progress.missing ?? 0;
        setModelPopulateStatus(
          `Hashing ${noun}s… ${progress.done.toLocaleString()}/${progress.total.toLocaleString()}` +
            (missing > 0 ? ` · ${missing.toLocaleString()} left` : '') +
            (progress.hashedThisRun > 0
              ? ` · ${progress.hashedThisRun.toLocaleString()} new`
              : '') +
            (progress.currentStem ? ` · ${progress.currentStem}` : ''),
        );
        return;
      }
      if (progress.status === 'done') {
        hashingActive = false;
        const missing = progress.missing ?? 0;
        setModelPopulateStatus(
          missing > 0
            ? `${noun} hashing paused · ${missing.toLocaleString()} still awaiting hash (will retry)`
            : progress.hashedThisRun > 0
              ? `${noun} hashing done · ${progress.hashedThisRun.toLocaleString()} new hashes saved`
              : `${noun} hashes ready · ${progress.cachedTotal.toLocaleString()} cached`,
        );
        // Version-hash enrich needs local AutoV2 anchors — retry after warm.
        void window.wcm.civitai.startVersionHashEnrich({ force: true });
        clearTimer = window.setTimeout(() => setModelPopulateStatus(null), 6000);
        return;
      }
      if (progress.status === 'error') {
        hashingActive = false;
        setError(progress.error ?? `${noun} hashing failed`);
        setModelPopulateStatus(null);
      }
    });
    // Match whatever hashes we already have; hash warm (from list) rematches
    // again when new AutoV2 values are saved. Version-hash enrich expands
    // older versions for library-matched cards only (not the whole catalog).
    void window.wcm.civitai.startVersionHashEnrich();
    void window.wcm.modelFiles.startPopulate({ kind });
    const unsubEnrich = window.wcm.civitai.onCatalogVersionHashEnrichProgress(
      (progress) => {
        if (hashingActive) return;
        if (clearTimer) window.clearTimeout(clearTimer);
        if (progress.status === 'running') {
          setModelPopulateStatus(
            `Expanding library version hashes… ${progress.done.toLocaleString()}/${progress.total.toLocaleString()}` +
              (progress.patchedThisRun > 0
                ? ` · ${progress.patchedThisRun.toLocaleString()} updated`
                : '') +
              (progress.currentName ? ` · ${progress.currentName}` : ''),
          );
          return;
        }
        if (progress.status === 'done') {
          if (progress.patchedThisRun > 0) {
            void window.wcm.modelFiles.startPopulate({ kind, force: true });
          }
          setModelPopulateStatus(
            progress.total === 0
              ? null
              : `Library version hashes expanded · ${progress.patchedThisRun.toLocaleString()} cards`,
          );
          if (progress.total > 0) {
            clearTimer = window.setTimeout(
              () => setModelPopulateStatus(null),
              6000,
            );
          }
          return;
        }
        if (progress.status === 'error') {
          setError(progress.error ?? 'Catalog version-hash enrich failed');
        }
      },
    );
    return () => {
      unsubPopulate();
      unsubHash();
      unsubEnrich();
      if (clearTimer) window.clearTimeout(clearTimer);
    };
  }, [workspaceTab]);

  const analyze = useCallback(
    async (relativePath: string, options?: { fitView?: boolean }) => {
      await flushDraftRef.current();
      shouldFitViewRef.current = options?.fitView ?? true;
      setBusy(true);
      setBusyLabel('Analyzing wildcards…');
      setError(null);
      try {
        const result = await window.wcm.analyze.fromFile(relativePath);
        setAnalysis(result);
        setRootFile(relativePath);
        setFocusId(null);
        setSelectedNodeId(result.rootNodeId);
        const uncapped = estimateUncappedVisibleCount(
          buildAdjacency(result.edges),
          result.rootNodeId,
          DEFAULT_MAX_LEVELS,
        );
        if (uncapped > WIDE_GRAPH_UNCAPPED_THRESHOLD) {
          setGraphMaxLevels(1);
          flashNotice(
            'Wide graph — showing 1 level; click +N more or a child to drill in.',
          );
        } else {
          setGraphMaxLevels(DEFAULT_MAX_LEVELS);
        }
        // Always pan to the new root once React Flow has the laid-out nodes.
        pendingCenterNodeRef.current = result.rootNodeId;
        void window.wcm.library.setLastFile(relativePath).catch(() => {});
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        setBusyLabel(null);
      }
    },
    [flashNotice],
  );

  const openRoot = useCallback(
    async (targetPath: string, preferredFile?: string) => {
      await flushDraftRef.current();
      autosaveDraftRef.current = null;
      setBusy(true);
      setBusyLabel('Opening library…');
      setError(null);
      try {
        const snapshot = await window.wcm.library.openRoot(targetPath);
        setRoot(snapshot.root);
        setFiles(snapshot.files);
        setAnalysis(null);
        setRootFile(null);
        setSelectedNodeId(null);
        setFileContent(null);
        const [recents, keys, libList] = await Promise.all([
          window.wcm.library.getRecent(),
          window.wcm.library.listWildcardKeys(),
          window.wcm.library.listLibraries(),
        ]);
        setRecent(recents);
        setWildcardKeys(keys);
        setLibraries(libList.libraries);
        setActiveLibraryId(libList.activeLibraryId);
        setActiveLibraryName(
          libList.libraries.find((l) => l.id === libList.activeLibraryId)
            ?.name ?? null,
        );
        void loadRefStats();
        void loadHistory();
        if (snapshot.files.length > 0) {
          const preferred =
            preferredFile &&
            snapshot.files.some((f) => f.relativePath === preferredFile)
              ? preferredFile
              : snapshot.files[0]!.relativePath;
          await analyze(preferred);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        setBusy(false);
        setBusyLabel(null);
      }
    },
    [analyze, loadHistory, loadRefStats],
  );

  const refreshLibraries = useCallback(async () => {
    const libList = await window.wcm.library.listLibraries();
    setLibraries(libList.libraries);
    setActiveLibraryId(libList.activeLibraryId);
    setActiveLibraryName(
      libList.libraries.find((l) => l.id === libList.activeLibraryId)?.name ??
        null,
    );
  }, []);

  const applyLibrarySwitch = useCallback(
    async (result: LibrarySwitchResultDto) => {
      await flushDraftRef.current();
      autosaveDraftRef.current = null;
      setActiveLibraryId(result.library.id);
      setActiveLibraryName(result.library.name);
      setPromptsSelectedFolder(null);
      setGenerationSelectedFolder(null);
      setLoraTabSelectPath(null);
      setCheckpointTabSelectPath(null);
      await refreshLibraries();
      if (result.snapshot) {
        setRoot(result.snapshot.root);
        setFiles(result.snapshot.files);
        setAnalysis(null);
        setRootFile(null);
        setSelectedNodeId(null);
        setFileContent(null);
        const [recents, keys] = await Promise.all([
          window.wcm.library.getRecent(),
          window.wcm.library.listWildcardKeys(),
        ]);
        setRecent(recents);
        setWildcardKeys(keys);
        void loadRefStats();
        void loadHistory();
        const preferred =
          result.library.lastRootFile &&
          result.snapshot.files.some(
            (f) => f.relativePath === result.library.lastRootFile,
          )
            ? result.library.lastRootFile
            : result.snapshot.files[0]?.relativePath;
        if (preferred) await analyze(preferred);
      } else {
        setRoot(null);
        setFiles([]);
        setAnalysis(null);
        setRootFile(null);
        setSelectedNodeId(null);
        setFileContent(null);
        setEditText('');
        setValidationText('');
        editTextRef.current = '';
        setWildcardKeys([]);
      }
    },
    [analyze, loadHistory, loadRefStats, refreshLibraries],
  );

  const switchLibrary = useCallback(
    async (id: string) => {
      setOpenLibraryMenu(false);
      if (id === activeLibraryId && root) return;
      setBusy(true);
      setBusyLabel('Switching library…');
      setError(null);
      try {
        const result = await window.wcm.library.setActiveLibrary(id);
        await applyLibrarySwitch(result);
        flashNotice(`Switched to ${result.library.name}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        setBusyLabel(null);
      }
    },
    [activeLibraryId, applyLibrarySwitch, flashNotice, root],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [recents, startup, uiSettings, libList] = await Promise.all([
          window.wcm.library.getRecent(),
          window.wcm.library.getStartup(),
          window.wcm.ui
            .getSettings()
            .catch(() => ({
              detailsPanelWidth: DEFAULT_DETAILS_WIDTH,
              filesPanelWidth: DEFAULT_FILES_WIDTH,
              panelWidthsByTab: clonePanelWidthsByTab(DEFAULT_TAB_PANEL_WIDTHS),
              promptsSamplesCollapsed: null,
              generationPreviewCollapsed: null,
              generationAdditionalPositiveHeight: null,
              generationNegativePromptHeight: null,
              simulationIterations: 10_000,
              simulationSeed: 1,
              graphLayoutStyle: 'optimized' as const,
              workspaceListFilters: DEFAULT_WORKSPACE_LIST_FILTERS,
              loraFolder: null,
              checkpointFolder: null,
              imagesFolder: null,
              videosFolder: null,
              convertChildSuffix: DEFAULT_CONVERT_CHILD_SUFFIX,
              civitaiOrigin: DEFAULT_CIVITAI_ORIGIN,
              hasCivitaiApiKey: false,
              activeLibraryId: '',
              libraries: [] as Array<{ id: string; name: string }>,
            })),
          window.wcm.library.listLibraries().catch(() => ({
            libraries: [] as LibraryConfigDto[],
            activeLibraryId: '',
          })),
        ]);
        if (cancelled) return;
        setRecent(recents);
        setLibraries(libList.libraries);
        setActiveLibraryId(libList.activeLibraryId || null);
        setActiveLibraryName(
          libList.libraries.find((l) => l.id === libList.activeLibraryId)
            ?.name ?? null,
        );
        const restoredByTab = clonePanelWidthsByTab({
          ...DEFAULT_TAB_PANEL_WIDTHS,
          ...uiSettings.panelWidthsByTab,
        });
        panelWidthsByTabRef.current = restoredByTab;
        const activeWidths =
          restoredByTab[workspaceTabRef.current] ?? restoredByTab.wildcards;
        const restoredFiles = clampFilesWidth(
          activeWidths.filesPanelWidth,
          activeWidths.detailsPanelWidth,
        );
        const restoredDetails = clampDetailsWidth(
          activeWidths.detailsPanelWidth,
          restoredFiles,
        );
        liveFilesWidth.current = restoredFiles;
        liveDetailsWidth.current = restoredDetails;
        setFilesWidth(restoredFiles);
        setDetailsWidth(restoredDetails);
        setSimSettings({
          iterations: uiSettings.simulationIterations,
          seed: uiSettings.simulationSeed,
        });
        setGraphLayoutStyle(uiSettings.graphLayoutStyle);
        const savedWildcardFilter = uiSettings.workspaceListFilters?.wildcards;
        if (savedWildcardFilter) {
          setFilter(savedWildcardFilter.query);
          setFilterMode(savedWildcardFilter.mode);
        }
        setConvertChildSuffix(
          uiSettings.convertChildSuffix || DEFAULT_CONVERT_CHILD_SUFFIX,
        );
        if (startup.lastRoot) {
          try {
            await openRoot(startup.lastRoot, startup.lastRootFile ?? undefined);
          } catch {
            // Last library is gone or unreadable — fall back to the picker.
            if (!cancelled) setError(null);
          }
        }
      } catch {
        // Ignore startup errors; the picker remains available.
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openRoot]);

  const pickRoot = async () => {
    const picked = await window.wcm.library.pickRoot();
    if (picked) await openRoot(picked);
  };

  useEffect(() => {
    if (!openLibraryMenu) return;
    const close = (event: Event) => {
      if (
        event.type === 'pointerdown' &&
        openLibraryMenuRef.current?.contains(event.target as globalThis.Node)
      ) {
        return;
      }
      setOpenLibraryMenu(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenLibraryMenu(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [openLibraryMenu]);

  const refresh = useCallback(async (opts?: {
    light?: boolean;
    /** Rebuild / explicit rescan only — do not walk model folders on every save. */
    rescanModels?: boolean;
  }) => {
    if (!root) return;
    try {
      // Flush without tearing down the open editor draft — watcher/refresh used
      // to null the draft and briefly unmount CodeMirror.
      await flushDraftRef.current({ rebuild: false });
      const [nextFiles, keys] = await Promise.all([
        window.wcm.library.listFiles(),
        window.wcm.library.listWildcardKeys(),
      ]);
      setFiles(nextFiles);
      setWildcardKeys(keys);
      void loadRefStats();
      void loadHistory();
      if (opts?.light) return;
      if (rootFile && nextFiles.some((f) => f.relativePath === rootFile)) {
        await analyze(rootFile, { fitView: false });
      } else if (rootFile) {
        autosaveDraftRef.current = null;
        setAnalysis(null);
        setRootFile(null);
        setSelectedNodeId(null);
        setFileContent(null);
        setEditText('');
        setValidationText('');
        editTextRef.current = '';
      }
      if (!opts?.rescanModels) return;
      // Rebuild is not finished until LoRA/checkpoint folders are re-walked.
      // analyze() clears `busy`; keep a named status through the rescan.
      setBusy(true);
      setBusyLabel('Scanning LoRA and checkpoint folders…');
      try {
        await Promise.all([
          window.wcm.modelFiles.listLoras({ force: true }),
          window.wcm.modelFiles.listCheckpoints({ force: true }),
        ]);
        setModelFolderEpoch((n) => n + 1);
      } finally {
        setBusy(false);
        setBusyLabel(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [analyze, loadHistory, loadRefStats, root, rootFile]);

  const undo = useCallback(async () => {
    try {
      const result = await window.wcm.history.undo();
      setHistory(result.state);
      if (result.label) flashNotice(`Undid: ${result.label}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [flashNotice, refresh]);

  const redo = useCallback(async () => {
    try {
      const result = await window.wcm.history.redo();
      setHistory(result.state);
      if (result.label) flashNotice(`Redid: ${result.label}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [flashNotice, refresh]);

  useEffect(() => {
    const unsubscribe = window.wcm.watch.onChanged(() => {
      // Watcher refresh: reindex files/keys without rebuilding the graph.
      // Full analyze stays on Rebuild / file open / blur-save.
      void refresh({ light: true });
    });
    return unsubscribe;
  }, [refresh]);

  /**
   * Main-process mutations (LoRA category append, rename, undo, …) update
   * memory under the open editor. Disk is written only on save. Sync the live
   * buffer carefully — never flush a stale draft first, and never yank the
   * caret when the user is typing.
   */
  useEffect(() => {
    const norm = (p: string) => p.replace(/\\/g, '/');
    let analyzeTimer: number | null = null;
    const scheduleAnalyze = (analysisRoot: string) => {
      if (analyzeTimer !== null) window.clearTimeout(analyzeTimer);
      // Debounce: LoRA download queue can append many wildcards in a row.
      analyzeTimer = window.setTimeout(() => {
        analyzeTimer = null;
        if (rootFileRef.current !== analysisRoot) return;
        void window.wcm.analyze
          .fromFile(analysisRoot)
          .then((next) => {
            if (rootFileRef.current === analysisRoot) setAnalysis(next);
          })
          .catch(() => {
            // ignore
          });
      }, 800);
    };

    const unsubscribe = window.wcm.library.onMutated((payload) => {
      setHistory(payload.history);
      const draft = autosaveDraftRef.current;
      const hit =
        draft &&
        payload.relativePaths.some(
          (p) => norm(p) === norm(draft.relativePath),
        );
      if (!hit) {
        // Background mutation (e.g. LoRA wildcard append while browsing
        // Civitai): refresh stats only — skip graph rebuild to avoid UI hitch.
        void loadRefStats();
        void loadHistory();
        return;
      }

      if (draft.timer !== null) {
        window.clearTimeout(draft.timer);
        draft.timer = null;
      }

      void (async () => {
        try {
          const content = await window.wcm.library.readFile(draft.relativePath);
          // Prefer the live CodeMirror buffer over React state (may lag).
          const live =
            editorRef.current?.getValue() ??
            editTextRef.current ??
            draft.text;
          const incoming = content.text;
          const savedBaseline = draft.savedText;
          const lastDisk = content.unsaved
            ? (content.persistedText ?? savedBaseline)
            : incoming;

          if (payload.authoritative) {
            draft.text = incoming;
            editTextRef.current = incoming;
            setFileContent(content);
            setEditText(incoming);
            setValidationText(incoming);
            if (payload.memoryOnly) {
              draft.savedText = lastDisk;
              setSaveStatus(incoming === lastDisk ? 'saved' : 'dirty');
            } else {
              draft.savedText = incoming;
              setSaveStatus('saved');
            }
            editorRef.current?.setExternalValue(incoming);
            void loadRefStats();
            return;
          }

          if (live === incoming) {
            draft.text = incoming;
            editTextRef.current = incoming;
            setFileContent(content);
            setValidationText(incoming);
            if (payload.memoryOnly) {
              draft.savedText = lastDisk;
              setSaveStatus(incoming === lastDisk ? 'saved' : 'dirty');
              if (incoming !== lastDisk) {
                if (draft.timer !== null) window.clearTimeout(draft.timer);
                draft.timer = window.setTimeout(() => {
                  draft.timer = null;
                  void flushDraftRef.current({ rebuild: false });
                }, AUTOSAVE_DEBOUNCE_MS);
              }
            } else {
              draft.savedText = incoming;
              setSaveStatus('saved');
            }
            void loadRefStats();
            // Autosave echo — skip graph rebuild; external mutations still analyze.
            if (!payload.editorSave) {
              const analysisRoot = rootFileRef.current;
              if (analysisRoot) scheduleAnalyze(analysisRoot);
            }
            return;
          }

          // Own autosave echo — never replace the live buffer (delete / type
          // / paste). Record disk as the last write; stay dirty if they differ.
          if (payload.editorSave) {
            draft.savedText = incoming;
            draft.text = live;
            editTextRef.current = live;
            setFileContent({ ...content, text: live });
            setEditText(live);
            setValidationText(live);
            setSaveStatus(live === incoming ? 'saved' : 'dirty');
            void loadRefStats();
            return;
          }

          const merged = mergeLibraryTextBuffers(live, incoming, savedBaseline);

          if (merged === live && live.startsWith(incoming)) {
            draft.savedText = payload.memoryOnly ? lastDisk : incoming;
            draft.text = live;
            editTextRef.current = live;
            setFileContent({ ...content, text: live });
            setSaveStatus('dirty');
            void loadRefStats();
            return;
          }

          const nextDraft: AutosaveDraft = {
            relativePath: content.relativePath,
            text: merged,
            savedText:
              payload.memoryOnly
                ? lastDisk
                : merged === incoming
                  ? incoming
                  : draft.savedText,
            sessionId: draft.sessionId,
            timer: null,
            saving: null,
          };
          autosaveDraftRef.current = nextDraft;
          editTextRef.current = merged;
          setFileContent({ ...content, text: merged });
          setEditText(merged);
          setValidationText(merged);
          setLiveValidation(null);
          const matchesPersisted = payload.memoryOnly
            ? merged === lastDisk
            : merged === incoming;
          setSaveStatus(matchesPersisted ? 'saved' : 'dirty');
          if (merged !== live) {
            // Transparent sync — append-aware + caret/scroll preserving.
            editorRef.current?.setExternalValue(merged);
          }

          // Persist only when we synthesized a new buffer after a disk write
          // (three-way merge of live edits + saved LoRA append). Memory-only
          // category updates stay dirty until save.
          if (
            !payload.memoryOnly &&
            merged !== incoming &&
            merged !== live
          ) {
            const basedOn = incoming;
            void window.wcm.library
              .writeFile(
                draft.relativePath,
                merged,
                nextDraft.sessionId,
                basedOn,
              )
              .then((state) => {
                setHistory(state);
                if (autosaveDraftRef.current === nextDraft) {
                  nextDraft.savedText = merged;
                  setSaveStatus(
                    nextDraft.text === merged ? 'saved' : 'dirty',
                  );
                }
              })
              .catch(() => {
                if (autosaveDraftRef.current === nextDraft) {
                  setSaveStatus('error');
                }
              });
          } else if (payload.memoryOnly && merged !== lastDisk) {
            if (nextDraft.timer !== null) window.clearTimeout(nextDraft.timer);
            nextDraft.timer = window.setTimeout(() => {
              nextDraft.timer = null;
              void flushDraftRef.current({ rebuild: false });
            }, AUTOSAVE_DEBOUNCE_MS);
          }

          void loadRefStats();
          const analysisRoot = rootFileRef.current;
          if (analysisRoot) scheduleAnalyze(analysisRoot);
        } catch {
          // Open file was removed by this mutation (e.g. delete) — let the
          // caller refresh selection; do not flash a hard error.
          if (autosaveDraftRef.current?.relativePath === draft.relativePath) {
            autosaveDraftRef.current = null;
            setLiveValidation(null);
          }
        }
      })();
    });
    return () => {
      unsubscribe();
      if (analyzeTimer !== null) window.clearTimeout(analyzeTimer);
    };
  }, [loadHistory, loadRefStats]);

  /** Bridge for main-process LoRA append to read / mutate the live buffer. */
  useEffect(() => {
    const norm = (p: string) => p.replace(/\\/g, '/');
    type WcmEditorBridge = Window & {
      __wcmGetOpenFileLiveText?: (relativePath: string) => string | null;
      __wcmApplyOpenWildcardOp?: (
        relativePath: string,
        op: LoraWildcardBufferOp,
      ) => { before: string; text: string; changed: boolean } | null;
    };
    const w = window as WcmEditorBridge;
    w.__wcmGetOpenFileLiveText = (relativePath: string) => {
      const draft = autosaveDraftRef.current;
      if (!draft || norm(draft.relativePath) !== norm(relativePath)) {
        return null;
      }
      return editorRef.current?.getValue() ?? editTextRef.current ?? draft.text;
    };
    w.__wcmApplyOpenWildcardOp = (relativePath, op) => {
      const draft = autosaveDraftRef.current;
      if (!draft || norm(draft.relativePath) !== norm(relativePath)) {
        return null;
      }
      const before =
        editorRef.current?.getValue() ?? editTextRef.current ?? draft.text;
      const result = applyLoraWildcardBufferOp(before, op);
      if (!result.changed) {
        return { before, text: before, changed: false };
      }
      if (draft.timer !== null) window.clearTimeout(draft.timer);
      draft.text = result.text;
      draft.timer = window.setTimeout(() => {
        draft.timer = null;
        void flushDraftRef.current({ rebuild: false });
      }, AUTOSAVE_DEBOUNCE_MS);
      editTextRef.current = result.text;
      setFileContent((current) =>
        current && norm(current.relativePath) === norm(relativePath)
          ? { ...current, text: result.text, unsaved: true }
          : current,
      );
      setEditText(result.text);
      setValidationText(result.text);
      setLiveValidation(null);
      setSaveStatus('dirty');
      editorRef.current?.setExternalValue(result.text);
      return { before, text: result.text, changed: true };
    };
    return () => {
      delete w.__wcmGetOpenFileLiveText;
      delete w.__wcmApplyOpenWildcardOp;
    };
  }, []);

  useEffect(() => {
    return window.wcm.civitai.onOpenAttached(() => {
      setCivitaiOpen(true);
    });
  }, []);

  useEffect(() => {
    return window.wcm.civitai.onRevealLocalFile((params) => {
      if (params.type === 'Checkpoint') {
        setCheckpointTabSelectPath(params.relativePath);
        setWorkspaceTab('checkpoints');
      } else {
        setLoraTabSelectPath(params.relativePath);
        setWorkspaceTab('loras');
      }
      // Close the attached Civitai modal so the file tab is visible.
      setCivitaiOpen(false);
    });
  }, []);

  const clearLoraTabSelectPath = useCallback(() => {
    setLoraTabSelectPath(null);
  }, []);

  const clearCheckpointTabSelectPath = useCallback(() => {
    setCheckpointTabSelectPath(null);
  }, []);

  const selectedNode = useMemo(
    () => analysis?.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [analysis, selectedNodeId],
  );

  const selectedFileEntry = useMemo(
    () =>
      selectedNode?.hostKey || selectedNode?.relativeKey
        ? files.find(
            (f) => f.key === (selectedNode.hostKey ?? selectedNode.relativeKey),
          ) ?? null
        : null,
    [files, selectedNode],
  );

  const categoryForSelectedWildcard = useMemo(() => {
    if (!selectedFileEntry || !loraDownloadCategories) return null;
    return (
      loraDownloadCategories.categories.find(
        (c) => c.wildcardRelativePath === selectedFileEntry.relativePath,
      ) ?? null
    );
  }, [selectedFileEntry, loraDownloadCategories]);

  useEffect(() => {
    if (
      workspaceTab !== 'wildcards' &&
      !loraCategoryManager.open &&
      !categorizeLoraIssue
    ) {
      return;
    }
    let cancelled = false;
    void window.wcm.civitai
      .listLoraDownloadCategories()
      .then((list) => {
        if (!cancelled) setLoraDownloadCategories(list);
      })
      .catch(() => {
        if (!cancelled) setLoraDownloadCategories(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceTab, loraCategoryManager.open, categorizeLoraIssue]);

  const applyUnusedLoraIssues = useCallback((unused: IssueDto[]) => {
    setAnalysis((current) => {
      if (!current) return current;
      const kept = current.issues.filter(
        (issue) =>
          issue.code !== 'unused_lora' &&
          issue.code !== 'duplicate_lora_hash',
      );
      const issues = [...kept, ...unused];
      const warningCount = issues.filter(
        (issue) => issue.severity === 'warning',
      ).length;
      const errorCount = issues.filter(
        (issue) => issue.severity === 'error',
      ).length;
      return {
        ...current,
        issues,
        stats: {
          ...current.stats,
          warningCount,
          errorCount,
        },
      };
    });
  }, []);

  const refreshUnusedLoras = useCallback(
    async (relativePath?: string, text?: string) => {
      try {
        const unused = await window.wcm.analyze.refreshUnusedLoras(
          relativePath,
          text,
        );
        applyUnusedLoraIssues(unused);
      } catch {
        // Unused-LoRA refresh is best-effort; full Rebuild still works.
      }
    },
    [applyUnusedLoraIssues],
  );

  /** Re-analyze the open graph for All/Other issues without resetting selection or view. */
  const refreshGraphIssues = useCallback(async () => {
    const analysisRoot = rootFileRef.current;
    if (!analysisRoot || issuesRefreshingRef.current) return;
    issuesRefreshingRef.current = true;
    setIssuesRefreshing(true);
    setError(null);
    try {
      await flushDraftRef.current({ rebuild: false });
      const [nextAnalysis, keys] = await Promise.all([
        window.wcm.analyze.fromFile(analysisRoot),
        window.wcm.library.listWildcardKeys(),
      ]);
      setAnalysis(nextAnalysis);
      setSelectedNodeId((current) =>
        current && nextAnalysis.nodes.some((node) => node.id === current)
          ? current
          : nextAnalysis.rootNodeId,
      );
      setWildcardKeys(keys);
      void loadRefStats();

      const openPath =
        autosaveDraftRef.current?.relativePath ??
        fileContent?.relativePath ??
        null;
      const openText =
        autosaveDraftRef.current?.text ?? editTextRef.current;

      // Always rescan unused LoRAs (fresh folder walk). Do not gate on an open
      // editor — a new unreferenced file is a library-wide issue.
      if (openPath) {
        setLiveValidation((current) => ({
          relativePath: openPath,
          issues: current?.relativePath === openPath ? current.issues : [],
          pending: true,
        }));
        try {
          const [issues, unused] = await Promise.all([
            window.wcm.analyze.validateFile(openPath, openText),
            window.wcm.analyze.refreshUnusedLoras(openPath, openText),
          ]);
          const openKey = openPath.replace(/\.(txt|ya?ml|json)$/i, '');
          setLiveValidation({
            relativePath: openPath,
            // Prefer renderer syntax for brace/$$ codes — main may lag a rebuild.
            issues: mergeLocalSyntaxIssues(
              issues,
              localWildcardSyntaxIssues(openText, openKey),
            ),
            pending: false,
          });
          applyUnusedLoraIssues(unused);
        } catch {
          setLiveValidation((current) =>
            current?.relativePath === openPath
              ? { ...current, pending: false }
              : current,
          );
        }
      } else {
        try {
          const unused = await window.wcm.analyze.refreshUnusedLoras();
          applyUnusedLoraIssues(unused);
        } catch {
          // Unused-LoRA refresh is best-effort; graph analysis already ran.
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      issuesRefreshingRef.current = false;
      setIssuesRefreshing(false);
    }
  }, [applyUnusedLoraIssues, fileContent?.relativePath, loadRefStats]);

  const loraIndexHintIssues = useMemo(() => {
    return [
      ...(analysis?.issues ?? []),
      ...(liveValidation?.issues ?? []),
    ];
  }, [analysis, liveValidation]);

  const loraIndexStaleHintKey = useMemo(
    () =>
      loraIndexHintIssues
        .filter(issueSuggestsStaleLoraIndex)
        .map((issue) => `${issue.code}:${issue.snippet ?? issue.message}`)
        .sort()
        .join('|'),
    [loraIndexHintIssues],
  );

  const watchLoraIndex = useMemo(
    () => loraIndexHintIssues.some(issueNeedsLoraIndexWatch),
    [loraIndexHintIssues],
  );

  useEffect(() => {
    if (!loraIndexStaleHintKey) return;
    void window.wcm.modelFiles.refreshLoraIndexIfStale();
  }, [loraIndexStaleHintKey]);

  useEffect(() => {
    if (!watchLoraIndex) return;
    const id = window.setInterval(() => {
      void window.wcm.modelFiles.refreshLoraIndexIfStale();
    }, LORA_INDEX_STALE_ISSUE_MAX_AGE_MS);
    return () => window.clearInterval(id);
  }, [watchLoraIndex]);

  useEffect(() => {
    let timer: number | null = null;
    const unsub = window.wcm.modelFiles.onLoraIndexRefreshed(() => {
      // Do not bump modelFolderEpoch here — that re-lists LoRAs and force-
      // rematches the whole catalog, which made Civitai Downloaded spike.
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void refreshGraphIssues();
      }, 400);
    });
    return () => {
      if (timer != null) window.clearTimeout(timer);
      unsub();
    };
  }, [refreshGraphIssues]);

  useEffect(() => {
    return window.wcm.civitai.onDownloadProgress((progress) => {
      if (!progress.done || progress.error || progress.type !== 'LORA') return;
      // Skip while more downloads are queued — a full LoRA-folder rescan here
      // freezes the UI as the next job shows “Starting…”.
      if ((progress.queuedCount ?? 0) > 0 || progress.activeModelId != null) {
        return;
      }
      // Index ingested the new file in main; refresh issues without a full rescan.
      void refreshGraphIssues();
    });
  }, [refreshGraphIssues]);

  const flushDraft = useCallback(
    async (
      draft = autosaveDraftRef.current,
      options: FlushDraftOptions = {},
    ) => {
      if (!draft) return;
      if (draft.timer !== null) {
        window.clearTimeout(draft.timer);
        draft.timer = null;
      }
      if (draft.saving) {
        await draft.saving;
      }

      let didSave = false;
      // Snapshot before any write — used to detect graph-relationship changes.
      const textBeforeSave = draft.savedText;
      while (draft.text !== draft.savedText) {
        const textToSave = draft.text;
        if (autosaveDraftRef.current === draft) setSaveStatus('saving');
        setError(null);

        const basedOn = draft.savedText;
        const save = window.wcm.library
          .writeFile(
            draft.relativePath,
            textToSave,
            draft.sessionId,
            basedOn,
          )
          .then((result) => {
            didSave = true;
            const written = result.writtenText;
            setHistory(result);

            // Disk may be ahead of textToSave (LoRA append raced the save).
            if (written !== textToSave) {
              const live =
                editorRef.current?.getValue() ?? draft.text;
              const merged = mergeLibraryTextBuffers(
                live,
                written,
                basedOn,
              );
              draft.text = merged;
              editTextRef.current = merged;
              if (merged !== live) {
                editorRef.current?.setExternalValue(merged);
              }
              if (autosaveDraftRef.current === draft) {
                setFileContent((current) =>
                  current?.relativePath === draft.relativePath
                    ? { ...current, text: merged }
                    : current,
                );
                setEditText(merged);
                setValidationText(merged);
              }
            }

            draft.savedText = written;
            if (autosaveDraftRef.current === draft) {
              setFileContent((current) =>
                current?.relativePath === draft.relativePath
                  ? { ...current, text: draft.text }
                  : current,
              );
              setValidationText(draft.text);
              setSaveStatus(draft.text === written ? 'saved' : 'dirty');
            }
          })
          .catch((err) => {
            if (autosaveDraftRef.current === draft) setSaveStatus('error');
            setError(err instanceof Error ? err.message : String(err));
            throw err;
          })
          .finally(() => {
            draft.saving = null;
          });

        draft.saving = save;
        try {
          await save;
        } catch {
          return;
        }
      }

      // Rebuild only when outgoing `__ref__` relationships changed — prose /
      // weight-only saves must not hitch the graph.
      const analysisRoot = rootFileRef.current;
      const refsChanged =
        didSave &&
        graphRelationshipFingerprint(textBeforeSave) !==
          graphRelationshipFingerprint(draft.savedText);
      if (didSave && analysisRoot && refsChanged) {
        try {
          const [nextAnalysis, keys] = await Promise.all([
            window.wcm.analyze.fromFile(analysisRoot),
            window.wcm.library.listWildcardKeys(),
          ]);
          setAnalysis(nextAnalysis);
          setSelectedNodeId((current) =>
            current && nextAnalysis.nodes.some((node) => node.id === current)
              ? current
              : nextAnalysis.rootNodeId,
          );
          setWildcardKeys(keys);
          void loadRefStats();
        } catch {
          // The save succeeded; a rebuild can be retried with the Rebuild button.
        }
      }
    },
    [loadRefStats],
  );
  flushDraftRef.current = (options) => flushDraft(undefined, options);

  /**
   * After a disk mutation that rewrote the open file (delete ref cleanup,
   * LoRA rename, …), pull the buffer from disk before any flush/validate so
   * stale `__refs__` do not flash as missing_file errors.
   */
  const syncOpenDraftFromDisk = useCallback(async (relativePath: string) => {
    try {
      const content = await window.wcm.library.readFile(relativePath);
      editTextRef.current = content.text;
      setEditText(content.text);
      setValidationText(content.text);
      setFileContent(content);
      setLiveValidation(null);
      editorRef.current?.setExternalValue(content.text);
      const draft = autosaveDraftRef.current;
      if (draft && draft.relativePath === relativePath) {
        if (draft.timer !== null) {
          window.clearTimeout(draft.timer);
          draft.timer = null;
        }
        draft.text = content.text;
        draft.savedText = content.text;
        setSaveStatus('saved');
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const selectedHostKey =
    selectedNode?.hostKey ?? selectedNode?.relativeKey ?? null;

  useEffect(() => {
    let cancelled = false;
    const entry = selectedHostKey
      ? files.find((file) => file.key === selectedHostKey)
      : null;

    if (
      entry &&
      autosaveDraftRef.current?.relativePath === entry.relativePath
    ) {
      return;
    }

    void (async () => {
      const previousDraft = autosaveDraftRef.current;
      if (previousDraft) await flushDraft(previousDraft, { rebuild: true });
      if (cancelled) return;

      if (validationTimerRef.current !== null) {
        window.clearTimeout(validationTimerRef.current);
        validationTimerRef.current = null;
      }

      autosaveDraftRef.current = null;
      setLiveValidation(null);
      setSaveStatus('saved');
      if (!entry) {
        setFileContent(null);
        setEditText('');
        setValidationText('');
        editTextRef.current = '';
        return;
      }

      try {
        const content = await window.wcm.library.readFile(entry.relativePath);
        if (cancelled) return;
        const savedText =
          content.unsaved && content.persistedText !== undefined
            ? content.persistedText
            : content.text;
        const draft: AutosaveDraft = {
          relativePath: content.relativePath,
          text: content.text,
          savedText,
          sessionId: globalThis.crypto.randomUUID(),
          timer: null,
          saving: null,
        };
        autosaveDraftRef.current = draft;
        validatedSnapshotRef.current = null;
        editTextRef.current = content.text;
        setFileContent(content);
        setEditText(content.text);
        setValidationText(content.text);
        setSaveStatus(content.unsaved ? 'dirty' : 'saved');
      } catch {
        // The selected graph node may have disappeared during a rebuild.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [files, flushDraft, selectedHostKey]);

  useEffect(() => {
    const flushBeforeClose = () => {
      const draft = autosaveDraftRef.current;
      if (!draft || draft.text === draft.savedText) return;
      const result = window.wcm.library.flushFile(
        draft.relativePath,
        draft.text,
        draft.sessionId,
        draft.savedText,
      );
      if (result && typeof result === 'object' && 'writtenText' in result) {
        draft.savedText = result.writtenText;
        draft.text = result.writtenText;
      } else {
        draft.savedText = draft.text;
      }
    };
    window.addEventListener('beforeunload', flushBeforeClose);
    return () => window.removeEventListener('beforeunload', flushBeforeClose);
  }, []);

  useEffect(() => {
    if (!fileContent || !selectedNode || !selectedFileEntry) {
      setLiveValidation(null);
      return;
    }

    const path = fileContent.relativePath;
    const text = validationText;
    const key = selectedFileEntry.key;
    const syntax = localWildcardSyntaxIssues(text, key, fileContent.absolutePath);

    // Already IPC-validated this exact buffer — keep results, still show
    // current local syntax (in case of a race with an older IPC response).
    const already =
      validatedSnapshotRef.current?.path === path &&
      validatedSnapshotRef.current?.text === text;
    if (already) {
      setLiveValidation((current) => ({
        relativePath: path,
        issues:
          current?.relativePath === path
            ? mergeLocalSyntaxIssues(current.issues, syntax)
            : syntax,
        pending: false,
      }));
      return;
    }

    let cancelled = false;
    setLiveValidation((current) => ({
      relativePath: path,
      issues:
        current?.relativePath === path
          ? mergeLocalSyntaxIssues(current.issues, syntax)
          : syntax,
      pending: true,
    }));

    void window.wcm.analyze
      .validateFile(path, text)
      .then((issues) => {
        if (cancelled) return;
        validatedSnapshotRef.current = { path, text };
        setLiveValidation({
          relativePath: path,
          // Keep instant local brace/$$ syntax authoritative over IPC (stale main).
          issues: mergeLocalSyntaxIssues(issues, syntax),
          pending: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLiveValidation((current) =>
          current
            ? {
                ...current,
                pending: false,
              }
            : null,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    validationText,
    fileContent?.relativePath,
    fileContent?.absolutePath,
    selectedFileEntry?.key,
    selectedFileEntry?.relativePath,
    selectedNode?.id,
  ]);

  // Apply a queued jump-to-line once the matching file source is loaded.
  useEffect(() => {
    const pending = pendingJumpRef.current;
    if (!pending || !fileContent || !selectedNode) return;
    const nodeMatches =
      !pending.nodeId ||
      selectedNode.id === pending.nodeId ||
      selectedNode.relativeKey === pending.nodeId;
    if (!nodeMatches) return;
    const timer = window.setTimeout(() => {
      editorRef.current?.jumpToLine(pending.line, pending.column);
      pendingJumpRef.current = null;
    }, 40);
    return () => window.clearTimeout(timer);
  }, [fileContent, selectedNode]);

  const updateEditText = useCallback(
    (text: string) => {
      // CodeMirror owns the document while focused — avoid setState(text) on
      // every keystroke (that re-rendered the whole graph and felt sluggish).
      editTextRef.current = text;
      const draft = autosaveDraftRef.current;
      if (!draft) return;
      if (text === draft.text && text === draft.savedText) {
        setSaveStatus('saved');
        const key = draft.relativePath.replace(/\.(txt|ya?ml|json)$/i, '');
        const syntax = localWildcardSyntaxIssues(text, key);
        setLiveValidation((current) => ({
          relativePath: draft.relativePath,
          issues:
            current?.relativePath === draft.relativePath
              ? mergeLocalSyntaxIssues(current.issues, syntax)
              : syntax,
          pending: false,
        }));
        return;
      }
      draft.text = text;
      if (draft.timer !== null) window.clearTimeout(draft.timer);
      if (text === draft.savedText) {
        draft.timer = null;
        setSaveStatus('saved');
      } else {
        setSaveStatus((current) => (current === 'dirty' ? current : 'dirty'));
        draft.timer = window.setTimeout(() => {
          draft.timer = null;
          void flushDraft(draft, { rebuild: false });
        }, AUTOSAVE_DEBOUNCE_MS);
      }

      if (localSyntaxTimerRef.current !== null) {
        window.clearTimeout(localSyntaxTimerRef.current);
      }
      localSyntaxTimerRef.current = window.setTimeout(() => {
        localSyntaxTimerRef.current = null;
        const key = draft.relativePath.replace(/\.(txt|ya?ml|json)$/i, '');
        const syntax = localWildcardSyntaxIssues(text, key);
        setLiveValidation((current) => ({
          relativePath: draft.relativePath,
          issues:
            current?.relativePath === draft.relativePath
              ? mergeLocalSyntaxIssues(current.issues, syntax)
              : syntax,
          pending:
            current?.relativePath === draft.relativePath
              ? current.pending
              : false,
        }));
      }, LOCAL_SYNTAX_DEBOUNCE_MS);

      if (validationTimerRef.current !== null) {
        window.clearTimeout(validationTimerRef.current);
      }
      validationTimerRef.current = window.setTimeout(() => {
        validationTimerRef.current = null;
        // Keep the controlled `value` roughly in sync for blur/remount without
        // paying for a full App render on every keystroke.
        setEditText(text);
        setValidationText(text);
      }, LIVE_VALIDATE_DEBOUNCE_MS);
    },
    [flushDraft],
  );

  const openExternal = useCallback(async (relativePath: string) => {
    setError(null);
    try {
      await window.wcm.library.openFileExternal(relativePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const openFileContextMenu = useCallback(
    (
      file: FileEntryDto,
      event: ReactMouseEvent<HTMLButtonElement>,
    ) => {
      event.preventDefault();
      setGraphNodeContextMenu(null);
      const menuWidth = 230;
      const menuHeight = 276;
      setFileContextMenu({
        file,
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
        y: Math.max(
          8,
          Math.min(event.clientY, window.innerHeight - menuHeight - 8),
        ),
      });
    },
    [],
  );

  const openGraphNodeContextMenu = useCallback(
    (nodeId: string, event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setFileContextMenu(null);
      const realId = nodeId.startsWith(GHOST_PREFIX)
        ? nodeId.slice(GHOST_PREFIX.length)
        : nodeId;
      const menuWidth = 260;
      const menuHeight = 340;
      setGraphNodeContextMenu({
        nodeId: realId,
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
        y: Math.max(
          8,
          Math.min(event.clientY, window.innerHeight - menuHeight - 8),
        ),
      });
    },
    [],
  );

  useEffect(() => {
    if (!fileContextMenu) return;

    const close = (event: Event) => {
      if (
        event.type === 'pointerdown' &&
        fileContextMenuRef.current?.contains(event.target as globalThis.Node)
      ) {
        return;
      }
      setFileContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFileContextMenu(null);
    };

    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', closeOnEscape);
    window.setTimeout(() => {
      fileContextMenuRef.current
        ?.querySelector<HTMLButtonElement>('button')
        ?.focus();
    }, 0);

    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [fileContextMenu]);

  useEffect(() => {
    if (!graphNodeContextMenu) return;

    const close = (event: Event) => {
      if (
        event.type === 'pointerdown' &&
        graphNodeContextMenuRef.current?.contains(
          event.target as globalThis.Node,
        )
      ) {
        return;
      }
      setGraphNodeContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGraphNodeContextMenu(null);
    };

    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', closeOnEscape);
    window.setTimeout(() => {
      graphNodeContextMenuRef.current
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus();
    }, 0);

    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [graphNodeContextMenu]);

  const validationIssueByKey = useMemo(() => {
    const map = new Map<
      string,
      { errorCount: number; warningCount: number }
    >();
    for (const row of validationReport?.files ?? []) {
      map.set(row.key, {
        errorCount: row.errorCount,
        warningCount: row.warningCount,
      });
    }
    return map;
  }, [validationReport]);

  const visibleFiles = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const hasStats = refStats.size > 0;
    return files.filter((f) => {
      if (rootFile && f.relativePath === rootFile) return true;
      if (needle && !f.relativePath.toLowerCase().includes(needle)) return false;
      if (filterMode === 'errors') return validationIssueByKey.has(f.key);
      if (filterMode === 'all' || !hasStats) return true;
      const stat = refStats.get(f.key);
      if (!stat) return true;
      if (filterMode === 'roots') return stat.inbound === 0;
      if (filterMode === 'leaves') return stat.outbound === 0;
      if (filterMode === 'invalid') return stat.issueCount > 0;
      if (filterMode === 'lora') return (stat.loraTagCount ?? 0) > 0;
      return stat.inbound === 0 && stat.outbound === 0;
    });
  }, [files, filter, filterMode, refStats, validationIssueByKey, rootFile]);

  const openConsolidate = useCallback(async () => {
    const key = selectedNode?.relativeKey;
    if (!key) return;
    const entry = files.find((f) => f.key === key);
    if (!entry) return;
    setConsolidateTarget(entry.relativePath);
  }, [files, selectedNode]);

  const openAbsorb = useCallback(async () => {
    const key = selectedNode?.relativeKey;
    if (!key) return;
    const entry = files.find((f) => f.key === key);
    if (!entry) return;
    setAbsorbTarget(entry.relativePath);
  }, [files, selectedNode]);

  const runConsolidate = useCallback(
    async (relativePath: string) => {
      const openPath =
        autosaveDraftRef.current?.relativePath ??
        fileContent?.relativePath ??
        null;
      const result = await window.wcm.refactor.consolidate(relativePath);
      setConsolidateTarget(null);
      flashNotice(
        `Consolidated ${result.deletedRelativePath} → __${result.targetName}__ ` +
          `(${result.totalOccurrences} reference${result.totalOccurrences === 1 ? '' : 's'} in ${result.editedFiles} file${result.editedFiles === 1 ? '' : 's'}).`,
      );
      setLiveValidation(null);
      if (openPath && openPath === result.deletedRelativePath) {
        autosaveDraftRef.current = null;
        setFileContent(null);
        setEditText('');
        setValidationText('');
        editTextRef.current = '';
      } else if (openPath) {
        await syncOpenDraftFromDisk(openPath);
      }
      // If the graph root was the deleted forwarder, switch to the target it pointed at.
      const nextRoot =
        rootFile === result.deletedRelativePath
          ? result.targetRelativePath ?? undefined
          : rootFile ?? undefined;
      if (root) await openRoot(root, nextRoot);
    },
    [
      fileContent?.relativePath,
      flashNotice,
      openRoot,
      root,
      rootFile,
      syncOpenDraftFromDisk,
    ],
  );

  const runAbsorb = useCallback(
    async (relativePath: string) => {
      const openPath =
        autosaveDraftRef.current?.relativePath ??
        fileContent?.relativePath ??
        null;
      const result = await window.wcm.refactor.absorb(relativePath);
      setAbsorbTarget(null);
      flashNotice(
        `Absorbed __${result.targetName}__ into ${result.keptRelativePath} ` +
          `(deleted ${result.deletedRelativePath}; updated ${result.totalOccurrences} reference${result.totalOccurrences === 1 ? '' : 's'}).`,
      );
      setLiveValidation(null);
      if (openPath && openPath === result.deletedRelativePath) {
        autosaveDraftRef.current = null;
        setFileContent(null);
        setEditText('');
        setValidationText('');
        editTextRef.current = '';
      } else if (openPath) {
        await syncOpenDraftFromDisk(openPath);
      }
      const nextRoot =
        rootFile === result.deletedRelativePath
          ? result.keptRelativePath
          : rootFile ?? undefined;
      if (root) await openRoot(root, nextRoot);
    },
    [
      fileContent?.relativePath,
      flashNotice,
      openRoot,
      root,
      rootFile,
      syncOpenDraftFromDisk,
    ],
  );

  const openCreateMissing = useCallback((key: string) => {
    setCreateDescendantParent(null);
    setCreateInitialPath(key);
    setCreateOpen(true);
  }, []);

  const openCreateDescendant = useCallback(
    (parentRelativePath: string) => {
      const sourceKey = parentRelativePath
        .replace(/\\/g, '/')
        .replace(/\.(txt|ya?ml|json)$/i, '');
      setCreateDescendantParent(parentRelativePath);
      setCreateInitialPath(
        defaultConvertChildKey(sourceKey, convertChildSuffix),
      );
      setCreateOpen(true);
    },
    [convertChildSuffix],
  );

  const runCreate = useCallback(
    async (relativePath: string) => {
      const parent = createDescendantParent;
      if (parent) {
        await flushDraftRef.current({ rebuild: false });
        const result = await window.wcm.refactor.createDescendant(
          parent,
          relativePath,
        );
        setCreateOpen(false);
        setCreateInitialPath('');
        setCreateDescendantParent(null);
        flashNotice(
          `Created ${result.childRelativePath} and linked from ${result.parentRelativePath}`,
        );
        setLiveValidation(null);
        await syncOpenDraftFromDisk(result.parentRelativePath);
        if (root) {
          await openRoot(root, result.parentRelativePath);
        }
        return;
      }
      const created = await window.wcm.file.create(relativePath, '');
      setCreateOpen(false);
      setCreateInitialPath('');
      flashNotice(`Created ${created}`);
      if (root) await openRoot(root, created);
    },
    [createDescendantParent, flashNotice, openRoot, root, syncOpenDraftFromDisk],
  );

  const runRename = useCallback(
    async (relativePath: string, newKey: string) => {
      const openPath =
        autosaveDraftRef.current?.relativePath ??
        fileContent?.relativePath ??
        null;
      const result = await window.wcm.file.rename(relativePath, newKey);
      setRenameTarget(null);
      flashNotice(
        `Renamed to ${result.newRelativePath} (updated ${result.totalOccurrences} reference${result.totalOccurrences === 1 ? '' : 's'} in ${result.editedFiles} file${result.editedFiles === 1 ? '' : 's'}).`,
      );
      setLiveValidation(null);
      if (openPath && openPath !== relativePath) {
        await syncOpenDraftFromDisk(openPath);
      } else if (openPath === relativePath) {
        // Renamed the open file — openRoot will load the new path.
        autosaveDraftRef.current = null;
        setLiveValidation(null);
      }
      const wasRoot = rootFile === relativePath;
      if (root) await openRoot(root, wasRoot ? result.newRelativePath : rootFile ?? undefined);
    },
    [
      fileContent?.relativePath,
      flashNotice,
      openRoot,
      root,
      rootFile,
      syncOpenDraftFromDisk,
    ],
  );

  const runRenameLora = useCallback(
    async (sourceName: string, newBasename: string) => {
      await flushDraftRef.current({ rebuild: false });
      const openPath =
        autosaveDraftRef.current?.relativePath ??
        fileContent?.relativePath ??
        null;
      const result = await window.wcm.ui.renameLora(sourceName, newBasename);

      // Rename rewrites tags on disk; the open editor draft still has the old
      // name. Sync before refresh/watcher flush or those will overwrite the rewrite.
      if (openPath) {
        await syncOpenDraftFromDisk(openPath);
      }

      setRenameLoraTarget(null);
      flashNotice(
        `Renamed LoRA to ${result.newRelativePath}` +
          (result.totalOccurrences > 0
            ? ` (updated ${result.totalOccurrences} tag${result.totalOccurrences === 1 ? '' : 's'} in ${result.editedFiles} file${result.editedFiles === 1 ? '' : 's'})`
            : '') +
          '.',
      );
      await refresh();
      // LoRA Files tab keeps its own list/detail — point it at the new path.
      setLoraTabSelectPath(result.newRelativePath);
    },
    [fileContent?.relativePath, flashNotice, refresh, syncOpenDraftFromDisk],
  );

  const runConvertToChild = useCallback(
    async (relativePath: string, childKey: string) => {
      await flushDraftRef.current({ rebuild: false });
      const result = await window.wcm.refactor.convertToChild(
        relativePath,
        childKey,
      );
      setConvertChildTarget(null);
      flashNotice(
        `Converted ${result.sourceRelativePath} → __${result.childKey}__`,
      );
      // Parent is now only a `__child__` pointer — sync before openRoot's
      // flushDraft, which would otherwise rewrite the old body over disk.
      setLiveValidation(null);
      await syncOpenDraftFromDisk(result.sourceRelativePath);
      if (root) await openRoot(root, rootFile ?? result.sourceRelativePath);
    },
    [flashNotice, openRoot, root, rootFile, syncOpenDraftFromDisk],
  );

  const runDelete = useCallback(
    async (relativePath: string) => {
      const openPath =
        autosaveDraftRef.current?.relativePath ??
        fileContent?.relativePath ??
        null;
      const result = await window.wcm.file.delete(relativePath);
      setDeleteTarget(null);
      const refNote =
        result.totalOccurrences > 0
          ? ` (removed ${result.totalOccurrences} reference${result.totalOccurrences === 1 ? '' : 's'} in ${result.editedFiles} file${result.editedFiles === 1 ? '' : 's'})`
          : '';
      flashNotice(`Deleted ${relativePath}${refNote}`);

      // Disk already has cleaned callers; sync the editor before openRoot's
      // flush / live-validate so we never briefly show missing_file for refs
      // that the delete mutation already removed.
      setLiveValidation(null);
      if (openPath && openPath !== relativePath) {
        await syncOpenDraftFromDisk(openPath);
      } else if (openPath === relativePath) {
        autosaveDraftRef.current = null;
        setFileContent(null);
        setEditText('');
        setValidationText('');
        editTextRef.current = '';
      }

      const wasRoot = rootFile === relativePath;
      if (root) await openRoot(root, wasRoot ? undefined : rootFile ?? undefined);
    },
    [
      fileContent?.relativePath,
      flashNotice,
      openRoot,
      root,
      rootFile,
      syncOpenDraftFromDisk,
    ],
  );

  const runCleanupMissing = useCallback(
    async (referenceName: string) => {
      const result = await window.wcm.refactor.cleanupMissing(referenceName);
      setCleanupMissingTarget(null);
      flashNotice(
        `Removed ${result.totalOccurrences} reference${result.totalOccurrences === 1 ? '' : 's'} ` +
          `to __${result.referenceName}__ from ${result.editedFiles} file${result.editedFiles === 1 ? '' : 's'}.`,
      );
      await refresh();
    },
    [flashNotice, refresh],
  );

  const runSimulation = useCallback(async () => {
    if (!rootFile || simBusy) return;
    setSimBusy(true);
    setError(null);
    try {
      const result = await window.wcm.simulate.run({
        relativePath: rootFile,
        iterations: simSettings.iterations,
        seed: simSettings.seed,
      });
      setSimResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSimBusy(false);
    }
  }, [rootFile, simBusy, simSettings]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.wcm.prompts.getCoverageReport(),
      window.wcm.prompts.getCoverageProgress(),
    ])
      .then(([report, progress]) => {
        if (cancelled) return;
        if (report) setCoverageReport(report);
        if (progress) {
          setCoverageProgress(progress);
          if (progress.report?.status === 'done') {
            setCoverageReport(progress.report);
          } else if (!report && progress.report) {
            setCoverageReport(progress.report);
          }
        }
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!coverageOpen) return;
    let cancelled = false;
    void window.wcm.prompts
      .getCoverageReport()
      .then((report) => {
        if (!cancelled && report) setCoverageReport(report);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, [coverageOpen]);

  useEffect(() => {
    return window.wcm.prompts.onCoverageProgress((progress) => {
      setCoverageProgress(progress);
      setCoverageStarting(false);
      if (progress.report?.status === 'done') {
        setCoverageReport(progress.report);
      } else if (progress.status === 'done' && progress.report) {
        setCoverageReport(progress.report);
      }
      if (progress.status === 'error' && progress.error) {
        setError(progress.error);
      }
    });
  }, []);

  const startCoverage = useCallback(async () => {
    setCoverageStarting(true);
    setError(null);
    try {
      await window.wcm.prompts.startCoverage();
    } catch (e) {
      setCoverageStarting(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const cancelCoverage = useCallback(() => {
    void window.wcm.prompts.cancelCoverage().catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, []);

  const coverageRunning =
    coverageStarting || coverageProgress?.status === 'running';

  const patchCoverageIgnoreKey = useCallback(
    async (key: string, action: 'add' | 'remove') => {
      try {
        const next = await window.wcm.prompts.patchCoverageIgnore(
          action === 'add' ? { add: [key] } : { remove: [key] },
        );
        setCoverageReport(next);
        flashNotice(
          action === 'add'
            ? `Ignored “${key}” in Coverage Never Used`
            : `Restored “${key}” in Coverage Never Used`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [flashNotice],
  );

  const exportSimulation = useCallback(async () => {
    if (!rootFile || !simResult || simExportBusy) return;
    setSimExportBusy(true);
    setError(null);
    try {
      const result = await window.wcm.simulate.exportLines({
        relativePath: rootFile,
        iterations: simResult.iterations,
        seed: simResult.seed,
      });
      if (result.saved && result.filePath) {
        flashNotice(
          `Exported ${result.lineCount?.toLocaleString() ?? simResult.iterations.toLocaleString()} simulated lines to ${result.filePath}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSimExportBusy(false);
    }
  }, [flashNotice, rootFile, simExportBusy, simResult]);

  const modalBlockingShortcuts =
    Boolean(deleteTarget) ||
    Boolean(renameTarget) ||
    Boolean(renameLoraTarget) ||
    Boolean(createOpen) ||
    Boolean(consolidateTarget) ||
    Boolean(absorbTarget) ||
    Boolean(convertChildTarget) ||
    Boolean(cleanupMissingTarget) ||
    Boolean(cycleIssue) ||
    Boolean(simSettingsOpen) ||
    Boolean(globalSearchLauncherOpen) ||
    Boolean(civitaiOpen) ||
    Boolean(expandTarget) ||
    Boolean(coverageOpen) ||
    Boolean(ignoreLoraIssue) ||
    Boolean(categorizeLoraIssue) ||
    Boolean(libraryManagerOpen) ||
    Boolean(loraCategoryManager.open) ||
    Boolean(fileContextMenu) ||
    Boolean(graphNodeContextMenu);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inEditor =
        tag === 'TEXTAREA' ||
        tag === 'INPUT' ||
        tag === 'SELECT' ||
        Boolean(target?.isContentEditable);

      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          if (inEditor) return;
          e.preventDefault();
          if (history.canUndo) void undo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          if (inEditor) return;
          e.preventDefault();
          if (history.canRedo) void redo();
        }
        return;
      }

      if (inEditor || e.altKey || modalBlockingShortcuts) return;

      if (e.key === 'Delete') {
        const node = selectedNode;
        const entry = selectedFileEntry;
        if (node?.kind === 'missing' && node.relativeKey) {
          e.preventDefault();
          setCleanupMissingTarget(node.relativeKey);
          return;
        }
        if (node && isManageableGraphNode(node, entry) && entry) {
          e.preventDefault();
          setDeleteTarget(entry.relativePath);
        }
        return;
      }

      if (e.key === 'Insert') {
        e.preventDefault();
        setCreateDescendantParent(null);
        setCreateInitialPath('');
        setCreateOpen(true);
        return;
      }

      if (e.key === 'F2') {
        const node = selectedNode;
        const entry = selectedFileEntry;
        if (node && isManageableGraphNode(node, entry) && entry) {
          e.preventDefault();
          setRenameTarget(entry.relativePath);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    history.canRedo,
    history.canUndo,
    modalBlockingShortcuts,
    redo,
    selectedFileEntry,
    selectedNode,
    undo,
  ]);

  useEffect(() => {
    setSimResult(null);
    setFocusId(null);
  }, [analysis]);

  const parentShareByPair = useMemo(() => {
    if (!simResult) return undefined;
    const map = new Map<string, number>();
    for (const e of simResult.edges) {
      map.set(`${e.parentKey}\0${e.childKey}`, e.parentShare);
    }
    return map;
  }, [simResult]);

  const balanceById = useMemo(() => {
    if (!analysis || !simResult) return undefined;
    return siblingBalanceScores(
      analysis.nodes
        .filter((n) => !n.isCaller)
        .map((n) => ({
          id: n.id,
          key: n.relativeKey ?? n.id,
        })),
      analysis.edges
        .filter((e) => !e.isCallerEdge)
        .map((e) => ({ from: e.from, to: e.to })),
      simResult.edges,
      analysis.rootNodeId,
    );
  }, [analysis, simResult]);

  const selectedSim = useMemo(() => {
    if (!simResult || !selectedNode) return null;
    const key = selectedNode.relativeKey ?? selectedNode.id;
    const stat = simResult.stats.find((s) => s.key === key) ?? null;
    const balance = balanceById?.get(selectedNode.id);

    // Prefer the share from the currently visible tree parent when available.
    const parentEdge =
      analysis &&
      (() => {
        const parents = analysis.edges
          .filter((e) => e.to === selectedNode.id)
          .map((e) => {
            const parent = analysis.nodes.find((n) => n.id === e.from);
            const parentKey = parent?.relativeKey ?? e.from;
            const share = parentShareByPair?.get(`${parentKey}\0${key}`);
            return share === undefined
              ? null
              : { parentKey, parentLabel: parent?.label ?? parentKey, share };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        // Prefer the highest-share parent for the details blurb when multiple.
        return parents.sort((a, b) => b.share - a.share)[0] ?? null;
      })();

    if (!stat && balance === undefined && !parentEdge) return null;
    return {
      reachRate: stat?.reachRate ?? 0,
      hits: stat?.hits ?? 0,
      visits: stat?.visits ?? 0,
      balance: balance ?? (parentEdge ? 0 : 1),
      parentShare: parentEdge?.share,
      parentLabel: parentEdge?.parentLabel,
    };
  }, [analysis, balanceById, parentShareByPair, selectedNode, simResult]);

  const flow = useMemo(
    () =>
      analysis
        ? flowElements(analysis, {
            parentShareByPair,
            balanceById,
            focusId: focusId ?? undefined,
            maxLevels: graphMaxLevels,
            layoutStyle: graphLayoutStyle,
          })
        : {
            nodes: [] as Array<Node<FlowNodeData>>,
            edges: [] as Edge[],
            view: null as GraphView | null,
          },
    [
      analysis,
      balanceById,
      focusId,
      graphLayoutStyle,
      graphMaxLevels,
      parentShareByPair,
    ],
  );

  const layoutReadyRef = useRef(false);
  useEffect(() => {
    if (!layoutReadyRef.current) {
      layoutReadyRef.current = true;
      return;
    }
    const instance = reactFlowRef.current;
    if (!instance) return;
    const frame = window.requestAnimationFrame(() => {
      void instance.fitView({ padding: 0.22, duration: 250 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [graphLayoutStyle]);

  useEffect(() => {
    const id = pendingCenterNodeRef.current;
    if (!id || flow.nodes.length === 0) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 45;
    let retryFrame = 0;

    const tryCenter = () => {
      if (cancelled) return;
      // Selection may have queued a newer target since this effect started.
      const targetId = pendingCenterNodeRef.current;
      if (!targetId) return;

      const instance = reactFlowRef.current;
      const flowNode = flow.nodes.find((node) => node.id === targetId);
      if (!instance || !flowNode) {
        if (attempts++ < maxAttempts) {
          retryFrame = window.requestAnimationFrame(tryCenter);
        }
        return;
      }

      const renderedNode = instance.getNode(targetId);
      const measured = renderedNode?.measured;
      if (!measured && attempts < 12) {
        attempts += 1;
        retryFrame = window.requestAnimationFrame(tryCenter);
        return;
      }

      const width = measured?.width ?? renderedNode?.width ?? 145;
      const height = measured?.height ?? renderedNode?.height ?? 42;
      pendingCenterNodeRef.current = null;
      shouldFitViewRef.current = false;

      void instance.setCenter(
        flowNode.position.x + width / 2,
        flowNode.position.y + height / 2,
        {
          zoom: instance.getZoom(),
          duration: 250,
        },
      );
    };

    const frame = window.requestAnimationFrame(tryCenter);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(retryFrame);
    };
  }, [flow.nodes]);

  const focusAndSelect = useCallback((id: string) => {
    const realId = id.startsWith(GHOST_PREFIX) ? id.slice(GHOST_PREFIX.length) : id;
    pendingCenterNodeRef.current = realId;
    setSelectedNodeId(realId);
    setFocusId(realId);
    setGraphMaxLevels(DEFAULT_MAX_LEVELS);
  }, []);

  const openWildcardInWildcardsTab = useCallback(
    async (relativePath: string, jump?: { line: number; column?: number }) => {
      setWorkspaceTab('wildcards');
      if (jump) {
        pendingJumpRef.current = {
          line: jump.line,
          column: jump.column,
          nodeId: undefined,
        };
      }
      await analyze(relativePath, { fitView: true });
    },
    [analyze],
  );

  const openGlobalSearchHit = useCallback(
    (hit: GlobalSearchHitDto) => {
      if (hit.kind === 'wildcard-name') {
        void openWildcardInWildcardsTab(hit.relativePath);
        return;
      }
      if (hit.kind === 'wildcard-content') {
        void openWildcardInWildcardsTab(hit.relativePath, { line: hit.line });
        return;
      }
      if (hit.kind === 'prompt-name' || hit.kind === 'prompt-content') {
        setPromptsSelectedFolder(hit.relativeFolder || null);
        setWorkspaceTab('prompts');
        return;
      }
      if (hit.kind === 'lora') {
        setLoraTabSelectPath(hit.relativePath);
        setWorkspaceTab('loras');
        return;
      }
      setCheckpointTabSelectPath(hit.relativePath);
      setWorkspaceTab('checkpoints');
    },
    [openWildcardInWildcardsTab],
  );

  const openLoraInLoraTab = useCallback(
    async (name: string) => {
      try {
        const result = await window.wcm.ui.searchLoras(name);
        // Only exact stem/basename/path matches — never a prefix/substring hit
        // (e.g. `<lora:V1 (1)>` must not open `Krea2_v1 (1).safetensors`).
        const hit = result.hits.find((h) => h.exact) ?? null;
        if (!hit) {
          flashNotice(
            `LoRA "${name}" was not found in the configured LoRA folder.`,
          );
          return;
        }
        setLoraTabSelectPath(hit.relativePath);
        setWorkspaceTab('loras');
        if (result.hits.length > 1 && name.includes('{')) {
          flashNotice(
            `Opened training series (${result.hits.length} step files).`,
          );
        }
      } catch (err) {
        flashNotice(
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    [flashNotice],
  );

  const openLoraInCivitaiCatalog = useCallback(
    (model: {
      origin: string;
      modelId: number;
      slug?: string;
    }) => {
      const focus: CivitaiFocusModelDto = {
        modelId: model.modelId,
        pageUrl: civitaiModelPageUrl(
          model.origin,
          model.modelId,
          model.slug ?? String(model.modelId),
        ),
        name: model.slug,
      };
      void window.wcm.civitai.focusModelInBrowser(focus).then((result) => {
        if (result.mode === 'modal') {
          setCivitaiFocusModel(focus);
          setCivitaiOpen(true);
        }
      });
    },
    [],
  );

  const openWildcardFromEditor = useCallback(
    async (name: string) => {
      await flushDraftRef.current();
      const needle = name.toLowerCase();

      const inGraph =
        analysis?.nodes.find(
          (node) =>
            !node.isCaller &&
            (node.id.toLowerCase() === needle ||
              node.relativeKey?.toLowerCase() === needle ||
              node.id.toLowerCase() === `glob:${needle}` ||
              node.id.toLowerCase() === `missing:${needle}`),
        ) ?? null;
      if (inGraph) {
        focusAndSelect(inGraph.id);
        return;
      }

      const file = files.find((entry) => entry.key.toLowerCase() === needle);
      if (file) {
        await analyze(file.relativePath, { fitView: true });
        return;
      }

      flashNotice(
        `__${name}__ is not in the current graph. Open a parent that references it, or create the file if it is missing.`,
      );
    },
    [analysis, analyze, files, flashNotice, focusAndSelect],
  );

  const handleIssueSelect = useCallback(
    (issue: IssueDto) => {
      if (issue.code === 'cycle') {
        setCycleIssue(issue);
        return;
      }

      if (
        (issue.code === 'unused_lora' ||
          issue.code === 'duplicate_lora_hash') &&
        issue.snippet
      ) {
        setLoraTabSelectPath(issue.snippet.replace(/\\/g, '/'));
        setWorkspaceTab('loras');
        return;
      }

      const line = issue.line;
      const column = issue.column;

      const jumpNow = (targetNodeId?: string) => {
        if (line == null) return;
        const alreadyOnTarget =
          !targetNodeId ||
          selectedNodeId === targetNodeId ||
          selectedNode?.id === targetNodeId ||
          selectedNode?.relativeKey === targetNodeId;
        pendingJumpRef.current = {
          line,
          column,
          nodeId: targetNodeId,
        };
        if (alreadyOnTarget && fileContent) {
          window.setTimeout(() => {
            editorRef.current?.jumpToLine(line, column);
            pendingJumpRef.current = null;
          }, 0);
        }
      };

      // Missing-file issues live on the missing node, but the line number is
      // in the referring parent — jump there instead.
      if (
        issue.code === 'missing_file' &&
        issue.nodeId &&
        line != null &&
        analysis
      ) {
        const edge = analysis.edges.find(
          (e) => e.to === issue.nodeId && e.line === line,
        );
        if (edge) {
          jumpNow(edge.from);
          focusAndSelect(edge.from);
          return;
        }
      }

      if (issue.nodeId) {
        jumpNow(issue.nodeId);
        focusAndSelect(issue.nodeId);
        return;
      }

      if (line != null) {
        editorRef.current?.jumpToLine(line, column);
      }
    },
    [analysis, fileContent, focusAndSelect, selectedNode, selectedNodeId],
  );

  const ignoreUnusedLora = useCallback(
    async (issue: IssueDto) => {
      if (issue.code !== 'unused_lora' || !issue.snippet || !rootFile) return;
      const paths = unusedLoraIssuePaths(issue);
      try {
        await window.wcm.ui.ignoreUnusedLora(
          paths.length > 1 ? paths : paths[0]!,
        );
        const nextAnalysis = await window.wcm.analyze.fromFile(rootFile);
        setAnalysis(nextAnalysis);
        setSelectedNodeId((current) =>
          current && nextAnalysis.nodes.some((node) => node.id === current)
            ? current
            : nextAnalysis.rootNodeId,
        );
        setIgnoreLoraIssue(null);
        const label = unusedLoraIssueLabel(issue);
        flashNotice(
          paths.length > 1
            ? `Ignored unused LoRA series: ${label} (${paths.length} files)`
            : `Ignored unused LoRA: ${label}`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [flashNotice, rootFile],
  );

  const categorizeUnusedLora = useCallback(
    async (
      issue: IssueDto,
      opts: {
        loraCategoryId: string;
        extraComment?: string;
        extraPrompt?: string;
      },
    ) => {
      if (issue.code !== 'unused_lora' || !rootFile) return;
      const paths = unusedLoraIssuePaths(issue);
      if (paths.length === 0) return;
      try {
        const result = await window.wcm.ui.categorizeUnusedLora({
          relativePaths: paths,
          loraCategoryId: opts.loraCategoryId,
          extraComment: opts.extraComment,
          extraPrompt: opts.extraPrompt,
        });
        setCategorizeLoraIssue(null);
        flashNotice(
          result.extended
            ? `Updated existing series in ${result.wildcardRelativePath}${
                result.extendSummary ? ` (${result.extendSummary})` : ''
              }`
            : result.appended
              ? `Categorized ${paths.length} LoRA(s) → ${result.wildcardRelativePath}`
              : `Moved ${paths.length} LoRA(s); reference already present in ${result.wildcardRelativePath}`,
        );
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [flashNotice, refresh, rootFile],
  );

  const copyUnusedLoraRef = useCallback(
    async (issue: IssueDto) => {
      if (issue.code !== 'unused_lora') return;
      const paths = unusedLoraIssuePaths(issue);
      if (paths.length === 0) return;
      const lastId = loraDownloadCategories?.lastCategoryId;
      const category =
        loraDownloadCategories?.categories.find((c) => c.id === lastId) ??
        loraDownloadCategories?.categories[0] ??
        null;
      let keywords: string[] = [];
      try {
        const info = await window.wcm.modelFiles.inspectLora(paths[0]!);
        keywords = info.promptKeywords ?? [];
      } catch {
        // Keywords are optional — still copy the LOCAL tag.
      }
      const text = buildUnusedLoraLocalSnippet({
        relativePaths: paths,
        weights: category?.defaultWeights,
        keywords,
      });
      if (!text) {
        setError('Could not build a LoRA reference for these files.');
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        flashNotice('Copied LOCAL LoRA reference');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [flashNotice, loraDownloadCategories],
  );

  const extendUnusedLoraSeries = useCallback(
    async (issue: IssueDto) => {
      if (
        issue.code !== 'unused_lora' ||
        issue.fixAction !== 'extend_lora_series' ||
        !rootFile
      ) {
        return;
      }
      const paths = unusedLoraIssuePaths(issue);
      if (paths.length === 0) return;
      try {
        const result = await window.wcm.ui.extendUnusedLoraSeries(paths);
        const detail = result.summaries.filter(Boolean).join('; ');
        flashNotice(
          `Fixed series reference in ${result.editedFiles} file${
            result.editedFiles === 1 ? '' : 's'
          }${detail ? ` (${detail})` : ''}`,
        );
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [flashNotice, refresh, rootFile],
  );

  const runCycleFix = useCallback(
    async (suggestion: CycleFixSuggestionDto) => {
      const result = await window.wcm.refactor.applyCycleFix({
        relativePath: suggestion.relativePath,
        line: suggestion.line,
        column: suggestion.column,
        snippet: suggestion.snippet,
      });
      setCycleIssue(null);
      flashNotice(
        `Broke cycle by removing ${result.snippet} from ${result.relativePath}`,
      );
      await refresh();
    },
    [flashNotice, refresh],
  );

  const handleGraphNodeClick = useCallback(
    async (id: string) => {
      const realId = id.startsWith(GHOST_PREFIX)
        ? id.slice(GHOST_PREFIX.length)
        : id;
      const node = analysis?.nodes.find((candidate) => candidate.id === realId);
      if (node?.isCaller && node.relativeKey) {
        const callerFile = files.find((file) => file.key === node.relativeKey);
        if (callerFile) {
          await analyze(callerFile.relativePath, { fitView: false });
          return;
        }
      }
      focusAndSelect(realId);
    },
    [analysis, analyze, files, focusAndSelect],
  );

  const handleGraphNodeDoubleClick = useCallback(
    async (id: string) => {
      const realId = id.startsWith(GHOST_PREFIX)
        ? id.slice(GHOST_PREFIX.length)
        : id;
      const node = analysis?.nodes.find((candidate) => candidate.id === realId);
      if (!node) return;
      const entry = fileEntryForGraphNode(node, files);
      if (!entry) {
        flashNotice(
          'This node has no wildcard file to open as graph root.',
        );
        return;
      }
      await analyze(entry.relativePath, { fitView: true });
    },
    [analysis, analyze, files, flashNotice],
  );

  const persistDetailsWidth = useCallback((width: number) => {
    const tab = workspaceTabRef.current;
    panelWidthsByTabRef.current = {
      ...panelWidthsByTabRef.current,
      [tab]: {
        ...panelWidthsByTabRef.current[tab],
        detailsPanelWidth: width,
      },
    };
    void window.wcm.ui.setDetailsPanelWidth(tab, width).catch(() => {});
  }, []);

  const persistFilesWidth = useCallback((width: number) => {
    const tab = workspaceTabRef.current;
    panelWidthsByTabRef.current = {
      ...panelWidthsByTabRef.current,
      [tab]: {
        ...panelWidthsByTabRef.current[tab],
        filesPanelWidth: width,
      },
    };
    void window.wcm.ui.setFilesPanelWidth(tab, width).catch(() => {});
  }, []);

  const applyPanelWidthsForTab = useCallback((tab: WorkspaceTabId) => {
    const stored = panelWidthsByTabRef.current[tab];
    const nextFiles = clampFilesWidth(
      stored.filesPanelWidth,
      stored.detailsPanelWidth,
    );
    const nextDetails = clampDetailsWidth(
      stored.detailsPanelWidth,
      nextFiles,
    );
    liveFilesWidth.current = nextFiles;
    liveDetailsWidth.current = nextDetails;
    setFilesWidth(nextFiles);
    setDetailsWidth(nextDetails);
  }, []);

  useEffect(() => {
    applyPanelWidthsForTab(workspaceTab);
  }, [workspaceTab, applyPanelWidthsForTab]);

  const setAndPersistDetailsWidth = useCallback(
    (width: number) => {
      const next = clampDetailsWidth(width, liveFilesWidth.current);
      liveDetailsWidth.current = next;
      setDetailsWidth(next);
      persistDetailsWidth(next);
    },
    [persistDetailsWidth],
  );

  const setAndPersistFilesWidth = useCallback(
    (width: number) => {
      const next = clampFilesWidth(width, liveDetailsWidth.current);
      liveFilesWidth.current = next;
      setFilesWidth(next);
      persistFilesWidth(next);
    },
    [persistFilesWidth],
  );

  const beginDetailsResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      detailsResizeStart.current = { x: event.clientX, width: detailsWidth };
      setResizingDetails(true);
    },
    [detailsWidth],
  );

  const moveDetailsResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!resizingDetails) return;
      const next = clampDetailsWidth(
        detailsResizeStart.current.width +
          detailsResizeStart.current.x -
          event.clientX,
        liveFilesWidth.current,
      );
      liveDetailsWidth.current = next;
      setDetailsWidth(next);
    },
    [resizingDetails],
  );

  const finishDetailsResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!resizingDetails) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setResizingDetails(false);
      persistDetailsWidth(liveDetailsWidth.current);
    },
    [persistDetailsWidth, resizingDetails],
  );

  const resizeDetailsWithKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      let next: number | null = null;
      if (event.key === 'ArrowLeft') next = detailsWidth + 16;
      else if (event.key === 'ArrowRight') next = detailsWidth - 16;
      else if (event.key === 'Home') next = MIN_DETAILS_WIDTH;
      else if (event.key === 'End') next = maxDetailsWidth(filesWidth);
      if (next === null) return;
      event.preventDefault();
      setAndPersistDetailsWidth(next);
    },
    [detailsWidth, filesWidth, setAndPersistDetailsWidth],
  );

  const beginFilesResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      filesResizeStart.current = { x: event.clientX, width: filesWidth };
      setResizingFiles(true);
    },
    [filesWidth],
  );

  const moveFilesResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!resizingFiles) return;
      const next = clampFilesWidth(
        filesResizeStart.current.width +
          event.clientX -
          filesResizeStart.current.x,
        liveDetailsWidth.current,
      );
      liveFilesWidth.current = next;
      setFilesWidth(next);
    },
    [resizingFiles],
  );

  const finishFilesResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!resizingFiles) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setResizingFiles(false);
      persistFilesWidth(liveFilesWidth.current);
    },
    [persistFilesWidth, resizingFiles],
  );

  const resizeFilesWithKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      let next: number | null = null;
      if (event.key === 'ArrowLeft') next = filesWidth - 16;
      else if (event.key === 'ArrowRight') next = filesWidth + 16;
      else if (event.key === 'Home') next = MIN_FILES_WIDTH;
      else if (event.key === 'End') next = MAX_FILES_WIDTH;
      if (next === null) return;
      event.preventDefault();
      setAndPersistFilesWidth(next);
    },
    [filesWidth, setAndPersistFilesWidth],
  );

  useEffect(() => {
    if (!resizingDetails && !resizingFiles) return;
    document.body.classList.add('resizing-panels');
    return () => document.body.classList.remove('resizing-panels');
  }, [resizingDetails, resizingFiles]);

  useEffect(() => {
    const onResize = () => {
      const nextFiles = clampFilesWidth(
        liveFilesWidth.current,
        liveDetailsWidth.current,
      );
      const nextDetails = clampDetailsWidth(
        liveDetailsWidth.current,
        nextFiles,
      );
      if (nextFiles !== liveFilesWidth.current) {
        liveFilesWidth.current = nextFiles;
        setFilesWidth(nextFiles);
      }
      if (nextDetails !== liveDetailsWidth.current) {
        liveDetailsWidth.current = nextDetails;
        setDetailsWidth(nextDetails);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const openFileValidationIssues = useMemo(() => {
    if (!fileContent || !validationReport) return null;
    const row = validationReport.files.find(
      (f) =>
        f.relativePath === fileContent.relativePath ||
        (selectedFileEntry != null && f.key === selectedFileEntry.key),
    );
    return row?.issues?.length ? row.issues : null;
  }, [fileContent, selectedFileEntry, validationReport]);

  const selectedIsOpenFileNode = Boolean(
    selectedNode &&
      selectedFileEntry &&
      (selectedNode.relativeKey === selectedFileEntry.key ||
        selectedNode.hostKey === selectedFileEntry.key ||
        selectedNode.id === selectedFileEntry.key ||
        (analysis != null && selectedNode.id === analysis.rootNodeId)),
  );

  const displayedNodeIssues =
    liveValidation &&
    liveValidation.relativePath === fileContent?.relativePath
      ? liveValidation.issues
      : selectedIsOpenFileNode && openFileValidationIssues
        ? openFileValidationIssues
        : (selectedNode?.issues ?? []);

  // Keep “Files with issues” in sync only from file-level live validation
  // (validateFile after edits). Never patch from selectedNode.issues — graph
  // root nodes often have an empty issues array because missing_file / similar
  // live on child nodes, which wrongly dropped the file from this filter until
  // clicking another node re-patched it.
  useEffect(() => {
    if (filterMode !== 'errors') return;
    if (!liveValidation || liveValidation.pending) return;
    if (!liveValidation.relativePath) return;
    patchValidationFile(liveValidation.relativePath, liveValidation.issues);
  }, [filterMode, liveValidation, patchValidationFile]);

  // Always omit the selected node's issues from the graph-level list. When live
  // validation clears a fix, analysis.issues can still be stale — those must not
  // reappear under "All issues" just because Node issues is empty.
  const otherGraphIssues = useMemo(() => {
    if (!analysis) return [];

    const shown = new Set(displayedNodeIssues.map(issueIdentity));
    const selectedIds = new Set(
      [
        selectedNode?.id,
        selectedNode?.relativeKey,
        selectedNode?.hostKey,
      ].filter((id): id is string => Boolean(id)),
    );

    return analysis.issues.filter((issue) => {
      if (issue.nodeId && selectedIds.has(issue.nodeId)) return false;
      return !shown.has(issueIdentity(issue));
    });
  }, [
    analysis,
    displayedNodeIssues,
    selectedNode?.hostKey,
    selectedNode?.id,
    selectedNode?.relativeKey,
  ]);

  const graphIssuesSection =
    displayedNodeIssues.length > 0
      ? {
          title: 'Other issues',
          issues: otherGraphIssues,
        }
      : {
          title: 'All issues',
          issues: otherGraphIssues,
        };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div
          className="topbar-brand"
          title={
            root
              ? `${activeLibraryName || 'Library'} — ${WORKSPACE_TAB_TITLE[workspaceTab]}`
              : undefined
          }
        >
          <h1>
            {root ? (
              <>
                <span className="topbar-library">
                  {activeLibraryName || 'Library'} —
                </span>{' '}
                {WORKSPACE_TAB_TITLE[workspaceTab]}
              </>
            ) : (
              'No library'
            )}
          </h1>
        </div>
        <div className="topbar-actions">
          <div className="open-library-wrap" ref={openLibraryMenuRef}>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void refreshLibraries().then(() =>
                  setOpenLibraryMenu((open) => !open),
                );
              }}
            >
              <Library size={16} /> Open Library
            </button>
            {openLibraryMenu ? (
              <div className="open-library-menu" role="menu">
                <div className="open-library-menu-title">Libraries</div>
                {libraries.map((lib) => (
                  <button
                    key={lib.id}
                    type="button"
                    role="menuitem"
                    className={lib.id === activeLibraryId ? 'active' : undefined}
                    onClick={() => void switchLibrary(lib.id)}
                  >
                    <strong>{lib.name}</strong>
                    <small>
                      {lib.wildcardsRoot
                        ? lib.wildcardsRoot.replace(/\\/g, '/')
                        : 'No wildcards folder'}
                    </small>
                  </button>
                ))}
                <div className="file-context-menu-separator" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenLibraryMenu(false);
                    setLibraryManagerOpen(true);
                  }}
                >
                  Manage libraries…
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-action"
            onClick={() => void undo()}
            disabled={!history.canUndo}
            title={history.undoLabel ? `Undo: ${history.undoLabel}` : 'Nothing to undo'}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            className="icon-action"
            onClick={() => void redo()}
            disabled={!history.canRedo}
            title={history.redoLabel ? `Redo: ${history.redoLabel}` : 'Nothing to redo'}
          >
            <Redo2 size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              const expandTab =
                workspaceTab === 'prompts' ||
                workspaceTab === 'generation' ||
                workspaceTab === 'wildcards'
                  ? workspaceTab
                  : 'wildcards';
              if (expandTab !== workspaceTab) setWorkspaceTab('wildcards');
              if (expandTab === 'prompts') {
                if (!promptsSelectedFolder) return;
                const snap = promptsGenRef.current;
                setExpandTarget({
                  kind: 'gen-file',
                  relativeFolder: promptsSelectedFolder,
                  content:
                    snap?.relativeFolder === promptsSelectedFolder
                      ? snap.content
                      : undefined,
                });
                return;
              }
              if (expandTab === 'generation') {
                const snap = generationExpandRef.current;
                if (!snap) return;
                setExpandTarget(snap);
                return;
              }
              if (rootFile) {
                setExpandTarget({ kind: 'wildcard', relativePath: rootFile });
              }
            }}
            disabled={
              workspaceTab === 'prompts'
                ? !promptsSelectedFolder
                : workspaceTab === 'generation'
                  ? false
                  : !rootFile
            }
            title={
              workspaceTab === 'prompts'
                ? promptsSelectedFolder
                  ? `Expand ${promptsSelectedFolder}/!gen.txt`
                  : 'Select a prompt folder to expand'
                : workspaceTab === 'generation'
                  ? 'Expand the prompt Once would queue for this seed and source'
                  : workspaceTab === 'wildcards'
                    ? 'Preview prompt expansions for the selected wildcard file'
                    : 'Expand the selected wildcard file (opens Wildcard files)'
            }
          >
            <Sparkles size={16} /> Expand
          </button>
          <button
            type="button"
            onClick={() => {
              if (workspaceTab !== 'wildcards') setWorkspaceTab('wildcards');
              void runSimulation();
            }}
            disabled={!rootFile || simBusy}
            title={
              workspaceTab === 'wildcards'
                ? `Run simulation now (${simSettings.iterations.toLocaleString()} iterations, seed ${simSettings.seed})`
                : `Simulate the selected wildcard (opens Wildcard files, ${simSettings.iterations.toLocaleString()} iterations, seed ${simSettings.seed})`
            }
          >
            {simBusy ? (
              <RefreshCw size={16} className="spin" />
            ) : (
              <Activity size={16} />
            )}{' '}
            {simBusy ? 'Simulating…' : 'Simulate'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (workspaceTab !== 'generation') setWorkspaceTab('generation');
              setCoverageOpen(true);
            }}
            title={
              coverageRunning
                ? `Coverage running — ${coverageProgress?.percent?.toFixed(0) ?? 0}%`
                : workspaceTab === 'generation'
                  ? 'Coverage — simulate all !gen.txt prompts and measure wildcard usage'
                  : 'Coverage — opens Generation and measures wildcard usage from every !gen.txt'
            }
          >
            {coverageRunning ? (
              <RefreshCw size={16} className="spin" />
            ) : (
              <PieChart size={16} />
            )}{' '}
            {coverageRunning
              ? `${Math.round(coverageProgress?.percent ?? 0)}%`
              : 'Coverage'}
          </button>
          <button
            type="button"
            className="icon-action"
            onClick={() => setGlobalSearchLauncherOpen(true)}
            title="Search wildcards, LoRAs, checkpoints"
          >
            <Search size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              void window.wcm.civitai.openBrowser().then((result) => {
                if (result.mode === 'modal') setCivitaiOpen(true);
              });
            }}
            title="Browse and download LoRAs / checkpoints from Civitai"
          >
            Civitai
          </button>
          <button
            type="button"
            onClick={() => {
              void window.wcm.huggingface.openBrowser();
            }}
            title="Search and download models from Hugging Face Hub"
          >
            HF
          </button>
          <button
            type="button"
            className="icon-action"
            onClick={() => setSimSettingsOpen(true)}
            title="Application settings"
          >
            <Settings2 size={16} />
          </button>
          <button
            type="button"
            onClick={() => void refresh({ rescanModels: true })}
            disabled={!root || busy}
          >
            <RefreshCw size={16} className={busy ? 'spin' : ''} /> Rebuild
          </button>
        </div>
      </header>

      {!root && initializing ? (
        <main className="welcome">
          <RefreshCw size={40} className="spin" />
          <h2>Loading your last library…</h2>
        </main>
      ) : !root ? (
        <main className="welcome">
          <Library size={52} />
          <h2>Open a library to begin</h2>
          <p>
            Choose a named configuration (wildcards + LoRA + checkpoint folders)
            or manage libraries to add a new one.
          </p>
          <div className="row-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                void refreshLibraries().then(() => setOpenLibraryMenu(true));
              }}
            >
              <Library size={16} /> Open Library
            </button>
            <button
              type="button"
              onClick={() => setLibraryManagerOpen(true)}
            >
              Manage libraries…
            </button>
          </div>
          {libraries.length > 0 ? (
            <div className="recent-list">
              <strong>Libraries</strong>
              {libraries.map((lib) => (
                <button
                  key={lib.id}
                  type="button"
                  onClick={() => void switchLibrary(lib.id)}
                >
                  <strong>{lib.name}</strong>
                  <span className="hint">
                    {lib.wildcardsRoot ?? 'No wildcards folder set'}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </main>
      ) : (
        <div className="workspace-host">
          <nav className="workspace-tabs segmented" aria-label="Workspace">
            <button
              type="button"
              className={workspaceTab === 'prompts' ? 'active' : undefined}
              onClick={() => setWorkspaceTab('prompts')}
            >
              Prompts
            </button>
            <button
              type="button"
              className={workspaceTab === 'generation' ? 'active' : undefined}
              onClick={() => setWorkspaceTab('generation')}
            >
              Generation
            </button>
            <button
              type="button"
              className={workspaceTab === 'wildcards' ? 'active' : undefined}
              onClick={() => setWorkspaceTab('wildcards')}
            >
              Wildcard files
            </button>
            <button
              type="button"
              className={workspaceTab === 'loras' ? 'active' : undefined}
              onClick={() => setWorkspaceTab('loras')}
            >
              LoRA files
            </button>
            <button
              type="button"
              className={workspaceTab === 'checkpoints' ? 'active' : undefined}
              onClick={() => setWorkspaceTab('checkpoints')}
            >
              Checkpoint files
            </button>
            <button
              type="button"
              className={workspaceTab === 'search' ? 'active' : undefined}
              onClick={() => setWorkspaceTab('search')}
            >
              Search
            </button>
          </nav>
          {promptsTabMounted ? (
            <PromptsWorkspace
              key={`prompts:${activeLibraryId ?? 'none'}`}
              active={workspaceTab === 'prompts'}
              filesWidth={filesWidth}
              detailsWidth={detailsWidth}
              wildcardKeys={wildcardKeys}
              selectedFolder={promptsSelectedFolder}
              onSelectedFolderChange={setPromptsSelectedFolder}
              onUseFolderForGeneration={useFolderForGeneration}
              generationRunRef={generationRunRef}
              genTextRef={promptsGenRef}
              onOpenCoverage={() => {
                setWorkspaceTab('generation');
                setCoverageOpen(true);
              }}
              coverageRunning={coverageRunning}
              coveragePercent={coverageProgress?.percent ?? 0}
              onOpenWildcard={(name) => {
                setWorkspaceTab('wildcards');
                void openWildcardFromEditor(name);
              }}
              onCreateWildcard={openCreateMissing}
              onRenameLora={(name) => setRenameLoraTarget(name)}
              onOpenLora={(name) => void openLoraInLoraTab(name)}
              onOpenLoraInCivitaiCatalog={openLoraInCivitaiCatalog}
              filesSplitter={{
                width: filesWidth,
                min: MIN_FILES_WIDTH,
                max: clampFilesWidth(MAX_FILES_WIDTH, detailsWidth),
                active: resizingFiles,
                label: 'Resize files panel',
                onPointerDown: beginFilesResize,
                onPointerMove: moveFilesResize,
                onPointerUp: finishFilesResize,
                onKeyDown: resizeFilesWithKeyboard,
                onReset: () => setAndPersistFilesWidth(DEFAULT_FILES_WIDTH),
              }}
              detailsSplitter={{
                width: detailsWidth,
                min: MIN_DETAILS_WIDTH,
                max: maxDetailsWidth(filesWidth),
                active: resizingDetails,
                label: 'Resize details panel',
                onPointerDown: beginDetailsResize,
                onPointerMove: moveDetailsResize,
                onPointerUp: finishDetailsResize,
                onKeyDown: resizeDetailsWithKeyboard,
                onReset: () =>
                  setAndPersistDetailsWidth(DEFAULT_DETAILS_WIDTH),
              }}
            />
          ) : null}
          {generationTabMounted ? (
            <GenerationWorkspace
              key={`generation:${activeLibraryId ?? 'none'}`}
              active={workspaceTab === 'generation'}
              filesWidth={filesWidth}
              detailsWidth={detailsWidth}
              selectedFolder={generationSelectedFolder}
              onSelectedFolderChange={setGenerationSelectedFolder}
              folderPick={generationFolderPick}
              runRef={generationRunRef}
              expandSnapshotRef={generationExpandRef}
              wildcardKeys={wildcardKeys}
              onOpenWildcard={(name) => {
                setWorkspaceTab('wildcards');
                void openWildcardFromEditor(name);
              }}
              onCreateWildcard={openCreateMissing}
              onRenameLora={(name) => setRenameLoraTarget(name)}
              onOpenLora={(name) => void openLoraInLoraTab(name)}
              onOpenLoraInCivitaiCatalog={openLoraInCivitaiCatalog}
              filesSplitter={{
                width: filesWidth,
                min: MIN_FILES_WIDTH,
                max: clampFilesWidth(MAX_FILES_WIDTH, detailsWidth),
                active: resizingFiles,
                label: 'Resize files panel',
                onPointerDown: beginFilesResize,
                onPointerMove: moveFilesResize,
                onPointerUp: finishFilesResize,
                onKeyDown: resizeFilesWithKeyboard,
                onReset: () => setAndPersistFilesWidth(DEFAULT_FILES_WIDTH),
              }}
              detailsSplitter={{
                width: detailsWidth,
                min: MIN_DETAILS_WIDTH,
                max: maxDetailsWidth(filesWidth),
                active: resizingDetails,
                label: 'Resize details panel',
                onPointerDown: beginDetailsResize,
                onPointerMove: moveDetailsResize,
                onPointerUp: finishDetailsResize,
                onKeyDown: resizeDetailsWithKeyboard,
                onReset: () =>
                  setAndPersistDetailsWidth(DEFAULT_DETAILS_WIDTH),
              }}
            />
          ) : null}
          {lorasTabMounted ? (
            <LoraFilesWorkspace
              key={`loras:${activeLibraryId ?? 'none'}`}
              active={workspaceTab === 'loras'}
              folderEpoch={modelFolderEpoch}
              filesWidth={filesWidth}
              detailsWidth={detailsWidth}
              pendingSelectPath={loraTabSelectPath}
              onPendingSelectConsumed={clearLoraTabSelectPath}
              onOpenInWildcardsTab={(relativePath) =>
                void openWildcardInWildcardsTab(relativePath)
              }
              onRenameLora={(stem) => setRenameLoraTarget(stem)}
              filesSplitter={{
                width: filesWidth,
                min: MIN_FILES_WIDTH,
                max: clampFilesWidth(MAX_FILES_WIDTH, detailsWidth),
                active: resizingFiles,
                label: 'Resize files panel',
                onPointerDown: beginFilesResize,
                onPointerMove: moveFilesResize,
                onPointerUp: finishFilesResize,
                onKeyDown: resizeFilesWithKeyboard,
                onReset: () => setAndPersistFilesWidth(DEFAULT_FILES_WIDTH),
              }}
              detailsSplitter={{
                width: detailsWidth,
                min: MIN_DETAILS_WIDTH,
                max: maxDetailsWidth(filesWidth),
                active: resizingDetails,
                label: 'Resize browser panel',
                onPointerDown: beginDetailsResize,
                onPointerMove: moveDetailsResize,
                onPointerUp: finishDetailsResize,
                onKeyDown: resizeDetailsWithKeyboard,
                onReset: () =>
                  setAndPersistDetailsWidth(DEFAULT_DETAILS_WIDTH),
              }}
            />
          ) : null}
          {checkpointsTabMounted ? (
            <CheckpointFilesWorkspace
              key={`checkpoints:${activeLibraryId ?? 'none'}`}
              active={workspaceTab === 'checkpoints'}
              folderEpoch={modelFolderEpoch}
              filesWidth={filesWidth}
              detailsWidth={detailsWidth}
              pendingSelectPath={checkpointTabSelectPath}
              onPendingSelectConsumed={clearCheckpointTabSelectPath}
              filesSplitter={{
                width: filesWidth,
                min: MIN_FILES_WIDTH,
                max: clampFilesWidth(MAX_FILES_WIDTH, detailsWidth),
                active: resizingFiles,
                label: 'Resize files panel',
                onPointerDown: beginFilesResize,
                onPointerMove: moveFilesResize,
                onPointerUp: finishFilesResize,
                onKeyDown: resizeFilesWithKeyboard,
                onReset: () => setAndPersistFilesWidth(DEFAULT_FILES_WIDTH),
              }}
              detailsSplitter={{
                width: detailsWidth,
                min: MIN_DETAILS_WIDTH,
                max: maxDetailsWidth(filesWidth),
                active: resizingDetails,
                label: 'Resize browser panel',
                onPointerDown: beginDetailsResize,
                onPointerMove: moveDetailsResize,
                onPointerUp: finishDetailsResize,
                onKeyDown: resizeDetailsWithKeyboard,
                onReset: () =>
                  setAndPersistDetailsWidth(DEFAULT_DETAILS_WIDTH),
              }}
            />
          ) : null}
          {searchTabMounted ? (
            <SearchWorkspace
              key={`search:${activeLibraryId ?? 'none'}`}
              active={workspaceTab === 'search'}
              query={globalSearchQuery}
              scopes={globalSearchScopes}
              refreshNonce={searchRefreshNonce}
              onQueryChange={setGlobalSearchQuery}
              onScopesChange={setGlobalSearchScopes}
              onOpenHit={openGlobalSearchHit}
            />
          ) : null}
        <main
          className={`workspace${workspaceTab === 'wildcards' ? '' : ' workspace-tab-hidden'}`}
          aria-hidden={workspaceTab !== 'wildcards'}
          style={
            {
              '--files-panel-width': `${filesWidth}px`,
              '--details-panel-width': `${detailsWidth}px`,
            } as CSSProperties
          }
        >
          <aside className="sidebar files-sidebar">
            <div className="sidebar-head">
              <strong>Wildcard files</strong>
              <div className="head-actions">
                <span>
                  {visibleFiles.length}
                  {visibleFiles.length !== files.length ? `/${files.length}` : ''}
                </span>
                <button
                  type="button"
                  className="ghost-btn icon-only"
                  title="LoRA download categories (folder + wildcard)"
                  onClick={() =>
                    setLoraCategoryManager({ open: true, focusWildcardPath: null })
                  }
                >
                  <Tags size={15} />
                </button>
                <button
                  type="button"
                  className="ghost-btn icon-only"
                  title="New wildcard file"
                  onClick={() => {
                    setCreateDescendantParent(null);
                    setCreateInitialPath('');
                    setCreateOpen(true);
                  }}
                >
                  <FilePlus size={15} />
                </button>
              </div>
            </div>
            <label className="search-box">
              <Search size={14} />
              <input
                type="search"
                placeholder="Filter files…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <label className="filter-row">
              <Filter size={13} />
              <select
                value={filterMode}
                onChange={(e) =>
                  setFilterMode(
                    e.target.value as typeof filterMode,
                  )
                }
              >
                <option value="all">All files</option>
                <option value="roots">Roots · no parents</option>
                <option value="leaves">Leaves · no children</option>
                <option value="standalone">Standalone · no parents or children</option>
                <option value="invalid">Empty / invalid files</option>
                <option value="errors">
                  Files with issues
                  {validationBusy
                    ? '…'
                    : validationReport
                      ? ` (${validationReport.filesWithIssues})`
                      : ''}
                </option>
                <option value="lora">Has LoRA tags</option>
              </select>
            </label>
            {filterMode === 'errors' && validationBusy ? (
              <p className="hint validation-progress">Scanning wildcards…</p>
            ) : null}
            <div className="file-list file-list-dense">
              {visibleFiles.map((file) => {
                const issueRow = validationIssueByKey.get(file.key);
                return (
                <button
                  type="button"
                  key={file.relativePath}
                  className={rootFile === file.relativePath ? 'selected' : ''}
                  title={
                    issueRow
                      ? `${file.relativePath} · ${issueRow.errorCount} error(s), ${issueRow.warningCount} warning(s)`
                      : `Use ${file.relativePath} as graph root`
                  }
                  onClick={() => void analyze(file.relativePath, { fitView: true })}
                  onContextMenu={(event) => openFileContextMenu(file, event)}
                >
                  <span>{file.key}</span>
                  <small>
                    {issueRow && (issueRow.errorCount > 0 || issueRow.warningCount > 0)
                      ? `${issueRow.errorCount}E/${issueRow.warningCount}W`
                      : file.ext}
                  </small>
                </button>
                );
              })}
            </div>
          </aside>

          <div
            className={`panel-splitter files-splitter${resizingFiles ? ' active' : ''}`}
            role="separator"
            aria-label="Resize files panel"
            aria-orientation="vertical"
            aria-valuemin={MIN_FILES_WIDTH}
            aria-valuemax={clampFilesWidth(MAX_FILES_WIDTH, detailsWidth)}
            aria-valuenow={filesWidth}
            tabIndex={0}
            title={`Files width: ${filesWidth}px · drag or use arrow keys · double-click to reset`}
            onPointerDown={beginFilesResize}
            onPointerMove={moveFilesResize}
            onPointerUp={finishFilesResize}
            onPointerCancel={finishFilesResize}
            onKeyDown={resizeFilesWithKeyboard}
            onDoubleClick={() => setAndPersistFilesWidth(DEFAULT_FILES_WIDTH)}
          >
            <span />
          </div>

          <section className="graph-panel" aria-label="Wildcard dependency graph">
            {analysis ? (
              <>
                <div className="graph-stats">
                  <span>{analysis.stats.nodeCount} nodes</span>
                  <span>{analysis.stats.edgeCount} links</span>
                  <span className={analysis.stats.errorCount ? 'danger' : ''}>
                    {analysis.stats.errorCount} errors
                  </span>
                  <span>{analysis.stats.warningCount} warnings</span>
                  <span title="Drawn nodes in the focused cone (analysis may be larger)">
                    showing {flow.view?.visibleCount ?? 0}
                  </span>
                  <span title="Graph shows at most this many link levels below the focused node">
                    ≤ {flow.view?.maxLevels ?? DEFAULT_MAX_LEVELS} levels
                  </span>
                  {flow.view && flow.view.truncatedCount > 0 ? (
                    <span
                      className="warn-pill"
                      title="Some branches continue beyond the drawn cone — click a dashed +N more node to drill in"
                    >
                      {flow.view.truncatedCount} cut
                    </span>
                  ) : null}
                  {flow.view?.breadthLimited ? (
                    <span
                      className="warn-pill"
                      title="Wide fan-out is capped so the graph stays responsive"
                    >
                      breadth limited
                    </span>
                  ) : null}
                </div>
                {flow.view &&
                (flow.view.focusId !== analysis.rootNodeId ||
                  flow.view.hasAncestors) ? (
                  <div className="focus-bar">
                    <Crosshair size={13} />
                    <span className="focus-label" title={flow.view.focusLabel}>
                      {flow.view.focusLabel}
                    </span>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => {
                        setFocusId(null);
                        if (analysis) {
                          const uncapped = estimateUncappedVisibleCount(
                            buildAdjacency(analysis.edges),
                            analysis.rootNodeId,
                            DEFAULT_MAX_LEVELS,
                          );
                          setGraphMaxLevels(
                            uncapped > WIDE_GRAPH_UNCAPPED_THRESHOLD
                              ? 1
                              : DEFAULT_MAX_LEVELS,
                          );
                        } else {
                          setGraphMaxLevels(DEFAULT_MAX_LEVELS);
                        }
                      }}
                      title="Show the whole tree from the root again"
                    >
                      <X size={12} /> Reset focus
                    </button>
                  </div>
                ) : null}
                {simResult ? (
                  <div className="sim-legend">
                    <div className="sim-legend-head">
                      <Activity size={13} /> Sibling balance
                      <span>
                        {simResult.iterations.toLocaleString()} runs · seed{' '}
                        {simResult.seed}
                      </span>
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={simExportBusy}
                        onClick={() => void exportSimulation()}
                        title="Export every simulated line to a text file, with a blank line between runs"
                      >
                        <FileDown size={13} /> {simExportBusy ? 'Exporting…' : 'Export'}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => setSimResult(null)}
                        title="Clear simulation overlay"
                      >
                        <Eraser size={13} /> Clear
                      </button>
                    </div>
                    <div className="sim-gradient" />
                    <div className="sim-legend-scale">
                      <span>rare vs siblings</span>
                      <span>mixed</span>
                      <span>even</span>
                    </div>
                    <p className="sim-legend-note">
                      Label % = share of the parent’s selections. Colour =
                      balance among siblings under that parent.
                    </p>
                  </div>
                ) : null}
                <ReactFlow
                  key={rootFile ?? analysis.rootNodeId}
                  nodes={flow.nodes}
                  edges={flow.edges}
                  minZoom={0.1}
                  onlyRenderVisibleElements
                  nodesDraggable={false}
                  nodesConnectable={false}
                  edgesReconnectable={false}
                  elementsSelectable={false}
                  elevateNodesOnSelect={false}
                  elevateEdgesOnSelect={false}
                  autoPanOnNodeFocus={false}
                  zoomOnDoubleClick={false}
                  proOptions={{ hideAttribution: true }}
                  onInit={(instance) => {
                    reactFlowRef.current = instance;
                    // Remount finishes after analyze queues a center — kick a
                    // layout tick so the pending-center effect can see the instance.
                    if (pendingCenterNodeRef.current) {
                      window.requestAnimationFrame(() => {
                        const id = pendingCenterNodeRef.current;
                        if (!id || reactFlowRef.current !== instance) return;
                        const flowNode = instance.getNode(id);
                        if (!flowNode) return;
                        const width =
                          flowNode.measured?.width ??
                          flowNode.width ??
                          FLOW_NODE_WIDTH;
                        const height =
                          flowNode.measured?.height ??
                          flowNode.height ??
                          FLOW_NODE_HEIGHT;
                        pendingCenterNodeRef.current = null;
                        shouldFitViewRef.current = false;
                        void instance.setCenter(
                          flowNode.position.x + width / 2,
                          flowNode.position.y + height / 2,
                          {
                            zoom: instance.getZoom(),
                            duration: 250,
                          },
                        );
                      });
                    }
                  }}
                  onNodeClick={(_event, node) =>
                    void handleGraphNodeClick(node.id)
                  }
                  onNodeDoubleClick={(_event, node) =>
                    void handleGraphNodeDoubleClick(node.id)
                  }
                  onNodeContextMenu={(event, node) => {
                    openGraphNodeContextMenu(node.id, event);
                  }}
                >
                  <Controls />
                  {(flow.view?.visibleCount ?? 0) < MINIMAP_NODE_THRESHOLD ? (
                    <MiniMap pannable zoomable />
                  ) : null}
                </ReactFlow>
              </>
            ) : (
              <div className="empty">Choose a wildcard file.</div>
            )}
          </section>

          <div
            className={`panel-splitter details-splitter${resizingDetails ? ' active' : ''}`}
            role="separator"
            aria-label="Resize details panel"
            aria-orientation="vertical"
            aria-valuemin={MIN_DETAILS_WIDTH}
            aria-valuemax={maxDetailsWidth(filesWidth)}
            aria-valuenow={detailsWidth}
            tabIndex={0}
            title={`Details width: ${detailsWidth}px · drag or use arrow keys · double-click to reset`}
            onPointerDown={beginDetailsResize}
            onPointerMove={moveDetailsResize}
            onPointerUp={finishDetailsResize}
            onPointerCancel={finishDetailsResize}
            onKeyDown={resizeDetailsWithKeyboard}
            onDoubleClick={() =>
              setAndPersistDetailsWidth(DEFAULT_DETAILS_WIDTH)
            }
          >
            <span />
          </div>

          <aside className="sidebar details-sidebar">
            <div className="sidebar-head details-sidebar-head">
              <strong className="details-head-label">Details</strong>
              {selectedNode ? (
                <>
                  <div className="details-head-center">
                    {(selectedNode.relativeKey ?? selectedNode.label).includes(
                      '/',
                    ) ? (
                      <nav
                        className="details-breadcrumb"
                        aria-label="Selected wildcard path"
                      >
                        {(selectedNode.relativeKey ?? selectedNode.label)
                          .split('/')
                          .filter(Boolean)
                          .map((segment, index, parts) => (
                            <span
                              key={`${segment}-${index}`}
                              className="details-crumb"
                            >
                              {index > 0 ? (
                                <span className="details-crumb-sep" aria-hidden>
                                  ›
                                </span>
                              ) : null}
                              <span
                                className={
                                  index === parts.length - 1
                                    ? 'details-crumb-leaf'
                                    : undefined
                                }
                                title={segment}
                              >
                                {segment}
                              </span>
                            </span>
                          ))}
                      </nav>
                    ) : (
                      <h2
                        className="details-head-title"
                        title={selectedNode.label}
                      >
                        {selectedNode.label}
                      </h2>
                    )}
                  </div>
                  <div className="details-head-right">
                    <span className="details-io">
                      {selectedNode.outboundCount} outgoing ·{' '}
                      {selectedNode.inboundCount} incoming
                    </span>
                  </div>
                </>
              ) : null}
            </div>
            {selectedNode ? (
              <>
                {simResult &&
                (selectedNode.kind === 'file' ||
                  selectedNode.kind === 'root' ||
                  selectedNode.kind === 'yamlKey') ? (
                  <section className="sim-stat">
                    <h3>Simulation</h3>
                    <div
                      className="sim-stat-bar"
                      style={{
                        background: balanceColor(selectedSim?.balance ?? 0).bg,
                        color: balanceColor(selectedSim?.balance ?? 0).text,
                      }}
                    >
                      {selectedSim?.parentShare !== undefined
                        ? `${formatSharePct(selectedSim.parentShare)} of parent`
                        : 'Top of view'}
                    </div>
                    <p className="hint">
                      {selectedSim?.parentShare !== undefined && selectedSim.parentLabel
                        ? `Share of ${selectedSim.parentLabel} · `
                        : ''}
                      Sibling balance {((selectedSim?.balance ?? 0) * 100).toFixed(0)}%
                      · overall reach{' '}
                      {formatSharePct(selectedSim?.reachRate ?? 0)} (
                      {selectedSim?.hits ?? 0}/{simResult.iterations.toLocaleString()}{' '}
                      runs).
                    </p>
                  </section>
                ) : null}
                {selectedFileEntry &&
                selectedNode.relativeKey === selectedFileEntry.key ? (
                  <section>
                    <div className="manage-toolbar" role="toolbar" aria-label="File actions">
                      <button
                        type="button"
                        className="manage-tool"
                        title={
                          categoryForSelectedWildcard
                            ? `Edit LoRA download category “${categoryForSelectedWildcard.name}”`
                            : 'Create a LoRA download category that appends downloads to this wildcard'
                        }
                        onClick={() =>
                          setLoraCategoryManager({
                            open: true,
                            focusWildcardPath: selectedFileEntry.relativePath,
                          })
                        }
                      >
                        <Tags size={15} />
                        <span>
                          {categoryForSelectedWildcard
                            ? 'Edit as Category'
                            : 'Set as Category'}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="manage-tool"
                        title="Rename / move — update every reference across the library"
                        onClick={() => setRenameTarget(selectedFileEntry.relativePath)}
                      >
                        <Pencil size={15} />
                        <span>Rename</span>
                      </button>
                      <button
                        type="button"
                        className="manage-tool"
                        title="Convert to child node — move contents into a new child and leave a single reference here"
                        onClick={() =>
                          setConvertChildTarget(selectedFileEntry.relativePath)
                        }
                      >
                        <CornerDownRight size={15} />
                        <span>Convert</span>
                      </button>
                      <button
                        type="button"
                        className="manage-tool"
                        title="Create descendant — new empty file plus a reference line in this file"
                        onClick={() =>
                          openCreateDescendant(selectedFileEntry.relativePath)
                        }
                      >
                        <FileInput size={15} />
                        <span>Descendant</span>
                      </button>
                      <button
                        type="button"
                        className="manage-tool"
                        title="Consolidate forwarder — redirect callers onto the target, then delete this forwarder"
                        onClick={() => void openConsolidate()}
                      >
                        <GitMerge size={15} />
                        <span>Consolidate</span>
                      </button>
                      <button
                        type="button"
                        className="manage-tool"
                        title="Absorb target · keep name — move the target’s contents here and delete the target"
                        onClick={() => void openAbsorb()}
                      >
                        <Combine size={15} />
                        <span>Absorb</span>
                      </button>
                      <button
                        type="button"
                        className="manage-tool"
                        title="Prompt local LM Studio — review or propose edits; never writes without your confirmation"
                        onClick={() => setLmStudioPromptOpen(true)}
                      >
                        <Sparkles size={15} />
                        <span>Prompt</span>
                      </button>
                      {coverageReport ? (
                        (coverageReport.ignoredKeys ?? []).includes(
                          selectedFileEntry.key,
                        ) ? (
                          <button
                            type="button"
                            className="manage-tool"
                            title="Show again under Coverage → Never Used"
                            onClick={() =>
                              void patchCoverageIgnoreKey(
                                selectedFileEntry.key,
                                'remove',
                              )
                            }
                          >
                            <Eye size={15} />
                            <span>Coverage</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="manage-tool"
                            title="Hide from Coverage → Never Used (keep as a rare tool wildcard)"
                            onClick={() =>
                              void patchCoverageIgnoreKey(
                                selectedFileEntry.key,
                                'add',
                              )
                            }
                          >
                            <EyeOff size={15} />
                            <span>Ignore</span>
                          </button>
                        )
                      ) : null}
                      <button
                        type="button"
                        className="manage-tool danger-text"
                        title="Delete file — remove this file and clean up inbound references"
                        onClick={() => setDeleteTarget(selectedFileEntry.relativePath)}
                      >
                        <Trash2 size={15} />
                        <span>Delete</span>
                      </button>
                    </div>
                  </section>
                ) : null}
                {selectedNode.kind === 'missing' &&
                selectedNode.relativeKey ? (
                  <section>
                    <h3>Resolve missing file</h3>
                    <div className="manage-actions">
                      <button
                        type="button"
                        className="manage-btn"
                        onClick={() => {
                          setCreateDescendantParent(null);
                          setCreateInitialPath(selectedNode.relativeKey!);
                          setCreateOpen(true);
                        }}
                      >
                        <FilePlus size={14} /> Create file…
                      </button>
                      <button
                        type="button"
                        className="manage-btn danger-text"
                        onClick={() =>
                          setCleanupMissingTarget(selectedNode.relativeKey!)
                        }
                      >
                        <Eraser size={14} /> Remove all references…
                      </button>
                    </div>
                    <p className="hint">
                      Create <code>{selectedNode.relativeKey}.txt</code> and
                      select it, or remove every{' '}
                      <code>__{selectedNode.relativeKey}__</code> reference.
                      Both actions are undoable.
                    </p>
                  </section>
                ) : null}
                <div
                  className={`details-editor-stack${
                    displayedNodeIssues.length > 0 ||
                    graphIssuesSection.issues.length > 0
                      ? ' has-issues'
                      : ''
                  }${fileContent ? ' has-editor' : ''}`}
                >
                  {fileContent ? (
                    <section className="source-section">
                      <WildcardEditor
                        key={fileContent.relativePath}
                        ref={editorRef}
                        className="wildcard-editor details-wildcard-editor"
                        value={editText}
                        onChange={updateEditText}
                        onBlur={() => {
                          const text = editTextRef.current;
                          setEditText(text);
                          setValidationText(text);
                          void flushDraft(undefined, { rebuild: true });
                        }}
                        readOnly={false}
                        fileExt={selectedFileEntry?.ext ?? '.txt'}
                        wildcardKeys={wildcardKeys}
                        onOpenWildcard={(name) => void openWildcardFromEditor(name)}
                        onCreateWildcard={openCreateMissing}
                        onRenameLora={(name) => setRenameLoraTarget(name)}
                        onOpenLora={(name) => void openLoraInLoraTab(name)}
                        onOpenLoraInCivitaiCatalog={openLoraInCivitaiCatalog}
                      />
                    </section>
                  ) : null}
                  {displayedNodeIssues.length > 0 ||
                  graphIssuesSection.issues.length > 0 ? (
                    <div className="details-issues">
                      {displayedNodeIssues.length > 0 ? (
                        <section>
                          <div className="source-head">
                            <h3>
                              Node issues
                              {liveValidation?.pending ? ' · validating…' : ''}
                            </h3>
                            {fileContent ? (
                              <span
                                className={`save-status save-status-${saveStatus}`}
                                role="status"
                              >
                                {saveStatus === 'saving'
                                  ? 'Saving…'
                                  : saveStatus === 'dirty'
                                    ? 'Unsaved'
                                    : saveStatus === 'error'
                                      ? 'Save failed'
                                      : 'Saved'}
                              </span>
                            ) : null}
                          </div>
                          <IssueList
                            issues={displayedNodeIssues}
                            onSelect={handleIssueSelect}
                            onCreateMissing={openCreateMissing}
                            onOpenRelatedPath={(relativePath) => {
                              setLoraTabSelectPath(relativePath.replace(/\\/g, '/'));
                              setWorkspaceTab('loras');
                            }}
                          />
                        </section>
                      ) : (
                        <div className="node-status-row">
                          <p className="ok-row">
                            <CheckCircle2 size={15} />{' '}
                            <span>
                              {liveValidation?.pending
                                ? 'Validating changes…'
                                : 'No issues on this node'}
                            </span>
                          </p>
                          {fileContent ? (
                            <span
                              className={`save-status save-status-${saveStatus}`}
                              role="status"
                            >
                              {saveStatus === 'saving'
                                ? 'Saving…'
                                : saveStatus === 'dirty'
                                  ? 'Unsaved'
                                  : saveStatus === 'error'
                                    ? 'Save failed'
                                    : 'Saved'}
                            </span>
                          ) : null}
                        </div>
                      )}
                      <section>
                        <div className="source-head">
                          <h3>
                            {graphIssuesSection.title} ({graphIssuesSection.issues.length})
                            {issuesRefreshing ? ' · refreshing…' : ''}
                          </h3>
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => void refreshGraphIssues()}
                            disabled={!rootFile || issuesRefreshing || busy}
                            title="Re-check all issues, including a fresh scan of the LoRA folder for unused files"
                          >
                            <RefreshCw
                              size={13}
                              className={issuesRefreshing ? 'spin' : ''}
                            />{' '}
                            Refresh
                          </button>
                        </div>
                        {graphIssuesSection.issues.length > 0 ? (
                          <IssueList
                            issues={graphIssuesSection.issues}
                            showNode
                            onSelect={handleIssueSelect}
                            onCreateMissing={openCreateMissing}
                            onIgnoreUnusedLora={setIgnoreLoraIssue}
                            onCopyUnusedLoraRef={(issue) =>
                              void copyUnusedLoraRef(issue)
                            }
                            onCategorizeUnusedLora={setCategorizeLoraIssue}
                            onFixUnusedLoraSeries={(issue) =>
                              void extendUnusedLoraSeries(issue)
                            }
                            onOpenRelatedPath={(relativePath) => {
                              setLoraTabSelectPath(relativePath.replace(/\\/g, '/'));
                              setWorkspaceTab('loras');
                            }}
                          />
                        ) : (
                          <p className="ok-row">
                            <CheckCircle2 size={15} />{' '}
                            <span>
                              {displayedNodeIssues.length > 0
                                ? 'No other issues in the graph'
                                : 'Graph is valid'}
                            </span>
                          </p>
                        )}
                      </section>
                    </div>
                  ) : (
                    <div className="details-status-line">
                      <p className="ok-row">
                        <CheckCircle2 size={15} />{' '}
                        <span>
                          {liveValidation?.pending
                            ? 'Validating changes…'
                            : 'No issues on this node'}
                        </span>
                      </p>
                      <p className="ok-row">
                        <CheckCircle2 size={15} />{' '}
                        <span>
                          {graphIssuesSection.title} (0) · Graph is valid
                        </span>
                      </p>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => void refreshGraphIssues()}
                        disabled={!rootFile || issuesRefreshing || busy}
                        title="Re-check all issues, including a fresh scan of the LoRA folder for unused files"
                      >
                        <RefreshCw
                          size={13}
                          className={issuesRefreshing ? 'spin' : ''}
                        />{' '}
                        Refresh
                      </button>
                      {fileContent ? (
                        <span
                          className={`save-status save-status-${saveStatus}`}
                          role="status"
                        >
                          {saveStatus === 'saving'
                            ? 'Saving…'
                            : saveStatus === 'dirty'
                              ? 'Unsaved'
                              : saveStatus === 'error'
                                ? 'Save failed'
                                : 'Saved'}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty">Select a graph node.</div>
            )}
          </aside>
        </main>
        </div>
      )}

      {fileContextMenu ? (
        <div
          ref={fileContextMenuRef}
          className="file-context-menu"
          role="menu"
          aria-label={`Actions for ${fileContextMenu.file.relativePath}`}
          style={{ left: fileContextMenu.x, top: fileContextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="file-context-menu-title">
            {fileContextMenu.file.relativePath}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const file = fileContextMenu.file;
              setFileContextMenu(null);
              void analyze(file.relativePath, { fitView: true });
            }}
          >
            <Crosshair size={14} /> Open as graph root
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const file = fileContextMenu.file;
              setFileContextMenu(null);
              void openExternal(file.relativePath);
            }}
          >
            <ExternalLink size={14} /> Open externally
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const reference = `__${fileContextMenu.file.key}__`;
              setFileContextMenu(null);
              void navigator.clipboard
                .writeText(reference)
                .then(() => flashNotice(`Copied ${reference}`))
                .catch((err) =>
                  setError(err instanceof Error ? err.message : String(err)),
                );
            }}
          >
            <Copy size={14} /> Copy wildcard reference
          </button>
          {coverageReport ? (
            (coverageReport.ignoredKeys ?? []).includes(
              fileContextMenu.file.key,
            ) ? (
              <button
                type="button"
                role="menuitem"
                title="Show again under Coverage → Never Used"
                onClick={() => {
                  const key = fileContextMenu.file.key;
                  setFileContextMenu(null);
                  void patchCoverageIgnoreKey(key, 'remove');
                }}
              >
                <Eye size={14} /> Coverage: stop ignoring
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                title="Hide from Coverage → Never Used (keep as a rare tool wildcard)"
                onClick={() => {
                  const key = fileContextMenu.file.key;
                  setFileContextMenu(null);
                  void patchCoverageIgnoreKey(key, 'add');
                }}
              >
                <EyeOff size={14} /> Coverage: ignore in Never Used
              </button>
            )
          ) : null}
          <div className="file-context-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const file = fileContextMenu.file;
              setFileContextMenu(null);
              setRenameTarget(file.relativePath);
            }}
          >
            <Pencil size={14} /> Rename / move…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const file = fileContextMenu.file;
              setFileContextMenu(null);
              setConvertChildTarget(file.relativePath);
            }}
          >
            <CornerDownRight size={14} /> Convert to child node…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const file = fileContextMenu.file;
              setFileContextMenu(null);
              openCreateDescendant(file.relativePath);
            }}
          >
            <FileInput size={14} /> Create descendant…
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger-text"
            onClick={() => {
              const file = fileContextMenu.file;
              setFileContextMenu(null);
              setDeleteTarget(file.relativePath);
            }}
          >
            <Trash2 size={14} /> Delete file…
          </button>
        </div>
      ) : null}

      {graphNodeContextMenu && analysis
        ? (() => {
            const node =
              analysis.nodes.find((n) => n.id === graphNodeContextMenu.nodeId) ??
              null;
            if (!node) return null;
            const entry = fileEntryForGraphNode(node, files);
            const manageable = isManageableGraphNode(node, entry);
            const missing = node.kind === 'missing' && Boolean(node.relativeKey);
            const title =
              entry?.relativePath ?? node.relativeKey ?? node.label ?? node.id;

            const selectThen = (action: () => void) => {
              focusAndSelect(node.id);
              setGraphNodeContextMenu(null);
              action();
            };

            return (
              <div
                ref={graphNodeContextMenuRef}
                className="file-context-menu graph-node-context-menu"
                role="menu"
                aria-label={`Manage actions for ${title}`}
                style={{
                  left: graphNodeContextMenu.x,
                  top: graphNodeContextMenu.y,
                }}
                onContextMenu={(event) => event.preventDefault()}
              >
                <div className="file-context-menu-title">{title}</div>
                {manageable && entry ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      title="F2"
                      onClick={() =>
                        selectThen(() => setRenameTarget(entry.relativePath))
                      }
                    >
                      <Pencil size={14} /> Rename / move…
                      <span className="menu-shortcut">F2</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() =>
                        selectThen(() =>
                          setConvertChildTarget(entry.relativePath),
                        )
                      }
                    >
                      <CornerDownRight size={14} /> Convert to child…
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() =>
                        selectThen(() =>
                          openCreateDescendant(entry.relativePath),
                        )
                      }
                    >
                      <FileInput size={14} /> Create descendant…
                    </button>
                    {coverageReport ? (
                      (coverageReport.ignoredKeys ?? []).includes(entry.key) ? (
                        <button
                          type="button"
                          role="menuitem"
                          title="Show again under Coverage → Never Used"
                          onClick={() =>
                            selectThen(() => {
                              void patchCoverageIgnoreKey(entry.key, 'remove');
                            })
                          }
                        >
                          <Eye size={14} /> Coverage: stop ignoring
                        </button>
                      ) : (
                        <button
                          type="button"
                          role="menuitem"
                          title="Hide from Coverage → Never Used (keep as a rare tool wildcard)"
                          onClick={() =>
                            selectThen(() => {
                              void patchCoverageIgnoreKey(entry.key, 'add');
                            })
                          }
                        >
                          <EyeOff size={14} /> Coverage: ignore in Never Used
                        </button>
                      )
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() =>
                        selectThen(() =>
                          setConsolidateTarget(entry.relativePath),
                        )
                      }
                    >
                      <GitMerge size={14} /> Consolidate…
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() =>
                        selectThen(() => setAbsorbTarget(entry.relativePath))
                      }
                    >
                      <Combine size={14} /> Absorb…
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="danger-text"
                      title="Delete"
                      onClick={() =>
                        selectThen(() => setDeleteTarget(entry.relativePath))
                      }
                    >
                      <Trash2 size={14} /> Delete file…
                      <span className="menu-shortcut">Del</span>
                    </button>
                  </>
                ) : null}
                {missing ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() =>
                        selectThen(() => {
                          setCreateInitialPath(node.relativeKey!);
                          setCreateOpen(true);
                        })
                      }
                    >
                      <FilePlus size={14} /> Create file…
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="danger-text"
                      title="Delete"
                      onClick={() =>
                        selectThen(() =>
                          setCleanupMissingTarget(node.relativeKey!),
                        )
                      }
                    >
                      <Eraser size={14} /> Remove all references…
                      <span className="menu-shortcut">Del</span>
                    </button>
                  </>
                ) : null}
                {!manageable && !missing ? (
                  <button type="button" role="menuitem" disabled>
                    No file manage actions
                  </button>
                ) : null}
                <div className="file-context-menu-separator" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  title="Insert"
                  onClick={() =>
                    selectThen(() => {
                      setCreateDescendantParent(null);
                      setCreateInitialPath('');
                      setCreateOpen(true);
                    })
                  }
                >
                  <FilePlus size={14} /> New wildcard file…
                  <span className="menu-shortcut">Ins</span>
                </button>
              </div>
            );
          })()
        : null}

      {consolidateTarget ? (
        <ConsolidateModal
          relativePath={consolidateTarget}
          onCancel={() => setConsolidateTarget(null)}
          onConfirm={runConsolidate}
        />
      ) : null}

      {absorbTarget ? (
        <AbsorbModal
          relativePath={absorbTarget}
          onCancel={() => setAbsorbTarget(null)}
          onConfirm={runAbsorb}
        />
      ) : null}

      {createOpen ? (
        <CreateFileModal
          initialValue={createInitialPath}
          descendantOf={createDescendantParent}
          onCancel={() => {
            setCreateOpen(false);
            setCreateInitialPath('');
            setCreateDescendantParent(null);
          }}
          onCreate={runCreate}
        />
      ) : null}

      {renameTarget ? (
        <RenameModal
          relativePath={renameTarget}
          onCancel={() => setRenameTarget(null)}
          onRename={runRename}
        />
      ) : null}

      {libraryManagerOpen ? (
        <LibraryManagerModal
          onClose={() => setLibraryManagerOpen(false)}
          onChanged={async (switchResult) => {
            await refreshLibraries();
            if (switchResult) {
              await applyLibrarySwitch(switchResult);
            } else if (rootFile) {
              await refresh();
            }
          }}
        />
      ) : null}

      {loraCategoryManager.open ? (
        <LoraDownloadCategoryManagerModal
          focusWildcardPath={loraCategoryManager.focusWildcardPath}
          onClose={() => setLoraCategoryManager({ open: false })}
          onChanged={(list) => setLoraDownloadCategories(list)}
        />
      ) : null}

      {renameLoraTarget ? (
        <RenameLoraModal
          sourceName={renameLoraTarget}
          onCancel={() => setRenameLoraTarget(null)}
          onRename={runRenameLora}
        />
      ) : null}

      {convertChildTarget ? (
        <ConvertToChildModal
          relativePath={convertChildTarget}
          childSuffix={convertChildSuffix}
          onCancel={() => setConvertChildTarget(null)}
          onConvert={runConvertToChild}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteModal
          relativePath={deleteTarget}
          inbound={
            refStats.get(
              files.find((f) => f.relativePath === deleteTarget)?.key ?? '',
            )?.inbound ?? 0
          }
          onCancel={() => setDeleteTarget(null)}
          onDelete={runDelete}
        />
      ) : null}

      {lmStudioPromptOpen && selectedFileEntry ? (
        <LmStudioPromptModal
          relativePath={selectedFileEntry.relativePath}
          currentText={
            autosaveDraftRef.current?.relativePath ===
            selectedFileEntry.relativePath
              ? autosaveDraftRef.current.text
              : editTextRef.current
          }
          onCancel={() => setLmStudioPromptOpen(false)}
          onApply={async (proposedText) => {
            const relativePath = selectedFileEntry.relativePath;
            editTextRef.current = proposedText;
            setEditText(proposedText);
            setValidationText(proposedText);
            editorRef.current?.setExternalValue(proposedText);
            const draft = autosaveDraftRef.current;
            if (draft?.relativePath === relativePath) {
              draft.text = proposedText;
              if (draft.timer !== null) {
                window.clearTimeout(draft.timer);
                draft.timer = null;
              }
            }
            await flushDraftRef.current({ rebuild: true });
            setLmStudioPromptOpen(false);
            flashNotice(`Applied AI proposal to ${relativePath}`);
          }}
        />
      ) : null}

      {cleanupMissingTarget ? (
        <CleanupMissingModal
          referenceName={cleanupMissingTarget}
          onCancel={() => setCleanupMissingTarget(null)}
          onConfirm={runCleanupMissing}
        />
      ) : null}

      {cycleIssue && rootFile ? (
        <CycleResolverModal
          rootRelativePath={rootFile}
          issue={cycleIssue}
          onCancel={() => setCycleIssue(null)}
          onApply={runCycleFix}
          onOpenInEditor={(suggestion) => {
            setCycleIssue(null);
            pendingJumpRef.current = {
              line: suggestion.line,
              column: suggestion.column,
              nodeId: suggestion.from,
            };
            focusAndSelect(suggestion.from);
          }}
        />
      ) : null}

      {ignoreLoraIssue?.snippet ? (
        <IgnoreLoraModal
          label={unusedLoraIssueLabel(ignoreLoraIssue)}
          pathCount={unusedLoraIssuePaths(ignoreLoraIssue).length}
          onCancel={() => setIgnoreLoraIssue(null)}
          onConfirm={() => ignoreUnusedLora(ignoreLoraIssue)}
        />
      ) : null}

      {categorizeLoraIssue?.snippet ? (
        <CategorizeUnusedLoraModal
          issue={categorizeLoraIssue}
          categories={loraDownloadCategories}
          onCancel={() => setCategorizeLoraIssue(null)}
          onConfirm={(opts) =>
            categorizeUnusedLora(categorizeLoraIssue, opts)
          }
          onManageCategories={() =>
            setLoraCategoryManager({ open: true, focusWildcardPath: null })
          }
        />
      ) : null}

      {coverageOpen ? (
        <PromptCoverageModal
          progress={coverageProgress}
          report={coverageReport}
          starting={coverageStarting}
          onClose={() => setCoverageOpen(false)}
          onStart={() => void startCoverage()}
          onCancel={cancelCoverage}
          onReportUpdated={setCoverageReport}
          onOpenWildcard={(name) => {
            setCoverageOpen(false);
            setWorkspaceTab('wildcards');
            void openWildcardFromEditor(name);
          }}
          onSelectPromptFolder={(relativeFolder) => {
            setPromptsSelectedFolder(relativeFolder || null);
            setWorkspaceTab('prompts');
            setCoverageOpen(false);
          }}
        />
      ) : null}
      {expandTarget ? (
        <ExpandModal
          target={expandTarget}
          onClose={() => setExpandTarget(null)}
        />
      ) : null}

      {globalSearchLauncherOpen ? (
        <GlobalSearchLauncherModal
          initial={{
            query: globalSearchQuery,
            scopes: globalSearchScopes,
          }}
          onClose={() => setGlobalSearchLauncherOpen(false)}
          onSubmit={(next) => {
            setGlobalSearchQuery(next.query);
            setGlobalSearchScopes(next.scopes);
            setSearchRefreshNonce((n) => n + 1);
            setGlobalSearchLauncherOpen(false);
            setWorkspaceTab('search');
          }}
        />
      ) : null}

      {civitaiOpen ? (
        <CivitaiBrowserModal
          key={`civitai:${activeLibraryId ?? 'none'}`}
          onClose={() => {
            setCivitaiOpen(false);
            setCivitaiFocusModel(null);
          }}
          focusModel={civitaiFocusModel}
          onFocusModelConsumed={() => setCivitaiFocusModel(null)}
          onDetach={() => {
            void window.wcm.civitai.detachBrowser().then(() => {
              setCivitaiOpen(false);
              setCivitaiFocusModel(null);
            });
          }}
          onNotice={(message) => flashNotice(message)}
          onError={(message) => setError(message)}
          onBeforeDownload={async () => {
            await flushDraftRef.current({ rebuild: false });
          }}
        />
      ) : null}

      {simSettingsOpen ? (
        <ApplicationSettingsModal
          settings={simSettings}
          layoutStyle={graphLayoutStyle}
          convertChildSuffix={convertChildSuffix}
          libraries={libraries}
          activeLibraryId={activeLibraryId}
          onClose={() => setSimSettingsOpen(false)}
          onOpenGlobalSearch={() => {
            setSimSettingsOpen(false);
            setGlobalSearchLauncherOpen(true);
          }}
          onManageLibraries={() => {
            setSimSettingsOpen(false);
            setLibraryManagerOpen(true);
          }}
          onSwitchLibrary={async (id) => {
            await switchLibrary(id);
          }}
          onLoraFolderChanged={() => {
            void refresh();
          }}
          onSave={async (settings, layoutStyle, childSuffix) => {
            await window.wcm.ui.setSimulationSettings(
              settings.iterations,
              settings.seed,
            );
            await window.wcm.ui.setGraphLayoutStyle(layoutStyle);
            const savedSuffix =
              await window.wcm.ui.setConvertChildSuffix(childSuffix);
            setSimSettings(settings);
            setGraphLayoutStyle(layoutStyle);
            setConvertChildSuffix(savedSuffix);
            setSimSettingsOpen(false);
            await refresh();
          }}
        />
      ) : null}

      <footer
        className={`status-bar${error ? ' status-error' : notice || mainActivity || modelPopulateStatus || busyLabel ? ' status-notice' : ''}`}
        role="status"
        aria-live="polite"
      >
        <span
          className="status-bar-message"
          title={
            error ??
            notice ??
            mainActivity ??
            modelPopulateStatus ??
            busyLabel ??
            undefined
          }
        >
          {error ??
            notice ??
            mainActivity ??
            modelPopulateStatus ??
            busyLabel ??
            'Ready'}
        </span>
        {error ? (
          <button
            type="button"
            className="status-bar-dismiss"
            title="Dismiss"
            onClick={() => setError(null)}
          >
            <X size={13} />
          </button>
        ) : null}
      </footer>
    </div>
  );
}

function unusedLoraIssuePaths(issue: IssueDto): string[] {
  const paths = [issue.snippet, ...(issue.relatedPaths ?? [])]
    .filter((p): p is string => typeof p === 'string' && Boolean(p.trim()))
    .map((p) => p.replaceAll('\\', '/'));
  return [...new Set(paths)];
}

function unusedLoraIssueLabel(issue: IssueDto): string {
  const match = issue.message.match(/`([^`]+)`/);
  return match?.[1] ?? issue.snippet ?? 'LoRA';
}

function IgnoreLoraModal({
  label,
  pathCount,
  onCancel,
  onConfirm,
}: {
  label: string;
  pathCount: number;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const isSeries = pathCount > 1;

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onCancel)}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <AlertTriangle size={18} />{' '}
            {isSeries ? 'Ignore unused LoRA series?' : 'Ignore unused LoRA?'}
          </h2>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <p>
            {isSeries ? (
              <>
                Stop warning that <code>{label}</code> ({pathCount} steps) is
                unused?
              </>
            ) : (
              <>
                Stop warning that <code>{label}</code> is unused?
              </>
            )}
          </p>
          <p className="hint">
            {isSeries
              ? 'All files in this series will remain ignored in future analyses. Model files will not be changed.'
              : 'This LoRA will remain ignored in future analyses. The model file will not be changed.'}
          </p>
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => setBusy(false));
            }}
            disabled={busy}
          >
            {busy ? 'Ignoring…' : 'Ignore'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function CategorizeUnusedLoraModal({
  issue,
  categories,
  onCancel,
  onConfirm,
  onManageCategories,
}: {
  issue: IssueDto;
  categories: LoraDownloadCategoryListDto | null;
  onCancel: () => void;
  onConfirm: (opts: {
    loraCategoryId: string;
    extraComment?: string;
    extraPrompt?: string;
  }) => Promise<void>;
  onManageCategories: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const paths = unusedLoraIssuePaths(issue);
  const label = unusedLoraIssueLabel(issue);
  const list = categories?.categories ?? [];
  const [categoryId, setCategoryId] = useState(
    () => categories?.lastCategoryId ?? list[0]?.id ?? '',
  );
  const [extraComment, setExtraComment] = useState('');
  const [extraPrompt, setExtraPrompt] = useState('');
  const [promptKeywords, setPromptKeywords] = useState<string[]>([]);

  useEffect(() => {
    if (!categoryId && list[0]?.id) setCategoryId(list[0].id);
  }, [categoryId, list]);

  useEffect(() => {
    const first = paths[0];
    if (!first) {
      setPromptKeywords([]);
      return;
    }
    let cancelled = false;
    void window.wcm.modelFiles
      .inspectLora(first)
      .then((info) => {
        if (!cancelled) setPromptKeywords(info.promptKeywords ?? []);
      })
      .catch(() => {
        if (!cancelled) setPromptKeywords([]);
      });
    return () => {
      cancelled = true;
    };
  }, [paths]);

  const selected = list.find((c) => c.id === categoryId) ?? null;
  const preview = useMemo(() => {
    if (!selected) return null;
    return buildUnusedLoraLocalSnippet({
      relativePaths: paths,
      weights: selected.defaultWeights,
      keywords: promptKeywords,
      extraComment: extraComment.trim() || undefined,
      extraPrompt: extraPrompt.trim() || undefined,
    });
  }, [paths, selected, promptKeywords, extraComment, extraPrompt]);

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onCancel)}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <Tags size={18} /> Categorize unused LoRA
          </h2>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <p>
            Move <code>{label}</code>
            {paths.length > 1 ? ` (${paths.length} files)` : ''} into a category
            folder and append a <code># LOCAL</code> reference to its wildcard.
          </p>
          {list.length === 0 ? (
            <p className="hint">
              No LoRA download categories yet.{' '}
              <button type="button" className="link-btn" onClick={onManageCategories}>
                Manage categories…
              </button>
            </p>
          ) : (
            <>
              <label className="field">
                <span>Category</span>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  disabled={busy}
                >
                  {list.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} → {c.folder}/ · {c.wildcardRelativePath}
                    </option>
                  ))}
                </select>
              </label>

              <label
                className="field"
                title="Optional note between # LOCAL and the <lora:…> line (e.g. slider value guidance). Leave empty to skip."
              >
                <span>
                  Extra comment <span className="hint">(optional)</span>
                </span>
                <textarea
                  className="text-input"
                  rows={2}
                  value={extraComment}
                  disabled={busy}
                  placeholder="e.g. Value range −10…+10; clamped −3…6"
                  spellCheck={false}
                  onChange={(e) => setExtraComment(e.target.value)}
                />
              </label>

              <label
                className="field"
                title="Optional prompt text appended after trained-word triggers on the <lora:…> line. Leave empty to skip."
              >
                <span>
                  Extra prompt <span className="hint">(optional)</span>
                </span>
                <input
                  className="text-input"
                  value={extraPrompt}
                  disabled={busy}
                  placeholder="e.g. atmospheric, dynamic lighting, bokeh"
                  spellCheck={false}
                  onChange={(e) => setExtraPrompt(e.target.value)}
                />
              </label>

              {preview ? (
                <div className="snippet-preview-wrap">
                  <pre className="snippet-preview">{preview}</pre>
                  <button
                    type="button"
                    className="icon-btn snippet-preview-copy"
                    title="Copy reference"
                    aria-label="Copy reference"
                    disabled={busy}
                    onClick={() => {
                      void navigator.clipboard.writeText(preview).then(
                        () => {
                          setCopied(true);
                          window.setTimeout(() => setCopied(false), 1500);
                        },
                        () => {
                          /* ignore */
                        },
                      );
                    }}
                  >
                    {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              ) : (
                <p className="hint">
                  Selected files are not a single training-step series.
                </p>
              )}
              <p className="hint">
                <button type="button" className="link-btn" onClick={onManageCategories}>
                  Manage categories…
                </button>
              </p>
            </>
          )}
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (!categoryId || !preview) return;
              setBusy(true);
              void onConfirm({
                loraCategoryId: categoryId,
                extraComment: extraComment.trim() || undefined,
                extraPrompt: extraPrompt.trim() || undefined,
              }).finally(() => setBusy(false));
            }}
            disabled={busy || !categoryId || !preview}
          >
            {busy ? 'Categorizing…' : 'Categorize'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ConsolidateModal({
  relativePath,
  onCancel,
  onConfirm,
}: {
  relativePath: string;
  onCancel: () => void;
  onConfirm: (relativePath: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<ConsolidationPreviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    window.wcm.refactor
      .previewConsolidate(relativePath)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [relativePath]);

  const confirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(relativePath);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onCancel)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <GitMerge size={18} /> Consolidate forwarder
          </h2>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>

        {loading ? (
          <div className="modal-body loading-row">
            <RefreshCw className="spin" size={18} /> Analyzing references…
          </div>
        ) : null}

        {!loading && preview && preview.canConsolidate ? (
          <>
            <div className="modal-body">
              <p className="consolidate-summary">
                Replace every <code>__{preview.sourceKey}__</code> with{' '}
                <code>__{preview.targetName}__</code>, then delete{' '}
                <code>{preview.sourceRelativePath}</code>.
              </p>
              <div className="consolidate-stats">
                <span>
                  {preview.totalOccurrences} reference
                  {preview.totalOccurrences === 1 ? '' : 's'}
                </span>
                <span>
                  {preview.affectedFiles.length} file
                  {preview.affectedFiles.length === 1 ? '' : 's'}
                </span>
              </div>
              {preview.affectedFiles.length > 0 ? (
                <ul className="affected-list">
                  {preview.affectedFiles.map((f) => (
                    <li key={f.key}>
                      <span>{f.key}</span>
                      <small>{f.occurrences}×</small>
                    </li>
                  ))}
                </ul>
              ) : null}
              {preview.warnings.map((w) => (
                <p className="warn-row" key={w}>
                  <AlertTriangle size={14} /> {w}
                </p>
              ))}
              {err ? <p className="error-inline">{err}</p> : null}
            </div>
            <footer className="modal-foot">
              <button type="button" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void confirm()}
                disabled={busy}
              >
                <Trash2 size={15} /> {busy ? 'Consolidating…' : 'Consolidate & delete'}
              </button>
            </footer>
          </>
        ) : null}

        {!loading && preview && !preview.canConsolidate ? (
          <>
            <div className="modal-body">
              <p className="warn-row">
                <AlertTriangle size={14} /> {preview.reason}
              </p>
            </div>
            <footer className="modal-foot">
              <button type="button" onClick={onCancel}>
                Close
              </button>
            </footer>
          </>
        ) : null}

        {!loading && !preview && err ? (
          <>
            <div className="modal-body">
              <p className="error-inline">{err}</p>
            </div>
            <footer className="modal-foot">
              <button type="button" onClick={onCancel}>
                Close
              </button>
            </footer>
          </>
        ) : null}
      </div>
    </div>
  );
}

function AbsorbModal({
  relativePath,
  onCancel,
  onConfirm,
}: {
  relativePath: string;
  onCancel: () => void;
  onConfirm: (relativePath: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<AbsorbPreviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    window.wcm.refactor
      .previewAbsorb(relativePath)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [relativePath]);

  const confirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(relativePath);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onCancel)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <GitMerge size={18} /> Absorb target · keep name
          </h2>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>

        {loading ? (
          <div className="modal-body loading-row">
            <RefreshCw className="spin" size={18} /> Analyzing references…
          </div>
        ) : null}

        {!loading && preview && preview.canAbsorb ? (
          <>
            <div className="modal-body">
              <p className="consolidate-summary">
                Replace every <code>__{preview.targetName}__</code> with{' '}
                <code>__{preview.sourceKey}__</code>, move{' '}
                <code>{preview.targetRelativePath}</code> onto{' '}
                <code>{preview.sourceRelativePath}</code>, then delete the
                target. Callers of <code>__{preview.sourceKey}__</code> stay
                unchanged.
              </p>
              <div className="consolidate-stats">
                <span>
                  {preview.totalOccurrences} reference
                  {preview.totalOccurrences === 1 ? '' : 's'}
                </span>
                <span>
                  {preview.affectedFiles.length} file
                  {preview.affectedFiles.length === 1 ? '' : 's'}
                </span>
              </div>
              {preview.affectedFiles.length > 0 ? (
                <ul className="affected-list">
                  {preview.affectedFiles.map((f) => (
                    <li key={f.key}>
                      <span>{f.key}</span>
                      <small>{f.occurrences}×</small>
                    </li>
                  ))}
                </ul>
              ) : null}
              {preview.warnings.map((w) => (
                <p className="warn-row" key={w}>
                  <AlertTriangle size={14} /> {w}
                </p>
              ))}
              {err ? <p className="error-inline">{err}</p> : null}
            </div>
            <footer className="modal-foot">
              <button type="button" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void confirm()}
                disabled={busy}
              >
                <Trash2 size={15} /> {busy ? 'Absorbing…' : 'Absorb & keep name'}
              </button>
            </footer>
          </>
        ) : null}

        {!loading && preview && !preview.canAbsorb ? (
          <>
            <div className="modal-body">
              <p className="warn-row">
                <AlertTriangle size={14} /> {preview.reason}
              </p>
            </div>
            <footer className="modal-foot">
              <button type="button" onClick={onCancel}>
                Close
              </button>
            </footer>
          </>
        ) : null}

        {!loading && !preview && err ? (
          <>
            <div className="modal-body">
              <p className="error-inline">{err}</p>
            </div>
            <footer className="modal-foot">
              <button type="button" onClick={onCancel}>
                Close
              </button>
            </footer>
          </>
        ) : null}
      </div>
    </div>
  );
}

function CreateFileModal({
  initialValue = '',
  descendantOf = null,
  onCancel,
  onCreate,
}: {
  initialValue?: string;
  /** Parent file to receive a `__child__` reference after create. */
  descendantOf?: string | null;
  onCancel: () => void;
  onCreate: (relativePath: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const asDescendant = Boolean(descendantOf);

  const submit = async () => {
    const trimmed = value.trim().replace(/\\/g, '/');
    if (!trimmed) return;
    const rel = /\.(txt|ya?ml|json)$/i.test(trimmed) ? trimmed : `${trimmed}.txt`;
    setBusy(true);
    setErr(null);
    try {
      await onCreate(rel);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onCancel)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            {asDescendant ? <FileInput size={18} /> : <FilePlus size={18} />}{' '}
            {asDescendant ? 'Create descendant' : 'New wildcard file'}
          </h2>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          {asDescendant && descendantOf ? (
            <p className="consolidate-summary">
              Create a new empty file and append a reference to it in{' '}
              <code>{descendantOf}</code> (existing contents stay).
            </p>
          ) : null}
          <label className="field-label">Path (relative to library root)</label>
          <input
            className="text-input"
            autoFocus
            placeholder="clothing/hats"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
          <p className="hint">
            <code>.txt</code> is added automatically if you omit an extension.
            {asDescendant ? (
              <>
                {' '}
                Parent will gain a <code>__…__</code> line pointing at this file.
              </>
            ) : null}
          </p>
          {err ? <p className="error-inline">{err}</p> : null}
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={busy || !value.trim()}
          >
            {busy
              ? 'Creating…'
              : asDescendant
                ? 'Create descendant'
                : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ConvertToChildModal({
  relativePath,
  childSuffix,
  onCancel,
  onConvert,
}: {
  relativePath: string;
  childSuffix: string;
  onCancel: () => void;
  onConvert: (relativePath: string, childKey: string) => Promise<void>;
}) {
  const sourceKey = relativePath
    .replace(/\\/g, '/')
    .replace(/\.(txt|ya?ml|json)$/i, '');
  const [childKey, setChildKey] = useState(() =>
    defaultConvertChildKey(sourceKey, childSuffix),
  );
  const [preview, setPreview] = useState<ConvertToChildPreviewDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.wcm.refactor
        .previewConvertToChild(relativePath, childKey)
        .then((p) => {
          if (!cancelled) setPreview(p);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [relativePath, childKey]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onConvert(relativePath, childKey);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const canGo = Boolean(preview?.canConvert) && !busy;

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onCancel)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <CornerDownRight size={17} /> Convert to child node
          </h2>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <p className="consolidate-summary">
            Move the contents of <code>{relativePath}</code> into a new child
            file, and leave only a single reference here.
          </p>
          <label className="field-label">Child name / path</label>
          <input
            className="text-input"
            autoFocus
            value={childKey}
            onChange={(e) => setChildKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canGo) void submit();
            }}
          />
          {preview && preview.canConvert ? (
            <>
              <p className="consolidate-summary">
                Create <code>{preview.childRelativePath}</code> with the current
                contents, then set this file to{' '}
                <code>{preview.parentText.trim()}</code>.
              </p>
              {preview.warnings.map((w) => (
                <p className="warn-row" key={w}>
                  <AlertTriangle size={14} /> {w}
                </p>
              ))}
            </>
          ) : null}
          {preview && !preview.canConvert && preview.reason ? (
            <p className="warn-row">
              <AlertTriangle size={14} /> {preview.reason}
            </p>
          ) : null}
          {err ? <p className="error-inline">{err}</p> : null}
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={!canGo}
          >
            <CornerDownRight size={15} />{' '}
            {busy ? 'Converting…' : 'Convert to child'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function RenameModal({
  relativePath,
  onCancel,
  onRename,
}: {
  relativePath: string;
  onCancel: () => void;
  onRename: (relativePath: string, newKey: string) => Promise<void>;
}) {
  const currentKey = relativePath.replace(/\.(txt|ya?ml|json)$/i, '');
  const [newKey, setNewKey] = useState(currentKey);
  const [preview, setPreview] = useState<RenamePreviewDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.wcm.refactor
        .previewRename(relativePath, newKey)
        .then((p) => {
          if (!cancelled) setPreview(p);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [relativePath, newKey]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onRename(relativePath, newKey);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const canGo = Boolean(preview?.canRename) && !busy;

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onCancel)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <Pencil size={17} /> Rename / move file
          </h2>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <label className="field-label">New name / path</label>
          <input
            className="text-input"
            autoFocus
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canGo) void submit();
            }}
          />
          {preview && preview.canRename ? (
            <>
              <p className="consolidate-summary">
                Move to <code>{preview.newRelativePath}</code> and update{' '}
                {preview.totalOccurrences} reference
                {preview.totalOccurrences === 1 ? '' : 's'} in{' '}
                {preview.affectedFiles.length} file
                {preview.affectedFiles.length === 1 ? '' : 's'}.
              </p>
              {preview.affectedFiles.length > 0 ? (
                <ul className="affected-list">
                  {preview.affectedFiles.map((f) => (
                    <li key={f.key}>
                      <span>{f.key}</span>
                      <small>{f.occurrences}×</small>
                    </li>
                  ))}
                </ul>
              ) : null}
              {preview.warnings.map((w) => (
                <p className="warn-row" key={w}>
                  <AlertTriangle size={14} /> {w}
                </p>
              ))}
            </>
          ) : null}
          {preview && !preview.canRename && preview.reason ? (
            <p className="warn-row">
              <AlertTriangle size={14} /> {preview.reason}
            </p>
          ) : null}
          {err ? <p className="error-inline">{err}</p> : null}
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={!canGo}
          >
            {busy ? 'Renaming…' : 'Rename'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function RenameLoraModal({
  sourceName,
  onCancel,
  onRename,
}: {
  sourceName: string;
  onCancel: () => void;
  onRename: (sourceName: string, newBasename: string) => Promise<void>;
}) {
  const initial =
    sourceName.replace(/\\/g, '/').split('/').pop()?.replace(
      /\.(safetensors|ckpt|pt)$/i,
      '',
    ) ?? sourceName;
  const [newBasename, setNewBasename] = useState(initial);
  const [preview, setPreview] = useState<RenameLoraPreviewDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.wcm.ui
        .previewRenameLora(sourceName, newBasename)
        .then((p) => {
          if (!cancelled) setPreview(p);
        })
        .catch((e) => {
          if (!cancelled) {
            setPreview(null);
            setErr(e instanceof Error ? e.message : String(e));
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sourceName, newBasename]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onRename(sourceName, newBasename);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const canGo = Boolean(preview?.canRename) && !busy;

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onCancel)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <Pencil size={17} /> Rename LoRA on disk
          </h2>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <p className="hint">
            Renames the model file in your LoRA folder, moves the hash-cache
            entry so Civitai installed tracking still matches, and updates every{' '}
            <code>&lt;lora:…&gt;</code> tag in this library that points at it.
            Tag edits are undoable; the on-disk file rename is not.
          </p>
          <label className="field-label">Current</label>
          <p>
            <code>{preview?.oldRelativePath || sourceName}</code>
          </p>
          <label className="field-label">New file name</label>
          <input
            className="text-input"
            autoFocus
            value={newBasename}
            onChange={(e) => {
              setErr(null);
              setNewBasename(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canGo) void submit();
            }}
          />
          {preview && preview.canRename ? (
            <p className="consolidate-summary">
              Save as <code>{preview.newRelativePath}</code>
              {preview.totalOccurrences > 0
                ? ` and update ${preview.totalOccurrences} tag${preview.totalOccurrences === 1 ? '' : 's'} in ${preview.affectedFiles.length} file${preview.affectedFiles.length === 1 ? '' : 's'}`
                : ' (no library tags reference this model yet)'}
              .
            </p>
          ) : null}
          {preview && !preview.canRename && preview.reason ? (
            <p className="warn-row">
              <AlertTriangle size={14} /> {preview.reason}
            </p>
          ) : null}
          {err ? <p className="error-inline">{err}</p> : null}
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={!canGo}
          >
            {busy ? 'Renaming…' : 'Rename'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function DeleteModal({
  relativePath,
  inbound,
  onCancel,
  onDelete,
}: {
  relativePath: string;
  inbound: number;
  onCancel: () => void;
  onDelete: (relativePath: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onDelete(relativePath);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onCancel)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <Trash2 size={17} /> Delete file
          </h2>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <p className="consolidate-summary">
            Delete <code>{relativePath}</code>?
          </p>
          {inbound > 0 ? (
            <p className="warn-row">
              <AlertTriangle size={14} /> {inbound} other file
              {inbound === 1 ? '' : 's'} reference this one; those references will
              be removed.
            </p>
          ) : null}
          <p className="hint">This is undoable (Ctrl+Z) and backed up.</p>
          {err ? <p className="error-inline">{err}</p> : null}
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => void submit()}
            disabled={busy}
          >
            <Trash2 size={15} /> {busy ? 'Deleting…' : 'Delete'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function CleanupMissingModal({
  referenceName,
  onCancel,
  onConfirm,
}: {
  referenceName: string;
  onCancel: () => void;
  onConfirm: (referenceName: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(referenceName);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onCancel)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <Eraser size={17} /> Clean up missing reference
          </h2>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <p className="consolidate-summary">
            Remove every <code>__{referenceName}__</code> reference from all
            files?
          </p>
          <p className="hint">This is undoable (Ctrl+Z) and backed up.</p>
          {err ? <p className="error-inline">{err}</p> : null}
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => void submit()}
            disabled={busy}
          >
            <Eraser size={15} /> {busy ? 'Cleaning…' : 'Remove references'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ExpandModal({
  target,
  onClose,
}: {
  target: ExpandTarget;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ExpandMode>('random');
  const [count, setCount] = useState(20);
  const [seed, setSeed] = useState(
    target.kind === 'generation' ? target.seed : 1,
  );
  const [result, setResult] = useState<ExpandResultDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const title =
    target.kind === 'wildcard'
      ? target.relativePath
      : target.kind === 'gen-file'
        ? `${target.relativeFolder}/!gen.txt`
        : 'Generation · Once';

  const generate = useCallback(
    async (overrideSeed?: number) => {
      setBusy(true);
      setErr(null);
      const sampleSeed = overrideSeed ?? seed;
      const request: ExpandRequestDto =
        target.kind === 'wildcard'
          ? {
              source: 'wildcard',
              relativePath: target.relativePath,
              mode,
              limit: count,
              seed: mode === 'random' ? sampleSeed : undefined,
            }
          : target.kind === 'gen-file'
            ? {
                source: 'gen-file',
                relativeFolder: target.relativeFolder,
                content: target.content,
                mode,
                limit: count,
                seed: mode === 'random' ? sampleSeed : undefined,
              }
            : {
                source: 'generation',
                promptSource: target.promptSource,
                promptText: target.promptText,
                relativeFolder: target.relativeFolder ?? undefined,
                promptFoldersRecursive: target.promptFoldersRecursive,
                additionalPositivePrompt: target.additionalPositivePrompt,
                checkpoint: target.checkpoint,
                generationSeed: sampleSeed,
                mode,
                limit: count,
              };
      try {
        const r = await window.wcm.expand.preview(request);
        setResult(r);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [count, mode, seed, target],
  );

  useEffect(() => {
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyAll = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.samples.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onClose)}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <Sparkles size={18} /> Expand · {title}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="expand-controls">
          <div className="segmented">
            <button
              type="button"
              className={mode === 'random' ? 'active' : ''}
              onClick={() => setMode('random')}
            >
              Random
            </button>
            <button
              type="button"
              className={mode === 'exhaustive' ? 'active' : ''}
              onClick={() => setMode('exhaustive')}
            >
              Exhaustive
            </button>
          </div>
          <label className="inline-field">
            Count
            <input
              type="number"
              min={1}
              max={2000}
              value={count}
              onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          {mode === 'random' ? (
            <label className="inline-field">
              Seed
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value) || 0)}
              />
              <button
                type="button"
                className="ghost-btn icon-only"
                title="Randomize seed"
                onClick={() => {
                  const s = Math.floor(Math.random() * 1_000_000_000);
                  setSeed(s);
                  void generate(s);
                }}
              >
                <Dices size={15} />
              </button>
            </label>
          ) : null}
          <button
            type="button"
            className="primary"
            onClick={() => void generate()}
            disabled={busy}
          >
            <RefreshCw size={14} className={busy ? 'spin' : ''} /> Generate
          </button>
        </div>

        <div className="modal-body">
          {result ? (
            <div className="expand-stats">
              <span>
                {result.combinationsSaturated ? '≥ ' : ''}
                {result.totalCombinations.toLocaleString()} combination
                {result.totalCombinations === 1 ? '' : 's'}
              </span>
              {result.detail ? <span>{result.detail}</span> : null}
              <span>
                showing {result.samples.length}
                {result.truncated ? ' (truncated)' : ''}
              </span>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void copyAll()}
                disabled={result.samples.length === 0}
              >
                <Copy size={13} /> {copied ? 'Copied' : 'Copy all'}
              </button>
            </div>
          ) : null}

          {err ? <p className="error-inline">{err}</p> : null}

          {result && result.samples.length > 0 ? (
            <ol className="sample-list">
              {result.samples.map((s, i) => (
                <li key={`${i}-${s}`}>{s || <em>(empty)</em>}</li>
              ))}
            </ol>
          ) : null}

          {result && result.samples.length === 0 && !err ? (
            <p className="hint">No expansions produced.</p>
          ) : null}

          {result && result.issues.length > 0 ? (
            <div className="expand-issues">
              {result.issues.map((issue) => (
                <p className="warn-row" key={`${issue.code}-${issue.message}`}>
                  <AlertTriangle size={13} /> {issue.message}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function issueIdentity(issue: IssueDto): string {
  return [
    issue.code,
    issue.nodeId ?? '',
    String(issue.line ?? ''),
    String(issue.column ?? ''),
    issue.message,
    issue.snippet ?? '',
  ].join('\u0000');
}

function missingKeyFromIssue(issue: IssueDto): string | null {
  if (issue.code !== 'missing_file') return null;
  if (issue.nodeId?.startsWith('missing:')) {
    return issue.nodeId.slice('missing:'.length);
  }
  // Fall back to `__name__` in the message when nodeId is absent.
  const match = issue.message.match(/__([^_\n](?:[^_\n]|_(?!_))*)__/);
  return match?.[1]?.trim() || null;
}

function IssueList({
  issues,
  onSelect,
  onCreateMissing,
  onIgnoreUnusedLora,
  onCopyUnusedLoraRef,
  onCategorizeUnusedLora,
  onFixUnusedLoraSeries,
  onOpenRelatedPath,
  showNode = false,
}: {
  issues: AnalysisResultDto['issues'];
  onSelect: (issue: IssueDto) => void;
  /** Opens create-file for a missing_file issue. */
  onCreateMissing?: (key: string) => void;
  /** Opens confirmation before suppressing a library-wide unused LoRA. */
  onIgnoreUnusedLora?: (issue: IssueDto) => void;
  /** Copy the same `# LOCAL` reference Categorize would append. */
  onCopyUnusedLoraRef?: (issue: IssueDto) => void;
  /** Opens categorize dialog for an unused LoRA / training-step series. */
  onCategorizeUnusedLora?: (issue: IssueDto) => void;
  /** One-click extend of an existing series reference (missing steps). */
  onFixUnusedLoraSeries?: (issue: IssueDto) => void;
  /** Navigate to a related path (e.g. duplicate LoRA sibling). */
  onOpenRelatedPath?: (relativePath: string) => void;
  /** When true, show which graph node owns the issue (All Issues). */
  showNode?: boolean;
}) {
  return (
    <ul className="issue-list">
      {issues.map((issue, index) => {
        const missingKey = missingKeyFromIssue(issue);
        const isCycle = issue.code === 'cycle';
        const canExtendSeries =
          issue.code === 'unused_lora' &&
          issue.fixAction === 'extend_lora_series';
        // Series members stay on relatedPaths for Ignore/Categorize, but are
        // not listed under the collapsed unused_lora row.
        const relatedPaths =
          issue.code === 'unused_lora' ? [] : (issue.relatedPaths ?? []);
        return (
          <li
            key={`${issue.code}-${issue.nodeId ?? ''}-${issue.line ?? ''}-${index}`}
            className={`issue-item issue-severity-${issue.severity}${
              relatedPaths.length > 0 ? ' issue-item-stack' : ''
            }`}
          >
            <div className="issue-item-row">
              <button
                type="button"
                className="issue-main"
                onClick={() => onSelect(issue)}
              >
                {issue.severity === 'warning' ? (
                  <AlertTriangle size={14} />
                ) : (
                  <AlertCircle size={14} />
                )}
                <span>
                  <strong>{issue.code.replaceAll('_', ' ')}</strong>
                  {showNode && issue.nodeId ? (
                    <em className="issue-node">{issue.nodeId}</em>
                  ) : null}
                  <small>
                    {issue.message}
                    {issue.line ? ` · line ${issue.line}` : ''}
                  </small>
                </span>
              </button>
              <div className="issue-actions">
              {isCycle ? (
                <button
                  type="button"
                  className="issue-create issue-action-icon"
                  title="Open cycle resolver"
                  aria-label="Open cycle resolver"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(issue);
                  }}
                >
                  <Repeat size={14} />
                </button>
              ) : null}
              {missingKey && onCreateMissing ? (
                <button
                  type="button"
                  className="issue-create issue-action-icon"
                  title={`Create ${missingKey}.txt`}
                  aria-label={`Create ${missingKey}.txt`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateMissing(missingKey);
                  }}
                >
                  <FilePlus size={14} />
                </button>
              ) : null}
              {canExtendSeries && onFixUnusedLoraSeries ? (
                <button
                  type="button"
                  className="issue-create issue-action-icon issue-fix"
                  title="Fix reference — add missing training steps to the existing series pick"
                  aria-label="Fix series reference"
                  onClick={(event) => {
                    event.stopPropagation();
                    onFixUnusedLoraSeries(issue);
                  }}
                >
                  <ListPlus size={14} />
                </button>
              ) : null}
              {issue.code === 'unused_lora' && onCopyUnusedLoraRef ? (
                <button
                  type="button"
                  className="issue-create issue-action-icon"
                  title="Copy LOCAL wildcard reference (same text Categorize would append)"
                  aria-label="Copy unused LoRA reference"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCopyUnusedLoraRef(issue);
                  }}
                >
                  <Copy size={14} />
                </button>
              ) : null}
              {issue.code === 'unused_lora' &&
              !canExtendSeries &&
              onCategorizeUnusedLora ? (
                <button
                  type="button"
                  className="issue-create issue-action-icon"
                  title="Categorize — move into a category folder and add a LOCAL wildcard reference"
                  aria-label="Categorize unused LoRA"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCategorizeUnusedLora(issue);
                  }}
                >
                  <Tags size={14} />
                </button>
              ) : null}
              {issue.code === 'unused_lora' && onIgnoreUnusedLora ? (
                <button
                  type="button"
                  className="issue-create issue-action-icon issue-ignore"
                  title={
                    (issue.relatedPaths?.length ?? 0) > 0
                      ? 'Ignore this unused LoRA series'
                      : 'Ignore this unused LoRA warning'
                  }
                  aria-label="Ignore unused LoRA"
                  onClick={(event) => {
                    event.stopPropagation();
                    onIgnoreUnusedLora(issue);
                  }}
                >
                  <EyeOff size={14} />
                </button>
              ) : null}
              </div>
            </div>
            {relatedPaths.length > 0 && onOpenRelatedPath ? (
              <ul className="issue-related-paths">
                {relatedPaths.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      className="issue-related-path"
                      title={`Open ${path} in LoRA files`}
                      onClick={() => onOpenRelatedPath(path)}
                    >
                      {path}
                    </button>
                  </li>
                ))}
              </ul>
            ) : relatedPaths.length > 0 ? (
              <ul className="issue-related-paths">
                {relatedPaths.map((path) => (
                  <li key={path}>
                    <code>{path}</code>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function impactLabel(impact: CycleFixSuggestionDto['impact']): string {
  switch (impact) {
    case 'very_low':
      return 'Very low impact';
    case 'low':
      return 'Low impact';
    case 'medium':
      return 'Medium impact';
    case 'high':
      return 'High impact';
  }
}

function CycleResolverModal({
  rootRelativePath,
  issue,
  onCancel,
  onApply,
  onOpenInEditor,
}: {
  rootRelativePath: string;
  issue: IssueDto;
  onCancel: () => void;
  onApply: (suggestion: CycleFixSuggestionDto) => Promise<void>;
  onOpenInEditor: (suggestion: CycleFixSuggestionDto) => void;
}) {
  const [preview, setPreview] = useState<CycleFixPreviewDto | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void window.wcm.refactor
      .previewCycle(rootRelativePath, {
        nodeId: issue.nodeId,
        line: issue.line,
        column: issue.column,
        snippet: issue.snippet,
        message: issue.message,
      })
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
        setSelectedId(p.suggestions[0]?.id ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rootRelativePath, issue]);

  const selected =
    preview?.suggestions.find((s) => s.id === selectedId) ??
    preview?.suggestions[0] ??
    null;

  const apply = async () => {
    if (!selected) return;
    setBusy(true);
    setErr(null);
    try {
      await onApply(selected);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onCancel)}>
      <div
        className="modal modal-wide"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>
            <Repeat size={17} /> Resolve cycle
          </h2>
          <button type="button" className="icon-btn" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>

        {loading ? (
          <div className="modal-body loading-row">
            <RefreshCw className="spin" size={18} /> Ranking safe fixes…
          </div>
        ) : null}

        {!loading && preview ? (
          <>
            <div className="modal-body cycle-resolver-body">
              <p className="consolidate-summary">
                {preview.nodeIds.length > 0 ? (
                  <>
                    Cycle group:{' '}
                    <code>{preview.nodeIds.join(' · ')}</code>
                  </>
                ) : (
                  issue.message
                )}
              </p>
              {preview.paths.length > 0 ? (
                <ul className="cycle-path-list">
                  {preview.paths.slice(0, 4).map((path) => (
                    <li key={path}>
                      <code>{path}</code>
                    </li>
                  ))}
                </ul>
              ) : null}

              {!preview.canResolve ? (
                <p className="warn-row">
                  <AlertTriangle size={14} />{' '}
                  {preview.reason ?? 'No automatic fix available.'}
                </p>
              ) : (
                <>
                  <h3 className="cycle-suggestions-head">
                    Suggested fixes · safest first
                  </h3>
                  <ul className="cycle-suggestion-list">
                    {preview.suggestions.map((s, index) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className={
                            selected?.id === s.id
                              ? 'cycle-suggestion selected'
                              : 'cycle-suggestion'
                          }
                          onClick={() => setSelectedId(s.id)}
                        >
                          <span className="cycle-suggestion-rank">
                            #{index + 1}
                          </span>
                          <span className="cycle-suggestion-body">
                            <strong>{s.summary}</strong>
                            <small>
                              <span
                                className={`impact-pill impact-${s.impact}`}
                              >
                                {impactLabel(s.impact)}
                              </span>
                              {s.breaksAllCycles
                                ? ' · breaks all cycles'
                                : ' · partial'}
                              {' · '}
                              {s.mode === 'line'
                                ? 'remove line'
                                : 'remove token'}
                              {' · '}
                              line {s.line}
                            </small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>

                  {selected ? (
                    <div className="cycle-suggestion-details">
                      <ul>
                        {selected.details.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                      <div className="cycle-diff">
                        <div>
                          <h4>Before · {selected.relativePath}</h4>
                          <pre>{selected.oldText || '(empty)'}</pre>
                        </div>
                        <div>
                          <h4>After</h4>
                          <pre>{selected.newText || '(empty)'}</pre>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
              {err ? <p className="error-inline">{err}</p> : null}
            </div>
            <footer className="modal-foot">
              <button type="button" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
              {selected ? (
                <button
                  type="button"
                  onClick={() => onOpenInEditor(selected)}
                  disabled={busy}
                >
                  <Pencil size={15} /> Open in editor
                </button>
              ) : null}
              <button
                type="button"
                className="primary"
                onClick={() => void apply()}
                disabled={busy || !selected || !preview.canResolve}
              >
                <Repeat size={15} />{' '}
                {busy ? 'Applying…' : 'Apply selected fix'}
              </button>
            </footer>
          </>
        ) : null}

        {!loading && !preview && err ? (
          <>
            <div className="modal-body">
              <p className="error-inline">{err}</p>
            </div>
            <footer className="modal-foot">
              <button type="button" onClick={onCancel}>
                Close
              </button>
            </footer>
          </>
        ) : null}
      </div>
    </div>
  );
}
