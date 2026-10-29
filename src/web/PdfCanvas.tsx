import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

/** Jede Render-Generation besitzt ihren Canvas: Abbruch und Resize können sich nicht überschreiben. */
export function PdfCanvas({ pdf, pageNumber, maxPixels = Infinity }: { pdf: PDFDocumentProxy; pageNumber: number; maxPixels?: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);
  const [error, setError] = useState(false);
  useEffect(() => {
    const element = holder.current!;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(element);
    const updateDpr = () => setDpr(window.devicePixelRatio || 1);
    window.addEventListener('resize', updateDpr);
    return () => { observer.disconnect(); window.removeEventListener('resize', updateDpr); };
  }, []);
  useEffect(() => {
    if (!width) return;
    const element = holder.current!;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', `PDF-Seite ${pageNumber}`);
    canvas.setAttribute('role', 'img');
    element.append(canvas);
    let cancelled = false;
    let render: RenderTask | undefined;
    let release: (() => void) | undefined;
    setError(false);
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        release = () => { page.cleanup(); };
        if (cancelled) return;
        const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
        const outputScale = Math.min(dpr, Math.sqrt(maxPixels / (viewport.width * viewport.height)));
        canvas.width = Math.ceil(viewport.width * outputScale);
        canvas.height = Math.ceil(viewport.height * outputScale);
        render = page.render({ canvas, viewport, transform: [outputScale, 0, 0, outputScale, 0, 0] });
        await render.promise;
        if (!cancelled) canvas.dataset.rendered = 'true';
      } catch (err) {
        if (!cancelled) { console.error('PDF-Seite konnte nicht gerendert werden', err); setError(true); }
      } finally {
        if (cancelled) { canvas.width = 0; canvas.height = 0; }
        release?.();
      }
    })();
    return () => {
      cancelled = true;
      render?.cancel();
      canvas.remove();
      // Nach Abschluss/Abbruch auch den GPU-/Bitmap-Speicher freigeben.
      void (render?.promise ?? Promise.resolve()).catch(() => {}).finally(() => {
        canvas.width = 0; canvas.height = 0; release?.();
      });
    };
  }, [pdf, pageNumber, width, dpr, maxPixels]);
  return <div className="pdf-canvas" ref={holder}>{error && <p role="alert">Folie konnte nicht dargestellt werden.</p>}</div>;
}
