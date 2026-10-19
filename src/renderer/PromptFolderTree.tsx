import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { PromptFolderNodeDto, PromptTreeDto } from '../shared/contracts';

export type PromptFolderIssueCounts = {
  errorCount: number;
  warningCount: number;
};

export type PromptFolderContextMenuState = {
  relativePath: string;
  name: string;
  x: number;
  y: number;
};

type FolderActions = {
  renamingPath: string | null;
  expandToPath?: string | null;
  onContextMenu: (
    relativePath: string,
    name: string,
    event: ReactMouseEvent,
  ) => void;
  /** Return `false` to keep the inline rename field open (e.g. validation error). */
  onCommitRename: (
    relativePath: string,
    newName: string,
  ) => boolean | void | Promise<boolean | void>;
  onCancelRename: () => void;
};

function subtreeHasIssues(
  node: PromptFolderNodeDto,
  issues: ReadonlyMap<string, PromptFolderIssueCounts>,
): boolean {
  const row = issues.get(node.relativePath);
  if (row && (row.errorCount > 0 || row.warningCount > 0)) return true;
  return node.children.some((child) => subtreeHasIssues(child, issues));
}

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

export function openPromptFolderContextMenu(
  relativePath: string,
  name: string,
  event: ReactMouseEvent,
): PromptFolderContextMenuState {
  event.preventDefault();
  event.stopPropagation();
  return {
    relativePath,
    name,
    ...menuPosition(event.clientX, event.clientY, 240, 188),
  };
}

function useDismissibleMenu(
  onClose: () => void,
  ref: RefObject<HTMLDivElement | null>,
) {
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
  }, [onClose, ref]);
}

export function PromptFolderContextMenu({
  menu,
  onClose,
  onUseForGeneration,
  onRename,
  onAddSubfolder,
  onDelete,
}: {
  menu: PromptFolderContextMenuState;
  onClose: () => void;
  onUseForGeneration: () => void;
  onRename: () => void;
  onAddSubfolder: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDismissibleMenu(onClose, ref);

  return (
    <div
      ref={ref}
      className="file-context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="file-context-menu-title" title={menu.relativePath}>
        {menu.name}
      </div>
      <button
        type="button"
        role="menuitem"
        title="Set this folder in Generation. Does not start a run. The next Infinite image uses it."
        onClick={() => {
          onClose();
          onUseForGeneration();
        }}
      >
        <FolderInput size={14} /> Generate this folder
      </button>
      <div className="file-context-menu-separator" />
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onRename();
        }}
      >
        <Pencil size={14} /> Rename
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onAddSubfolder();
        }}
      >
        <FolderPlus size={14} /> Add sub-folder
      </button>
      <div className="file-context-menu-separator" />
      <button
        type="button"
        role="menuitem"
        className="danger-text"
        onClick={() => {
          onClose();
          onDelete();
        }}
      >
        <Trash2 size={14} /> Delete…
      </button>
    </div>
  );
}

export type PromptRootContextMenuState = { x: number; y: number };

export function openPromptRootContextMenu(
  event: ReactMouseEvent,
): PromptRootContextMenuState {
  event.preventDefault();
  event.stopPropagation();
  return menuPosition(event.clientX, event.clientY, 200, 80);
}

export function PromptRootContextMenu({
  menu,
  onClose,
  onAddFolder,
}: {
  menu: PromptRootContextMenuState;
  onClose: () => void;
  onAddFolder: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDismissibleMenu(onClose, ref);

  return (
    <div
      ref={ref}
      className="file-context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="file-context-menu-title">Prompts root</div>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          onAddFolder();
        }}
      >
        <FolderPlus size={14} /> Add folder
      </button>
    </div>
  );
}

function PromptFolderRenameInput({
  initialName,
  onCommit,
  onCancel,
}: {
  initialName: string;
  onCommit: (name: string) => boolean | void | Promise<boolean | void>;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(initialName);
  const committed = useRef(false);
  const saving = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = async () => {
    if (committed.current || saving.current) return;
    const next = value.trim();
    if (!next || next === initialName) {
      committed.current = true;
      onCancel();
      return;
    }
    saving.current = true;
    try {
      const ok = await onCommit(next);
      if (ok === false) {
        window.setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      committed.current = true;
    } finally {
      saving.current = false;
    }
  };

  const cancel = () => {
    if (committed.current || saving.current) return;
    committed.current = true;
    onCancel();
  };

  return (
    <form
      className="prompt-tree-rename-form"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void commit();
      }}
    >
      <input
        ref={inputRef}
        className="prompt-tree-rename-input"
        value={value}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
        }}
      />
    </form>
  );
}

