import { useState } from 'react';
import type { LectureSummary, OrphanSummary } from '../shared/api';
export function OrphanCard({ orphan, lectures, onLinked }: { orphan: OrphanSummary; lectures: (LectureSummary & { module: string })[]; onLinked: () => void }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(orphan.candidates[0]?.id ?? '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  return <li>
    <span className="lecture-title">{orphan.module}/{orphan.title}</span>
    <span className="lecture-progress">{orphan.noteCount === null ? 'Notizdatei prüfen' : `${orphan.noteCount} Notizen`}{orphan.candidates.length > 0 && ' · umbenannt? Gleiche PDF gefunden.'}</span>
    <button type="button" onClick={() => setOpen((value) => !value)}>Mit PDF verknüpfen…</button>
    {open && <form className="relink-form" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError(undefined);
      try {
        const response = await fetch(`/api/orphans/${orphan.id}/relink`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lectureId: target }) });
        if (!response.ok) { const body = await response.json() as { message?: string }; setError(body.message ?? 'Verknüpfung fehlgeschlagen. Bitte erneut einlesen.'); return; }
        onLinked();
      } catch { setError('Verknüpfung fehlgeschlagen. Bitte erneut versuchen.'); }
      finally { setBusy(false); }
    }}>
      <label htmlFor={`relink-${orphan.id}`}>PDF für {orphan.module}/{orphan.title}</label>
      <select id={`relink-${orphan.id}`} value={target} required disabled={busy} onChange={(event) => setTarget(event.target.value)}>
        <option value="">PDF auswählen</option>
        {lectures.filter((lecture) => lecture.pageCount !== null).map((lecture) => <option key={lecture.id} value={lecture.id}>{lecture.module}/{lecture.title}{orphan.candidates.some((candidate) => candidate.id === lecture.id) ? ' (gleicher Inhalt)' : ''}</option>)}
      </select>
      <p>Die Notizen werden dieser PDF zugeordnet. Bei anderer Quelle anschließend die Folienzuordnung prüfen. Vorhandene Zielnotizen werden nicht überschrieben.</p>
      <button type="submit" disabled={busy || !target}>Verknüpfen</button>
      {error && <p className="bad" role="alert">{error}</p>}
    </form>}
  </li>;
}
