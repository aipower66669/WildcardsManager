import { useEffect, useRef, useState } from 'react';
import {
  FolderInput,
  Library,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  CIVITAI_ARCHITECTURE_PRESETS,
  CIVITAI_SDXL_FAMILY_PRESETS,
} from '../domain/civitaiBaseModels';
import { CIVITAI_MODEL_CATEGORY_PRESETS } from '../domain/civitaiModelCategories';
import { LibraryPathMigrationModal } from './LibraryPathMigrationModal';
import { modalOverlayDismiss } from './modalOverlayDismiss';
import type {
  CivitaiArchitectureIdDto,
  CivitaiModelCategoryIdDto,
  CivitaiOriginDto,
  CivitaiSdxlFamilyToggleIdDto,
  LibraryConfigDto,
  LibrarySwitchResultDto,
  ValidationPlatform,
} from '../shared/contracts';

type FolderField =
  | 'wildcardsRoot'
  | 'loraFolder'
  | 'checkpointFolder'
  | 'trainingLibraryFolder'
  | 'promptsFolder'
  | 'generationOutputRealistic'
  | 'generationOutputHentai'
  | 'generationOutput3d'
  | 'benchmarkOutputFolder';

type Props = {
  onClose: () => void;
  /** Called after mutations; pass switch result when the active library changed. */
  onChanged: (switchResult?: LibrarySwitchResultDto) => void | Promise<void>;
};

function pathSummary(lib: LibraryConfigDto): string {
  const site =
    lib.civitaiOrigin === 'https://civitai.red' ? 'civitai.red' : 'civitai.com';
  const parts = [
    lib.wildcardsRoot,
    lib.loraFolder,
    lib.checkpointFolder,
    lib.trainingLibraryFolder,
    lib.promptsFolder,
    lib.generationOutputRealistic,
    lib.generationOutputHentai,
    lib.generationOutput3d,
    lib.benchmarkOutputFolder,
  ].filter(Boolean) as string[];
  if (parts.length === 0) return site;
  return [
    site,
    ...parts.map((p) => p.replace(/\\/g, '/').split('/').slice(-2).join('/')),
  ].join(' · ');
}

const SDXL_FAMILY_TOGGLES = CIVITAI_SDXL_FAMILY_PRESETS.filter(
  (preset) => preset.id !== 'all',
);

const FOLDER_FIELDS: Array<{
  field: FolderField;
  label: string;
  help: string;
  placeholder: string;
}> = [
  {
    field: 'wildcardsRoot',
    label: 'Wildcards folder',
    help: 'Root of your Dynamic Prompts / wildcard library (.txt, .yaml, .json). This is the main project folder for this library.',
    placeholder: 'Path to wildcards root…',
  },
  {
    field: 'loraFolder',
    label: 'LoRA folder',
    help: 'Folder of LoRA model files (.safetensors, etc.) used for existence checks, downloads, and Browse matching.',
    placeholder: 'Path to LoRA models…',
  },
  {
    field: 'checkpointFolder',
    label: 'Checkpoint folder',
    help: 'Folder of checkpoint / diffusion model files (.safetensors, .ckpt, .pt, .gguf) for this library.',
    placeholder: 'Path to checkpoints…',
  },
  {
    field: 'trainingLibraryFolder',
    label: 'LoRA training library',
    help: 'Root of your training datasets. Each dataset folder has a dataset.json that points at the preview icon used for multi-step LoRA series.',
    placeholder: 'Optional training library root…',
  },
  {
    field: 'promptsFolder',
    label: 'Prompts folder',
    help: 'Optional root for prompt categories (!gen.txt trees and sample images). Shared by all Generation styles.',
    placeholder: 'Optional prompts root…',
  },
  {
    field: 'generationOutputRealistic',
    label: 'Generation output (Realistic)',
    help: 'Where Realistic images are written. Folder mode uses {this}/{prompt folder}/New; “Use this prompt” writes here. Leave empty to use the Prompts folder (previous default).',
    placeholder: 'Defaults to Prompts folder when empty…',
  },
  {
    field: 'generationOutputHentai',
    label: 'Generation output (Hentai)',
    help: 'Separate tree for Hentai Generation output so it does not mix with Realistic / 3D. Required before generating with the Hentai style.',
    placeholder: 'Hentai output root…',
  },
  {
    field: 'generationOutput3d',
    label: 'Generation output (3D)',
    help: 'Separate tree for 3D Generation output so it does not mix with Realistic / Hentai. Required before generating with the 3D style.',
    placeholder: '3D output root…',
  },
  {
    field: 'benchmarkOutputFolder',
    label: 'Checkpoint Benchmark folder',
    help: 'Generation Benchmark output root. Infinite Benchmark fills {stem}/ with 10 WCG images each (plus benchmark-stats.json). Those samples also power the visual gist on the Checkpoint files tab.',
    placeholder: 'Benchmark output root…',
  },
];

