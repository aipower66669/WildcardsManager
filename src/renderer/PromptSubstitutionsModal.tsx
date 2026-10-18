import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Maximize2,
  Minimize2,
  Plus,
  Replace,
  Trash2,
  X,
} from 'lucide-react';
import {
  applyPromptSubstitutions,
  checkpointNameForSubstitution,
  type PromptSubstitution,
} from '../domain/promptSubstitution.js';
import { modalOverlayDismiss } from './modalOverlayDismiss';
import { usePersistedFloatingModal } from './usePersistedFloatingModal';

type Draft = PromptSubstitution & { id: string };

type Props = {
  checkpoint: string;
  promptSource: 'text' | 'folder';
  promptText: string;
  onClose: () => void;
  onSaved: (count: number) => void;
};

function newDraft(partial?: Partial<PromptSubstitution>): Draft {
  return {
    id: crypto.randomUUID(),
    modelContains: partial?.modelContains ?? '',
    find: partial?.find ?? '',
    replace: partial?.replace ?? '',
  };
}

function completeRules(rows: readonly Draft[]): PromptSubstitution[] {
  const out: PromptSubstitution[] = [];
  for (const row of rows) {
    const modelContains = row.modelContains.trim();
    if (!modelContains || row.find.length === 0) continue;
    out.push({
      modelContains,
      find: row.find,
      replace: row.replace,
    });
  }
  return out;
}

/**
 * Edit this library’s checkpoint-name prompt substitutions. Saved rules run
 * on Use this prompt and on the selected prompt folder before ComfyUI.
 */
