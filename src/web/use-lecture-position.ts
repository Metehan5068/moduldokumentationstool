import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, type RefObject } from 'react';
import type { LectureState } from '../shared/state';
import { normalizeState } from '../shared/state';
import { PositionSession } from './position-session';
import { VisitTracker } from './visit-tracker';

type Elements = {
  scroll: RefObject<HTMLDivElement | null>;
  rows: RefObject<(HTMLElement | null)[]>;
  notes: RefObject<(HTMLTextAreaElement | null)[]>;
  activePage: RefObject<number>;
};
export function useLecturePosition(id: string, initial: LectureState | undefined, pageCount: number, elements: Elements, onPage: (page: number) => void) {
  const [, redraw] = useReducer((value: number) => value + 1, 0);
  const position = useMemo(() => initial ? new PositionSession(id, initial) : undefined, [id, initial]);
  const visits = useMemo(() => position ? new VisitTracker(position.state.maxPageVisited) : undefined, [position]);
  const visitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ready = useRef(false);
  const lastActiveNote = useRef(1);
  const latestElements = useRef(elements); latestElements.current = elements;
  const capture = useCallback((): void => {
    if (!ready.current || !position || !visits) return;
    const { scroll, rows, notes, activePage } = latestElements.current;
    const container = scroll.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const top = bounds.top + container.clientTop;
    let page = 1;
    let offset = 0;
    let found = false;
    const visible: number[] = [];
    for (const [index, row] of rows.current.entries()) {
      if (!row) continue;
      const rect = row.getBoundingClientRect();
      const slide = row.querySelector('.slide-placeholder')?.getBoundingClientRect();
      if (slide && slide.bottom > top + 1 && slide.top < top + container.clientHeight - 1) visible.push(index + 1);
      // scrollTop wird gerundet; ein Rest unter einem CSS-Pixel gehört zur nächsten Zeile.
      if (!found && rect.bottom > top + 1) { page = index + 1; offset = Math.min(1, Math.max(0, (top - rect.top) / rect.height)); found = true; }
    }
    const maxPageVisited = visits.update(visible, document.visibilityState === 'visible');
    clearTimeout(visitTimer.current);
    const delay = visits.nextDelay();
    if (delay !== undefined) visitTimer.current = setTimeout(capture, Math.max(1, delay));
    const focusedIndex = notes.current.findIndex((note) => note === document.activeElement);
    if (focusedIndex >= 0) { activePage.current = focusedIndex + 1; lastActiveNote.current = focusedIndex + 1; }
    const active = notes.current[lastActiveNote.current - 1];
    const state = normalizeState({
      ...position.state, lastPage: page, pageOffsetRatio: offset, activeNotePage: lastActiveNote.current,
      selection: { start: active?.selectionStart ?? 0, end: active?.selectionEnd ?? 0 }, maxPageVisited,
    }, pageCount);
    position.update(state);
  }, [position, visits, pageCount]);

  useLayoutEffect(() => {
    if (!position) return;
    const { scroll, rows, notes, activePage } = latestElements.current;
    const container = scroll.current;
    if (!container) return;
    const saved = normalizeState(position.state, pageCount);
    const row = rows.current[saved.lastPage - 1];
    if (!row) return;
    const rect = row.getBoundingClientRect();
    container.scrollTop += rect.top - container.getBoundingClientRect().top - container.clientTop + rect.height * saved.pageOffsetRatio;
    activePage.current = saved.activeNotePage;
    lastActiveNote.current = saved.activeNotePage;
    const note = notes.current[saved.activeNotePage - 1];
    note?.focus({ preventScroll: true });
    note?.setSelectionRange(Math.min(saved.selection.start, note.value.length), Math.min(saved.selection.end, note.value.length));
    onPage(saved.lastPage);
    ready.current = true;
    capture();
    // Auch Öffnen ohne weiteres Scrollen zählt als letzte Aktivität.
    position.update(position.state, true);
    return () => { capture(); ready.current = false; clearTimeout(visitTimer.current); };
  }, [position, pageCount, capture, onPage]);

  useEffect(() => {
    if (!position) return;
    const unsubscribe = position.subscribe(redraw);
    const container = latestElements.current.scroll.current;
    let frame = 0;
    const scheduleCapture = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; capture(); });
    };
    const focusIn = () => {
      const index = latestElements.current.notes.current.findIndex((note) => note === document.activeElement);
      if (index >= 0) lastActiveNote.current = index + 1;
      scheduleCapture();
    };
    const flush = () => { capture(); void position.flush(true); };
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); else capture(); };
    const input = (event: Event) => {
      const index = latestElements.current.notes.current.findIndex((note) => note === event.target);
      if (index >= 0) visits?.edited(index + 1);
      capture();
    };
    container?.addEventListener('scroll', scheduleCapture, { passive: true });
    container?.addEventListener('focusin', focusIn);
    container?.addEventListener('input', input);
    document.addEventListener('selectionchange', scheduleCapture);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      capture(); clearTimeout(visitTimer.current); cancelAnimationFrame(frame); unsubscribe(); position.dispose();
      container?.removeEventListener('scroll', scheduleCapture);
      container?.removeEventListener('focusin', focusIn);
      container?.removeEventListener('input', input);
      document.removeEventListener('selectionchange', scheduleCapture);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [position, visits, capture]);

  const flush = useCallback(async (keepalive = false) => { capture(); await position?.flush(keepalive); }, [capture, position]);
  return { flush, error: position?.error };
}
