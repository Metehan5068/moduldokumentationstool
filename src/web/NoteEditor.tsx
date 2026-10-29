import { useLayoutEffect, useRef } from 'react';
import { Compartment, EditorState, Prec, Transaction } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, placeholder, type DecorationSet, type KeyBinding, type ViewUpdate } from '@codemirror/view';
import { history, historyKeymap, standardKeymap, insertNewline, isolateHistory, redo, undo } from '@codemirror/commands';
import type { BulletEdit } from './bullet-edit';

export interface NoteEditorHandle {
  readonly element: HTMLElement;
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  focus(options?: FocusOptions): void;
  setSelectionRange(start: number, end: number): void;
  contains(target: EventTarget | null): boolean;
  applyEdit(edit: BulletEdit): void;
}

/** Line decorations change presentation only; the document keeps every original character. */
const hangingIndent = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.geometryChanged) this.decorations = this.build(update.view);
  }
  build(view: EditorView) {
    const style = getComputedStyle(view.contentDOM);
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const ranges = [];
    for (let number = 1; number <= view.state.doc.lines; number++) {
      const line = view.state.doc.line(number);
      const prefix = line.text.match(/^[ \t]*[-*+] /)?.[0] ?? line.text.match(/^[ \t]+/)?.[0];
      if (!prefix) continue;
      let column = 0;
      const expanded = prefix.replace(/\t|[^\t]/g, (character) => {
        if (character !== '\t') { column++; return character; }
        const spaces = 4 - column % 4; column += spaces; return ' '.repeat(spaces);
      });
      const width = context.measureText(expanded).width;
      ranges.push(Decoration.line({ attributes: { style: `padding-left:${width + 2}px;text-indent:-${width}px`, 'data-hanging-indent': String(width) } }).range(line.from));
    }
    return Decoration.set(ranges);
  }
}, { decorations: (plugin) => plugin.decorations });

export function NoteEditor({ id, label, value, readOnly, describedBy, editorRef, onChange, onFocus, onBlur, onKeyDown }: {
  id: string; label: string; value: string; readOnly: boolean; describedBy?: string;
  editorRef?: (handle: NoteEditorHandle | null) => void;
  onChange: (value: string) => void; onFocus?: () => void; onBlur: () => void;
  onKeyDown: (event: KeyboardEvent, handle: NoteEditorHandle) => boolean;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef({ editorRef, onChange, onFocus, onBlur, onKeyDown });
  latest.current = { editorRef, onChange, onFocus, onBlur, onKeyDown };
  const access = useRef(new Compartment());
  const undoHistory = useRef(new Compartment());
  const attributes = useRef(new Compartment());
  const contentAttributes = () => EditorView.contentAttributes.of({ id, role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', 'aria-readonly': String(readOnly), ...(describedBy ? { 'aria-describedby': describedBy } : {}) });

  useLayoutEffect(() => {
    let handle: NoteEditorHandle;
    let composingKey = false;
    const guardComposition = (bindings: readonly KeyBinding[]) => bindings.map((binding) => ({
      ...binding,
      run: binding.run ? (editor: EditorView) => !composingKey && binding.run!(editor) : undefined,
      shift: binding.shift ? (editor: EditorView) => !composingKey && binding.shift!(editor) : undefined,
    }));
    const view = new EditorView({ parent: holder.current!, state: EditorState.create({ doc: value, extensions: [
      EditorView.lineWrapping, EditorState.tabSize.of(4), undoHistory.current.of(history()), hangingIndent,
      access.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
      attributes.current.of(contentAttributes()), placeholder('Deine Notiz …'),
      // Plain newlines outside list mode; Tab keeps its ordinary focus-navigation behavior.
      keymap.of(guardComposition([{ key: 'Mod-Shift-z', run: redo, preventDefault: true }, ...historyKeymap, { key: 'Enter', run: insertNewline }, { key: 'Shift-Enter', run: insertNewline }, ...standardKeymap])),
      Prec.highest(EditorView.domEventHandlers({
        keydown: (event, editor) => {
          composingKey = event.isComposing || event.keyCode === 229;
          if (composingKey) return false;
          // Accept both upper/lower-case key values emitted by keyboard layouts and automation.
          if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') {
            event.preventDefault(); if (!editor.state.readOnly) (event.shiftKey ? redo : undo)(editor); return true;
          }
          return latest.current.onKeyDown(event, handle);
        },
        focus: () => { latest.current.onFocus?.(); },
        blur: () => { latest.current.onBlur(); },
      })),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !update.transactions.every((transaction) => transaction.annotation(Transaction.addToHistory) === false)) {
          latest.current.onChange(update.state.doc.toString());
          // Programmatic list transactions also count as edits for progress tracking.
          view.contentDOM.dispatchEvent(new Event('note-edit', { bubbles: true }));
        }
      }),
    ] }) });
    handle = {
      element: view.contentDOM,
      get value() { return view.state.doc.toString(); },
      get selectionStart() { return view.state.selection.main.from; },
      get selectionEnd() { return view.state.selection.main.to; },
      focus() { view.focus(); },
      setSelectionRange(start, end) { view.dispatch({ selection: { anchor: start, head: end } }); },
      contains(target) { return target instanceof Node && view.contentDOM.contains(target); },
      applyEdit(edit) {
        view.dispatch({ changes: { from: edit.start, to: edit.end, insert: edit.text }, selection: { anchor: edit.selectionStart, head: edit.selectionEnd }, annotations: [Transaction.userEvent.of('input.list'), isolateHistory.of('full')], scrollIntoView: true });
      },
    };
    viewRef.current = view;
    latest.current.editorRef?.(handle);
    return () => { latest.current.editorRef?.(null); viewRef.current = null; view.destroy(); };
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const changes = value === view.state.doc.toString() ? undefined : { from: 0, to: view.state.doc.length, insert: value };
    // Accepting a file/conflict version starts a fresh history, so Undo cannot resurrect stale text.
    if (changes) view.dispatch({ effects: undoHistory.current.reconfigure([]) });
    view.dispatch({ changes, effects: [access.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]), attributes.current.reconfigure(contentAttributes()), ...(changes ? [undoHistory.current.reconfigure(history())] : [])], annotations: Transaction.addToHistory.of(false) });
  }, [value, readOnly, describedBy, id, label]);

  return <div className="note-editor" ref={holder} />;
}
