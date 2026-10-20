import { useEffect, useState, type ReactNode } from 'react';
import {
  CircleHelp,
  Dices,
  Download,
  Eraser,
  ExternalLink,
  FolderOpen,
  Library,
  PlugZap,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  DEFAULT_CONVERT_CHILD_SUFFIX,
  defaultConvertChildKey,
} from '../domain/convertToChild.js';
import { DEFAULT_COMFY_CONNECTION } from '../shared/comfy.js';
import { DEFAULT_LM_STUDIO_CONNECTION } from '../shared/lmStudio.js';
import type {
  AppUpdateCheckResultDto,
  BlockedCivitaiCreatorDto,
  ComfyConnectionDto,
  ComfyConnectionTestDto,
  ComfyContractCheckDto,
  GraphLayoutStyle,
  LibraryConfigDto,
  LmStudioConnectionDto,
  LmStudioConnectionTestDto,
} from '../shared/contracts.js';
import { modalOverlayDismiss } from './modalOverlayDismiss.js';
import { ReleaseNotesModal } from './ReleaseNotesModal.js';

function SettingsSection({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        <span>{title}</span>
        {help ? (
          <span
            className="settings-section-help"
            title={help}
            aria-label={help}
          >
            <CircleHelp size={14} aria-hidden />
          </span>
        ) : null}
      </h3>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

/** Path field + icon-only actions on one line. */
function SettingsFolderRow({
  path,
  emptyLabel = 'No folder set',
  onPick,
  onOpen,
  onClear,
  onSearch,
}: {
  path: string | null;
  emptyLabel?: string;
  onPick: () => void;
  onOpen?: () => void;
  onClear?: () => void;
  onSearch?: () => void;
}) {
  return (
    <div className="settings-folder-row">
      {path ? (
        <p className="settings-path" title={path}>
          <code>{path}</code>
        </p>
      ) : (
        <p className="settings-path empty">{emptyLabel}</p>
      )}
      <div className="settings-actions">
        <button
          type="button"
          className="settings-btn icon-only"
          title={path ? 'Change folder…' : 'Choose folder…'}
          aria-label={path ? 'Change folder' : 'Choose folder'}
          onClick={onPick}
        >
          <FolderOpen size={14} />
        </button>
        {path && onSearch ? (
          <button
            type="button"
            className="settings-btn icon-only"
            title="Search library…"
            aria-label="Search library"
            onClick={onSearch}
          >
            <Search size={14} />
          </button>
        ) : null}
        {path && onOpen ? (
          <button
            type="button"
            className="settings-btn icon-only"
            title="Open folder"
            aria-label="Open folder"
            onClick={onOpen}
          >
            <ExternalLink size={14} />
          </button>
        ) : null}
        {path && onClear ? (
          <button
            type="button"
            className="settings-btn icon-only danger-text"
            title="Clear"
            aria-label="Clear folder"
            onClick={onClear}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

type SettingsTabId = 'general' | 'civitai' | 'ai' | 'library';

export function ApplicationSettingsModal({
  settings,
  layoutStyle,
  convertChildSuffix,
  libraries,
  activeLibraryId,
  onClose,
  onSave,
  onLoraFolderChanged,
  onOpenGlobalSearch,
  onManageLibraries,
  onSwitchLibrary,
}: {
  settings: { iterations: number; seed: number };
  layoutStyle: GraphLayoutStyle;
  convertChildSuffix: string;
  libraries: LibraryConfigDto[];
  activeLibraryId: string | null;
  onClose: () => void;
  onLoraFolderChanged?: () => void;
  onOpenGlobalSearch?: () => void;
  onManageLibraries?: () => void;
  onSwitchLibrary?: (id: string) => void | Promise<void>;
  onSave: (
    settings: { iterations: number; seed: number },
    layoutStyle: GraphLayoutStyle,
    convertChildSuffix: string,
  ) => Promise<void>;
}) {
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('general');
  const [iterations, setIterations] = useState(settings.iterations);
  const [seed, setSeed] = useState(settings.seed);
  const [selectedLayout, setSelectedLayout] =
    useState<GraphLayoutStyle>(layoutStyle);
  const [childSuffix, setChildSuffix] = useState(convertChildSuffix);
  const [loraFolder, setLoraFolder] = useState<string | null>(null);
  const [checkpointFolder, setCheckpointFolder] = useState<string | null>(null);
  const [imagesFolder, setImagesFolder] = useState<string | null>(null);
  const [videosFolder, setVideosFolder] = useState<string | null>(null);
  const [trainingLibraryFolder, setTrainingLibraryFolder] = useState<
    string | null
  >(null);
  const [civitaiApiKey, setCivitaiApiKey] = useState('');
  const [hasCivitaiApiKey, setHasCivitaiApiKey] = useState(false);
  const [huggingfaceToken, setHuggingFaceToken] = useState('');
  const [hasHuggingFaceToken, setHasHuggingFaceToken] = useState(false);
  const [catalogAutoSyncMinutes, setCatalogAutoSyncMinutes] = useState(10);
  const [blockedCreators, setBlockedCreators] = useState<
    BlockedCivitaiCreatorDto[]
  >([]);
  const [generationSaveInNewSubfolder, setGenerationSaveInNewSubfolder] =
    useState(false);
  const [disableHardwareAcceleration, setDisableHardwareAcceleration] =
    useState(true);
  const [hwAccelRestartHint, setHwAccelRestartHint] = useState(false);
  const [updateReleaseFolder, setUpdateReleaseFolder] = useState<string | null>(
    null,
  );
  const [appVersion, setAppVersion] = useState('');
  const [updateCheck, setUpdateCheck] = useState<AppUpdateCheckResultDto | null>(
    null,
  );
  const [updateBusy, setUpdateBusy] = useState(false);
  const [downloadLabel, setDownloadLabel] = useState<string | null>(null);
  const [notesVersion, setNotesVersion] = useState<string | null>(null);
  const [lmHost, setLmHost] = useState(DEFAULT_LM_STUDIO_CONNECTION.host);
  const [lmPort, setLmPort] = useState(DEFAULT_LM_STUDIO_CONNECTION.port);
  const [lmSecure, setLmSecure] = useState(DEFAULT_LM_STUDIO_CONNECTION.secure);
  const [lmModel, setLmModel] = useState('');
  const [lmApiKey, setLmApiKey] = useState('');
  const [hasLmApiKey, setHasLmApiKey] = useState(false);
  const [lmModels, setLmModels] = useState<string[]>([]);
  const [lmTest, setLmTest] = useState<LmStudioConnectionTestDto | null>(null);
  const [lmBusy, setLmBusy] = useState(false);
  const [comfyHost, setComfyHost] = useState(DEFAULT_COMFY_CONNECTION.host);
  const [comfyPort, setComfyPort] = useState(DEFAULT_COMFY_CONNECTION.port);
  const [comfySecure, setComfySecure] = useState(
    DEFAULT_COMFY_CONNECTION.secure,
  );
  const [comfyGenerationFolder, setComfyGenerationFolder] = useState<
    string | null
  >(null);
  const [comfyLaunchPath, setComfyLaunchPath] = useState<string | null>(null);
  const [comfyTest, setComfyTest] = useState<ComfyConnectionTestDto | null>(
    null,
  );
  const [comfyContract, setComfyContract] =
    useState<ComfyContractCheckDto | null>(null);
  const [comfyBusy, setComfyBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const applyLmConnection = (lm: LmStudioConnectionDto) => {
    setLmHost(lm.host);
    setLmPort(lm.port);
    setLmSecure(lm.secure);
    setLmModel(lm.model);
    setHasLmApiKey(lm.hasApiKey);
  };

  const applyComfyConnection = (c: ComfyConnectionDto) => {
    setComfyHost(c.host);
    setComfyPort(c.port);
    setComfySecure(c.secure);
    setComfyGenerationFolder(c.generationFolder ?? null);
    setComfyLaunchPath(c.launchPath ?? null);
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.wcm.ui.getLoraFolder(),
      window.wcm.ui.getCheckpointFolder(),
      window.wcm.ui.getImagesFolder(),
      window.wcm.ui.getVideosFolder(),
      window.wcm.ui.getTrainingLibraryFolder(),
      window.wcm.ui.getCivitaiSettings(),
      window.wcm.ui.getSettings(),
      window.wcm.civitai.listBlockedCreators(),
      window.wcm.lmStudio.getConnection(),
      window.wcm.comfy.getConnection(),
      window.wcm.ui.getHuggingFaceTokenStatus(),
    ])
      .then(
        ([
          lora,
          checkpoint,
          images,
          videos,
          trainingLib,
          civitai,
          ui,
          blocked,
          lm,
          comfy,
          hf,
        ]) => {
          if (cancelled) return;
          setLoraFolder(lora);
          setCheckpointFolder(checkpoint);
          setImagesFolder(images);
          setVideosFolder(videos);
          setTrainingLibraryFolder(trainingLib);
          setHasCivitaiApiKey(civitai.hasApiKey);
          setCatalogAutoSyncMinutes(civitai.catalogAutoSyncIntervalMinutes);
          setDisableHardwareAcceleration(
            ui.disableHardwareAcceleration !== false,
          );
          setGenerationSaveInNewSubfolder(
            ui.generationSaveInNewSubfolder === true,
          );
          setUpdateReleaseFolder(ui.updateReleaseFolder ?? null);
          setAppVersion(ui.appVersion ?? '');
          setBlockedCreators(blocked);
          setLmHost(lm.host);
          setLmPort(lm.port);
          setLmSecure(lm.secure);
          setLmModel(lm.model);
          setHasLmApiKey(lm.hasApiKey);
          applyComfyConnection(comfy);
          setHasHuggingFaceToken(hf.hasToken);
        },
      )
      .catch((e) => {
        // Do not clear folder paths on a partial load failure — that made
        // videos/images look "forgotten" when an unrelated settings call failed.
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [activeLibraryId]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await window.wcm.ui.setCivitaiCatalogAutoSyncInterval(
        catalogAutoSyncMinutes,
      );
      await window.wcm.ui.setDisableHardwareAcceleration(
        disableHardwareAcceleration,
      );
      await window.wcm.ui.setGenerationSaveInNewSubfolder(
        generationSaveInNewSubfolder,
      );
      setHwAccelRestartHint(true);
      if (civitaiApiKey.trim()) {
        await window.wcm.ui.setCivitaiApiKey(civitaiApiKey.trim());
        setHasCivitaiApiKey(true);
      }
      if (huggingfaceToken.trim()) {
        await window.wcm.ui.setHuggingFaceToken(huggingfaceToken.trim());
        setHasHuggingFaceToken(true);
        setHuggingFaceToken('');
      }
      const lmPatch: Partial<LmStudioConnectionDto> & {
        apiKey?: string | null;
      } = {
        host: lmHost.trim() || DEFAULT_LM_STUDIO_CONNECTION.host,
        port: Math.max(1, Math.min(65535, Math.round(lmPort) || 1234)),
        secure: lmSecure,
        model: lmModel.trim(),
      };
      if (lmApiKey.trim()) lmPatch.apiKey = lmApiKey.trim();
      const lmSaved = await window.wcm.lmStudio.setConnection(lmPatch);
      applyLmConnection(lmSaved);
      if (lmApiKey.trim()) {
        setLmApiKey('');
        setHasLmApiKey(true);
      }
      const comfySaved = await window.wcm.comfy.setConnection({
        host: comfyHost.trim() || DEFAULT_COMFY_CONNECTION.host,
        port: Math.max(1, Math.min(65535, Math.round(comfyPort) || 8188)),
        secure: comfySecure,
        generationFolder: comfyGenerationFolder,
        launchPath: comfyLaunchPath,
      });
      applyComfyConnection(comfySaved);
      await onSave(
        {
          iterations: Math.max(1, Math.min(1_000_000, Math.round(iterations))),
          seed: Math.max(0, Math.min(0xffffffff, Math.round(seed))),
        },
        selectedLayout,
        childSuffix,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const persistLmDraft = async () => {
    const lmPatch: Partial<LmStudioConnectionDto> & {
      apiKey?: string | null;
    } = {
      host: lmHost.trim() || DEFAULT_LM_STUDIO_CONNECTION.host,
      port: Math.max(1, Math.min(65535, Math.round(lmPort) || 1234)),
      secure: lmSecure,
      model: lmModel.trim(),
    };
    if (lmApiKey.trim()) lmPatch.apiKey = lmApiKey.trim();
    const lmSaved = await window.wcm.lmStudio.setConnection(lmPatch);
    applyLmConnection(lmSaved);
    if (lmApiKey.trim()) {
      setLmApiKey('');
      setHasLmApiKey(true);
    }
  };

  const testLmStudio = async () => {
    setLmBusy(true);
    setErr(null);
    setLmTest(null);
    try {
      await persistLmDraft();
      const result = await window.wcm.lmStudio.testConnection();
      setLmTest(result);
      setLmModels(result.models);
      if (result.ok && !lmModel && result.models[0]) {
        setLmModel(result.models[0]);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLmBusy(false);
    }
  };

  const refreshLmModels = async () => {
    setLmBusy(true);
    setErr(null);
    try {
      await persistLmDraft();
      const ids = await window.wcm.lmStudio.listModels();
      setLmModels(ids);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLmBusy(false);
    }
  };

  const clearLmApiKey = async () => {
    setErr(null);
    try {
      const lmSaved = await window.wcm.lmStudio.setConnection({ apiKey: null });
      applyLmConnection(lmSaved);
      setLmApiKey('');
      setHasLmApiKey(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const persistComfyDraft = async () => {
    const saved = await window.wcm.comfy.setConnection({
      host: comfyHost.trim() || DEFAULT_COMFY_CONNECTION.host,
      port: Math.max(1, Math.min(65535, Math.round(comfyPort) || 8188)),
      secure: comfySecure,
      generationFolder: comfyGenerationFolder,
      launchPath: comfyLaunchPath,
    });
    applyComfyConnection(saved);
  };

  const pickComfyLaunchPath = async () => {
    setErr(null);
    try {
      const file = await window.wcm.comfy.pickLaunchPath();
      if (file !== null) setComfyLaunchPath(file);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const clearComfyLaunchPath = async () => {
    setErr(null);
    try {
      const saved = await window.wcm.comfy.setConnection({ launchPath: null });
      applyComfyConnection(saved);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const testComfy = async () => {
    setComfyBusy(true);
    setErr(null);
    setComfyTest(null);
    try {
      await persistComfyDraft();
      setComfyTest(await window.wcm.comfy.testConnection());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setComfyBusy(false);
    }
  };

  const checkComfyInstall = async () => {
    setComfyBusy(true);
    setErr(null);
    setComfyContract(null);
    try {
      await persistComfyDraft();
      const profile = await window.wcm.comfy.getWorkflowProfile();
      if (!profile) {
        setErr(
          'No saved workflow yet — open Generation → Edit Workflow, arrange the graph in ComfyUI, then Save Workflow.',
        );
        return;
      }
      setComfyContract(await window.wcm.comfy.checkContract());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setComfyBusy(false);
    }
  };

  const openDataFolder = async (folder: 'settings' | 'backups') => {
    setErr(null);
    try {
      if (folder === 'settings') await window.wcm.ui.openSettingsFolder();
      else await window.wcm.ui.openBackupsFolder();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const clearLastFile = async () => {
    setErr(null);
    try {
      await window.wcm.library.clearLastFile();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const pickLoraFolder = async () => {
    setErr(null);
    try {
      const folder = await window.wcm.ui.pickLoraFolder();
      if (folder !== null) {
        setLoraFolder(folder);
        onLoraFolderChanged?.();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const clearLoraFolder = async () => {
    setErr(null);
    try {
      await window.wcm.ui.clearLoraFolder();
      setLoraFolder(null);
      onLoraFolderChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const openLoraFolder = async () => {
    setErr(null);
    try {
      await window.wcm.ui.openLoraFolder();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const pickCheckpointFolder = async () => {
    setErr(null);
    try {
      const folder = await window.wcm.ui.pickCheckpointFolder();
      if (folder !== null) setCheckpointFolder(folder);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const clearCheckpointFolder = async () => {
    setErr(null);
    try {
      await window.wcm.ui.clearCheckpointFolder();
      setCheckpointFolder(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const openCheckpointFolder = async () => {
    setErr(null);
    try {
      await window.wcm.ui.openCheckpointFolder();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const pickImagesFolder = async () => {
    setErr(null);
    try {
      const folder = await window.wcm.ui.pickImagesFolder();
      if (folder !== null) setImagesFolder(folder);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const clearImagesFolder = async () => {
    setErr(null);
    try {
      await window.wcm.ui.clearImagesFolder();
      setImagesFolder(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const openImagesFolder = async () => {
    setErr(null);
    try {
      await window.wcm.ui.openImagesFolder();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const pickVideosFolder = async () => {
    setErr(null);
    try {
      const folder = await window.wcm.ui.pickVideosFolder();
      if (folder !== null) setVideosFolder(folder);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const clearVideosFolder = async () => {
    setErr(null);
    try {
      await window.wcm.ui.clearVideosFolder();
      setVideosFolder(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const openVideosFolder = async () => {
    setErr(null);
    try {
      await window.wcm.ui.openVideosFolder();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const pickUpdateReleaseFolder = async () => {
    setErr(null);
    setUpdateCheck(null);
    try {
      const folder = await window.wcm.ui.pickUpdateReleaseFolder();
      if (folder !== null) setUpdateReleaseFolder(folder);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const clearUpdateReleaseFolder = async () => {
    setErr(null);
    setUpdateCheck(null);
    try {
      await window.wcm.ui.clearUpdateReleaseFolder();
      setUpdateReleaseFolder(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    return window.wcm.ui.onAppUpdateDownloadProgress((progress) => {
      if (progress.bytesTotal > 0) {
        const pct = Math.min(
          100,
          Math.round((progress.bytesDone / progress.bytesTotal) * 100),
        );
        setDownloadLabel(`Downloading ${progress.fileName}… ${pct}%`);
        return;
      }
      const mb = (progress.bytesDone / (1024 * 1024)).toFixed(1);
      setDownloadLabel(`Downloading ${progress.fileName}… ${mb} MB`);
    });
  }, []);

  const checkForAppUpdate = async () => {
    setErr(null);
    setDownloadLabel(null);
    setUpdateBusy(true);
    try {
      const result = await window.wcm.ui.checkForAppUpdate();
      setUpdateCheck(result);
      if (result.available && result.latestVersion) {
        setNotesVersion(result.latestVersion);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdateBusy(false);
    }
  };

  const installAppUpdate = async () => {
    setErr(null);
    setDownloadLabel(null);
    setUpdateBusy(true);
    try {
      const result = await window.wcm.ui.installAppUpdate();
      setUpdateCheck(result);
      if (!result.available && result.message === 'Update cancelled.') {
        // stay in settings
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdateBusy(false);
      setDownloadLabel(null);
    }
  };

  const pickTrainingLibraryFolder = async () => {
    setErr(null);
    try {
      const folder = await window.wcm.ui.pickTrainingLibraryFolder();
      if (folder !== null) setTrainingLibraryFolder(folder);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const clearTrainingLibraryFolder = async () => {
    setErr(null);
    try {
      await window.wcm.ui.clearTrainingLibraryFolder();
      setTrainingLibraryFolder(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const openTrainingLibraryFolder = async () => {
    setErr(null);
    try {
      await window.wcm.ui.openTrainingLibraryFolder();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const clearCivitaiApiKey = async () => {
    setErr(null);
    try {
      await window.wcm.ui.setCivitaiApiKey(null);
      setCivitaiApiKey('');
      setHasCivitaiApiKey(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const convertSuffixHelp = `Appended to the source key when suggesting a child name. Example: colors + ${
    childSuffix.trim() || DEFAULT_CONVERT_CHILD_SUFFIX
  } → ${defaultConvertChildKey(
    'colors',
    childSuffix || DEFAULT_CONVERT_CHILD_SUFFIX,
  )}. Leave blank to use ${DEFAULT_CONVERT_CHILD_SUFFIX}.`;

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onClose)}>
      <div
        className="modal modal-wide settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>
            <Settings2 size={18} /> Settings
          </h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body settings-modal-body">
          <div className="settings-tabs" role="tablist" aria-label="Settings">
            {(
              [
                ['general', 'General'],
                ['civitai', 'Civitai'],
                ['ai', 'AI'],
                ['library', 'Library'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={settingsTab === id}
                className={`settings-tab${settingsTab === id ? ' active' : ''}`}
                onClick={() => setSettingsTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div
            className="settings-tab-panel"
            role="tabpanel"
            aria-label={
              settingsTab === 'general'
                ? 'General'
                : settingsTab === 'civitai'
                  ? 'Civitai'
                  : settingsTab === 'ai'
                    ? 'AI'
                    : 'Library'
            }
          >
            {settingsTab === 'general' ? (
              <>
                <SettingsSection
                  title="Graph layout"
                  help="Optimized minimizes crossings and keeps connected nodes closer while preserving the top-to-bottom dependency flow."
                >
                  <label className="inline-field">
                    Layout style
                    <select
                      value={selectedLayout}
                      onChange={(event) =>
                        setSelectedLayout(
                          event.target.value as GraphLayoutStyle,
                        )
                      }
                    >
                      <option value="default">
                        Default — fixed alphabetical grid
                      </option>
                      <option value="optimized">
                        Optimized — Dagre layered layout
                      </option>
                      <option value="compact">
                        Compact — min-gap packing (experimental)
                      </option>
                    </select>
                  </label>
                </SettingsSection>

                <SettingsSection
                  title="Convert to child"
                  help={convertSuffixHelp}
                >
                  <label className="inline-field">
                    Default name suffix
                    <input
                      type="text"
                      value={childSuffix}
                      onChange={(event) => setChildSuffix(event.target.value)}
                      placeholder={DEFAULT_CONVERT_CHILD_SUFFIX}
                      spellCheck={false}
                    />
                  </label>
                </SettingsSection>

                <SettingsSection
                  title="Simulation"
                  help="Settings are remembered across sessions. The Simulate button runs immediately with these values against the currently selected root. More iterations give steadier percentages (10,000 is a good default)."
                >
                  <div className="sim-fields">
                    <label className="inline-field">
                      Iterations
                      <input
                        type="number"
                        min={100}
                        max={1000000}
                        step={1000}
                        value={iterations}
                        onChange={(e) =>
                          setIterations(
                            Math.max(1, Number(e.target.value) || 1),
                          )
                        }
                      />
                    </label>
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
                        onClick={() =>
                          setSeed(Math.floor(Math.random() * 1_000_000_000))
                        }
                      >
                        <Dices size={15} />
                      </button>
                    </label>
                  </div>
                </SettingsSection>

                <SettingsSection
                  title="Performance"
                  help="Recommended while ComfyUI / A1111 is generating — keeps this app from competing for the GPU. Requires an app restart after changing. Turn off if you want GPU-accelerated UI when the GPU is free."
                >
                  <label className="library-manager-check">
                    <input
                      type="checkbox"
                      checked={disableHardwareAcceleration}
                      onChange={(e) =>
                        setDisableHardwareAcceleration(e.target.checked)
                      }
                    />
                    <span>Reduce GPU use (software UI rendering)</span>
                  </label>
                  {hwAccelRestartHint ? (
                    <p className="hint settings-inline-notice">
                      Restart Wildcards Manager for the GPU setting to take
                      effect.
                    </p>
                  ) : null}
                </SettingsSection>

                <SettingsSection
                  title="App updates"
                  help="Leave the folder empty to check GitHub Releases and download the installer from there. A folder overrides that and uses the installers already in it (latest.yml or WildcardsManager-*-win-x64.exe). What's new shows that version's release notes. Install closes the app and runs the installer — leave “Run” ticked at the end to relaunch."
                >
                  <p className="hint">
                    Running version{appVersion ? `: ${appVersion}` : ''}
                    {updateCheck?.latestVersion
                      ? ` · ${updateCheck.sourceKind === 'folder' ? 'Folder' : 'GitHub'} latest: ${updateCheck.latestVersion}`
                      : ''}
                  </p>
                  <div className="settings-folder-row">
                    {updateReleaseFolder ? (
                      <p
                        className="settings-path"
                        title={updateReleaseFolder}
                      >
                        <code>{updateReleaseFolder}</code>
                      </p>
                    ) : (
                      <p
                        className="settings-path"
                        title="https://github.com/aipower66669/WildcardsManager/releases"
                      >
                        <code>GitHub Releases</code>
                      </p>
                    )}
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="settings-btn icon-only"
                        title={
                          updateReleaseFolder
                            ? 'Change folder…'
                            : 'Use a local folder instead of GitHub…'
                        }
                        aria-label={
                          updateReleaseFolder
                            ? 'Change update folder'
                            : 'Choose update folder'
                        }
                        onClick={() => void pickUpdateReleaseFolder()}
                      >
                        <FolderOpen size={14} />
                      </button>
                      {updateReleaseFolder ? (
                        <button
                          type="button"
                          className="settings-btn icon-only danger-text"
                          title="Clear folder and use GitHub Releases"
                          aria-label="Clear update folder"
                          onClick={() => void clearUpdateReleaseFolder()}
                        >
                          <X size={14} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="settings-btn icon-only"
                        title="Check for update"
                        aria-label="Check for update"
                        disabled={updateBusy}
                        onClick={() => void checkForAppUpdate()}
                      >
                        <RefreshCw
                          size={14}
                          className={updateBusy ? 'spin' : undefined}
                        />
                      </button>
                      <button
                        type="button"
                        className="settings-btn settings-btn-text"
                        title={
                          updateCheck?.available
                            ? `Release notes for ${updateCheck.latestVersion}`
                            : 'What’s new (check for an update first)'
                        }
                        aria-label="What's new"
                        disabled={!updateCheck?.available || !updateCheck.latestVersion || updateBusy}
                        onClick={() => {
                          if (updateCheck?.latestVersion) {
                            setNotesVersion(updateCheck.latestVersion);
                          }
                        }}
                      >
                        What's new
                      </button>
                      <button
                        type="button"
                        className="settings-btn icon-only"
                        title={
                          updateCheck?.available
                            ? `Install ${updateCheck.latestVersion}`
                            : 'Install update (check first)'
                        }
                        aria-label="Install update"
                        disabled={!updateCheck?.available || updateBusy}
                        onClick={() => void installAppUpdate()}
                      >
                        <Download size={14} />
                      </button>
                    </div>
                  </div>
                  {downloadLabel ? (
                    <p className="hint settings-inline-notice">{downloadLabel}</p>
                  ) : null}
                  {updateCheck?.message ? (
                    <p
                      className={
                        updateCheck.available
                          ? 'hint settings-inline-notice'
                          : 'hint'
                      }
                    >
                      {updateCheck.message}
                      {updateCheck.installerFileName
                        ? ` (${updateCheck.installerFileName})`
                        : ''}
                    </p>
                  ) : null}
                </SettingsSection>

                <SettingsSection
                  title="Data locations"
                  help="App settings (folder paths, API keys, window layout) are stored in your user profile. Library datasets (catalog, hashes, thumbnails, backups) live inside your wildcards / LoRA / checkpoint folders. Clear last file forgets which wildcard to reopen on the next launch (the library folder is still restored) — use this if a heavy root kept freezing startup."
                >
                  <div className="settings-action-list">
                    <div className="settings-action-row">
                      <span>Settings folder</span>
                      <button
                        type="button"
                        className="settings-btn icon-only"
                        title="Open settings folder"
                        aria-label="Open settings folder"
                        onClick={() => void openDataFolder('settings')}
                      >
                        <FolderOpen size={14} />
                      </button>
                    </div>
                    <div className="settings-action-row">
                      <span>Backup folder</span>
                      <button
                        type="button"
                        className="settings-btn icon-only"
                        title="Open backup folder"
                        aria-label="Open backup folder"
                        onClick={() => void openDataFolder('backups')}
                      >
                        <Library size={14} />
                      </button>
                    </div>
                    <div className="settings-action-row">
                      <span>Last opened file</span>
                      <button
                        type="button"
                        className="settings-btn icon-only danger-text"
                        title="Clear last file"
                        aria-label="Clear last file"
                        onClick={() => void clearLastFile()}
                      >
                        <Eraser size={14} />
                      </button>
                    </div>
                  </div>
                </SettingsSection>
              </>
            ) : null}

            {settingsTab === 'civitai' ? (
              <>
                <SettingsSection
                  title="Connection"
                  help="Browse works without a key. Gated downloads need an API key from your Civitai account settings. Civitai.com vs .red is per library (Manage libraries). Hugging Face tokens are under Settings → AI."
                >
                  <p className="hint settings-empty">
                    Civitai site (.com / .red) is set per library in Manage
                    libraries — use one library for each catalog.
                  </p>
                  <div className="settings-field-row">
                    <label className="settings-field grow">
                      API key {hasCivitaiApiKey ? '(saved)' : '(optional)'}
                      <input
                        type="password"
                        value={civitaiApiKey}
                        onChange={(event) =>
                          setCivitaiApiKey(event.target.value)
                        }
                        placeholder={
                          hasCivitaiApiKey
                            ? 'Enter new key to replace'
                            : 'For gated downloads'
                        }
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    {hasCivitaiApiKey ? (
                      <div className="settings-actions">
                        <button
                          type="button"
                          className="settings-btn icon-only danger-text"
                          title="Clear API key"
                          aria-label="Clear Civitai API key"
                          onClick={() => void clearCivitaiApiKey()}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </SettingsSection>

                <SettingsSection
                  title="Catalog sync"
                  help="How often Browse tip-checks Civitai for new models after the previous check finishes (default 10). If a check runs long, the next wait starts when it ends — not on a fixed clock. 0 = never auto tip-check — use Refresh or change filters; incomplete catalogs still backfill."
                >
                  <label className="inline-field">
                    Auto-sync interval (minutes)
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      step={1}
                      value={catalogAutoSyncMinutes}
                      onChange={(event) =>
                        setCatalogAutoSyncMinutes(
                          Math.max(
                            0,
                            Math.min(
                              1440,
                              Math.round(Number(event.target.value) || 0),
                            ),
                          ),
                        )
                      }
                    />
                  </label>
                </SettingsSection>

                <SettingsSection
                  title="Blocked authors"
                  help="Right-click a Browse card → Block this Author. Cards from these creators stay hidden for this library."
                >
                  {blockedCreators.length === 0 ? (
                    <p className="hint settings-empty">No authors blocked.</p>
                  ) : (
                    <ul className="civitai-blocked-creators">
                      {blockedCreators.map((entry) => (
                        <li
                          key={`${entry.origin}:${entry.username.toLowerCase()}`}
                        >
                          <span title={entry.origin}>{entry.username}</span>
                          <button
                            type="button"
                            className="settings-btn icon-only danger-text"
                            title={`Unblock ${entry.username}`}
                            aria-label={`Unblock ${entry.username}`}
                            disabled={busy}
                            onClick={() => {
                              setBusy(true);
                              setErr(null);
                              void window.wcm.civitai
                                .unblockCreator(entry.username)
                                .then((next) => setBlockedCreators(next))
                                .catch((e) =>
                                  setErr(
                                    e instanceof Error
                                      ? e.message
                                      : String(e),
                                  ),
                                )
                                .finally(() => setBusy(false));
                            }}
                          >
                            <X size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </SettingsSection>
              </>
            ) : null}

            {settingsTab === 'ai' ? (
              <>
                <SettingsSection
                  title="ComfyUI"
                  help="Connection for the Generation tab. Host/port live here only — Edit Workflow in Generation opens the ComfyUI editor when you need to change the graph."
                >
                  <div className="settings-field-row">
                    <label className="settings-field grow">
                      Host
                      <input
                        type="text"
                        value={comfyHost}
                        onChange={(event) => setComfyHost(event.target.value)}
                        placeholder="127.0.0.1"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <label className="settings-field narrow">
                      Port
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        value={comfyPort}
                        onChange={(event) =>
                          setComfyPort(
                            Math.max(
                              1,
                              Math.min(
                                65535,
                                Math.round(Number(event.target.value) || 8188),
                              ),
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="settings-field check">
                      <input
                        type="checkbox"
                        checked={comfySecure}
                        onChange={(event) =>
                          setComfySecure(event.target.checked)
                        }
                      />
                      <span>HTTPS</span>
                    </label>
                  </div>
                  <p className="hint">
                    Launch shortcut — used when Generation finds ComfyUI offline
                    (Once / Infinite). Pick your usual <code>.bat</code> /
                    <code>.lnk</code> start file.
                  </p>
                  <div className="settings-folder-row">
                    {comfyLaunchPath ? (
                      <p className="settings-path" title={comfyLaunchPath}>
                        <code>{comfyLaunchPath}</code>
                      </p>
                    ) : (
                      <p className="settings-path empty">No launch shortcut set</p>
                    )}
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="settings-btn icon-only"
                        title={
                          comfyLaunchPath
                            ? 'Change launch shortcut…'
                            : 'Choose launch shortcut…'
                        }
                        aria-label={
                          comfyLaunchPath
                            ? 'Change ComfyUI launch shortcut'
                            : 'Choose ComfyUI launch shortcut'
                        }
                        disabled={busy || comfyBusy}
                        onClick={() => void pickComfyLaunchPath()}
                      >
                        <FolderOpen size={14} />
                      </button>
                      {comfyLaunchPath ? (
                        <button
                          type="button"
                          className="settings-btn icon-only danger-text"
                          title="Clear launch shortcut"
                          aria-label="Clear ComfyUI launch shortcut"
                          disabled={busy || comfyBusy}
                          onClick={() => void clearComfyLaunchPath()}
                        >
                          <X size={14} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <label className="library-manager-check">
                    <input
                      type="checkbox"
                      checked={generationSaveInNewSubfolder}
                      onChange={(e) =>
                        setGenerationSaveInNewSubfolder(e.target.checked)
                      }
                    />
                    <span>Save folder-mode images in a New subfolder</span>
                  </label>
                  <p className="hint">
                    Folder mode writes{' '}
                    <code>{'{styleOutput}/{prompt folder}'}</code>, and adds{' '}
                    <code>/New</code> when the checkbox above is on. ComfyUI
                    creates that folder when it saves the image. “Use this
                    prompt” writes to the style output root. Those roots are
                    set per library in <strong>Library Manager</strong>.
                    Filename stem is always <code>WCG</code>. Realistic
                    defaults to the Prompts folder when unset.
                  </p>
                  <div className="settings-folder-row">
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="settings-btn icon-only"
                        title={comfyBusy ? 'Testing ComfyUI connection…' : 'Test connection'}
                        aria-label="Test ComfyUI connection"
                        disabled={busy || comfyBusy}
                        onClick={() => void testComfy()}
                      >
                        <PlugZap size={14} />
                      </button>
                      <button
                        type="button"
                        className="settings-btn icon-only"
                        title="Check install"
                        aria-label="Check ComfyUI install"
                        disabled={busy || comfyBusy}
                        onClick={() => void checkComfyInstall()}
                      >
                        <ShieldCheck size={14} />
                      </button>
                    </div>
                  </div>
                  {comfyTest ? (
                    <p
                      className={`hint${comfyTest.ok ? '' : ' error-text'}`}
                    >
                      {comfyTest.ok
                        ? `Reachable${
                            comfyTest.latencyMs != null
                              ? ` · ${comfyTest.latencyMs} ms`
                              : ''
                          }${
                            comfyTest.nodeClassCount != null
                              ? ` · ${comfyTest.nodeClassCount} node classes`
                              : ''
                          }`
                        : comfyTest.errors.join(' ') || 'Connection failed'}
                      {comfyTest.warnings.length
                        ? ` — ${comfyTest.warnings.join(' ')}`
                        : ''}
                    </p>
                  ) : (
                    <p className="hint">
                      Default: <code>http://127.0.0.1:8188</code>
                    </p>
                  )}
                  {comfyContract ? (
                    <p
                      className={`hint${comfyContract.ok ? '' : ' error-text'}`}
                    >
                      {comfyContract.ok
                        ? `Workflow contract OK${
                            comfyContract.usesContractNodes
                              ? ' (pack nodes)'
                              : ''
                          }`
                        : `Missing: ${comfyContract.requiredMissing.join(', ')}`}
                    </p>
                  ) : null}
                </SettingsSection>

                <SettingsSection
                  title="LM Studio"
                  help="Local OpenAI-compatible server (LM Studio → Local Server). Used by the Details → Prompt tool for review and proposed edits. The app never writes a wildcard file until you confirm a proposal."
                >
                  <div className="settings-field-row">
                    <label className="settings-field grow">
                      Host
                      <input
                        type="text"
                        value={lmHost}
                        onChange={(event) => setLmHost(event.target.value)}
                        placeholder="127.0.0.1"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <label className="settings-field narrow">
                      Port
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        value={lmPort}
                        onChange={(event) =>
                          setLmPort(
                            Math.max(
                              1,
                              Math.min(
                                65535,
                                Math.round(Number(event.target.value) || 1234),
                              ),
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="settings-field check">
                      <input
                        type="checkbox"
                        checked={lmSecure}
                        onChange={(event) => setLmSecure(event.target.checked)}
                      />
                      <span>HTTPS</span>
                    </label>
                  </div>
                  <div className="settings-field-row">
                    <label className="settings-field grow">
                      Model
                      <select
                        value={lmModel}
                        onChange={(event) => setLmModel(event.target.value)}
                      >
                        <option value="">Server default / loaded model</option>
                        {lmModel && !lmModels.includes(lmModel) ? (
                          <option value={lmModel}>{lmModel} (saved)</option>
                        ) : null}
                        {lmModels.map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="settings-field-row">
                    <label className="settings-field grow">
                      API key {hasLmApiKey ? '(saved)' : '(optional)'}
                      <input
                        type="password"
                        value={lmApiKey}
                        onChange={(event) => setLmApiKey(event.target.value)}
                        placeholder={
                          hasLmApiKey
                            ? 'Enter new key to replace'
                            : 'Usually blank for local LM Studio'
                        }
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <div className="settings-actions">
                      {hasLmApiKey ? (
                        <button
                          type="button"
                          className="settings-btn icon-only danger-text"
                          title="Clear API key"
                          aria-label="Clear LM Studio API key"
                          onClick={() => void clearLmApiKey()}
                        >
                          <X size={14} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="settings-btn icon-only"
                        title={lmBusy ? 'Testing…' : 'Test connection'}
                        aria-label="Test LM Studio connection"
                        disabled={busy || lmBusy}
                        onClick={() => void testLmStudio()}
                      >
                        <Sparkles size={14} />
                      </button>
                      <button
                        type="button"
                        className="settings-btn icon-only"
                        title="Refresh models"
                        aria-label="Refresh LM Studio models"
                        disabled={busy || lmBusy}
                        onClick={() => void refreshLmModels()}
                      >
                        <RefreshCw size={14} />
                      </button>
                    </div>
                  </div>
                  {lmTest ? (
                    <p
                      className={`hint${lmTest.ok ? '' : ' error-text'}`}
                    >
                      {lmTest.ok
                        ? `Reachable${
                            lmTest.latencyMs != null
                              ? ` · ${lmTest.latencyMs} ms`
                              : ''
                          } · ${lmTest.models.length} model${
                            lmTest.models.length === 1 ? '' : 's'
                          }`
                        : lmTest.errors.join(' ') || 'Connection failed'}
                      {lmTest.warnings.length
                        ? ` — ${lmTest.warnings.join(' ')}`
                        : ''}
                    </p>
                  ) : (
                    <p className="hint">
                      Default: <code>http://127.0.0.1:1234/v1</code>
                    </p>
                  )}
                </SettingsSection>

                <SettingsSection
                  title="Hugging Face"
                  help="Access token from huggingface.co → Settings → Access Tokens. Required for gated models and some private repos in the Hugging Face browser."
                >
                  <div className="settings-field-row">
                    <label className="settings-field grow">
                      Access token{' '}
                      {hasHuggingFaceToken ? '(saved)' : '(optional)'}
                      <input
                        type="password"
                        value={huggingfaceToken}
                        onChange={(event) =>
                          setHuggingFaceToken(event.target.value)
                        }
                        placeholder={
                          hasHuggingFaceToken
                            ? 'Enter new token to replace'
                            : 'hf_… for gated Hub downloads'
                        }
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    {hasHuggingFaceToken ? (
                      <div className="settings-actions">
                        <button
                          type="button"
                          className="settings-btn icon-only danger-text"
                          title="Clear access token"
                          aria-label="Clear Hugging Face token"
                          onClick={() => {
                            void window.wcm.ui
                              .setHuggingFaceToken(null)
                              .then(() => {
                                setHasHuggingFaceToken(false);
                                setHuggingFaceToken('');
                              });
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </SettingsSection>
              </>
            ) : null}

            {settingsTab === 'library' ? (
              <>
                <SettingsSection
                  title="Active library"
                  help="Each library keeps its own wildcards / LoRA / checkpoint / prompts folders, Civitai tracking lists, and validation platform (ComfyUI vs Stable Diffusion)."
                >
                  <div className="settings-folder-row">
                    <label className="settings-field grow">
                      Configuration
                      <select
                        value={activeLibraryId ?? ''}
                        disabled={busy || libraries.length === 0}
                        onChange={(event) => {
                          const id = event.target.value;
                          if (id) void onSwitchLibrary?.(id);
                        }}
                      >
                        {libraries.map((lib) => (
                          <option key={lib.id} value={lib.id}>
                            {lib.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="settings-btn icon-only"
                        title="Manage libraries…"
                        aria-label="Manage libraries"
                        onClick={() => onManageLibraries?.()}
                      >
                        <Library size={14} />
                      </button>
                    </div>
                  </div>
                </SettingsSection>

                <SettingsSection
                  title="Prompts"
                  help="Configure the prompts folder and per-style Generation output folders (Realistic / Hentai / 3D) in Library Manager. Each prompt subfolder can hold a !gen.txt and sample images."
                >
                  <p className="hint settings-empty">
                    Set prompts / Generation output folders in Library Manager.
                  </p>
                </SettingsSection>

                <SettingsSection
                  title="Checkpoints"
                  help={
                    checkpointFolder
                      ? `Downloads go to ${checkpointFolder}.`
                      : 'Optional. Choose a folder for checkpoint downloads from the Civitai browser.'
                  }
                >
                  <SettingsFolderRow
                    path={checkpointFolder}
                    onPick={() => void pickCheckpointFolder()}
                    onOpen={() => void openCheckpointFolder()}
                    onClear={() => void clearCheckpointFolder()}
                  />
                </SettingsSection>

                <SettingsSection
                  title="Community images"
                  help={
                    imagesFolder
                      ? `Civitai image downloads go under ${imagesFolder}/<base model>/.`
                      : 'Optional. Choose a folder for community image downloads from the Civitai browser (Images).'
                  }
                >
                  <SettingsFolderRow
                    path={imagesFolder}
                    onPick={() => void pickImagesFolder()}
                    onOpen={() => void openImagesFolder()}
                    onClear={() => void clearImagesFolder()}
                  />
                </SettingsSection>

                <SettingsSection
                  title="Community videos"
                  help={
                    videosFolder
                      ? `Civitai video downloads go under ${videosFolder}/<base model>/.`
                      : 'Optional. Choose a folder for community video downloads from the Civitai browser (Videos).'
                  }
                >
                  <SettingsFolderRow
                    path={videosFolder}
                    onPick={() => void pickVideosFolder()}
                    onOpen={() => void openVideosFolder()}
                    onClear={() => void clearVideosFolder()}
                  />
                </SettingsSection>

                <SettingsSection
                  title="LoRA models"
                  help={
                    loraFolder
                      ? `Checking ${loraFolder} for <lora:name:weight> tags. Matching is case-insensitive by relative path or basename. Use Search library to check wildcards, LoRAs, and checkpoints before downloading. Changes apply immediately to the next analysis / live validation.`
                      : 'Optional. Choose a folder of .safetensors, .ckpt, or .pt files to warn when a <lora:…> tag cannot be resolved. Matching is case-insensitive by relative path or basename.'
                  }
                >
                  <SettingsFolderRow
                    path={loraFolder}
                    onPick={() => void pickLoraFolder()}
                    onOpen={() => void openLoraFolder()}
                    onClear={() => void clearLoraFolder()}
                    onSearch={
                      onOpenGlobalSearch
                        ? () => onOpenGlobalSearch()
                        : undefined
                    }
                  />
                </SettingsSection>

                <SettingsSection
                  title="LoRA training library"
                  help={
                    trainingLibraryFolder
                      ? `Matching multi-step LoRA series to datasets under ${trainingLibraryFolder} (dataset.json preview icons).`
                      : 'Optional. Root folder of your training datasets. Each dataset has a dataset.json that names the preview icon shown for multi-step LoRA series.'
                  }
                >
                  <SettingsFolderRow
                    path={trainingLibraryFolder}
                    onPick={() => void pickTrainingLibraryFolder()}
                    onOpen={() => void openTrainingLibraryFolder()}
                    onClear={() => void clearTrainingLibraryFolder()}
                  />
                </SettingsSection>
              </>
            ) : null}
          </div>
          {err ? <p className="error-inline">{err}</p> : null}
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void save()}
            disabled={busy}
          >
            <Save size={15} /> {busy ? 'Saving…' : 'Save settings'}
          </button>
        </footer>
      </div>
      {notesVersion ? (
        <ReleaseNotesModal
          version={notesVersion}
          onClose={() => setNotesVersion(null)}
        />
      ) : null}
    </div>
  );
}
