import { ExternalLink } from 'lucide-react';
import { parseHuggingFaceModelPageUrl } from '../domain/huggingfaceSearch';

type Props = {
  pageUrl?: string | null;
  modelId?: number;
  modelName?: string;
  emptyHint?: string;
  /**
   * When set (including `null`), the pane shows a local image instead of a
   * Civitai webview — used for training-series dataset covers.
   */
  imageSrc?: string | null;
  imageTitle?: string;
  imageBusy?: boolean;
  /**
   * When true, render only the body (no outer panel / top bar) — parent owns
   * chrome (e.g. Checkpoint Benchmark | Website tabs).
   */
  embedded?: boolean;
};

/** Right-pane Civitai model page, or a local image (training dataset preview). */
export function ModelCivitaiPagePane({
  pageUrl,
  modelId,
  modelName,
  emptyHint = 'No Civitai page for this file yet (needs an AutoV2 catalog match).',
  imageSrc,
  imageTitle,
  imageBusy = false,
  embedded = false,
}: Props) {
  if (imageSrc !== undefined) {
    const body = imageSrc ? (
      <div className="model-dataset-preview-stage">
        <img src={imageSrc} alt="" />
      </div>
    ) : (
      <div className="civitai-preview-empty">
        <p>{imageBusy ? 'Looking up dataset preview…' : emptyHint}</p>
      </div>
    );
    if (embedded) return body;
    return (
      <section className="model-browser-panel" aria-label="Dataset preview">
        <div className="civitai-preview-bar">
          <strong title={imageTitle}>{imageTitle ?? 'Dataset preview'}</strong>
        </div>
        {body}
      </section>
    );
  }

  const hfRepo = pageUrl
    ? parseHuggingFaceModelPageUrl(pageUrl)?.repoId
    : undefined;
  const openStoredPage = () => {
    if (hfRepo) {
      void window.wcm.huggingface.openModelPage(hfRepo);
      return;
    }
    if (modelId != null) {
      void window.wcm.civitai.openModelPage(
        modelId,
        modelName ?? String(modelId),
      );
    }
  };
  const body = pageUrl ? (
    <webview
      className="civitai-preview-webview"
      src={pageUrl}
      allowpopups={true}
      partition={hfRepo ? 'persist:hf-preview' : 'persist:civitai-preview'}
    />
  ) : (
    <div className="civitai-preview-empty">
      <p>{emptyHint}</p>
      <p className="hint">
        Hash the file and sync the catalog so AutoV2 can match a model page.
      </p>
    </div>
  );

  if (embedded) return body;

  return (
    <section className="model-browser-panel" aria-label="Civitai model page">
      {pageUrl ? (
        <>
          <div className="civitai-preview-bar">
            <strong title={pageUrl}>{modelName ?? 'Civitai'}</strong>
            <div className="civitai-preview-bar-actions">
              {modelId != null || hfRepo ? (
                <button
                  type="button"
                  className="civitai-icon-btn action-open"
                  title="Open in external browser"
                  aria-label="Open in external browser"
                  onClick={openStoredPage}
                >
                  <ExternalLink size={15} />
                </button>
              ) : null}
            </div>
          </div>
          {body}
        </>
      ) : (
        body
      )}
    </section>
  );
}
