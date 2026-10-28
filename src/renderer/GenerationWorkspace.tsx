import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MutableRefObject,
} from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  LineChart,
  Dices,
  FilePlus2,
  Shuffle,
  Replace,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Save,
  Square,
  Tags,
  Workflow,
  Zap,
} from 'lucide-react';
import type {
  CheckpointBenchmarkStatusDto,
  ComfyConnectionDto,
  ComfyContractCheckDto,
  ComfyModelCatalogDto,
  GenerationFormStateDto,
  GenerationStyleProfileDto,
  GenerationStyleProfileIdDto,
  IssueDto,
  ModelFileManagerEntryDto,
  PromptTreeDto,
} from '../shared/contracts';
import { appendGenPromptIfMissing } from '../domain/genPrompts.js';
import {
  generationSamplerOptions,
  matchUpscaler,
  samplerLabel,
  schedulerLabel,
} from '../domain/generationFamily';
import { missingFileSearchQuery } from '../domain/missingFileSearch';
import { randomFixedGenerationSeed } from '../domain/generationPromptPick.js';
import {
  stepGenerationResolution,
  swapGenerationSize,
} from '../domain/generationResolution';
import { PanelSplitter, type PanelSplitterHandlers } from './PanelSplitter';
import { loadWorkflowIntoComfyEditor } from './comfyWorkflowEditor';
import { comfyHttpBase } from '../shared/comfy';
import { WildcardEditor, type WildcardEditorHandle } from './WildcardEditor';
import { CategorizePromptModal } from './CategorizePromptModal';
import { PromptSubstitutionsModal } from './PromptSubstitutionsModal';
import { CheckpointBenchmarkResultsModal } from './CheckpointBenchmarkResultsModal';
import {
  isGenerationRunning,
  subscribeGenerationRunning,
  type GenerationRunHandle,
} from './generationRun';
import {
  GenerationFolderLiveHint,
  GenerationJobStatus,
  GenerationPreviewActions,
  GenerationPreviewBody,
  rememberGenerationPreview,
} from './generationLive';
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
  /** Prompts → Generate this folder. Applies once per nonce. */
  folderPick?: { folder: string; nonce: number } | null;
  wildcardKeys?: string[];
  onOpenWildcard?: (name: string) => void;
  onCreateWildcard?: (name: string) => void;
  onRenameLora?: (name: string) => void;
  onOpenLora?: (name: string) => void;
  onOpenLoraInCivitaiCatalog?: (model: ParsedCivitaiModelPageUrl) => void;
  /**
   * Prompts title-bar Once / Infinite. Same start path as this tab, with an
   * optional folder override for the !gen.txt that is open.
   */
  runRef?: MutableRefObject<GenerationRunHandle | null>;
  /** Live Once inputs so Expand previews the prompt that would be queued. */
  /** Active library’s graph family. Krea 2 leaves this screen unchanged. */
  generationFamily?: 'krea2' | 'sdxl';
  /** Saves and reloads the Generation form for this library only. */
  libraryId?: string | null;
  expandSnapshotRef?: MutableRefObject<{
    kind: 'generation';
    promptSource: 'text' | 'folder';
    promptSingle: boolean;
    promptText: string;
    relativeFolder: string | null;
    promptFoldersRecursive: boolean;
    additionalPositivePrompt: string;
    seed: number;
    checkpoint: string;
  } | null>;
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
    steps: 20,
    cfg: 7,
    samplerName: '',
    scheduler: '',
    denoise: 1,
    upscaler: '',
    upscaleFactor: 1.5,
    hiresDenoise: 0.5,
    clipSkip: 2,
    additionalPositivePrompt: '',
    negativePrompt: '',
    promptText: '',
    promptSource: 'folder',
    promptSingle: false,
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

/** Persist vertical resizes. The first observation is the layout size, not a drag. */
function watchPromptBoxHeight(
  el: HTMLElement | null,
  onHeight: (height: number) => void,
): () => void {
  if (!el || typeof ResizeObserver === 'undefined') return () => {};
  let skip = true;
  let last = Math.round(el.getBoundingClientRect().height);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const obs = new ResizeObserver(() => {
    const next = Math.round(el.getBoundingClientRect().height);
    if (skip) {
      skip = false;
      last = next;
      return;
    }
    if (next === last) return;
    last = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => onHeight(next), 300);
  });
  obs.observe(el);
  return () => {
    obs.disconnect();
    if (timer) clearTimeout(timer);
  };
}

