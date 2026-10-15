import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  CheckCircle2,
  LineChart,
  Crosshair,
  Dices,
  FilePlus2,
  FolderOpen,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Save,
  Square,
  Tags,
  Trash2,
  Workflow,
  Zap,
} from 'lucide-react';
import type {
  CheckpointBenchmarkStatusDto,
  ComfyConnectionDto,
  ComfyContractCheckDto,
  ComfyModelCatalogDto,
  GenerationProgressDto,
  GenerationStyleProfileDto,
  GenerationStyleProfileIdDto,
  IssueDto,
  ModelFileManagerEntryDto,
  PromptTreeDto,
} from '../shared/contracts';
import { appendGenPromptIfMissing } from '../domain/genPrompts.js';
import { PanelSplitter, type PanelSplitterHandlers } from './PanelSplitter';
import { loadWorkflowIntoComfyEditor } from './comfyWorkflowEditor';
import { comfyHttpBase } from '../shared/comfy';
import { WildcardEditor, type WildcardEditorHandle } from './WildcardEditor';
import { CategorizePromptModal } from './CategorizePromptModal';
import { CheckpointBenchmarkResultsModal } from './CheckpointBenchmarkResultsModal';
import type { ParsedCivitaiModelPageUrl } from '../domain/civitaiSnippet.js';

type Props = {
  filesWidth: number;
  detailsWidth: number;
  filesSplitter: PanelSplitterHandlers;
  detailsSplitter: PanelSplitterHandlers;
  /** When false, stay mounted but hidden so controls/progress survive tab switches. */
  active?: boolean;
  selectedFolder: string | null;
  onSelectedFolderChange: (relativePath: string | null) => void;
  wildcardKeys?: string[];
  onOpenWildcard?: (name: string) => void;
  onCreateWildcard?: (name: string) => void;
  onRenameLora?: (name: string) => void;
  onOpenLora?: (name: string) => void;
  onOpenLoraInCivitaiCatalog?: (model: ParsedCivitaiModelPageUrl) => void;
};

type PromptSource = 'text' | 'folder';
type MiddleMode = 'prompt' | 'workflow';

const PREVIEW_COLLAPSED_KEY = 'wcm.generation.previewCollapsed';

