import { useEffect, useMemo, useState } from 'react';
import { Download, Minus, Plus, X } from 'lucide-react';
import type {
  CivitaiDownloadCategoryDto,
  HfDownloadTypeDto,
  HuggingFaceModelDetailDto,
  HuggingFaceModelHitDto,
  LoraDownloadCategoryListDto,
} from '../shared/contracts';
import { resolveDownloadSaveFileName } from '../domain/civitaiDownloadFileName';
import { hfRepoSaveFileName } from '../domain/huggingfaceWeightPick';
import {
  DEFAULT_LORA_DOWNLOAD_WEIGHTS,
  normalizeLoraWeights,
  uniqueExtraLoraCategoryIds,
} from '../domain/loraDownloadCategory';
import { LoraDownloadCategoryManagerModal } from './LoraDownloadCategoryManagerModal';
import { modalOverlayDismiss } from './modalOverlayDismiss';
import { useDraggableModal } from './useDraggableModal';

export type HfDownloadFormValues = {
  filePath: string;
  fileName: string;
  type: HfDownloadTypeDto;
  loraCategoryId?: string;
  extraLoraCategoryIds?: string[];
  category?: string;
  weights?: string;
  extraComment?: string;
  extraPrompt?: string;
};

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function HfDownloadModal({
  hit,
  detail,
  filePath: initialFilePath,
  fileName: initialFileName,
  type: initialType,
  loraCategoryId: initialLoraCategoryId,
  busy,
  onCancel,
  onConfirm,
}: {
  hit: HuggingFaceModelHitDto;
  detail: HuggingFaceModelDetailDto;
  filePath: string;
  fileName: string;
  type: HfDownloadTypeDto;
  loraCategoryId: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (values: HfDownloadFormValues) => void;
}) {
  const { modalStyle, dragging, headerPointerProps } = useDraggableModal();
  const [filePath, setFilePath] = useState(initialFilePath);
  const [fileName, setFileName] = useState(initialFileName);
  const [type, setType] = useState<HfDownloadTypeDto>(initialType);
  const [loraList, setLoraList] = useState<LoraDownloadCategoryListDto | null>(
    null,
  );
  const [loraCategoryId, setLoraCategoryId] = useState(initialLoraCategoryId);
  const [extraLoraCategoryIds, setExtraLoraCategoryIds] = useState<string[]>(
    [],
  );
  const [folderInfo, setFolderInfo] =
    useState<CivitaiDownloadCategoryDto | null>(null);
  const [category, setCategory] = useState('');
  const [weights, setWeights] = useState(DEFAULT_LORA_DOWNLOAD_WEIGHTS);
  const [extraComment, setExtraComment] = useState('');
  const [extraPrompt, setExtraPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [destIssue, setDestIssue] = useState<string | null>(null);
  const [destChecking, setDestChecking] = useState(false);

  const isLora = type === 'LORA';
  const fallbackFileName = initialFileName.trim() || 'model.safetensors';

  useEffect(() => {
    let cancelled = false;
    if (isLora) {
      void window.wcm.civitai
        .listLoraDownloadCategories()
        .then((result) => {
          if (cancelled) return;
          setLoraList(result);
          const initial = initialLoraCategoryId.trim();
          if (initial && result.categories.some((c) => c.id === initial)) {
            setLoraCategoryId(initial);
            return;
          }
          const last =
            result.lastCategoryId &&
            result.categories.some((c) => c.id === result.lastCategoryId)
              ? result.lastCategoryId
              : (result.categories[0]?.id ?? '');
          setLoraCategoryId(last);
        })
        .catch((e) => {
          if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
        });
    } else {
      void window.wcm.civitai
        .listDownloadCategories('Checkpoint')
        .then((result) => {
          if (cancelled) return;
          setFolderInfo(result);
          setCategory(result.lastCategory);
        })
        .catch((e) => {
          if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [initialLoraCategoryId, isLora]);

  const selectedLora = loraList?.categories.find((c) => c.id === loraCategoryId);
  const extrasValid =
    extraLoraCategoryIds.length === 0 ||
    extraLoraCategoryIds.every(
      (id) =>
        id &&
        id !== loraCategoryId &&
        loraList?.categories.some((c) => c.id === id),
    );
  const canDownload = isLora
    ? Boolean(loraCategoryId && selectedLora && extrasValid)
    : Boolean(folderInfo);
  const saveNameResolved = useMemo(
    () => resolveDownloadSaveFileName(fileName, fallbackFileName),
    [fileName, fallbackFileName],
  );
  const nameIssue = saveNameResolved.ok ? null : saveNameResolved.error;

  useEffect(() => {
    if (!canDownload || !saveNameResolved.ok) {
      setDestIssue(null);
      setDestChecking(false);
      return;
    }
    let cancelled = false;
    setDestChecking(true);
    const timer = window.setTimeout(() => {
      void window.wcm.huggingface
        .checkDownloadDestination({
          type,
          fileName: saveNameResolved.fileName,
          loraCategoryId: isLora ? loraCategoryId || undefined : undefined,
          category: isLora ? undefined : category || undefined,
        })
        .then((result) => {
          if (cancelled) return;
          if (
            result.renamed &&
            result.fileName &&
            result.fileName !== saveNameResolved.fileName
          ) {
            setFileName(result.fileName);
          }
          setDestIssue(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setDestIssue(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setDestChecking(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    canDownload,
    saveNameResolved,
    isLora,
    type,
    loraCategoryId,
    category,
  ]);

  const fileNameBlocked = Boolean(nameIssue || destIssue || destChecking);
  const canSubmit = canDownload && !fileNameBlocked && !busy;

  const categoryOptionsFor = (currentId: string, usedElsewhere: Set<string>) =>
    (loraList?.categories ?? []).filter(
      (c) => c.id === currentId || !usedElsewhere.has(c.id),
    );

  const addExtraLoraCategory = () => {
    const used = new Set(
      [loraCategoryId, ...extraLoraCategoryIds].filter(Boolean),
    );
    const next = loraList?.categories.find((c) => !used.has(c.id));
    if (!next) {
      setErr('All LoRA categories are already selected.');
      return;
    }
    setErr(null);
    setExtraLoraCategoryIds((prev) => [...prev, next.id]);
  };

  const createCategory = async () => {
    const trimmed = newCategory.trim();
    if (!trimmed) return;
    setErr(null);
    try {
      const result = await window.wcm.civitai.createDownloadCategory(
        'Checkpoint',
        trimmed,
      );
      setFolderInfo(result);
      setCategory(
        result.categories.includes(trimmed) ? trimmed : result.lastCategory,
      );
      setNewCategory('');
      setCreating(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const submitDownload = () => {
    const resolved = resolveDownloadSaveFileName(fileName, fallbackFileName);
    if (!resolved.ok) {
      setErr(resolved.error);
      return;
    }
    if (destIssue) {
      setErr(destIssue);
      return;
    }
    if (!filePath) {
      setErr('Pick a weight file.');
      return;
    }
    if (isLora) {
      if (!loraCategoryId) {
        setErr('Pick a LoRA category.');
        return;
      }
      if (!extrasValid) {
        setErr('Each extra category must be unique and filled in.');
        return;
      }
      const normalized = normalizeLoraWeights(weights);
      if (!normalized) {
        setErr(
          'Invalid weights. Use a number or pick-list, e.g. 0.8, -0.5, or {0.8|0.9|1|1}.',
        );
        return;
      }
      const extras = uniqueExtraLoraCategoryIds(
        loraCategoryId,
        extraLoraCategoryIds,
      );
      setErr(null);
      onConfirm({
        filePath,
        fileName: resolved.fileName,
        type,
        loraCategoryId,
        extraLoraCategoryIds: extras.length > 0 ? extras : undefined,
        weights: normalized,
        extraComment: extraComment.trim() || undefined,
        extraPrompt: extraPrompt.trim() || undefined,
      });
      return;
    }
    setErr(null);
    onConfirm({
      filePath,
      fileName: resolved.fileName,
      type,
      category,
    });
  };

  return (
    <>
      <div
        className="modal-overlay civitai-download-overlay hf-download-overlay"
        {...modalOverlayDismiss(onCancel)}
      >
        <div
          className="modal"
          style={modalStyle}
          onClick={(event) => event.stopPropagation()}
        >
          <header
            className={`modal-head modal-head-draggable${dragging ? ' dragging' : ''}`}
            title="Drag to move"
            {...headerPointerProps}
          >
            <h2>
              <Download size={18} /> Download
            </h2>
            <button type="button" className="icon-btn" onClick={onCancel}>
              <X size={16} />
            </button>
          </header>
          <div className="modal-body">
            <p className="hint civitai-download-target">
              <strong>{hit.id}</strong>
            </p>

            <label
              className="field-label"
              htmlFor="hf-download-file"
              title="Weight file in this Hugging Face repo"
            >
              Weight file
            </label>
            <select
              id="hf-download-file"
              className="text-input"
              value={filePath}
              disabled={busy || detail.siblings.length === 0}
              onChange={(e) => {
                const nextPath = e.target.value;
                setFilePath(nextPath);
                setFileName(hfRepoSaveFileName(hit.id, nextPath));
                setErr(null);
              }}
            >
              {detail.siblings.map((file) => (
                <option key={file.path} value={file.path}>
                  {file.path}
                  {file.size != null ? ` · ${formatBytes(file.size)}` : ''}
                </option>
              ))}
            </select>

            <label
              className="field-label"
              htmlFor="hf-download-filename"
              title="Saved file name under the category folder. Names starting with V1 or optimizer are blocked."
            >
              File name
            </label>
            <input
              id="hf-download-filename"
              className="text-input mono"
              value={fileName}
              disabled={busy}
              placeholder={fallbackFileName}
              spellCheck={false}
              onChange={(e) => {
                setFileName(e.target.value);
                setErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) {
                  e.preventDefault();
                  submitDownload();
                }
              }}
            />
            {nameIssue || destIssue ? (
              <p className="error-inline">{nameIssue ?? destIssue}</p>
            ) : destChecking ? (
              <p className="hint">Checking destination…</p>
            ) : (
              <p className="hint">
                Names starting with “V1” or “optimizer” are not allowed. A name
                already in the folder gets a number so the existing file stays.
              </p>
            )}

            <label className="field-label" htmlFor="hf-download-type">
              Type
            </label>
            <select
              id="hf-download-type"
              className="text-input"
              value={type}
              disabled={busy}
              onChange={(e) => setType(e.target.value as HfDownloadTypeDto)}
            >
              <option value="LORA">LoRA</option>
              <option value="Checkpoint">Checkpoint</option>
            </select>

            {isLora ? (
              <>
                <label
                  className="field-label"
                  htmlFor="hf-lora-category"
                  title={
                    selectedLora
                      ? [
                          `Saves under ${selectedLora.folder}/`,
                          loraList?.loraRoot ? `in ${loraList.loraRoot}` : null,
                          `appends to ${selectedLora.wildcardRelativePath}`,
                          extraLoraCategoryIds.length > 0
                            ? `+ ${extraLoraCategoryIds.length} more wildcard(s)`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : loraList && loraList.categories.length === 0
                        ? 'No categories yet — click … to create one (folder + wildcard).'
                        : 'Pick a LoRA category (folder + wildcard). Extra rows append the same reference to more wildcards.'
                  }
                >
                  LoRA category
                </label>
                <div className="civitai-category-row">
                  <select
                    id="hf-lora-category"
                    className="text-input"
                    value={loraCategoryId}
                    disabled={!loraList || busy}
                    onChange={(e) => {
                      const next = e.target.value;
                      setLoraCategoryId(next);
                      setExtraLoraCategoryIds((prev) =>
                        prev.filter((id) => id !== next),
                      );
                    }}
                  >
                    <option value="">Select a category…</option>
                    {categoryOptionsFor(
                      loraCategoryId,
                      new Set(extraLoraCategoryIds),
                    ).map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="civitai-category-side-btn"
                    title="Manage LoRA categories"
                    aria-label="Manage LoRA categories"
                    disabled={busy}
                    onClick={() => setManageOpen(true)}
                  >
                    …
                  </button>
                  <button
                    type="button"
                    className="civitai-category-side-btn"
                    title="Also append to another category’s wildcard"
                    aria-label="Add another LoRA category"
                    disabled={
                      busy ||
                      !loraList ||
                      loraList.categories.length <=
                        1 + extraLoraCategoryIds.length
                    }
                    onClick={addExtraLoraCategory}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {extraLoraCategoryIds.map((extraId, index) => {
                  const usedElsewhere = new Set(
                    [
                      loraCategoryId,
                      ...extraLoraCategoryIds.filter((_, i) => i !== index),
                    ].filter(Boolean),
                  );
                  return (
                    <div
                      key={`hf-extra-lora-cat-${index}`}
                      className="civitai-category-row civitai-category-row-extra"
                    >
                      <select
                        className="text-input"
                        value={extraId}
                        disabled={!loraList || busy}
                        aria-label={`Extra LoRA category ${index + 1}`}
                        title="Append the same <lora:…> reference to this category’s wildcard (file still saves in the primary folder)"
                        onChange={(e) => {
                          const next = e.target.value;
                          setExtraLoraCategoryIds((prev) =>
                            prev.map((id, i) => (i === index ? next : id)),
                          );
                        }}
                      >
                        <option value="">Select a category…</option>
                        {categoryOptionsFor(extraId, usedElsewhere).map(
                          (entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.name}
                            </option>
                          ),
                        )}
                      </select>
                      <button
                        type="button"
                        className="civitai-category-side-btn"
                        title="Remove this category"
                        aria-label="Remove extra LoRA category"
                        disabled={busy}
                        onClick={() =>
                          setExtraLoraCategoryIds((prev) =>
                            prev.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Minus size={16} />
                      </button>
                    </div>
                  );
                })}
                {loraList && loraList.categories.length === 0 ? (
                  <p className="hint">
                    No categories yet — click … to create one.
                  </p>
                ) : extraLoraCategoryIds.length > 0 ? (
                  <p className="hint">
                    File saves in the first category’s folder; the snippet is
                    appended to every selected wildcard.
                  </p>
                ) : null}

                <label
                  className="field-label"
                  htmlFor="hf-lora-weights"
                  title={`Used in the <lora:…> snippet. Default each time: ${DEFAULT_LORA_DOWNLOAD_WEIGHTS}. Also accepts 0.8 or -0.5.`}
                >
                  Weights
                </label>
                <input
                  id="hf-lora-weights"
                  className="text-input mono"
                  value={weights}
                  disabled={busy}
                  placeholder={DEFAULT_LORA_DOWNLOAD_WEIGHTS}
                  onChange={(e) => setWeights(e.target.value)}
                />

                <label
                  className="field-label"
                  htmlFor="hf-lora-extra-comment"
                  title="Optional note inserted between the Hugging Face URL comment and the <lora:…> line in the category wildcard. Leave empty to skip."
                >
                  Extra comment
                  <span className="hint"> (optional)</span>
                </label>
                <textarea
                  id="hf-lora-extra-comment"
                  className="text-input"
                  rows={2}
                  value={extraComment}
                  disabled={busy}
                  placeholder="e.g. Value range −10…+10; clamped −3…6"
                  spellCheck={false}
                  onChange={(e) => setExtraComment(e.target.value)}
                />

                <label
                  className="field-label"
                  htmlFor="hf-lora-extra-prompt"
                  title="Optional prompt text appended on the <lora:…> line (custom trigger or extra tags). Leave empty to skip."
                >
                  Extra prompt
                  <span className="hint"> (optional)</span>
                </label>
                <input
                  id="hf-lora-extra-prompt"
                  className="text-input"
                  value={extraPrompt}
                  disabled={busy}
                  placeholder="e.g. atmospheric, dynamic lighting, bokeh"
                  spellCheck={false}
                  onChange={(e) => setExtraPrompt(e.target.value)}
                />
              </>
            ) : (
              <>
                <label
                  className="field-label"
                  htmlFor="hf-download-category"
                >
                  Category folder
                </label>
                <div className="civitai-category-row">
                  <select
                    id="hf-download-category"
                    className="text-input"
                    value={category}
                    disabled={!folderInfo || busy}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="">(root folder)</option>
                    {folderInfo?.categories.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="icon-action"
                    title="Create a new category folder"
                    disabled={busy}
                    onClick={() => {
                      setCreating((current) => !current);
                      setErr(null);
                    }}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {folderInfo ? (
                  <p className="hint">
                    Saves under <code>{folderInfo.rootFolder}</code>
                    {category ? (
                      <>
                        {' '}
                        → <code>{category}</code>
                      </>
                    ) : null}
                    . Your last choice is remembered.
                  </p>
                ) : null}
                {creating ? (
                  <div className="civitai-category-create">
                    <input
                      className="text-input"
                      autoFocus
                      placeholder="New category name…"
                      value={newCategory}
                      disabled={busy}
                      onChange={(e) => setNewCategory(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void createCategory();
                      }}
                    />
                    <button
                      type="button"
                      className="manage-btn"
                      disabled={busy || !newCategory.trim()}
                      onClick={() => void createCategory()}
                    >
                      Create
                    </button>
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
            <button
              type="button"
              className="primary"
              disabled={!canSubmit}
              onClick={submitDownload}
            >
              Download
            </button>
          </footer>
        </div>
      </div>

      {manageOpen ? (
        <LoraDownloadCategoryManagerModal
          onClose={() => setManageOpen(false)}
          onChanged={(next) => {
            setLoraList(next);
            if (
              !loraCategoryId ||
              !next.categories.some((c) => c.id === loraCategoryId)
            ) {
              const pick = next.lastCategoryId ?? next.categories[0]?.id ?? '';
              setLoraCategoryId(pick);
            }
            setExtraLoraCategoryIds((prev) =>
              prev.filter((id) => next.categories.some((c) => c.id === id)),
            );
          }}
        />
      ) : null}
    </>
  );
}
