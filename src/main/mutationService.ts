import { BrowserWindow } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wildcardsBackupsDir } from '../domain/librarySidecarPaths.js';
import { IPC } from '../shared/contracts.js';
import { libraryService } from './libraryService.js';
import { folderWatcher } from './watcher.js';

/** A desired end-state for a path. `text: null` means the file should not exist. */
export type FileOp = { relativePath: string; text: string | null };

type FileSnapshot = { relativePath: string; existed: boolean; text: string | null };

export type MutationEntry = {
  id: string;
  label: string;
  timestamp: string;
  before: FileSnapshot[];
  after: FileSnapshot[];
  backupDir?: string;
  coalesceKey?: string;
  /** False when this mutation updated RAM only (disk still last save). */
  persist?: boolean;
};

export type HistoryState = {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
};

const MAX_HISTORY = 50;
let undoStack: MutationEntry[] = [];
let redoStack: MutationEntry[] = [];

function snapshot(relativePath: string): FileSnapshot {
  try {
    const { text } = libraryService.readFile(relativePath);
    return { relativePath, existed: true, text };
  } catch {
    return { relativePath, existed: false, text: null };
  }
}

function applyOp(op: FileOp, persist: boolean): void {
  if (op.text === null) {
    libraryService.deleteFile(op.relativePath);
    return;
  }
  if (persist) libraryService.writeFileText(op.relativePath, op.text);
  else libraryService.replaceMemoryText(op.relativePath, op.text);
}

function restore(snapshots: FileSnapshot[], persist: boolean): void {
  for (const snap of snapshots) {
    if (snap.existed && snap.text !== null) {
      const memoryOnlyStill =
        !persist && libraryService.hasUnsavedMemory(snap.relativePath);
      if (memoryOnlyStill) {
        libraryService.replaceMemoryText(snap.relativePath, snap.text);
      } else {
        libraryService.writeFileText(snap.relativePath, snap.text);
      }
    } else {
      libraryService.deleteFile(snap.relativePath);
    }
  }
}

