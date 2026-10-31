import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { history, historyField } from '@codemirror/commands';
import { describe, expect, it } from 'vitest';
import {
  editorExternalTextChange,
  editorExternalValueIsStale,
} from './editorExternalText';

function applyExternal(doc: string, head: number, next: string) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(head),
    extensions: [history()],
  });
  const change = editorExternalTextChange(doc, next);
  if (!change) return state;
  return state.update({
    changes: change,
    annotations: Transaction.addToHistory.of(false),
  }).state;
}

describe('editorExternalTextChange', () => {
  it('keeps a caret in the unchanged tail when the middle of the file changes', () => {
    const current = 'aaa YYY bbb';
    const next = 'aaa XXX bbb';
    const head = current.length;
    const state = applyExternal(current, head, next);
    expect(state.doc.toString()).toBe(next);
    expect(state.selection.main.head).toBe(next.length);
    expect(state.selection.main.head).not.toBe(0);
  });

  it('does not send a mid-file caret to offset 0', () => {
    const current = 'helloX world';
    const next = 'hello world';
    const state = applyExternal(current, 6, next);
    expect(state.doc.toString()).toBe(next);
    expect(state.selection.main.head).toBeGreaterThan(0);
  });

  it('leaves a save sync out of the undo stack', () => {
    let state = EditorState.create({
      doc: 'hello',
      selection: EditorSelection.cursor(5),
      extensions: [history()],
    });
    state = state.update({
      changes: { from: 5, insert: '!' },
      selection: EditorSelection.cursor(6),
      annotations: Transaction.userEvent.of('input.type'),
    }).state;
    const before = (state.field(historyField) as { done: unknown[] }).done
      .length;
    const change = editorExternalTextChange(state.doc.toString(), 'hello brave!');
    state = state.update({
      changes: change!,
      annotations: Transaction.addToHistory.of(false),
    }).state;
    expect(state.doc.toString()).toBe('hello brave!');
    expect(state.selection.main.head).toBe('hello brave!'.length);
    expect(
      (state.field(historyField) as { done: unknown[] }).done.length,
    ).toBe(before);
  });
});

describe('editorExternalValueIsStale', () => {
  it('treats a save snapshot as stale once another character has been typed', () => {
    expect(editorExternalValueIsStale('aaaXbbb', 'aaabbb', 'aaabbb')).toBe(
      true,
    );
  });

  it('applies a parent update while the document still matches the last commit', () => {
    expect(editorExternalValueIsStale('aaabbb', 'aaabbb', 'aaaXbbb')).toBe(
      false,
    );
  });

  it('skips work when the document already matches', () => {
    expect(editorExternalValueIsStale('aaaXbbb', 'aaabbb', 'aaaXbbb')).toBe(
      false,
    );
  });
});
