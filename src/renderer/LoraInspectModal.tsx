import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { LoraInspectDto } from '../shared/contracts.js';
import { modalOverlayDismiss } from './modalOverlayDismiss';

function formatCount(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type Props = {
  relativePath: string;
  onClose: () => void;
};

export function LoraInspectModal({ relativePath, onClose }: Props) {
  const [data, setData] = useState<LoraInspectDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [showOther, setShowOther] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    setData(null);
    void window.wcm.modelFiles
      .inspectLora(relativePath)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        if (result.error) setError(result.error);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [relativePath]);

  const title = data?.stem ?? relativePath;

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onClose)}>
      <div
        className="modal modal-wide lora-inspect-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Inspect ${title}`}
      >
        <header className="modal-head">
          <h2>
            <Search size={18} /> Inspect LoRA
          </h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body lora-inspect-body">
          <p className="mono lora-inspect-path" title={data?.absolutePath}>
            {data?.relativePath ?? relativePath}
          </p>

          {busy ? <p className="hint">Reading safetensors header…</p> : null}
          {error ? <p className="hint error-text">{error}</p> : null}

          {data && !busy ? (
            <>
              {data.fields.length > 0 ? (
                <section className="lora-inspect-section">
                  <h3>Training metadata</h3>
                  <dl className="lora-inspect-fields">
                    {data.fields.map((f) => (
                      <div key={f.label} className="lora-inspect-field">
                        <dt>{f.label}</dt>
                        <dd>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}

              <section className="lora-inspect-section">
                <h3>
                  Keywords
                  {data.keywords.length > 0
                    ? ` (${data.keywords.length})`
                    : data.triggerWords.length > 0
                      ? ` (${data.triggerWords.length})`
                      : ''}
                </h3>
                {data.keywords.length > 0 ? (
                  <ul className="lora-inspect-keywords">
                    {data.keywords.map((k) => (
                      <li key={k.tag}>
                        <code>{k.tag}</code>
                        <span className="lora-inspect-count">{k.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : data.triggerWords.length > 0 ? (
                  <ul className="lora-inspect-keywords">
                    {data.triggerWords.map((tag) => (
                      <li key={tag}>
                        <code>{tag}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hint">
                    No tag frequency or trigger words found in this file’s
                    metadata.
                  </p>
                )}
              </section>

              <section className="lora-inspect-section">
                <h3>Tensors</h3>
                <p className="hint">
                  {data.tensorCount} tensor
                  {data.tensorCount === 1 ? '' : 's'}
                  {data.parameterCount != null
                    ? ` · ~${formatCount(data.parameterCount)} parameters`
                    : ''}
                  {data.dtypes.length > 0
                    ? ` · ${data.dtypes
                        .map(
                          (d) =>
                            `${d.dtype}×${d.tensors} (${formatBytes(d.bytes)})`,
                        )
                        .join(', ')}`
                    : ''}
                </p>
              </section>

              {data.otherFields.length > 0 ? (
                <section className="lora-inspect-section">
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => setShowOther((v) => !v)}
                  >
                    {showOther ? 'Hide' : 'Show'} other metadata (
                    {data.otherFields.length})
                  </button>
                  {showOther ? (
                    <dl className="lora-inspect-fields lora-inspect-raw">
                      {data.otherFields.map((f) => (
                        <div key={f.key} className="lora-inspect-field">
                          <dt className="mono">{f.key}</dt>
                          <dd className="mono">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </section>
              ) : null}

              {!error &&
              data.fields.length === 0 &&
              data.keywords.length === 0 &&
              data.triggerWords.length === 0 &&
              data.otherFields.length === 0 ? (
                <p className="hint">
                  This safetensors file has no `__metadata__` training fields
                  (common for some exported or converted LoRAs). Tensor summary
                  is still shown above when available.
                </p>
              ) : null}
            </>
          ) : null}
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