export function GenerationWorkspace({
  filesWidth,
  detailsWidth,
  filesSplitter,
  detailsSplitter,
  active = true,
  selectedFolder,
  onSelectedFolderChange,
  folderPick = null,
  wildcardKeys = [],
  onOpenWildcard,
  onCreateWildcard,
  onRenameLora,
  onOpenLora,
  onOpenLoraInCivitaiCatalog,
  expandSnapshotRef,
  runRef,
  generationFamily = 'krea2',
  libraryId = null,
}: Props) {
  const libraryIdRef = useRef(libraryId);
  libraryIdRef.current = libraryId;
  const persistGenerationForm = (
    patch: Parameters<typeof window.wcm.comfy.setGenerationForm>[0],
  ) =>
    window.wcm.comfy.setGenerationForm(
      patch,
      libraryIdRef.current ?? undefined,
    );
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
  const [steps, setSteps] = useState(20);
  const [cfg, setCfg] = useState(7);
  const [samplerName, setSamplerName] = useState('');
  const [scheduler, setScheduler] = useState('');
  const [denoise, setDenoise] = useState(1);
  const [upscaler, setUpscaler] = useState('');
  const [upscaleFactor, setUpscaleFactor] = useState(1.5);
  const [hiresDenoise, setHiresDenoise] = useState(0.5);
  const [clipSkip, setClipSkip] = useState(2);
  const [formSection, setFormSection] = useState<'generation' | 'options'>(
    'generation',
  );
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
  const [promptSingle, setPromptSingle] = useState(false);
  if (expandSnapshotRef) {
    expandSnapshotRef.current = {
      kind: 'generation',
      promptSource,
      promptSingle,
      promptText,
      relativeFolder: selectedFolder,
      promptFoldersRecursive,
      additionalPositivePrompt: additionalPositive,
      seed,
      checkpoint,
    };
  }
  const [middleMode, setMiddleMode] = useState<MiddleMode>('prompt');
  const [hasWorkflow, setHasWorkflow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptSaveNote, setPromptSaveNote] = useState<string | null>(null);
  const [categorizeOpen, setCategorizeOpen] = useState(false);
  const [substitutionsOpen, setSubstitutionsOpen] = useState(false);
  const [substitutionCount, setSubstitutionCount] = useState(0);
  const [contract, setContract] = useState<ComfyContractCheckDto | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState(
    readLegacyPreviewCollapsed,
  );
  const additionalPositiveRef = useRef<HTMLDivElement>(null);
  const negativePromptRef = useRef<HTMLDivElement>(null);
  const [additionalPositiveHeight, setAdditionalPositiveHeight] = useState<
    number | null
  >(null);
  const [negativePromptHeight, setNegativePromptHeight] = useState<
    number | null
  >(null);
  const [webviewSrc, setWebviewSrc] = useState('');
  const [formHydrated, setFormHydrated] = useState(false);
  const formHydratedRef = useRef(false);
  const formEpochRef = useRef(0);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextPersist = useRef(true);
  const appliedFolderPick = useRef(0);
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
    steps: 20,
    cfg: 7,
    samplerName: '',
    scheduler: '',
    denoise: 1,
    upscaler: '',
    upscaleFactor: 1.5,
    hiresDenoise: 0.5,
    clipSkip: 2,
    additionalPositivePrompt: '',
    negativePrompt: '',
    promptText: '',
    promptSource: 'folder' as PromptSource,
    promptSingle: false,
    benchmark: false,
  });
  const lastSavedRef = useRef({ ...formSnapshotRef.current });

  const safetensorCheckpoints = useMemo(
    () => checkpoints.filter(isSafetensorsCheckpoint),
    [checkpoints],
  );
  const usableCheckpoints = useMemo(
    () => safetensorCheckpoints.filter((file) => file.enabled !== false),
    [safetensorCheckpoints],
  );
  const smallerSize = useMemo(
    () => stepGenerationResolution(width, height, 'down'),
    [width, height],
  );
  const largerSize = useMemo(
    () => stepGenerationResolution(width, height, 'up'),
    [width, height],
  );
  const samplerOptions = useMemo(
    () =>
      generationSamplerOptions(
        generationFamily,
        catalog?.samplers ?? [],
        samplerName,
      ),
    [catalog?.samplers, generationFamily, samplerName],
  );
  const upscalerOptions = useMemo(() => {
    const names = catalog?.upscalers ?? [];
    const matched = matchUpscaler(upscaler, names);
    if (matched && !names.includes(matched)) return [matched, ...names];
    return names;
  }, [catalog?.upscalers, upscaler]);

  useEffect(() => {
    if (generationFamily !== 'sdxl') return;
    const matched = matchUpscaler(upscaler, catalog?.upscalers ?? []);
    if (matched && matched !== upscaler) setUpscaler(matched);
  }, [catalog?.upscalers, generationFamily, upscaler]);

  useEffect(() => {
    let cancelled = false;
    void window.wcm.ui
      .getPromptSubstitutions()
      .then((rules) => {
        if (!cancelled) setSubstitutionCount(rules.length);
      })
      .catch(() => {
        if (!cancelled) setSubstitutionCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!checkpoint) return;
    const match = checkpoints.find(
      (file) =>
        isSafetensorsCheckpoint(file) &&
        checkpointOptionValue(file) === checkpoint,
    );
    if (!match || match.enabled !== false) return;
    const next = usableCheckpoints[0];
    setCheckpoint(next ? checkpointOptionValue(next) : '');
  }, [checkpoint, checkpoints, usableCheckpoints]);

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
        const usable = ckptList.files.filter(
          (file) => isSafetensorsCheckpoint(file) && file.enabled !== false,
        );
        if (
          prev &&
          usable.some((file) => checkpointOptionValue(file) === prev)
        ) {
          return prev;
        }
        const known = ckptList.files.some(
          (file) =>
            isSafetensorsCheckpoint(file) &&
            checkpointOptionValue(file) === prev,
        );
        if (prev && known) {
          const first = usable[0];
          return first ? checkpointOptionValue(first) : '';
        }
        if (prev || formHydratedRef.current) return prev;
        const first = usable[0];
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
          next.clips.length === 0 ||
          next.vaes.length === 0 ||
          next.samplers.length === 0 ||
          next.schedulers.length === 0;
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
      const epoch = formEpochRef.current;
      try {
        const form = await window.wcm.comfy.getGenerationForm();
        if (cancelled || formEpochRef.current !== epoch) return;
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
        setSteps(form.steps);
        setCfg(form.cfg);
        setSamplerName(form.samplerName);
        setScheduler(form.scheduler);
        setDenoise(form.denoise);
        setUpscaler(form.upscaler ?? '');
        setUpscaleFactor(form.upscaleFactor ?? 1.5);
        setHiresDenoise(form.hiresDenoise ?? 0.5);
        setClipSkip(form.clipSkip ?? 2);
        setSeed(form.seed);
        setWidth(form.width);
        setHeight(form.height);
        setAdditionalPositive(form.additionalPositivePrompt);
        setNegative(form.negativePrompt);
        setPromptText(form.promptText);
        setPromptSource(form.promptSource);
        setPromptSingle(form.promptSingle === true);
        setPromptFoldersRecursive(form.promptFoldersRecursive === true);
        onSelectedFolderChange(form.relativeFolder ?? null);
        if (form.lastImageUrl) {
          rememberGenerationPreview({
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
    const text = promptSingle
      ? promptText.replace(/\s*\r?\n\s*/g, ' ').trim()
      : promptText;
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
  }, [promptSingle, promptText]);

  useEffect(() => {
    return window.wcm.comfy.onGenerationProgress((p) => {
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
        steps,
        cfg,
        samplerName,
        scheduler,
        denoise,
        upscaler,
        upscaleFactor,
        hiresDenoise,
        clipSkip,
        additionalPositivePrompt: additionalPositive,
        negativePrompt: negative,
        promptText,
        promptSource,
        promptSingle,
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
      steps,
      cfg,
      samplerName,
      scheduler,
      denoise,
      upscaler,
      upscaleFactor,
      hiresDenoise,
      clipSkip,
      additionalPositivePrompt: additionalPositive,
      negativePrompt: negative,
      promptText,
      promptSource,
      promptSingle,
      benchmark,
    };
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      lastSavedRef.current = formSnapshotRef.current;
      return;
    }
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      lastSavedRef.current = formSnapshotRef.current;
      void persistGenerationForm(formSnapshotRef.current);
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
    steps,
    cfg,
    samplerName,
    scheduler,
    denoise,
    upscaler,
    upscaleFactor,
    hiresDenoise,
    clipSkip,
    seed,
    width,
    height,
    additionalPositive,
    negative,
    promptText,
    promptSource,
    promptSingle,
    profile,
    benchmark,
  ]);

  // Prompts context menu: point the dropdown at a folder without starting a run.
  // Infinite re-reads this form before each image.
  useEffect(() => {
    if (!folderPick || folderPick.nonce === appliedFolderPick.current) return;
    appliedFolderPick.current = folderPick.nonce;
    setPromptSource('folder');
    if (selectedFolder !== folderPick.folder) {
      onSelectedFolderChange(folderPick.folder);
    }
    const snapshot = {
      ...formSnapshotRef.current,
      relativeFolder: folderPick.folder,
      promptSource: 'folder' as const,
    };
    formSnapshotRef.current = snapshot;
    lastSavedRef.current = snapshot;
    const activeId = snapshot.activeProfile;
    profilesRef.current = {
      ...profilesRef.current,
      [activeId]: {
        ...profilesRef.current[activeId],
        relativeFolder: folderPick.folder,
        promptSource: 'folder',
      },
    };
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    if (formHydratedRef.current) {
      void persistGenerationForm(snapshot);
    } else {
      void persistGenerationForm({
        relativeFolder: folderPick.folder,
        promptSource: 'folder',
      });
    }
  }, [folderPick, selectedFolder, onSelectedFolderChange]);

  // Flush latest form on unmount so a quick quit doesn't drop the last edit.
  useEffect(() => {
    return () => {
      if (!formHydrated) return;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      lastSavedRef.current = formSnapshotRef.current;
      void persistGenerationForm(formSnapshotRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only flush
  }, [formHydrated]);

  const applyRemoteFormRef = useRef<(form: GenerationFormStateDto) => void>(
    () => {},
  );
  applyRemoteFormRef.current = (form) => {
    const local = formSnapshotRef.current;
    const saved = lastSavedRef.current;
    const profileChanged = form.activeProfile !== local.activeProfile;
    // Keep a field only when this tab changed it after the last save.
    // A style change belongs to the other profile, so those keystrokes
    // are not written onto it.
    const pick = <T,>(
      localValue: T,
      remoteValue: T,
      savedValue: T,
    ): T =>
      !profileChanged && localValue !== savedValue ? localValue : remoteValue;
    const next = {
      activeProfile: form.activeProfile,
      relativeFolder: pick(
        local.relativeFolder,
        form.relativeFolder,
        saved.relativeFolder,
      ),
      promptFoldersRecursive: pick(
        local.promptFoldersRecursive,
        form.promptFoldersRecursive === true,
        saved.promptFoldersRecursive,
      ),
      checkpoint: pick(local.checkpoint, form.checkpoint, saved.checkpoint),
      clip: pick(local.clip, form.clip, saved.clip),
      vae: pick(local.vae, form.vae, saved.vae),
      seed: pick(local.seed, form.seed, saved.seed),
      width: pick(local.width, form.width, saved.width),
      height: pick(local.height, form.height, saved.height),
      steps: pick(local.steps, form.steps, saved.steps),
      cfg: pick(local.cfg, form.cfg, saved.cfg),
      samplerName: pick(local.samplerName, form.samplerName, saved.samplerName),
      scheduler: pick(local.scheduler, form.scheduler, saved.scheduler),
      denoise: pick(local.denoise, form.denoise, saved.denoise),
      upscaler: pick(local.upscaler, form.upscaler ?? '', saved.upscaler),
      upscaleFactor: pick(
        local.upscaleFactor,
        form.upscaleFactor ?? 1.5,
        saved.upscaleFactor,
      ),
      hiresDenoise: pick(
        local.hiresDenoise,
        form.hiresDenoise ?? 0.5,
        saved.hiresDenoise,
      ),
      clipSkip: pick(local.clipSkip, form.clipSkip ?? 2, saved.clipSkip),
      additionalPositivePrompt: pick(
        local.additionalPositivePrompt,
        form.additionalPositivePrompt,
        saved.additionalPositivePrompt,
      ),
      negativePrompt: pick(
        local.negativePrompt,
        form.negativePrompt,
        saved.negativePrompt,
      ),
      promptText: pick(local.promptText, form.promptText, saved.promptText),
      promptSource: pick(
        local.promptSource,
        form.promptSource,
        saved.promptSource,
      ),
      promptSingle: pick(
        local.promptSingle,
        form.promptSingle === true,
        saved.promptSingle,
      ),
      benchmark: pick(local.benchmark, form.benchmark === true, saved.benchmark),
    };
    const keptEdit =
      next.checkpoint !== form.checkpoint ||
      next.clip !== form.clip ||
      next.vae !== form.vae ||
      next.seed !== form.seed ||
      next.width !== form.width ||
      next.height !== form.height ||
      next.steps !== form.steps ||
      next.cfg !== form.cfg ||
      next.samplerName !== form.samplerName ||
      next.scheduler !== form.scheduler ||
      next.denoise !== form.denoise ||
      next.upscaler !== (form.upscaler ?? '') ||
      next.upscaleFactor !== (form.upscaleFactor ?? 1.5) ||
      next.hiresDenoise !== (form.hiresDenoise ?? 0.5) ||
      next.clipSkip !== (form.clipSkip ?? 2) ||
      next.additionalPositivePrompt !== form.additionalPositivePrompt ||
      next.negativePrompt !== form.negativePrompt ||
      next.promptText !== form.promptText ||
      next.promptSource !== form.promptSource ||
      next.promptSingle !== (form.promptSingle === true) ||
      next.promptFoldersRecursive !== (form.promptFoldersRecursive === true) ||
      next.benchmark !== (form.benchmark === true) ||
      (next.relativeFolder ?? null) !== (form.relativeFolder ?? null);
    profilesRef.current = {
      realistic: { ...form.profiles.realistic },
      hentai: { ...form.profiles.hentai },
      '3d': { ...(form.profiles['3d'] ?? emptyStyleProfile()) },
    };
    formSnapshotRef.current = next;
    const same =
      next.activeProfile === profile &&
      next.checkpoint === checkpoint &&
      next.clip === clip &&
      next.vae === vae &&
      next.seed === seed &&
      next.width === width &&
      next.height === height &&
      next.steps === steps &&
      next.cfg === cfg &&
      next.samplerName === samplerName &&
      next.scheduler === scheduler &&
      next.denoise === denoise &&
      next.upscaler === upscaler &&
      next.upscaleFactor === upscaleFactor &&
      next.hiresDenoise === hiresDenoise &&
      next.clipSkip === clipSkip &&
      next.additionalPositivePrompt === additionalPositive &&
      next.negativePrompt === negative &&
      next.promptText === promptText &&
      next.promptSource === promptSource &&
      next.promptSingle === promptSingle &&
      next.promptFoldersRecursive === promptFoldersRecursive &&
      next.benchmark === benchmark &&
      (next.relativeFolder ?? null) === selectedFolder;
    if (!keptEdit) lastSavedRef.current = next;
    if (same) return;
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    skipNextPersist.current = !keptEdit;
    setProfile(next.activeProfile);
    setCheckpoint(next.checkpoint);
    setClip(next.clip);
    setVae(next.vae);
    setSeed(next.seed);
    setWidth(next.width);
    setHeight(next.height);
    setSteps(next.steps);
    setCfg(next.cfg);
    setSamplerName(next.samplerName);
    setScheduler(next.scheduler);
    setDenoise(next.denoise);
    setUpscaler(next.upscaler);
    setUpscaleFactor(next.upscaleFactor);
    setHiresDenoise(next.hiresDenoise);
    setClipSkip(next.clipSkip);
    setAdditionalPositive(next.additionalPositivePrompt);
    setNegative(next.negativePrompt);
    setPromptText(next.promptText);
    setPromptSource(next.promptSource);
    setPromptSingle(next.promptSingle);
    setPromptFoldersRecursive(next.promptFoldersRecursive);
    setBenchmark(next.benchmark);
    if ((next.relativeFolder ?? null) !== selectedFolder) {
      onSelectedFolderChange(next.relativeFolder);
    }
  };

  useEffect(() => {
    return window.wcm.comfy.onGenerationForm((form) => {
      formEpochRef.current += 1;
      applyRemoteFormRef.current(form);
    });
  }, []);

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
      steps,
      cfg,
      samplerName,
      scheduler,
      denoise,
      upscaler,
      upscaleFactor,
      hiresDenoise,
      clipSkip,
      additionalPositivePrompt: additionalPositive,
      negativePrompt: negative,
      promptText,
      promptSource,
      promptSingle,
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
    setSteps(incoming.steps);
    setCfg(incoming.cfg);
    setSamplerName(incoming.samplerName);
    setScheduler(incoming.scheduler);
    setDenoise(incoming.denoise);
    setUpscaler(incoming.upscaler ?? '');
    setUpscaleFactor(incoming.upscaleFactor ?? 1.5);
    setHiresDenoise(incoming.hiresDenoise ?? 0.5);
    setClipSkip(incoming.clipSkip ?? 2);
    setSeed(incoming.seed);
    setWidth(incoming.width);
    setHeight(incoming.height);
    setAdditionalPositive(incoming.additionalPositivePrompt);
    setNegative(incoming.negativePrompt);
    setPromptText(incoming.promptText);
    setPromptSource(incoming.promptSource);
    setPromptSingle(incoming.promptSingle === true);
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
      steps: incoming.steps,
      cfg: incoming.cfg,
      samplerName: incoming.samplerName,
      scheduler: incoming.scheduler,
      denoise: incoming.denoise,
      upscaler: incoming.upscaler ?? '',
      upscaleFactor: incoming.upscaleFactor ?? 1.5,
      hiresDenoise: incoming.hiresDenoise ?? 0.5,
      clipSkip: incoming.clipSkip ?? 2,
      additionalPositivePrompt: incoming.additionalPositivePrompt,
      negativePrompt: incoming.negativePrompt,
      promptText: incoming.promptText,
      promptSource: incoming.promptSource,
      promptSingle: incoming.promptSingle === true,
      benchmark,
      profiles,
    };
    formSnapshotRef.current = snapshot;
    lastSavedRef.current = snapshot;
    void persistGenerationForm(snapshot);
  };

  const start = useCallback(
    async (
      mode: 'once' | 'infinite',
      folderOverride?: string,
    ): Promise<string | null> => {
      const nextSource = folderOverride ? 'folder' : promptSource;
      const nextFolder = folderOverride ?? selectedFolder;
      const fail = (message: string) => {
        setError(message);
        return message;
      };
      if (nextSource === 'text' && !promptText.trim()) {
        return fail(
          'Enter a prompt, or switch to the selected prompt folder.',
        );
      }
      if (!benchmark && !checkpoint) return fail('Select a checkpoint');
      if (benchmark && !benchmarkStatus?.root) {
        return fail('Set Checkpoint Benchmark folder in Library Manager');
      }
      if (!hasWorkflow) {
        return fail(
          generationFamily === 'sdxl'
            ? 'Open WildcardManager-ComfyUI-SDXL-Generation-Workflow.json in ComfyUI, then Save Workflow.'
            : 'Save a workflow first (Edit Workflow → Save Workflow).',
        );
      }
      setError(null);
      setPromptSaveNote(null);
      try {
        if (persistTimer.current) {
          clearTimeout(persistTimer.current);
          persistTimer.current = null;
        }
        const snapshot = {
          activeProfile: profile,
          relativeFolder: nextFolder,
          promptFoldersRecursive,
          checkpoint,
          clip,
          vae,
          seed,
          width,
          height,
          steps,
          cfg,
          samplerName,
          scheduler,
          denoise,
          upscaler,
          upscaleFactor,
          hiresDenoise,
          clipSkip,
          additionalPositivePrompt: additionalPositive,
          negativePrompt: negative,
          promptText,
          promptSource: nextSource,
          promptSingle,
          benchmark,
        };
        formSnapshotRef.current = snapshot;
        lastSavedRef.current = snapshot;
        if (folderOverride) {
          profilesRef.current = {
            ...profilesRef.current,
            [profile]: {
              ...profilesRef.current[profile],
              relativeFolder: folderOverride,
              promptSource: 'folder',
            },
          };
        }
        await persistGenerationForm(snapshot);
        if (folderOverride) {
          setPromptSource('folder');
          if (selectedFolder !== folderOverride) {
            onSelectedFolderChange(folderOverride);
          }
        }
        await window.wcm.comfy.startGeneration({
          mode,
          styleProfile: profile,
          promptSource: nextSource,
          relativeFolder: nextFolder ?? undefined,
          promptFoldersRecursive:
            nextSource === 'folder' && nextFolder
              ? promptFoldersRecursive
              : undefined,
          promptText: nextSource === 'text' ? promptText : undefined,
          promptSingle: nextSource === 'text' ? promptSingle : undefined,
          checkpoint: benchmark ? checkpoint || '' : checkpoint,
          clip: clip || undefined,
          vae: vae || undefined,
          steps,
          cfg,
          samplerName: samplerName.trim() || undefined,
          scheduler: scheduler.trim() || undefined,
          denoise,
          upscaler: upscaler.trim() || undefined,
          upscaleFactor,
          hiresDenoise,
          clipSkip,
          seed,
          width,
          height,
          additionalPositivePrompt: additionalPositive || undefined,
          negativePrompt: negative || undefined,
          benchmark: benchmark || undefined,
        });
        return null;
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
    [
      promptSource,
      selectedFolder,
      promptText,
      promptSingle,
      benchmark,
      checkpoint,
      benchmarkStatus?.root,
      hasWorkflow,
      profile,
      promptFoldersRecursive,
      clip,
      vae,
      seed,
      width,
      height,
      steps,
      cfg,
      samplerName,
      scheduler,
      denoise,
      upscaler,
      upscaleFactor,
      hiresDenoise,
      clipSkip,
      generationFamily,
      additionalPositive,
      negative,
      onSelectedFolderChange,
    ],
  );

  useEffect(() => {
    if (!runRef) return;
    runRef.current = { start };
    return () => {
      runRef.current = null;
    };
  }, [runRef, start]);

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

  const running = useSyncExternalStore(
    subscribeGenerationRunning,
    isGenerationRunning,
  );

  const applySeedToForm = (value: number) => {
    const seedValue = value >>> 0;
    setSeed(seedValue);
    formSnapshotRef.current = { ...formSnapshotRef.current, seed: seedValue };
    lastSavedRef.current = { ...lastSavedRef.current, seed: seedValue };
    const activeId = formSnapshotRef.current.activeProfile;
    profilesRef.current = {
      ...profilesRef.current,
      [activeId]: {
        ...profilesRef.current[activeId],
        seed: seedValue,
      },
    };
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    void persistGenerationForm({ seed: seedValue });
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
      if (
        typeof settings.generationAdditionalPositiveHeight === 'number' &&
        Number.isFinite(settings.generationAdditionalPositiveHeight)
      ) {
        setAdditionalPositiveHeight(settings.generationAdditionalPositiveHeight);
      }
      if (
        typeof settings.generationNegativePromptHeight === 'number' &&
        Number.isFinite(settings.generationNegativePromptHeight)
      ) {
        setNegativePromptHeight(settings.generationNegativePromptHeight);
      }
      clearLegacyPreviewCollapsed();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (formSection !== 'generation') return;
    return watchPromptBoxHeight(additionalPositiveRef.current, (height) => {
      setAdditionalPositiveHeight(height);
      void window.wcm.ui.setGenerationPromptBoxHeights({
        additionalPositive: height,
      });
    });
  }, [formSection]);

  useEffect(() => {
    if (formSection !== 'generation') return;
    return watchPromptBoxHeight(negativePromptRef.current, (height) => {
      setNegativePromptHeight(height);
      void window.wcm.ui.setGenerationPromptBoxHeights({ negative: height });
    });
  }, [formSection]);

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
              title="Photo-style settings. Generation and Options on this tab stay separate from Anime and 3D."
              onClick={() => selectProfile('realistic')}
            >
              Realistic
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={profile === 'hentai'}
              className={profile === 'hentai' ? 'active' : undefined}
              title="Anime-style settings. Generation and Options on this tab stay separate from Realistic and 3D."
              onClick={() => selectProfile('hentai')}
            >
              Anime
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={profile === '3d'}
              className={profile === '3d' ? 'active' : undefined}
              title="3D-style settings. Generation and Options on this tab stay separate from Realistic and Anime."
              onClick={() => selectProfile('3d')}
            >
              3D
            </button>
          </div>

          <div
            className="segmented generation-section-tabs"
            role="tablist"
            aria-label="Generation sections"
          >
            <button
              type="button"
              role="tab"
              aria-selected={formSection === 'generation'}
              className={formSection === 'generation' ? 'active' : undefined}
              title="Prompt folder, model, seed, size, and prompts for this style."
              onClick={() => setFormSection('generation')}
            >
              Generation
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={formSection === 'options'}
              className={formSection === 'options' ? 'active' : undefined}
              title={
                generationFamily === 'sdxl'
                  ? 'VAE and KSampler settings for this style.'
                  : 'CLIP, VAE, and KSampler settings for this style.'
              }
              onClick={() => setFormSection('options')}
            >
              Options
            </button>
          </div>

          {formSection === 'generation' ? (
          <>
          <div className="generation-label-row">
            <label
              className="field-label"
              title="Which !gen.txt to draw a prompt from. Select… [Randomize] lets the seed pick a folder on each image."
            >
              Prompt folder
            </label>
            <label
              className={`generation-recursive${selectedFolder ? '' : ' is-disabled'}`}
              title={
                selectedFolder
                  ? 'Off: only this folder’s !gen.txt. On: each image picks this folder or a sub-folder from the seed. A fixed seed repeats that folder.'
                  : 'Each image picks a folder from the seed. A fixed seed repeats that folder.'
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
          </div>
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

          <div className="generation-label-row">
            <label
              className="field-label"
              title="The model that paints the image. Saved separately for Realistic, Anime, and 3D."
            >
              Checkpoint
            </label>
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
            {usableCheckpoints.map((file) => {
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

          <label
            className="field-label"
            title="Drives the folder, the prompt line, and wildcard picks. 1 or higher repeats that image. 0 or below rolls a new seed every run."
          >
            Seed (≤0 = random)
          </label>
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
              className="generation-action-btn"
              title="Random seed (−1) — a new seed on every run"
              aria-label="Random seed"
              onClick={() => setSeed(-1)}
            >
              <Dices size={14} />
            </button>
            <button
              type="button"
              className="generation-action-btn"
              title="Randomize seed — write one random number and keep it"
              aria-label="Randomize seed"
              onClick={() => setSeed(randomFixedGenerationSeed())}
            >
              <Shuffle size={14} />
            </button>
          </div>

          <div className="generation-size-row">
            <label
              className="generation-size-field"
              title="Image width in pixels."
            >
              <span className="field-label">Width</span>
              <input
                className="text-input"
                type="number"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value) || 1024)}
              />
            </label>
            <label
              className="generation-size-field"
              title="Image height in pixels."
            >
              <span className="field-label">Height</span>
              <input
                className="text-input"
                type="number"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value) || 1024)}
              />
            </label>
            <div className="generation-size-actions">
              <span className="generation-action-tip" title="Swap width and height">
                <button
                  type="button"
                  className="generation-action-btn"
                  aria-label="Swap width and height"
                  onClick={() => {
                    const next = swapGenerationSize(width, height);
                    setWidth(next.width);
                    setHeight(next.height);
                  }}
                >
                  <ArrowLeftRight size={14} />
                </button>
              </span>
              <span
                className="generation-action-tip"
                title={
                  smallerSize
                    ? `Decrease resolution to ${smallerSize.width}×${smallerSize.height}`
                    : 'No smaller common resolution'
                }
              >
                <button
                  type="button"
                  className="generation-action-btn"
                  aria-label="Decrease resolution"
                  disabled={!smallerSize}
                  onClick={() => {
                    if (!smallerSize) return;
                    setWidth(smallerSize.width);
                    setHeight(smallerSize.height);
                  }}
                >
                  <ArrowDown size={14} />
                </button>
              </span>
              <span
                className="generation-action-tip"
                title={
                  largerSize
                    ? `Increase resolution to ${largerSize.width}×${largerSize.height}`
                    : 'No larger common resolution'
                }
              >
                <button
                  type="button"
                  className="generation-action-btn"
                  aria-label="Increase resolution"
                  disabled={!largerSize}
                  onClick={() => {
                    if (!largerSize) return;
                    setWidth(largerSize.width);
                    setHeight(largerSize.height);
                  }}
                >
                  <ArrowUp size={14} />
                </button>
              </span>
            </div>
          </div>

          {generationFamily === 'sdxl' ? (
            <>
              <label
                className="field-label"
                title="Model in ComfyUI models/upscale_models, such as Foolhardy Remacri. Sent to LT · Upscaler."
              >
                Upscaler
              </label>
              <select
                className="text-input"
                value={upscalerOptions.includes(upscaler) ? upscaler : ''}
                onChange={(e) => setUpscaler(e.target.value)}
              >
                <option value="">—</option>
                {upscalerOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>

              <label
                className="field-label"
                title="Final size versus the base image. 1.5 on 1024×1024 is 1536×1536."
              >
                Upscale factor
              </label>
              <input
                className="text-input"
                type="number"
                min={1}
                max={4}
                step={0.1}
                value={upscaleFactor}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setUpscaleFactor(
                    Number.isFinite(n) ? Math.min(4, Math.max(1, n)) : 1.5,
                  );
                }}
              />

              <label
                className="field-label"
                title="Denoise for the hires pass only. The Denoise field on Options still feeds the first sampler."
              >
                Hires denoise
              </label>
              <input
                className="text-input"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={hiresDenoise}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setHiresDenoise(
                    Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5,
                  );
                }}
              />
            </>
          ) : null}

          <label
            className="field-label"
            title="Added after the chosen prompt, whether Single prompt is ticked or not. __wildcards__ expand with the same seed. Leave empty to use only that prompt."
          >
            Additional Positive Prompt
          </label>
          <div
            ref={additionalPositiveRef}
            className="generation-side-prompt"
            style={
              additionalPositiveHeight
                ? { height: additionalPositiveHeight }
                : undefined
            }
          >
            <WildcardEditor
              className="wildcard-editor generation-side-prompt-editor"
              value={additionalPositive}
              fileExt=".txt"
              wildcardKeys={wildcardKeys}
              validatePrompt
              placeholderText={
                profile === 'hentai'
                  ? 'e.g. __style-hentai__'
                  : profile === '3d'
                    ? 'e.g. __style-3d__'
                    : 'e.g. realistic photograph, natural colors'
              }
              onOpenWildcard={onOpenWildcard}
              onCreateWildcard={onCreateWildcard}
              onRenameLora={onRenameLora}
              onOpenLora={onOpenLora}
              onOpenLoraInCivitaiCatalog={onOpenLoraInCivitaiCatalog}
              onChange={setAdditionalPositive}
            />
          </div>

          <label
            className="field-label"
            title="Things to avoid, such as blur or watermarks. Leave empty to keep the negative prompt already in the workflow."
          >
            Negative Prompt
          </label>
          <div
            ref={negativePromptRef}
            className="generation-side-prompt is-negative"
            style={
              negativePromptHeight ? { height: negativePromptHeight } : undefined
            }
          >
            <WildcardEditor
              className="wildcard-editor generation-side-prompt-editor"
              value={negative}
              fileExt=".txt"
              wildcardKeys={wildcardKeys}
              validatePrompt
              onOpenWildcard={onOpenWildcard}
              onCreateWildcard={onCreateWildcard}
              onRenameLora={onRenameLora}
              onOpenLora={onOpenLora}
              onOpenLoraInCivitaiCatalog={onOpenLoraInCivitaiCatalog}
              onChange={setNegative}
            />
          </div>
          </>
          ) : (
          <>
          <p className="hint generation-options-hint">
            Each style keeps its own values. Wire the matching LT nodes into
            the workflow, then Save Workflow. A blank Sampler or Scheduler
            keeps the name already on that node.
          </p>
          {generationFamily === 'sdxl' ? null : (
            <>
          <label
            className="field-label"
            title="Optional text encoder. Leave blank to keep the CLIP already in the workflow."
          >
            CLIP (optional)
          </label>
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
            </>
          )}

          <label
            className="field-label"
            title={
              generationFamily === 'sdxl'
                ? 'Leave blank to use the VAE packed in the checkpoint. Pick a file, such as an SDXL VAE, to replace it on both the base image and the hires pass.'
                : 'Optional decoder that turns the result into an image. Leave blank to keep the VAE already in the workflow.'
            }
          >
            VAE (optional)
          </label>
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

          {generationFamily === 'sdxl' ? (
            <>
              <label
                className="field-label"
                title="A1111 CLIP skip. Pony and Illustrious want 2. 1 keeps the last CLIP layer, which base SDXL usually wants."
              >
                CLIP skip
              </label>
              <input
                className="text-input"
                type="number"
                min={1}
                max={12}
                step={1}
                value={clipSkip}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setClipSkip(
                    Number.isFinite(n)
                      ? Math.min(12, Math.max(1, Math.round(n)))
                      : 2,
                  );
                }}
              />
            </>
          ) : null}

          <label
            className="field-label"
            title="How many sampling steps to run. Sent to LT · Steps when that node is in the workflow."
          >
            Steps
          </label>
          <input
            className="text-input"
            type="number"
            min={1}
            step={1}
            value={steps}
            onChange={(e) => {
              const n = Number(e.target.value);
              setSteps(Number.isFinite(n) && n >= 1 ? Math.round(n) : 20);
            }}
          />

          <label
            className="field-label"
            title="How closely the image follows the prompt. Sent to LT · CFG when that node is in the workflow."
          >
            CFG
          </label>
          <input
            className="text-input"
            type="number"
            min={0}
            step={0.1}
            value={cfg}
            onChange={(e) => {
              const n = Number(e.target.value);
              setCfg(Number.isFinite(n) && n >= 0 ? n : 7);
            }}
          />

          <label
            className="field-label"
            title="Sampling algorithm. Leave blank to keep the name already on LT · Sampler."
          >
            Sampler
          </label>
          <select
            className="text-input"
            value={samplerName}
            onChange={(e) => setSamplerName(e.target.value)}
          >
            <option value="">—</option>
            {samplerOptions.map((name) => (
              <option key={name} value={name}>
                {samplerLabel(name)}
              </option>
            ))}
          </select>

          <label
            className="field-label"
            title="Noise schedule. Leave blank to keep the name already on LT · Scheduler."
          >
            Scheduler
          </label>
          <select
            className="text-input"
            value={scheduler}
            onChange={(e) => setScheduler(e.target.value)}
          >
            <option value="">—</option>
            {withSavedChoice(catalog?.schedulers ?? [], scheduler).map(
              (name) => (
                <option key={name} value={name}>
                  {schedulerLabel(name)}
                </option>
              ),
            )}
          </select>

          <label
            className="field-label"
            title="How much of the starting noise to replace. 1 redraws the whole image. Sent to LT · Denoise."
          >
            Denoise
          </label>
          <input
            className="text-input"
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={denoise}
            onChange={(e) => {
              const n = Number(e.target.value);
              setDenoise(
                Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1,
              );
            }}
          />
          </>
          )}

          <div className="generation-actions">
            <div className="generation-actions-start">
              <span
                className="generation-action-tip"
                title="Generate one image with these settings. A fixed seed repeats that image."
              >
                <button
                  type="button"
                  className="primary"
                  disabled={running || busy}
                  onClick={() => void start('once')}
                >
                  <Zap size={14} /> Once
                </button>
              </span>
              <span
                className="generation-action-tip"
                title="Keep generating images until Cancel. A fixed seed repeats the same image. 0 or below rolls a new seed each image."
              >
                <button
                  type="button"
                  disabled={running || busy}
                  onClick={() => void start('infinite')}
                >
                  Infinite
                </button>
              </span>
            </div>
            <span
              className="generation-action-tip"
              title="Stop this run and interrupt the image in progress."
            >
              <button
                type="button"
                className="danger"
                disabled={!running}
                onClick={() => void window.wcm.comfy.cancelGeneration()}
              >
                <Square size={14} /> Cancel
              </button>
            </span>
          </div>
          <GenerationJobStatus onApplySeed={applySeedToForm} />
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
              <div className="row-actions">
                {contract && !contract.ok ? (
                  <span
                    className="hint generation-workflow-status error-text"
                    title={`Missing: ${contract.requiredMissing.join(', ')}`}
                  >
                    Missing: {contract.requiredMissing.join(', ')}
                  </span>
                ) : !contract && !hasWorkflow ? (
                  <span className="hint generation-workflow-status warn-text">
                    {generationFamily === 'sdxl'
                      ? 'Open WildcardManager-ComfyUI-SDXL-Generation-Workflow.json in ComfyUI, then Save Workflow.'
                      : 'No workflow saved yet'}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="generation-action-btn"
                  title="Open ComfyUI to edit the generation workflow"
                  onClick={() => setMiddleMode('workflow')}
                >
                  <Workflow size={14} /> Edit Workflow
                </button>
              </div>
            </div>
            <div className="generation-prompt-pane">
              <div className="generation-prompt-source-row">
                <div
                  className="generation-prompt-source"
                  role="group"
                  aria-label="Prompt source"
                >
                  <div className="generation-prompt-source-choices">
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
                  <label
                    className="generation-prompt-source-option"
                    title="Ticked: the whole box is sent as one prompt. Unticked: the box is read as multiple prompts, the same way as a !gen.txt file."
                  >
                    <input
                      type="checkbox"
                      checked={promptSingle}
                      onChange={(event) => {
                        setPromptSingle(event.target.checked);
                        setPromptSaveNote(null);
                      }}
                    />
                    <span>Single prompt</span>
                  </label>
                </div>
                <div className="generation-prompt-actions">
                  <button
                    type="button"
                    className="generation-action-btn"
                    title="Replace prompt text when the checkpoint file name contains a keyword"
                    onClick={() => setSubstitutionsOpen(true)}
                  >
                    <Replace size={14} />{' '}
                    {substitutionCount > 0
                      ? `Substitutions (${substitutionCount})…`
                      : 'Substitutions…'}
                  </button>
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
                issues={promptIssues}
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
                  {promptIssues.map((issue, index) => {
                    const search = missingFileSearchQuery(issue);
                    return (
                    <li
                      key={`${issue.code}-${issue.line ?? ''}-${index}`}
                      className={search ? 'is-searchable' : undefined}
                      title={search ? `Search for ${search}` : undefined}
                      onClick={() => {
                        if (issue.line) {
                          promptEditorRef.current?.jumpToLine(
                            issue.line,
                            issue.column,
                          );
                        }
                        if (search) promptEditorRef.current?.findText(search);
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
                    );
                  })}
                </ul>
              ) : null}
              {promptSource === 'folder' ? (
                <GenerationFolderLiveHint
                  selectedFolder={selectedFolder}
                  onApplySeed={applySeedToForm}
                />
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
            <GenerationPreviewActions onError={setError} />
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
        {previewCollapsed ? null : (
          <GenerationPreviewBody
            seedMode="apply"
            onApplySeed={applySeedToForm}
            empty={<p className="hint pad">Generate to preview here.</p>}
          />
        )}
      </aside>
      {substitutionsOpen ? (
        <PromptSubstitutionsModal
          checkpoint={checkpoint}
          promptSource={promptSource}
          promptText={promptText}
          onClose={() => setSubstitutionsOpen(false)}
          onSaved={(count) => setSubstitutionCount(count)}
        />
      ) : null}
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
