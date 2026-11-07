import { lazy, Suspense, useEffect, useState } from 'react';
import type { LectureResponse } from '../shared/api';
const Slides = lazy(() => import('./LectureView').then((module) => ({ default: module.LectureView })));
const Cryptography = lazy(() => import('./CryptographyView').then((module) => ({ default: module.CryptographyView })));
export function LectureRoute({ id, registerGuard }: { id: string; registerGuard: (guard: (() => Promise<boolean>) | undefined) => void }) {
  const [detail, setDetail] = useState<LectureResponse>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/lectures/${id}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(); const result = await response.json() as LectureResponse;
      if (!controller.signal.aborted) setDetail(result);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [id]);
  if (error) return <main className="shell"><a href="#">← Übersicht</a><p role="alert">Vorlesung konnte nicht geladen werden. Bitte neu einlesen.</p></main>;
  return <Suspense fallback={<p role="status">Vorlesungsansicht wird geladen …</p>}>
    {detail ? detail.viewKind === 'cryptography' && detail.cryptography ? <Cryptography detail={detail} registerGuard={registerGuard} /> : <Slides id={id} registerGuard={registerGuard} /> : <p role="status">Vorlesung wird geladen …</p>}
  </Suspense>;
}
