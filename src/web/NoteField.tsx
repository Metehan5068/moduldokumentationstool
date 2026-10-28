import type { Ref } from 'react';
import { NotesSession, statusText } from './notes-session';
export function NoteField({ session, page, id, label, textareaRef, onFocus }: {
  session: NotesSession; page: number; id: string; label: string; textareaRef?: Ref<HTMLTextAreaElement>; onFocus?: () => void;
}) {
  const draft = session.get(page);
  return <>
    <label htmlFor={id}>{label}</label>
    <textarea id={id} ref={textareaRef} onFocus={onFocus} value={draft.text} readOnly={Boolean(session.readOnlyError)}
      onChange={(event) => session.edit(page, event.target.value)} onBlur={() => { void session.save(page); }} placeholder="Deine Notiz …" />
    <div className="note-save-status"><span>{statusText[draft.status]}</span>
      {draft.status === 'error' && !session.readOnlyError && <button type="button" onClick={() => { void session.save(page); }}>Wiederholen</button>}
    </div>
    {draft.conflict && <div className="conflict-panel" role="group" aria-label={`Konflikt Folie ${page}`}>
      <p>Diese Notiz wurde in der Datei geändert. Deine Fassung steht im Notizfeld oben.</p>
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
