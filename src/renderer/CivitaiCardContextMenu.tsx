import {
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Archive,
  ArchiveRestore,
  Ban,
  Bell,
  Bookmark,
  BookmarkMinus,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderOpen,
  X,
} from 'lucide-react';
import type {
  CivitaiModelCardDto,
  CivitaiModelTypeDto,
} from '../shared/contracts.js';
import { isEarlyAccessActive } from '../domain/civitaiEarlyAccess.js';

export type CivitaiCardContextMenuState = {
  item: CivitaiModelCardDto;
  context: CivitaiCardMenuContext;
  typeHint?: CivitaiModelTypeDto;
  x: number;
  y: number;
};

export type CivitaiCardMenuContext =
  | 'browse'
  | 'queued'
  | 'downloaded'
  | 'maybe'
  | 'archive'
  | 'notify';

type Props = {
  menu: CivitaiCardContextMenuState;
  canDownload: boolean;
  downloading: boolean;
  queued: boolean;
  onClose: () => void;
  onNotify: (item: CivitaiModelCardDto) => void;
  onDownload: (
    item: CivitaiModelCardDto,
    opts: { skipConfirm: boolean },
  ) => void;
  onMarkInstalled: (item: CivitaiModelCardDto) => void;
  onUnmarkInstalled: (item: CivitaiModelCardDto) => void;
  onRevealLocal: (item: CivitaiModelCardDto, type: CivitaiModelTypeDto) => void;
  onMaybe: (item: CivitaiModelCardDto) => void;
  onArchive: (item: CivitaiModelCardDto) => void;
  onRestore: (item: CivitaiModelCardDto) => void;
  onCancelQueue: (modelId: number) => void;
  onOpenExternal: (item: CivitaiModelCardDto) => void;
  onBlockAuthor: (item: CivitaiModelCardDto) => void;
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

/** Open a positioned context menu for a Civitai model card. */
export function openCivitaiCardContextMenu(
  item: CivitaiModelCardDto,
  event: ReactMouseEvent,
  context: CivitaiCardMenuContext,
  typeHint?: CivitaiModelTypeDto,
): CivitaiCardContextMenuState {
  event.preventDefault();
  event.stopPropagation();
  return {
    item,
    context,
    typeHint,
    ...menuPosition(event.clientX, event.clientY, 260, 420),
  };
}

export function CivitaiCardContextMenu({
  menu,
  canDownload,
  downloading,
  queued,
  onClose,
  onNotify,
  onDownload,
  onMarkInstalled,
  onUnmarkInstalled,
  onRevealLocal,
  onMaybe,
  onArchive,
  onRestore,
  onCancelQueue,
  onOpenExternal,
  onBlockAuthor,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const item = menu.item;
  const dlType = menu.typeHint ?? (item.type === 'Checkpoint' ? 'Checkpoint' : 'LORA');
  const stillEarlyAccess = isEarlyAccessActive(
    item.earlyAccess,
    item.earlyAccessEndsAt,
  );
  const showMarkInstalled =
    !item.installed && item.potentialLocalMatches.length > 0;
  const localMatches = item.localInstallMatches ?? [];
  const creator = item.creator?.trim() ?? '';

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

  const runThenClose = (action: () => void | Promise<void>) => {
    onClose();
    void Promise.resolve(action());
  };

  return (
    <div
      ref={ref}
      className="file-context-menu civitai-card-context-menu"
      role="menu"
      aria-label={`Actions for ${item.name}`}
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="file-context-menu-title" title={item.name}>
        {item.name}
      </div>

      <button
        type="button"
        role="menuitem"
        disabled={!stillEarlyAccess}
        onClick={() => runThenClose(() => onNotify(item))}
      >
        <Bell size={14} /> Notify me
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={
          !item.hasDownloadableVersion || downloading || queued || !canDownload
        }
        onClick={() =>
          runThenClose(() => onDownload(item, { skipConfirm: false }))
        }
      >
        <Download size={14} />{' '}
        {downloading
          ? 'Downloading…'
          : queued
            ? 'Queued'
            : stillEarlyAccess || item.hasUninstalledVersion
              ? 'Download version'
              : 'Download'}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!showMarkInstalled}
        onClick={() => runThenClose(() => onMarkInstalled(item))}
      >
        <CheckCircle2 size={14} /> Mark as installed
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!item.markedInstalled}
        onClick={() => runThenClose(() => onUnmarkInstalled(item))}
      >
        <X size={14} /> Unmark installed
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={localMatches.length === 0}
        onClick={() => runThenClose(() => onRevealLocal(item, dlType))}
      >
        <FolderOpen size={14} /> Reveal local file
      </button>

      <div className="file-context-menu-separator" />

      {menu.context === 'archive' ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => runThenClose(() => onMaybe(item))}
          >
            <Bookmark size={14} /> Move to Maybe
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runThenClose(() => onRestore(item))}
          >
            <ArchiveRestore size={14} /> Restore to Browse
          </button>
        </>
      ) : menu.context === 'maybe' ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => runThenClose(() => onRestore(item))}
          >
            <BookmarkMinus size={14} /> Remove from Maybe
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runThenClose(() => onArchive(item))}
          >
            <Archive size={14} /> Move to Archive
          </button>
        </>
      ) : menu.context === 'queued' ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => runThenClose(() => onCancelQueue(item.id))}
        >
          <X size={14} />{' '}
          {downloading ? 'Cancel download' : 'Remove from queue'}
        </button>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              runThenClose(() =>
                item.maybe ? onRestore(item) : onMaybe(item),
              )
            }
          >
            {item.maybe ? (
              <>
                <BookmarkMinus size={14} /> Remove from Maybe
              </>
            ) : (
              <>
                <Bookmark size={14} /> Maybe later
              </>
            )}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              runThenClose(() =>
                item.archived ? onRestore(item) : onArchive(item),
              )
            }
          >
            {item.archived ? (
              <>
                <ArchiveRestore size={14} /> Unarchive
              </>
            ) : (
              <>
                <Archive size={14} /> Archive
              </>
            )}
          </button>
        </>
      )}

      <button
        type="button"
        role="menuitem"
        onClick={() => runThenClose(() => onOpenExternal(item))}
      >
        <ExternalLink size={14} /> Open in browser
      </button>

      <div className="file-context-menu-separator" />

      <button
        type="button"
        role="menuitem"
        className="danger-text"
        disabled={!creator}
        title={
          creator
            ? `Hide this card and future cards by ${creator}`
            : 'No author listed on this card'
        }
        onClick={() => runThenClose(() => onBlockAuthor(item))}
      >
        <Ban size={14} /> Block this Author
      </button>
    </div>
  );
}
