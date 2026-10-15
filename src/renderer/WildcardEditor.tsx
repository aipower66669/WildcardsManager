import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Decoration,
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import {
  Annotation,
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { openSearchPanel, searchKeymap } from '@codemirror/search';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  redoDepth,
  selectAll,
  undo,
  undoDepth,
} from '@codemirror/commands';
import {
  autocompletion,
  acceptCompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import {
  ClipboardCopy,
  ClipboardPaste,
  Crosshair,
  FilePlus,
  FolderOpen,
  Pencil,
  Redo2,
  Scissors,
  Sparkles,
  Undo2,
} from 'lucide-react';
import {
  findCivitaiModelUrlAbove,
  type ParsedCivitaiModelPageUrl,
} from '../domain/civitaiSnippet.js';
import { wildcardLanguage } from './wildcardLang';

/** Marks doc updates that come from React props, not the user. */
const externalValueAnnotation = Annotation.define<boolean>();

/**
 * Apply an external document update without yanking the caret/scroll when
 * possible. Prefers append/delete-suffix transactions so CodeMirror can map
 * the selection through the change.
 */
function applyExternalDocText(view: EditorView, text: string): void {
  const current = view.state.doc.toString();
  if (current === text) return;

  const scrollTop = view.scrollDOM.scrollTop;
  const scrollLeft = view.scrollDOM.scrollLeft;

  let changes: { from: number; to?: number; insert: string };
  if (text.startsWith(current)) {
    changes = { from: current.length, insert: text.slice(current.length) };
  } else if (current.startsWith(text)) {
    changes = { from: text.length, to: current.length, insert: '' };
  } else {
    changes = { from: 0, to: current.length, insert: text };
  }

  // Omit `selection` so CodeMirror maps the existing caret through `changes`.
  view.dispatch({
    changes,
    annotations: externalValueAnnotation.of(true),
  });

  view.scrollDOM.scrollTop = scrollTop;
  view.scrollDOM.scrollLeft = scrollLeft;
}

export type WildcardEditorHandle = {
  jumpToLine: (line: number, column?: number) => void;
  focus: () => void;
  getValue: () => string;
  /** Replace the document from outside (e.g. after a library rewrite), even if focused. */
  setExternalValue: (text: string) => void;
};

export type EditorWildcardTarget = {
  name: string;
  raw: string;
  /** True when the name resolves to an existing library key. */
  exists: boolean;
  /** Glob references cannot be created as a single file. */
  isGlob: boolean;
};

export type EditorLoraTarget = {
  name: string;
  raw: string;
  /** Civitai model from the comment URL on the line(s) above, if any. */
  civitai?: ParsedCivitaiModelPageUrl;
};

type Props = {
  value: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  readOnly?: boolean;
  /** File extension used to pick a highlighter (.txt / .yaml / .json). */
  fileExt?: string;
  /** Addressable keys offered after an opening `__` delimiter. */
  wildcardKeys?: string[];
  /** Open / focus a resolved `__wildcard__` reference under the cursor. */
  onOpenWildcard?: (name: string) => void;
  /** Create a missing `__wildcard__` file from the name under the cursor. */
  onCreateWildcard?: (name: string) => void;
  /** Rename a `<lora:name:…>` model on disk and rewrite references. */
  onRenameLora?: (name: string) => void;
  /** Open a `<lora:name:…>` in the LoRA files workspace. */
  onOpenLora?: (name: string) => void;
  /** Open the Civitai catalog UI on the model linked above this LoRA tag. */
  onOpenLoraInCivitaiCatalog?: (model: ParsedCivitaiModelPageUrl) => void;
  className?: string;
};

type EditorContextMenu = {
  x: number;
  y: number;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canUndo: boolean;
  canRedo: boolean;
  wildcard: EditorWildcardTarget | null;
  lora: EditorLoraTarget | null;
};

const WILDCARD_AT_RE = /__([^_\n](?:[^_\n]|_(?!_))*)__/g;
const LORA_AT_RE = /<lora:([^:>\n]*)(?::[^>\n]*)?>/gi;

function findWildcardAt(
  text: string,
  pos: number,
): { name: string; raw: string; from: number; to: number } | null {
  WILDCARD_AT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WILDCARD_AT_RE.exec(text)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (pos < from || pos > to) continue;
    const name = match[1]!.trim();
    if (!name) return null;
    return { name, raw: match[0], from, to };
  }
  return null;
}

