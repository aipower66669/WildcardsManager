import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
} from 'react';
import {
  ClipboardCopy,
  FilePlus2,
  FolderOpen,
  Infinity,
  ListChecks,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  PieChart,
  RefreshCw,
  Square,
  Trash2,
  Zap,
} from 'lucide-react';
import { remapPromptFolderPath } from '../domain/promptFolderNames';
import type { ParsedCivitaiModelPageUrl } from '../domain/civitaiSnippet.js';
import type { GenPromptValidationFileDto, PromptTreeDto } from '../shared/contracts';
import { missingFileSearchQuery } from '../domain/missingFileSearch';
import { WildcardEditor, type WildcardEditorHandle } from './WildcardEditor';
import { PanelSplitter, type PanelSplitterHandlers } from './PanelSplitter';
import {
  openPromptFolderContextMenu,
  openPromptRootContextMenu,
  PromptFolderContextMenu,
  PromptFolderTree,
  PromptRootContextMenu,
  type PromptFolderContextMenuState,
  type PromptRootContextMenuState,
} from './PromptFolderTree';
import {
  isGenerationRunning,
  noteGenerationStatus,
  startPromptFolderGeneration,
  subscribeGenerationRunning,
  type GenerationRunHandle,
  type GenerationRunMode,
} from './generationRun';

type SidePanelMode = 'samples' | 'lastOutput';

type HeldPreview = {
  url: string;
  prompt?: string;
  negative?: string;
  relativeFolder?: string | null;
  seed?: number | null;
};

const SIDE_PANEL_MODE_KEY = 'wcm.prompts.sidePanelMode';

function readSidePanelMode(): SidePanelMode {
  try {
    return window.localStorage.getItem(SIDE_PANEL_MODE_KEY) === 'lastOutput'
      ? 'lastOutput'
      : 'samples';
  } catch {
    return 'samples';
  }
}

function writeSidePanelMode(mode: SidePanelMode): void {
  try {
    window.localStorage.setItem(SIDE_PANEL_MODE_KEY, mode);
  } catch {
    // ignore
  }
}

/** Prompt folder breadcrumb (`portraits/boys` → `portraits › boys`). */
function promptCategoryBreadcrumb(
  relativeFolder: string | null | undefined,
): string {
  const cleaned = (relativeFolder ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '');
  if (!cleaned || cleaned === '_manual') return '';
  return cleaned.split('/').filter(Boolean).join(' › ');
}

type Props = {
  filesWidth: number;
  detailsWidth: number;
  filesSplitter: PanelSplitterHandlers;
  detailsSplitter: PanelSplitterHandlers;
  /** When false, stay mounted but hidden so selection/editor survive tab switches. */
  active?: boolean;
  wildcardKeys: string[];
  selectedFolder: string | null;
  onSelectedFolderChange: (relativePath: string | null) => void;
  /** Point Generation at this folder. Does not start a run. */
  onUseFolderForGeneration?: (relativeFolder: string) => void;
  /** Once / Infinite from the Generation tab, when that tab has been opened. */
  generationRunRef?: MutableRefObject<GenerationRunHandle | null>;
  onOpenCoverage?: () => void;
  coverageRunning?: boolean;
  coveragePercent?: number;
  onOpenWildcard?: (name: string) => void;
  onCreateWildcard?: (name: string) => void;
  onRenameLora?: (name: string) => void;
  onOpenLora?: (name: string) => void;
  onOpenLoraInCivitaiCatalog?: (model: ParsedCivitaiModelPageUrl) => void;
  /** Live editor text so Expand uses unsaved !gen.txt lines. */
  genTextRef?: MutableRefObject<{
    relativeFolder: string | null;
    content: string;
  } | null>;
};

const SAMPLES_COLLAPSED_KEY = 'wcm.prompts.samplesCollapsed';

function readLegacySamplesCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SAMPLES_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function clearLegacySamplesCollapsed(): void {
  try {
    window.localStorage.removeItem(SAMPLES_COLLAPSED_KEY);
  } catch {
    // ignore
  }
}

