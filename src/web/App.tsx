import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { OverviewResponse } from '../shared/api';
import { OrphanCard } from './OrphanCard';
const LectureView = lazy(() => import('./LectureView').then((module) => ({ default: module.LectureView })));

export function App() {
  const [hash, setHash] = useState(window.location.hash);
  const currentHash = useRef(hash);
  const guard = useRef<(() => Promise<boolean>) | undefined>(undefined);
  const registerGuard = useCallback((check: (() => Promise<boolean>) | undefined) => { guard.current = check; }, []);
  useEffect(() => {
    const update = async () => {
      const next = window.location.hash;
      const allowed = await guard.current?.() ?? true;
      if (window.location.hash !== next) return;
      if (allowed) { currentHash.current = next; setHash(next); }
      else window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${currentHash.current}`);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const id = /^#vorlesung\/([a-f0-9]{16})$/.exec(hash)?.[1];
  return id ? <Suspense fallback={<p role="status">Vorlesungsansicht wird geladen …</p>}><LectureView key={id} id={id} registerGuard={registerGuard} /></Suspense> : <Overview />;
}

function Overview() {
  const [overview, setOverview] = useState<OverviewResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  async function load(rescan = false) {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(rescan ? '/api/rescan' : '/api/overview', rescan ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } : undefined);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setOverview(await response.json() as OverviewResponse);
    } catch {
      setError('Die Übersicht konnte nicht geladen werden. Bitte Datenordner und Server prüfen und erneut einlesen.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <main className="shell">
      <header className="overview-header">
        <div><h1>Moduldokumentation</h1><p className="subtitle">Deine Module und Vorlesungsfolien</p></div>
        <button type="button" disabled={loading} onClick={() => void load(true)}>
          {loading ? 'Liest ein …' : 'Neu einlesen'}
        </button>
      </header>
      {overview?.resume && <section className="resume-card" aria-label="Weiter mit">
        <div><strong>Weiter mit: {overview.resume.title}</strong><p>{overview.resume.module} · Folie {overview.resume.lastPage} von {overview.resume.pageCount}</p></div>
        <a href={`#vorlesung/${overview.resume.id}`}>Öffnen</a>
      </section>}
      <div aria-live="polite" aria-busy={loading}>
        {loading && <p role="status">PDFs werden eingelesen …</p>}
        {error && <p className="bad" role="alert">{error}</p>}
        {overview && overview.modules.length === 0 && <p className="empty">Noch keine Module gefunden. Lege einen Modulordner mit PDFs unter module/ im Datenordner an und wähle „Neu einlesen“.</p>}
        {overview?.modules.map((module) => (
          <section className="module" key={module.name} aria-label={`Modul ${module.name}`}>
            <h2>{module.name}</h2>
            {module.lectures.length === 0 ? <p className="empty">Keine PDF-Dateien in diesem Modul.</p> : (
              <ul className="lectures">
                {module.lectures.map((lecture) => (
                  <li key={lecture.id}>
                    <span className="lecture-title">{lecture.pageCount !== null ? <a href={`#vorlesung/${lecture.id}`}>{lecture.title}</a> : lecture.title}</span>
                    {lecture.pageCount !== null && <span className="page-count">{lecture.pageCount} {lecture.pageCount === 1 ? 'Seite' : 'Seiten'}</span>}
                    {lecture.progress && <span className="lecture-progress">
                      {lecture.progress.completed ? '✓ erledigt' : lecture.progress.maxPageVisited > 0 ? `bis Folie ${lecture.progress.maxPageVisited}/${lecture.pageCount ?? '?'}` : 'Noch nicht begonnen'}
                      {' · '}{lecture.progress.noteCount === null ? 'Notizdatei prüfen' : `${lecture.progress.noteCount} ${lecture.progress.noteCount === 1 ? 'Notiz' : 'Notizen'}`}
                    </span>}
                    {lecture.error && <span className="bad">{lecture.error}</span>}
                    {lecture.sourceChanged && <span className="source-badge">⚠ PDF geändert – Zuordnung prüfen</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
        {overview?.orphans?.length && <section className="module" aria-label="Notizen ohne PDF">
          <h2>Notizen ohne PDF</h2><ul className="lectures">
            {overview.orphans.map((orphan) => <OrphanCard key={orphan.id} orphan={orphan}
              lectures={overview.modules.flatMap((module) => module.lectures.map((lecture) => ({ ...lecture, module: module.name })))} onLinked={() => { void load(); }} />)}
          </ul>
        </section>}
      </div>
      <p className="hint">Neue PDFs im Datenordner? Mit „Neu einlesen“ aktualisierst du die Übersicht.</p>
    </main>
  );
}
