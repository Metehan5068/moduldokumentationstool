import { afterEach, expect, it, vi } from 'vitest';
import { NotesSession, EMPTY_NOTE_HASH } from '../src/web/notes-session';
import { noteHash } from '../src/server/notes-store';
const response = (text: string) => new Response(JSON.stringify({ hash: noteHash(text) }));
let session: NotesSession;
afterEach(() => { session?.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('speichert nach 600 ms Debounce und flusht vor Ablauf sofort', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue(response('Letzte Eingabe'));
  vi.stubGlobal('fetch', fetch);
  session = new NotesSession('abc', {});
  session.edit(1, 'Erste Eingabe');
  await vi.advanceTimersByTimeAsync(400);
  session.edit(1, 'Letzte Eingabe');
  await vi.advanceTimersByTimeAsync(599);
  expect(fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(session.get(1).status).toBe('saved');
  session.edit(2, 'Sofort');
  fetch.mockResolvedValue(response('Sofort'));
  await session.flushAll(true);
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ text: 'Sofort', baseHash: EMPTY_NOTE_HASH });
  expect(fetch.mock.calls[1]![1].keepalive).toBe(true);
  expect(session.hasUnsaved()).toBe(false);
});

it('verliert neue Eingaben während eines Requests nicht und nutzt anschließend den bestätigten Hash', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; })).mockResolvedValue(response('Neuer Text'));
  vi.stubGlobal('fetch', fetch);
  session = new NotesSession('abc', {});
  session.edit(1, 'Unterwegs');
  const saving = session.save(1);
  await Promise.resolve();
  session.edit(1, 'Neuer Text');
  finish(response('Unterwegs'));
  await saving;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ text: 'Neuer Text', baseHash: noteHash('Unterwegs') });
  expect(session.get(1)).toMatchObject({ text: 'Neuer Text', savedText: 'Neuer Text', status: 'saved' });
});

it('erhält Text bei Netzwerkfehlern und wiederholt nach fünf Sekunden', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(response('Bleibt erhalten'));
  vi.stubGlobal('fetch', fetch);
  session = new NotesSession('abc', {});
  session.edit(1, 'Bleibt erhalten');
  await session.save(1);
  expect(session.get(1)).toMatchObject({ text: 'Bleibt erhalten', status: 'error' });
  expect(session.hasUnsaved()).toBe(true);
  await vi.advanceTimersByTimeAsync(4999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(session.get(1).status).toBe('saved');
});

it.each(['mine', 'file', 'merge'] as const)('wartet bei Konflikten auf eine Entscheidung: %s', async (choice) => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ currentText: 'Dateifassung', currentHash: noteHash('Dateifassung') }), { status: 409 }))
    .mockResolvedValue(response(choice === 'merge' ? 'Dateifassung\n\nMeine Fassung' : 'Meine Fassung'));
  vi.stubGlobal('fetch', fetch);
  session = new NotesSession('abc', {});
  session.edit(1, 'Meine Fassung');
  await session.save(1);
  expect(session.get(1).status).toBe('conflict');
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(1);
  session.resolve(1, choice);
  await session.flushAll();
  expect(session.get(1).status).toBe('saved');
  expect(session.get(1).text).toBe(choice === 'merge' ? 'Dateifassung\n\nMeine Fassung' : choice === 'file' ? 'Dateifassung' : 'Meine Fassung');
  expect(fetch).toHaveBeenCalledTimes(choice === 'file' ? 1 : 2);
  if (choice !== 'file') expect(JSON.parse(fetch.mock.calls[1]![1].body).baseHash).toBe(noteHash('Dateifassung'));
});

it('sperrt bei Parserfehlern Schreibzugriffe und erhält den Entwurf bis zur Reparatur', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Zeile 4: Endmarker fehlt.', line: 4 }), { status: 422 })).mockResolvedValue(response('Entwurf'));
  vi.stubGlobal('fetch', fetch);
  session = new NotesSession('abc', {});
  session.edit(1, 'Entwurf');
  await session.save(1);
  session.edit(1, 'Darf sich nicht ändern');
  expect(session.get(1).text).toBe('Entwurf');
  expect(session.readOnlyError?.line).toBe(4);
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(1);
  session.refresh({});
  await session.flushAll();
  expect(session.readOnlyError).toBeUndefined();
  expect(session.get(1).status).toBe('saved');
});

it('bestätigt nach verloren gegangener Antwort bereits identischen Dateiinhalt ohne falschen Konflikt', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('Antwort verloren')).mockResolvedValue(new Response(JSON.stringify({ currentText: 'Schon geschrieben', currentHash: noteHash('Schon geschrieben') }), { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  session = new NotesSession('abc', {});
  session.edit(1, 'Schon geschrieben');
  await session.save(1);
  await session.save(1);
  expect(session.get(1)).toMatchObject({ status: 'saved', hash: noteHash('Schon geschrieben') });
  expect(session.get(1).conflict).toBeUndefined();
});

it('meldet nach verlorener Antwort auch Zurücksetzen auf den alten Text nicht voreilig als gespeichert', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('Antwort verloren')).mockResolvedValue(new Response(JSON.stringify({ currentText: 'Unterwegs geschrieben', currentHash: noteHash('Unterwegs geschrieben') }), { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  session = new NotesSession('abc', {});
  session.edit(1, 'Unterwegs geschrieben');
  await session.save(1);
  session.edit(1, '');
  expect(session.hasUnsaved()).toBe(true);
  await session.save(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(session.get(1).status).toBe('conflict');
});
