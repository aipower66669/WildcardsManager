import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type {
  LoraDownloadCategoryDto,
  LoraDownloadCategoryListDto,
} from '../shared/contracts.js';
import { DEFAULT_LORA_DOWNLOAD_WEIGHTS } from '../domain/loraDownloadCategory.js';
import { modalOverlayDismiss } from './modalOverlayDismiss';

type Draft = {
  name: string;
  folder: string;
  wildcardRelativePath: string;
  defaultWeights: string;
};

const emptyDraft = (): Draft => ({
  name: '',
  folder: '',
  wildcardRelativePath: '',
  defaultWeights: DEFAULT_LORA_DOWNLOAD_WEIGHTS,
});

type Props = {
  onClose: () => void;
  /** Called after create/update/delete with the latest list. */
  onChanged?: (list: LoraDownloadCategoryListDto) => void;
  /**
   * Open focused on this wildcard: edit the category that uses it, or start
   * create with the path pre-filled.
   */
  focusWildcardPath?: string | null;
};

function suggestedNameFromWildcard(relativePath: string): string {
  const base = relativePath.split(/[/\\]/).pop() ?? relativePath;
  const stem = base.replace(/\.(ya?ml|json|txt)$/i, '') || relativePath;
  return stem
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function suggestedFolderFromWildcard(relativePath: string): string {
  const base = relativePath.split(/[/\\]/).pop() ?? relativePath;
  return base.replace(/\.(ya?ml|json|txt)$/i, '') || relativePath;
}

export function LoraDownloadCategoryManagerModal({
  onClose,
  onChanged,
  focusWildcardPath,
}: Props) {
  const [list, setList] = useState<LoraDownloadCategoryListDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');

  const refresh = async () => {
    const next = await window.wcm.civitai.listLoraDownloadCategories({
      includeWildcardFiles: true,
    });
    setList(next);
    onChanged?.(next);
    return next;
  };

  const beginCreate = (wildcardPath?: string) => {
    setCreating(true);
    setEditingId(null);
    const path = wildcardPath?.trim() ?? '';
    const name = path ? suggestedNameFromWildcard(path) : '';
    const folder = path ? suggestedFolderFromWildcard(path) : name;
    setDraft({
      name,
      folder,
      wildcardRelativePath: path,
      defaultWeights: DEFAULT_LORA_DOWNLOAD_WEIGHTS,
    });
    setError(null);
  };

  const beginEdit = (cat: LoraDownloadCategoryDto) => {
    setCreating(false);
    setEditingId(cat.id);
    setDraft({
      name: cat.name,
      folder: cat.folder,
      wildcardRelativePath: cat.wildcardRelativePath,
      defaultWeights: cat.defaultWeights,
    });
    setError(null);
  };

  useEffect(() => {
    let cancelled = false;
    void refresh()
      .then((next) => {
        if (cancelled) return;
        const focus = focusWildcardPath?.trim();
        if (!focus) return;
        const existing = next.categories.find(
          (c) => c.wildcardRelativePath === focus,
        );
        if (existing) beginEdit(existing);
        else beginCreate(focus);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / focus path
  }, [focusWildcardPath]);

  const cancelForm = () => {
    setCreating(false);
    setEditingId(null);
    setDraft(emptyDraft());
  };

  const browseFolder = async () => {
    setBusy(true);
    setError(null);
    try {
      const relative = await window.wcm.civitai.pickLoraCategoryFolder();
      if (relative) {
        setDraft((d) => ({ ...d, folder: relative }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const input = {
        name: draft.name.trim(),
        folder: draft.folder.trim() || draft.name.trim(),
        wildcardRelativePath: draft.wildcardRelativePath.trim(),
        defaultWeights: draft.defaultWeights.trim(),
      };
      const next = editingId
        ? await window.wcm.civitai.updateLoraDownloadCategory(editingId, input)
        : await window.wcm.civitai.createLoraDownloadCategory(input);
      setList(next);
      onChanged?.(next);
      const selectedId = editingId ?? next.lastCategoryId;
      const selected =
        (selectedId && next.categories.find((c) => c.id === selectedId)) ||
        next.categories.find((c) => c.name === input.name) ||
        null;
      if (selected) beginEdit(selected);
      else cancelForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this LoRA category? (Folder and wildcard stay.)')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await window.wcm.civitai.deleteLoraDownloadCategory(id);
      setList(next);
      onChanged?.(next);
      if (editingId === id) cancelForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const showForm = creating || editingId != null;
  const wildcards = list?.wildcardFiles ?? [];
  const categories = list?.categories ?? [];

  const filteredCategories = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return categories;
    return categories.filter((cat) => {
      const hay = `${cat.name} ${cat.folder} ${cat.wildcardRelativePath}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [categories, filter]);

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onClose)}>
      <div
        className="modal lora-category-manager-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="LoRA download categories"
      >
        <header className="modal-head">
          <h2>LoRA categories</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body lora-category-manager-body">
          <aside className="lora-category-manager-list">
            <button
              type="button"
              className="primary"
              disabled={busy || !list?.loraRoot}
              onClick={() => beginCreate()}
            >
              <Plus size={14} /> Add category
            </button>
            <label className="search-box">
              <span className="sr-only">Filter categories</span>
              <input
                type="search"
                placeholder="Filter categories…"
                value={filter}
                disabled={!list}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <ul>
              {filteredCategories.map((cat) => (
                <li key={cat.id}>
                  <button
                    type="button"
                    className={
                      editingId === cat.id && !creating
                        ? 'lora-category-manager-item active'
                        : 'lora-category-manager-item'
                    }
                    onClick={() => beginEdit(cat)}
                    title={`${cat.folder} → ${cat.wildcardRelativePath}`}
                  >
                    <span className="lora-category-manager-item-name">
                      {cat.name}
                    </span>
                    <span className="lora-category-manager-item-folder">
                      {cat.folder}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {list && categories.length === 0 ? (
              <p className="hint">No categories yet.</p>
            ) : null}
            {list && categories.length > 0 && filteredCategories.length === 0 ? (
              <p className="hint">No matches.</p>
            ) : null}
          </aside>

          <div className="lora-category-manager-detail">
            {list?.loraRoot ? (
              <p className="hint mono lora-category-root">
                LoRA root: {list.loraRoot}
              </p>
            ) : (
              <p className="hint error-text">Configure a LoRA folder first.</p>
            )}

            {showForm ? (
              <div className="lora-category-form">
                <h3>{editingId ? 'Edit category' : 'New category'}</h3>
                <p className="hint">
                  Downloads go to the subfolder; a{' '}
                  <code>&lt;lora:…&gt;</code> reference is appended to the
                  wildcard.
                </p>
                <label className="field-label">
                  Name
                  <input
                    className="text-input"
                    value={draft.name}
                    disabled={busy}
                    onChange={(e) => {
                      const name = e.target.value;
                      setDraft((d) => ({
                        ...d,
                        name,
                        folder: d.folder || name,
                      }));
                    }}
                  />
                </label>
                <label className="field-label" htmlFor="lora-cat-folder">
                  LoRA subfolder
                </label>
                <div className="civitai-category-row">
                  <input
                    id="lora-cat-folder"
                    className="text-input"
                    value={draft.folder}
                    disabled={busy}
                    placeholder="Type a folder or browse…"
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, folder: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="ghost-btn"
                    title="Browse for an existing folder under the LoRA root"
                    disabled={busy || !list?.loraRoot}
                    onClick={() => void browseFolder()}
                  >
                    …
                  </button>
                </div>
                <p className="hint">
                  Type any relative path under the LoRA root, or browse to pick
                  an existing folder.
                </p>
                <label className="field-label">
                  Wildcard file
                  <select
                    className="text-input"
                    value={draft.wildcardRelativePath}
                    disabled={busy}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        wildcardRelativePath: e.target.value,
                      }))
                    }
                  >
                    <option value="">Select…</option>
                    {wildcards.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label" htmlFor="lora-cat-weights">
                  Default weights
                </label>
                <div className="civitai-category-row">
                  <input
                    id="lora-cat-weights"
                    className="text-input mono"
                    value={draft.defaultWeights}
                    disabled={busy}
                    placeholder={DEFAULT_LORA_DOWNLOAD_WEIGHTS}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        defaultWeights: e.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="ghost-btn"
                    title={`Set to ${DEFAULT_LORA_DOWNLOAD_WEIGHTS}`}
                    disabled={
                      busy ||
                      draft.defaultWeights === DEFAULT_LORA_DOWNLOAD_WEIGHTS
                    }
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        defaultWeights: DEFAULT_LORA_DOWNLOAD_WEIGHTS,
                      }))
                    }
                  >
                    Default
                  </button>
                </div>
                <div className="lora-category-form-actions">
                  <button
                    type="button"
                    className="primary lora-category-save"
                    disabled={
                      busy ||
                      !draft.name.trim() ||
                      !(draft.folder.trim() || draft.name.trim()) ||
                      !draft.wildcardRelativePath.trim()
                    }
                    onClick={() => void save()}
                  >
                    {busy ? 'Saving…' : editingId ? 'Save' : 'Create'}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={cancelForm}
                  >
                    Cancel
                  </button>
                  {editingId ? (
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      title="Delete category"
                      onClick={() => void remove(editingId)}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  ) : (
                    <span aria-hidden="true" />
                  )}
                </div>
              </div>
            ) : (
              <p className="hint">
                Select a category on the left, or click Add category.
              </p>
            )}

            {error ? <p className="error-inline">{error}</p> : null}
          </div>
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
