import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { ClipboardCopy, Crosshair, FolderOpen, Loader2, Trash2 } from 'lucide-react';
import type { GenerationProgressDto } from '../shared/contracts';
import { noteGenerationStatus } from './generationRun';

const ACTIVE = new Set(['starting', 'queued', 'running', 'saving']);

export type HeldGenerationPreview = {
  url: string;
  prompt?: string;
  negative?: string;
  relativeFolder?: string | null;
  seed?: number | null;
};

let progressSnapshot: GenerationProgressDto | null = null;
let heldSnapshot: HeldGenerationPreview | null = null;
const progressListeners = new Set<() => void>();
const previewListeners = new Set<() => void>();

function emitProgress(): void {
  for (const listener of progressListeners) listener();
}

function emitPreview(): void {
  for (const listener of previewListeners) listener();
}

function heldEquals(
  prev: HeldGenerationPreview | null,
  next: HeldGenerationPreview,
): boolean {
  if (!prev) return false;
  return (
    prev.url === next.url &&
    prev.prompt === next.prompt &&
    prev.negative === next.negative &&
    prev.relativeFolder === next.relativeFolder &&
    prev.seed === next.seed
  );
}

/** Progress for the status line. Does not redraw the generation form. */
export function publishGenerationProgress(progress: GenerationProgressDto): void {
  progressSnapshot = progress;
  noteGenerationStatus(progress.status);
  emitProgress();
  if (!progress.lastImageUrl) return;
  const next: HeldGenerationPreview = {
    url: progress.lastImageUrl,
    prompt: progress.lastPrompt,
    negative: progress.lastNegativePrompt,
    relativeFolder: progress.lastRelativeFolder,
    seed: progress.lastSeed,
  };
  if (heldEquals(heldSnapshot, next)) return;
  heldSnapshot = next;
  emitPreview();
}

export function rememberGenerationPreview(preview: HeldGenerationPreview): void {
  if (heldEquals(heldSnapshot, preview)) return;
  heldSnapshot = preview;
  emitPreview();
}

export function clearHeldGenerationPreview(): void {
  if (!heldSnapshot) return;
  heldSnapshot = null;
  emitPreview();
}

function subscribeProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

function subscribePreview(listener: () => void): () => void {
  previewListeners.add(listener);
  return () => {
    previewListeners.delete(listener);
  };
}

function getProgressSnapshot(): GenerationProgressDto | null {
  return progressSnapshot;
}

function getPreviewSnapshot(): HeldGenerationPreview | null {
  return heldSnapshot;
}

function useGenerationProgress(): GenerationProgressDto | null {
  return useSyncExternalStore(subscribeProgress, getProgressSnapshot);
}

function useHeldGenerationPreview(): HeldGenerationPreview | null {
  return useSyncExternalStore(subscribePreview, getPreviewSnapshot);
}

function promptCategoryBreadcrumb(
  relativeFolder: string | null | undefined,
): string {
  const cleaned = (relativeFolder ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '');
  if (!cleaned || cleaned === '_manual') return '';
  return cleaned.split('/').filter(Boolean).join(' › ');
}

export function GenerationJobStatus({
  onApplySeed,
}: {
  onApplySeed: (seed: number) => void;
}) {
  const progress = useGenerationProgress();
  if (!progress) return null;
  const active = ACTIVE.has(progress.status);
  const liveSeed =
    active &&
    typeof progress.seed === 'number' &&
    Number.isFinite(progress.seed)
      ? progress.seed >>> 0
      : null;
  return (
    <>
      <p className="hint generation-progress-hint">
        {active ? <Loader2 size={12} className="spin" /> : null}{' '}
        {progress.status === 'starting'
          ? (progress.detail ?? 'Starting ComfyUI…')
          : progress.status}
        {progress.jobsCompleted ? ` · ${progress.jobsCompleted} done` : ''}
        {progress.benchmarkStem
          ? ` · ${progress.benchmarkStem} (${progress.benchmarkImageCount ?? 0}/${progress.benchmarkTargetImages ?? 10})`
          : ''}
        {liveSeed != null ? (
          <>
            {' · seed '}
            <span className="mono">{liveSeed}</span>
            <button
              type="button"
              className="icon-btn generation-seed-fill-btn"
              title="Set Seed to this value"
              aria-label="Set Seed to this value"
              onClick={() => onApplySeed(liveSeed)}
            >
              <Crosshair size={12} />
            </button>
          </>
        ) : null}
      </p>
      {progress.error ? <p className="error-text">{progress.error}</p> : null}
    </>
  );
}