export function LibraryManagerModal({ onClose, onChanged }: Props) {
  const [libraries, setLibraries] = useState<LibraryConfigDto[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [migrateOpen, setMigrateOpen] = useState(false);
  /** Last values written to disk — not optimistic UI drafts (blur compares against this). */
  const persistedRef = useRef<Map<string, LibraryConfigDto>>(new Map());

  const selected =
    libraries.find((lib) => lib.id === selectedId) ?? libraries[0] ?? null;

  const librariesRef = useRef(libraries);
  librariesRef.current = libraries;

  const rememberPersisted = (list: LibraryConfigDto[]) => {
    persistedRef.current = new Map(list.map((lib) => [lib.id, lib]));
  };

  /** Keep UI + baseline in sync immediately (reload alone can race Close). */
  const applyUpdatedLibrary = (updated: LibraryConfigDto) => {
    persistedRef.current.set(updated.id, {
      ...(persistedRef.current.get(updated.id) ?? updated),
      ...updated,
    });
    setLibraries((list) =>
      list.map((lib) =>
        lib.id === updated.id ? { ...lib, ...updated } : lib,
      ),
    );
  };

  const reload = async () => {
    const list = await window.wcm.library.listLibraries();
    rememberPersisted(list.libraries);
    setLibraries(list.libraries);
    setActiveId(list.activeLibraryId);
    setSelectedId((current) => {
      if (current && list.libraries.some((lib) => lib.id === current)) {
        return current;
      }
      return list.activeLibraryId;
    });
  };

  useEffect(() => {
    void reload().catch((e) =>
      setErr(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  useEffect(() => {
    if (selected) setNameDraft(selected.name);
  }, [selected?.id, selected?.name]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createNew = () =>
    void run(async () => {
      const created = await window.wcm.library.createLibrary({
        name: `Library ${libraries.length + 1}`,
      });
      await reload();
      setSelectedId(created.id);
      await onChanged();
    });

  const saveName = (opts?: { quiet?: boolean }) =>
    void run(async () => {
      if (!selected) return;
      const nextName = nameDraft.trim();
      if (!nextName) {
        setErr('Library name is empty');
        setNameDraft(selected.name);
        return;
      }
      const baseline = persistedRef.current.get(selected.id);
      if (nextName === (baseline?.name ?? selected.name)) return;
      await window.wcm.library.updateLibrary(selected.id, {
        name: nextName,
      });
      await reload();
      if (!opts?.quiet) await onChanged();
    });

  const toggleArchitecture = (id: CivitaiArchitectureIdDto) =>
    void run(async () => {
      if (!selected) return;
      const current = new Set(selected.enabledArchitectures);
      if (current.has(id)) {
        if (current.size <= 1) {
          setErr('Keep at least one base model enabled');
          return;
        }
        current.delete(id);
      } else {
        current.add(id);
      }
      await window.wcm.library.updateLibrary(selected.id, {
        enabledArchitectures: [...current] as CivitaiArchitectureIdDto[],
      });
      await reload();
      await onChanged();
    });

  const toggleSdxlFamily = (id: CivitaiSdxlFamilyToggleIdDto) =>
    void run(async () => {
      if (!selected) return;
      const current = new Set(selected.enabledSdxlFamilies);
      if (current.has(id)) {
        if (current.size <= 1) {
          setErr('Keep at least one SDXL family enabled');
          return;
        }
        current.delete(id);
      } else {
        current.add(id);
      }
      await window.wcm.library.updateLibrary(selected.id, {
        enabledSdxlFamilies: [...current] as CivitaiSdxlFamilyToggleIdDto[],
      });
      await reload();
      await onChanged();
    });

  const toggleCivitaiCategory = (id: CivitaiModelCategoryIdDto) =>
    void run(async () => {
      if (!selected) return;
      const current = new Set(selected.enabledCivitaiCategories);
      if (current.has(id)) {
        if (current.size <= 1) {
          setErr('Keep at least one category enabled');
          return;
        }
        current.delete(id);
      } else {
        current.add(id);
      }
      const next = CIVITAI_MODEL_CATEGORY_PRESETS.map((p) => p.id).filter(
        (cid) => current.has(cid),
      );
      await window.wcm.library.updateLibrary(selected.id, {
        enabledCivitaiCategories: next,
      });
      await reload();
      await onChanged();
    });

  const setFolderPath = (field: FolderField, value: string | null) =>
    void run(async () => {
      if (!selected) return;
      const trimmed = value?.trim() ? value.trim() : null;
      const baseline = persistedRef.current.get(selected.id);
      const current = baseline?.[field] ?? null;
      if (trimmed === current) return;
      const updated = await window.wcm.library.updateLibrary(selected.id, {
        [field]: trimmed,
      });
      applyUpdatedLibrary(updated);
      await reload();
      if (selected.id === activeId && field === 'wildcardsRoot') {
        const result = await window.wcm.library.setActiveLibrary(selected.id);
        await onChanged(result);
      } else {
        await onChanged();
      }
    });

  const pickFolder = (field: FolderField) =>
    void run(async () => {
      if (!selected) return;
      const picked = await window.wcm.library.pickWildcardsFolder();
      if (!picked) return;
      const updated = await window.wcm.library.updateLibrary(selected.id, {
        [field]: picked,
      });
      applyUpdatedLibrary(updated);
      await reload();
      if (selected.id === activeId && field === 'wildcardsRoot') {
        const result = await window.wcm.library.setActiveLibrary(selected.id);
        await onChanged(result);
      } else {
        await onChanged();
      }
    });

  const clearFolder = (field: FolderField) => setFolderPath(field, null);

  const flushPendingEdits = async () => {
    if (!selected) return;
    const baseline = persistedRef.current.get(selected.id);
    const draftLib =
      librariesRef.current.find((lib) => lib.id === selected.id) ?? selected;
    const nextName = nameDraft.trim();
    if (nextName && nextName !== (baseline?.name ?? selected.name)) {
      const updated = await window.wcm.library.updateLibrary(selected.id, {
        name: nextName,
      });
      applyUpdatedLibrary(updated);
    }
    for (const { field } of FOLDER_FIELDS) {
      const draft = draftLib[field] ?? null;
      const persisted = baseline?.[field] ?? null;
      const normalized = draft?.trim() ? draft.trim() : null;
      if (normalized === persisted) continue;
      // Stale empty React state must not wipe a path that is already saved
      // (Clear goes through setFolderPath(null) and updates persisted first).
      if (normalized == null && persisted != null) continue;
      const updated = await window.wcm.library.updateLibrary(selected.id, {
        [field]: normalized,
      });
      applyUpdatedLibrary(updated);
    }
  };

  const closeAndFlush = () =>
    void run(async () => {
      try {
        await flushPendingEdits();
        await reload();
        await onChanged();
      } finally {
        onClose();
      }
    });

  const VALIDATION_PLATFORM_HELP =
    'ComfyUI rejects Dynamic Prompts expressions inside wildcard names (e.g. __color(|-basic)__). Stable Diffusion accepts them as equivalent to {__color__|__color-basic__}.';

  const CIVITAI_ORIGIN_HELP =
    'Which Civitai site this library browses and downloads from. Use separate libraries for civitai.com (SFW) and civitai.red (NSFW). Switching libraries switches the site.';

  const NAME_HELP =
    'Display name for this library in the switcher and Manage libraries list.';

  const ARCH_HELP =
    'Only checked base-model groups appear in the Civitai browser for this library. New libraries default to a common set.';

  const SDXL_HELP =
    'When SDXL is enabled above, only checked families are browsable in Civitai for this library.';

  const CATEGORY_HELP =
    'Only checked Civitai categories appear in Browse. Hidden ones keep existing catalog data and previews, but are not synced. Image preview downloads prefer the active library’s models.';


  const switchToSelected = () =>
    void run(async () => {
      if (!selected || selected.id === activeId) return;
      const result = await window.wcm.library.setActiveLibrary(selected.id);
      await reload();
      await onChanged(result);
    });

  const removeSelected = () =>
    void run(async () => {
      if (!selected) return;
      if (libraries.length <= 1) {
        setErr('Cannot delete the last library');
        return;
      }
      const wasActive = selected.id === activeId;
      const list = await window.wcm.library.deleteLibrary(selected.id);
      await reload();
      if (wasActive) {
        const result = await window.wcm.library.setActiveLibrary(
          list.activeLibraryId,
        );
        await onChanged(result);
      } else {
        await onChanged();
      }
    });

  const sdxlEnabled = Boolean(
    selected?.enabledArchitectures.includes('sdxl'),
  );

  return (
    <>
    <div className="modal-overlay" {...modalOverlayDismiss(closeAndFlush)}>
      <div
        className="modal library-manager-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>
            <Library size={17} /> Manage libraries
          </h2>
          <button
            type="button"
            className="icon-btn"
            onClick={closeAndFlush}
            disabled={busy}
          >
            <X size={16} />
          </button>
        </header>
        <div className="modal-body library-manager-body">
          <aside className="library-manager-list">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={createNew}
            >
              <Plus size={14} /> New library
            </button>
            <ul>
              {libraries.map((lib) => (
                <li key={lib.id}>
                  <button
                    type="button"
                    className={
                      lib.id === selected?.id
                        ? 'library-manager-item active'
                        : 'library-manager-item'
                    }
                    onClick={() => setSelectedId(lib.id)}
                  >
                    <strong>
                      {lib.name}
                      {lib.id === activeId ? ' · active' : ''}
                    </strong>
                    <small>{pathSummary(lib)}</small>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div className="library-manager-detail">
            {selected ? (
              <>
                <label
                  className="field-label"
                  htmlFor="library-name"
                  title={NAME_HELP}
                >
                  Name
                </label>
                <div className="library-manager-name-row">
                  <input
                    id="library-name"
                    className="text-input"
                    value={nameDraft}
                    disabled={busy}
                    title={`${NAME_HELP} Saves when you leave the field.`}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => saveName({ quiet: true })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                  />
                </div>

                <label
                  className="field-label"
                  htmlFor="library-civitai-origin"
                  title={CIVITAI_ORIGIN_HELP}
                >
                  Civitai site
                </label>
                <select
                  id="library-civitai-origin"
                  className="text-input"
                  value={selected.civitaiOrigin}
                  disabled={busy}
                  title={CIVITAI_ORIGIN_HELP}
                  onChange={(e) =>
                    void run(async () => {
                      if (!selected) return;
                      await window.wcm.library.updateLibrary(selected.id, {
                        civitaiOrigin: e.target.value as CivitaiOriginDto,
                      });
                      await reload();
                      await onChanged();
                    })
                  }
                >
                  <option value="https://civitai.com">
                    civitai.com — SFW catalog
                  </option>
                  <option value="https://civitai.red">
                    civitai.red — NSFW catalog
                  </option>
                </select>

                <label
                  className="field-label"
                  htmlFor="library-validation-platform"
                  title={VALIDATION_PLATFORM_HELP}
                >
                  Validation platform
                </label>
                <select
                  id="library-validation-platform"
                  className="text-input"
                  value={selected.validationPlatform}
                  disabled={busy}
                  title={VALIDATION_PLATFORM_HELP}
                  onChange={(e) =>
                    void run(async () => {
                      if (!selected) return;
                      await window.wcm.library.updateLibrary(selected.id, {
                        validationPlatform: e.target
                          .value as ValidationPlatform,
                      });
                      await reload();
                      await onChanged();
                    })
                  }
                >
                  <option value="comfyui">ComfyUI</option>
                  <option value="stable-diffusion">
                    Stable Diffusion — Dynamic Prompts
                  </option>
                </select>

                {FOLDER_FIELDS.map(({ field, label, help, placeholder }) => (
                  <div key={field} className="library-manager-folder">
                    <label
                      className="field-label"
                      htmlFor={`library-folder-${field}`}
                      title={help}
                    >
                      {label}
                    </label>
                    <div className="civitai-category-row">
                      <input
                        id={`library-folder-${field}`}
                        className="text-input mono"
                        value={selected[field] ?? ''}
                        disabled={busy}
                        placeholder={placeholder}
                        spellCheck={false}
                        title={help}
                        onChange={(e) => {
                          const next = e.target.value;
                          setLibraries((list) =>
                            list.map((lib) =>
                              lib.id === selected.id
                                ? { ...lib, [field]: next || null }
                                : lib,
                            ),
                          );
                        }}
                        onBlur={(e) =>
                          setFolderPath(field, e.target.value || null)
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={busy}
                        title={`Browse for ${label.toLowerCase()}`}
                        aria-label={`Browse for ${label.toLowerCase()}`}
                        onClick={() => pickFolder(field)}
                      >
                        …
                      </button>
                      {selected[field] ? (
                        <button
                          type="button"
                          className="ghost-btn danger-text"
                          disabled={busy}
                          title={`Clear ${label.toLowerCase()}`}
                          aria-label={`Clear ${label.toLowerCase()}`}
                          onClick={() => clearFolder(field)}
                        >
                          <X size={14} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}

                <div className="library-manager-toggles">
                  <label className="field-label" title={ARCH_HELP}>
                    Base models to manage
                  </label>
                  <div
                    className="library-manager-check-grid"
                    role="group"
                    title={ARCH_HELP}
                  >
                    {CIVITAI_ARCHITECTURE_PRESETS.map((preset) => {
                      const checked = selected.enabledArchitectures.includes(
                        preset.id as CivitaiArchitectureIdDto,
                      );
                      return (
                        <label
                          key={preset.id}
                          className="library-manager-check"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy}
                            onChange={() =>
                              toggleArchitecture(
                                preset.id as CivitaiArchitectureIdDto,
                              )
                            }
                          />
                          <span>{preset.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div
                  className={`library-manager-toggles${sdxlEnabled ? '' : ' muted'}`}
                >
                  <label className="field-label" title={SDXL_HELP}>
                    SDXL families
                  </label>
                  <div
                    className="library-manager-check-grid"
                    role="group"
                    title={SDXL_HELP}
                  >
                    {SDXL_FAMILY_TOGGLES.map((preset) => {
                      const checked = selected.enabledSdxlFamilies.includes(
                        preset.id as CivitaiSdxlFamilyToggleIdDto,
                      );
                      return (
                        <label
                          key={preset.id}
                          className="library-manager-check"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy || !sdxlEnabled}
                            onChange={() =>
                              toggleSdxlFamily(
                                preset.id as CivitaiSdxlFamilyToggleIdDto,
                              )
                            }
                          />
                          <span>{preset.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="library-manager-toggles">
                  <label className="field-label" title={CATEGORY_HELP}>
                    Civitai categories
                  </label>
                  <div
                    className="library-manager-check-grid"
                    role="group"
                    title={CATEGORY_HELP}
                  >
                    {CIVITAI_MODEL_CATEGORY_PRESETS.map((preset) => {
                      const checked = selected.enabledCivitaiCategories.includes(
                        preset.id,
                      );
                      return (
                        <label
                          key={preset.id}
                          className="library-manager-check"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy}
                            onChange={() => toggleCivitaiCategory(preset.id)}
                          />
                          <span>{preset.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="row-actions library-manager-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || selected.id === activeId}
                    onClick={switchToSelected}
                  >
                    Switch to this library
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    title="After moving folders to another drive, remap AppData pointers and absolute sidecars"
                    onClick={() => setMigrateOpen(true)}
                  >
                    <FolderInput size={14} /> Migrate library paths…
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy || libraries.length <= 1}
                    onClick={removeSelected}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </>
            ) : (
              <p className="hint">No libraries yet.</p>
            )}
            {err ? <p className="error-inline">{err}</p> : null}
          </div>
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={closeAndFlush} disabled={busy}>
            Close
          </button>
        </footer>
      </div>
    </div>
    {migrateOpen && selected ? (
      <LibraryPathMigrationModal
        libraryId={selected.id}
        libraryName={selected.name}
        onClose={() => setMigrateOpen(false)}
        onApplied={async () => {
          await reload();
          await onChanged();
        }}
      />
    ) : null}
    </>
  );
}
