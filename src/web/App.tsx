import { useEffect, useState } from 'react';
import type { HealthResponse } from '../shared/api';

type Status =
  | { kind: 'loading' }
  | { kind: 'ok'; health: HealthResponse }
  | { kind: 'error'; message: string };

export function App() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStatus({ kind: 'ok', health: (await res.json()) as HealthResponse });
      })
      .catch((err: unknown) => setStatus({ kind: 'error', message: String(err) }));
  }, []);

  return (
    <main className="shell">
      <h1>Moduldokumentation</h1>
      {status.kind === 'loading' && <p>Verbinde mit Server …</p>}
      {status.kind === 'error' && <p className="bad">Server nicht erreichbar: {status.message}</p>}
      {status.kind === 'ok' && (
        <dl className="facts">
          <dt>Server</dt>
          <dd className="good">läuft</dd>
          <dt>Datenordner</dt>
          <dd><code>{status.health.dataRoot}</code></dd>
          <dt>module/</dt>
          <dd className={status.health.moduleDirExists ? 'good' : 'bad'}>
            {status.health.moduleDirExists ? 'gefunden' : 'fehlt – DATA_ROOT in .env prüfen'}
          </dd>
          <dt>notes/</dt>
          <dd className={status.health.notesDirExists ? 'good' : 'bad'}>
            {status.health.notesDirExists ? 'gefunden' : 'fehlt'}
          </dd>
        </dl>
      )}
      <p className="hint">Phase 0 – Gerüst. Modulübersicht folgt in Phase 1.</p>
    </main>
  );
}