export function GenerationFolderLiveHint({
  selectedFolder,
  onApplySeed,
}: {
  selectedFolder: string | null;
  onApplySeed: (seed: number) => void;
}) {
  const progress = useGenerationProgress();
  const active = progress != null && ACTIVE.has(progress.status);
  const crumb = active ? promptCategoryBreadcrumb(progress.relativeFolder) : '';
  const liveSeed =
    active &&
    typeof progress.seed === 'number' &&
    Number.isFinite(progress.seed)
      ? progress.seed >>> 0
      : null;
  return (
    <p className="hint generation-folder-hint">
      {crumb || (active && !selectedFolder) ? (
        <>
          <span>
            {crumb
              ? `Generating “${crumb}”…`
              : 'Generating… (picking folder)'}
            {liveSeed != null ? ` · seed ${liveSeed}` : ''}
          </span>
          {liveSeed != null ? (
            <button
              type="button"
              className="icon-btn generation-seed-fill-btn"
              title="Set Seed to this value"
              aria-label="Set Seed to this value"
              onClick={() => onApplySeed(liveSeed)}
            >
              <Crosshair size={12} />
            </button>
          ) : null}
        </>
      ) : selectedFolder ? (
        `Folder mode uses lines from ${selectedFolder}/!gen.txt. Your typed prompt above is kept for “Use this prompt”.`
      ) : (
        'Select… [Randomize] picks a different !gen.txt folder on every run.'
      )}
    </p>
  );
}

export function GenerationPreviewActions({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const held = useHeldGenerationPreview();
  const [deleting, setDeleting] = useState(false);
  if (!held) return null;
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        title="Reveal in My File Explorer"
        aria-label="Reveal in My File Explorer"
        onClick={() => {
          void window.wcm.comfy.revealLastGeneration().catch((e) => {
            onError(e instanceof Error ? e.message : String(e));
          });
        }}
      >
        <FolderOpen size={14} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Delete last generation"
        aria-label="Delete last generation"
        disabled={deleting}
        onClick={() => {
          if (deleting) return;
          setDeleting(true);
          onError(null);
          void window.wcm.comfy
            .deleteLastGeneration()
            .then((result) => {
              if (result.deleted) clearHeldGenerationPreview();
            })
            .catch((e) => {
              onError(e instanceof Error ? e.message : String(e));
            })
            .finally(() => {
              setDeleting(false);
            });
        }}
      >
        {deleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
      </button>
    </>
  );
}

export function GenerationPreviewBody({
  seedMode,
  onApplySeed,
  onError,
  empty,
}: {
  seedMode: 'apply' | 'copy';
  onApplySeed?: (seed: number) => void;
  onError?: (message: string) => void;
  empty?: ReactNode;
}) {
  const held = useHeldGenerationPreview();
  if (!held) return empty ?? null;
  const crumb = promptCategoryBreadcrumb(held.relativeFolder);
  const seed =
    typeof held.seed === 'number' && Number.isFinite(held.seed)
      ? held.seed >>> 0
      : null;
  const showMeta = Boolean(held.prompt || held.negative || crumb || seed != null);
  return (
    <div className="generation-preview">
      <img src={held.url} alt="Last generation" />
      {showMeta ? (
        <div className="generation-preview-prompts">
          {crumb ? (
            <div className="generation-preview-prompt">
              <span className="generation-preview-prompt-label">Category</span>
              <div
                className="generation-preview-prompt-value generation-preview-category"
                title={held.relativeFolder ?? undefined}
              >
                {crumb}
              </div>
            </div>
          ) : null}
          {seed != null ? (
            <div className="generation-preview-prompt">
              <span className="generation-preview-prompt-label">Seed</span>
              <div className="generation-preview-seed-row">
                <div className="generation-preview-prompt-value generation-preview-seed">
                  {seed}
                </div>
                {seedMode === 'apply' && onApplySeed ? (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Set Seed to this value"
                    aria-label="Set Seed to this value"
                    onClick={() => onApplySeed(seed)}
                  >
                    <Crosshair size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Copy seed"
                    aria-label="Copy seed"
                    onClick={() => {
                      void navigator.clipboard.writeText(String(seed)).catch((e) => {
                        onError?.(e instanceof Error ? e.message : String(e));
                      });
                    }}
                  >
                    <ClipboardCopy size={14} />
                  </button>
                )}
              </div>
            </div>
          ) : null}
          {held.prompt ? (
            <div className="generation-preview-prompt">
              <span className="generation-preview-prompt-label">Positive</span>
              <div className="generation-preview-prompt-value">{held.prompt}</div>
            </div>
          ) : null}
          {held.negative ? (
            <div className="generation-preview-prompt">
              <span className="generation-preview-prompt-label">Negative</span>
              <div className="generation-preview-prompt-value">{held.negative}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
