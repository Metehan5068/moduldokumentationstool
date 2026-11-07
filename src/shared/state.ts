export interface LectureState {
  reader?: ReaderState;
  schemaVersion: 1;
  lastPage: number;
  pageOffsetRatio: number;
  activeNotePage: number;
  selection: { start: number; end: number };
  maxPageVisited: number;
  updatedAt: string;
}
export interface ReaderState {
  activeDocumentId?: string;
  positions: Record<string, { page: number; offsetRatio: number }>;
  markdownScrollRatio: number;
}
export function isReaderState(value: unknown): value is ReaderState {
  if (!value || typeof value !== 'object') return false;
  const reader = value as ReaderState;
  return (reader.activeDocumentId === undefined || /^[a-f0-9]{16}$/.test(reader.activeDocumentId))
    && Number.isFinite(reader.markdownScrollRatio) && reader.markdownScrollRatio >= 0 && reader.markdownScrollRatio <= 1
    && !!reader.positions && typeof reader.positions === 'object' && !Array.isArray(reader.positions)
    && Object.entries(reader.positions).length <= 200
    && Object.entries(reader.positions).every(([id, pos]) => /^[a-f0-9]{16}$/.test(id) && !!pos
      && Number.isSafeInteger(pos.page) && pos.page >= 1 && Number.isFinite(pos.offsetRatio) && pos.offsetRatio >= 0 && pos.offsetRatio <= 1);
}
export const INITIAL_STATE: LectureState = {
  schemaVersion: 1, lastPage: 1, pageOffsetRatio: 0, activeNotePage: 1,
  selection: { start: 0, end: 0 }, maxPageVisited: 0, updatedAt: '1970-01-01T00:00:00.000Z',
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function normalizeState(state: LectureState, pageCount: number): LectureState {
  const count = Math.max(1, pageCount);
  const lastPage = clamp(Math.trunc(state.lastPage), 1, count);
  const activeNotePage = clamp(Math.trunc(state.activeNotePage), 1, count);
  const start = clamp(Math.trunc(state.selection.start), 0, 500000);
  return {
    ...(isReaderState(state.reader) ? { reader: structuredClone(state.reader) } : {}),
    schemaVersion: 1, lastPage, activeNotePage,
    pageOffsetRatio: clamp(state.pageOffsetRatio, 0, 1),
    selection: { start, end: clamp(Math.trunc(state.selection.end), start, 500000) },
    maxPageVisited: clamp(Math.trunc(state.maxPageVisited), 0, count),
    updatedAt: new Date(state.updatedAt).toISOString(),
  };
}
export function isLectureState(value: unknown): value is LectureState {
  if (!value || typeof value !== 'object') return false;
  const state = value as LectureState;
  return state.schemaVersion === 1 && Number.isSafeInteger(state.lastPage) && Number.isSafeInteger(state.activeNotePage)
    && Number.isSafeInteger(state.maxPageVisited) && Number.isFinite(state.pageOffsetRatio)
    && Boolean(state.selection) && Number.isSafeInteger(state.selection?.start) && Number.isSafeInteger(state.selection?.end)
    && typeof state.updatedAt === 'string' && Number.isFinite(Date.parse(state.updatedAt))
    && (state.reader === undefined || isReaderState(state.reader));
}