function readLegacyPreviewCollapsed(): boolean {
  try {
    return window.localStorage.getItem(PREVIEW_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function clearLegacyPreviewCollapsed(): void {
  try {
    window.localStorage.removeItem(PREVIEW_COLLAPSED_KEY);
  } catch {
    // ignore
  }
}

function subtreeHasGen(node: PromptTreeDto['folders'][number]): boolean {
  if (node.hasGenFile) return true;
  return node.children.some(subtreeHasGen);
}

/** Folders with !gen.txt, or ancestors of such folders (for Recursive). */
function flattenFolders(
  nodes: PromptTreeDto['folders'],
  out: string[] = [],
): string[] {
  for (const node of nodes) {
    if (subtreeHasGen(node)) out.push(node.relativePath);
    flattenFolders(node.children, out);
  }
  return out;
}

/** Value Comfy expects (relative path with extension); label is stem only. */
function checkpointOptionValue(file: ModelFileManagerEntryDto): string {
  return file.relativePath.replaceAll('\\', '/');
}

function emptyStyleProfile(): GenerationStyleProfileDto {
  return {
    relativeFolder: null,
    promptFoldersRecursive: false,
    checkpoint: '',
    clip: '',
    vae: '',
    seed: -1,
    width: 1024,
    height: 1024,
    additionalPositivePrompt: '',
    negativePrompt: '',
    promptText: '',
    promptSource: 'folder',
  };
}

function withSavedChoice(options: string[], selected: string): string[] {
  const value = selected.trim();
  if (!value || options.includes(value)) return options;
  return [value, ...options];
}

function isSafetensorsCheckpoint(file: ModelFileManagerEntryDto): boolean {
  return file.name.toLowerCase().endsWith('.safetensors');
}

function formatBenchmarkAvgMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec - min * 60);
  return `${min}m ${rem}s`;
}

/** Prompt folder breadcrumb (`portraits/boys` → `portraits › boys`). */
function promptCategoryBreadcrumb(relativeFolder: string | null | undefined): string {
  const cleaned = (relativeFolder ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '');
  if (!cleaned || cleaned === '_manual') return '';
  return cleaned.split('/').filter(Boolean).join(' › ');
}

export function GenerationWorkspace({
  filesWidth,
  detailsWidth,
  filesSplitter,
  detailsSplitter,
  active = true,
  selectedFolder,
  onSelectedFolderChange,
  wildcardKeys = [],
  onOpenWildcard,
  onCreateWildcard,
  onRenameLora,
  onOpenLora,
  onOpenLoraInCivitaiCatalog,
}: Props) {
  const webviewRef = useRef<HTMLElement | null>(null);
  const workflowLoadGen = useRef(0);
  const [connection, setConnection] = useState<ComfyConnectionDto | null>(
    null,
  );
  const [workflowGraphReady, setWorkflowGraphReady] = useState(false);
  const [catalog, setCatalog] = useState<ComfyModelCatalogDto | null>(null);
  const [checkpoints, setCheckpoints] = useState<ModelFileManagerEntryDto[]>(
    [],
  );
  const [folders, setFolders] = useState<string[]>([]);
  const [promptFoldersRecursive, setPromptFoldersRecursive] = useState(false);
  const [checkpoint, setCheckpoint] = useState('');
  const [benchmark, setBenchmark] = useState(false);
  const [benchmarkStatus, setBenchmarkStatus] =
    useState<CheckpointBenchmarkStatusDto | null>(null);
  const [benchmarkResultsOpen, setBenchmarkResultsOpen] = useState(false);
  const [clip, setClip] = useState('');
  const [vae, setVae] = useState('');
  const [seed, setSeed] = useState(-1);
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [additionalPositive, setAdditionalPositive] = useState('');
  const [negative, setNegative] = useState('');
  const [profile, setProfile] = useState<GenerationStyleProfileIdDto>(
    'realistic',
  );
  const profilesRef = useRef<
    Record<GenerationStyleProfileIdDto, GenerationStyleProfileDto>
  >({
    realistic: emptyStyleProfile(),
    hentai: emptyStyleProfile(),
    '3d': emptyStyleProfile(),
  });
  const [promptText, setPromptText] = useState('');
  const [promptIssues, setPromptIssues] = useState<IssueDto[]>([]);
  const promptEditorRef = useRef<WildcardEditorHandle | null>(null);
  const [promptSource, setPromptSource] = useState<PromptSource>('folder');
  const [middleMode, setMiddleMode] = useState<MiddleMode>('prompt');
  const [hasWorkflow, setHasWorkflow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptSaveNote, setPromptSaveNote] = useState<string | null>(null);
  const [categorizeOpen, setCategorizeOpen] = useState(false);
  const [contract, setContract] = useState<ComfyContractCheckDto | null>(null);
  const [progress, setProgress] = useState<GenerationProgressDto | null>(null);
  /** Keep showing the last finished image until a newer one arrives. */
  const [heldPreview, setHeldPreview] = useState<{
    url: string;
    prompt?: string;
    negative?: string;
    relativeFolder?: string | null;
    seed?: number | null;
  } | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState(
    readLegacyPreviewCollapsed,
  );
  const [deletingLast, setDeletingLast] = useState(false);
  const [webviewSrc, setWebviewSrc] = useState('');
  const [formHydrated, setFormHydrated] = useState(false);
  const formHydratedRef = useRef(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextPersist = useRef(true);
  const catalogNeedsFillRef = useRef(true);
  const formSnapshotRef = useRef({
    activeProfile: 'realistic' as GenerationStyleProfileIdDto,
    relativeFolder: selectedFolder,
    promptFoldersRecursive: false,
    checkpoint: '',
    clip: '',
    vae: '',
    seed: -1,
    width: 1024,
    height: 1024,
    additionalPositivePrompt: '',
    negativePrompt: '',
    promptText: '',
    promptSource: 'folder' as PromptSource,
    benchmark: false,
  });

  const safetensorCheckpoints = useMemo(
    () => checkpoints.filter(isSafetensorsCheckpoint),
    [checkpoints],
  );

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [conn, tree, profile, ckptList] = await Promise.all([
        window.wcm.comfy.getConnection(),
        window.wcm.prompts.listTree(),
        window.wcm.comfy.getWorkflowProfile(),
        window.wcm.modelFiles.listCheckpoints(),
      ]);
      setConnection(conn);
      const folderList = flattenFolders(tree.folders);
      setFolders(folderList);
      setWebviewSrc(comfyHttpBase(conn));
      setHasWorkflow(Boolean(profile));
      setCheckpoints(ckptList.files);
      setCheckpoint((prev) => {
        if (prev || formHydratedRef.current) return prev;
        const first = ckptList.files.find(isSafetensorsCheckpoint);
        return first ? checkpointOptionValue(first) : '';
      });
      // A saved folder stays selected when the tree has not loaded yet.
      if (
        formHydratedRef.current &&
        selectedFolder &&
        folderList.length > 0 &&
        !folderList.includes(selectedFolder)
      ) {
        onSelectedFolderChange(null);
      }
      if (profile) {
        try {
          setContract(await window.wcm.comfy.checkContract());
        } catch {
          setContract(null);
        }
      } else {
        setContract(null);
      }
      try {
        const next = await window.wcm.comfy.getModelCatalog();
        setCatalog(next);
        catalogNeedsFillRef.current =
          next.clips.length === 0 || next.vaes.length === 0;
      } catch {
        catalogNeedsFillRef.current = true;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [selectedFolder, onSelectedFolderChange, formHydrated]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const form = await window.wcm.comfy.getGenerationForm();
        if (cancelled) return;
        skipNextPersist.current = true;
        profilesRef.current = {
          realistic: { ...form.profiles.realistic },
          hentai: { ...form.profiles.hentai },
          '3d': { ...(form.profiles['3d'] ?? emptyStyleProfile()) },
        };
        setProfile(form.activeProfile);
        setCheckpoint(form.checkpoint);
        setBenchmark(form.benchmark === true);
        setClip(form.clip);
        setVae(form.vae);
        setSeed(form.seed);
        setWidth(form.width);
        setHeight(form.height);
        setAdditionalPositive(form.additionalPositivePrompt);
        setNegative(form.negativePrompt);
        setPromptText(form.promptText);
        setPromptSource(form.promptSource);
        setPromptFoldersRecursive(form.promptFoldersRecursive === true);
        if (form.relativeFolder) {
          onSelectedFolderChange(form.relativeFolder);
        }
        if (form.lastImageUrl) {
          setHeldPreview({
            url: form.lastImageUrl,
            prompt: form.lastPrompt,
            negative: form.lastNegativePrompt,
            relativeFolder: form.lastRelativeFolder ?? null,
            seed: form.lastSeed ?? null,
          });
        }
      } catch {
        // keep defaults
      } finally {
        if (!cancelled) {
          formHydratedRef.current = true;
          setFormHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onSelectedFolderChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Decode !gen.txt into the main-process cache when the Prompt folder changes.
  useEffect(() => {
    if (!selectedFolder) return;
    void window.wcm.prompts.loadGenPrompts(selectedFolder).catch(() => {
      // folder may be stale after a library switch; generation will surface errors
    });
  }, [selectedFolder]);

  useEffect(() => {
    const text = promptText;
    if (!text.trim()) {
      setPromptIssues([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.wcm.prompts
        .validateText(text)
        .then((row) => {
          if (!cancelled) setPromptIssues(row.issues);
        })
        .catch(() => {
          if (!cancelled) setPromptIssues([]);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [promptText]);

  useEffect(() => {
    return window.wcm.comfy.onGenerationProgress((p) => {
      setProgress(p);
      if (p.lastImageUrl) {
        setHeldPreview({
          url: p.lastImageUrl,
          prompt: p.lastPrompt,
          negative: p.lastNegativePrompt,
          // Pin to the finished job’s folder — not in-flight relativeFolder.
          relativeFolder: p.lastRelativeFolder,
          seed: p.lastSeed,
        });
      }
      if (
        p.benchmarkStem != null ||
        p.status === 'done' ||
        p.status === 'cancelled' ||
        p.status === 'error'
      ) {
        void window.wcm.comfy
          .getCheckpointBenchmarkStatus()
          .then(setBenchmarkStatus)
          .catch(() => {
            /* keep last */
          });
      }
      // Fill clip/VAE lists only after the job is idle. Fetching /object_info
      // while status is queued/running parses a multi‑MB payload on the main
      // process at the same time ComfyUI prints "Model Initializing".
      if (
        catalogNeedsFillRef.current &&
        (p.status === 'done' ||
          p.status === 'cancelled' ||
          p.status === 'error')
      ) {
        catalogNeedsFillRef.current = false;
        void window.wcm.comfy
          .getModelCatalog()
          .then((next) => {
            setCatalog(next);
          })
          .catch(() => {
            catalogNeedsFillRef.current = true;
          });
      }
    });
  }, []);

  useEffect(() => {
    if (!benchmark) {
      setBenchmarkStatus(null);
      return;
    }
    let cancelled = false;
    void window.wcm.comfy
      .getCheckpointBenchmarkStatus()
      .then((status) => {
        if (!cancelled) setBenchmarkStatus(status);
      })
      .catch(() => {
        if (!cancelled) setBenchmarkStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [benchmark]);

  useEffect(() => {
    if (!formHydrated) return;
    profilesRef.current = {
      ...profilesRef.current,
      [profile]: {
        relativeFolder: selectedFolder,
        promptFoldersRecursive,
        checkpoint,
        clip,
        vae,
        seed,
        width,
        height,
        additionalPositivePrompt: additionalPositive,
        negativePrompt: negative,
        promptText,
        promptSource,
      },
    };
    formSnapshotRef.current = {
      activeProfile: profile,
      relativeFolder: selectedFolder,
      promptFoldersRecursive,
      checkpoint,
      clip,
      vae,
      seed,
      width,
      height,
      additionalPositivePrompt: additionalPositive,
      negativePrompt: negative,
      promptText,
      promptSource,
      benchmark,
    };
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void window.wcm.comfy.setGenerationForm(formSnapshotRef.current);
    }, 250);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [
    formHydrated,
    selectedFolder,
    promptFoldersRecursive,
    checkpoint,
    clip,
    vae,
    seed,
    width,
    height,
    additionalPositive,
    negative,
    promptText,
    promptSource,
    profile,
    benchmark,
  ]);

  // Flush latest form on unmount so a quick quit doesn't drop the last edit.
  useEffect(() => {
    return () => {
      if (!formHydrated) return;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      void window.wcm.comfy.setGenerationForm(formSnapshotRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only flush
  }, [formHydrated]);

  const injectSavedWorkflow = useCallback(async () => {
    const wv = webviewRef.current as Electron.WebviewTag | null;
    if (!wv) return;
    const gen = ++workflowLoadGen.current;
    setWorkflowGraphReady(false);
    try {
      const profile = await window.wcm.comfy.getWorkflowProfile();
      const ok = await loadWorkflowIntoComfyEditor(wv, {
        uiWorkflow: profile?.uiWorkflow,
        apiWorkflow: profile?.workflow,
      });
      // ComfyUI often restores its own last graph after first paint — force again.
      await new Promise((r) => setTimeout(r, 400));
      if (gen !== workflowLoadGen.current) return;
      const ok2 = await loadWorkflowIntoComfyEditor(wv, {
        uiWorkflow: profile?.uiWorkflow,
        apiWorkflow: profile?.workflow,
      });
      if (gen !== workflowLoadGen.current) return;
      if (!ok && !ok2) {
        setError(
          'Could not load the saved workflow into ComfyUI. Wait for ComfyUI to finish loading, then click Reload.',
        );
        setWorkflowGraphReady(false);
        return;
      }
      setWorkflowGraphReady(true);
      setError(null);
    } catch (e) {
      if (gen !== workflowLoadGen.current) return;
      setWorkflowGraphReady(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (middleMode !== 'workflow') return;
    const wv = webviewRef.current as Electron.WebviewTag | null;
    if (!wv || !webviewSrc) return;
    setWorkflowGraphReady(false);
    const onDomReady = () => {
      void injectSavedWorkflow();
    };
    wv.addEventListener('dom-ready', onDomReady);
    // Already loaded (e.g. remount) — try inject once.
    void injectSavedWorkflow();
    return () => {
      wv.removeEventListener('dom-ready', onDomReady);
    };
  }, [middleMode, webviewSrc, injectSavedWorkflow]);

  const saveWorkflowFromWebview = async () => {
    if (!workflowGraphReady) {
      setError('Wait until the saved workflow finishes loading before saving.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const wv = webviewRef.current as Electron.WebviewTag | null;
      if (!wv) {
        setError('ComfyUI editor is not loaded — check Settings → AI → ComfyUI.');
        return;
      }
      const captured = await wv.executeJavaScript(`
        (async () => {
          if (!window.app || !window.app.graphToPrompt) return null;
          const p = await window.app.graphToPrompt();
          if (!p || !p.output) return null;
          return { output: p.output, workflow: p.workflow ?? null };
        })()
      `);
      if (
        !captured ||
        typeof captured !== 'object' ||
        !('output' in (captured as object))
      ) {
        setError(
          'Could not read the live graph from ComfyUI. Wait until ComfyUI finishes loading, then try again.',
        );
        return;
      }
      const { output, workflow: uiWorkflow } = captured as {
        output: Record<string, unknown>;
        workflow: unknown;
      };
      const saved = await window.wcm.comfy.saveWorkflowProfile({
        formatVersion: 1,
        profileId: 'live',
        name: 'Live',
        workflowHash: 'live',
        importedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        workflow: output,
        uiWorkflow: uiWorkflow ?? undefined,
        bindings: {},
      });
      setHasWorkflow(true);
      try {
        setContract(await window.wcm.comfy.checkContract());
      } catch {
        setContract(null);
      }
      if (saved.warnings.length) {
        setError(`Saved with warnings: ${saved.warnings.join(' ')}`);
      } else {
        setError(null);
      }
      setMiddleMode('prompt');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const persistFormNow = useCallback(async () => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    const snapshot = {
      activeProfile: profile,
      relativeFolder: selectedFolder,
      promptFoldersRecursive,
      checkpoint,
      clip,
      vae,
      seed,
      width,
      height,
      additionalPositivePrompt: additionalPositive,
      negativePrompt: negative,
      promptText,
      promptSource,
      benchmark,
    };
    formSnapshotRef.current = snapshot;
    await window.wcm.comfy.setGenerationForm(snapshot);
  }, [
    selectedFolder,
    promptFoldersRecursive,
    checkpoint,
    clip,
    vae,
    seed,
    width,
    height,
    additionalPositive,
    negative,
    promptText,
    promptSource,
    profile,
    benchmark,
  ]);

  const selectProfile = (next: GenerationStyleProfileIdDto) => {
    if (next === profile) return;
    const leaving: GenerationStyleProfileDto = {
      relativeFolder: selectedFolder,
      promptFoldersRecursive,
      checkpoint,
      clip,
      vae,
      seed,
      width,
      height,
      additionalPositivePrompt: additionalPositive,
      negativePrompt: negative,
      promptText,
      promptSource,
    };
    const profiles = {
      ...profilesRef.current,
      [profile]: leaving,
    };
    const incoming = profiles[next] ?? emptyStyleProfile();
    profilesRef.current = profiles;
    skipNextPersist.current = true;
    setProfile(next);
    setCheckpoint(incoming.checkpoint);
    setClip(incoming.clip);
    setVae(incoming.vae);
    setSeed(incoming.seed);
    setWidth(incoming.width);
    setHeight(incoming.height);
    setAdditionalPositive(incoming.additionalPositivePrompt);
    setNegative(incoming.negativePrompt);
    setPromptText(incoming.promptText);
    setPromptSource(incoming.promptSource);
    setPromptFoldersRecursive(incoming.promptFoldersRecursive === true);
    onSelectedFolderChange(incoming.relativeFolder);
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    const snapshot = {
      activeProfile: next,
      relativeFolder: incoming.relativeFolder,
      promptFoldersRecursive: incoming.promptFoldersRecursive === true,
      checkpoint: incoming.checkpoint,
      clip: incoming.clip,
      vae: incoming.vae,
      seed: incoming.seed,
      width: incoming.width,
      height: incoming.height,
      additionalPositivePrompt: incoming.additionalPositivePrompt,
      negativePrompt: incoming.negativePrompt,
      promptText: incoming.promptText,
      promptSource: incoming.promptSource,
      benchmark,
      profiles,
    };
    formSnapshotRef.current = snapshot;
    void window.wcm.comfy.setGenerationForm(snapshot);
  };

  const start = async (mode: 'once' | 'infinite') => {
    if (promptSource === 'text' && !promptText.trim()) {
      setError('Enter a prompt, or switch to the selected prompt folder.');
      return;
    }
    if (!benchmark && !checkpoint) {
      setError('Select a checkpoint');
      return;
    }
    if (benchmark && !benchmarkStatus?.root) {
      setError('Set Checkpoint Benchmark folder in Library Manager');
      return;
    }
    if (!hasWorkflow) {
      setError('Save a workflow first (Edit Workflow → Save Workflow).');
      return;
    }
    setError(null);
    setPromptSaveNote(null);
    try {
      await persistFormNow();
      await window.wcm.comfy.startGeneration({
        mode,
        styleProfile: profile,
        promptSource,
        relativeFolder: selectedFolder ?? undefined,
        promptFoldersRecursive:
          promptSource === 'folder' && selectedFolder
            ? promptFoldersRecursive
            : undefined,
        promptText: promptSource === 'text' ? promptText : undefined,
        checkpoint: benchmark ? checkpoint || '' : checkpoint,
        clip: clip || undefined,
        vae: vae || undefined,
        seed,
        width,
        height,
        additionalPositivePrompt: additionalPositive || undefined,
        negativePrompt: negative || undefined,
        benchmark: benchmark || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteLastOutput = async () => {
    if (!heldPreview || deletingLast) return;
    setDeletingLast(true);
    setError(null);
    try {
      const result = await window.wcm.comfy.deleteLastGeneration();
      if (result.deleted) setHeldPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingLast(false);
    }
  };

  /** Append the typed prompt to a prompts folder's !gen.txt (skip exact dupes). */
  const appendPromptToFolder = async (folder = selectedFolder) => {
    const line = promptText.trim();
    if (!folder) {
      setError('Select a prompt folder on the left first.');
      return;
    }
    if (!line) {
      setError('Enter a prompt to add.');
      return;
    }
    setBusy(true);
    setError(null);
    setPromptSaveNote(null);
    try {
      const gen = await window.wcm.prompts.readGen(folder);
      const result = appendGenPromptIfMissing(gen.content ?? '', line);
      if (result.alreadyExists) {
        setPromptSaveNote(`Already in ${folder}/!gen.txt`);
        return;
      }
      await window.wcm.prompts.writeGen(folder, result.content);
      await window.wcm.prompts.loadGenPrompts(folder);
      const tree = await window.wcm.prompts.listTree();
      setFolders(flattenFolders(tree.folders));
      setPromptSaveNote(`Added to ${folder}/!gen.txt`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const running =
    progress?.status === 'starting' ||
    progress?.status === 'queued' ||
    progress?.status === 'running' ||
    progress?.status === 'saving';
  const liveCategoryBreadcrumb = running
    ? promptCategoryBreadcrumb(progress?.relativeFolder)
    : '';
  const liveJobSeed =
    running &&
    typeof progress?.seed === 'number' &&
    Number.isFinite(progress.seed)
      ? progress.seed >>> 0
      : null;

  const applySeedToForm = (value: number) => {
    setSeed(value >>> 0);
  };

  useEffect(() => {
    let cancelled = false;
    void window.wcm.ui.getSettings().then((settings) => {
      if (cancelled) return;
      if (settings.generationPreviewCollapsed != null) {
        setPreviewCollapsed(settings.generationPreviewCollapsed);
      } else {
        const legacy = readLegacyPreviewCollapsed();
        setPreviewCollapsed(legacy);
        void window.wcm.ui.setGenerationPreviewCollapsed(legacy);
      }
      clearLegacyPreviewCollapsed();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreviewCollapsedPersist = (collapsed: boolean) => {
    setPreviewCollapsed(collapsed);
    clearLegacyPreviewCollapsed();
    void window.wcm.ui.setGenerationPreviewCollapsed(collapsed);
  };

  return (
    <main
      className={`workspace workspace-generation${
        previewCollapsed ? ' preview-collapsed' : ''
      }${active ? '' : ' workspace-tab-hidden'}`}
      aria-hidden={!active}
      style={
        {
          '--files-panel-width': `${filesWidth}px`,
          '--details-panel-width': `${detailsWidth}px`,
        } as CSSProperties
      }
    >
      <aside className="files-panel generation-controls">
        <div className="panel-toolbar">
          <strong>Generation</strong>
          <button
            type="button"
            className="icon-btn"
            title="Refresh"
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} className={busy ? 'spin' : undefined} />
          </button>
        </div>
        <div className="generation-form">
          <div
            className="segmented generation-profile-tabs"
            role="tablist"
            aria-label="Generation profile"
          >
            <button
              type="button"
              role="tab"
              aria-selected={profile === 'realistic'}
              className={profile === 'realistic' ? 'active' : undefined}
              onClick={() => selectProfile('realistic')}
            >
              Realistic
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={profile === 'hentai'}
              className={profile === 'hentai' ? 'active' : undefined}
              onClick={() => selectProfile('hentai')}
            >
              Anime
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={profile === '3d'}
              className={profile === '3d' ? 'active' : undefined}
              onClick={() => selectProfile('3d')}
            >
              3D
            </button>
          </div>
          {contract ? (
            <p className={`hint${contract.ok ? '' : ' error-text'}`}>
              {contract.ok ? (
                <>
                  <CheckCircle2 size={12} /> Workflow ready
                  {contract.usesContractNodes ? ' (pack nodes)' : ''}
                </>
              ) : (
                <>Missing: {contract.requiredMissing.join(', ')}</>
              )}
            </p>
          ) : (
            <p className="hint">
              {hasWorkflow
                ? 'Workflow saved — Edit Workflow to change it.'
                : 'No workflow saved yet — use Edit Workflow.'}
            </p>
          )}

          <label className="field-label">Prompt folder</label>
          <select
            className="text-input"
            value={selectedFolder ?? ''}
            onChange={(e) =>
              onSelectedFolderChange(e.target.value || null)
            }
          >
            <option value="">Select… [Randomize]</option>
            {selectedFolder && !folders.includes(selectedFolder) ? (
              <option value={selectedFolder}>{selectedFolder}</option>
            ) : null}
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <label
            className={`generation-recursive${selectedFolder ? '' : ' is-disabled'}`}
            title={
              selectedFolder
                ? 'Off: only this folder’s !gen.txt. On: also sub-folders that have !gen.txt.'
                : 'Select a prompt folder to limit Randomize to that folder or its sub-folders.'
            }
          >
            <input
              type="checkbox"
              checked={promptFoldersRecursive}
              disabled={!selectedFolder}
              onChange={(e) => setPromptFoldersRecursive(e.target.checked)}
            />
            Recursive
          </label>
          {selectedFolder ? (
            <p className="hint">
              {promptFoldersRecursive
                ? 'Picks among this folder and sub-folders with !gen.txt.'
                : 'Uses only this folder’s !gen.txt (sub-folders ignored).'}
            </p>
          ) : (
            <p className="hint">
              Empty selection randomizes across every folder with !gen.txt.
            </p>
          )}

          <div className="generation-checkpoint-label-row">
            <label className="field-label">Checkpoint</label>
            <div className="generation-benchmark-controls">
              <label
                className="generation-recursive"
                title="Walk every .safetensors checkpoint into the Benchmark folder (10 WCG images each)."
              >
                <input
                  type="checkbox"
                  checked={benchmark}
                  onChange={(e) => setBenchmark(e.target.checked)}
                />
                Benchmark
              </label>
              <button
                type="button"
                className="icon-btn"
                title="Open Benchmark results graph (avg timings)"
                aria-label="Open Benchmark results graph"
                onClick={() => setBenchmarkResultsOpen(true)}
              >
                <LineChart size={14} />
              </button>
            </div>
          </div>
          <select
            className="text-input"
            value={checkpoint}
            disabled={benchmark}
            onChange={(e) => setCheckpoint(e.target.value)}
          >
            <option value="">Select…</option>
            {checkpoint &&
            !safetensorCheckpoints.some(
              (file) => checkpointOptionValue(file) === checkpoint,
            ) ? (
              <option value={checkpoint}>
                {checkpoint.replace(/^.*[\\/]/, '').replace(/\.safetensors$/i, '')}
              </option>
            ) : null}
            {safetensorCheckpoints.map((file) => {
              const value = checkpointOptionValue(file);
              return (
                <option key={value} value={value}>
                  {file.stem}
                </option>
              );
            })}
          </select>
          {benchmark ? (
            <>
              <p className="hint">
                {benchmarkStatus?.root
                  ? benchmarkStatus.nextStem
                    ? `Next: ${benchmarkStatus.nextStem} (${benchmarkStatus.nextImageCount}/${benchmarkStatus.targetImagesPerCheckpoint}) · ${benchmarkStatus.completedCheckpoints}/${benchmarkStatus.totalCheckpoints} complete · ${benchmarkStatus.remainingImages} images left`
                    : `Complete — ${benchmarkStatus.completedCheckpoints}/${benchmarkStatus.totalCheckpoints} checkpoints have ${benchmarkStatus.targetImagesPerCheckpoint} images`
                  : 'Set Checkpoint Benchmark folder in Library Manager.'}
              </p>
              {benchmarkStatus?.root &&
              (benchmarkStatus.fastest || benchmarkStatus.slowest) ? (
                <p className="hint">
                  {benchmarkStatus.fastest
                    ? `Fastest avg: ${benchmarkStatus.fastest.stem} (${formatBenchmarkAvgMs(benchmarkStatus.fastest.avgDurationMs)})`
                    : null}
                  {benchmarkStatus.fastest && benchmarkStatus.slowest
                    ? ' · '
                    : null}
                  {benchmarkStatus.slowest
                    ? `Slowest avg: ${benchmarkStatus.slowest.stem} (${formatBenchmarkAvgMs(benchmarkStatus.slowest.avgDurationMs)})`
                    : null}
                </p>
              ) : null}
            </>
          ) : safetensorCheckpoints.length === 0 ? (
            <p className="hint">
              No .safetensors checkpoints in the Checkpoint files folder.
            </p>
          ) : null}

          <label className="field-label">CLIP (optional)</label>
          <select
            className="text-input"
            value={clip}
            onChange={(e) => setClip(e.target.value)}
          >
            <option value="">—</option>
            {withSavedChoice(catalog?.clips ?? [], clip).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <label className="field-label">VAE (optional)</label>
          <select
            className="text-input"
            value={vae}
            onChange={(e) => setVae(e.target.value)}
          >
            <option value="">—</option>
            {withSavedChoice(catalog?.vaes ?? [], vae).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <label className="field-label">Seed (≤0 = random)</label>
          <div className="generation-seed-row">
            <input
              className="text-input mono"
              type="number"
              value={seed}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw.trim() === '' || raw === '-') {
                  setSeed(-1);
                  return;
                }
                const n = Number(raw);
                setSeed(Number.isFinite(n) ? n : -1);
              }}
            />
            <button
              type="button"
              className="icon-btn"
              title="Random seed (−1)"
              aria-label="Random seed"
              onClick={() => setSeed(-1)}
            >
              <Dices size={14} />
            </button>
          </div>

          <div className="generation-size-row">
            <label className="generation-size-field">
              <span className="field-label">Width</span>
              <input
                className="text-input"
                type="number"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value) || 1024)}
              />
            </label>
            <label className="generation-size-field">
              <span className="field-label">Height</span>
              <input
                className="text-input"
                type="number"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value) || 1024)}
              />
            </label>
          </div>

          <label className="field-label">
            Additional Positive Prompt (optional)
          </label>
          <textarea
            className="text-input"
            rows={2}
            value={additionalPositive}
            placeholder={
              profile === 'hentai'
                ? 'e.g. __style-hentai__'
                : profile === '3d'
                  ? 'e.g. __style-3d__'
                  : 'e.g. realistic photograph, natural colors'
            }
            onChange={(e) => setAdditionalPositive(e.target.value)}
          />

          <label className="field-label">Negative (optional)</label>
          <textarea
            className="text-input"
            rows={3}
            value={negative}
            onChange={(e) => setNegative(e.target.value)}
          />

          <div className="row-actions generation-actions">
            <button
              type="button"
              className="primary"
              disabled={running || busy}
              onClick={() => void start('once')}
            >
              <Zap size={14} /> Once
            </button>
            <button
              type="button"
              disabled={running || busy}
              onClick={() => void start('infinite')}
            >
              Infinite
            </button>
            <button
              type="button"
              className="danger"
              disabled={!running}
              onClick={() => void window.wcm.comfy.cancelGeneration()}
            >
              <Square size={14} /> Cancel
            </button>
          </div>
          {progress ? (
            <p className="hint generation-progress-hint">
              {running ? <Loader2 size={12} className="spin" /> : null}{' '}
              {progress.status === 'starting'
                ? (progress.detail ?? 'Starting ComfyUI…')
                : progress.status}
              {progress.jobsCompleted
                ? ` · ${progress.jobsCompleted} done`
                : ''}
              {progress.benchmarkStem
                ? ` · ${progress.benchmarkStem} (${progress.benchmarkImageCount ?? 0}/${progress.benchmarkTargetImages ?? 10})`
                : ''}
              {liveJobSeed != null ? (
                <>
                  {' · seed '}
                  <span className="mono">{liveJobSeed}</span>
                  <button
                    type="button"
                    className="icon-btn generation-seed-fill-btn"
                    title="Set Seed to this value"
                    aria-label="Set Seed to this value"
                    onClick={() => applySeedToForm(liveJobSeed)}
                  >
                    <Crosshair size={12} />
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          {progress?.error ? (
            <p className="error-text">{progress.error}</p>
          ) : null}
          {error ? (
            <p
              className={
                error.startsWith('Saved with warnings')
                  ? 'hint'
                  : 'error-text'
              }
            >
              {error}
            </p>
          ) : null}
        </div>
      </aside>

      <PanelSplitter kind="files" {...filesSplitter} />

      <section className="details-panel generation-middle-panel">
        {middleMode === 'workflow' ? (
          <>
            <div className="panel-toolbar">
              <strong>Edit Workflow</strong>
              <div className="row-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy || !workflowGraphReady}
                  title="Save the live ComfyUI graph and return to the prompt view"
                  onClick={() => void saveWorkflowFromWebview()}
                >
                  <Save size={14} />{' '}
                  {workflowGraphReady ? 'Save Workflow' : 'Loading graph…'}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={() => setMiddleMode('prompt')}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Reload ComfyUI and re-inject the saved workflow"
                  onClick={() => {
                    setWorkflowGraphReady(false);
                    (
                      webviewRef.current as Electron.WebviewTag | null
                    )?.reload();
                  }}
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
            {webviewSrc ? (
              // eslint-disable-next-line react/no-unknown-property
              <webview
                ref={webviewRef as never}
                className="generation-webview"
                src={webviewSrc}
                partition="persist:comfyui"
                allowpopups={false as never}
              />
            ) : (
              <p className="hint pad">
                Configure ComfyUI host in Settings → AI to load the editor.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="panel-toolbar">
              <strong>Prompt</strong>
              <button
                type="button"
                className="generation-action-btn"
                title="Open ComfyUI to edit the generation workflow"
                onClick={() => setMiddleMode('workflow')}
              >
                <Workflow size={14} /> Edit Workflow
              </button>
            </div>
            <div className="generation-prompt-pane">
              <div className="generation-prompt-source-row">
                <div
                  className="generation-prompt-source"
                  role="group"
                  aria-label="Prompt source"
                >
                  <label className="generation-prompt-source-option">
                    <input
                      type="radio"
                      name="generation-prompt-source"
                      checked={promptSource === 'text'}
                      onChange={() => {
                        setPromptSource('text');
                        setPromptSaveNote(null);
                      }}
                    />
                    <span>Use this prompt</span>
                  </label>
                  <label className="generation-prompt-source-option">
                    <input
                      type="radio"
                      name="generation-prompt-source"
                      checked={promptSource === 'folder'}
                      onChange={() => {
                        setPromptSource('folder');
                        setPromptSaveNote(null);
                      }}
                    />
                    <span>
                      Use selected prompt folder
                      {selectedFolder ? ` (${selectedFolder})` : ' (random)'}
                    </span>
                  </label>
                </div>
                <div className="generation-prompt-actions">
                  <button
                    type="button"
                    className="generation-action-btn"
                    disabled={busy || !promptText.trim()}
                    title="Save this prompt into a Prompts folder !gen.txt"
                    onClick={() => setCategorizeOpen(true)}
                  >
                    <Tags size={14} /> Categorize…
                  </button>
                  <button
                    type="button"
                    className="generation-action-btn"
                    disabled={busy || !selectedFolder || !promptText.trim()}
                    title={
                      selectedFolder
                        ? `Append this prompt to ${selectedFolder}/!gen.txt`
                        : 'Select a prompt folder on the left first'
                    }
                    onClick={() => void appendPromptToFolder()}
                  >
                    <FilePlus2 size={14} />{' '}
                    {selectedFolder
                      ? `Add to ${selectedFolder}/!gen.txt`
                      : 'Add to folder !gen.txt'}
                  </button>
                  {promptSaveNote ? (
                    <span className="hint">{promptSaveNote}</span>
                  ) : null}
                </div>
              </div>
              <WildcardEditor
                ref={promptEditorRef}
                className="wildcard-editor generation-prompt-editor"
                value={promptText}
                fileExt=".txt"
                wildcardKeys={wildcardKeys}
                onOpenWildcard={onOpenWildcard}
                onCreateWildcard={onCreateWildcard}
                onRenameLora={onRenameLora}
                onOpenLora={onOpenLora}
                onOpenLoraInCivitaiCatalog={onOpenLoraInCivitaiCatalog}
                onChange={(text) => {
                  setPromptText(text);
                  setPromptSaveNote(null);
                }}
              />
              {promptIssues.length > 0 ? (
                <ul className="prompts-gen-issues">
                  {promptIssues.map((issue, index) => (
                    <li
                      key={`${issue.code}-${issue.line ?? ''}-${index}`}
                      onClick={() => {
                        if (issue.line) {
                          promptEditorRef.current?.jumpToLine(
                            issue.line,
                            issue.column,
                          );
                        }
                      }}
                    >
                      <p
                        className={
                          issue.severity === 'warning' ? 'warn-text' : 'error-text'
                        }
                      >
                        <strong>{issue.code.replaceAll('_', ' ')}</strong>
                        {' — '}
                        {issue.message}
                        {issue.line ? ` · line ${issue.line}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
              {promptSource === 'folder' ? (
                <p className="hint generation-folder-hint">
                  {liveCategoryBreadcrumb ||
                  (running && !selectedFolder) ? (
                    <>
                      <span>
                        {liveCategoryBreadcrumb
                          ? `Generating “${liveCategoryBreadcrumb}”…`
                          : 'Generating… (picking folder)'}
                        {liveJobSeed != null
                          ? ` · seed ${liveJobSeed}`
                          : ''}
                      </span>
                      {liveJobSeed != null ? (
                        <button
                          type="button"
                          className="icon-btn generation-seed-fill-btn"
                          title="Set Seed to this value"
                          aria-label="Set Seed to this value"
                          onClick={() => applySeedToForm(liveJobSeed)}
                        >
                          <Crosshair size={12} />
                        </button>
                      ) : null}
                    </>
                  ) : selectedFolder ? (
                    `Folder mode uses lines from ${selectedFolder}/!gen.txt. Your typed prompt above is kept for “Use this prompt”.`
                  ) : (
                    'Select… [Randomize] picks a different !gen.txt folder on every run.'
                  )}
                </p>
              ) : null}
            </div>
          </>
        )}
      </section>

      {previewCollapsed ? null : (
        <PanelSplitter kind="details" {...detailsSplitter} />
      )}

      <aside
        className={`civitai-side-panel generation-preview-panel${
          previewCollapsed ? ' is-collapsed' : ''
        }`}
      >
        <div className="panel-toolbar">
          {previewCollapsed ? null : <strong>Last output</strong>}
          <div className="row-actions">
            {heldPreview ? (
              <>
                <button
                  type="button"
                  className="icon-btn"
                  title="Reveal in My File Explorer"
                  aria-label="Reveal in My File Explorer"
                  onClick={() => {
                    void window.wcm.comfy.revealLastGeneration().catch((e) => {
                      setError(e instanceof Error ? e.message : String(e));
                    });
                  }}
                >
                  <FolderOpen size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Delete last generation"
                  aria-label="Delete last generation"
                  disabled={deletingLast}
                  onClick={() => void deleteLastOutput()}
                >
                  {deletingLast ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="icon-btn"
              title={previewCollapsed ? 'Show preview' : 'Hide preview'}
              aria-label={previewCollapsed ? 'Show preview' : 'Hide preview'}
              aria-expanded={!previewCollapsed}
              onClick={() => setPreviewCollapsedPersist(!previewCollapsed)}
            >
              {previewCollapsed ? (
                <PanelRightOpen size={14} />
              ) : (
                <PanelRightClose size={14} />
              )}
            </button>
          </div>
        </div>
        {previewCollapsed ? null : heldPreview ? (
          <div className="generation-preview">
            <img src={heldPreview.url} alt="Last generation" />
            {heldPreview.prompt ||
            heldPreview.negative ||
            promptCategoryBreadcrumb(heldPreview.relativeFolder) ||
            (typeof heldPreview.seed === 'number' &&
              Number.isFinite(heldPreview.seed)) ? (
              <div className="generation-preview-prompts">
                {promptCategoryBreadcrumb(heldPreview.relativeFolder) ? (
                  <div className="generation-preview-prompt">
                    <span className="generation-preview-prompt-label">
                      Category
                    </span>
                    <div
                      className="generation-preview-prompt-value generation-preview-category"
                      title={heldPreview.relativeFolder ?? undefined}
                    >
                      {promptCategoryBreadcrumb(heldPreview.relativeFolder)}
                    </div>
                  </div>
                ) : null}
                {typeof heldPreview.seed === 'number' &&
                Number.isFinite(heldPreview.seed) ? (
                  <div className="generation-preview-prompt">
                    <span className="generation-preview-prompt-label">
                      Seed
                    </span>
                    <div className="generation-preview-seed-row">
                      <div className="generation-preview-prompt-value generation-preview-seed">
                        {heldPreview.seed >>> 0}
                      </div>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Set Seed to this value"
                        aria-label="Set Seed to this value"
                        onClick={() =>
                          applySeedToForm(heldPreview.seed as number)
                        }
                      >
                        <Crosshair size={14} />
                      </button>
                    </div>
                  </div>
                ) : null}
                {heldPreview.prompt ? (
                  <div className="generation-preview-prompt">
                    <span className="generation-preview-prompt-label">
                      Positive
                    </span>
                    <div className="generation-preview-prompt-value">
                      {heldPreview.prompt}
                    </div>
                  </div>
                ) : null}
                {heldPreview.negative ? (
                  <div className="generation-preview-prompt">
                    <span className="generation-preview-prompt-label">
                      Negative
                    </span>
                    <div className="generation-preview-prompt-value">
                      {heldPreview.negative}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="hint pad">Generate to preview here.</p>
        )}
      </aside>
      {categorizeOpen ? (
        <CategorizePromptModal
          promptText={promptText}
          initialFolder={selectedFolder}
          onClose={() => setCategorizeOpen(false)}
          onSaved={(result) => {
            void window.wcm.prompts.listTree().then((tree) => {
              setFolders(flattenFolders(tree.folders));
            });
            if (result.alreadyExists) {
              setPromptSaveNote(`Already in ${result.relativeFolder}/!gen.txt`);
            } else if (result.added) {
              setPromptSaveNote(`Added to ${result.relativeFolder}/!gen.txt`);
              onSelectedFolderChange(result.relativeFolder);
            }
          }}
        />
      ) : null}
      {benchmarkResultsOpen ? (
        <CheckpointBenchmarkResultsModal
          onClose={() => setBenchmarkResultsOpen(false)}
          onSelectCheckpoint={(relativePath) => {
            setBenchmark(false);
            setCheckpoint(relativePath);
          }}
        />
      ) : null}
    </main>
  );
}