export function PromptFolderTreeNode({
  node,
  depth,
  selected,
  onSelect,
  issues,
  issuesOnly = false,
  folderActions,
}: {
  node: PromptFolderNodeDto;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
  issues?: ReadonlyMap<string, PromptFolderIssueCounts>;
  issuesOnly?: boolean;
  folderActions?: FolderActions;
}) {
  const row = issues?.get(node.relativePath);
  const hasErrors = (row?.errorCount ?? 0) > 0;
  const hasWarnings = (row?.warningCount ?? 0) > 0;
  const showBranch =
    !issuesOnly || !issues || subtreeHasIssues(node, issues);
  const [open, setOpen] = useState(depth < 1);
  const active = selected === node.relativePath;
  const renaming = folderActions?.renamingPath === node.relativePath;
  const expandTo = folderActions?.expandToPath;

  useEffect(() => {
    if (issues && subtreeHasIssues(node, issues)) setOpen(true);
  }, [issues, node]);

  useEffect(() => {
    if (!expandTo) return;
    if (
      expandTo === node.relativePath ||
      expandTo.startsWith(`${node.relativePath}/`)
    ) {
      setOpen(true);
    }
  }, [expandTo, node.relativePath]);

  if (!showBranch) return null;

  const showTwist =
    node.children.length > 0 ||
    (expandTo?.startsWith(`${node.relativePath}/`) ?? false);

  return (
    <div className="prompt-tree-node">
      <div
        className={`prompt-tree-row${active ? ' active' : ''}${
          hasErrors ? ' has-errors' : hasWarnings ? ' has-warnings' : ''
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={
          row
            ? `${node.relativePath}/!gen.txt · ${row.errorCount} error(s), ${row.warningCount} warning(s)`
            : node.relativePath
        }
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!renaming) onSelect(node.relativePath);
        }}
        onKeyDown={(event) => {
          if (renaming) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(node.relativePath);
          }
        }}
        onContextMenu={
          folderActions
            ? (event) =>
                folderActions.onContextMenu(
                  node.relativePath,
                  node.name,
                  event,
                )
            : undefined
        }
      >
        {showTwist ? (
          <span
            className="prompt-tree-twist"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : (
          <span className="prompt-tree-twist" />
        )}
        {renaming && folderActions ? (
          <PromptFolderRenameInput
            initialName={node.name}
            onCommit={(name) =>
              folderActions.onCommitRename(node.relativePath, name)
            }
            onCancel={folderActions.onCancelRename}
          />
        ) : (
          <span className="prompt-tree-label">{node.name}</span>
        )}
        <span className="prompt-tree-meta">
          {row && (row.errorCount > 0 || row.warningCount > 0)
            ? `${row.errorCount}E/${row.warningCount}W`
            : node.hasGenFile
              ? 'gen'
              : '—'}
          {' · '}
          {node.imageCount}
        </span>
      </div>
      {open
        ? node.children.map((child) => (
            <PromptFolderTreeNode
              key={child.relativePath}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              issues={issues}
              issuesOnly={issuesOnly}
              folderActions={folderActions}
            />
          ))
        : null}
    </div>
  );
}

/** Same folder tree as the Prompts tab (root path + nested folders). */
export function PromptFolderTree({
  tree,
  selected,
  onSelect,
  issues,
  issuesOnly = false,
  emptyHint = 'Set a Prompts folder in Library Manager to begin.',
  folderActions,
  onRootContextMenu,
  onAddRootFolder,
}: {
  tree: PromptTreeDto;
  selected: string | null;
  onSelect: (path: string) => void;
  issues?: ReadonlyMap<string, PromptFolderIssueCounts>;
  issuesOnly?: boolean;
  emptyHint?: string;
  folderActions?: FolderActions;
  /** Right-click the root path row (e.g. Add folder at root). */
  onRootContextMenu?: (event: ReactMouseEvent) => void;
  /** Icon button to the right of the root path. */
  onAddRootFolder?: () => void;
}) {
  if (!tree.root) {
    return <p className="hint pad">{emptyHint}</p>;
  }
  return (
    <div className="prompt-tree">
      <div
        className="prompt-tree-root"
        onContextMenu={onRootContextMenu}
      >
        <p className="hint pad mono-path" title={tree.root}>
          <FolderOpen size={12} /> {tree.root}
        </p>
        {onAddRootFolder ? (
          <button
            type="button"
            className="icon-btn prompt-tree-root-add"
            title="Add folder"
            aria-label="Add folder"
            onClick={(event) => {
              event.stopPropagation();
              onAddRootFolder();
            }}
          >
            <Plus size={14} />
          </button>
        ) : null}
      </div>
      {tree.folders.map((node) => (
        <PromptFolderTreeNode
          key={node.relativePath}
          node={node}
          depth={0}
          selected={selected}
          onSelect={onSelect}
          issues={issues}
          issuesOnly={issuesOnly}
          folderActions={folderActions}
        />
      ))}
    </div>
  );
}