/** Write the pre-mutation state of every changed file to a timestamped backup. */
function writeBackup(entry: MutationEntry): string | undefined {
  const root = libraryService.getRoot();
  if (!root) return undefined;
  try {
    const rootHash = crypto
      .createHash('sha1')
      .update(root.toLowerCase())
      .digest('hex')
      .slice(0, 12);
    const stamp = entry.timestamp.replace(/[:.]/g, '-');
    const dir = path.join(
      wildcardsBackupsDir(root),
      rootHash,
      `${stamp}_${entry.id}`,
    );
    fs.mkdirSync(dir, { recursive: true });
    for (const snap of entry.before) {
      if (!snap.existed || snap.text === null) continue;
      const dest = path.join(dir, snap.relativePath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, snap.text, 'utf8');
    }
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      `${JSON.stringify(
        {
          id: entry.id,
          label: entry.label,
          timestamp: entry.timestamp,
          root,
          files: entry.before.map((s) => ({
            relativePath: s.relativePath,
            existedBefore: s.existed,
          })),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    return dir;
  } catch {
    // Backup is best-effort; never block the mutation on backup failure.
    return undefined;
  }
}

export type MutateBroadcastOptions = {
  /** True when this write came from the in-app editor save/autosave. */
  editorSave?: boolean;
  /** Mutation updated RAM only — disk still has the last save. */
  memoryOnly?: boolean;
  /** Undo/redo: renderer should adopt memory over the live buffer. */
  authoritative?: boolean;
};

function broadcastMutated(
  relativePaths: string[],
  options?: MutateBroadcastOptions,
): void {
  const unique = [...new Set(relativePaths.map((p) => p.replace(/\\/g, '/')))];
  if (unique.length === 0) return;
  const payload = {
    relativePaths: unique,
    history: historyState(),
    ...(options?.editorSave ? { editorSave: true as const } : {}),
    ...(options?.memoryOnly ? { memoryOnly: true as const } : {}),
    ...(options?.authoritative ? { authoritative: true as const } : {}),
  };
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(IPC.libraryMutated, payload);
    } catch {
      // ignore
    }
  }
}

/**
 * Notify renderers that paths changed on disk without writing (e.g. editor
 * save lost a race to an external append — disk already correct).
 */
export function notifyLibraryMutated(
  relativePaths: string[],
  options?: MutateBroadcastOptions,
): void {
  broadcastMutated(relativePaths, options);
}

/**
 * Apply a set of file operations as one undoable, backed-up mutation.
 * Duplicate paths are collapsed (last op wins) so snapshots stay consistent.
 */
export function applyMutation(
  label: string,
  ops: FileOp[],
  options?: { coalesceKey?: string; editorSave?: boolean; persist?: boolean },
): HistoryState {
  const byPath = new Map<string, FileOp>();
  for (const op of ops) byPath.set(op.relativePath, op);
  const finalOps = [...byPath.values()];
  if (finalOps.length === 0) return historyState();

  const persist = options?.persist !== false;

  // Prevent the folder watcher from triggering a renderer refresh that would
  // flush a stale editor draft over this write.
  if (persist) folderWatcher.suppressChanges();

  const previous = undoStack[undoStack.length - 1];
  const canCoalesce =
    Boolean(options?.coalesceKey) &&
    previous?.coalesceKey === options?.coalesceKey &&
    previous.after.length === finalOps.length &&
    previous.after.every((snap) =>
      finalOps.some((op) => op.relativePath === snap.relativePath),
    );
  const broadcastOpts: MutateBroadcastOptions = {
    ...(options?.editorSave ? { editorSave: true as const } : {}),
    ...(!persist ? { memoryOnly: true as const } : {}),
  };
  if (canCoalesce && previous) {
    previous.after = finalOps.map((op) => ({
      relativePath: op.relativePath,
      existed: op.text !== null,
      text: op.text,
    }));
    previous.persist = persist;
    for (const op of finalOps) applyOp(op, persist);
    redoStack = [];
    const state = historyState();
    broadcastMutated(
      finalOps.map((op) => op.relativePath),
      broadcastOpts,
    );
    return state;
  }

  const entry: MutationEntry = {
    id: crypto.randomUUID().slice(0, 8),
    label,
    timestamp: new Date().toISOString(),
    before: finalOps.map((op) => snapshot(op.relativePath)),
    after: finalOps.map((op) => ({
      relativePath: op.relativePath,
      existed: op.text !== null,
      text: op.text,
    })),
    coalesceKey: options?.coalesceKey,
    persist,
  };

  entry.backupDir = writeBackup(entry);
  for (const op of finalOps) applyOp(op, persist);

  undoStack.push(entry);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  const state = historyState();
  broadcastMutated(
    finalOps.map((op) => op.relativePath),
    broadcastOpts,
  );
  return state;
}

function undoRedoBroadcast(
  relativePaths: string[],
  persist: boolean,
): void {
  const memoryOnly =
    !persist &&
    relativePaths.some((p) => libraryService.hasUnsavedMemory(p));
  broadcastMutated(relativePaths, {
    authoritative: true,
    ...(memoryOnly ? { memoryOnly: true as const } : {}),
  });
}

export function undo(): { entry: MutationEntry | null; state: HistoryState } {
  const entry = undoStack.pop();
  if (!entry) return { entry: null, state: historyState() };
  const persist = entry.persist !== false;
  if (persist) folderWatcher.suppressChanges();
  restore(entry.before, persist);
  redoStack.push(entry);
  const state = historyState();
  undoRedoBroadcast(
    entry.before.map((s) => s.relativePath),
    persist,
  );
  return { entry, state };
}

export function redo(): { entry: MutationEntry | null; state: HistoryState } {
  const entry = redoStack.pop();
  if (!entry) return { entry: null, state: historyState() };
  const persist = entry.persist !== false;
  if (persist) folderWatcher.suppressChanges();
  restore(entry.after, persist);
  undoStack.push(entry);
  const state = historyState();
  undoRedoBroadcast(
    entry.after.map((s) => s.relativePath),
    persist,
  );
  return { entry, state };
}

export function historyState(): HistoryState {
  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoLabel: undoStack[undoStack.length - 1]?.label,
    redoLabel: redoStack[redoStack.length - 1]?.label,
  };
}

/** Clear session history (e.g. when a different library is opened). */
export function resetHistory(): void {
  undoStack = [];
  redoStack = [];
}
