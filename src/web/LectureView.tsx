import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { LectureResponse } from '../shared/api';
import { PdfCanvas } from './PdfCanvas';
import { NotesSession, statusText } from './notes-session';
import { useLecturePosition } from './use-lecture-position';

GlobalWorkerOptions.workerSrc = workerUrl;
const SPLIT_KEY = 'lecture-column-ratio';
const clampSplit = (value: number) => Math.min(75, Math.max(25, value));
function storedSplit() {
  try {
    const value = Number(localStorage.getItem(SPLIT_KEY) ?? 50);
    return Number.isFinite(value) ? clampSplit(value) : 50;
  } catch { return 50; }
}
interface LoadedLecture { detail: LectureResponse; pdf: PDFDocumentProxy; ratios: number[] }

export function LectureView({ id, registerGuard }: { id: string; registerGuard: (check: (() => Promise<boolean>) | undefined) => void }) {
  const [loaded, setLoaded] = useState<LoadedLecture>();
  const [error, setError] = useState<string>();
  const [split, setSplit] = useState(storedSplit);
  const [currentPage, setCurrentPage] = useState(1);
  const [visible, setVisible] = useState<Set<number>>(new Set([1]));
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('1');
  const [jumpError, setJumpError] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string>();
  const [, redraw] = useReducer((value: number) => value + 1, 0);
  const session = useMemo(() => loaded ? new NotesSession(id, loaded.detail.notes, loaded.detail.readOnlyError) : undefined, [loaded, id]);
  const scroll = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLElement | null)[]>([]);
  const notes = useRef<(HTMLTextAreaElement | null)[]>([]);
  const jumpInput = useRef<HTMLInputElement>(null);
  const activePage = useRef(1);
  const drag = useRef(false);
  const completionRequest = useRef<Promise<boolean> | undefined>(undefined);
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  const { flush: flushPosition, error: positionError } = useLecturePosition(id, loaded?.detail.state, loaded?.pdf.numPages ?? 0, { scroll, rows, notes, activePage }, setCurrentPage);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  useEffect(() => {
    if (!session) return;
    const unsubscribe = session.subscribe(redraw);
    const flush = () => { void session.flushAll(true); };
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); else session.resume(); };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (session.hasUnsaved()) event.preventDefault(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('beforeunload', beforeUnload);
    registerGuard(async () => {
      const [completedSaved] = await Promise.all([completionRequest.current, session.flushAll(), flushPosition()]);
      return completedSaved !== false && !session.hasUnsaved();
    });
    return () => {
      unsubscribe(); registerGuard(undefined); session.dispose();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [session, registerGuard, flushPosition]);

  useEffect(() => {
    let disposed = false;
    let task: ReturnType<typeof getDocument> | undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/lectures/${id}`, { signal: controller.signal });
        if (!response.ok) { if (!disposed) setError('Vorlesung konnte nicht geladen werden. Bitte die Übersicht neu einlesen.'); return; }
        const detail = await response.json() as LectureResponse;
        if (disposed) return;
        if (detail.pageCount === null) { setError(detail.error ?? 'PDF konnte nicht eingelesen werden.'); return; }
        task = getDocument({ url: `/api/lectures/${id}/pdf`, cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true,
          standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/', iccUrl: '/pdf-assets/iccs/', useSystemFonts: false,
          disableAutoFetch: true, disableStream: true });
        const pdf = await task.promise;
        const ratios: number[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          if (disposed) return;
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1 });
          ratios.push(viewport.width / viewport.height);
          page.cleanup();
        }
        if (!disposed) { setCompleted(detail.completed); setLoaded({ detail, pdf, ratios }); }
      } catch (err) {
        if (!disposed) {
          console.error('PDF konnte nicht geladen werden', err);
          setError('PDF konnte nicht geladen werden. Datei und Zugriffsrechte prüfen (ggf. beschädigt oder passwortgeschützt).');
        }
      }
    })();
    return () => { disposed = true; controller.abort(); void task?.destroy(); };
  }, [id]);

  useEffect(() => {
    try { localStorage.setItem(SPLIT_KEY, String(split)); } catch { /* Private Browser können Speicher verweigern. */ }
  }, [split]);

  useEffect(() => {
    if (!loaded || !scroll.current) return;
    const intersections = new Set<number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const page = Number((entry.target as HTMLElement).dataset.page);
        if (entry.isIntersecting) intersections.add(page); else intersections.delete(page);
      }
      setVisible(new Set(intersections));
    }, { root: scroll.current });
    for (const row of rows.current) if (row) observer.observe(row);
    const container = scroll.current;
    let frame = 0;
    const updatePage = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const top = container.getBoundingClientRect().top + 24;
        const index = rows.current.findIndex((row) => row && row.getBoundingClientRect().bottom > top);
        if (index >= 0) { setCurrentPage(index + 1); if (document.activeElement?.tagName !== 'TEXTAREA') activePage.current = index + 1; }
      });
    };
    container.addEventListener('scroll', updatePage, { passive: true });
    return () => { observer.disconnect(); container.removeEventListener('scroll', updatePage); cancelAnimationFrame(frame); };
  }, [loaded]);

  useEffect(() => {
    if (jumpOpen) { jumpInput.current?.focus(); jumpInput.current?.select(); }
  }, [jumpOpen]);

  const goTo = (page: number) => {
    if (!loaded) return;
    void session?.save(activePage.current);
    const target = Math.max(1, Math.min(loaded.pdf.numPages, page));
    activePage.current = target;
    rows.current[target - 1]?.scrollIntoView({ block: 'start' });
    notes.current[target - 1]?.focus({ preventScroll: true });
    setCurrentPage(target);
  };
  const openJump = () => { setJumpValue(String(currentPage)); setJumpError(false); setJumpOpen(true); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault(); goTo(activePage.current + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.ctrlKey && event.key.toLowerCase() === 'g') {
      event.preventDefault(); openJump();
    } else if (event.ctrlKey && event.key.toLowerCase() === 's') {
      event.preventDefault(); void session?.flushAll();
    } else if (event.key === 'Escape') {
      if (jumpOpen) { setJumpOpen(false); scroll.current?.focus(); }
      else { if (event.target instanceof HTMLElement) event.target.blur(); scroll.current?.focus({ preventScroll: true }); }
    }
  };
  keyHandler.current = onKeyDown;
  const active = new Set<number>();
  for (const page of visible) for (let i = Math.max(1, page - 2); i <= Math.min(loaded?.pdf.numPages ?? 0, page + 2); i++) active.add(i);

  return (
    <main className="lecture-view">
      <header className="lecture-toolbar">
        <a href="#">← Übersicht</a>
        <h1>{loaded ? `${loaded.detail.module} · ${loaded.detail.title}` : 'Vorlesung'}</h1>
        {loaded && <button type="button" onClick={openJump}>Folie {currentPage} / {loaded.pdf.numPages}</button>}
        {loaded && <label className="completed-toggle"><input type="checkbox" checked={completed} disabled={completing} onChange={async (event) => {
          const next = event.target.checked;
          const previous = completed;
          setCompleted(next); setCompleting(true); setCompletionError(undefined);
          const request = (async () => {
            try {
              const response = await fetch(`/api/lectures/${id}/completed`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: next }) });
              if (!response.ok) throw new Error();
              return true;
            } catch { setCompleted(previous); setCompletionError('Der Erledigt-Status konnte nicht gespeichert werden. Bitte erneut versuchen.'); return false; }
            finally { setCompleting(false); }
          })();
          completionRequest.current = request;
          await request;
          if (completionRequest.current === request) completionRequest.current = undefined;
        }} /> erledigt</label>}
        {session && <span role="status">{session.readOnlyError ? 'Schreibgeschützt' : statusText[session.summary()]}</span>}
      </header>
      <p className="draft-warning">Alt+↑/↓: Folie wechseln · Strg+G: Gehe zu Folie · Strg+S: sofort speichern · Esc: Notizfeld verlassen</p>
      {completionError && <p className="bad" role="alert">{completionError}</p>}
      {(positionError || loaded?.detail.stateError) && <div className="position-error" role="alert">{positionError ?? loaded?.detail.stateError}
        {positionError && <button type="button" onClick={() => { void flushPosition(); }}>Leseposition erneut speichern</button>}
      </div>}
      {session?.readOnlyError && <div className="notes-error" role="alert">
        <p>Notizdatei ist schreibgeschützt: {session.readOnlyError.message} Bitte die Datei reparieren und erneut prüfen.</p>
        <button type="button" onClick={async () => {
          try {
            const response = await fetch(`/api/lectures/${id}`);
            if (!response.ok) throw new Error();
            const detail = await response.json() as LectureResponse;
            session.refresh(detail.notes, detail.readOnlyError);
          } catch { setError('Die Notizdatei konnte nicht erneut geprüft werden.'); }
        }}>Datei erneut prüfen</button>
      </div>}
      {error && <p className="bad" role="alert">{error}</p>}
      {!loaded && !error && <p role="status">PDF und Seitenlayout werden geladen …</p>}
      {jumpOpen && loaded && (
        <form className="jump-form" noValidate onSubmit={(event) => {
          event.preventDefault();
          const target = Number(jumpValue);
          if (!Number.isInteger(target) || target < 1 || target > loaded.pdf.numPages) { setJumpError(true); return; }
          setJumpOpen(false); goTo(target);
        }}>
          <label htmlFor="jump-page">Gehe zu Folie (1–{loaded.pdf.numPages})</label>
          <input ref={jumpInput} id="jump-page" type="number" min="1" max={loaded.pdf.numPages} value={jumpValue} onChange={(event) => setJumpValue(event.target.value)} required />
          <button type="submit">Öffnen</button><button type="button" onClick={() => { setJumpOpen(false); scroll.current?.focus(); }}>Abbrechen</button>
          {jumpError && <span role="alert">Bitte eine gültige Foliennummer eingeben.</span>}
        </form>
      )}
      <div className="lecture-scroll" ref={scroll} tabIndex={0} aria-label="Vorlesungsfolien und Notizen">
        {loaded && <div className="slide-rows" style={{ '--split': `${split}%` } as CSSProperties}>
          <div className="column-splitter" role="separator" aria-label="Spaltenbreite ändern" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={split} tabIndex={0}
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); setSplit((old) => event.key === 'Home' ? 25 : event.key === 'End' ? 75 : clampSplit(old + (event.key === 'ArrowLeft' ? -2 : 2)));
              }
            }}
            onPointerDown={(event) => { drag.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}
            onPointerMove={(event) => {
              if (!drag.current) return;
              const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
              setSplit(clampSplit(Math.round((event.clientX - bounds.left) / bounds.width * 100)));
            }} />
          {loaded.ratios.map((ratio, index) => {
            const pageNumber = index + 1;
            return <section className="slide-row" key={pageNumber} data-page={pageNumber} aria-label={`Folie ${pageNumber}`} ref={(element) => { rows.current[index] = element; }}>
              <figure className="slide-card">
                <figcaption>PDF-Seite {pageNumber}</figcaption>
                <div className="slide-placeholder" style={{ aspectRatio: ratio }}>
                  {active.has(pageNumber) && <PdfCanvas pdf={loaded.pdf} pageNumber={pageNumber} />}
                </div>
              </figure>
              <div className="note-card">
                <label htmlFor={`note-${pageNumber}`}>Notiz zu Folie {pageNumber}</label>
                <textarea id={`note-${pageNumber}`} ref={(element) => { notes.current[index] = element; }} onFocus={() => { activePage.current = pageNumber; setCurrentPage(pageNumber); }}
                  value={session?.get(pageNumber).text ?? ''} readOnly={Boolean(session?.readOnlyError)}
                  onChange={(event) => session?.edit(pageNumber, event.target.value)} onBlur={() => { void session?.save(pageNumber); }} placeholder="Deine Notiz …" />
                {session && <div className="note-save-status">
                  <span>{statusText[session.get(pageNumber).status]}</span>
                  {session.get(pageNumber).status === 'error' && !session.readOnlyError && <button type="button" onClick={() => { void session.save(pageNumber); }}>Wiederholen</button>}
                </div>}
                {session?.get(pageNumber).conflict && <div className="conflict-panel" role="group" aria-label={`Konflikt Folie ${pageNumber}`}>
                  <p>Diese Notiz wurde in der Datei geändert. Deine Fassung steht im Notizfeld oben.</p>
                  <label htmlFor={`file-note-${pageNumber}`}>Dateifassung Folie {pageNumber}</label>
                  <textarea id={`file-note-${pageNumber}`} readOnly value={session.get(pageNumber).conflict!.currentText} />
                  <div className="conflict-actions">
                    <button type="button" onClick={() => session.resolve(pageNumber, 'mine')}>Eigene behalten</button>
                    <button type="button" onClick={() => session.resolve(pageNumber, 'file')}>Datei übernehmen</button>
                    <button type="button" onClick={() => session.resolve(pageNumber, 'merge')}>Beide zusammenfügen</button>
                  </div>
                </div>}
              </div>
            </section>;
          })}
          {session && [...session.drafts].filter(([page]) => page > loaded.pdf.numPages).map(([page, draft]) => <section className="orphan-note" key={`orphan-${page}`}>
            <h2>Notizen ohne Folie · Folie {page}</h2><textarea aria-label={`Notiz ohne Folie ${page}`} readOnly value={draft.text} />
          </section>)}
        </div>}
      </div>
    </main>
  );
}
