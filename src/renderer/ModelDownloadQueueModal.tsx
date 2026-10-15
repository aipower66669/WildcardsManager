import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  ListOrdered,
  Pencil,
  Play,
  X,
} from 'lucide-react';
import type {
  CivitaiDownloadQueueItemDto,
  CivitaiDownloadQueueSnapshotDto,
  LoraDownloadCategoryDto,
} from '../shared/contracts.js';
import { modalOverlayDismiss } from './modalOverlayDismiss';

type Props = {
  open: boolean;
  onClose: () => void;
  snapshot: CivitaiDownloadQueueSnapshotDto | null;
  onChanged: (next: CivitaiDownloadQueueSnapshotDto) => void;
  onError: (message: string) => void;
  /** Open the full download confirm UI to edit a queued job. */
  onEditQueued?: (item: CivitaiDownloadQueueItemDto) => void;
};

export function ModelDownloadQueueModal({
  open,
  onClose,
  snapshot,
  onChanged,
  onError,
  onEditQueued,
}: Props) {
  const [loraCategories, setLoraCategories] = useState<
    LoraDownloadCategoryDto[]
  >([]);
  const [ckptCategories, setCkptCategories] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [resuming, setResuming] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([
      window.wcm.civitai.listLoraDownloadCategories(),
      window.wcm.civitai.listDownloadCategories('Checkpoint'),
    ])
      .then(([lora, ckpt]) => {
        if (cancelled) return;
        setLoraCategories(lora.categories);
        setCkptCategories(ckpt.categories);
      })
      .catch((e) => {
        if (!cancelled) {
          onError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, onError]);

  if (!open) return null;

  const active = snapshot?.active ?? null;
  const queue = snapshot?.queue ?? [];
  const empty = !active && queue.length === 0;
  const paused = Boolean(snapshot?.paused);

  const run = async (
    modelId: number,
    action: () => Promise<CivitaiDownloadQueueSnapshotDto>,
  ) => {
    setBusyId(modelId);
    try {
      onChanged(await action());
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const resumeQueue = async () => {
    setResuming(true);
    try {
      onChanged(await window.wcm.civitai.resumeDownloadQueue());
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setResuming(false);
    }
  };

  const keepDownloadingInBackground = async () => {
    setBackgroundBusy(true);
    try {
      await window.wcm.civitai.enterBackgroundDownloads();
      // Main process closes all windows — this renderer is going away.
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setBackgroundBusy(false);
    }
  };

  const renderRow = (
    item: CivitaiDownloadQueueItemDto,
    index: number,
    totalQueued: number,
  ) => {
    const isActive = item.status === 'active';
    const busy = busyId === item.modelId;
    const multiLora =
      item.type === 'LORA' && (item.extraLoraCategoryIds?.length ?? 0) > 0;
    return (
      <li
        key={item.jobId}
        className={`model-download-queue-row${isActive ? ' active' : ''}`}
      >
        <div className="model-download-queue-main">
          <strong title={item.modelName}>{item.modelName}</strong>
          <small>
            {item.type}
            {isActive
              ? ' · downloading'
              : paused
                ? ` · #${index + 1} paused`
                : ` · #${index + 1} in queue`}
          </small>
        </div>

        <div className="model-download-queue-category">
          {isActive ? (
            <span className="hint mono" title={item.categoryLabel}>
              {item.categoryLabel}
            </span>
          ) : item.type === 'LORA' ? (
            <select
              className="text-input"
              value={multiLora ? '__multiple__' : (item.loraCategoryId ?? '')}
              disabled={busy || loraCategories.length === 0 || multiLora}
              title={
                multiLora
                  ? 'Multiple categories — use Edit to change'
                  : 'Change LoRA category'
              }
              onChange={(e) => {
                const loraCategoryId = e.target.value;
                if (loraCategoryId === '__multiple__') return;
                void run(item.modelId, () =>
                  window.wcm.civitai.updateDownloadQueueItem(item.modelId, {
                    loraCategoryId,
                    extraLoraCategoryIds: [],
                    weights: item.weights,
                  }),
                );
              }}
            >
              {multiLora ? (
                <option value="__multiple__">&lt;Multiple&gt;</option>
              ) : null}
              {loraCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          ) : (
            <select
              className="text-input"
              value={item.category ?? ''}
              disabled={busy}
              title="Change checkpoint folder"
              onChange={(e) => {
                const category = e.target.value;
                void run(item.modelId, () =>
                  window.wcm.civitai.updateDownloadQueueItem(item.modelId, {
                    category,
                  }),
                );
              }}
            >
              <option value="">(root folder)</option>
              {ckptCategories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="model-download-queue-actions">
          {!isActive ? (
            <>
              {onEditQueued ? (
                <button
                  type="button"
                  className="ghost-btn icon-only"
                  title="Edit download"
                  aria-label="Edit download"
                  disabled={busy}
                  onClick={() => onEditQueued(item)}
                >
                  <Pencil size={14} />
                </button>
              ) : null}
              <button
                type="button"
                className="ghost-btn icon-only"
                title="Move earlier"
                disabled={busy || index <= 0}
                onClick={() =>
                  void run(item.modelId, () =>
                    window.wcm.civitai.moveDownloadQueueItem(item.modelId, -1),
                  )
                }
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                className="ghost-btn icon-only"
                title="Move later"
                disabled={busy || index >= totalQueued - 1}
                onClick={() =>
                  void run(item.modelId, () =>
                    window.wcm.civitai.moveDownloadQueueItem(item.modelId, 1),
                  )
                }
              >
                <ChevronDown size={14} />
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="ghost-btn"
            title={isActive ? 'Cancel download' : 'Remove from queue'}
            disabled={busy}
            onClick={() =>
              void run(item.modelId, () =>
                window.wcm.civitai.cancelDownloadQueueItem(item.modelId),
              )
            }
          >
            {isActive ? 'Cancel' : 'Remove'}
          </button>
        </div>
      </li>
    );
  };

  return (
    <div
      className="modal-overlay model-download-queue-overlay"
      {...modalOverlayDismiss(onClose)}
    >
      <div
        className="modal model-download-queue-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Download queue"
      >
        <header className="modal-head">
          <h2>
            <ListOrdered size={18} /> Download queue
          </h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <p className="hint">
            One file downloads at a time. Reorder or remove waiting items, or
            change their category before they start. Use Edit for the full
            download options (version, file name, multiple LoRA categories,
            weights). The active transfer can be cancelled. Connection failures
            pause the queue (jobs stay saved); resume manually or wait for the
            quiet auto-retry each minute. Use Close UI & keep downloading to
            free VRAM while the queue finishes overnight (tray icon).
          </p>
          {paused && !empty ? (
            <div className="model-download-queue-paused">
              <p>
                <strong>Paused</strong>
                {snapshot?.pauseReason
                  ? ` — ${snapshot.pauseReason}`
                  : ' after a connection issue.'}{' '}
                Auto-retry every 60s.
              </p>
              <button
                type="button"
                className="primary"
                disabled={resuming}
                onClick={() => void resumeQueue()}
              >
                <Play size={14} /> Resume now
              </button>
            </div>
          ) : null}
          {empty ? (
            <p className="hint">Queue is empty.</p>
          ) : (
            <ul className="model-download-queue-list">
              {active ? renderRow(active, 0, queue.length) : null}
              {queue.map((item, index) =>
                renderRow(item, index, queue.length),
              )}
            </ul>
          )}
        </div>
        <footer className="modal-foot">
          {!empty ? (
            <button
              type="button"
              className="primary"
              disabled={backgroundBusy || resuming}
              title="Close all windows and keep downloading in the system tray (frees VRAM)"
              onClick={() => void keepDownloadingInBackground()}
            >
              <Download size={14} />{' '}
              {backgroundBusy
                ? 'Switching…'
                : 'Close UI & keep downloading'}
            </button>
          ) : null}
          {paused && !empty ? (
            <button
              type="button"
              className="primary"
              disabled={resuming || backgroundBusy}
              onClick={() => void resumeQueue()}
            >
              <Play size={14} /> Resume
            </button>
          ) : null}
          <button type="button" onClick={onClose} disabled={backgroundBusy}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
