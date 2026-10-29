import type { NoteConflict, NotesFileError, NoteValue } from '../shared/api';
import { normalizeNote } from '../shared/notes';

export const EMPTY_NOTE_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
export interface Draft extends NoteValue {
  savedText: string;
  status: SaveStatus;
  conflict?: NoteConflict;
  uncertain?: boolean;
}
export const statusText: Record<SaveStatus, string> = {
  saved: 'Gespeichert', dirty: 'Ungespeichert', saving: 'Speichert …', error: 'Fehler beim Speichern', conflict: 'Konflikt – Auswahl erforderlich',
};

/** Pro Seite genau ein Request gleichzeitig; neuere Eingaben werden anschließend gespeichert. */
export class NotesSession {
  readonly drafts = new Map<number, Draft>();
  readOnlyError?: NotesFileError;
  private listeners = new Set<() => void>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private inFlight = new Map<number, Promise<void>>();
  private disposed = false;
  private leaving = false;

  constructor(readonly id: string, private initial: Record<number, NoteValue>, readOnlyError?: NotesFileError, readonly pageCount = Infinity) {
    this.readOnlyError = readOnlyError;
    for (const page of Object.keys(initial)) this.get(Number(page));
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) listener(); }
  get(page: number): Draft {
    let draft = this.drafts.get(page);
    if (!draft) {
      const value = this.initial[page] ?? { text: '', hash: EMPTY_NOTE_HASH };
      draft = { ...value, savedText: value.text, status: 'saved' };
      this.drafts.set(page, draft);
    }
    return draft;
  }
  hasUnsaved() { return [...this.drafts.values()].some((draft) => draft.text !== draft.savedText || draft.status !== 'saved'); }
  summary(): SaveStatus {
    const states = [...this.drafts.values()].map((draft) => draft.status);
    return (['conflict', 'error', 'saving', 'dirty'] as const).find((state) => states.includes(state)) ?? 'saved';
  }
  private clearTimer(page: number) { clearTimeout(this.timers.get(page)); this.timers.delete(page); }
  private schedule(page: number, delay: number) {
    this.clearTimer(page);
    if (!this.disposed) this.timers.set(page, setTimeout(() => { void this.save(page); }, delay));
  }
  edit(page: number, text: string) {
    if (this.readOnlyError) return;
    const draft = this.get(page);
    draft.text = normalizeNote(text);
    if (!draft.conflict && !this.inFlight.has(page)) draft.status = !draft.uncertain && draft.text === draft.savedText ? 'saved' : 'dirty';
    if (!draft.conflict) this.schedule(page, 600);
    this.changed();
  }
  async save(page: number, keepalive = false): Promise<void> {
    this.clearTimer(page);
    const pending = this.inFlight.get(page);
    if (pending) { await pending; if (this.get(page).status === 'dirty') await this.save(page, keepalive); return; }
    const draft = this.get(page);
    if (this.readOnlyError || draft.conflict || (draft.text === draft.savedText && draft.status === 'saved')) return;
    const text = draft.text;
    const baseHash = draft.hash;
    draft.status = 'saving';
    const request = Promise.resolve().then(async () => {
      try {
        const response = await fetch(`/api/lectures/${this.id}/${page > this.pageCount ? 'detached-notes' : 'notes'}/${page}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, baseHash }), keepalive: keepalive || this.leaving,
        });
        if (response.status === 409) {
          const conflict = await response.json() as NoteConflict;
          if (conflict.currentText === draft.text) {
            draft.hash = conflict.currentHash; draft.savedText = conflict.currentText; draft.status = 'saved'; draft.uncertain = false;
          } else { draft.conflict = conflict; draft.status = 'conflict'; }
        } else if (response.status === 422) {
          this.readOnlyError = await response.json() as NotesFileError;
          draft.status = 'error';
        } else {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const saved = await response.json() as { hash: string };
          draft.hash = saved.hash;
          draft.uncertain = false;
          draft.savedText = text;
          draft.status = draft.text === text ? 'saved' : 'dirty';
        }
      } catch {
        draft.uncertain = true; // Eine verlorene Antwort kann einen bereits erfolgten Schreibvorgang verbergen.
        draft.status = 'error';
        this.schedule(page, 5000);
      } finally {
        this.inFlight.delete(page);
        this.changed();
      }
    });
    this.inFlight.set(page, request);
    this.changed();
    await request;
    if (this.get(page).status === 'dirty') await this.save(page, keepalive);
  }
  async flushAll(keepalive = false) {
    if (keepalive) this.leaving = true;
    await Promise.all([...this.drafts.keys()].map((page) => this.save(page, keepalive)));
  }
  resume() { this.leaving = false; }
  resolve(page: number, choice: 'mine' | 'file' | 'merge') {
    const draft = this.get(page);
    const conflict = draft.conflict;
    if (!conflict) return;
    draft.hash = conflict.currentHash;
    draft.uncertain = false;
    draft.savedText = conflict.currentText;
    if (choice === 'file') draft.text = conflict.currentText;
    if (choice === 'merge') draft.text = [conflict.currentText, draft.text].filter(Boolean).join('\n\n');
    delete draft.conflict;
    draft.status = draft.text === draft.savedText ? 'saved' : 'dirty';
    this.changed();
    if (draft.status === 'dirty') void this.save(page);
  }
  refresh(notes: Record<number, NoteValue>, readOnlyError?: NotesFileError) {
    this.readOnlyError = readOnlyError;
    if (!readOnlyError) {
      this.initial = notes;
      for (const [page, draft] of this.drafts) {
        if (draft.status === 'saved') {
          const value = notes[page] ?? { text: '', hash: EMPTY_NOTE_HASH };
          Object.assign(draft, value, { savedText: value.text });
        } else if (!draft.conflict) this.schedule(page, 600);
      }
      for (const page of Object.keys(notes)) this.get(Number(page));
    }
    this.changed();
  }
  dispose() {
    this.disposed = true;
    for (const page of this.timers.keys()) this.clearTimer(page);
    void this.flushAll(true);
    this.listeners.clear();
  }
}
