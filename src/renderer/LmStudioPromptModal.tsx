import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  LM_STUDIO_ASSIST_PRESETS,
  type LmStudioAssistPresetId,
} from '../shared/lmStudio';
import type {
  LmStudioAssistResultDto,
  LmStudioSavedPromptDto,
} from '../shared/contracts';
import { modalOverlayDismiss } from './modalOverlayDismiss';

type NameEditorMode = 'save-as' | 'rename' | 'delete' | null;

function countLines(text: string): number {
  if (!text) return 0;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized === '') return 0;
  return normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n').length
    : normalized.split('\n').length;
}

function presetLabel(preset: LmStudioAssistPresetId): string {
  return LM_STUDIO_ASSIST_PRESETS.find((p) => p.id === preset)?.label ?? preset;
}

export function LmStudioPromptModal({
  relativePath,
  currentText,
  onCancel,
  onApply,
}: {
  relativePath: string;
  /** Editor draft at open time — assist never reads disk behind the UI. */
  currentText: string;
  onCancel: () => void;
  /**
   * Apply confirmed proposal into the open editor (caller writes/flushes).
   * Modal never writes the library itself.
   */
  onApply: (proposedText: string) => Promise<void>;
}) {
  const [preset, setPreset] = useState<LmStudioAssistPresetId>('add_variations');
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<LmStudioSavedPromptDto[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [nameEditor, setNameEditor] = useState<NameEditorMode>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<LmStudioAssistResultDto | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.wcm.lmStudio.getConnection(),
      window.wcm.lmStudio.listModels().catch(() => [] as string[]),
      window.wcm.lmStudio.getPromptLibrary(),
    ])
      .then(([conn, ids, library]) => {
        if (cancelled) return;
        setModel(conn.model);
        setModels(ids);
        setPrompts(library.prompts);
        setPreset(library.lastSession.preset);
        setInstruction(library.lastSession.instruction);
        setSelectedPromptId(library.lastSession.selectedPromptId);
        setReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (nameEditor !== 'save-as' && nameEditor !== 'rename') return;
    const timer = window.setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [nameEditor]);

  const selectedPrompt = useMemo(
    () => prompts.find((p) => p.id === selectedPromptId) ?? null,
    [prompts, selectedPromptId],
  );

  const isDirty = Boolean(
    selectedPrompt &&
      (selectedPrompt.preset !== preset ||
        selectedPrompt.instruction !== instruction),
  );

  const presetMeta = useMemo(
    () => LM_STUDIO_ASSIST_PRESETS.find((p) => p.id === preset),
    [preset],
  );

  const lineDelta = useMemo(() => {
    if (!result?.proposedText) return null;
    return countLines(result.proposedText) - countLines(currentText);
  }, [result, currentText]);

  const persistSession = async (nextSelectedId = selectedPromptId) => {
    const library = await window.wcm.lmStudio.setPromptSession({
      preset,
      instruction,
      selectedPromptId: nextSelectedId,
    });
    setPrompts(library.prompts);
    setSelectedPromptId(library.lastSession.selectedPromptId);
  };

  const loadPrompt = (prompt: LmStudioSavedPromptDto) => {
    setSelectedPromptId(prompt.id);
    setPreset(prompt.preset);
    setInstruction(prompt.instruction);
    setNameEditor(null);
    setNameDraft('');
    setResult(null);
    setErr(null);
    void window.wcm.lmStudio
      .setPromptSession({
        preset: prompt.preset,
        instruction: prompt.instruction,
        selectedPromptId: prompt.id,
      })
      .then((library) => setPrompts(library.prompts))
      .catch(() => {
        /* keep local selection even if persist fails */
      });
  };

  const clearSelection = () => {
    setSelectedPromptId(null);
    setNameEditor(null);
    setNameDraft('');
    setResult(null);
    setErr(null);
  };

  const beginSaveAs = () => {
    setErr(null);
    setNameDraft(selectedPrompt?.name ? `${selectedPrompt.name} copy` : '');
    setNameEditor('save-as');
  };

  const beginRename = () => {
    if (!selectedPrompt) return;
    setErr(null);
    setNameDraft(selectedPrompt.name);
    setNameEditor('rename');
  };

  const beginDelete = () => {
    if (!selectedPrompt) return;
    setErr(null);
    setNameEditor('delete');
  };

  const cancelNameEditor = () => {
    setNameEditor(null);
    setNameDraft('');
  };

  const confirmNameEditor = async () => {
    if (nameEditor === 'delete') {
      if (!selectedPrompt) return;
      setLibraryBusy(true);
      setErr(null);
      try {
        const library = await window.wcm.lmStudio.deleteSavedPrompt(
          selectedPrompt.id,
        );
        setPrompts(library.prompts);
        setSelectedPromptId(library.lastSession.selectedPromptId);
        setNameEditor(null);
        setNameDraft('');
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLibraryBusy(false);
      }
      return;
    }

    const name = nameDraft.trim();
    if (!name) {
      setErr('Prompt name is required.');
      return;
    }

    setLibraryBusy(true);
    setErr(null);
    try {
      if (nameEditor === 'save-as') {
        const library = await window.wcm.lmStudio.upsertSavedPrompt({
          name,
          preset,
          instruction,
        });
        setPrompts(library.prompts);
        setSelectedPromptId(library.lastSession.selectedPromptId);
      } else if (nameEditor === 'rename') {
        if (!selectedPrompt) return;
        const library = await window.wcm.lmStudio.renameSavedPrompt(
          selectedPrompt.id,
          name,
        );
        setPrompts(library.prompts);
      }
      setNameEditor(null);
      setNameDraft('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLibraryBusy(false);
    }
  };

  const updateSelected = async () => {
    if (!selectedPrompt) return;
    setLibraryBusy(true);
    setErr(null);
    try {
      const library = await window.wcm.lmStudio.upsertSavedPrompt({
        id: selectedPrompt.id,
        name: selectedPrompt.name,
        preset,
        instruction,
      });
      setPrompts(library.prompts);
      setSelectedPromptId(library.lastSession.selectedPromptId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLibraryBusy(false);
    }
  };

  const runAssist = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      if (preset === 'custom' && !instruction.trim()) {
        throw new Error('Add an instruction for Custom mode.');
      }
      await persistSession();
      const next = await window.wcm.lmStudio.assistWildcard({
        relativePath,
        currentText,
        preset,
        instruction: instruction.trim() || undefined,
        model: model.trim() || undefined,
      });
      setResult(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!result?.hasEdits || result.proposedText == null) return;
    setApplying(true);
    setErr(null);
    try {
      await persistSession();
      await onApply(result.proposedText);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setApplying(false);
    }
  };

  const dismiss = () => {
    if (busy || applying) return;
    void persistSession().finally(() => onCancel());
  };

  const locked = busy || applying || libraryBusy || !ready;

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(dismiss)}>
      <div
        className="modal modal-wide lm-assist-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>
            <Sparkles size={18} /> Prompt AI
          </h2>
          <button
            type="button"
            className="icon-btn"
            onClick={dismiss}
            disabled={busy || applying}
            title="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="modal-body lm-assist-body">
          <p className="hint">
            Assist <code>{relativePath}</code> via local LM Studio. The file is
            never changed until you review the proposal and click Apply.
          </p>

          <div className="lm-assist-layout">
            <aside className="lm-assist-library">
              <div className="lm-assist-library-head">
                <strong>Prompt library</strong>
                <button
                  type="button"
                  className="ghost-btn icon-only"
                  title="Clear selection — start a fresh prompt"
                  disabled={locked}
                  onClick={clearSelection}
                >
                  <Plus size={14} />
                </button>
              </div>
              {prompts.length === 0 ? (
                <p className="hint lm-assist-library-empty">
                  Save prompts you reuse across wildcard files.
                </p>
              ) : (
                <ul className="lm-assist-library-list">
                  {prompts.map((prompt) => (
                    <li key={prompt.id}>
                      <button
                        type="button"
                        className={`lm-assist-library-item${
                          selectedPromptId === prompt.id ? ' active' : ''
                        }`}
                        disabled={locked}
                        onClick={() => loadPrompt(prompt)}
                        title={`${presetLabel(prompt.preset)}${
                          prompt.instruction ? ` — ${prompt.instruction}` : ''
                        }`}
                      >
                        <span className="lm-assist-library-item-name">
                          {prompt.name}
                        </span>
                        <small>{presetLabel(prompt.preset)}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {nameEditor === 'save-as' || nameEditor === 'rename' ? (
                <div className="lm-assist-name-editor">
                  <label className="inline-field">
                    {nameEditor === 'save-as' ? 'New prompt name' : 'Rename to'}
                    <input
                      ref={nameInputRef}
                      type="text"
                      className="text-input"
                      value={nameDraft}
                      disabled={libraryBusy}
                      placeholder="e.g. Add pastel variants"
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void confirmNameEditor();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelNameEditor();
                        }
                      }}
                    />
                  </label>
                  <div className="lm-assist-name-editor-actions">
                    <button
                      type="button"
                      className="manage-btn"
                      disabled={libraryBusy}
                      onClick={cancelNameEditor}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="manage-btn primary"
                      disabled={libraryBusy || !nameDraft.trim()}
                      onClick={() => void confirmNameEditor()}
                    >
                      <Save size={14} />{' '}
                      {nameEditor === 'save-as' ? 'Save' : 'Rename'}
                    </button>
                  </div>
                </div>
              ) : nameEditor === 'delete' && selectedPrompt ? (
                <div className="lm-assist-name-editor">
                  <p className="hint">
                    Delete <strong>{selectedPrompt.name}</strong>? This cannot be
                    undone.
                  </p>
                  <div className="lm-assist-name-editor-actions">
                    <button
                      type="button"
                      className="manage-btn"
                      disabled={libraryBusy}
                      onClick={cancelNameEditor}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="manage-btn danger-text"
                      disabled={libraryBusy}
                      onClick={() => void confirmNameEditor()}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className="lm-assist-library-actions">
                  <button
                    type="button"
                    className="manage-btn"
                    disabled={locked}
                    onClick={beginSaveAs}
                    title="Save the current mode + instruction as a new library entry"
                  >
                    <Save size={14} /> Save as…
                  </button>
                  <button
                    type="button"
                    className="manage-btn"
                    disabled={locked || !selectedPrompt || !isDirty}
                    onClick={() => void updateSelected()}
                    title="Update the selected library entry with the current mode + instruction"
                  >
                    <Save size={14} /> Update
                  </button>
                  <button
                    type="button"
                    className="manage-btn"
                    disabled={locked || !selectedPrompt}
                    onClick={beginRename}
                  >
                    <Pencil size={14} /> Rename
                  </button>
                  <button
                    type="button"
                    className="manage-btn danger-text"
                    disabled={locked || !selectedPrompt}
                    onClick={beginDelete}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              )}
              {selectedPrompt && isDirty && !nameEditor ? (
                <p className="hint">Selected prompt has unsaved edits.</p>
              ) : null}
            </aside>

            <div className="lm-assist-main">
              <label className="inline-field">
                Mode
                <select
                  value={preset}
                  disabled={locked}
                  onChange={(e) => {
                    setPreset(e.target.value as LmStudioAssistPresetId);
                    setResult(null);
                    setErr(null);
                  }}
                >
                  {LM_STUDIO_ASSIST_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {presetMeta ? (
                <p className="hint lm-assist-preset-desc">
                  {presetMeta.description}
                </p>
              ) : null}

              <label className="inline-field">
                {preset === 'custom'
                  ? 'Instruction (required)'
                  : 'Extra notes (optional)'}
                <textarea
                  className="text-input lm-assist-instruction"
                  rows={preset === 'custom' ? 6 : 4}
                  value={instruction}
                  disabled={locked}
                  placeholder={
                    preset === 'custom'
                      ? 'e.g. Add 20 more pastel variants; keep existing lines; no brand names.'
                      : 'Optional focus — e.g. watch for duplicate colors, prefer short lines…'
                  }
                  onChange={(e) => setInstruction(e.target.value)}
                />
              </label>

              <label className="inline-field">
                Model
                <select
                  value={model}
                  disabled={locked}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="">Server default / loaded model</option>
                  {model && !models.includes(model) ? (
                    <option value={model}>{model} (saved)</option>
                  ) : null}
                  {models.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {busy ? (
            <p className="hint">
              Waiting on LM Studio… large files can take a while.
            </p>
          ) : null}

          {result ? (
            <section className="lm-assist-result">
              <h3>
                <CheckCircle2 size={15} /> {result.summary}
              </h3>
              <p className="hint">
                Model: <code>{result.model || 'default'}</code>
                {result.hasEdits && lineDelta != null
                  ? ` · lines ${lineDelta >= 0 ? '+' : ''}${lineDelta}`
                  : null}
              </p>
              {result.notes ? (
                <pre className="lm-assist-notes">{result.notes}</pre>
              ) : null}
              {result.hasEdits && result.proposedText != null ? (
                <div className="cycle-diff lm-assist-diff">
                  <div>
                    <h4>Before (current draft)</h4>
                    <pre>{currentText || '(empty)'}</pre>
                  </div>
                  <div>
                    <h4>After (proposed)</h4>
                    <pre>{result.proposedText || '(empty)'}</pre>
                  </div>
                </div>
              ) : (
                <p className="hint">
                  No file edits proposed — review notes only. Nothing will be
                  written.
                </p>
              )}
            </section>
          ) : null}

          {err ? <p className="error-inline">{err}</p> : null}
        </div>

        <footer className="modal-foot">
          <button
            type="button"
            onClick={dismiss}
            disabled={busy || applying}
          >
            {result?.hasEdits ? 'Cancel' : 'Close'}
          </button>
          <button
            type="button"
            onClick={() => void runAssist()}
            disabled={locked}
          >
            <Sparkles size={15} />{' '}
            {busy ? 'Prompting…' : result ? 'Run again' : 'Run prompt'}
          </button>
          {result?.hasEdits ? (
            <button
              type="button"
              className="primary"
              onClick={() => void apply()}
              disabled={locked}
              title="Replace the open editor draft with the proposal, then save"
            >
              {applying ? 'Applying…' : 'Apply to file'}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
