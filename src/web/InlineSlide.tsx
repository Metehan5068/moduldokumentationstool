import { useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfCanvas } from './PdfCanvas';

export function InlineSlide({ pdf, pageNumber, ratio, active, onExpand }: {
  pdf: PDFDocumentProxy; pageNumber: number; ratio: number; active: boolean; onExpand: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const centre = useRef({ x: 0.5, y: 0.5 });
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | undefined>(undefined);
  const changeZoom = (next: number) => {
    const element = viewport.current!;
    centre.current = {
      x: (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth,
      y: (element.scrollTop + element.clientHeight / 2) / element.scrollHeight,
    };
    setZoom(Math.max(1, Math.min(4, next)));
  };
  useLayoutEffect(() => {
    const element = viewport.current!;
    element.scrollLeft = zoom === 1 ? 0 : centre.current.x * element.scrollWidth - element.clientWidth / 2;
    element.scrollTop = zoom === 1 ? 0 : centre.current.y * element.scrollHeight - element.clientHeight / 2;
  }, [zoom]);
  const finishDrag = () => { drag.current = undefined; setDragging(false); };

  return <figure className="slide-card">
    <figcaption>
      <span>PDF-Seite {pageNumber}</span>
      <div className="inline-slide-controls" role="group" aria-label={`Zoom Folie ${pageNumber}`}>
        <button type="button" aria-label={`Folie ${pageNumber} herauszoomen`} disabled={zoom <= 1} onClick={() => changeZoom(zoom - 0.25)}>−</button>
        <output aria-label={`Vergrößerung Folie ${pageNumber}`} aria-live="polite">{Math.round(zoom * 100)} %</output>
        <button type="button" aria-label={`Folie ${pageNumber} hineinzoomen`} disabled={zoom >= 4} onClick={() => changeZoom(zoom + 0.25)}>+</button>
        <button type="button" aria-label={`Folie ${pageNumber} vergrößern`} onClick={onExpand}>Vergrößern</button>
      </div>
    </figcaption>
    <div className="slide-placeholder" style={{ aspectRatio: ratio }}>
      <div ref={viewport} className={`inline-slide-viewport${zoom > 1 ? ' is-zoomed' : ''}${dragging ? ' is-dragging' : ''}`}
        role="region" aria-label={`Folienausschnitt ${pageNumber}`} tabIndex={zoom > 1 ? 0 : -1}
        title={zoom > 1 ? 'Mit gedrückter Maustaste verschieben oder scrollen' : undefined}
        onPointerDown={(event) => {
          if (event.button !== 0 || zoom <= 1) return;
          const element = event.currentTarget;
          const bounds = element.getBoundingClientRect();
          if (event.clientX >= bounds.left + element.clientWidth || event.clientY >= bounds.top + element.clientHeight) return;
          event.preventDefault(); element.focus({ preventScroll: true });
          element.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId) return;
          event.currentTarget.scrollLeft = start.left + start.x - event.clientX;
          event.currentTarget.scrollTop = start.top + start.y - event.clientY;
        }}
        onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); finishDrag(); }}
        onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
        <div className="inline-slide-page" style={{ width: `${zoom * 100}%`, aspectRatio: ratio }}>
          {active && <PdfCanvas pdf={pdf} pageNumber={pageNumber} maxPixels={8 * 1024 * 1024} />}
        </div>
      </div>
    </div>
  </figure>;
}
