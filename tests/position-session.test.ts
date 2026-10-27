import { afterEach, expect, it, vi } from 'vitest';
import { PositionSession } from '../src/web/position-session';
import { INITIAL_STATE, type LectureState } from '../src/shared/state';
let session: PositionSession;
const next = (page: number): Omit<LectureState, 'updatedAt'> => ({ ...INITIAL_STATE, selection: { start: 4, end: 9 }, lastPage: page, activeNotePage: page, maxPageVisited: page });
afterEach(() => { session?.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('drosselt auch anhaltendes Scrollen auf 1,5 Sekunden und sendet den neuesten Stand', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch', fetch); session = new PositionSession('abc', INITIAL_STATE);
  for (let page = 1; page <= 10; page++) { session.update(next(page)); await vi.advanceTimersByTimeAsync(100); }
  expect(fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0]![1].body).lastPage).toBe(10);
  for (let page = 11; page <= 20; page++) { session.update(next(page)); await vi.advanceTimersByTimeAsync(100); }
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1]![1].body).lastPage).toBe(20);
});

it('sendet bei langsamer Antwort nicht sofort erneut, sondern hält den Scroll-Throttle ein', async () => {
  vi.useFakeTimers();
  let finish!: (response: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; })).mockImplementation(() => Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch', fetch); session = new PositionSession('abc', INITIAL_STATE);
  session.update(next(1)); await vi.advanceTimersByTimeAsync(1500);
  session.update(next(2)); await vi.advanceTimersByTimeAsync(500);
  finish(new Response('{}')); await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(999); expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
});

it('flusht den neuesten Stand bei pagehide sofort per Keepalive trotz laufendem älteren Request', async () => {
  let rejectOld!: (cause: Error) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((_, reject) => { rejectOld = reject; })).mockImplementation(() => Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch', fetch); session = new PositionSession('abc', INITIAL_STATE);
  session.update(next(1)); const old = session.flush(); await Promise.resolve();
  session.update(next(13)); await session.flush(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]![1].keepalive).toBe(true);
  const first = JSON.parse(fetch.mock.calls[0]![1].body);
  const latest = JSON.parse(fetch.mock.calls[1]![1].body);
  expect(latest.lastPage).toBe(13); expect(Date.parse(latest.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
  rejectOld(new Error('Alte Verbindung beendet')); await old;
  expect(session.error).toBeUndefined();
});

it('behält einen fehlgeschlagenen Stand und wiederholt ihn nach fünf Sekunden', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 500 })).mockImplementation(() => Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch', fetch); session = new PositionSession('abc', INITIAL_STATE);
  session.update(next(13)); await session.flush(); expect(session.error).toBeDefined();
  await vi.advanceTimersByTimeAsync(4999); expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
  expect(session.error).toBeUndefined(); expect(session.state.lastPage).toBe(13);
});