export function PromptsWorkspace({
  filesWidth,
  detailsWidth,
  filesSplitter,
  detailsSplitter,
  active = true,
  wildcardKeys,
  selectedFolder,
  onSelectedFolderChange,
  onUseFolderForGeneration,
  generationRunRef,
  onOpenCoverage,
  coverageRunning = false,
  coveragePercent = 0,
  onOpenWildcard,
  onCreateWildcard,
  onRenameLora,
  onOpenLora,
  onOpenLoraInCivitaiCatalog,
  genTextRef,
}: Props) {
  const [tree, setTree] = useState<PromptTreeDto>({ root: null, folders: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generationNote, setGenerationNote] = useState<string | null>(null);
  const [generationRunning, setGenerationRunning] = useState(isGenerationRunning);
  const [generationStarting, setGenerationStarting] = useState(false);
  const [genExists, setGenExists] = useState(false);
  const [editorText, setEditorText] = useState('');
  const genEditorRef = useRef<WildcardEditorHandle | null>(null);
  if (genTextRef) {
    genTextRef.current = {
      relativeFolder: selectedFolder,
      content: editorText,
    };
  }
  const [dirty, setDirty] = useState(false);
  const [samples, setSamples] = useState<
    Array<{ fileName: string; url: string }>
  >([]);
  const [samplesCollapsed, setSamplesCollapsed] = useState(
    readLegacySamplesCollapsed,
  );
  const [sidePanelMode, setSidePanelMode] = useState<SidePanelMode>(
    readSidePanelMode,
  );
  const [heldPreview, setHeldPreview] = useState<HeldPreview | null>(null);
  const [deletingLast, setDeletingLast] = useState(false);
  const [issuesByFolder, setIssuesByFolder] = useState<
    Map<string, GenPromptValidationFileDto>
  >(new Map());
  const [validating, setValidating] = useState(false);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [validated, setValidated] = useState(false);
  const [folderMenu, setFolderMenu] =
    useState<PromptFolderContextMenuState | null>(null);
  const [rootMenu, setRootMenu] =
    useState<PromptRootContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [expandToPath, setExpandToPath] = useState<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const samplesCollapsedRef = useRef(samplesCollapsed);
  samplesCollapsedRef.current = samplesCollapsed;
  const sidePanelModeRef = useRef(sidePanelMode);
  sidePanelModeRef.current = sidePanelMode;

  const applyReport = (
    files: GenPromptValidationFileDto[],
  ) => {
    const next = new Map<string, GenPromptValidationFileDto>();
    for (const file of files) {
      if (file.errorCount > 0 || file.warningCount > 0) {
        next.set(file.relativeFolder, file);
      }
    }
    setIssuesByFolder(next);
    setValidated(true);
  };

  const validateAll = useCallback(async () => {
    setValidating(true);
    setError(null);
    try {
      const report = await window.wcm.prompts.validateAll();
      applyReport(report.files);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setValidating(false);
    }
  }, []);

  const refreshFolderValidation = useCallback(async (relativePath: string) => {
    try {
      const row = await window.wcm.prompts.validateFolder(relativePath);
      setIssuesByFolder((prev) => {
        const next = new Map(prev);
        if (!row || (row.errorCount === 0 && row.warningCount === 0)) {
          next.delete(relativePath);
        } else {
          next.set(relativePath, row);
        }
        return next;
      });
      setValidated(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshTree = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setTree(await window.wcm.prompts.listTree());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadSamples = useCallback(async (relativePath: string) => {
    try {
      const imgs = await window.wcm.prompts.listSamples(relativePath, 12);
      setSamples(imgs.map((i) => ({ fileName: i.fileName, url: i.url })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadFolder = useCallback(async (relativePath: string) => {
    setBusy(true);
    setError(null);
    try {
      const gen = await window.wcm.prompts.readGen(relativePath);
      setGenExists(gen.exists);
      setEditorText(gen.content);
      setDirty(false);
      if (
        samplesCollapsedRef.current ||
        sidePanelModeRef.current !== 'samples'
      ) {
        setSamples([]);
      } else {
        const imgs = await window.wcm.prompts.listSamples(relativePath, 12);
        setSamples(imgs.map((i) => ({ fileName: i.fileName, url: i.url })));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshTree();
    void validateAll();
  }, [refreshTree, validateAll]);

  useEffect(() => {
    if (!selectedFolder) {
      setEditorText('');
      setGenExists(false);
      setSamples([]);
      setDirty(false);
      return;
    }
    void loadFolder(selectedFolder);
  }, [loadFolder, selectedFolder]);

  useEffect(() => {
    let cancelled = false;
    void window.wcm.ui.getSettings().then((settings) => {
      if (cancelled) return;
      if (settings.promptsSamplesCollapsed != null) {
        setSamplesCollapsed(settings.promptsSamplesCollapsed);
      } else {
        const legacy = readLegacySamplesCollapsed();
        setSamplesCollapsed(legacy);
        void window.wcm.ui.setPromptsSamplesCollapsed(legacy);
      }
      clearLegacySamplesCollapsed();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSamplesCollapsedPersist = (collapsed: boolean) => {
    setSamplesCollapsed(collapsed);
    clearLegacySamplesCollapsed();
    void window.wcm.ui.setPromptsSamplesCollapsed(collapsed);
    if (collapsed) {
      setSamples([]);
      return;
    }
    if (sidePanelModeRef.current === 'samples' && selectedFolder) {
      void loadSamples(selectedFolder);
    }
  };

  const setSidePanelModePersist = (mode: SidePanelMode) => {
    setSidePanelMode(mode);
    writeSidePanelMode(mode);
    if (mode === 'samples' && !samplesCollapsed && selectedFolder) {
      void loadSamples(selectedFolder);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void window.wcm.comfy
      .getGenerationForm()
      .then((form) => {
        if (cancelled || !form.lastImageUrl) return;
        setHeldPreview({
          url: form.lastImageUrl,
          prompt: form.lastPrompt,
          negative: form.lastNegativePrompt,
          relativeFolder: form.lastRelativeFolder ?? null,
          seed: form.lastSeed ?? null,
        });
      })
      .catch(() => {
        // ignore — Generation may never have run
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => subscribeGenerationRunning(setGenerationRunning), []);

  useEffect(() => {
    return window.wcm.comfy.onGenerationProgress((p) => {
      noteGenerationStatus(p.status);
      setGenerationNote(p.error?.trim() ? p.error : null);
      if (!p.lastImageUrl) return;
      setHeldPreview({
        url: p.lastImageUrl,
        prompt: p.lastPrompt,
        negative: p.lastNegativePrompt,
        relativeFolder: p.lastRelativeFolder,
        seed: p.lastSeed,
      });
    });
  }, []);

  const startFromPrompts = async (mode: GenerationRunMode) => {
    if (!selectedFolder || generationRunning || generationStarting) return;
    setGenerationStarting(true);
    setGenerationNote(null);
    try {
      if (saveTimer.current !== undefined) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = undefined;
      }
      if (dirty) {
        await window.wcm.prompts.writeGen(selectedFolder, editorText);
        setGenExists(true);
        setDirty(false);
      }
      const handle = generationRunRef?.current;
      const message = handle
        ? await handle.start(mode, selectedFolder)
        : await startPromptFolderGeneration(mode, selectedFolder);
      if (!handle) onUseFolderForGeneration?.(selectedFolder);
      if (message) setGenerationNote(message);
    } catch (e) {
      setGenerationNote(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerationStarting(false);
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

  const scheduleSave = (text: string) => {
    if (!selectedFolder) return;
    if (saveTimer.current !== undefined) {
      window.clearTimeout(saveTimer.current);
    }
    saveTimer.current = window.setTimeout(() => {
      void window.wcm.prompts
        .writeGen(selectedFolder, text)
        .then(() => {
          setGenExists(true);
          setDirty(false);
          void refreshFolderValidation(selectedFolder);
        })
        .catch((e) =>
          setError(e instanceof Error ? e.message : String(e)),
        );
    }, 400);
  };

  const createGen = async () => {
    if (!selectedFolder) return;
    setBusy(true);
    try {
      const gen = await window.wcm.prompts.createGen(selectedFolder);
      setGenExists(gen.exists);
      setEditorText(gen.content);
      setDirty(false);
      await refreshTree();
      if (selectedFolder) await refreshFolderValidation(selectedFolder);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reshuffle = async () => {
    if (
      !selectedFolder ||
      samplesCollapsed ||
      sidePanelMode !== 'samples'
    ) {
      return;
    }
    await loadSamples(selectedFolder);
  };

  const remapIssues = (fromRelative: string, toRelative: string) => {
    setIssuesByFolder((prev) => {
      const next = new Map<string, GenPromptValidationFileDto>();
      for (const [key, value] of prev) {
        const remapped = remapPromptFolderPath(key, fromRelative, toRelative);
        if (!remapped) continue;
        next.set(
          remapped,
          remapped === key
            ? value
            : { ...value, relativeFolder: remapped },
        );
      }
      return next;
    });
  };

  const dropIssuesUnder = (relativeFolder: string) => {
    setIssuesByFolder((prev) => {
      const next = new Map(prev);
      const prefix = `${relativeFolder}/`;
      for (const key of prev.keys()) {
        if (key === relativeFolder || key.startsWith(prefix)) {
          next.delete(key);
        }
      }
      return next;
    });
  };

  const createFolderUnder = async (parentRelativeFolder: string) => {
    setBusy(true);
    setError(null);
    try {
      const created = await window.wcm.prompts.createFolder(
        parentRelativeFolder,
      );
      setExpandToPath(created.relativeFolder);
      onSelectedFolderChange(created.relativeFolder);
      await refreshTree();
      setRenamingPath(created.relativeFolder);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const commitRename = async (
    relativePath: string,
    newName: string,
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.wcm.prompts.renameFolder(
        relativePath,
        newName,
      );
      setRenamingPath(null);
      remapIssues(relativePath, result.relativeFolder);
      onSelectedFolderChange(
        remapPromptFolderPath(
          selectedFolder,
          relativePath,
          result.relativeFolder,
        ),
      );
      if (expandToPath) {
        setExpandToPath(
          remapPromptFolderPath(
            expandToPath,
            relativePath,
            result.relativeFolder,
          ),
        );
      }
      await refreshTree();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const deleteFolder = async (relativePath: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.wcm.prompts.deleteFolder(relativePath);
      if (!result.deleted) return;
      dropIssuesUnder(relativePath);
      const prefix = `${relativePath}/`;
      if (
        selectedFolder === relativePath ||
        selectedFolder?.startsWith(prefix)
      ) {
        onSelectedFolderChange(null);
      }
      if (
        renamingPath === relativePath ||
        renamingPath?.startsWith(prefix)
      ) {
        setRenamingPath(null);
      }
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      className={`workspace workspace-prompts${
        samplesCollapsed ? ' samples-collapsed' : ''
      }${active ? '' : ' workspace-tab-hidden'}`}
      aria-hidden={!active}
      style={
        {
          '--files-panel-width': `${filesWidth}px`,
          '--details-panel-width': `${detailsWidth}px`,
        } as CSSProperties
      }
    >
      <aside className="files-panel prompts-tree-panel">
        <div className="panel-toolbar">
          <strong>Prompts</strong>
          <div className="row-actions">
            {validated && issuesByFolder.size > 0 ? (
              <label className="filter-row prompt-issues-filter">
                <input
                  type="checkbox"
                  checked={issuesOnly}
                  onChange={(e) => setIssuesOnly(e.target.checked)}
                />
                {issuesByFolder.size} with issues
              </label>
            ) : null}
            <button
              type="button"
              className="icon-btn"
              title="Validate — check every !gen.txt for missing or invalid wildcards"
              aria-label="Validate"
              disabled={validating}
              onClick={() => void validateAll()}
            >
              {validating ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <ListChecks size={14} />
              )}
            </button>
            <button
              type="button"
              className={`icon-btn${coverageRunning ? ' is-busy' : ''}`}
              title={
                coverageRunning
                  ? `Coverage running — ${Math.round(coveragePercent)}% (click for details)`
                  : 'Coverage — opens Generation and measures wildcard usage from every !gen.txt'
              }
              aria-label="Coverage"
              onClick={() => onOpenCoverage?.()}
            >
              {coverageRunning ? (
                <span className="prompt-coverage-toolbar-pct">
                  {Math.round(coveragePercent)}%
                </span>
              ) : (
                <PieChart size={14} />
              )}
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Refresh"
              aria-label="Refresh"
              disabled={busy}
              onClick={() => void refreshTree()}
            >
              <RefreshCw size={14} className={busy ? 'spin' : undefined} />
            </button>
          </div>
        </div>
        <PromptFolderTree
          tree={tree}
          selected={selectedFolder}
          onSelect={onSelectedFolderChange}
          issues={issuesByFolder}
          issuesOnly={issuesOnly}
          folderActions={{
            renamingPath,
            expandToPath,
            onContextMenu: (relativePath, name, event) => {
              setRootMenu(null);
              setFolderMenu(
                openPromptFolderContextMenu(relativePath, name, event),
              );
            },
            onCommitRename: (relativePath, newName) =>
              commitRename(relativePath, newName),
            onCancelRename: () => setRenamingPath(null),
          }}
          onRootContextMenu={(event: ReactMouseEvent) => {
            setFolderMenu(null);
            setRootMenu(openPromptRootContextMenu(event));
          }}
          onAddRootFolder={() => {
            void createFolderUnder('');
          }}
        />
        {error ? <p className="error-text pad">{error}</p> : null}
        {folderMenu ? (
          <PromptFolderContextMenu
            menu={folderMenu}
            onClose={() => setFolderMenu(null)}
            onUseForGeneration={() => {
              onUseFolderForGeneration?.(folderMenu.relativePath);
            }}
            onRename={() => {
              onSelectedFolderChange(folderMenu.relativePath);
              setRenamingPath(folderMenu.relativePath);
            }}
            onAddSubfolder={() => {
              void createFolderUnder(folderMenu.relativePath);
            }}
            onDelete={() => {
              void deleteFolder(folderMenu.relativePath);
            }}
          />
        ) : null}
        {rootMenu ? (
          <PromptRootContextMenu
            menu={rootMenu}
            onClose={() => setRootMenu(null)}
            onAddFolder={() => {
              void createFolderUnder('');
            }}
          />
        ) : null}
      </aside>

      <PanelSplitter kind="files" {...filesSplitter} />

      <section className="details-panel prompts-editor-panel">
        <div className="panel-toolbar">
          <div className="prompts-editor-title">
            <strong>
              {selectedFolder ? `${selectedFolder}/!gen.txt` : '!gen.txt'}
            </strong>
            {selectedFolder && !genExists ? (
              <button
                type="button"
                className="manage-btn"
                disabled={busy}
                onClick={() => void createGen()}
              >
                <FilePlus2 size={14} /> Create !gen.txt
              </button>
            ) : null}
            {dirty ? <span className="hint">Saving…</span> : null}
          </div>
          <div className="prompts-gen-actions" role="group" aria-label="Generate">
            <span
              className="generation-action-tip"
              title={
                selectedFolder
                  ? 'Generate one image from this folder’s !gen.txt. Uses the current Generation style, checkpoint, seed, and Recursive setting. A fixed seed repeats that image.'
                  : 'Select a prompt folder first.'
              }
            >
              <button
                type="button"
                className="primary"
                aria-label="Once"
                disabled={
                  !selectedFolder || generationRunning || generationStarting
                }
                onClick={() => void startFromPrompts('once')}
              >
                <Zap size={14} />
              </button>
            </span>
            <span
              className="generation-action-tip"
              title={
                selectedFolder
                  ? 'Keep generating images from this folder’s !gen.txt until Cancel. Uses the current Generation style, checkpoint, seed, and Recursive setting. A fixed seed repeats the same image. 0 or below rolls a new seed each image.'
                  : 'Select a prompt folder first.'
              }
            >
              <button
                type="button"
                aria-label="Infinite"
                disabled={
                  !selectedFolder || generationRunning || generationStarting
                }
                onClick={() => void startFromPrompts('infinite')}
              >
                <Infinity size={14} />
              </button>
            </span>
            <span
              className="generation-action-tip"
              title="Stop this run and interrupt the image in progress."
            >
              <button
                type="button"
                className="danger"
                aria-label="Cancel"
                disabled={!generationRunning}
                onClick={() => {
                  void window.wcm.comfy.cancelGeneration().catch((e) => {
                    setGenerationNote(
                      e instanceof Error ? e.message : String(e),
                    );
                  });
                }}
              >
                <Square size={14} />
              </button>
            </span>
          </div>
        </div>
        {generationNote ? (
          <p className="error-text prompts-gen-error">{generationNote}</p>
        ) : null}
        {selectedFolder ? (
          genExists || editorText.length > 0 ? (
            <WildcardEditor
              ref={genEditorRef}
              className="prompts-gen-editor"
              value={editorText}
              fileExt=".txt"
              wildcardKeys={wildcardKeys}
              issues={
                selectedFolder
                  ? issuesByFolder.get(selectedFolder)?.issues
                  : undefined
              }
              onOpenWildcard={onOpenWildcard}
              onCreateWildcard={onCreateWildcard}
              onRenameLora={onRenameLora}
              onOpenLora={onOpenLora}
              onOpenLoraInCivitaiCatalog={onOpenLoraInCivitaiCatalog}
              onChange={(value) => {
                setEditorText(value);
                setDirty(true);
                scheduleSave(value);
              }}
              onBlur={() => {
                if (!selectedFolder || !dirty) return;
                void window.wcm.prompts
                  .writeGen(selectedFolder, editorText)
                  .then(() => {
                    setGenExists(true);
                    setDirty(false);
                    void refreshFolderValidation(selectedFolder);
                  })
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : String(e)),
                  );
              }}
            />
          ) : (
            <p className="hint pad">
              This folder has no <code>!gen.txt</code> yet.
            </p>
          )
        ) : (
          <p className="hint pad">Select a prompt folder.</p>
        )}
        {selectedFolder && issuesByFolder.get(selectedFolder)?.issues.length ? (
          <ul className="prompts-gen-issues">
            {issuesByFolder.get(selectedFolder)!.issues.map((issue, index) => {
              const search = missingFileSearchQuery(issue);
              return (
              <li
                key={`${issue.code}-${issue.line ?? ''}-${index}`}
                className={search ? 'is-searchable' : undefined}
                title={search ? `Search for ${search}` : undefined}
                onClick={() => {
                  if (issue.line) {
                    genEditorRef.current?.jumpToLine(issue.line, issue.column);
                  }
                  if (search) genEditorRef.current?.findText(search);
                }}
              >
                <p className={issue.severity === 'warning' ? 'warn-text' : 'error-text'}>
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
      </section>

      {samplesCollapsed ? null : (
        <PanelSplitter kind="details" {...detailsSplitter} />
      )}

      <aside
        className={`civitai-side-panel prompts-samples-panel${
          samplesCollapsed ? ' is-collapsed' : ''
        }`}
      >
        <div className="panel-toolbar">
          {samplesCollapsed ? null : (
            <div
              className="segmented prompts-side-panel-tabs"
              role="tablist"
              aria-label="Right panel"
            >
              <button
                type="button"
                role="tab"
                aria-selected={sidePanelMode === 'samples'}
                className={sidePanelMode === 'samples' ? 'active' : undefined}
                onClick={() => setSidePanelModePersist('samples')}
              >
                Samples
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sidePanelMode === 'lastOutput'}
                className={
                  sidePanelMode === 'lastOutput' ? 'active' : undefined
                }
                onClick={() => setSidePanelModePersist('lastOutput')}
              >
                Last output
              </button>
            </div>
          )}
          <div className="row-actions">
            {samplesCollapsed ? null : sidePanelMode === 'samples' ? (
              <button
                type="button"
                className="icon-btn"
                title="Reshuffle"
                disabled={!selectedFolder || busy}
                onClick={() => void reshuffle()}
              >
                <RefreshCw size={14} />
              </button>
            ) : heldPreview ? (
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
              title={
                samplesCollapsed ? 'Show right panel' : 'Hide right panel'
              }
              aria-label={
                samplesCollapsed ? 'Show right panel' : 'Hide right panel'
              }
              aria-expanded={!samplesCollapsed}
              onClick={() => setSamplesCollapsedPersist(!samplesCollapsed)}
            >
              {samplesCollapsed ? (
                <PanelRightOpen size={14} />
              ) : (
                <PanelRightClose size={14} />
              )}
            </button>
          </div>
        </div>
        {samplesCollapsed ? null : sidePanelMode === 'samples' ? (
          <div className="prompts-sample-grid">
            {samples.length === 0 ? (
              <p className="hint pad">No images in this folder.</p>
            ) : (
              samples.map((sample) => (
                <figure key={sample.fileName} className="prompts-sample-card">
                  <img src={sample.url} alt={sample.fileName} />
                  <figcaption title={sample.fileName}>
                    {sample.fileName}
                  </figcaption>
                </figure>
              ))
            )}
          </div>
        ) : heldPreview ? (
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
                        title="Copy seed"
                        aria-label="Copy seed"
                        onClick={() => {
                          const seed = heldPreview.seed;
                          if (typeof seed !== 'number' || !Number.isFinite(seed)) {
                            return;
                          }
                          void navigator.clipboard
                            .writeText(String(seed >>> 0))
                            .catch((e) =>
                              setError(
                                e instanceof Error ? e.message : String(e),
                              ),
                            );
                        }}
                      >
                        <ClipboardCopy size={14} />
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
    </main>
  );
}
