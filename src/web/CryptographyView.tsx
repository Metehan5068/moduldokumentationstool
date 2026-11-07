import { createRef, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Citation, LectureResponse } from '../shared/api';
import type { ReaderState } from '../shared/state';
import { MarkdownReader } from './MarkdownReader';
import { PositionSession } from './position-session';
import { SourcePdfReader, type PdfPosition, type SourcePdfHandle } from './SourcePdfReader';
import { VisitTracker } from './visit-tracker';

const clampSplit = (value: number) => Math.min(75, Math.max(25, value));
export function CryptographyView({ detail, registerGuard }: { detail: LectureResponse; registerGuard: (guard: (() => Promise<boolean>) | undefined) => void }) {
  const content = detail.cryptography!;
  const documents = content.documents;
  const initialReader = useMemo<ReaderState>(() => {
    const saved = detail.state.reader;
    const positions: ReaderState['positions'] = {};
    for (const doc of documents) if (doc.pageCount) {
      const pos = saved?.positions[doc.id];
      if (pos) positions[doc.id] = { ...pos, page: Math.min(pos.page, doc.pageCount) };
    }
    return { positions, activeDocumentId: documents.some((d) => d.id === saved?.activeDocumentId && d.pageCount) ? saved?.activeDocumentId : content.whiteboardId ?? content.scriptId,
      markdownScrollRatio: saved?.markdownScrollRatio ?? 0 };
  }, [detail, content, documents]);
  const reader = useRef<ReaderState>(initialReader);
  const session = useMemo(() => new PositionSession(detail.id, detail.state), [detail]);
  const visits = useMemo(() => new VisitTracker(detail.state.maxPageVisited), [detail]);
  const [activeId, setActiveId] = useState(initialReader.activeDocumentId);
  const [whiteboardId, setWhiteboardId] = useState(documents.find((d) => d.id === initialReader.activeDocumentId)?.kind === 'whiteboard' ? initialReader.activeDocumentId : content.whiteboardId);
  const [tab, setTab] = useState<'whiteboard' | 'script'>(documents.find((d) => d.id === initialReader.activeDocumentId)?.kind ?? 'whiteboard');
  const [visited, setVisited] = useState(() => new Set(initialReader.activeDocumentId ? [initialReader.activeDocumentId] : []));
  const [page, setPage] = useState(initialReader.positions[initialReader.activeDocumentId ?? '']?.page ?? 1);
  const [highlight, setHighlight] = useState<{ documentId: string; page: number }>();
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visible = useRef<number[]>([]);
  const active = documents.find((d) => d.id === activeId);
  const activeRef = useRef(activeId); activeRef.current = activeId;
  const handles = useRef(new Map<string, ReturnType<typeof createRef<SourcePdfHandle>>>());
  const handle = useCallback((id: string) => { if (!handles.current.has(id)) handles.current.set(id, createRef<SourcePdfHandle>()); return handles.current.get(id)!; }, []);
  const markdown = useRef<HTMLDivElement>(null);
  const restoringMarkdown = useRef(true);
  const readerTouched = useRef(false);
  const [split, setSplit] = useState(() => { try { const value = Number(localStorage.getItem('lecture-column-ratio') ?? 50); return Number.isFinite(value) ? clampSplit(value) : 50; } catch { return 50; } });
  const [completed, setCompleted] = useState(detail.completed);
  const [completing, setCompleting] = useState(false);
  const completionRequest = useRef<Promise<boolean> | undefined>(undefined);
  const [error, setError] = useState<string>();
  const [stateError, setStateError] = useState<string>();
  const [accepted, setAccepted] = useState(new Set<string>());
  const [accepting, setAccepting] = useState<string>();
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('1');
  const [jumpError, setJumpError] = useState(false);
  const jumpInput = useRef<HTMLInputElement>(null);
  const panels = useRef<HTMLDivElement>(null);

  const save = useCallback((touch = false) => {
    const element = markdown.current;
    if (element && !restoringMarkdown.current) reader.current.markdownScrollRatio = Math.min(1, Math.max(0, element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight)));
    const board = reader.current.positions[content.whiteboardId ?? ''];
    session.update({ ...session.state, reader: structuredClone(reader.current),
      lastPage: board?.page ?? 1, pageOffsetRatio: board?.offsetRatio ?? 0,
      maxPageVisited: visits.maximum }, touch);
  }, [session, content.whiteboardId, visits]);
  const track = useCallback(() => {
    clearTimeout(visitTimer.current);
    visits.update(activeRef.current === content.whiteboardId ? visible.current : [], document.visibilityState === 'visible');
    save();
    const delay = visits.nextDelay();
    if (delay !== undefined) visitTimer.current = setTimeout(track, Math.max(1, delay));
  }, [content.whiteboardId, save, visits]);
  useEffect(() => {
    const unsubscribe = session.subscribe(() => setStateError(session.error));
    const flush = () => { save(); void session.flush(true); };
    const visibility = () => { track(); if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', visibility);
    registerGuard(async () => {
      save(); const [completion] = await Promise.all([completionRequest.current, session.flush()]);
      return completion !== false && !session.error;
    });
    save(true);
    return () => {
      save(); clearTimeout(visitTimer.current); clearTimeout(highlightTimer.current); session.dispose(); unsubscribe(); registerGuard(undefined);
      window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', visibility);
    };
  }, [session, registerGuard, save, track]);
  useEffect(() => { try { localStorage.setItem('lecture-column-ratio', String(split)); } catch { /* Optional preference. */ } }, [split]);
  useEffect(() => { if (jumpOpen) { jumpInput.current?.focus(); jumpInput.current?.select(); } }, [jumpOpen]);
  const restoreMarkdown = useCallback(() => {
    if (readerTouched.current || !markdown.current) return;
    restoringMarkdown.current = true;
    const element = markdown.current;
    element.scrollTop = initialReader.markdownScrollRatio * Math.max(0, element.scrollHeight - element.clientHeight);
    requestAnimationFrame(() => { restoringMarkdown.current = false; });
  }, [initialReader]);
  useEffect(() => {
    restoreMarkdown();
    const observer = new ResizeObserver(restoreMarkdown);
    if (markdown.current?.firstElementChild) observer.observe(markdown.current.firstElementChild);
    return () => observer.disconnect();
  }, [restoreMarkdown]);

  const activate = useCallback((id: string | undefined, kind: 'whiteboard' | 'script') => {
    visible.current = []; visits.update([], false); clearTimeout(visitTimer.current);
    setTab(kind); setActiveId(id); activeRef.current = id;
    reader.current = { ...reader.current, activeDocumentId: id };
    if (id) { setVisited((old) => new Set([...old, id])); setPage(reader.current.positions[id]?.page ?? 1); }
    save();
  }, [visits, save]);
  const navigate = useCallback((citation: Citation) => {
    if (citation.error || !citation.documentId || !citation.page) { setError(`${citation.id}: ${citation.error ?? 'Quelle fehlt.'}`); return; }
    const doc = documents.find((d) => d.id === citation.documentId);
    if (!doc) return;
    setError(undefined);
    if (doc.kind === 'whiteboard') setWhiteboardId(doc.id);
    reader.current.positions[doc.id] = { page: citation.page, offsetRatio: 0 };
    activate(doc.id, doc.kind);
    handle(doc.id).current?.jump(citation.page);
    setHighlight({ documentId: doc.id, page: citation.page });
    clearTimeout(highlightTimer.current); highlightTimer.current = setTimeout(() => setHighlight(undefined), 2500);
    setPage(citation.page);
  }, [documents, activate, handle]);
  const openJump = () => { setJumpValue(String(page)); setJumpError(false); setJumpOpen(true); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'g') { event.preventDefault(); if (active?.pageCount) openJump(); }
      else if (event.altKey && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); if (activeId) handle(activeId).current?.jump(page + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Escape') setJumpOpen(false);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  const broken = content.citations.filter((c) => c.error);
  return <main className="lecture-view crypto-view">
    <header className="lecture-toolbar"><a href="#">← Übersicht</a><h1>{detail.module} · {detail.title}</h1>
      {active?.pageCount && <button onClick={openJump}>{active.kind === 'script' ? 'Mini-Skript' : 'Whiteboard'} · Seite {page} / {active.pageCount}</button>}
      <label className="completed-toggle"><input type="checkbox" checked={completed} disabled={completing} onChange={(event) => {
        const next = event.target.checked; const previous = completed;
        setCompleted(next); setCompleting(true); setError(undefined);
        const request = (async () => {
          try {
            const response = await fetch(`/api/lectures/${detail.id}/completed`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: next }) });
            if (!response.ok) throw new Error();
            if (next) { visits.edited(detail.pageCount ?? 0); save(); }
            return true;
          } catch { setCompleted(previous); setError('Der Erledigt-Status konnte nicht gespeichert werden. Bitte erneut versuchen.'); return false; }
          finally { setCompleting(false); }
        })();
        completionRequest.current = request;
        void request.then(() => { if (completionRequest.current === request) completionRequest.current = undefined; });
      }} /> erledigt</label>
    </header>
    <p className="draft-warning">Alt+↑/↓: PDF-Seite wechseln · Strg+G: Gehe zu Seite · Quellenverweise öffnen links die passende PDF-Seite</p>
    {error && <p className="bad reader-message" role="alert">{error}</p>}
    {(stateError || detail.stateError) && <p className="bad reader-message" role="alert">{stateError ?? detail.stateError} <button onClick={() => void session.flush()}>Leseposition erneut speichern</button></p>}
    {documents.filter((d) => d.sourceChanged && !accepted.has(d.id) && (d.id === content.whiteboardId || d.id === content.scriptId || d.id === activeId)).map((doc) =>
      <div className="source-warning" role="alert" key={doc.id}>{doc.title}: Quelle geändert – Seitenzuordnung bitte prüfen. <button disabled={!!accepting} onClick={async () => {
        setAccepting(doc.id);
        try {
          const response = await fetch(`/api/documents/${doc.id}/accept-source`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceSha256: doc.sourceSha256 }) });
          if (!response.ok) throw new Error(); setAccepted((old) => new Set([...old, doc.id]));
        } catch { setError('Quellenbestätigung fehlgeschlagen. Die PDF wurde möglicherweise erneut geändert; bitte neu öffnen.'); }
        finally { setAccepting(undefined); }
      }}>Zuordnung geprüft</button></div>)}
    {jumpOpen && active?.pageCount && <form className="jump-form" onSubmit={(event) => {
      event.preventDefault(); const target = Number(jumpValue);
      if (!Number.isInteger(target) || target < 1 || target > active.pageCount!) { setJumpError(true); return; }
      handle(active.id).current?.jump(target); setJumpOpen(false);
    }}><label htmlFor="crypto-jump">Gehe zu Seite (1–{active.pageCount})</label>
      <input ref={jumpInput} id="crypto-jump" type="number" value={jumpValue} onChange={(event) => setJumpValue(event.target.value)} />
      <button type="submit">Öffnen</button><button type="button" onClick={() => setJumpOpen(false)}>Abbrechen</button>
      {jumpError && <span role="alert">Bitte eine gültige Seitennummer eingeben.</span>}
    </form>}
    <div className="crypto-panels" ref={panels} style={{ '--split': `${split}%` } as CSSProperties}>
      <section className="crypto-sources" aria-label="Quelldokumente">
        <div className="source-tabs" role="tablist" aria-label="Quellenauswahl" onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); const kind = event.key === 'Home' ? 'whiteboard' : event.key === 'End' ? 'script' : tab === 'whiteboard' ? 'script' : 'whiteboard';
            activate(kind === 'script' ? content.scriptId : whiteboardId, kind);
            document.getElementById(`tab-${kind}`)?.focus();
          }
        }}>
          <button id="tab-whiteboard" role="tab" aria-selected={tab === 'whiteboard'} aria-controls="panel-whiteboard" tabIndex={tab === 'whiteboard' ? 0 : -1} onClick={() => activate(whiteboardId, 'whiteboard')}>Whiteboard</button>
          <button id="tab-script" role="tab" aria-selected={tab === 'script'} aria-controls="panel-script" tabIndex={tab === 'script' ? 0 : -1} onClick={() => activate(content.scriptId, 'script')}>Mini-Skript</button>
        </div>
        {active && <div className="source-document-title">{active.title}{active.kind === 'whiteboard' && active.id !== content.whiteboardId && <button onClick={() => { setWhiteboardId(content.whiteboardId); activate(content.whiteboardId, 'whiteboard'); }}>Zurück zu dieser Lecture</button>}</div>}
        {(['whiteboard', 'script'] as const).map((kind) => <div key={kind} id={`panel-${kind}`} className="source-tab-panel" role="tabpanel" aria-labelledby={`tab-${kind}`} hidden={tab !== kind}>
          {(!active || active.kind !== kind || !active.pageCount) && tab === kind && <p className="empty">{active?.error ?? (kind === 'script' ? 'Kein Mini-Skript verfügbar.' : 'Kein eindeutig zugeordnetes Whiteboard verfügbar.')}</p>}
          {documents.filter((d) => d.kind === kind && visited.has(d.id) && d.pageCount).map((doc) => <div className="source-document" key={doc.id} hidden={activeId !== doc.id}>
            <SourcePdfReader document={doc} active={activeId === doc.id} initial={initialReader.positions[doc.id] ?? reader.current.positions[doc.id] ?? { page: 1, offsetRatio: 0 }}
              handleRef={handle(doc.id)} highlight={highlight?.documentId === doc.id ? highlight.page : undefined}
              onPosition={(pos: PdfPosition, pages) => {
                reader.current.positions[doc.id] = pos;
                if (activeRef.current === doc.id) { setPage(pos.page); visible.current = pages; track(); }
              }} />
          </div>)}
        </div>)}
      </section>
      <div className="crypto-splitter" role="separator" aria-label="Spaltenbreite ändern" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={split} tabIndex={0}
        onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setSplit((old) => event.key === 'Home' ? 25 : event.key === 'End' ? 75 : clampSplit(old + (event.key === 'ArrowLeft' ? -2 : 2))); } }}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId) && panels.current) { const rect = panels.current.getBoundingClientRect(); setSplit(clampSplit((event.clientX - rect.left) / rect.width * 100)); } }}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} />
      <section className="crypto-markdown" aria-label="Lernskript">
        <div className="markdown-toolbar"><strong>Lernskript · {detail.title}</strong><span>Leseansicht</span></div>
        <div ref={markdown} className="markdown-scroll" tabIndex={0} aria-label="Markdown-Leseansicht"
          onWheel={() => { readerTouched.current = true; }} onPointerDown={() => { readerTouched.current = true; }} onKeyDown={() => { readerTouched.current = true; }}
          onScroll={() => {
            const node = markdown.current;
            if (!node || restoringMarkdown.current) return;
            reader.current.markdownScrollRatio = Math.min(1, Math.max(0, node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight))); save();
          }}>
          {(content.warnings.length > 0 || broken.length > 0) && <details className="import-warnings"><summary>Importhinweise ({content.warnings.length + broken.length})</summary>
            <ul>{content.warnings.map((warning, i) => <li key={i}>{warning}</li>)}{broken.map((c) => <li key={c.id}>{c.id}: {c.error}</li>)}</ul></details>}
          {content.markdown !== undefined ? <MarkdownReader markdown={content.markdown} citations={content.citations} onCitation={navigate} onLayout={restoreMarkdown} />
            : <p className="empty">Für {detail.title} liegt noch keine Markdown-Datei vor. Lege sie unter mds/ ab und wähle in der Übersicht „Neu einlesen“.</p>}
        </div>
      </section>
    </div>
  </main>;
}
