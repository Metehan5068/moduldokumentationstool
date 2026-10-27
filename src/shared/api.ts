// Gemeinsame API-Verträge zwischen Server und Web-App.
import type { LectureState } from './state.js';

export interface HealthResponse {
  status: 'ok';
  dataRoot: string;
  moduleDirExists: boolean;
  notesDirExists: boolean;
}

export interface LectureSummary {
  id: string;
  title: string;
  pageCount: number | null;
  error?: string;
  progress?: { completed: boolean; maxPageVisited: number; lastPage: number; noteCount: number | null; updatedAt?: string };
}

export interface OverviewResponse {
  modules: { name: string; lectures: LectureSummary[] }[];
  resume?: { id: string; title: string; module: string; pageCount: number; lastPage: number; updatedAt: string };
}

export interface LectureResponse extends LectureSummary {
  module: string;
  notes: Record<number, NoteValue>;
  readOnlyError?: NotesFileError;
  state: LectureState;
  completed: boolean;
  stateError?: string;
}

export interface NoteValue { text: string; hash: string }
export interface NotesFileError { message: string; line?: number }
export interface NoteConflict { currentText: string; currentHash: string }
