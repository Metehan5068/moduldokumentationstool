export interface LectureState {
  schemaVersion: 1;
  lastPage: number;
  pageOffsetRatio: number;
  activeNotePage: number;
  selection: { start: number; end: number };
  maxPageVisited: number;
  updatedAt: string;
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
    schemaVersion: 1, lastPage, activeNotePage,
    pageOffsetRatio: clamp(state.pageOffsetRatio, 0, 1),
    selection: { start, end: clamp(Math.trunc(state.selection.end), start, 500000) },
    maxPageVisited: clamp(Math.max(lastPage, activeNotePage, Math.trunc(state.maxPageVisited)), 1, count),
    updatedAt: new Date(state.updatedAt).toISOString(),
  };
}
export function isLectureState(value: unknown): value is LectureState {
  if (!value || typeof value !== 'object') return false;
  const state = value as LectureState;
  return state.schemaVersion === 1 && Number.isSafeInteger(state.lastPage) && Number.isSafeInteger(state.activeNotePage)
    && Number.isSafeInteger(state.maxPageVisited) && Number.isFinite(state.pageOffsetRatio)
    && Boolean(state.selection) && Number.isSafeInteger(state.selection?.start) && Number.isSafeInteger(state.selection?.end)
    && typeof state.updatedAt === 'string' && Number.isFinite(Date.parse(state.updatedAt));
}
