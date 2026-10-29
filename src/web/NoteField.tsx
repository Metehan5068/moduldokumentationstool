import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NotesSession, statusText } from './notes-session';
import { bulletKeyEdit, enableBullets, type BulletEdit } from './bullet-edit';
import { NoteEditor, type NoteEditorHandle } from './NoteEditor';
import { ConfirmIrrelevant, IrrelevantNote } from './NoteRelevance';
import { IRRELEVANT_NOTE, isIrrelevantNote } from './note-relevance';
import { NoteCopyDialog } from './NoteCopyDialog';
export function NoteField({ session, page, id, label, editorRef, onFocus }: {
  session: NotesSession; page: number; id: string; label: string; editorRef?: (handle: NoteEditorHandle | null) => void; onFocus?: () => void;
}) {
  const draft = session.get(page);
  const field = useRef<NoteEditorHandle>(null);
  const [bullets, setBullets] = useState(false);
  const [irrelevant, setIrrelevant] = useState(() => isIrrelevantNote(draft.text));
  const [confirmation, setConfirmation] = useState<{ text: string; conflict: typeof draft.conflict }>();
  const [copyRequest, setCopyRequest] = useState<{ text: string; conflict: typeof draft.conflict }>();
  const [relevanceError, setRelevanceError] = useState<string>();
  const locallyEdited = useRef<string | undefined>(undefined);
  const focusAfterChange = useRef(false);
  const proxy = useMemo<NoteEditorHandle>(() => ({
    get element() { return field.current!.element; },
    get value() { return session.get(page).text; },
    get selectionStart() { return Math.min(field.current?.selectionStart ?? 0, session.get(page).text.length); },
    get selectionEnd() { return Math.min(field.current?.selectionEnd ?? 0, session.get(page).text.length); },
    focus(options) { field.current?.focus(options); },
    setSelectionRange(start, end) { field.current?.setSelectionRange(start, end); },
    contains(target) { return field.current?.contains(target) ?? false; },
    applyEdit(edit) { field.current?.applyEdit(edit); },
  }), [session, page]);
  useLayoutEffect(() => { editorRef?.(proxy); return () => editorRef?.(null); }, [proxy]);
  useLayoutEffect(() => {
    if (locallyEdited.current === draft.text) locallyEdited.current = undefined;
    else {
      const next = isIrrelevantNote(draft.text);
      setIrrelevant(next);
      if (next) setBullets(false);
    }
  }, [draft.text]);
  useLayoutEffect(() => {
    if (focusAfterChange.current) { focusAfterChange.current = false; field.current?.focus({ preventScroll: true }); }
  }, [irrelevant, copyRequest]);
  const changeRelevance = (next: boolean) => {
    if (session.readOnlyError) return;
    const text = next ? IRRELEVANT_NOTE : '';
    locallyEdited.current = text;
    focusAfterChange.current = true;
    setIrrelevant(next); setBullets(false); setRelevanceError(undefined);
    session.edit(page, text);
    field.current?.element.dispatchEvent(new Event('note-edit', { bubbles: true }));
  };
  const applyEdit = (edit: BulletEdit) => {
    const element = field.current!;
    element.focus({ preventScroll: true });
    element.applyEdit(edit);
  };
  return <>
    <div className="note-field-toolbar"><label htmlFor={id} onClick={() => field.current?.focus({ preventScroll: true })}>{label}</label>
      <div className="note-field-actions">
      <button type="button" aria-label={`Kopieren: ${label}`} disabled={Boolean(session.readOnlyError)}
        onMouseDown={(event) => event.preventDefault()} onClick={() => {
          if (session.readOnlyError) return;
          const current = session.get(page);
          setCopyRequest({ text: current.text, conflict: current.conflict });
        }}>Kopieren</button>
      <button type="button" aria-pressed={bullets} aria-label={`Stichpunkte: ${label}`} disabled={irrelevant || Boolean(session.readOnlyError)}
        onMouseDown={(event) => event.preventDefault()} onClick={() => {
          const element = field.current!;
          if (!bullets) {
            const edit = enableBullets(element.value, element.selectionStart, element.selectionEnd);
            setBullets(true);
            if (edit) applyEdit(edit);
          } else setBullets(false);
          element.focus({ preventScroll: true });
        }}>Stichpunkte</button>
      <button type="button" aria-pressed={irrelevant} aria-label={`Nicht relevant: ${label}`} disabled={Boolean(session.readOnlyError)}
        onMouseDown={(event) => event.preventDefault()} onClick={() => {
          if (session.readOnlyError) return;
          setRelevanceError(undefined);
          const current = session.get(page);
          if (irrelevant) changeRelevance(false);
          else if (current.text.trim()) setConfirmation({ text: current.text, conflict: current.conflict });
          else changeRelevance(true);
        }}>Nicht relevant</button></div>
    </div>
    {relevanceError && <p role="alert" className="bad">{relevanceError}</p>}
    {bullets && !irrelevant && <p className="bullet-hint" id={`${id}-bullet-help`}>Enter: nächster Punkt · Tab / Umschalt+Tab: ein-/ausrücken · Rücktaste im leeren Punkt: ausrücken, oben ohne Wirkung · Umschalt+Enter: Zeilenumbruch · Stichpunkte erneut anklicken: Modus beenden · Esc: Feld verlassen</p>}
    {irrelevant ? <IrrelevantNote id={id} label={label} value={draft.text} editorRef={(element) => { field.current = element; }} onFocus={onFocus} onBlur={() => { void session.save(page); }} /> :
    <NoteEditor id={id} label={label} editorRef={(element) => { field.current = element; }} onFocus={onFocus} value={draft.text} readOnly={Boolean(session.readOnlyError)}
      describedBy={bullets ? `${id}-bullet-help` : undefined}
      onKeyDown={(event, element) => {
        if (!bullets || session.readOnlyError || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return false;
        const edit = bulletKeyEdit(element.value, element.selectionStart, element.selectionEnd, event.key, event.shiftKey);
        if (!edit) return false;
        event.preventDefault();
        if (edit.start === edit.end && !edit.text && edit.selectionStart === element.selectionStart && edit.selectionEnd === element.selectionEnd) return true;
        applyEdit(edit);
        return true;
      }}
      onChange={(text) => { locallyEdited.current = text; session.edit(page, text); }} onBlur={() => { void session.save(page); }} />}
    {confirmation && <ConfirmIrrelevant id={id} disabled={Boolean(session.readOnlyError)} onCancel={() => setConfirmation(undefined)} onConfirm={() => {
      const current = session.get(page);
      if (session.readOnlyError) return;
      if (current.text !== confirmation.text || current.conflict !== confirmation.conflict) {
        setConfirmation(undefined); setRelevanceError('Die Notiz hat sich inzwischen geändert. Bitte erneut prüfen und markieren.'); return;
      }
      setConfirmation(undefined); changeRelevance(true);
    }} />}
    {copyRequest && <NoteCopyDialog id={id} pageCount={session.pageCount} replacing={Boolean(copyRequest.text.trim())} disabled={Boolean(session.readOnlyError)} onCancel={() => setCopyRequest(undefined)} onCopy={(sourcePage) => {
      if (session.readOnlyError) return 'Die Notizen sind schreibgeschützt.';
      if (!Number.isInteger(sourcePage) || sourcePage < 1 || sourcePage > session.pageCount) return 'Die Quellfolie ist ungültig.';
      if (sourcePage === page) return 'Bitte eine andere Folie als Quelle wählen.';
      const target = session.get(page);
      if (target.text !== copyRequest.text || target.conflict !== copyRequest.conflict) return 'Die Zielnotiz hat sich inzwischen geändert. Bitte abbrechen und neu öffnen.';
      const source = session.get(sourcePage);
      if (source.conflict) return 'Die Quellnotiz hat einen ungelösten Konflikt. Bitte diesen zuerst klären.';
      if (!source.text.trim()) return 'Die gewählte Folie enthält keine Notiz zum Kopieren.';
      const text = source.text;
      const nextIrrelevant = isIrrelevantNote(text);
      focusAfterChange.current = true;
      setCopyRequest(undefined); setRelevanceError(undefined);
      if (!irrelevant && !nextIrrelevant) {
        field.current!.applyEdit({ start: 0, end: target.text.length, text, selectionStart: 0, selectionEnd: 0 });
      } else {
        locallyEdited.current = text;
        setIrrelevant(nextIrrelevant); setBullets(false);
        session.edit(page, text);
        field.current?.element.dispatchEvent(new Event('note-edit', { bubbles: true }));
      }
      return undefined;
    }} />}
    <div className="note-save-status"><span>{statusText[draft.status]}</span>
      {draft.status === 'error' && !session.readOnlyError && <button type="button" onClick={() => { void session.save(page); }}>Wiederholen</button>}
    </div>
    {draft.conflict && <div className="conflict-panel" role="group" aria-label={`Konflikt Folie ${page}`}>
      <p>Diese Notiz wurde in der Datei geändert. Deine Fassung wird oben angezeigt.</p>
      <label htmlFor={`file-note-${page}`}>Dateifassung Folie {page}</label>
      <textarea id={`file-note-${page}`} readOnly value={draft.conflict.currentText} />
      <div className="conflict-actions">
        <button type="button" onClick={() => session.resolve(page, 'mine')}>Eigene behalten</button>
        <button type="button" onClick={() => session.resolve(page, 'file')}>Datei übernehmen</button>
        <button type="button" onClick={() => session.resolve(page, 'merge')}>Beide zusammenfügen</button>
      </div>
    </div>}
  </>;
}
