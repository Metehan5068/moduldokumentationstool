import { useLayoutEffect, useRef } from 'react';
import type { NoteEditorHandle } from './NoteEditor';

export function IrrelevantNote({ id, label, value, editorRef, onFocus, onBlur }: {
  id: string; label: string; value: string; editorRef: (handle: NoteEditorHandle | null) => void;
  onFocus?: () => void; onBlur: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, editorRef }); latest.current = { value, editorRef };
  const selection = useRef({ start: 0, end: 0 });
  useLayoutEffect(() => {
    const node = element.current!;
    latest.current.editorRef({
      element: node,
      get value() { return latest.current.value; },
      get selectionStart() { return selection.current.start; },
      get selectionEnd() { return selection.current.end; },
      focus(options) { node.focus(options); },
      setSelectionRange(start, end) { selection.current = { start: Math.min(start, latest.current.value.length), end: Math.min(end, latest.current.value.length) }; },
      contains(target) { return target instanceof Node && node.contains(target); },
      applyEdit() { /* The relevance panel is intentionally non-editable. */ },
    });
    return () => latest.current.editorRef(null);
  }, []);
  return <div className="note-editor irrelevant-note" id={id} ref={element} role="textbox" aria-label={label} aria-readonly="true" tabIndex={0} onFocus={onFocus} onBlur={onBlur}>
    <p>Keine relevanten Informationen enthalten</p>
  </div>;
}

export function ConfirmIrrelevant({ id, disabled, onCancel, onConfirm }: {
  id: string; disabled: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const node = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    node.showModal();
    return () => { node.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog className="relevance-dialog" ref={dialog} aria-labelledby={`${id}-relevance-title`} aria-describedby={`${id}-relevance-warning`}
    onCancel={(event) => { event.preventDefault(); onCancel(); }}
    onKeyDown={(event) => {
      if (event.ctrlKey && event.key.toLowerCase() === 's') return;
      event.stopPropagation();
      if (event.altKey || (event.ctrlKey && event.key.toLowerCase() === 'g')) event.preventDefault();
    }}>
    <h2 id={`${id}-relevance-title`}>Notiz als nicht relevant markieren?</h2>
    <p id={`${id}-relevance-warning`}>Der vorhandene Notiztext geht dabei verloren. Möchtest du ihn verwerfen?</p>
    {disabled && <p role="alert">Die Notiz ist inzwischen schreibgeschützt. Es wird nichts geändert.</p>}
    <div className="relevance-dialog-actions">
      <button type="button" autoFocus onClick={onCancel}>Abbrechen</button>
      <button type="button" disabled={disabled} onClick={onConfirm}>Text verwerfen und markieren</button>
    </div>
  </dialog>;
}
