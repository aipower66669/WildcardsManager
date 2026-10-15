import {
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  ClipboardCopy,
  Copy,
  ExternalLink,
  Eye,
  FolderOpen,
  Hash,
  Link2,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { ModelFileManagerEntryDto } from '../shared/contracts.js';
import {
  buildLoraClipboardSnippet,
  parseCivitaiModelPageUrl,
} from '../domain/civitaiSnippet.js';

export type ModelFileContextMenuState = {
  file: ModelFileManagerEntryDto;
  x: number;
  y: number;
};

type Props = {
  menu: ModelFileContextMenuState;
  kind: 'LORA' | 'Checkpoint';
  onClose: () => void;
  onSelect: (relativePath: string) => void;
  onRename?: (stem: string) => void;
  onError?: (message: string) => void;
  onDeleteCheckpoint?: (
    file: ModelFileManagerEntryDto,
    skipConfirm: boolean,
  ) => void;
  onDeleteLora?: (
    file: ModelFileManagerEntryDto,
    skipConfirm: boolean,
  ) => void;
};

function menuPosition(
  clientX: number,
  clientY: number,
  menuWidth: number,
  menuHeight: number,
): { x: number; y: number } {
  return {
    x: Math.max(8, Math.min(clientX, window.innerWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(clientY, window.innerHeight - menuHeight - 8)),
  };
}

/** Open a positioned context menu for a model list row. */
export function openModelFileContextMenu(
  file: ModelFileManagerEntryDto,
  event: ReactMouseEvent,
  kind: 'LORA' | 'Checkpoint',
): ModelFileContextMenuState {
  event.preventDefault();
  event.stopPropagation();
  const menuHeight = kind === 'LORA' ? 520 : 420;
  return {
    file,
    ...menuPosition(event.clientX, event.clientY, 260, menuHeight),
  };
}

export function ModelFileContextMenu({
  menu,
  kind,
  onClose,
  onSelect,
  onRename,
  onError,
  onDeleteCheckpoint,
  onDeleteLora,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const file = menu.file;
  const hasCivitai = Boolean(file.civitaiModelId && file.civitaiPageUrl);
  const hasHash = Boolean(file.autoV2);

  useEffect(() => {
    const close = (event: Event) => {
      if (
        event.type === 'pointerdown' &&
        ref.current?.contains(event.target as globalThis.Node)
      ) {
        return;
      }
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', closeOnEscape);
    window.setTimeout(() => {
      ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }, 0);

    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  const reportError = (err: unknown) => {
    onError?.(err instanceof Error ? err.message : String(err));
  };

  const copyText = (text: string) => {
    onClose();
    void navigator.clipboard.writeText(text).catch(reportError);
  };

  const runThenClose = (action: () => void | Promise<void>) => {
    onClose();
    void Promise.resolve(action()).catch(reportError);
  };

  return (
    <div
      ref={ref}
      className="file-context-menu"
      role="menu"
      aria-label={`Actions for ${file.relativePath}`}
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="file-context-menu-title">{file.relativePath}</div>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onSelect(file.relativePath);
        }}
      >
        <Eye size={14} /> Open details
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() =>
          runThenClose(() =>
            window.wcm.modelFiles.showInFolder(file.absolutePath),
          )
        }
      >
        <FolderOpen size={14} /> Reveal in My File Explorer
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() =>
          runThenClose(() =>
            window.wcm.modelFiles.openExternal(file.absolutePath),
          )
        }
      >
        <ExternalLink size={14} /> Open externally
      </button>

      {hasCivitai ? (
        <>
          <div className="file-context-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              runThenClose(() =>
                window.wcm.civitai.openModelPage(
                  file.civitaiModelId!,
                  file.civitaiName ?? file.stem,
                ),
              )
            }
          >
            <ExternalLink size={14} /> Open Civitai page
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => copyText(file.civitaiPageUrl!)}
          >
            <Link2 size={14} /> Copy Civitai URL
          </button>
        </>
      ) : null}

      <div className="file-context-menu-separator" role="separator" />

      {kind === 'LORA' ? (
        <>
          <button
            type="button"
            role="menuitem"
            title="Copy your documented wildcard block (# URL / notes + <lora:…>), or a generated Civitai snippet if none exists"
            onClick={() => {
              onClose();
              void (async () => {
                try {
                  const defined =
                    await window.wcm.modelFiles.getDefinedLoraReference(
                      file.relativePath,
                    );
                  if (defined?.block) {
                    await navigator.clipboard.writeText(defined.block);
                    return;
                  }
                  if (!file.civitaiModelId || !file.civitaiPageUrl) {
                    throw new Error(
                      'No documented wildcard reference for this LoRA yet',
                    );
                  }
                  const parsed = parseCivitaiModelPageUrl(file.civitaiPageUrl);
                  const origin = parsed?.origin ?? 'https://civitai.com';
                  await navigator.clipboard.writeText(
                    buildLoraClipboardSnippet({
                      origin,
                      modelId: file.civitaiModelId,
                      modelName: file.civitaiName ?? file.stem,
                      fileStem: file.stem,
                      trainedWords: file.civitaiTrainedWords,
                    }),
                  );
                } catch (err) {
                  reportError(err);
                }
              })();
            }}
          >
            <ClipboardCopy size={14} /> Copy reference
          </button>
          <button
            type="button"
            role="menuitem"
            title="Copy the <lora:…> tag from your documented wildcard definition (weight range), not a generic :1"
            onClick={() => {
              onClose();
              void (async () => {
                try {
                  const defined =
                    await window.wcm.modelFiles.getDefinedLoraReference(
                      file.relativePath,
                    );
                  await navigator.clipboard.writeText(
                    defined?.tag ?? `<lora:${file.stem}:1>`,
                  );
                } catch (err) {
                  reportError(err);
                }
              })();
            }}
          >
            <ClipboardCopy size={14} /> Copy LoRA tag
          </button>
        </>
      ) : null}
      <button
        type="button"
        role="menuitem"
        onClick={() => copyText(file.stem)}
      >
        <Copy size={14} /> Copy name
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => copyText(file.relativePath)}
      >
        <Copy size={14} /> Copy relative path
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => copyText(file.absolutePath)}
      >
        <Copy size={14} /> Copy absolute path
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!hasHash}
        onClick={() => {
          if (!file.autoV2) return;
          copyText(file.autoV2);
        }}
      >
        <Hash size={14} /> Copy AutoV2 hash
      </button>

      {kind === 'LORA' && onRename ? (
        <>
          <div className="file-context-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onRename(file.stem);
            }}
          >
            <Pencil size={14} /> Rename on disk…
          </button>
        </>
      ) : null}

      {kind === 'LORA' && onDeleteLora ? (
        <>
          <div className="file-context-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            title="Hold Shift to skip confirmation"
            onClick={(event) => {
              onClose();
              onDeleteLora(file, event.shiftKey);
            }}
          >
            <Trash2 size={14} /> Delete LoRA…
          </button>
        </>
      ) : null}

      {kind === 'Checkpoint' && onDeleteCheckpoint ? (
        <>
          <div className="file-context-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            title="Hold Shift to skip confirmation"
            onClick={(event) => {
              onClose();
              onDeleteCheckpoint(file, event.shiftKey);
            }}
          >
            <Trash2 size={14} /> Delete checkpoint…
          </button>
        </>
      ) : null}
    </div>
  );
}