function findLoraAt(
  text: string,
  pos: number,
): { name: string; raw: string; from: number; to: number } | null {
  LORA_AT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LORA_AT_RE.exec(text)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (pos < from || pos > to) continue;
    const name = match[1]!.trim();
    if (!name) return null;
    return { name, raw: match[0], from, to };
  }
  return null;
}

function keyExists(name: string, keys: string[]): boolean {
  const needle = name.toLowerCase();
  return keys.some((key) => key.toLowerCase() === needle);
}

/**
 * Same idea as CodeMirror's basicSetup, but without highlightSelectionMatches —
 * that feature paints every other occurrence of the selected word and looked like
 * broken multi-line selection.
 */
const editorSetup: Extension = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
  ]),
];

const setHighlightLine = StateEffect.define<number | null>();

const highlightLineField = StateField.define<{ line: number | null }>({
  create: () => ({ line: null }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHighlightLine)) return { line: effect.value };
    }
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => {
      if (value.line == null) return Decoration.none;
      return (view) => {
        if (value.line! < 1 || value.line! > view.state.doc.lines) {
          return Decoration.none;
        }
        const line = view.state.doc.line(value.line!);
        return Decoration.set([
          Decoration.line({ class: 'cm-issue-line' }).range(line.from),
        ]);
      };
    }),
});

function languageForExt(ext?: string): Extension {
  const e = (ext ?? '.txt').toLowerCase();
  if (e === '.yaml' || e === '.yml') return yaml();
  if (e === '.json') return json();
  return wildcardLanguage;
}

function wildcardCompletionSource(keys: string[]): CompletionSource {
  const options = keys.map((key) => ({
    label: key,
    type: 'variable',
    apply: `${key}__`,
  }));

  return (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const beforeCursor = context.state.sliceDoc(line.from, context.pos);
    const delimiterCount = beforeCursor.match(/__/g)?.length ?? 0;
    // An odd number means the cursor is after an opening, but not a closing,
    // delimiter. This prevents completion reopening after a finished `__key__`.
    if (delimiterCount % 2 === 0) return null;

    const match = context.matchBefore(/__(?:[^_\n]|_(?!_))*$/);
    if (!match) return null;
    const closesAtCursor =
      context.state.sliceDoc(
        context.pos,
        Math.min(context.state.doc.length, context.pos + 2),
      ) === '__';

    return {
      from: match.from + 2,
      to: context.pos + (closesAtCursor ? 2 : 0),
      options,
      validFor: /(?:[^_\n]|_(?!_))*/,
    };
  };
}

/** Bright, dark-theme-friendly syntax colors (defaults are made for light UIs). */
const brightHighlightStyle = HighlightStyle.define([
  // `__wildcard__` references — the star of the show.
  { tag: t.keyword, color: '#7cc4ff', fontWeight: '600' },
  // Comments.
  { tag: t.comment, color: '#8a949f', fontStyle: 'italic' },
  // `<lora:` / `>` delimiters and the model name inside the tag.
  { tag: t.tagName, color: '#c792ea', fontWeight: '600' },
  {
    tag: t.special(t.variableName),
    color: '#7ee0c3',
    fontWeight: '600',
  },
  // `5::` weights.
  { tag: t.number, color: '#ffb86c' },
  // `2$$` multi-select markers.
  { tag: t.meta, color: '#f28fad' },
  // `{ | }` variant delimiters.
  { tag: t.bracket, color: '#c792ea', fontWeight: '600' },
  // Quoted strings.
  { tag: t.string, color: '#a5e075' },
  // YAML/JSON structure (keys, punctuation, atoms).
  { tag: t.propertyName, color: '#7cc4ff' },
  { tag: t.definition(t.propertyName), color: '#7cc4ff' },
  { tag: t.atom, color: '#ffb86c' },
  { tag: t.bool, color: '#ffb86c' },
  { tag: t.null, color: '#f28fad' },
  { tag: t.punctuation, color: '#9aa5b5' },
  { tag: t.separator, color: '#9aa5b5' },
  { tag: t.content, color: '#e7eaf0' },
]);

const editorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '12px',
      backgroundColor: '#0b0e13',
      color: '#e7eaf0',
    },
    '.cm-scroller': {
      fontFamily: '"Cascadia Code", Consolas, ui-monospace, monospace',
      lineHeight: '1.5',
      overflow: 'auto',
    },
    '.cm-content': {
      caretColor: '#e7eaf0',
      padding: '8px 0',
    },
    '.cm-gutters': {
      backgroundColor: '#0b0e13',
      color: '#6b7383',
      border: 'none',
      borderRight: '1px solid #1e2530',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
      color: '#c8d1df',
    },
    // Keep the current-line cue subtle so it does not hide the selection layer
    // (selection is drawn behind line backgrounds in CodeMirror).
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.045)',
    },
    // Prefer the CodeMirror selection layer; do not recolor selected text.
    '.cm-content ::selection': {
      backgroundColor: 'transparent',
      color: 'inherit',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, & > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
      {
        backgroundColor: 'rgba(56, 139, 253, 0.42) !important',
      },
    '.cm-cursor': {
      borderLeftColor: '#e7eaf0',
    },
    '.cm-matchingBracket': {
      backgroundColor: '#3a4a2a',
      outline: '1px solid #6a8a4a',
    },
    '.cm-searchMatch': {
      backgroundColor: '#5c4a1a',
      outline: '1px solid #d4a017',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: '#8a6a12',
      outline: '1px solid #ffd666',
    },
    '.cm-issue-line': {
      backgroundColor: 'rgba(180, 60, 70, 0.22)',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-panels': {
      backgroundColor: '#141820',
      color: '#c8d1df',
      borderTop: '1px solid #303744',
    },
    '.cm-panel.cm-search': {
      padding: '6px 8px',
    },
    '.cm-panel.cm-search input, .cm-textfield': {
      background: '#0b0e13',
      color: '#e7eaf0',
      border: '1px solid #46516a',
      borderRadius: '4px',
      padding: '3px 6px',
    },
    '.cm-panel.cm-search button, .cm-button': {
      backgroundImage: 'none',
      backgroundColor: '#1c2330',
      color: '#c8d1df',
      border: '1px solid #46516a',
      borderRadius: '4px',
      padding: '2px 8px',
      cursor: 'pointer',
    },
    '.cm-panel.cm-search button:hover': {
      backgroundColor: '#2a3344',
    },
    '.cm-tooltip-autocomplete': {
      border: '1px solid #46516a',
      backgroundColor: '#141820',
      color: '#e7eaf0',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#2d5aa8',
      color: '#ffffff',
    },
    '.cm-panel.cm-search label': {
      color: '#aeb6c3',
      fontSize: '11px',
    },
  },
  { dark: true },
);