export function PromptSubstitutionsModal({
  checkpoint,
  promptSource,
  promptText,
  onClose,
  onSaved,
}: Props) {
  const [rows, setRows] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = loading || saving;
  const checkpointName = checkpointNameForSubstitution(checkpoint);
  const {
    maximized,
    modalStyle,
    dragging,
    headerPointerProps,
    resizePointerProps,
    toggleMaximized,
  } = usePersistedFloatingModal({
    defaultWidth: 1120,
    defaultHeight: 860,
    minWidth: 800,
    minHeight: 560,
    load: async () => {
      const settings = await window.wcm.ui.getSettings();
      return settings.promptSubstitutionsWindow;
    },
    save: (state) => {
      void window.wcm.ui.setPromptSubstitutionsWindow(state).catch(() => {
        // ignore persistence failures
      });
    },
  });

  useEffect(() => {
    let cancelled = false;
    void window.wcm.ui
      .getPromptSubstitutions()
      .then((rules) => {
        if (cancelled) return;
        setRows(rules.map((rule) => newDraft(rule)));
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadFailed(true);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const preview = useMemo(() => {
    if (promptSource !== 'text') return null;
    const text = promptText.trim();
    if (!text || !checkpointName) return null;
    const next = applyPromptSubstitutions(text, checkpoint, completeRules(rows));
    if (next === text) return null;
    return next;
  }, [checkpoint, checkpointName, promptSource, promptText, rows]);

  const update = (id: string, patch: Partial<PromptSubstitution>) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    setError(null);
  };

  const move = (index: number, delta: number) => {
    setRows((current) => {
      const next = current.slice();
      const target = index + delta;
      const row = next[index];
      const swap = next[target];
      if (!row || !swap) return current;
      next[index] = swap;
      next[target] = row;
      return next;
    });
  };

  const save = async () => {
    for (const row of rows) {
      const touched =
        row.modelContains.trim().length > 0 ||
        row.find.length > 0 ||
        row.replace.trim().length > 0;
      if (!touched) continue;
      if (!row.modelContains.trim() || row.find.length === 0) {
        setError('Each rule needs a model keyword and the text to find.');
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await window.wcm.ui.setPromptSubstitutions(completeRules(rows));
      onSaved(saved.length);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onClose)}>
      <div
        className={`modal prompt-sub-modal${dragging ? ' is-dragging' : ''}${
          maximized ? ' is-maximized' : ''
        }`}
        style={modalStyle}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Prompt substitutions"
      >
        <header
          className={`modal-head modal-head-draggable${
            dragging ? ' dragging' : ''
          }`}
          title="Drag to move · double-click to maximize"
          {...headerPointerProps}
        >
          <h2>
            <Replace size={18} /> Prompt substitutions
          </h2>
          <div className="row-actions">
            <button
              type="button"
              className="icon-btn"
              title={maximized ? 'Restore' : 'Maximize'}
              aria-label={maximized ? 'Restore' : 'Maximize'}
              onClick={toggleMaximized}
            >
              {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="modal-body prompt-sub-body">
          <p className="hint">
            Before the selected prompt goes to ComfyUI, each rule whose keyword
            is in the checkpoint <em>file name</em> (case-insensitive, folders
            and extension ignored) replaces every exact Find text with Replace
            with. This runs for <strong>Use this prompt</strong> and for the
            line picked from the selected prompt folder, before wildcards
            expand. Rules belong to this library and run from top to bottom.
          </p>
          <p className="hint">
            Example: model contains <code>Kroma</code>, find{' '}
            <code>__loraname__</code>, replace{' '}
            <code>__loraname-KromaVersion__</code>.
          </p>
          <p className="hint">
            {checkpointName
              ? <>Current checkpoint: <code>{checkpointName}</code></>
              : 'Select a checkpoint to see which rules match.'}
          </p>
          <div className="prompt-sub-list">
            {rows.length === 0 ? (
              <p className="hint">No substitutions yet.</p>
            ) : (
              rows.map((row, index) => {
                const matches =
                  checkpointName.length > 0 &&
                  row.modelContains.trim().length > 0 &&
                  checkpointName
                    .toLowerCase()
                    .includes(row.modelContains.trim().toLowerCase());
                return (
                  <div
                    key={row.id}
                    className={`prompt-sub-row${matches ? ' is-match' : ''}`}
                  >
                    <label>
                      Model contains
                      <input
                        className="text-input"
                        value={row.modelContains}
                        spellCheck={false}
                        disabled={busy}
                        onChange={(event) =>
                          update(row.id, { modelContains: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Find in prompt
                      <input
                        className="text-input"
                        value={row.find}
                        spellCheck={false}
                        disabled={busy}
                        onChange={(event) =>
                          update(row.id, { find: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Replace with
                      <input
                        className="text-input"
                        value={row.replace}
                        spellCheck={false}
                        disabled={busy}
                        onChange={(event) =>
                          update(row.id, { replace: event.target.value })
                        }
                      />
                    </label>
                    <div className="prompt-sub-row-actions">
                      {matches ? (
                        <span className="prompt-sub-match">matches</span>
                      ) : null}
                      <button
                        type="button"
                        className="icon-btn"
                        title="Move up"
                        aria-label="Move rule up"
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Move down"
                        aria-label="Move rule down"
                        disabled={busy || index === rows.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Remove rule"
                        aria-label="Remove rule"
                        disabled={busy}
                        onClick={() =>
                          setRows((current) =>
                            current.filter((item) => item.id !== row.id),
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <button
            type="button"
            className="generation-action-btn"
            disabled={busy}
            onClick={() => setRows((current) => [...current, newDraft()])}
          >
            <Plus size={14} /> Add rule
          </button>
          {preview ? (
            <div className="categorize-prompt-preview">
              <strong>This prompt before wildcard expansion</strong>
              <pre>{preview}</pre>
            </div>
          ) : promptSource === 'folder' ? (
            <p className="hint">
              Folder mode substitutes the picked <code>!gen.txt</code> line the
              same way when a job is queued.
            </p>
          ) : null}
          {error ? <p className="error-text">{error}</p> : null}
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || loadFailed}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
        {maximized ? null : (
          <div
            className="prompt-sub-resize-handle"
            title="Drag to resize"
            {...resizePointerProps}
          />
        )}
      </div>
    </div>
  );
}
