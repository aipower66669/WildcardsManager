import { useEffect, useState } from 'react';
import { FolderTree, RefreshCw, Tags, X } from 'lucide-react';
import type { PromptTreeDto } from '../shared/contracts';
import { appendGenPromptIfMissing } from '../domain/genPrompts.js';
import { modalOverlayDismiss } from './modalOverlayDismiss';
import { PromptFolderTree } from './PromptFolderTree';

type Props = {
  promptText: string;
  initialFolder?: string | null;
  onClose: () => void;
  /** Called after a successful add (or when already present). */
  onSaved?: (result: {
    relativeFolder: string;
    added: boolean;
    alreadyExists: boolean;
  }) => void;
};

/**
 * Pick a Prompts-tab folder and append the current Generation prompt to its
 * `!gen.txt` (create the file if missing; skip exact duplicates).
 */
export function CategorizePromptModal({
  promptText,
  initialFolder = null,
  onClose,
  onSaved,
}: Props) {
  const line = promptText.trim();
  const [tree, setTree] = useState<PromptTreeDto>({ root: null, folders: [] });
  const [selected, setSelected] = useState<string | null>(initialFolder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refreshTree = async () => {
    setBusy(true);
    setError(null);
    try {
      setTree(await window.wcm.prompts.listTree());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refreshTree();
  }, []);

  const save = async () => {
    if (!selected) {
      setError('Select a prompt folder.');
      return;
    }
    if (!line) {
      setError('Enter a prompt to categorize.');
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const gen = await window.wcm.prompts.readGen(selected);
      const result = appendGenPromptIfMissing(gen.content ?? '', line);
      if (result.alreadyExists) {
        setNote(`Already in ${selected}/!gen.txt`);
        onSaved?.({
          relativeFolder: selected,
          added: false,
          alreadyExists: true,
        });
        return;
      }
      await window.wcm.prompts.writeGen(selected, result.content);
      await window.wcm.prompts.loadGenPrompts(selected);
      onSaved?.({
        relativeFolder: selected,
        added: true,
        alreadyExists: false,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onClose)}>
      <div
        className="modal categorize-prompt-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Categorize prompt"
      >
        <header className="modal-head">
          <h2>
            <Tags size={18} /> Categorize prompt
          </h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body categorize-prompt-body">
          <p className="hint">
            Choose a Prompts folder. The current prompt is appended to that
            folder&apos;s <code>!gen.txt</code> (created if missing), unless an
            exact copy is already there.
          </p>
          <div className="categorize-prompt-preview" title={line}>
            <strong>Prompt</strong>
            <pre>{line || '(empty)'}</pre>
          </div>
          <div className="categorize-prompt-tree-head">
            <strong>
              <FolderTree size={14} /> Prompt folders
            </strong>
            <button
              type="button"
              className="icon-btn"
              title="Refresh"
              disabled={busy}
              onClick={() => void refreshTree()}
            >
              <RefreshCw size={14} className={busy ? 'spin' : undefined} />
            </button>
          </div>
          <div className="categorize-prompt-tree">
            <PromptFolderTree
              tree={tree}
              selected={selected}
              onSelect={(path) => {
                setSelected(path);
                setNote(null);
                setError(null);
              }}
            />
          </div>
          {selected ? (
            <p className="hint">
              Target: <code>{selected}/!gen.txt</code>
            </p>
          ) : (
            <p className="hint">Select a folder in the tree.</p>
          )}
          {note ? <p className="hint">{note}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !selected || !line}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Add to !gen.txt'}
          </button>
        </footer>
      </div>
    </div>
  );
}
