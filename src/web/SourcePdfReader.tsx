import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { SourceDocument } from '../shared/api';
import { InlineSlide } from './InlineSlide';
import { SlideZoom } from './SlideZoom';

GlobalWorkerOptions.workerSrc = workerUrl;
export interface PdfPosition { page: number; offsetRatio: number }
export interface SourcePdfHandle { jump: (page: number) => void; currentPage: () => number }
export function SourcePdfReader({ document, active, initial, onPosition, handleRef, highlight }: {
  document: SourceDocument; active: boolean; initial: PdfPosition; onPosition: (position: PdfPosition, visible: number[]) => void;
  handleRef: RefObject<SourcePdfHandle | null>; highlight?: number;
}) {
  const [loaded, setLoaded] = useState<{ pdf: PDFDocumentProxy; ratios: number[] }>();
  const [error, setError] = useState<string>();
  const [visible, setVisible] = useState<number[]>([]);
  const [zoomPage, setZoomPage] = useState<number>();
  const container = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLElement | null)[]>([]);
  const position = useRef(initial);
  const callback = useRef(onPosition); callback.current = onPosition;
  const activeRef = useRef(active); activeRef.current = active;
  const captureRef = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false;
    const task = getDocument({ url: `/api/documents/${document.id}/pdf`, cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true,
      standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/', iccUrl: '/pdf-assets/iccs/', useSystemFonts: false, disableRange: true });
    void task.promise.then(async (pdf) => {
      const ratios = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
        const page = await pdf.getPage(index + 1); const viewport = page.getViewport({ scale: 1 }); page.cleanup(); return viewport.width / viewport.height;
      }));
      if (!disposed) setLoaded({ pdf, ratios });
    }).catch(() => { if (!disposed) setError('PDF konnte nicht geladen werden. Bitte neu einlesen.'); });
    return () => { disposed = true; void task.destroy(); };
  }, [document.id]);

  useLayoutEffect(() => {
    if (!loaded || !active || !container.current) return;
    const element = container.current;
    const capture = () => {
      if (!activeRef.current) return;
      const top = element.getBoundingClientRect().top;
      const index = rows.current.findIndex((row) => row && row.getBoundingClientRect().bottom > top + 1);
      if (index < 0) return;
      const row = rows.current[index]!;
      const offsetRatio = Math.max(0, Math.min(1, (top - row.getBoundingClientRect().top) / row.getBoundingClientRect().height));
      position.current = { page: index + 1, offsetRatio };
      const pages = rows.current.flatMap((r, i) => r && r.getBoundingClientRect().bottom > top + 1 && r.getBoundingClientRect().top < top + element.clientHeight - 1 ? [i + 1] : []);
      setVisible((old) => old.join(',') === pages.join(',') ? old : pages);
      callback.current(position.current, pages);
    };
    captureRef.current = capture;
    const jump = (page: number) => {
      const target = Math.max(1, Math.min(loaded.pdf.numPages, page));
      const row = rows.current[target - 1];
      if (row) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top;
      capture();
    };
    handleRef.current = { jump, currentPage: () => position.current.page };
    const saved = position.current;
    const row = rows.current[Math.min(loaded.pdf.numPages, saved.page) - 1];
    if (row) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top + row.getBoundingClientRect().height * saved.offsetRatio;
    capture();
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; capture(); }); };
    const observer = new ResizeObserver(schedule); observer.observe(element);
    element.addEventListener('scroll', schedule, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener('scroll', schedule); cancelAnimationFrame(frame); handleRef.current = null; };
  }, [loaded, active, handleRef]);
  useEffect(() => {
    if (active && highlight !== undefined) handleRef.current?.jump(highlight);
  }, [active, highlight, loaded, handleRef]);
  const renderPages = new Set<number>();
  if (active) for (const page of visible) for (let i = Math.max(1, page - 2); i <= Math.min(loaded?.pdf.numPages ?? 0, page + 2); i++) renderPages.add(i);
  return <>
    <div className="source-pdf-scroll" ref={container} tabIndex={0} aria-label={document.kind === 'script' ? 'Mini-Skript PDF' : 'Whiteboard PDF'}>
      {error && <p role="alert" className="bad">{error}</p>}
      {!loaded && !error && <p role="status">PDF wird geladen …</p>}
      {loaded?.ratios.map((ratio, index) => <section key={index} data-page={index + 1} className={`source-page${highlight === index + 1 ? ' citation-target' : ''}`}
        ref={(node) => { rows.current[index] = node; }} aria-label={`PDF-Seite ${index + 1}`}>
        <InlineSlide pdf={loaded.pdf} pageNumber={index + 1} ratio={ratio} active={renderPages.has(index + 1)} onExpand={() => setZoomPage(index + 1)} />
      </section>)}
    </div>
    {loaded && active && zoomPage !== undefined && <SlideZoom pdf={loaded.pdf} pageNumber={zoomPage} ratio={loaded.ratios[zoomPage - 1]!} onClose={() => setZoomPage(undefined)} />}
  </>;
}
