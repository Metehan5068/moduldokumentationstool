import { useEffect, useState } from 'react';
import type { OverviewResponse } from '../shared/api';

export function App() {
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
                    <span className="lecture-title">{lecture.title}</span>
                    {lecture.error ? <span className="bad">{lecture.error}</span> : <span className="page-count">{lecture.pageCount} {lecture.pageCount === 1 ? 'Seite' : 'Seiten'}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <p className="hint">Neue PDFs im Datenordner? Mit „Neu einlesen“ aktualisierst du die Übersicht.</p>
    </main>
  );
}
