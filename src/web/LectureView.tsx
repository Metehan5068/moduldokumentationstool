import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { LectureResponse } from '../shared/api';
import { PdfCanvas } from './PdfCanvas';

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

export function LectureView({ id }: { id: string }) {
  const [loaded, setLoaded] = useState<LoadedLecture>();
  const [error, setError] = useState<string>();
  const [split, setSplit] = useState(storedSplit);
  const [currentPage, setCurrentPage] = useState(1);
  const [visible, setVisible] = useState<Set<number>>(new Set([1]));
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('1');
  const [jumpError, setJumpError] = useState(false);
  const [hasDrafts, setHasDrafts] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLElement | null)[]>([]);
  const notes = useRef<(HTMLTextAreaElement | null)[]>([]);
  const jumpInput = useRef<HTMLInputElement>(null);
  const activePage = useRef(1);
  const drag = useRef(false);

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
        if (!disposed) setLoaded({ detail, pdf, ratios });
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
        if (document.activeElement?.tagName === 'TEXTAREA') setCurrentPage(activePage.current);
        else if (index >= 0) { setCurrentPage(index + 1); activePage.current = index + 1; }
      });
    };
    container.addEventListener('scroll', updatePage, { passive: true });
    return () => { observer.disconnect(); container.removeEventListener('scroll', updatePage); cancelAnimationFrame(frame); };
  }, [loaded]);

  useEffect(() => {
    if (jumpOpen) { jumpInput.current?.focus(); jumpInput.current?.select(); }
  }, [jumpOpen]);

  useEffect(() => {
    if (!hasDrafts) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDrafts]);

  const goTo = (page: number) => {
    if (!loaded) return;
    const target = Math.max(1, Math.min(loaded.pdf.numPages, page));
    activePage.current = target;
    rows.current[target - 1]?.scrollIntoView({ block: 'start' });
    notes.current[target - 1]?.focus({ preventScroll: true });
    setCurrentPage(target);
  };
  const openJump = () => { setJumpValue(String(currentPage)); setJumpError(false); setJumpOpen(true); };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault(); goTo(activePage.current + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.ctrlKey && event.key.toLowerCase() === 'g') {
      event.preventDefault(); openJump();
    } else if (event.key === 'Escape') {
      if (jumpOpen) { setJumpOpen(false); scroll.current?.focus(); }
      else { (event.target as HTMLElement).blur(); scroll.current?.focus({ preventScroll: true }); }
    }
  };
  const active = new Set<number>();
  for (const page of visible) for (let i = Math.max(1, page - 2); i <= Math.min(loaded?.pdf.numPages ?? 0, page + 2); i++) active.add(i);

  return (
    <main className="lecture-view" onKeyDown={onKeyDown}>
      <header className="lecture-toolbar">
        <a href="#" onClick={(event) => { if (hasDrafts && !window.confirm('Die Notizen sind nur in dieser Ansicht vorhanden. Ansicht trotzdem verlassen?')) event.preventDefault(); }}>← Übersicht</a>
        <h1>{loaded ? `${loaded.detail.module} · ${loaded.detail.title}` : 'Vorlesung'}</h1>
        {loaded && <button type="button" onClick={openJump}>Folie {currentPage} / {loaded.pdf.numPages}</button>}
      </header>
      <p className="draft-warning" role="status">Notizen sind vorläufig und werden noch nicht gespeichert. Alt+↑/↓: Folie wechseln · Strg+G: Gehe zu Folie · Esc: Notizfeld verlassen</p>
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
                <textarea id={`note-${pageNumber}`} ref={(element) => { notes.current[index] = element; }} onFocus={() => { activePage.current = pageNumber; setCurrentPage(pageNumber); }} onChange={() => setHasDrafts(notes.current.some((note) => Boolean(note?.value)))} placeholder="Deine Notiz …" />
              </div>
            </section>;
          })}
        </div>}
      </div>
    </main>
  );
}
