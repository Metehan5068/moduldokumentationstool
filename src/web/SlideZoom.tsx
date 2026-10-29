import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfCanvas } from './PdfCanvas';

export function SlideZoom({ pdf, pageNumber, ratio, onClose }: {
  pdf: PDFDocumentProxy; pageNumber: number; ratio: number; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | undefined>(undefined);
  const previousSize = useRef<{ width: number; height: number; viewportWidth: number; viewportHeight: number } | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const fitWidth = Math.max(1, Math.min(size.width, size.height * ratio));
  const width = fitWidth * zoom;
  const height = width / ratio;

  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    element.showModal();
    return () => { element.close(); opener?.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Keep the inspected region in the centre when changing magnification or window size.
  useLayoutEffect(() => {
    const element = viewport.current!;
    const previous = previousSize.current;
    const x = previous ? (element.scrollLeft + previous.viewportWidth / 2) / previous.width : 0.5;
    const y = previous ? (element.scrollTop + previous.viewportHeight / 2) / previous.height : 0.5;
    const stageWidth = Math.max(size.width, width);
    const stageHeight = Math.max(size.height, height);
    element.scrollLeft = x * stageWidth - size.width / 2;
    element.scrollTop = y * stageHeight - size.height / 2;
    previousSize.current = { width: stageWidth, height: stageHeight, viewportWidth: size.width, viewportHeight: size.height };
  }, [width, height, size]);

  const finishDrag = () => { drag.current = undefined; setDragging(false); };
  return <dialog className="slide-zoom" ref={dialog} aria-labelledby="slide-zoom-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => {
      // Keep lecture navigation and its Escape handler outside the modal.
      if (!(event.ctrlKey && event.key.toLowerCase() === 's')) event.stopPropagation();
    }}>
    <div className="slide-zoom-toolbar">
      <h2 id="slide-zoom-title">Folie {pageNumber} · Detailansicht</h2>
      <button type="button" aria-label="Verkleinern" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.25))}>−</button>
      <output aria-label="Vergrößerung" aria-live="polite">{Math.round(zoom * 100)} %</output>
      <button type="button" aria-label="Vergrößern" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.25))}>+</button>
      <button type="button" onClick={() => setZoom(1)}>Einpassen</button>
      <button type="button" onClick={onClose}>Schließen</button>
    </div>
    <p className="slide-zoom-hint" id="slide-zoom-help">100 % = ganze Folie · Vergrößerte Folie mit gedrückter Maustaste verschieben oder scrollen · Esc: schließen</p>
    <div ref={viewport} className={`slide-zoom-viewport${dragging ? ' is-dragging' : ''}`} tabIndex={0}
      role="region" aria-label="Vergrößerte Folie" aria-describedby="slide-zoom-help"
      onPointerDown={(event) => {
        if (event.button !== 0 || zoom <= 1) return;
        const element = event.currentTarget;
        // Preserve native scrollbar interaction.
        const bounds = element.getBoundingClientRect();
        if (event.clientX >= bounds.left + element.clientLeft + element.clientWidth || event.clientY >= bounds.top + element.clientTop + element.clientHeight) return;
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
      <div className="slide-zoom-stage" style={{ width, height }}>
        <div className="slide-zoom-page" style={{ width, height }}>
          {size.width > 0 && <PdfCanvas pdf={pdf} pageNumber={pageNumber} maxPixels={16 * 1024 * 1024} />}
        </div>
      </div>
    </div>
  </dialog>;
}
