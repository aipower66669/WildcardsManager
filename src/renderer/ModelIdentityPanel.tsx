import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, X } from 'lucide-react';
import type {
  ModelFileManagerEntryDto,
  ModelFileRematchFilenameCandidateDto,
} from '../shared/contracts.js';
import { StarRatingInput } from './StarRatingInput.js';
import { modalOverlayDismiss } from './modalOverlayDismiss.js';

function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Pretty-print common Civitai / A1111 sidecar JSON keys. */
export function SidecarJsonView({
  data,
  parseError,
  relativePath,
}: {
  data?: unknown;
  parseError?: string;
  relativePath?: string;
}) {
  if (parseError) {
    return (
      <p className="hint error-text">
        Could not parse {relativePath ?? 'sidecar JSON'}: {parseError}
      </p>
    );
  }
  if (data == null) {
    return <p className="hint">No companion .json next to this file.</p>;
  }

  const obj =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;

  if (!obj) {
    return (
      <pre className="model-json-block">{JSON.stringify(data, null, 2)}</pre>
    );
  }

  const preferred = [
    'ss_output_name',
    'ss_base_model_version',
    'ss_sd_model_name',
    'ss_network_module',
    'ss_network_dim',
    'ss_network_alpha',
    'ss_tag_frequency',
    'activation text',
    'activation_text',
    'preferred weight',
    'preferred_weight',
    'sd version',
    'modelId',
    'model_id',
    'sha256',
  ];

  const rows: Array<[string, string]> = [];
  for (const key of preferred) {
    if (!(key in obj)) continue;
    const val = obj[key];
    if (val == null) continue;
    rows.push([
      key,
      typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'
        ? String(val)
        : JSON.stringify(val),
    ]);
  }

  return (
    <div className="model-json-panel">
      {relativePath ? (
        <p className="hint mono">{relativePath}</p>
      ) : null}
      {rows.length > 0 ? (
        <dl className="model-meta-dl">
          {rows.map(([k, v]) => (
            <div key={k} className="model-meta-row">
              <dt>{k}</dt>
              <dd title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <details className="model-json-raw">
        <summary>Full JSON</summary>
        <pre className="model-json-block">{JSON.stringify(obj, null, 2)}</pre>
      </details>
    </div>
  );
}

export function ModelIdentityPanel({
  file,
  showCompanionJson = true,
  showRating = false,
  showMasterPreview = false,
  showCivitaiLink = true,
  rematchKind = 'LORA',
  onCivitaiLinkChanged,
  onRatingChanged,
}: {
  file: ModelFileManagerEntryDto;
  /** Sidecar .json — useful for checkpoints; LoRAs rarely have useful content. */
  showCompanionJson?: boolean;
  /** Local half-star rating (checkpoints). */
  showRating?: boolean;
  /** Checkpoint Benchmark sample grid (visual gist). */
  showMasterPreview?: boolean;
  /**
   * Civitai match row + manual page URL editor. Hide for local training-step
   * series (never published as a catalog model).
   */
  showCivitaiLink?: boolean;
  /** Used when Rematch falls back to filename candidates. */
  rematchKind?: 'LORA' | 'Checkpoint';
  /** Called after a manual Civitai URL is saved or cleared. */
  onCivitaiLinkChanged?: () => void;
  /** Called after rating is persisted (new rating value). */
  onRatingChanged?: (rating: number) => void;
}) {
  const [sidecarSrc, setSidecarSrc] = useState<string | null>(null);
  const [masterSrc, setMasterSrc] = useState<string | null>(null);
  const [benchmarkSrcs, setBenchmarkSrcs] = useState<string[]>([]);
  const [civitaiSrc, setCivitaiSrc] = useState<string | null>(
    file.previewLocalUrl ?? null,
  );
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [urlDraft, setUrlDraft] = useState(file.civitaiPageUrl ?? '');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [rematchBusy, setRematchBusy] = useState(false);
  const [rematchMsg, setRematchMsg] = useState<string | null>(null);
  const [filenameCandidates, setFilenameCandidates] = useState<
    ModelFileRematchFilenameCandidateDto[] | null
  >(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [rating, setRating] = useState(file.rating ?? -1);

  useEffect(() => {
    setUrlDraft(file.civitaiPageUrl ?? '');
    setLinkError(null);
    setRematchMsg(null);
    setFilenameCandidates(null);
    setRating(file.rating ?? -1);
  }, [file.civitaiPageUrl, file.absolutePath, file.rating]);

  useEffect(() => {
    setSidecarSrc(null);
    const abs = file.sidecar.imageAbsolutePath;
    if (!abs) return;
    let cancelled = false;
    void window.wcm.modelFiles.readSidecarImage(abs).then((url) => {
      if (!cancelled) setSidecarSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [file.sidecar.imageAbsolutePath, file.relativePath]);

  useEffect(() => {
    setMasterSrc(null);
    setBenchmarkSrcs([]);
    if (!showMasterPreview) return;
    const paths = [
      file.masterImageAbsolutePath,
      ...(file.masterGenImageAbsolutePaths ?? []),
    ].filter((p): p is string => Boolean(p?.trim()));
    if (paths.length === 0) return;
    let cancelled = false;
    void Promise.all(
      paths.map((abs) => window.wcm.modelFiles.readMasterImage(abs)),
    ).then((urls) => {
      if (cancelled) return;
      const loaded = urls.filter((u): u is string => Boolean(u));
      setBenchmarkSrcs(loaded);
      setMasterSrc(loaded[0] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [
    showMasterPreview,
    file.masterImageAbsolutePath,
    file.masterGenImageAbsolutePaths,
    file.relativePath,
  ]);

  useEffect(() => {
    setCivitaiSrc(file.previewLocalUrl ?? null);
    const remote = file.previewUrl;
    if (!remote || file.previewLocalUrl) return;
    let cancelled = false;
    setLoadingPreview(true);
    void window.wcm.civitai
      .cachePreview(remote)
      .then((local) => {
        if (!cancelled && local) setCivitaiSrc(local);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file.previewUrl, file.previewLocalUrl, file.relativePath]);

  const saveLink = async () => {
    setLinkBusy(true);
    setLinkError(null);
    try {
      await window.wcm.modelFiles.setCivitaiLink({
        absolutePath: file.absolutePath,
        autoV2: file.autoV2 ?? null,
        pageUrl: urlDraft.trim(),
      });
      onCivitaiLinkChanged?.();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : String(e));
    } finally {
      setLinkBusy(false);
    }
  };

  const clearLink = async () => {
    setLinkBusy(true);
    setLinkError(null);
    try {
      await window.wcm.modelFiles.clearCivitaiLink({
        absolutePath: file.absolutePath,
        autoV2: file.autoV2 ?? null,
      });
      setUrlDraft('');
      onCivitaiLinkChanged?.();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : String(e));
    } finally {
      setLinkBusy(false);
    }
  };

  const rematch = async () => {
    if (!file.autoV2) {
      setRematchMsg('Hash still pending — wait for AutoV2, then Rematch.');
      return;
    }
    setRematchBusy(true);
    setRematchMsg(null);
    setLinkError(null);
    setFilenameCandidates(null);
    try {
      const result = await window.wcm.modelFiles.rematchByHash({
        autoV2: file.autoV2,
        kind: rematchKind,
        localStem: file.stem || file.relativePath,
      });
      if (result.matched) {
        setRematchMsg(
          `Matched ${result.civitaiName ?? `model ${result.civitaiModelId}`}`,
        );
        onCivitaiLinkChanged?.();
      } else if (
        result.filenameCandidates &&
        result.filenameCandidates.length > 0
      ) {
        setFilenameCandidates(result.filenameCandidates);
        setRematchMsg(
          'Hash not on Civitai — confirm a filename match below (nothing linked yet).',
        );
      } else {
        setRematchMsg(result.reason ?? 'No match on Civitai');
      }
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : String(e));
    } finally {
      setRematchBusy(false);
    }
  };

  const confirmFilenameMatch = async (
    candidate: ModelFileRematchFilenameCandidateDto,
  ) => {
    setConfirmBusy(true);
    setLinkError(null);
    try {
      await window.wcm.modelFiles.setCivitaiLink({
        absolutePath: file.absolutePath,
        autoV2: file.autoV2 ?? null,
        pageUrl: candidate.civitaiPageUrl,
      });
      setFilenameCandidates(null);
      setUrlDraft(candidate.civitaiPageUrl);
      setRematchMsg(`Linked ${candidate.civitaiName} (filename match confirmed)`);
      onCivitaiLinkChanged?.();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirmBusy(false);
    }
  };

  const dirty =
    urlDraft.trim() !== (file.civitaiPageUrl ?? '').trim();

  const saveRating = async (next: number) => {
    setRatingBusy(true);
    try {
      const saved = await window.wcm.modelFiles.setRating({
        absolutePath: file.absolutePath,
        autoV2: file.autoV2 ?? null,
        rating: next,
      });
      setRating(saved);
      onRatingChanged?.(saved);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : String(e));
    } finally {
      setRatingBusy(false);
    }
  };

  return (
    <div className="model-identity">
      <dl className="model-meta-dl model-meta-dl--cols">
        <div className="model-meta-row">
          <dt>File</dt>
          <dd className="mono" title={file.absolutePath}>
            {file.relativePath}
          </dd>
        </div>
        <div className="model-meta-row">
          <dt>AutoV2</dt>
          <dd className="mono">{file.autoV2 ?? '— (hash pending)'}</dd>
        </div>
        <div className="model-meta-row">
          <dt>Size</dt>
          <dd>{formatBytes(file.sizeBytes)}</dd>
        </div>
        {showRating ? (
          <div className="model-meta-row model-meta-row--rating">
            <dt>Rating</dt>
            <dd>
              <StarRatingInput
                value={rating}
                disabled={ratingBusy}
                onChange={(next) => void saveRating(next)}
              />
            </dd>
          </div>
        ) : null}
        {showCivitaiLink ? (
          <div className="model-meta-row">
            <dt>Civitai</dt>
            <dd>
              {file.civitaiModelId != null ? (
                <button
                  type="button"
                  className="linkish"
                  onClick={() =>
                    void window.wcm.civitai.openModelPage(
                      file.civitaiModelId!,
                      file.civitaiName ?? file.stem,
                    )
                  }
                  title={file.civitaiPageUrl}
                >
                  <ExternalLink size={13} />
                  {file.civitaiName ?? `Model ${file.civitaiModelId}`}
                  {file.civitaiLinkManual ? ' · manual' : ''}
                </button>
              ) : (
                <span className="hint">No match</span>
              )}
              <button
                type="button"
                className="ghost-btn"
                style={{ marginLeft: 8 }}
                disabled={rematchBusy || linkBusy || !file.autoV2}
                title={
                  file.autoV2
                    ? 'Look up this AutoV2 on Civitai; if missing, suggest filename matches for confirmation'
                    : 'Needs AutoV2 hash first'
                }
                onClick={() => void rematch()}
              >
                <RefreshCw size={13} className={rematchBusy ? 'spin' : ''} />{' '}
                {rematchBusy ? 'Rematching…' : 'Rematch'}
              </button>
            </dd>
          </div>
        ) : null}
      </dl>

      {showCivitaiLink && rematchMsg ? (
        <p className="hint">{rematchMsg}</p>
      ) : null}

      {showCivitaiLink &&
      filenameCandidates &&
      filenameCandidates.length > 0 ? (
        <div
          className="modal-overlay"
          {...modalOverlayDismiss(() => {
            if (!confirmBusy) setFilenameCandidates(null);
          })}
        >
          <div
            className="modal rematch-filename-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Confirm filename match"
          >
            <header className="modal-head">
              <h2>Confirm Civitai match</h2>
              <button
                type="button"
                className="icon-btn"
                disabled={confirmBusy}
                onClick={() => setFilenameCandidates(null)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="modal-body">
              <p>
                AutoV2 was not found on Civitai (common when only an AIR id is
                published). Possible filename matches for{' '}
                <code>{file.stem}</code> — confirm one to link, or cancel.
              </p>
              <ul className="rematch-filename-list">
                {filenameCandidates.map((c) => (
                  <li key={c.civitaiModelId}>
                    <div className="rematch-filename-info">
                      <strong>{c.civitaiName}</strong>
                      <span className="hint">
                        {c.matchKind} · matched{' '}
                        <code>{c.matchedFileName}</code>
                      </span>
                    </div>
                    <div className="rematch-filename-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={confirmBusy}
                        title={c.civitaiPageUrl}
                        onClick={() =>
                          void window.wcm.civitai.openModelPage(
                            c.civitaiModelId,
                            c.civitaiName,
                          )
                        }
                      >
                        <ExternalLink size={13} /> Open
                      </button>
                      <button
                        type="button"
                        className="primary"
                        disabled={confirmBusy}
                        onClick={() => void confirmFilenameMatch(c)}
                      >
                        {confirmBusy ? 'Linking…' : 'Confirm link'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <footer className="modal-foot">
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => setFilenameCandidates(null)}
              >
                Cancel
              </button>
            </footer>
          </div>
        </div>
      ) : null}
      {showCivitaiLink ? (
        <div className="model-civitai-link-edit">
          <label>
            <span title="Paste a civitai.com / civitai.red /models/… URL to link this file">
              Civitai page URL
            </span>
            <input
              type="url"
              className="model-civitai-link-input"
              placeholder="https://civitai.com/models/12345/name"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (linkBusy || !urlDraft.trim() || !dirty) return;
                void saveLink();
              }}
              disabled={linkBusy}
            />
          </label>
          <div className="model-civitai-link-actions">
            <button
              type="button"
              className="ghost-btn"
              disabled={linkBusy || !urlDraft.trim() || !dirty}
              onClick={() => void saveLink()}
            >
              {linkBusy ? 'Saving…' : 'Save link'}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={linkBusy || !file.civitaiLinkManual}
              title={
                file.civitaiLinkManual
                  ? 'Remove manual Civitai link'
                  : 'Only manual links can be cleared (catalog matches stay)'
              }
              onClick={() => void clearLink()}
            >
              Clear
            </button>
          </div>
          {linkError ? <p className="hint error-text">{linkError}</p> : null}
        </div>
      ) : null}

      {(showMasterPreview && file.masterImageAbsolutePath) ||
      sidecarSrc ||
      civitaiSrc ||
      (loadingPreview && file.previewUrl) ? (
        <div className="model-preview-grid">
          {showMasterPreview && file.masterImageAbsolutePath ? (
            <div className="model-preview-card model-preview-card--master">
              <strong title="Samples from Checkpoint Benchmark (stem folder WCG images). Run Generation → Benchmark to fill these.">
                Benchmark
                {benchmarkSrcs.length > 0
                  ? ` · ${benchmarkSrcs.length} imgs`
                  : file.masterGenImageAbsolutePaths?.length
                    ? ` · ${(file.masterGenImageAbsolutePaths.length ?? 0) + 1} imgs`
                    : ''}
              </strong>
              {benchmarkSrcs.length > 1 ? (
                <div className="model-benchmark-thumb-grid">
                  {benchmarkSrcs.map((src, i) => (
                    <img
                      key={`${i}-${src.slice(0, 32)}`}
                      src={src}
                      alt=""
                      className="model-benchmark-thumb"
                    />
                  ))}
                </div>
              ) : masterSrc ? (
                <img src={masterSrc} alt="" className="model-preview-img" />
              ) : (
                <div className="model-preview-empty">
                  <RefreshCw size={18} className="spin" />
                  <span>Loading…</span>
                </div>
              )}
            </div>
          ) : null}
          {sidecarSrc ? (
            <div className="model-preview-card">
              <strong title="Same-name .jpg / .png beside the model">
                Folder preview
              </strong>
              <img src={sidecarSrc} alt="" className="model-preview-img" />
            </div>
          ) : null}
          {civitaiSrc || (loadingPreview && file.previewUrl) ? (
            <div className="model-preview-card">
              <strong title="From catalog match (queued if missing)">
                Civitai cover
              </strong>
              {civitaiSrc ? (
                <img src={civitaiSrc} alt="" className="model-preview-img" />
              ) : (
                <div className="model-preview-empty">
                  <RefreshCw size={18} className="spin" />
                  <span>Downloading…</span>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {showCompanionJson &&
      (file.sidecar.jsonRelativePath ||
        file.sidecar.json != null ||
        file.sidecar.jsonParseError) ? (
        <section className="model-sidecar-json">
          <strong>Companion JSON</strong>
          <SidecarJsonView
            data={file.sidecar.json}
            parseError={file.sidecar.jsonParseError}
            relativePath={file.sidecar.jsonRelativePath}
          />
        </section>
      ) : null}
    </div>
  );
}