export const WildcardEditor = forwardRef<WildcardEditorHandle, Props>(
  function WildcardEditor(
    {
      value,
      onChange,
      onBlur,
      readOnly = false,
      fileExt,
      wildcardKeys = [],
      onOpenWildcard,
      onCreateWildcard,
      onRenameLora,
      onOpenLora,
      onOpenLoraInCivitaiCatalog,
      className,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const wildcardKeysRef = useRef(wildcardKeys);
    wildcardKeysRef.current = wildcardKeys;
    const highlightTimer = useRef<number | null>(null);
    const langCompartment = useRef(new Compartment()).current;
    const editableCompartment = useRef(new Compartment()).current;
    const completionCompartment = useRef(new Compartment()).current;
    const [contextMenu, setContextMenu] = useState<EditorContextMenu | null>(
      null,
    );
    const readOnlyRef = useRef(readOnly);
    readOnlyRef.current = readOnly;

    useImperativeHandle(ref, () => ({
      jumpToLine(line: number, column?: number) {
        const view = viewRef.current;
        if (!view) return;
        const doc = view.state.doc;
        const ln = Math.max(1, Math.min(line, doc.lines));
        const lineObj = doc.line(ln);
        const col = column && column > 0 ? column - 1 : 0;
        const pos = Math.min(lineObj.from + col, lineObj.to);
        view.dispatch({
          selection: { anchor: pos, head: pos },
          effects: [
            setHighlightLine.of(ln),
            EditorView.scrollIntoView(pos, { y: 'center' }),
          ],
        });
        view.focus();
        if (highlightTimer.current != null) {
          window.clearTimeout(highlightTimer.current);
        }
        highlightTimer.current = window.setTimeout(() => {
          viewRef.current?.dispatch({ effects: setHighlightLine.of(null) });
          highlightTimer.current = null;
        }, 2500);
      },
      focus() {
        viewRef.current?.focus();
      },
      getValue() {
        return viewRef.current?.state.doc.toString() ?? '';
      },
      setExternalValue(text: string) {
        const view = viewRef.current;
        if (!view) return;
        applyExternalDocText(view, text);
      },
    }));

    const openEditorContextMenu = (
      event: ReactMouseEvent<HTMLDivElement>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const view = viewRef.current;
      if (!view) return;

      const clickPos =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
        view.state.selection.main.head;
      const docText = view.state.doc.toString();
      const wildcardHit = findWildcardAt(docText, clickPos);
      const loraHit = wildcardHit ? null : findLoraAt(docText, clickPos);
      const hit = wildcardHit ?? loraHit;

      if (hit) {
        view.dispatch({
          selection: { anchor: hit.from, head: hit.to },
        });
      } else {
        // Move the caret to the click when there is no selection covering it,
        // so Paste lands where the user right-clicked.
        const { from, to } = view.state.selection.main;
        const clickInsideSelection =
          from !== to &&
          clickPos >= Math.min(from, to) &&
          clickPos <= Math.max(from, to);
        if (!clickInsideSelection) {
          view.dispatch({ selection: { anchor: clickPos, head: clickPos } });
        }
      }
      view.focus();

      const { state } = view;
      const hasSelection = state.selection.ranges.some((r) => !r.empty);
      const editable = !readOnlyRef.current && !state.readOnly;
      const wildcard: EditorWildcardTarget | null = wildcardHit
        ? {
            name: wildcardHit.name,
            raw: wildcardHit.raw,
            exists: keyExists(wildcardHit.name, wildcardKeysRef.current),
            isGlob: wildcardHit.name.includes('*'),
          }
        : null;
      const lora: EditorLoraTarget | null = loraHit
        ? {
            name: loraHit.name,
            raw: loraHit.raw,
            civitai:
              findCivitaiModelUrlAbove(docText, loraHit.from) ?? undefined,
          }
        : null;
      const menuWidth = wildcard || lora ? 280 : 200;
      const menuHeight =
        (wildcard ? 110 : 0) +
        (lora ? 126 + (lora.civitai ? 36 : 0) : 0) +
        (editable ? 250 : 90);
      setContextMenu({
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
        y: Math.max(
          8,
          Math.min(event.clientY, window.innerHeight - menuHeight - 8),
        ),
        canCut: editable && hasSelection,
        canCopy: hasSelection,
        canPaste: editable,
        canUndo: editable && undoDepth(state) > 0,
        canRedo: editable && redoDepth(state) > 0,
        wildcard,
        lora,
      });
    };

    const runEditorCommand = (
      action: 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo',
    ) => {
      const view = viewRef.current;
      setContextMenu(null);
      if (!view) return;
      view.focus();

      if (action === 'selectAll') {
        selectAll(view);
        return;
      }
      if (action === 'undo') {
        undo(view);
        return;
      }
      if (action === 'redo') {
        redo(view);
        return;
      }

      const { state } = view;
      const selected = state.selection.ranges
        .filter((r) => !r.empty)
        .map((r) => state.sliceDoc(r.from, r.to))
        .join('\n');

      if (action === 'copy') {
        if (!selected) return;
        void navigator.clipboard.writeText(selected);
        return;
      }

      if (action === 'cut') {
        if (state.readOnly || !selected) return;
        void navigator.clipboard.writeText(selected).then(() => {
          view.dispatch(view.state.replaceSelection(''));
        });
        return;
      }

      if (action === 'paste') {
        if (state.readOnly) return;
        void navigator.clipboard.readText().then((text) => {
          if (!text) return;
          view.dispatch(view.state.replaceSelection(text));
        });
      }
    };

    useEffect(() => {
      if (!contextMenu) return;

      const close = (event: Event) => {
        if (
          event.type === 'pointerdown' &&
          menuRef.current?.contains(event.target as globalThis.Node)
        ) {
          return;
        }
        setContextMenu(null);
      };
      const closeOnEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setContextMenu(null);
      };

      window.addEventListener('pointerdown', close);
      window.addEventListener('blur', close);
      window.addEventListener('resize', close);
      window.addEventListener('scroll', close, true);
      window.addEventListener('keydown', closeOnEscape);
      window.setTimeout(() => {
        menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      }, 0);

      return () => {
        window.removeEventListener('pointerdown', close);
        window.removeEventListener('blur', close);
        window.removeEventListener('resize', close);
        window.removeEventListener('scroll', close, true);
        window.removeEventListener('keydown', closeOnEscape);
      };
    }, [contextMenu]);

    useEffect(() => {
      if (!hostRef.current) return;

      const state = EditorState.create({
        doc: value,
        extensions: [
          editorSetup,
          syntaxHighlighting(brightHighlightStyle),
          langCompartment.of(languageForExt(fileExt)),
          completionCompartment.of(
            autocompletion({
              override: [wildcardCompletionSource(wildcardKeys)],
              activateOnTyping: true,
              maxRenderedOptions: 100,
            }),
          ),
          highlightLineField,
          editorTheme,
          keymap.of([
            // Prefer accepting an open completion over indent (indentWithTab
            // would otherwise always consume Tab).
            { key: 'Tab', run: acceptCompletion },
            indentWithTab,
            { key: 'Mod-f', run: openSearchPanel },
          ]),
          editableCompartment.of([
            EditorView.editable.of(!readOnly),
            EditorState.readOnly.of(readOnly),
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const fromExternal = update.transactions.some((tr) =>
              tr.annotation(externalValueAnnotation),
            );
            if (fromExternal) return;
            onChangeRef.current?.(update.state.doc.toString());
          }),
          EditorView.lineWrapping,
        ],
      });

      const view = new EditorView({ state, parent: hostRef.current });
      viewRef.current = view;

      return () => {
        if (highlightTimer.current != null) {
          window.clearTimeout(highlightTimer.current);
        }
        view.destroy();
        viewRef.current = null;
      };
      // Mount once per component instance (parent keys by file path).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      applyExternalDocText(view, value);
    }, [value]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: editableCompartment.reconfigure([
          EditorView.editable.of(!readOnly),
          EditorState.readOnly.of(readOnly),
        ]),
      });
    }, [readOnly, editableCompartment]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: langCompartment.reconfigure(languageForExt(fileExt)),
      });
    }, [fileExt, langCompartment]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: completionCompartment.reconfigure(
          autocompletion({
            override: [wildcardCompletionSource(wildcardKeys)],
            activateOnTyping: true,
            maxRenderedOptions: 100,
          }),
        ),
      });
    }, [completionCompartment, wildcardKeys]);

    return (
      <>
        <div
          ref={hostRef}
          className={className ?? 'wildcard-editor'}
          data-readonly={readOnly ? 'true' : 'false'}
          onContextMenu={openEditorContextMenu}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.();
          }}
        />
        {contextMenu ? (
          <div
            ref={menuRef}
            className="file-context-menu editor-context-menu"
            role="menu"
            aria-label="Editor actions"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
          >
            {contextMenu.wildcard ? (
              <>
                <div className="file-context-menu-title">
                  {contextMenu.wildcard.raw}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const name = contextMenu.wildcard!.name;
                    setContextMenu(null);
                    onOpenWildcard?.(name);
                  }}
                >
                  <Crosshair size={14} /> Open in graph
                </button>
                {!contextMenu.wildcard.exists &&
                !contextMenu.wildcard.isGlob ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const name = contextMenu.wildcard!.name;
                      setContextMenu(null);
                      onCreateWildcard?.(name);
                    }}
                  >
                    <FilePlus size={14} /> Create file…
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const raw = contextMenu.wildcard!.raw;
                    setContextMenu(null);
                    void navigator.clipboard.writeText(raw);
                  }}
                >
                  <ClipboardCopy size={14} /> Copy reference
                </button>
                <div className="file-context-menu-separator" role="separator" />
              </>
            ) : null}
            {contextMenu.lora ? (
              <>
                <div className="file-context-menu-title">
                  {contextMenu.lora.raw}
                </div>
                {onOpenLora ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const name = contextMenu.lora!.name;
                      setContextMenu(null);
                      onOpenLora(name);
                    }}
                  >
                    <FolderOpen size={14} /> Open in LoRA files
                  </button>
                ) : null}
                {contextMenu.lora.civitai && onOpenLoraInCivitaiCatalog ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const model = contextMenu.lora!.civitai!;
                      setContextMenu(null);
                      onOpenLoraInCivitaiCatalog(model);
                    }}
                  >
                    <Sparkles size={14} /> Open in Civitai catalog
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const name = contextMenu.lora!.name;
                    setContextMenu(null);
                    onRenameLora?.(name);
                  }}
                >
                  <Pencil size={14} /> Rename LoRA on disk…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    const raw = contextMenu.lora!.raw;
                    setContextMenu(null);
                    void navigator.clipboard.writeText(raw);
                  }}
                >
                  <ClipboardCopy size={14} /> Copy tag
                </button>
                <div className="file-context-menu-separator" role="separator" />
              </>
            ) : null}
            {!readOnly ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!contextMenu.canUndo}
                  onClick={() => runEditorCommand('undo')}
                >
                  <Undo2 size={14} /> Undo
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!contextMenu.canRedo}
                  onClick={() => runEditorCommand('redo')}
                >
                  <Redo2 size={14} /> Redo
                </button>
                <div className="file-context-menu-separator" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={!contextMenu.canCut}
                  onClick={() => runEditorCommand('cut')}
                >
                  <Scissors size={14} /> Cut
                </button>
              </>
            ) : null}
            <button
              type="button"
              role="menuitem"
              disabled={!contextMenu.canCopy}
              onClick={() => runEditorCommand('copy')}
            >
              <ClipboardCopy size={14} /> Copy
            </button>
            {!readOnly ? (
              <button
                type="button"
                role="menuitem"
                disabled={!contextMenu.canPaste}
                onClick={() => runEditorCommand('paste')}
              >
                <ClipboardPaste size={14} /> Paste
              </button>
            ) : null}
            <div className="file-context-menu-separator" role="separator" />
            <button
              type="button"
              role="menuitem"
              onClick={() => runEditorCommand('selectAll')}
            >
              Select all
            </button>
          </div>
        ) : null}
      </>
    );
  },
);
